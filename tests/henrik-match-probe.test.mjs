import assert from 'node:assert/strict';
import test from 'node:test';
import { endpoint, parseArgs, probeMatch, summarizeMatch } from '../scripts/henrik-match-probe.mjs';

const id = '11111111-2222-3333-4444-555555555555';
const fixture = {
  status: 200,
  data: {
    metadata: { match_id: 'dummy', map: 'DummyMap' },
    players: [{ puuid: 'hidden-player' }],
    teams: [{ team_id: 'Blue' }, { team_id: 'Red' }],
    rounds: [{ round: 1 }],
    kills: [{ round: 1 }, { round: 1 }],
    observers: [],
    coaches: [],
  },
};

test('region and UUID input validation', () => {
  assert.equal(endpoint('ap', id), 'https://api.henrikdev.xyz/valorant/v4/match/ap/' + id);
  assert.throws(() => endpoint('invalid', id), /region/);
  assert.throws(() => endpoint('ap', '../evil'), /UUID/);
  assert.deepEqual(parseArgs(['--region', 'ap', '--match-id', id]), { region: 'ap', matchId: id });
  assert.throws(() => parseArgs(['--region', 'ap', '--region', 'ap', '--match-id', id]), /引数/);
});

test('a key is required without calling the network', async () => {
  await assert.rejects(probeMatch({ region: 'ap', matchId: id, apiKey: '' }), /HENRIKDEV_API_KEY/);
});

test('one read-only authorized call summarizes shape but never exposes personal data', async () => {
  let count = 0;
  const result = await probeMatch({
    region: 'ap', matchId: id, apiKey: 'dummy-secret',
    fetchImpl: async (url, options) => {
      count++;
      assert.equal(url, 'https://api.henrikdev.xyz/valorant/v4/match/ap/' + id);
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'dummy-secret');
      assert.equal(options.redirect, 'error');
      return Response.json(fixture);
    },
  });
  assert.equal(count, 1);
  assert.equal(result.players, 1);
  assert.equal(result.teams, 2);
  assert.equal(result.rounds, 1);
  assert.equal(result.kills, 2);
  assert.ok(!JSON.stringify(result).includes('hidden-player'));
  assert.ok(!JSON.stringify(result).includes('dummy-secret'));
  assert.ok(!JSON.stringify(result).includes(id));
});

test('401/429 errors never dump response body or secrets', async () => {
  for (const code of [401, 429]) {
    await assert.rejects(probeMatch({
      region: 'ap', matchId: id, apiKey: 'dummy-secret',
      fetchImpl: async () => new Response('do-not-log-this', { status: code }),
    }), (error) => error.code === 'HTTP_' + code && !error.message.includes('do-not-log-this'));
  }
});

test('schema changes and invalid JSON must fail closed', async () => {
  assert.throws(() => summarizeMatch({ status: 200, data: { metadata: {} } }), /構造/);
  await assert.rejects(probeMatch({
    region: 'ap', matchId: id, apiKey: 'dummy-secret',
    fetchImpl: async () => new Response('invalid-json', { status: 200 }),
  }), (error) => error.code === 'INVALID_JSON');
});

test('response size is bounded', async () => {
  await assert.rejects(probeMatch({
    region: 'ap', matchId: id, apiKey: 'dummy-secret',
    fetchImpl: async () => new Response('{}', { status: 200, headers: { 'content-length': '15000000' } }),
  }), (error) => error.code === 'TOO_LARGE');
});
