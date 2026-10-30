import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createPoolServer } from '../server.js';

async function client(url) {
  const ws = new WebSocket(url); const messages = [], waiters = [];
  ws.on('message', (raw) => {
    const data = JSON.parse(raw); messages.push(data);
    for (const waiter of [...waiters]) if (waiter.predicate(data)) {
      clearTimeout(waiter.timer); waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(data);
    }
  });
  const next = (predicate) => new Promise((resolve, reject) => {
    const existing = messages.find(predicate);
    if (existing) return resolve(existing);
    const waiter = { predicate, resolve, timer: setTimeout(() => reject(new Error('Message timeout')), 4000) }; waiters.push(waiter);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return { ws, messages, next, send: (data) => ws.send(JSON.stringify(data)), clear: () => { messages.length = 0; } };
}

test('HTTP, two-player rooms, privacy, capacity, readiness, reconnect and authoritative shots', async (t) => {
  const app = createPoolServer();
  t.after(() => app.close());
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  assert.deepEqual(await (await fetch(base + '/health')).json(), { status: 'ok' });
  const page = await fetch(base);
  assert.equal(page.status, 200); assert.match(await page.text(), /Sidespin/);
  assert.equal((await fetch(base + '/server.js')).status, 404);
  assert.equal((await fetch(base + '/shared/physics.js')).status, 200);
  const url = base.replace('http:', 'ws:') + '/ws';
  const a = await client(url), b = await client(url), outsider = await client(url);
  a.send({ type: 'create', name: '<Alex>' });
  const seatA = await a.next((m) => m.type === 'joined');
  b.send({ type: 'join', code: seatA.code.toLowerCase(), name: 'Sam' });
  const seatB = await b.next((m) => m.type === 'joined');
  const lobby = await b.next((m) => m.type === 'state' && m.state.players.length === 2);
  assert.equal(lobby.state.players[0].name, 'Alex');
  assert.ok(!JSON.stringify(lobby).includes(seatA.token));
  assert.deepEqual(lobby.state.players.map((p) => p.color), ['red', 'yellow']);
  outsider.send({ type: 'join', code: seatA.code, name: 'Third' });
  assert.match((await outsider.next((m) => m.type === 'error')).message, /two players/);
  a.send({ type: 'ready' }); b.send({ type: 'ready' });
  await a.next((m) => m.type === 'state' && m.state.phase === 'playing');
  b.send({ type: 'shoot', angle: 0, power: .4, side: 0, top: 0 });
  assert.match((await b.next((m) => m.type === 'error')).message, /turn/);
  a.send({ type: 'shoot', angle: 0, power: .8, side: .3, top: .3 });
  const movingA = await a.next((m) => m.type === 'state' && m.state.moving);
  const movingB = await b.next((m) => m.type === 'state' && m.state.moving && m.state.frame === movingA.state.frame);
  assert.deepEqual(movingA.state.balls, movingB.state.balls);
  assert.equal(movingB.state.turn, seatA.playerId);
  b.ws.close();
  await a.next((m) => m.type === 'state' && m.state.players.some((p) => !p.connected));
  const reconnected = await client(url);
  reconnected.send({ type: 'resume', code: seatA.code, token: seatB.token });
  const resumed = await reconnected.next((m) => m.type === 'joined');
  assert.equal(resumed.playerId, seatB.playerId);
  await reconnected.next((m) => m.type === 'state' && m.state.players.every((p) => p.connected));
  reconnected.send({ type: 'leave' });
  const end = await a.next((m) => m.type === 'state' && m.state.phase === 'finished');
  assert.equal(end.state.result.winner, seatA.playerId);
});
