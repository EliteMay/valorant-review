import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeRounds, aggregateRounds, sideByRound } from '../scripts/henrik-round-analysis.mjs';

const k = (round, ms, killer, victim, kt, vt) =>
  ({ round, time_in_round_in_ms: ms, killer: { puuid: killer, team: kt }, victim: { puuid: victim, team: vt } });
const mkRounds = n => Array.from({ length: n }, (_, i) => ({
  winning_team: i % 2 ? 'Red' : 'Blue',
  winning_team_role: i < 12 ? (i % 2 ? 'Defender' : 'Attacker') : (i % 2 ? 'Attacker' : 'Defender'),
}));

test('infers sides from role evidence with half-time swap', () => {
  const { sides, trusted } = sideByRound(mkRounds(14), 'blue');
  assert.equal(trusted, true);
  assert.deepEqual([sides[0], sides[11], sides[12], sides[13]], ['attack', 'attack', 'defense', 'defense']);
});

test('contradicting side evidence leaves sides unknown', () => {
  const rounds = mkRounds(14);
  rounds[1].winning_team_role = 'Attacker'; // Red won as Attacker in the same half as Blue Attacker
  const { sides, trusted } = sideByRound(rounds, 'blue');
  assert.equal(trusted, false);
  assert.ok(sides.every(s => s === 'unknown'));
});

test('counts trades, multikill losses, survived losses and opening outcomes', () => {
  const rounds = [
    { winning_team: 'Red', winning_team_role: 'Defender' },
    { winning_team: 'Red', winning_team_role: 'Defender' },
    { winning_team: 'Blue', winning_team_role: 'Attacker' },
  ];
  const kills = [
    k(0, 1000, 'foe', 'me', 'Red', 'Blue'), k(0, 3000, 'mate', 'foe', 'Blue', 'Red'),
    k(1, 1000, 'me', 'f1', 'Blue', 'Red'), k(1, 2000, 'me', 'f2', 'Blue', 'Red'),
    k(2, 1000, 'me', 'f1', 'Blue', 'Red'),
  ];
  const r = analyzeRounds({ rounds, kills }, { puuid: 'me', teamId: 'Blue' });
  const a = r.buckets.attack;
  assert.deepEqual([r.evaluatedRounds, r.sideTrusted], [3, true]);
  assert.deepEqual([a.rounds, a.won, a.deaths, a.tradedDeaths, a.lostWithMultiKill, a.lostWhileSurviving, a.fkWon, a.fdRounds],
    [3, 1, 1, 1, 1, 1, 1, 1]);
  const agg = aggregateRounds([r]);
  assert.equal(agg.attack.tradedDeathRate, 1);
  assert.equal(agg.attack.roundWinRate, 0.333);
  assert.equal(agg.attack.winRateWhenMyFirstDeath, 0);
});

test('missing identity or winner yields no evaluated rounds, not guesses', () => {
  assert.equal(analyzeRounds({ rounds: [{}], kills: [] }, { puuid: 'me', teamId: 'Blue' }).evaluatedRounds, 0);
  assert.equal(analyzeRounds({ rounds: [{ winning_team: 'Red' }], kills: [] }, { puuid: '', teamId: 'Blue' }).evaluatedRounds, 0);
});
