import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createPoolServer } from '../server.js';
import { createRack } from '../shared/physics.js';

// This harness owns its server. Fixtures stay in process; the production app
// has no debug routes or client-side authority over the balls or rules.
const app = createPoolServer();
await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${app.server.address().port}`;
const executablePath = process.env.BROWSER_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
let browser;
mkdirSync('test-results', { recursive: true });
const errors = [];
function watch(page) {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
}
const visible = (page, selector) => page.locator(selector).waitFor({ state: 'visible', timeout: 8000 });
const waitFor = async (predicate, ms = 20_000) => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > ms) throw new Error('Timed out waiting for server condition');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
async function clickCloth(page, x, y) {
  const box = await page.locator('#game-table').boundingBox();
  await page.mouse.click(box.x + x / 1200 * box.width, box.y + y / 700 * box.height);
}
async function setKeyboardPower(page, percent) {
  await page.locator('#power-control').focus();
  await page.keyboard.press('Home');
  for (let i = 1; i < percent; i += 5) await page.keyboard.press('ArrowDown');
}
function prepareBlack(room, player, early = false) {
  room.balls = createRack();
  if (!early) room.balls.filter((b) => b.color === player.color).forEach((b) => { b.pocketed = true; });
  Object.assign(room.balls[0], { x: 600, y: 210 });
  Object.assign(room.balls[8], { x: 600, y: 150 });
  room.turn = player.id; room.turnNumber++; room.ballInHand = null; room.moving = false; room.broadcast();
}

try {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const aContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const bContext = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const a = await aContext.newPage(), b = await bContext.newPage(); watch(a); watch(b);
  await a.goto(url); await visible(a, '#menu-screen');
  await a.screenshot({ path: 'test-results/desktop-menu.png', fullPage: true });
  await a.locator('.help-button').first().click(); await visible(a, '#rules-dialog[open]');
  await a.locator('#rules-done').click();
  await a.locator('#nickname').fill('Alex');
  await a.locator('#join-tab').click(); await a.locator('#room-code').fill('ZZZZZZ');
  await a.locator('#room-submit').click(); await visible(a, '#menu-error');
  assert.match(await a.locator('#menu-error').textContent(), /could not be found/);
  await a.locator('#create-tab').click(); await a.locator('#room-submit').click();
  await visible(a, '#lobby-screen');
  const code = await a.locator('#lobby-code').textContent(), room = app.rooms.get(code);
  assert.ok(room);
  await b.goto(`${url}/?room=${code}`);
  assert.equal(await b.locator('#room-code').inputValue(), code);
  await b.locator('#nickname').fill('Morgan'); await b.locator('#room-submit').click();
  await visible(b, '#lobby-screen');
  await waitFor(() => room.players.length === 2);
  const host = room.players[0], guest = room.players[1];
  await a.screenshot({ path: 'test-results/desktop-lobby.png', fullPage: true });
  await a.locator('#ready-button').click(); await b.locator('#ready-button').click();
  await visible(a, '#game-screen'); await visible(b, '#game-screen');
  assert.equal(await a.locator('#shoot-button').isEnabled(), true);
  assert.equal(await b.locator('#shoot-button').isEnabled(), false);
  await a.screenshot({ path: 'test-results/desktop-game.png', fullPage: true });
  // Drag the actual cue rather than just clicking an aim point.
  const canvas = await a.locator('#game-table').boundingBox();
  await a.mouse.move(canvas.x + 180 / 1200 * canvas.width, canvas.y + 350 / 700 * canvas.height);
  await a.mouse.down(); await a.mouse.move(canvas.x + 180 / 1200 * canvas.width, canvas.y + 365 / 700 * canvas.height, { steps: 4 }); await a.mouse.up();
  await waitFor(() => Math.abs(room.aim.angle) > .02);
  await clickCloth(a, 809, 350);
  const spin = await a.locator('#spin-control').boundingBox();
  await a.mouse.click(spin.x + spin.width * .65, spin.y + spin.height * .35);
  await waitFor(() => room.aim.top > .1 && room.aim.side > .1);
  await a.locator('#reset-spin').click();
  const power = await a.locator('#power-control').boundingBox();
  await a.mouse.move(power.x + power.width * .7, power.y + power.height * .12);
  await a.mouse.down(); await a.mouse.move(power.x + power.width * .7, power.y + power.height * .78, { steps: 12 }); await a.mouse.up();
  await waitFor(() => room.moving);
  assert.ok(room.aim.power > .8);
  await visible(b, '#turn-label');
  await waitFor(() => !room.moving);
  await a.reload(); await visible(a, '#game-screen');
  assert.equal(room.players[0].id, host.id);
  assert.ok(room.players.every((p) => p.connected));
  console.log('PASS create/join codes, nickname, lobby, readiness, cue drag, spin, pull-to-shoot, full break, reconnect');

  // A real, reproducible scratch into the middle pocket.
  room.balls = createRack(); Object.assign(room.balls[0], { x: 600, y: 135 });
  room.turn = host.id; room.turnNumber++; room.ballInHand = null; room.broadcast();
  await waitFor(() => room.turn === host.id); await a.waitForTimeout(100);
  await clickCloth(a, 600, 80); await setKeyboardPower(a, 16); await a.locator('#shoot-button').click();
  await waitFor(() => room.moving); await waitFor(() => !room.moving);
  assert.equal(room.ballInHand, guest.id);
  await b.waitForFunction(() => document.getElementById('table-message').hidden === false);
  assert.equal(await b.locator('#shoot-button').isEnabled(), false);
  await clickCloth(b, 809, 350); await visible(b, '#toast'); assert.equal(room.ballInHand, guest.id);
  await clickCloth(b, 335, 350); await waitFor(() => room.ballInHand === null);
  assert.equal(room.balls[0].pocketed, false);
  console.log('PASS scratch foul, turn change, ball in hand, illegal and legal placement');

  prepareBlack(room, host);
  await a.waitForTimeout(120); await clickCloth(a, 600, 80); await setKeyboardPower(a, 21);
  await a.locator('#shoot-button').click(); await waitFor(() => room.phase === 'finished');
  assert.equal(room.result.winner, host.id);
  await visible(a, '#result-dialog[open]'); await visible(b, '#result-dialog[open]');
  await a.screenshot({ path: 'test-results/desktop-result.png', fullPage: true });
  await a.locator('#rematch-button').click(); await b.locator('#rematch-button').click();
  await waitFor(() => room.phase === 'playing');
  assert.equal(room.turn, guest.id); assert.equal(guest.color, 'red');
  await a.waitForTimeout(100);
  assert.equal(await a.locator('#potted-balls .mini-ball').count(), 0);
  prepareBlack(room, guest, true);
  await b.waitForTimeout(100); await clickCloth(b, 600, 80); await setKeyboardPower(b, 21);
  await b.locator('#shoot-button').click(); await waitFor(() => room.phase === 'finished');
  assert.equal(room.result.winner, host.id);
  console.log('PASS legal black win, both-player rematch, colour swap, tray reset, early-black loss');

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mobile = await mobileContext.newPage(); watch(mobile); await mobile.goto(url);
  await mobile.screenshot({ path: 'test-results/mobile-menu.png', fullPage: true });
  await mobile.locator('#practice-button').click(); await visible(mobile, '#game-screen');
  await mobile.screenshot({ path: 'test-results/mobile-game.png', fullPage: true });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile should not overflow horizontally');
  await mobile.locator('#spin-control').tap({ position: { x: 35, y: 20 } });
  assert.notEqual(await mobile.locator('#spin-description').textContent(), 'Centre strike');
  await mobile.locator('#shoot-button').tap();
  await mobile.waitForFunction(() => document.getElementById('turn-label').textContent === 'BALLS IN MOTION');
  console.log('PASS mobile layout, solo practice, touch spin and shot');
  assert.deepEqual(errors, [], 'Browser should not have JavaScript or network errors');
  console.log('PASS no browser errors. Screenshots saved in test-results/.');
} finally {
  await browser?.close(); await app.close();
}
