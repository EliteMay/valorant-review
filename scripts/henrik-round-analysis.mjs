/**
 * Round-level association metrics for the selected player. Anonymous counts only.
 * Results describe what co-occurs with lost rounds; they never prove a cause.
 */
const clean = v => typeof v === 'string' ? v.trim().toLowerCase() : '';
export const TRADE_WINDOW_MS = 5000;
const SIDES = ['attack', 'defense', 'unknown'];
const flip = s => s === 'attack' ? 'defense' : s === 'defense' ? 'attack' : null;

/**
 * First kill against the opposing team, not simply the earliest kill event.
 * Known teamkills/suicides are ignored. Unknown affiliation, invalid timestamps,
 * missing identities and tied opposing kills fail closed (no confident opening).
 * The input order is not authoritative.
 */
export function firstEnemyKill(events) {
  if (!Array.isArray(events)) return null;
  const candidates = [];
  for (const event of events) {
    const killerTeam = clean(event?.killer?.team);
    const victimTeam = clean(event?.victim?.team);
    if (!killerTeam || !victimTeam) return null;
    if (killerTeam === victimTeam) continue;
    if (!Number.isFinite(event?.time_in_round_in_ms) || event.time_in_round_in_ms < 0 ||
        !clean(event?.killer?.puuid) || !clean(event?.victim?.puuid)) return null;
    candidates.push(event);
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.time_in_round_in_ms - b.time_in_round_in_ms);
  if (candidates[1]?.time_in_round_in_ms === candidates[0].time_in_round_in_ms) return null;
  return candidates[0];
}

function roleOf(round) {
  const role = clean(round?.winning_team_role);
  if (role.startsWith('att')) return 'attack';
  if (role.startsWith('def')) return 'defense';
  const result = clean(round?.result);
  if (/detonat|plant|bomb/.test(result)) return 'attack';
  if (/defus/.test(result)) return 'defense';
  return null; // elimination / time expiry do not reveal the side by themselves
}

/** Side of the selected team per round. Needs a consistent half-time swap, else everything stays unknown. */
export function sideByRound(rounds, myTeam) {
  const known = rounds.map(r => {
    const w = clean(r?.winning_team);
    const role = roleOf(r);
    return w && role ? (w === myTeam ? role : flip(role)) : null;
  });
  const votes = new Set();
  known.forEach((s, i) => { if (s && i < 24) votes.add(i < 12 ? s : flip(s)); });
  if (votes.size !== 1) return { sides: rounds.map(() => 'unknown'), trusted: false };
  const first = [...votes][0];
  const sides = rounds.map((_, i) => {
    if (i < 12) return first;
    if (i < 24) return flip(first);
    return known[i] ?? 'unknown'; // overtime: only direct evidence
  });
  const consistent = known.every((s, i) => !s || i >= 24 || s === sides[i]);
  return consistent ? { sides, trusted: true } : { sides: rounds.map(() => 'unknown'), trusted: false };
}

const emptyBucket = () => ({
  rounds: 0, won: 0, kills: 0, deaths: 0, tradedDeaths: 0,
  lostWithMultiKill: 0, lostWhileSurviving: 0, fkRounds: 0, fkWon: 0, fdRounds: 0, fdWon: 0,
});

export function analyzeRounds(match, { puuid, teamId }) {
  const rounds = match.rounds;
  const me = clean(puuid);
  const myTeam = clean(teamId);
  const buckets = Object.fromEntries(SIDES.map(s => [s, emptyBucket()]));
  if (!me || !myTeam) return { evaluatedRounds: 0, skippedRounds: rounds.length, sideTrusted: false, buckets };
  const { sides, trusted } = sideByRound(rounds, myTeam);
  const byRound = new Map();
  const openingByRound = new Map();
  for (const k of match.kills) {
    if (!Number.isInteger(k?.round)) continue;
    (openingByRound.get(k.round) ?? openingByRound.set(k.round, []).get(k.round)).push(k);
    // Other round metrics preserve the old behavior for invalid timestamps.
    if (!Number.isFinite(k?.time_in_round_in_ms)) continue;
    (byRound.get(k.round) ?? byRound.set(k.round, []).get(k.round)).push(k);
  }
  let evaluated = 0;
  rounds.forEach((round, i) => {
    const winner = clean(round?.winning_team);
    if (!winner) return;
    const won = winner === myTeam;
    const ev = (byRound.get(i) ?? []).sort((a, b) => a.time_in_round_in_ms - b.time_in_round_in_ms);
    const b = buckets[sides[i]];
    evaluated++;
    b.rounds++;
    if (won) b.won++;
    const myKills = ev.filter(e => clean(e.killer?.puuid) === me && clean(e.killer?.team) !== clean(e.victim?.team)).length;
    const death = ev.find(e => clean(e.victim?.puuid) === me);
    b.kills += myKills;
    if (death) {
      b.deaths++;
      const traded = ev.some(e => e.time_in_round_in_ms > death.time_in_round_in_ms
        && e.time_in_round_in_ms - death.time_in_round_in_ms <= TRADE_WINDOW_MS
        && clean(e.victim?.puuid) === clean(death.killer?.puuid) && clean(e.killer?.team) === myTeam);
      if (traded) b.tradedDeaths++;
    }
    if (!won && myKills >= 2) b.lostWithMultiKill++;
    if (!won && !death) b.lostWhileSurviving++;
    const first = firstEnemyKill(openingByRound.get(i) ?? []);
    if (first && clean(first.killer.puuid) === me) { b.fkRounds++; if (won) b.fkWon++; }
    if (first && clean(first.victim.puuid) === me) { b.fdRounds++; if (won) b.fdWon++; }
  });
  return { evaluatedRounds: evaluated, skippedRounds: rounds.length - evaluated, sideTrusted: trusted, buckets };
}

const rate = (a, b, digits = 3) => b > 0 ? Math.round(a / b * 10 ** digits) / 10 ** digits : null;

export function aggregateRounds(statsList) {
  const total = Object.fromEntries(SIDES.map(s => [s, emptyBucket()]));
  for (const st of statsList) {
    for (const s of SIDES) for (const [k, v] of Object.entries(st?.buckets?.[s] ?? {})) total[s][k] += v;
  }
  const view = b => ({
    rounds: b.rounds,
    roundWinRate: rate(b.won, b.rounds),
    tradedDeathRate: rate(b.tradedDeaths, b.deaths),
    lostRoundsWithMyMultiKill: rate(b.lostWithMultiKill, b.rounds - b.won),
    lostRoundsWhileSurviving: rate(b.lostWhileSurviving, b.rounds - b.won),
    winRateWhenMyFirstKill: rate(b.fkWon, b.fkRounds),
    winRateWhenMyFirstDeath: rate(b.fdWon, b.fdRounds),
    samples: { deaths: b.deaths, myFirstKillRounds: b.fkRounds, myFirstDeathRounds: b.fdRounds },
  });
  return { attack: view(total.attack), defense: view(total.defense), sideUnknown: view(total.unknown), matchesWithRoundData: statsList.length };
}
