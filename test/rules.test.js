import test from 'node:test';
import assert from 'node:assert/strict';
import { createRack } from '../shared/physics.js';
import { resolveShot } from '../shared/rules.js';
import { Match } from '../server/match.js';

const outcome = (overrides = {}) => resolveShot({ balls: createRack(), color: 'red', firstHit: 1, pocketed: [], onBlack: false, railAfterContact: true, ...overrides });

test('legal own-colour pot keeps the turn, an empty legal shot passes it', () => {
  assert.equal(outcome({ pocketed: [1] }).keepTurn, true);
  assert.equal(outcome().keepTurn, false);
  assert.equal(outcome().foul, null);
});

test('no contact, wrong first contact, scratch and no cushion are separate fouls', () => {
  assert.match(outcome({ firstHit: null }).foul, /missed/);
  assert.match(outcome({ firstHit: 9 }).foul, /first contact/);
  assert.match(outcome({ pocketed: [0, 1] }).foul, /cue ball/);
  assert.match(outcome({ railAfterContact: false }).foul, /cushion/);
  assert.match(outcome({ firstHit: 8 }).foul, /black/);
  assert.equal(outcome({ firstHit: 1, pocketed: [9] }).foul, null);
  assert.equal(outcome({ firstHit: 1, pocketed: [9] }).keepTurn, false);
});

test('early black loses, cleared-colours black wins, black with a scratch loses', () => {
  assert.equal(outcome({ pocketed: [8] }).result, 'loss');
  const balls = createRack();
  balls.filter((b) => b.color === 'red').forEach((b) => { b.pocketed = true; });
  assert.equal(outcome({ balls, firstHit: 8, onBlack: true, pocketed: [8] }).result, 'win');
  assert.equal(outcome({ balls, firstHit: 8, onBlack: true, pocketed: [8, 0] }).result, 'loss');
  assert.equal(outcome({ balls, firstHit: 8, onBlack: true, pocketed: [8], railAfterContact: false }).result, 'win');
  assert.equal(outcome({ balls, firstHit: 8, onBlack: false, pocketed: [1, 8] }).result, 'loss');
});

function match() {
  const m = new Match('ABC234'); const socket = { readyState: 1, send() {} };
  const a = m.addPlayer('Alex', socket), b = m.addPlayer('Sam', socket);
  m.ready(a); m.ready(b);
  return { m, a, b };
}

test('players ready, server enforces turns and prevents duplicate shots', () => {
  const { m, a, b } = match();
  const shot = { angle: 0, power: .6, side: 0, top: 0 };
  assert.equal(m.phase, 'playing');
  assert.equal(m.turn, a.id);
  assert.throws(() => m.shoot(b, shot), /turn/);
  assert.throws(() => m.shoot(a, { ...shot, angle: NaN }), /Invalid/);
  m.shoot(a, shot);
  assert.throws(() => m.shoot(a, shot), /settle/);
});

test('foul passes turn, grants ball in hand, blocks shooting and validates placement', () => {
  const { m, a, b } = match();
  const shot = { angle: 0, power: .6, side: 0, top: 0 };
  m.shoot(a, shot);
  m.finishShot(); // firstHit is null: a miss
  assert.equal(m.turn, b.id);
  assert.equal(m.ballInHand, b.id);
  assert.equal(m.balls[0].pocketed, true);
  assert.throws(() => m.shoot(b, shot), /Place/);
  assert.throws(() => m.place(b, 809, 350), /open cloth/);
  m.place(b, 250, 250);
  assert.equal(m.ballInHand, null);
  assert.equal(m.balls[0].pocketed, false);
  assert.throws(() => m.place(b, 300, 300), /cannot be moved/);
  m.shoot(b, shot);
  assert.equal(m.moving, true);
});

test('early black awards opponent the frame; rematch requires both votes and swaps break', () => {
  const { m, a, b } = match();
  m.shoot(a, { angle: 0, power: .6, side: 0, top: 0 });
  m.shot.firstHit = 1; m.shot.pocketed = [8];
  m.finishShot();
  assert.equal(m.phase, 'finished'); assert.equal(m.result.winner, b.id);
  m.requestRematch(a); assert.equal(m.phase, 'finished');
  m.requestRematch(b); assert.equal(m.phase, 'playing');
  assert.equal(m.turn, b.id); assert.equal(b.color, 'red'); assert.equal(a.color, 'yellow');
  assert.ok(m.balls.every((b) => !b.pocketed));
});
