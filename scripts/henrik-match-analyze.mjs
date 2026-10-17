/**
 * Personal HenrikDev match analysis. No raw response, names or API key leave this CLI.
 * Non-causal metrics only; no gameplay process access, polling, or permanent storage.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeMatch, parseArgs, ProbeError } from './henrik-match-probe.mjs';
import { analyzeRounds, firstEnemyKill } from './henrik-round-analysis.mjs';

export class AnalysisError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const cleanId = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const positiveCount = value => Number.isInteger(value) && value >= 0 ? value : null;
const scoreValue = value => Number.isFinite(value) && value >= 0 ? value : null;

function readPlayer(match, name, tag) {
  if (!name?.trim() || !tag?.trim()) {
    throw new AnalysisError('MISSING_PLAYER', 'VREVIEW_PLAYER_NAME と VREVIEW_PLAYER_TAG を設定してください。');
  }
  if (!Array.isArray(match?.players)) {
    throw new AnalysisError('SCHEMA_MISMATCH', 'プレイヤーデータの構造が想定外です。');
  }
  const matches = match.players.filter(p => cleanId(p?.name) === cleanId(name) && cleanId(p?.tag) === cleanId(tag));
  if (matches.length !== 1 || !cleanId(matches[0]?.puuid)) {
    throw new AnalysisError('PLAYER_NOT_FOUND', '指定したRiot IDのプレイヤーを試合内で一意に特定できません。');
  }
  return matches[0];
}

function openingDuelStats(match, puuid) {
  const byRound = new Map();
  for (const item of match.kills) {
    if (!Number.isInteger(item?.round) || item.round < 0) continue;
    const events = byRound.get(item.round) ?? [];
    events.push(item);
    byRound.set(item.round, events);
  }
  let firstKills = 0;
  let firstDeaths = 0;
  let evaluatedRounds = 0;
  let excludedRounds = 0;
  for (const events of byRound.values()) {
    const first = firstEnemyKill(events);
    if (!first) {
      excludedRounds++;
      continue;
    }
    evaluatedRounds++;
    if (cleanId(first.killer.puuid) === puuid) firstKills++;
    if (cleanId(first.victim.puuid) === puuid) firstDeaths++;
  }
  return { firstKills, firstDeaths, evaluatedRounds, excludedRounds };
}

export function analyzeMatch(match, { name, tag }) {
  if (!match || !Array.isArray(match.kills) || !Array.isArray(match.rounds) || !Array.isArray(match.teams)) {
    throw new AnalysisError('SCHEMA_MISMATCH', 'ラウンド・キル・チーム情報が不足しています。');
  }
  const player = readPlayer(match, name, tag);
  const stats = player.stats || {};
  const teamId = cleanId(player.team_id);
  const team = match.teams.find(t => cleanId(t?.team_id) === teamId);
  const outcome = team && typeof team.won === 'boolean' ? (team.won ? '勝利' : '敗北') : '未確認';
  const rounds = match.rounds.length;
  const score = scoreValue(stats.score);
  const opening = openingDuelStats(match, cleanId(player.puuid));
  const map = typeof match.metadata?.map?.name === 'string' ? match.metadata.map.name : null;
  return {
    ok: true,
    source: 'HenrikDev VALORANT API v4',
    map,
    outcome,
    rounds,
    // v4 official field is `agent`; `character` kept only as a legacy fallback.
    agent: [player.agent?.name, player.character?.name].find(v => typeof v === 'string') ?? null,
    kills: positiveCount(stats.kills),
    deaths: positiveCount(stats.deaths),
    assists: positiveCount(stats.assists),
    estimatedAcs: score !== null && rounds > 0 ? Math.round(score / rounds * 10) / 10 : null,
    opening,
    roundStats: analyzeRounds(match, { puuid: player.puuid, teamId: player.team_id }),
    note: 'FK/FDは各ラウンドの時刻付き最初の敵対キルから算出。欠損・同時刻・チームキルは除外。敗因の断定は不可。',
  };
}

export async function analyzeOneMatch({ region, matchId, apiKey, name, tag, fetchImpl }) {
  if (!name?.trim() || !tag?.trim()) {
    throw new AnalysisError('MISSING_PLAYER', 'VREVIEW_PLAYER_NAME と VREVIEW_PLAYER_TAG を設定してください。');
  }
  return probeMatch({
    region, matchId, apiKey, fetchImpl,
    transform: body => analyzeMatch(body.data, { name, tag }),
  });
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write('Usage: node scripts/henrik-match-analyze.mjs --region ap --match-id UUID\n');
    return;
  }
  const { region, matchId } = parseArgs(args);
  const summary = await analyzeOneMatch({
    region, matchId, apiKey: env.HENRIKDEV_API_KEY,
    name: env.VREVIEW_PLAYER_NAME, tag: env.VREVIEW_PLAYER_TAG,
  });
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const safe = error instanceof ProbeError || error instanceof AnalysisError
      ? error.code + ': ' + error.message : '予期しないエラーです。';
    process.stderr.write(safe + '\n');
    process.exitCode = 1;
  });
}
