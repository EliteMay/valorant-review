import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnoseMatch } from '../scripts/henrik-match-diagnose.mjs';

const k = (round, ms, killer, victim, kt = 'Blue', vt = 'Red') =>
  ({ round, time_in_round_in_ms: ms, killer: { puuid: killer, team: kt }, victim: { puuid: victim, team: vt } });
const data = () => ({
  players: [
    { name: 'My Name', tag: 'JPN', puuid: 'p-mine', team_id: 'Blue', agent: { name: 'Sova' }, stats: { score: 10, kills: 1, deaths: 1 } },
    { name: 'Other', tag: 'NA', puuid: 'p-foe', team_id: 'Red', stats: {} },
  ],
  teams: [{ team_id: 'Blue', won: true }, { team_id: 'Red', won: false }],
  rounds: [{}, {}],
  kills: [k(0, 100, 'p-mine', 'p-foe'), k(1, 100, 'p-foe', 'p-mine', 'Red', 'Blue')],
});

test('diagnostics report consistency without leaking identifiers', () => {
  const out = diagnoseMatch(data(), { name: 'my name', tag: 'jpn' });
  assert.equal(out.selectedPlayer.statsKillsEqualsEnemyKillEvents, true);
  assert.equal(out.selectedPlayer.statsDeathsEqualsDeathEvents, true);
  assert.equal(out.consistency.killTeamLabelsMatchTeamIds, true);
  assert.equal(out.consistency.exactlyOneTeamWon, true);
  assert.deepEqual(out.teamLabels.teamIds, ['Blue', 'Red']);
  const text = JSON.stringify(out);
  for (const s of ['p-mine', 'p-foe', 'My Name', 'JPN', 'Other']) assert.ok(!text.includes(s));
});

test('free-form team strings are masked and mismatches surface', () => {
  const d = data();
  d.kills[0].killer.team = 'a1b2-uuid-like-1234';
  const out = diagnoseMatch(d, { name: 'My Name', tag: 'JPN' });
  assert.equal(out.consistency.killTeamLabelsMatchTeamIds, false);
  assert.ok(!JSON.stringify(out).includes('a1b2'));
});
