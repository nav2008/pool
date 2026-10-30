import { randomBytes } from 'node:crypto';
import { createRack, strike, stepPhysics, isMoving, validPlacement } from '../shared/physics.js';
import { remaining, resolveShot } from '../shared/rules.js';

export const cleanName = (name) => typeof name === 'string' ? name.replace(/[\p{Cc}\p{Cf}<>]/gu, '').trim().slice(0, 20) || 'Guest' : 'Guest';
const round = (n) => Math.round(n * 100) / 100;

export class Match {
  constructor(code, practice = false) {
    this.code = code;
    this.practice = practice;
    this.players = [];
    this.balls = createRack();
    this.phase = 'lobby';
    this.turn = null;
    this.turnNumber = 0;
    this.visitsRemaining = 1;
    this.ballInHand = null;
    this.moving = false;
    this.shot = null;
    this.result = null;
    this.aim = { angle: 0, power: 0.5, side: 0, top: 0 };
    this.feed = [];
    this.updatedAt = Date.now();
    this.eventId = 0;
    this.frame = 0;
    this.pendingEvents = [];
  }

  addPlayer(name, socket) {
    if (this.players.length >= (this.practice ? 1 : 2)) throw new Error('This table already has two players. Create a new room to play.');
    if (this.phase !== 'lobby') throw new Error('This match has already started.');
    const player = {
      id: randomBytes(8).toString('hex'), token: randomBytes(24).toString('hex'),
      name: cleanName(name), color: this.players.length === 0 ? 'red' : 'yellow',
      ready: false, connected: true, rematch: false, socket, disconnectedAt: null,
    };
    this.players.push(player);
    this.updatedAt = Date.now();
    return player;
  }

  note(text, kind = 'info') {
    this.feed.push({ id: ++this.eventId, text, kind });
    this.feed = this.feed.slice(-8);
  }

  send(socket, data) {
    if (socket?.readyState === 1 && socket.bufferedAmount < 256_000) socket.send(JSON.stringify(data));
  }

  snapshot() {
    return {
      code: this.code, practice: this.practice, phase: this.phase,
      players: this.players.map(({ id, name, color, ready, connected, rematch }) => ({ id, name, color, ready, connected, rematch })),
      balls: this.balls.map(({ id, color, x, y, vx, vy, wz, pocketed }) => ({ id, color, x: round(x), y: round(y), vx: round(vx), vy: round(vy), wz: round(wz), pocketed })),
      turn: this.turn, turnNumber: this.turnNumber, visitsRemaining: this.visitsRemaining, ballInHand: this.ballInHand,
      moving: this.moving, aim: this.aim, result: this.result, feed: this.feed,
      shotId: this.shot?.id ?? this.lastShotId ?? 0, frame: ++this.frame,
    };
  }

  broadcast() {
    this.updatedAt = Date.now();
    const packet = { type: 'state', state: this.snapshot(), events: this.pendingEvents.splice(0) };
    for (const p of this.players) this.send(p.socket, packet);
  }

  ready(player) {
    if (this.phase !== 'lobby') return;
    player.ready = !player.ready;
    if (this.players.length === (this.practice ? 1 : 2) && this.players.every((p) => p.ready && p.connected)) this.start();
    this.broadcast();
  }

  start() {
    this.balls = createRack();
    this.phase = 'playing';
    this.turn = this.players[0].id;
    this.turnNumber = 1;
    this.visitsRemaining = 1;
    this.ballInHand = null;
    this.moving = false;
    this.shot = null;
    this.result = null;
    this.aim = { angle: 0, power: 0.5, side: 0, top: 0 };
    this.feed = [];
    this.players.forEach((p) => { p.rematch = false; });
    this.note(this.practice ? 'Your table, your pace. Reds first, then the black.' : `${this.players[0].name} breaks. Reds and yellows are assigned.`);
  }

  requireTurn(player) {
    if (this.phase !== 'playing') throw new Error('The match is not in play.');
    if (this.turn !== player.id) throw new Error('Wait for your turn.');
    if (this.moving) throw new Error('Wait for the balls to settle.');
    if (this.players.some((p) => !p.connected)) throw new Error('Your opponent is reconnecting. The table is paused.');
  }

  setAim(player, data) {
    this.requireTurn(player);
    if (this.ballInHand) return;
    this.aim = readAim(data);
    // Aim updates are coalesced by the normal broadcast timer.
    this.aimDirty = true;
  }

  place(player, x, y) {
    this.requireTurn(player);
    if (this.ballInHand !== player.id) throw new Error('The cue ball cannot be moved during this turn.');
    if (!validPlacement(this.balls, x, y)) throw new Error('Place the cue ball on open cloth, away from pockets and other balls.');
    const cue = this.balls.find((b) => b.id === 0);
    Object.assign(cue, { x, y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, pocketed: false });
    this.ballInHand = null;
    this.note(`${player.name} placed the cue ball.`);
    this.broadcast();
  }

  shoot(player, data) {
    this.requireTurn(player);
    if (this.ballInHand) throw new Error('Place the cue ball before shooting.');
    const aim = readAim(data);
    const spinLength = Math.hypot(aim.side, aim.top);
    if (spinLength > 1) { aim.side /= spinLength; aim.top /= spinLength; }
    this.aim = aim;
    this.shot = {
      id: (this.lastShotId ?? 0) + 1, playerId: player.id,
      onBlack: remaining(this.balls, player.color) === 0,
      firstHit: null, pocketed: [], railAfterContact: false, elapsed: 0,
    };
    this.lastShotId = this.shot.id;
    strike(this.balls, aim.angle, aim.power, aim.side, aim.top);
    this.moving = true;
    this.pendingEvents.push({ type: 'strike', power: aim.power });
    this.broadcast();
  }

  step(dt) {
    if (!this.moving || this.phase !== 'playing') return;
    const events = stepPhysics(this.balls, dt);
    for (const event of events) {
      if (event.type === 'collision' && this.shot.firstHit == null && (event.a === 0 || event.b === 0)) this.shot.firstHit = event.a === 0 ? event.b : event.a;
      if (event.type === 'pocket') this.shot.pocketed.push(event.ball);
      if (event.type === 'cushion' && this.shot.firstHit != null) this.shot.railAfterContact = true;
    }
    this.pendingEvents.push(...events.filter((e) => e.type === 'pocket' || e.strength > 30).slice(0, 16));
    this.pendingEvents = this.pendingEvents.slice(-40);
    this.shot.elapsed += dt;
    if (!isMoving(this.balls)) this.finishShot();
  }

  finishShot() {
    const player = this.players.find((p) => p.id === this.shot.playerId);
    const outcome = resolveShot({ balls: this.balls, color: player.color, ...this.shot });
    this.moving = false;
    for (const b of this.balls) b.vx = b.vy = b.wx = b.wy = b.wz = 0;
    if (outcome.result) {
      const other = this.players.find((p) => p.id !== player.id);
      this.phase = 'finished';
      this.result = { winner: outcome.result === 'win' ? player.id : other?.id ?? null, loser: outcome.result === 'loss' ? player.id : other?.id ?? null, reason: outcome.reason };
      this.note(outcome.result === 'win' ? `${player.name} wins the frame.` : `${player.name} potted the black too early.`, outcome.result === 'win' ? 'success' : 'foul');
    } else {
      this.turnNumber++;
      this.aim = { ...this.aim, side: 0, top: 0 };
      this.ballInHand = null;
      if (outcome.foul) {
        // A foul forfeits every remaining visit; awards never accumulate.
        this.turn = this.players.find((p) => p.id !== player.id)?.id ?? player.id;
        this.visitsRemaining = 2;
        const scratch = this.shot.pocketed.includes(0);
        if (scratch) {
          this.ballInHand = this.turn;
          this.balls.find((b) => b.id === 0).pocketed = true;
        }
        this.note(`Foul · ${outcome.foul} Two visits awarded.${scratch ? ' Place the white.' : ' Play the white where it rests.'}`, 'foul');
      } else if (outcome.keepTurn) {
        this.note(`${player.name} potted ${this.shot.pocketed.filter((id) => this.balls.find((b) => b.id === id)?.color === player.color).length} ${player.color}. Shoot again.`, 'success');
      } else if (this.visitsRemaining > 1) {
        this.visitsRemaining--;
        this.note(`${player.name} has one visit remaining. Shoot again.`);
      } else {
        this.turn = this.players.find((p) => p.id !== player.id)?.id ?? player.id;
        this.visitsRemaining = 1;
        this.note(`${this.players.find((p) => p.id === this.turn).name} is at the table.`);
      }
    }
    this.shot = null;
    this.broadcast();
  }

  requestRematch(player) {
    if (this.phase !== 'finished') throw new Error('Finish this frame first.');
    player.rematch = true;
    if (this.players.length === (this.practice ? 1 : 2) && this.players.every((p) => p.rematch && p.connected)) {
      if (!this.practice) {
        this.players.reverse();
        this.players[0].color = 'red'; this.players[1].color = 'yellow';
      }
      this.start();
    }
    this.broadcast();
  }
}

function readAim(data) {
  if (![data.angle, data.power, data.side, data.top].every((n) => typeof n === 'number' && Number.isFinite(n))) throw new Error('Invalid shot.');
  return {
    angle: Math.atan2(Math.sin(data.angle), Math.cos(data.angle)),
    power: Math.max(0.01, Math.min(1, data.power)),
    side: Math.max(-1, Math.min(1, data.side)), top: Math.max(-1, Math.min(1, data.top)),
  };
}
