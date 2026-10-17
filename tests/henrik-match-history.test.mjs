import assert from 'node:assert/strict';
import test from 'node:test';
import { compareMatches, importMatches, toRecord } from '../scripts/henrik-match-history.mjs';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const k = (round, ms, killer, victim, kt, vt) =>
  ({ round, time_in_round_in_ms: ms, killer: { puuid: killer, team: kt }, victim: { puuid: victim, team: vt } });
const body = won => ({ status: 200, data: {
  metadata: { map: { name: 'Sunset' } },
  players: [{ name: 'Me', tag: 'JP', puuid: 'p1', team_id: 'Blue', agent: { name: 'Jett' }, stats: { score: 2400, kills: 10, deaths: 5, assists: 1 } },
            { name: 'Foe', tag: 'X', puuid: 'p2', team_id: 'Red', stats: {} }],
  teams: [{ team_id: 'Blue', won }, { team_id: 'Red', won: !won }],
  rounds: [{}, {}],
  kills: [k(0, 100, 'p1', 'p2', 'Blue', 'Red'), k(1, 100, 'p2', 'p1', 'Red', 'Blue')],
} });
const base = { region: 'ap', apiKey: 'k', name: 'Me', tag: 'JP', delayMs: 0, sleep: async () => {} };

test('imports once, skips duplicates, stores no identifiers', async () => {
  const store = { version: 1, matches: [] };
  let calls = 0;
  const fetchImpl = async () => { calls++; return Response.json(body(true)); };
  const r1 = await importMatches({ ...base, matchIds: [A, A.toUpperCase()], store, fetchImpl });
  const r2 = await importMatches({ ...base, matchIds: [A], store, fetchImpl });
  assert.deepEqual([r1.added, r2.skipped, calls], [1, 1, 1]);
  const text = JSON.stringify(store);
  for (const s of ['p1', 'p2', 'Me', 'JP', 'Foe']) assert.ok(!text.includes(s));
});

test('rejects bad ids and oversize batches before any request', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return Response.json(body(true)); };
  await assert.rejects(importMatches({ ...base, matchIds: ['nope'], store: { matches: [] }, fetchImpl }), /UUID/);
  const many = Array.from({ length: 11 }, (_, i) => `${String(i).padStart(8, '0')}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`);
  await assert.rejects(importMatches({ ...base, matchIds: many, store: { matches: [] }, fetchImpl }), /UUID/);
  assert.equal(called, false);
});

test('rate limit stops the batch; other failures are counted by code', async () => {
  const store = { version: 1, matches: [] };
  await assert.rejects(importMatches({ ...base, matchIds: [A, B], store,
    fetchImpl: async () => new Response('{}', { status: 429 }) }), /429/);
  assert.equal(store.matches.length, 0);
  const r = await importMatches({ ...base, matchIds: [A], store,
    fetchImpl: async () => new Response('{}', { status: 404 }) });
  assert.deepEqual([r.added, r.failed, r.failureCodes], [0, 1, ['HTTP_404']]);
});

test('comparison groups by outcome and warns on small samples', async () => {
  const store = { version: 1, matches: [] };
  let n = 0;
  await importMatches({ ...base, matchIds: [A, B], store, fetchImpl: async () => Response.json(body(n++ === 0)) });
  const c = compareMatches(store.matches);
  assert.equal(c.byOutcome['勝利'].matches, 1);
  assert.equal(c.byOutcome['敗北'].matches, 1);
  assert.equal(c.byMap.Sunset.kd, 2);
  assert.match(c.caution, /少ない/);
  assert.equal(toRecord(A, { map: null, outcome: '未確認', agent: null, rounds: 0, opening: { firstKills: 0, firstDeaths: 0, evaluatedRounds: 0 } }).matchId, A);
});
