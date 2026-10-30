import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLE, makeBall, createRack, strike, stepPhysics, isMoving, validPlacement } from '../shared/physics.js';

function simulate(balls, seconds) {
  const events = [];
  for (let time = 0; time < seconds; time += 1 / 120) events.push(...stepPhysics(balls, 1 / 120));
  return events;
}

test('rack has 7 of each colour, black in the centre, no overlapping balls', () => {
  const balls = createRack();
  assert.equal(balls.length, 16);
  assert.equal(balls.filter((b) => b.color === 'red').length, 7);
  assert.equal(balls.filter((b) => b.color === 'yellow').length, 7);
  assert.equal(balls.find((b) => b.id === 8).y, 350);
  for (const a of balls) for (const b of balls) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= TABLE.radius * 2);
});

test('head-on ball collision transfers momentum without gaining energy', () => {
  const balls = [makeBall(0, 430, 350), makeBall(1, 455, 350)];
  balls[0].vx = 500;
  const events = simulate(balls, .04);
  assert.ok(events.some((e) => e.type === 'collision' && e.a === 0 && e.b === 1));
  assert.ok(balls[1].vx > 400);
  assert.ok(balls[0].vx < 100);
  assert.ok(balls.reduce((sum, b) => sum + b.vx ** 2 + b.vy ** 2, 0) <= 500 ** 2);
});

test('draw pulls the cue ball back after first contact; follow drives it forward', () => {
  const draw = [makeBall(0, 400, 350), makeBall(1, 440, 350)];
  const follow = structuredClone(draw);
  strike(draw, 0, .35, 0, -1);
  strike(follow, 0, .35, 0, 1);
  simulate(draw, .6); simulate(follow, .6);
  assert.ok(draw[0].x < 400, `Draw cue should move backwards: ${draw[0].x}`);
  assert.ok(follow[0].x > 450, `Follow cue should move forwards: ${follow[0].x}`);
});

test('side spin changes the cushion rebound angle', () => {
  const plain = [makeBall(0, 1085, 350)], spin = structuredClone(plain);
  strike(plain, .15, .4, 0, 0); strike(spin, .15, .4, 1, 0);
  const events = simulate(plain, .1); simulate(spin, .1);
  assert.ok(events.some((e) => e.type === 'cushion'));
  assert.ok(plain[0].vx < 0 && spin[0].vx < 0);
  assert.ok(Math.abs(plain[0].vy - spin[0].vy) > 30);
});

test('corner and centre pocket shots drop instead of bouncing off an invisible rail', () => {
  for (const [x, y, angle] of [[600, 140, -Math.PI / 2], [120, 135, -Math.PI * .75]]) {
    const balls = [makeBall(1, x, y)];
    balls[0].vx = Math.cos(angle) * 300; balls[0].vy = Math.sin(angle) * 300;
    const events = simulate(balls, .5);
    assert.ok(balls[0].pocketed);
    assert.equal(events.filter((e) => e.type === 'pocket').length, 1);
  }
});

test('a full power break settles, stays finite, and leaves all live balls on the table', () => {
  const balls = createRack();
  strike(balls, 0, 1, .4, .3);
  const events = simulate(balls, 35);
  assert.ok(events.filter((e) => e.type === 'collision').length > 15);
  assert.equal(isMoving(balls), false);
  for (const ball of balls) {
    assert.ok(Number.isFinite(ball.x) && Number.isFinite(ball.y));
    if (!ball.pocketed) {
      assert.ok(ball.x > TABLE.left - TABLE.radius && ball.x < TABLE.right + TABLE.radius);
      assert.ok(ball.y > TABLE.top - TABLE.radius && ball.y < TABLE.bottom + TABLE.radius);
    }
  }
});

test('ball in hand rejects overlaps, pockets, off-table coordinates, and non-finite input', () => {
  const balls = createRack();
  assert.equal(validPlacement(balls, 250, 250), true);
  assert.equal(validPlacement(balls, 809, 350), false);
  assert.equal(validPlacement(balls, 82, 97), false);
  assert.equal(validPlacement(balls, 50, 350), false);
  assert.equal(validPlacement(balls, NaN, 350), false);
});
