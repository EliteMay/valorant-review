/**
 * Anonymous shape diagnostics for one HenrikDev v4 match. Prints only types, counts,
 * booleans and short alphabetic team labels. Never prints names, tags, PUUIDs, IDs or raw JSON.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeMatch, parseArgs, ProbeError } from './henrik-match-probe.mjs';

const typeOf = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
const clean = v => typeof v === 'string' ? v.trim().toLowerCase() : '';
const label = v => typeof v === 'string' && /^[A-Za-z]{1,12}$/.test(v) ? v : (v == null ? null : '<non-label ' + typeOf(v) + '>');
const uniq = list => [...new Set(list)].sort();

export function diagnoseMatch(match, { name, tag } = {}) {
  const players = Array.isArray(match?.players) ? match.players : [];
  const teams = Array.isArray(match?.teams) ? match.teams : [];
  const rounds = Array.isArray(match?.rounds) ? match.rounds : [];
  const kills = Array.isArray(match?.kills) ? match.kills : [];
  const me = players.filter(p => clean(p?.name) === clean(name) && clean(p?.tag) === clean(tag));
  const mine = me.length === 1 ? me[0] : null;
  const puuid = clean(mine?.puuid);
  const myKills = puuid ? kills.filter(k => clean(k?.killer?.puuid) === puuid && clean(k?.killer?.team) !== clean(k?.victim?.team)).length : null;
  const myDeaths = puuid ? kills.filter(k => clean(k?.victim?.puuid) === puuid).length : null;
  const roundNums = kills.map(k => k?.round).filter(Number.isInteger);
  const teamIds = teams.map(t => t?.team_id);
  const firstByRound = new Map();
  for (const k of kills) {
    if (!Number.isInteger(k?.round) || !Number.isFinite(k?.time_in_round_in_ms)) continue;
    const t = firstByRound.get(k.round);
    if (!t || k.time_in_round_in_ms < t) firstByRound.set(k.round, k.time_in_round_in_ms);
  }
  const tied = [...firstByRound].filter(([r, t]) =>
    kills.filter(k => k?.round === r && k?.time_in_round_in_ms === t).length > 1).length;
  const myTeam = clean(mine?.team_id);
  const deathRounds = new Set(kills.filter(k => puuid && clean(k?.victim?.puuid) === puuid).map(k => k.round));
  const tally = {};
  rounds.forEach((r, i) => {
    if (!mine || !clean(r?.winning_team)) return;
    const outcome = clean(r.winning_team) === myTeam ? 'won' : 'lost';
    const key = outcome + '/' + (label(r?.result) ?? 'none') + '/' + (label(r?.winning_team_role) ?? 'none');
    const t = tally[key] ?? (tally[key] = { rounds: 0, selectedPlayerSurvived: 0 });
    t.rounds++;
    if (!deathRounds.has(i)) t.selectedPlayerSurvived++;
  });
  return {
    ok: true,
    counts: { players: players.length, teams: teams.length, rounds: rounds.length, kills: kills.length },
    types: {
      'player.team_id': uniq(players.map(p => typeOf(p?.team_id))),
      'player.agent': uniq(players.map(p => typeOf(p?.agent))),
      'player.character': uniq(players.map(p => typeOf(p?.character))),
      'player.stats.score': uniq(players.map(p => typeOf(p?.stats?.score))),
      'player.stats.kills': uniq(players.map(p => typeOf(p?.stats?.kills))),
      'team.won': uniq(teams.map(t => typeOf(t?.won))),
      'kill.round': uniq(kills.map(k => typeOf(k?.round))),
      'kill.time_in_round_in_ms': uniq(kills.map(k => typeOf(k?.time_in_round_in_ms))),
      'kill.killer.team': uniq(kills.map(k => typeOf(k?.killer?.team))),
      'kill.victim.team': uniq(kills.map(k => typeOf(k?.victim?.team))),
    },
    teamLabels: {
      teamIds: uniq(teamIds.map(label)),
      playerTeamIds: uniq(players.map(p => label(p?.team_id))),
      killerTeams: uniq(kills.map(k => label(k?.killer?.team))),
      victimTeams: uniq(kills.map(k => label(k?.victim?.team))),
    },
    roundResultBreakdown: tally,
    consistency: {
      playerTeamIdsAllInTeams: players.every(p => teamIds.includes(p?.team_id)),
      killTeamLabelsMatchTeamIds: kills.every(k => teamIds.includes(k?.killer?.team) && teamIds.includes(k?.victim?.team)),
      exactlyOneTeamWon: teams.filter(t => t?.won === true).length === 1,
      roundNumberMin: roundNums.length ? Math.min(...roundNums) : null,
      roundNumberMax: roundNums.length ? Math.max(...roundNums) : null,
      killRoundsWithinRoundCount: roundNums.every(r => r >= 0 && r < rounds.length),
      roundsWithTiedFirstEvent: tied,
      roundsWithoutKills: rounds.length - firstByRound.size,
      teamKillEvents: kills.filter(k => clean(k?.killer?.team) === clean(k?.victim?.team)).length,
    },
    selectedPlayer: {
      uniquelyIdentified: Boolean(mine && puuid),
      statsKillsEqualsEnemyKillEvents: mine ? mine.stats?.kills === myKills : null,
      statsDeathsEqualsDeathEvents: mine ? mine.stats?.deaths === myDeaths : null,
      hasAgentName: mine ? typeof mine.agent?.name === 'string' : null,
    },
  };
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write('Usage: node scripts/henrik-match-diagnose.mjs --region ap --match-id UUID\n');
    return;
  }
  const { region, matchId } = parseArgs(args);
  const result = await probeMatch({
    region, matchId, apiKey: env.HENRIKDEV_API_KEY,
    transform: body => diagnoseMatch(body.data, { name: env.VREVIEW_PLAYER_NAME, tag: env.VREVIEW_PLAYER_TAG }),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write((error instanceof ProbeError ? error.code + ': ' + error.message : '予期しないエラーです。') + '\n');
    process.exitCode = 1;
  });
}
