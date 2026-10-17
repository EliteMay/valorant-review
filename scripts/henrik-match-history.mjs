/**
 * Multi-match comparison. Fetches the given matches one at a time (manual, small batches),
 * keeps only anonymized per-match metrics in a local gitignored file, de-duplicates by match id.
 * Statistics show association with the result, never a proven cause.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProbeError, boundedJson } from './henrik-match-probe.mjs';
import { analyzeOneMatch, analyzeMatch, AnalysisError } from './henrik-match-analyze.mjs';

export const DEFAULT_STORE = '.vreview-local/henrik-matches.json';
export const MAX_BATCH = 10;
const LIST_ORIGIN = 'https://api.henrikdev.xyz';
const LIST_MAX_BYTES = 48 * 1024 * 1024;
const REGIONS = new Set(['ap', 'eu', 'na', 'kr']);
const MODE = /^[a-z0-9_-]{1,32}$/i;
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

/**
 * One GET returns up to 10 full match records (OpenAPI MatchesV4HistoryResponse), so no per-match request is needed.
 * The Riot ID is sent only in the request path to the API; it is never stored or printed.
 */
export async function importRecent({ region, name, tag, apiKey, count = 5, start = 0, mode = 'competitive', store, fetchImpl = fetch }) {
  if (!REGIONS.has(region)) throw new ProbeError('INPUT_REGION', 'region は ap / eu / na / kr のいずれかにしてください。');
  if (!name?.trim() || !tag?.trim()) throw new AnalysisError('MISSING_PLAYER', 'VREVIEW_PLAYER_NAME と VREVIEW_PLAYER_TAG を設定してください。');
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new ProbeError('MISSING_KEY', 'HENRIKDEV_API_KEYが未設定です。キーはチャットやGitHubに投稿しないでください。');
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH || !Number.isInteger(start) || start < 0 || start > 1000 || !MODE.test(mode)) {
    throw new AnalysisError('INPUT_RECENT', `--recent は1〜${MAX_BATCH}、--start は0以上、--mode は英数字で指定してください。`);
  }
  const url = `${LIST_ORIGIN}/valorant/v4/matches/${region}/pc/${encodeURIComponent(name.trim())}/${encodeURIComponent(tag.trim())}`
    + `?mode=${encodeURIComponent(mode)}&size=${count}&start=${start}`;
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', headers: { Authorization: apiKey.trim(), Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(30000) });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new ProbeError('TIMEOUT', '30秒以内にAPIから応答がありませんでした。');
    throw new ProbeError('NETWORK', 'APIへの通信に失敗しました。');
  }
  if (!response.ok) {
    const messages = { 401: 'キーの認証に失敗しました。', 403: 'アクセス権限がありません。', 404: '戦績が見つかりません（地域・Riot ID・プラットフォームを確認）。', 429: 'リクエスト上限に達しました。' };
    throw new ProbeError('HTTP_' + response.status, 'HTTP ' + response.status + ': ' + (messages[response.status] || 'APIリクエストが失敗しました。'));
  }
  const body = await boundedJson(response, LIST_MAX_BYTES);
  if (body?.status !== 200 || !Array.isArray(body.data)) throw new ProbeError('SCHEMA_MISMATCH', '想定する試合一覧と構造が違います。');
  const known = new Set(store.matches.map(m => m.matchId));
  const result = { fetched: body.data.length, added: 0, skipped: 0, failed: 0, failureCodes: [] };
  for (const item of body.data) {
    const id = typeof item?.metadata?.match_id === 'string' ? item.metadata.match_id.toLowerCase() : '';
    if (!UUID.test(id)) { result.failed++; result.failureCodes.push('NO_MATCH_ID'); continue; }
    if (known.has(id)) { result.skipped++; continue; }
    try {
      store.matches.push(toRecord(id, analyzeMatch(item, { name, tag })));
      known.add(id);
      result.added++;
    } catch (e) {
      result.failed++;
      result.failureCodes.push(e?.code ?? 'UNKNOWN');
    }
  }
  return result;
}

function parse(args) {
  const o = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--region', '--match-ids', '--recent', '--start', '--mode', '--store', '--summary-only'].includes(args[i])) {
      throw new AnalysisError('INPUT_ARGS', '引数: --region ap --recent 10 [--start 0] [--mode competitive] / --match-ids UUID,UUID / --summary-only true');
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
  if (o['--recent'] !== undefined) {
    imported = await importRecent({
      region: o['--region'] ?? 'ap', count: Number(o['--recent']), start: Number(o['--start'] ?? 0),
      mode: o['--mode'] ?? 'competitive', apiKey: env.HENRIKDEV_API_KEY,
      name: env.VREVIEW_PLAYER_NAME, tag: env.VREVIEW_PLAYER_TAG, store,
    });
    saveStore(path, store);
  } else if (o['--summary-only'] !== 'true') {
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
