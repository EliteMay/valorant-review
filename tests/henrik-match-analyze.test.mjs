import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeMatch, analyzeOneMatch } from '../scripts/henrik-match-analyze.mjs';

const id = '11111111-2222-3333-4444-555555555555';
const mk = (round, ms, killer, victim, killerTeam = 'Blue', victimTeam = 'Red') => ({
  round, time_in_round_in_ms: ms,
  killer: { puuid: killer, team: killerTeam }, victim: { puuid: victim, team: victimTeam },
});
const fixture = () => ({
  metadata: { map: { name: 'Lotus' } },
  players: [
    { name: 'My Name', tag: 'JPN', puuid: 'private-mine', team_id: 'Blue', character: { name: 'Jett' },
      stats: { score: 3600, kills: 20, deaths: 13, assists: 5 } },
    { name: 'Other', tag: 'NA', puuid: 'private-foe', team_id: 'Red' },
  ],
  teams: [{ team_id: 'Blue', won: false }, { team_id: 'Red', won: true }],
  rounds: [{}, {}, {}],
  kills: [
    mk(1, 500, 'private-mine', 'private-foe'),
    mk(1, 1300, 'private-foe', 'private-mine', 'Red', 'Blue'),
    mk(2, 400, 'private-foe', 'private-mine', 'Red', 'Blue'),
    mk(3, 1200, 'private-foe', 'someone', 'Red', 'Blue'),
  ],
});

test('returns private metrics and only reliable opening duels', () => {
  const result = analyzeMatch(fixture(), { name: 'my name', tag: 'jpn' });
  assert.deepEqual([result.outcome, result.agent, result.map, result.kills, result.deaths, result.assists],
    ['敗北', 'Jett', 'Lotus', 20, 13, 5]);
  assert.equal(result.estimatedAcs, 1200);
  assert.deepEqual(result.opening, { firstKills: 1, firstDeaths: 1, evaluatedRounds: 3, excludedRounds: 0 });
  for (const secret of ['private-mine', 'My Name', 'JPN', 'private-foe']) {
    assert.ok(!JSON.stringify(result).includes(secret));
  }
});

test('ignores invalid or same-timestamp opening events', () => {
  const data = fixture();
  data.kills.push(mk(2, 400, 'private-mine', 'private-foe'));
  data.kills.push(mk(3, NaN, 'private-mine', 'private-foe'));
  assert.deepEqual(analyzeMatch(data, { name: 'My Name', tag: 'JPN' }).opening,
    { firstKills: 1, firstDeaths: 0, evaluatedRounds: 1, excludedRounds: 2 });
});

test('does not treat friendly fire or unknown affiliation as first blood', () => {
  const data = fixture();
  data.kills = [mk(1, 20, 'private-mine', 'private-foe', 'Blue', 'Blue'), mk(2, 20, 'private-foe', 'private-mine', 'Red', '')];
  assert.deepEqual(analyzeMatch(data, { name: 'My Name', tag: 'JPN' }).opening,
    { firstKills: 0, firstDeaths: 0, evaluatedRounds: 0, excludedRounds: 2 });
});

test('missing stats and team evidence remain unknown', () => {
  const data = fixture();
  delete data.players[0].stats.score;
  delete data.players[0].team_id;
  data.rounds = [];
  const result = analyzeMatch(data, { name: 'My Name', tag: 'JPN' });
  assert.equal(result.estimatedAcs, null);
  assert.equal(result.outcome, '未確認');
});

test('missing or duplicate Riot identities fail without echoing entered input', () => {
  const data = fixture();
  assert.throws(() => analyzeMatch(data, { name: 'secret-id', tag: 'NA' }), /一意/);
  data.players.push({ ...data.players[0] });
  assert.throws(() => analyzeMatch(data, { name: 'My Name', tag: 'JPN' }), /一意/);
  assert.throws(() => analyzeMatch(data, { name: '', tag: 'JPN' }), /設定/);
});

test('makes one authenticated GET, emits sanitized metrics only', async () => {
  const data = fixture();
  let requests = 0;
  const result = await analyzeOneMatch({
    region: 'ap', matchId: id, apiKey: 'local-only-key', name: 'My Name', tag: 'JPN',
    fetchImpl: async (_url, params) => {
      assert.equal(params.method, 'GET');
      assert.equal(params.headers.Authorization, 'local-only-key');
      requests++;
      return Response.json({ status: 200, data });
    },
  });
  assert.equal(requests, 1);
  assert.equal(result.opening.firstKills, 1);
  assert.ok(!JSON.stringify(result).includes('local-only-key'));
  assert.ok(!JSON.stringify(result).includes('private-mine'));
});

test('does not call API if selected player identity is unspecified', async () => {
  let called = false;
  await assert.rejects(analyzeOneMatch({
    region: 'ap', matchId: id, apiKey: 'dummy', name: '', tag: 'JPN',
    fetchImpl: async () => { called = true; return Response.json({ status: 200, data: fixture() }); },
  }), /設定/);
  assert.equal(called, false);
});

test('malformed data fails and malformed numbers remain null', () => {
  assert.throws(() => analyzeMatch({ kills: [], rounds: [], players: [] }, { name: 'My Name', tag: 'JPN' }), /不足/);
  const data = fixture();
  data.players[0].stats.deaths = 'invalid';
  assert.equal(analyzeMatch(data, { name: 'My Name', tag: 'JPN' }).deaths, null);
});

test('reads the agent from the official v4 `agent` field', () => {
  const data = fixture();
  data.players[0].agent = { id: 'a', name: 'Sova' };
  delete data.players[0].character;
  assert.equal(analyzeMatch(data, { name: 'My Name', tag: 'JPN' }).agent, 'Sova');
});
