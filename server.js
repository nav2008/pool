import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { Match } from './server/match.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export function createPoolServer() {
  const rooms = new Map();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ status: 'ok' }));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
    const shared = pathname.startsWith('/shared/');
    const base = path.join(ROOT, shared ? 'shared' : 'public');
    const requested = shared ? pathname.slice(8) : pathname === '/' ? 'index.html' : pathname.slice(1);
    const target = path.resolve(base, requested);
    if (!target.startsWith(base + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    try {
      const body = await readFile(target);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (req, socket, head) => {
    // Browsers may only open same-origin game sockets. Non-browser clients can
    // omit Origin, which is useful for monitoring and integration tests.
    let validOrigin = true;
    if (req.headers.origin) {
      try { validOrigin = new URL(req.headers.origin).host === req.headers.host; } catch { validOrigin = false; }
    }
    if (req.url !== '/ws' || !validOrigin || wss.clients.size >= 1000) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const send = (ws, message) => { if (ws.readyState === 1) ws.send(JSON.stringify(message)); };
  function leave(ws, intentional = false) {
    const room = ws.room;
    const player = room?.players.find((p) => p.socket === ws);
    if (!player) return;
    ws.room = null;
    player.socket = null;
    player.connected = false;
    player.disconnectedAt = Date.now();
    if (intentional || room.practice) expirePlayer(room, player);
    else room.broadcast();
  }

  function expirePlayer(room, player) {
    if (room.phase === 'lobby') {
      room.players = room.players.filter((p) => p !== player);
      if (room.players[0]) { room.players[0].color = 'red'; room.players[0].ready = false; }
    } else if (room.phase === 'playing') {
      room.phase = 'finished'; room.moving = false;
      room.balls.forEach((b) => { b.vx = b.vy = b.wx = b.wy = b.wz = 0; });
      room.result = { winner: room.players.find((p) => p !== player)?.id ?? null, loser: player.id, reason: `${player.name} left the table.` };
      room.note(`${player.name} left the table.`, 'info');
    }
    if (!room.players.some((p) => p.connected)) rooms.delete(room.code);
    else room.broadcast();
  }

  wss.on('connection', (ws) => {
    ws.alive = true;
    ws.rateStart = Date.now(); ws.messageCount = 0;
    ws.on('pong', () => { ws.alive = true; });
    send(ws, { type: 'hello' });
    ws.on('error', () => {});
    ws.on('message', (raw, binary) => {
      if (binary) return ws.close(1003, 'Text messages only');
      if (Date.now() - ws.rateStart > 1000) { ws.rateStart = Date.now(); ws.messageCount = 0; }
      if (++ws.messageCount > 100) return ws.close(1008, 'Too many messages');
      try {
        const msg = JSON.parse(raw.toString());
        if (!msg || typeof msg !== 'object') throw new Error('Invalid message.');
        if (msg.type === 'leave') { leave(ws, true); return send(ws, { type: 'left' }); }
        if (['create', 'join', 'practice', 'resume'].includes(msg.type)) {
          if (ws.room) throw new Error('Leave your current table first.');
          let room, player;
          if (msg.type === 'create' || msg.type === 'practice') {
            if (rooms.size >= 500) throw new Error('All tables are occupied. Try again shortly.');
            let key; do { key = code(); } while (rooms.has(key));
            room = new Match(key, msg.type === 'practice');
            player = room.addPlayer(msg.name, ws);
            rooms.set(key, room);
          } else {
            const key = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
            room = rooms.get(key);
            if (!room || (room.practice && msg.type !== 'resume')) throw new Error('That room could not be found. Check the code, or create a new table.');
            if (msg.type === 'resume') {
              const token = typeof msg.token === 'string' ? msg.token : '';
              player = room.players.find((p) => token.length === p.token.length && timingSafeEqual(Buffer.from(token), Buffer.from(p.token)));
              if (!player) throw new Error('Your seat has expired. Join or create a new table.');
              if (player.disconnectedAt && Date.now() - player.disconnectedAt >= 90_000) throw new Error('Your seat has expired.');
              if (player.socket && player.socket !== ws) { player.socket.room = null; player.socket.close(4001, 'Seat reconnected elsewhere'); }
              player.socket = ws; player.connected = true; player.disconnectedAt = null;
            } else player = room.addPlayer(msg.name, ws);
          }
          ws.room = room;
          send(ws, { type: 'joined', playerId: player.id, token: player.token, code: room.code });
          if (room.practice && room.phase === 'lobby') { player.ready = true; room.start(); }
          room.broadcast();
          return;
        }
        const room = ws.room;
        const player = room?.players.find((p) => p.socket === ws);
        if (!player) throw new Error('Join a table first.');
        if (msg.type === 'ready') room.ready(player);
        else if (msg.type === 'aim') room.setAim(player, msg);
        else if (msg.type === 'shoot') room.shoot(player, msg);
        else if (msg.type === 'place') room.place(player, msg.x, msg.y);
        else if (msg.type === 'rematch') room.requestRematch(player);
        else throw new Error('Unknown game action.');
      } catch (error) {
        send(ws, { type: 'error', message: error.message, action: (() => { try { return JSON.parse(raw).type; } catch { return ''; } })() });
      }
    });
    ws.on('close', () => leave(ws));
  });

  let tick = 0;
  const simulation = setInterval(() => {
    tick++;
    for (const room of rooms.values()) {
      room.step(1 / 60);
      if (tick % 2 === 0 && (room.moving || room.aimDirty)) { room.aimDirty = false; room.broadcast(); }
    }
  }, 1000 / 60);
  const maintenance = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
    }
    for (const room of rooms.values()) {
      for (const p of [...room.players]) {
        if (!p.connected && p.disconnectedAt && Date.now() - p.disconnectedAt >= 90_000) {
          expirePlayer(room, p); p.disconnectedAt = null;
        }
      }
      if (Date.now() - room.updatedAt > 2 * 60 * 60 * 1000) {
        for (const p of room.players) p.socket?.close(4000, 'Table expired after two hours of inactivity');
        rooms.delete(room.code);
      }
    }
  }, 15_000);

  return {
    server, rooms, wss,
    close: () => new Promise((resolve) => {
      clearInterval(simulation); clearInterval(maintenance);
      for (const ws of wss.clients) ws.terminate();
      wss.close(); server.close(resolve);
    }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createPoolServer();
  const port = Number(process.env.PORT) || 3000;
  app.server.listen(port, '0.0.0.0', () => console.log(`Sidespin is listening on port ${port}`));
  const shutdown = () => app.close().then(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
