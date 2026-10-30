import { TABLE, validPlacement } from '/shared/physics.js';
import { TableRenderer, drawPreview, drawSpin } from './table.js';
import { PoolSound } from './sound.js';

const $ = (id) => document.getElementById(id);
const sound = new PoolSound();
const renderer = new TableRenderer($('game-table'));
let socket, reconnectTimer, reconnectAttempt = 0, connected = false;
let session = null, state = null, playerId = null, tab = 'create';
let angle = 0, power = .5, side = 0, top = 0, pull = 0;
let aimDragging = false, cueDrag = false, powerDragging = false, spinDragging = false;
let guide = true, lastAimSent = 0, lastTurnKey = '', lastFeedId = 0, lastRosterKey = '', lastTrayKey = null;
let placementPointer = { x: 335, y: 350, valid: true }, pendingAction = null, actionTimeout, toastTimer;
let resultDismissed = false, powerStartY = null;

try { $('nickname').value = localStorage.getItem('sidespin-nickname') || ''; } catch { /* storage optional */ }
try { session = JSON.parse(sessionStorage.getItem('sidespin-seat')); } catch { /* storage optional */ }

drawPreview($('preview-table'));
drawSpin($('spin-control'), 0, 0, true);

const escapeText = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const me = () => state?.players.find((p) => p.id === playerId);
const isMyTurn = () => connected && state?.phase === 'playing' && state.turn === playerId && !state.moving && state.players.every((p) => p.connected);
const canShoot = () => isMyTurn() && !state.ballInHand;
const hasPlacement = () => isMyTurn() && state.ballInHand === playerId;
const send = (data) => { if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(data)); return true; } return false; };

function showScreen(name) {
  for (const screen of document.querySelectorAll('.screen')) screen.hidden = screen.id !== `${name}-screen`;
  document.body.dataset.screen = name;
  document.title = name === 'menu' ? 'Sidespin — A little friendly competition.' : `${state?.practice ? 'Practice table' : 'Room ' + (state?.code || '')} — Sidespin`;
}

function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3800);
}

function menuError(message) { $('menu-error').textContent = message; $('menu-error').hidden = false; }

function setBusy(busy) {
  $('room-submit').disabled = busy;
  $('practice-button').disabled = busy;
  $('room-submit').querySelector('span').textContent = busy ? 'Pulling up a table…' : tab === 'create' ? 'Create a room' : 'Join the table';
}

function connect() {
  clearTimeout(reconnectTimer);
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket.addEventListener('open', () => {
    connected = true; reconnectAttempt = 0;
    $('connection-status').innerHTML = '<span class="live-dot"></span> Ready when you are';
    if (session) send({ type: 'resume', ...session });
    else if (pendingAction) { send(pendingAction); pendingAction = null; }
    updateUI();
  });
  socket.addEventListener('message', ({ data }) => {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message.type === 'joined') {
      playerId = message.playerId;
      session = { code: message.code, token: message.token };
      try { sessionStorage.setItem('sidespin-seat', JSON.stringify(session)); } catch { /* storage optional */ }
      clearTimeout(actionTimeout); setBusy(false); $('menu-error').hidden = true;
      resultDismissed = false;
    } else if (message.type === 'state') {
      const before = state;
      state = message.state;
      renderer.setState(state, message.events);
      const turnKey = `${state.turn}-${state.turnNumber}-${state.phase}`;
      if (turnKey !== lastTurnKey) {
        lastTurnKey = turnKey; powerDragging = false; pull = 0;
        if (!state.moving) { angle = state.aim.angle; side = 0; top = 0; }
        if (state.ballInHand === playerId) {
          placementPointer = findOpenPlacement();
        }
      }
      if (state.turn !== playerId || state.moving) {
        angle = state.aim.angle; power = state.aim.power; side = state.aim.side; top = state.aim.top;
      }
      if (before?.phase === 'finished' && state.phase === 'playing') {
        $('result-dialog').close(); resultDismissed = false; lastFeedId = 0; lastRosterKey = ''; lastTrayKey = null;
      }
      if (state.feed.length && state.feed.at(-1).id !== lastFeedId) {
        lastFeedId = state.feed.at(-1).id;
        const feedback = state.feed.at(-1);
        $('shot-feedback').classList.toggle('foul', feedback.kind === 'foul');
        $('shot-feedback').lastElementChild.textContent = feedback.text;
      }
      for (const event of message.events || []) sound.play(event);
      if (before?.code === state.code && before.phase === 'playing' && state.phase === 'finished' && state.result?.winner === playerId) {
        sound.play({ type: 'win' });
      }
      updateUI();
    } else if (message.type === 'error') {
      clearTimeout(actionTimeout); setBusy(false);
      if (message.action === 'resume') {
        forgetSeat(); state = null; renderer.state = null; playerId = null;
        showScreen('menu'); menuError(message.message);
      } else if (['create', 'join', 'practice'].includes(message.action)) menuError(message.message);
      else toast(message.message);
      powerDragging = false; pull = 0;
      updateUI();
    }
  });
  socket.addEventListener('error', () => { /* close handles reconnect */ });
  socket.addEventListener('close', (event) => {
    connected = false;
    $('connection-status').innerHTML = '<span class="live-dot" style="background:#d99871"></span> Reconnecting…';
    powerDragging = false; aimDragging = false; pull = 0;
    updateUI();
    if (event.code === 4001) {
      forgetSeat(); state = null; playerId = null; showScreen('menu');
      menuError('This seat was opened in another connection. Create or join a new table.');
    }
    reconnectTimer = setTimeout(connect, Math.min(8000, 800 * 1.5 ** reconnectAttempt++));
  });
}

function forgetSeat() {
  session = null;
  try { sessionStorage.removeItem('sidespin-seat'); } catch { /* storage optional */ }
}

function findOpenPlacement() {
  for (let x = 335; x < 1050; x += 35) for (let y = 350; y < 560; y += 30) {
    if (validPlacement(state.balls, x, y)) return { x, y, valid: true };
  }
  return { x: 200, y: 200, valid: validPlacement(state.balls, 200, 200) };
}

function startAction(type) {
  sound.unlock();
  let name = $('nickname').value.trim();
  if (!name && type === 'practice') { name = 'Guest'; $('nickname').value = name; }
  if (!name) { $('nickname').reportValidity(); return; }
  try { localStorage.setItem('sidespin-nickname', name); } catch { /* storage optional */ }
  const action = { type, name };
  if (type === 'join') {
    const code = $('room-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) { menuError('Enter the 6-character code from your friend’s room.'); $('room-code').focus(); return; }
    action.code = code;
  }
  $('menu-error').hidden = true; setBusy(true);
  if (!send(action)) pendingAction = action;
  clearTimeout(actionTimeout);
  actionTimeout = setTimeout(() => {
    pendingAction = null; setBusy(false);
    menuError('The table is taking a little longer to connect. Please try again in a moment.');
  }, 18000);
}

function selectTab(value) {
  tab = value;
  for (const name of ['create', 'join']) {
    $(`${name}-tab`).setAttribute('aria-selected', String(value === name));
    $(`${name}-tab`).tabIndex = value === name ? 0 : -1;
    $(`${name}-panel`).hidden = value !== name;
  }
  $('room-code').required = value === 'join';
  $('menu-error').hidden = true; setBusy(false);
}

$('create-tab').addEventListener('click', () => selectTab('create'));
$('join-tab').addEventListener('click', () => selectTab('join'));
for (const el of [$('create-tab'), $('join-tab')]) el.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); selectTab(tab === 'create' ? 'join' : 'create'); $(`${tab}-tab`).focus(); }
});
$('room-code').addEventListener('input', () => { $('room-code').value = $('room-code').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('room-form').addEventListener('submit', (event) => { event.preventDefault(); startAction(tab); });
$('practice-button').addEventListener('click', () => startAction('practice'));
$('ready-button').addEventListener('click', () => { sound.unlock(); send({ type: 'ready' }); });

async function copy(value, label) {
  try { await navigator.clipboard.writeText(value); toast(label); }
  catch {
    // Clipboard API is unavailable on some HTTP hosts. Selection still lets
    // players copy with the normal platform shortcut without a prompt dialog.
    const input = document.createElement('textarea'); input.value = value;
    input.style.position = 'fixed'; input.style.opacity = '0'; document.body.append(input); input.select();
    const ok = document.execCommand('copy'); input.remove();
    toast(ok ? label : `Room code: ${state.code}`);
  }
}
$('copy-invite').addEventListener('click', () => copy(`${location.origin}/?room=${state.code}`, 'Invite copied. Send it to your friend.'));
$('game-code').addEventListener('click', () => { if (!state.practice) copy(state.code, 'Room code copied.'); });

function leaveTable() {
  send({ type: 'leave' }); forgetSeat(); state = null; playerId = null; renderer.state = null;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  powerDragging = false; aimDragging = false; pull = 0; side = 0; top = 0;
  lastRosterKey = ''; lastTrayKey = null; lastTurnKey = ''; lastFeedId = 0;
  history.replaceState({}, '', '/'); showScreen('menu'); setBusy(false);
}
function askLeave() {
  if (!state || state.phase !== 'playing' || state.practice) { leaveTable(); return; }
  $('leave-description').textContent = 'Leaving this match awards the frame to your opponent.';
  $('leave-dialog').showModal();
}
for (const el of document.querySelectorAll('.leave-button')) el.addEventListener('click', askLeave);
$('result-leave').addEventListener('click', leaveTable);
$('confirm-leave').addEventListener('click', leaveTable);
$('cancel-leave').addEventListener('click', () => $('leave-dialog').close());

for (const el of document.querySelectorAll('.help-button')) el.addEventListener('click', () => { if (!$('rules-dialog').open) $('rules-dialog').showModal(); });
$('rules-done').addEventListener('click', () => $('rules-dialog').close());
$('rules-dialog').querySelector('.modal-close').addEventListener('click', () => $('rules-dialog').close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', (event) => {
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
$('result-dialog').addEventListener('close', () => { resultDismissed = true; });
$('rematch-button').addEventListener('click', () => { sound.unlock(); send({ type: 'rematch' }); });

function updateSoundButton() {
  $('sound-toggle').setAttribute('aria-label', sound.enabled ? 'Mute sound' : 'Enable sound');
  $('sound-toggle').setAttribute('aria-pressed', String(!sound.enabled));
  $('sound-toggle').querySelector('use').setAttribute('href', sound.enabled ? '#i-sound' : '#i-mute');
}
$('sound-toggle').addEventListener('click', () => { sound.setEnabled(!sound.enabled); updateSoundButton(); });
updateSoundButton();

function updateUI() {
  if (!state || !playerId || !me()) return;
  if (state.phase === 'lobby') {
    showScreen('lobby');
    $('lobby-code').textContent = state.code;
    const seats = [...state.players];
    while (seats.length < 2) seats.push(null);
    const key = JSON.stringify(seats);
    if ($('lobby-seats').dataset.key !== key) {
      $('lobby-seats').dataset.key = key;
      $('lobby-seats').innerHTML = seats.map((p, index) => p ? `<div class="lobby-seat ${p.color}"><span class="seat-avatar">${escapeText(p.name[0].toUpperCase())}</span><span class="seat-ready">${p.ready ? '<svg><use href="#i-check"/></svg> READY' : p.connected ? 'AT THE TABLE' : 'RECONNECTING'}</span><h3>${escapeText(p.name)}${p.id === playerId ? '<small>YOU</small>' : ''}</h3><p>Playing ${p.color === 'red' ? 'reds · breaks first' : 'yellows'}</p></div>` : `<div class="lobby-seat empty yellow"><span class="seat-avatar">+</span><h3>A seat for your friend</h3><p>Waiting for player ${index + 1}…</p></div>`).join('');
    }
    const ready = me().ready;
    $('ready-button').querySelector('span').textContent = ready ? 'Ready. Click to unready.' : 'I’m ready';
    $('ready-button').disabled = !connected;
    $('lobby-status').textContent = !connected ? 'Reconnecting to your table…' : state.players.length < 2 ? 'Your seat is saved. Invite your opponent.' : state.players.some((p) => !p.connected) ? 'Your opponent is reconnecting…' : ready ? 'Waiting for your opponent to get ready…' : 'Your opponent is here. Ready when you are.';
    return;
  }
  showScreen('game');
  $('game-code').innerHTML = `${escapeText(state.practice ? 'SOLO' : state.code)} <svg><use href="#i-copy"/></svg>`;
  $('game-code').disabled = state.practice;
  $('game-mode').textContent = state.practice ? 'PRACTICE TABLE' : 'PRIVATE MATCH';
  const ordered = [me(), state.players.find((p) => p.id !== playerId)];
  const rosterKey = JSON.stringify([ordered, state.turn, state.balls.filter((b) => b.pocketed).map((b) => b.id)]);
  if (lastRosterKey !== rosterKey) {
    lastRosterKey = rosterKey;
    ordered.forEach((p, index) => {
      const el = $(index ? 'player-two' : 'player-one');
      if (!p) {
        el.className = 'player-card opponent yellow';
        el.innerHTML = '<div class="player-identity"><span class="player-avatar">↗</span><div><div class="player-name">A little practice</div><div class="player-colour">No opponent. No rush.</div></div></div><div class="player-balls"><span class="balls-count">REDS → BLACK → GLORY</span></div>';
        return;
      }
      const group = state.balls.filter((b) => b.color === p.color), left = group.filter((b) => !b.pocketed).length;
      el.className = `player-card ${p.color} ${state.turn === p.id && state.phase === 'playing' ? 'active' : ''} ${index ? 'opponent' : ''}`;
      el.innerHTML = `<div class="player-identity"><span class="player-avatar">${escapeText(p.name[0].toUpperCase())}</span><div><div class="player-name"><span>${escapeText(p.name)}</span>${p.id === playerId ? '<span class="you-label">YOU</span>' : ''}</div><div class="player-colour">${!p.connected ? 'Reconnecting…' : left ? 'Playing ' + (p.color === 'red' ? 'reds' : 'yellows') : 'On the black'}</div></div></div><div class="player-balls">${group.map((b) => `<span class="score-ball ${b.pocketed ? 'potted' : ''}" aria-label="${b.pocketed ? 'Potted' : 'Remaining'} ${p.color} ball"></span>`).join('')}<span class="balls-count">${left} left</span></div>`;
    });
  }
  const current = state.players.find((p) => p.id === state.turn), mine = state.turn === playerId;
  const targetBlack = state.balls.filter((b) => b.color === current?.color && !b.pocketed).length === 0;
  $('turn-label').textContent = state.phase === 'finished' ? 'FRAME COMPLETE' : state.moving ? 'BALLS IN MOTION' : mine ? 'YOUR TURN' : 'OPPONENT’S TURN';
  $('turn-title').textContent = state.phase === 'finished' ? 'That’s a frame.' : state.moving ? 'Watch it roll.' : state.ballInHand ? mine ? 'Ball in hand.' : 'A fresh angle.' : state.turnNumber === 1 ? mine ? 'Make your break.' : 'The opening break.' : mine ? targetBlack ? 'Bring it home.' : 'Make it count.' : `${current?.name || 'Opponent'} is up.`;
  $('turn-detail').textContent = state.phase === 'finished' ? 'Fancy another?' : state.ballInHand ? mine ? 'Click open cloth to place the white' : 'Your opponent is placing the white' : state.moving ? 'Let the table do the talking' : targetBlack ? 'Only the black stands between you and a win' : mine ? `You’re playing ${me().color === 'red' ? 'reds' : 'yellows'}` : `Playing ${current?.color === 'red' ? 'reds' : 'yellows'}`;
  if (state.phase === 'playing') $('turn-detail').textContent += ` · ${state.visitsRemaining ?? 1} ${(state.visitsRemaining ?? 1) === 1 ? 'visit' : 'visits'} remaining`;
  const paused = !connected || state.players.some((p) => !p.connected);
  $('paused-banner').hidden = !paused || state.phase === 'finished';
  $('paused-banner').querySelector('b').textContent = !connected ? 'Reconnecting to the table…' : 'Your opponent is reconnecting…';
  $('table-message').hidden = !hasPlacement();
  $('table-message').textContent = 'BALL IN HAND · Click to place the white';
  $('shoot-button').disabled = state.phase !== 'finished' && !canShoot();
  $('shoot-button').innerHTML = `${state.phase === 'finished' ? 'Result' : 'Shoot'}<svg><use href="#i-arrow"/></svg>`;
  $('power-control').setAttribute('aria-disabled', String(!canShoot()));
  $('spin-control').setAttribute('aria-disabled', String(!canShoot()));
  $('reset-spin').disabled = !canShoot();
  const tray = state.balls.filter((b) => b.pocketed && b.id !== 0);
  const trayKey = tray.map((b) => b.id).join(',');
  if (lastTrayKey !== trayKey) {
    lastTrayKey = trayKey;
    $('potted-balls').innerHTML = tray.map((b) => `<span class="mini-ball ${b.color}-ball" aria-label="Potted ${b.color} ball">${b.id === 8 ? '8' : ''}</span>`).join('');
  }
  $('potted-empty').hidden = tray.length > 0;
  updatePowerUI(); updateSpinUI();
  if (state.phase === 'finished') updateResult();
}

function updateResult() {
  const won = state.result.winner === playerId;
  const winner = state.players.find((p) => p.id === state.result.winner);
  $('result-eyebrow').textContent = state.practice ? 'PRACTICE FRAME COMPLETE' : won ? 'THE TABLE IS YOURS' : 'THERE’S ALWAYS THE NEXT FRAME';
  $('result-title').textContent = won ? 'Beautifully played.' : state.practice ? 'Rack ’em again?' : 'A good game.';
  $('result-description').textContent = `${winner ? (won ? 'You take' : winner.name + ' takes') + ' the frame. ' : ''}${state.result.reason}`;
  $('result-score').innerHTML = state.players.map((p) => `<div><span class="mini-ball ${p.color}-ball"></span><span>${escapeText(p.name)}</span><b>${7 - state.balls.filter((b) => b.color === p.color && !b.pocketed).length}/7</b></div>`).join('');
  const waiting = me().rematch;
  const absent = state.players.some((p) => !p.connected);
  $('rematch-button').disabled = waiting || !connected || absent;
  $('rematch-button').querySelector('span').textContent = absent ? 'Your opponent has left' : waiting ? 'Waiting for your opponent…' : state.practice ? 'Rack ’em again' : 'One more frame?';
  if (!$('result-dialog').open && !resultDismissed && !$('leave-dialog').open) $('result-dialog').showModal();
}

function updatePowerUI() {
  const value = Math.round(power * 100);
  $('power-number').innerHTML = `${value}<span>%</span>`;
  $('power-control').setAttribute('aria-valuenow', String(value));
  $('power-fill').style.height = `${value}%`;
  $('power-handle').style.top = `${Math.max(3, Math.min(97, value))}%`;
  $('power-hint').innerHTML = powerDragging ? 'NICE AND EASY<br><b>RELEASE TO SHOOT</b>' : 'PULL DOWN<br><b>RELEASE TO SHOOT</b>';
}

function updateSpinUI() {
  let labels = [];
  if (top > .12) labels.push('Follow'); else if (top < -.12) labels.push('Draw');
  if (side > .12) labels.push('right spin'); else if (side < -.12) labels.push('left spin');
  const text = labels.length ? labels.join(' + ') : 'Centre strike';
  $('spin-description').textContent = text;
  $('spin-control').setAttribute('aria-valuenow', String(Math.round(side * 100)));
  $('spin-control').setAttribute('aria-valuetext', `${text}; side ${Math.round(side * 100)}%, top ${Math.round(top * 100)}%`);
  drawSpin($('spin-control'), side, top, canShoot());
}

function broadcastAim(force = false) {
  if (!canShoot() || (!force && performance.now() - lastAimSent < 60)) return;
  lastAimSent = performance.now(); send({ type: 'aim', angle, power, side, top });
}

function shoot() {
  if (state?.phase === 'finished') { resultDismissed = false; updateResult(); return; }
  if (!canShoot()) return;
  sound.unlock();
  send({ type: 'shoot', angle, power, side, top });
  // Prevent duplicate shots between release and the authoritative response.
  state.moving = true; pull = 0; powerDragging = false; updateUI();
}

const table = $('game-table');
table.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  sound.unlock();
  const point = renderer.point(event);
  if (hasPlacement()) {
    placementPointer = { ...point, valid: validPlacement(state.balls, point.x, point.y) };
    if (placementPointer.valid) send({ type: 'place', x: point.x, y: point.y });
    else toast('Find a little open cloth, away from other balls and pockets.');
    return;
  }
  if (!canShoot()) return;
  const cue = state.balls.find((b) => b.id === 0);
  const dx = point.x - cue.x, dy = point.y - cue.y;
  const along = dx * Math.cos(angle) + dy * Math.sin(angle);
  const across = -dx * Math.sin(angle) + dy * Math.cos(angle);
  cueDrag = along < -TABLE.radius && along > -370 && Math.abs(across) < 28;
  if (Math.hypot(dx, dy) < 16) return;
  aimDragging = true; table.setPointerCapture(event.pointerId);
  angle = Math.atan2(dy, dx) + (cueDrag ? Math.PI : 0); broadcastAim(true);
  event.preventDefault();
});
table.addEventListener('pointermove', (event) => {
  const point = renderer.point(event);
  if (hasPlacement()) placementPointer = { ...point, valid: validPlacement(state.balls, point.x, point.y) };
  if (!aimDragging || !canShoot()) return;
  const cue = state.balls.find((b) => b.id === 0);
  if (Math.hypot(point.x - cue.x, point.y - cue.y) < 16) return;
  angle = Math.atan2(point.y - cue.y, point.x - cue.x) + (cueDrag ? Math.PI : 0);
  broadcastAim();
});
function stopAim() { if (aimDragging) broadcastAim(true); aimDragging = false; }
table.addEventListener('pointerup', stopAim); table.addEventListener('pointercancel', stopAim);
table.addEventListener('keydown', (event) => {
  if (!canShoot()) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault(); angle += (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? .0015 : .009); broadcastAim(true);
  } else if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) shoot(); }
});

const powerControl = $('power-control');
powerControl.addEventListener('pointerdown', (event) => {
  if (!canShoot() || event.button !== 0) return;
  sound.unlock(); event.preventDefault();
  powerDragging = true; powerStartY = event.clientY;
  power = .01; pull = .01; powerControl.setPointerCapture(event.pointerId); updatePowerUI();
});
powerControl.addEventListener('pointermove', (event) => {
  if (!powerDragging || !canShoot()) return;
  const rect = powerControl.getBoundingClientRect();
  // A relative pull lets the player grab the handle wherever it currently sits.
  const travel = Math.max(40, rect.height * .7);
  power = Math.max(.01, Math.min(1, (event.clientY - powerStartY) / travel));
  pull = power; updatePowerUI(); broadcastAim();
});
powerControl.addEventListener('pointerup', () => {
  if (!powerDragging) return;
  const pulled = power > .025;
  powerDragging = false; pull = 0;
  if (pulled) shoot();
  updatePowerUI();
});
powerControl.addEventListener('pointercancel', () => { powerDragging = false; pull = 0; updatePowerUI(); });
powerControl.addEventListener('keydown', (event) => {
  if (!canShoot()) return;
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    power = event.key === 'Home' ? .01 : event.key === 'End' ? 1 : Math.max(.01, Math.min(1, power + (event.key === 'ArrowDown' ? .05 : -.05)));
    updatePowerUI(); broadcastAim(true);
  } else if (event.code === 'Space' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat) shoot(); }
});
$('shoot-button').addEventListener('click', shoot);

function spinPoint(event) {
  const rect = $('spin-control').getBoundingClientRect();
  side = ((event.clientX - rect.left) / rect.width * 180 - 90) / 48;
  top = -((event.clientY - rect.top) / rect.height * 180 - 90) / 48;
  const length = Math.hypot(side, top);
  if (length > 1) { side /= length; top /= length; }
  updateSpinUI(); broadcastAim();
}
$('spin-control').addEventListener('pointerdown', (event) => {
  if (!canShoot() || event.button !== 0) return;
  event.preventDefault(); spinDragging = true; $('spin-control').setPointerCapture(event.pointerId); spinPoint(event);
});
$('spin-control').addEventListener('pointermove', (event) => { if (spinDragging && canShoot()) spinPoint(event); });
$('spin-control').addEventListener('pointerup', () => { spinDragging = false; broadcastAim(true); });
$('spin-control').addEventListener('pointercancel', () => { spinDragging = false; });
$('spin-control').addEventListener('keydown', (event) => {
  if (!canShoot()) return;
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Home') side = top = 0;
  if (event.key === 'ArrowLeft') side -= .1;
  if (event.key === 'ArrowRight') side += .1;
  if (event.key === 'ArrowUp') top += .1;
  if (event.key === 'ArrowDown') top -= .1;
  const length = Math.hypot(side, top);
  if (length > 1) { side /= length; top /= length; }
  updateSpinUI(); broadcastAim(true);
});
$('reset-spin').addEventListener('click', () => { if (!canShoot()) return; side = top = 0; updateSpinUI(); broadcastAim(true); });
$('guide-toggle').addEventListener('click', () => { guide = !guide; $('guide-toggle').setAttribute('aria-pressed', String(guide)); });

function animate() {
  if (!$('game-screen').hidden && state) {
    renderer.render({ angle, pull, myTurn: isMyTurn(), guide, color: state.players.find((p) => p.id === state.turn)?.color || 'red', placement: hasPlacement(), pointer: placementPointer, spin: { side, top } });
  }
  requestAnimationFrame(animate);
}

const inviteCode = new URLSearchParams(location.search).get('room');
if (inviteCode) { selectTab('join'); $('room-code').value = inviteCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }
showScreen('menu'); connect(); animate(); updatePowerUI();
