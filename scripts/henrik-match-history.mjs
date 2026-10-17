/**
 * Multi-match comparison. Fetches the given matches one at a time (manual, small batches),
 * keeps only anonymized per-match metrics in a local gitignored file, de-duplicates by match id.
 * Statistics show association with the result, never a proven cause.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProbeError } from './henrik-match-probe.mjs';
import { analyzeOneMatch, AnalysisError } from './henrik-match-analyze.mjs';

export const DEFAULT_STORE = '.vreview-local/henrik-matches.json';
export const MAX_BATCH = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toRecord(matchId, a) {
  return {
    matchId: matchId.toLowerCase(), map: a.map, outcome: a.outcome, agent: a.agent, rounds: a.rounds,
    kills: a.kills, deaths: a.deaths, assists: a.assists, estimatedAcs: a.estimatedAcs,
    firstKills: a.opening.firstKills, firstDeaths: a.opening.firstDeaths, openingRounds: a.opening.evaluatedRounds,
  };
}

export function loadStore(path) {
  if (!existsSync(path)) return { version: 1, matches: [] };
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data?.version !== 1 || !Array.isArray(data.matches)) {
    throw new AnalysisError('STORE_INVALID', '保存ファイルの形式が想定外です。上書きせず中止しました。');
  }
  return data;
}

export function saveStore(path, store) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2) + '\n');
}

const num = v => Number.isFinite(v) ? v : null;
const mean = xs => xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length * 10) / 10 : null;

export function summarizeGroup(list) {
  const kd = list.filter(m => num(m.kills) !== null && num(m.deaths) !== null);
  const totalDeaths = kd.reduce((s, m) => s + m.deaths, 0);
  const rounds = list.reduce((s, m) => s + (m.openingRounds ?? 0), 0);
  return {
    matches: list.length,
    avgAcs: mean(list.map(m => m.estimatedAcs).filter(num)),
    kd: totalDeaths > 0 ? Math.round(kd.reduce((s, m) => s + m.kills, 0) / totalDeaths * 100) / 100 : null,
    firstKillsPerRound: rounds > 0 ? Math.round(list.reduce((s, m) => s + m.firstKills, 0) / rounds * 1000) / 1000 : null,
    firstDeathsPerRound: rounds > 0 ? Math.round(list.reduce((s, m) => s + m.firstDeaths, 0) / rounds * 1000) / 1000 : null,
  };
}

const groupBy = (list, key) => Object.fromEntries(
  [...Map.groupBy(list, m => m[key] ?? '不明')].map(([k, v]) => [k, summarizeGroup(v)]));

export function compareMatches(matches) {
  const decided = matches.filter(m => m.outcome === '勝利' || m.outcome === '敗北');
  return {
    totalMatches: matches.length,
    unknownOutcome: matches.length - decided.length,
    overall: summarizeGroup(matches),
    byOutcome: groupBy(decided, 'outcome'),
    byMap: groupBy(matches, 'map'),
    byAgent: groupBy(matches, 'agent'),
    caution: matches.length < 20
      ? '試合数が少ないため、差は偶然の範囲かもしれません。傾向であり、敗因の証明ではありません。'
      : '差は関連であり、原因の証明ではありません。',
  };
}

export async function importMatches({ region, matchIds, apiKey, name, tag, store, fetchImpl, delayMs = 2500, sleep }) {
  const ids = [...new Set(matchIds.map(i => i.trim().toLowerCase()))];
  if (ids.length === 0 || ids.length > MAX_BATCH || ids.some(i => !UUID.test(i))) {
    throw new AnalysisError('INPUT_MATCHES', `試合IDはUUID形式で1〜${MAX_BATCH}件指定してください。`);
  }
  const known = new Set(store.matches.map(m => m.matchId));
  const result = { added: 0, skipped: 0, failed: 0, failureCodes: [] };
  let first = true;
  for (const id of ids) {
    if (known.has(id)) { result.skipped++; continue; }
    if (!first) await (sleep ?? (ms => new Promise(r => setTimeout(r, ms))))(delayMs);
    first = false;
    try {
      const a = await analyzeOneMatch({ region, matchId: id, apiKey, name, tag, fetchImpl });
      store.matches.push(toRecord(id, a));
      result.added++;
    } catch (e) {
      if (e instanceof AnalysisError && e.code === 'MISSING_PLAYER') throw e;
      if (e instanceof ProbeError && ['MISSING_KEY', 'HTTP_401', 'HTTP_403', 'HTTP_429'].includes(e.code)) throw e;
      result.failed++;
      result.failureCodes.push(e?.code ?? 'UNKNOWN');
    }
  }
  return result;
}

function parse(args) {
  const o = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--region', '--match-ids', '--store', '--summary-only'].includes(args[i])) {
      throw new AnalysisError('INPUT_ARGS', '引数: --region ap --match-ids UUID,UUID [--store パス]  または --summary-only true');
    }
    o[args[i]] = args[i + 1];
  }
  return o;
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const o = parse(args);
  const path = resolve(o['--store'] ?? DEFAULT_STORE);
  const store = loadStore(path);
  let imported = null;
  if (o['--summary-only'] !== 'true') {
    imported = await importMatches({
      region: o['--region'] ?? 'ap', matchIds: (o['--match-ids'] ?? '').split(','),
      apiKey: env.HENRIKDEV_API_KEY, name: env.VREVIEW_PLAYER_NAME, tag: env.VREVIEW_PLAYER_TAG, store,
    });
    saveStore(path, store);
  }
  process.stdout.write(JSON.stringify({ imported, ...compareMatches(store.matches) }, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const safe = error instanceof ProbeError || error instanceof AnalysisError
      ? error.code + ': ' + error.message : '予期しないエラーです。';
    process.stderr.write(safe + '\n');
    process.exitCode = 1;
  });
}
