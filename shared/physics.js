// Distances are table units; time is seconds. The server owns the simulation.
// A ball's angular velocity is in radians/second, with mass normalised to one.
export const TABLE = Object.freeze({
  width: 1200, height: 700,
  left: 70, right: 1130, top: 85, bottom: 615,
  radius: 11.2, pocketRadius: 24,
});
export const POCKETS = [
  { x: 70, y: 85 }, { x: 600, y: 79 }, { x: 1130, y: 85 },
  { x: 70, y: 615 }, { x: 600, y: 621 }, { x: 1130, y: 615 },
];
const R = TABLE.radius;
const SLIDING_FRICTION = 580;
const ROLLING_FRICTION = 36;
const BALL_RESTITUTION = 0.965;
const CUSHION_RESTITUTION = 0.83;
const EPSILON = 1e-7;

export const colorOf = (id) => id === 0 ? 'white' : id === 8 ? 'black' : id < 8 ? 'red' : 'yellow';
export function makeBall(id, x, y) {
  return { id, color: colorOf(id), x, y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, pocketed: false };
}

export function createRack() {
  const balls = [makeBall(0, 335, 350)];
  // Black in the centre, one ball of each colour in the back corners.
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 6, 13, 7, 14, 15];
  let i = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      balls.push(makeBall(order[i++], 809 + row * R * Math.sqrt(3) * 1.012, 350 + (col - row / 2) * R * 2.024));
    }
  }
  return balls.sort((a, b) => a.id - b.id);
}

export function strike(balls, angle, power, side = 0, top = 0) {
  const cue = balls.find((b) => b.id === 0);
  if (!cue || cue.pocketed) return false;
  const speed = 100 + Math.max(0, Math.min(1, power)) ** 1.25 * 1400;
  cue.vx = Math.cos(angle) * speed;
  cue.vy = Math.sin(angle) * speed;
  // Positive top gives follow, negative gives draw. The default centre strike
  // starts sliding, then develops natural roll through cloth friction.
  cue.wx = -Math.sin(angle) * speed / R * top * 1.8;
  cue.wy = Math.cos(angle) * speed / R * top * 1.8;
  cue.wz = side * speed / R * 1.1;
  return true;
}

function cloth(ball, dt) {
  const slipX = ball.vx - R * ball.wy;
  const slipY = ball.vy + R * ball.wx;
  const slip = Math.hypot(slipX, slipY);
  if (slip > 0.1) {
    // I = 2/5 mR². Limit the impulse to avoid overshooting pure rolling.
    const impulse = Math.min(SLIDING_FRICTION * dt, slip / 3.5);
    const ix = impulse * slipX / slip;
    const iy = impulse * slipY / slip;
    ball.vx -= ix;
    ball.vy -= iy;
    ball.wx -= 2.5 * iy / R;
    ball.wy += 2.5 * ix / R;
  } else {
    const speed = Math.hypot(ball.vx, ball.vy);
    const scale = speed > 0 ? Math.max(0, speed - ROLLING_FRICTION * dt) / speed : 0;
    ball.vx *= scale;
    ball.vy *= scale;
    ball.wx = -ball.vy / R;
    ball.wy = ball.vx / R;
  }
  ball.wz *= Math.exp(-1.15 * dt);
  if (Math.hypot(ball.vx, ball.vy) < 0.8 && slip < 2) {
    ball.vx = ball.vy = ball.wx = ball.wy = 0;
  }
}

function collideBalls(a, b, events) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= R * 2 || distance < EPSILON) return;
  const nx = dx / distance, ny = dy / distance;
  const correction = (2 * R - distance + 0.001) / 2;
  a.x -= correction * nx; a.y -= correction * ny;
  b.x += correction * nx; b.y += correction * ny;
  const normalSpeed = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (normalSpeed >= 0) return;
  const impulse = -(1 + BALL_RESTITUTION) * normalSpeed / 2;
  a.vx -= impulse * nx; a.vy -= impulse * ny;
  b.vx += impulse * nx; b.vy += impulse * ny;
  const tx = -ny, ty = nx;
  const tangentialSpeed = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty - R * (a.wz + b.wz);
  const friction = Math.max(-impulse * 0.045, Math.min(impulse * 0.045, -tangentialSpeed / 7));
  a.vx -= friction * tx; a.vy -= friction * ty;
  b.vx += friction * tx; b.vy += friction * ty;
  a.wz -= 2.5 * friction / R;
  b.wz -= 2.5 * friction / R;
  events.push({ type: 'collision', a: a.id, b: b.id, strength: impulse });
}

function cushion(ball, nx, ny, events) {
  const speed = ball.vx * nx + ball.vy * ny;
  if (speed >= 0) return;
  const normalImpulse = -(1 + CUSHION_RESTITUTION) * speed;
  const tx = -ny, ty = nx;
  const slip = ball.vx * tx + ball.vy * ty - ball.wz * R;
  const friction = Math.max(-normalImpulse * 0.17, Math.min(normalImpulse * 0.17, -slip / 3.5));
  ball.vx += normalImpulse * nx + friction * tx;
  ball.vy += normalImpulse * ny + friction * ty;
  ball.wz -= 2.5 * friction / R;
  events.push({ type: 'cushion', ball: ball.id, strength: -speed });
}

function railsAndPockets(ball, events) {
  for (const pocket of POCKETS) {
    if (Math.hypot(ball.x - pocket.x, ball.y - pocket.y) < TABLE.pocketRadius) {
      ball.pocketed = true;
      ball.vx = ball.vy = ball.wx = ball.wy = ball.wz = 0;
      events.push({ type: 'pocket', ball: ball.id });
      return;
    }
  }
  const { left, right, top, bottom } = TABLE;
  const onVertical = ball.y > top + 31 && ball.y < bottom - 31;
  const onHorizontal = ball.x > left + 31 && ball.x < right - 31 && Math.abs(ball.x - 600) > 29;
  if (onVertical && ball.x < left + R) { ball.x = left + R; cushion(ball, 1, 0, events); }
  if (onVertical && ball.x > right - R) { ball.x = right - R; cushion(ball, -1, 0, events); }
  if (onHorizontal && ball.y < top + R) { ball.y = top + R; cushion(ball, 0, 1, events); }
  if (onHorizontal && ball.y > bottom - R) { ball.y = bottom - R; cushion(ball, 0, -1, events); }
  // Rounded pocket jaws make a glancing shot rattle rather than clipping a rail.
  const jaws = [
    [left + 31, top], [left, top + 31], [571, top], [629, top],
    [right - 31, top], [right, top + 31],
    [left + 31, bottom], [left, bottom - 31], [571, bottom], [629, bottom],
    [right - 31, bottom], [right, bottom - 31],
  ];
  for (const [x, y] of jaws) {
    const dx = ball.x - x, dy = ball.y - y, distance = Math.hypot(dx, dy);
    if (distance < R + 3 && distance > EPSILON) {
      const nx = dx / distance, ny = dy / distance;
      ball.x = x + nx * (R + 3); ball.y = y + ny * (R + 3);
      cushion(ball, nx, ny, events);
    }
  }
  // A ball crossing the cloth through a pocket mouth drops into that pocket.
  if (ball.x < left - R || ball.x > right + R || ball.y < top - R || ball.y > bottom + R) {
    ball.pocketed = true;
    ball.vx = ball.vy = ball.wx = ball.wy = ball.wz = 0;
    events.push({ type: 'pocket', ball: ball.id });
  }
}

export function stepPhysics(balls, dt) {
  const events = [];
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const substep = dt / steps;
  for (let s = 0; s < steps; s++) {
    for (const ball of balls) {
      if (ball.pocketed) continue;
      cloth(ball, substep);
      ball.x += ball.vx * substep;
      ball.y += ball.vy * substep;
      railsAndPockets(ball, events);
    }
    for (let i = 0; i < balls.length; i++) {
      if (balls[i].pocketed) continue;
      for (let j = i + 1; j < balls.length; j++) {
        if (!balls[j].pocketed) collideBalls(balls[i], balls[j], events);
      }
    }
  }
  return events;
}

export function isMoving(balls) {
  return balls.some((b) => !b.pocketed && (Math.hypot(b.vx, b.vy) > 0.8 || Math.hypot(b.vx - R * b.wy, b.vy + R * b.wx) > 2));
}

export function validPlacement(balls, x, y) {
  const { left, right, top, bottom } = TABLE;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < left + R || x > right - R || y < top + R || y > bottom - R) return false;
  if (POCKETS.some((p) => Math.hypot(x - p.x, y - p.y) < TABLE.pocketRadius + R)) return false;
  return !balls.some((b) => b.id !== 0 && !b.pocketed && Math.hypot(x - b.x, y - b.y) < R * 2 + 0.5);
}

export function aimGuide(balls, angle) {
  const cue = balls.find((b) => b.id === 0);
  if (!cue || cue.pocketed) return null;
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let distance = 1400, hit = null;
  for (const b of balls) {
    if (b.id === 0 || b.pocketed) continue;
    const bx = b.x - cue.x, by = b.y - cue.y;
    const projection = bx * dx + by * dy;
    const perpendicularSq = bx * bx + by * by - projection * projection;
    if (projection > 0 && perpendicularSq <= (R * 2) ** 2) {
      const entry = projection - Math.sqrt(Math.max(0, (R * 2) ** 2 - perpendicularSq));
      if (entry >= 0 && entry < distance) { distance = entry; hit = b; }
    }
  }
  const candidates = [
    dx > 0 ? (TABLE.right - R - cue.x) / dx : dx < 0 ? (TABLE.left + R - cue.x) / dx : Infinity,
    dy > 0 ? (TABLE.bottom - R - cue.y) / dy : dy < 0 ? (TABLE.top + R - cue.y) / dy : Infinity,
  ];
  const rail = Math.min(...candidates.filter((d) => d >= 0));
  if (rail < distance) { distance = rail; hit = null; }
  return { x: cue.x + dx * distance, y: cue.y + dy * distance, hit };
}
