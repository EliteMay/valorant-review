/**
 * HenrikDev v4 single-match read-only probe for VReview.
 * Never logs a key, Riot credentials, player data or the raw response.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://api.henrikdev.xyz';
const REGIONS = new Set(['ap', 'eu', 'na', 'kr']);
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const MAX_BYTES = 12 * 1024 * 1024;

export class ProbeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProbeError';
    this.code = code;
  }
}

export function endpoint(region, matchId) {
  if (!REGIONS.has(region)) {
    throw new ProbeError('INPUT_REGION', 'region は ap / eu / na / kr のいずれかにしてください。');
  }
  if (typeof matchId !== 'string' || !UUID.test(matchId)) {
    throw new ProbeError('INPUT_MATCH', 'match-id はUUID形式で指定してください。');
  }
  return ORIGIN + '/valorant/v4/match/' + region + '/' + matchId;
}

export function parseArgs(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!['--region', '--match-id'].includes(flag) || !args[index + 1] || options.has(flag)) {
      throw new ProbeError('INPUT_ARGS', '引数: --region ap --match-id UUID');
    }
    options.set(flag, args[index + 1]);
  }
  const region = options.get('--region');
  const matchId = options.get('--match-id');
  endpoint(region, matchId);
  return { region, matchId };
}

async function boundedJson(response) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BYTES) {
    throw new ProbeError('TOO_LARGE', 'API応答がサイズ上限を超えました。');
  }
  if (!response.body) throw new ProbeError('EMPTY_RESPONSE', 'API応答本文がありません。');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new ProbeError('TOO_LARGE', 'API応答がサイズ上限を超えました。');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ProbeError('INVALID_JSON', 'JSONとして読み取れないAPI応答でした。');
  }
}

export function summarizeMatch(body) {
  const data = body?.data;
  if (body?.status !== 200 || !data || typeof data !== 'object' || Array.isArray(data) ||
      !data.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata) ||
      !Array.isArray(data.players) || !Array.isArray(data.teams) ||
      !Array.isArray(data.rounds) || !Array.isArray(data.kills)) {
    throw new ProbeError('SCHEMA_MISMATCH', '想定する試合詳細と構造が違います。');
  }
  return {
    ok: true,
    source: 'HenrikDev VALORANT API v4',
    players: data.players.length,
    teams: data.teams.length,
    rounds: data.rounds.length,
    kills: data.kills.length,
    metadataKeys: Object.keys(data.metadata).sort(),
  };
}

export async function probeMatch({ region, matchId, apiKey, fetchImpl = fetch }) {
  const url = endpoint(region, matchId);
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new ProbeError('MISSING_KEY', 'HENRIKDEV_API_KEYが未設定です。キーはチャットやGitHubに投稿しないでください。');
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: apiKey.trim(), Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new ProbeError('TIMEOUT', '15秒以内にAPIから応答がありませんでした。');
    }
    throw new ProbeError('NETWORK', 'APIへの通信に失敗しました。');
  }
  if (!response.ok) {
    const messages = {
      401: 'キーの認証に失敗しました。',
      403: 'アクセス権限がありません。',
      404: '試合が見つかりません（地域・試合ID・API収録状況を確認）。',
      429: 'リクエスト上限に達しました。',
    };
    const message = messages[response.status] || (response.status >= 500
      ? 'APIサーバー側のエラーです。' : 'APIリクエストが失敗しました。');
    // Do not read or print third-party error responses.
    throw new ProbeError('HTTP_' + response.status, 'HTTP ' + response.status + ': ' + message);
  }
  return summarizeMatch(await boundedJson(response));
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write('Usage: node scripts/henrik-match-probe.mjs --region ap --match-id UUID\n');
    return;
  }
  const { region, matchId } = parseArgs(args);
  const result = await probeMatch({ region, matchId, apiKey: env.HENRIKDEV_API_KEY });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const safe = error instanceof ProbeError ? error.code + ': ' + error.message : '予期しないエラーです。';
    process.stderr.write(safe + '\n');
    process.exitCode = 1;
  });
}
