import { TABLE, POCKETS, createRack, aimGuide } from '/shared/physics.js';

const { width: W, height: H, radius: R } = TABLE;
let randomSeed = 83;
function random() { randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0; return randomSeed / 4294967296; }
const circle = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); };
const polygon = (ctx, points) => { ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); };

function makeTableArt() {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  // Walnut cabinet, with small variations in the longitudinal grain.
  ctx.save();
  ctx.shadowColor = '#0009'; ctx.shadowBlur = 13; ctx.shadowOffsetY = 9;
  const wood = ctx.createLinearGradient(0, 25, 0, 680);
  wood.addColorStop(0, '#63452e'); wood.addColorStop(.1, '#3d2c23'); wood.addColorStop(.55, '#624532'); wood.addColorStop(1, '#30251e');
  ctx.fillStyle = wood; ctx.beginPath(); ctx.roundRect(16, 31, 1168, 638, 44); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.save(); ctx.clip();
  for (let i = 0; i < 360; i++) {
    const y = random() * H;
    ctx.beginPath(); ctx.moveTo(0, y);
    ctx.bezierCurveTo(300, y + random() * 12, 650, y - random() * 16, W, y + random() * 7);
    ctx.strokeStyle = i % 3 === 0 ? '#c29a5a12' : '#100c091c'; ctx.lineWidth = random() * 2 + .2; ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath(); ctx.roundRect(23, 38, 1154, 623, 40); ctx.strokeStyle = '#bd926337'; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.roundRect(27, 42, 1146, 616, 37); ctx.strokeStyle = '#0c100c80'; ctx.lineWidth = 2; ctx.stroke();

  // The bed: subtle directional nap, fine woven cloth, and the overhead light.
  ctx.beginPath(); ctx.roundRect(58, 73, 1084, 554, 23); ctx.fillStyle = '#092e24'; ctx.fill();
  ctx.fillStyle = '#174e3d'; ctx.fillRect(70, 85, 1060, 530);
  const cloth = ctx.createRadialGradient(550, 270, 20, 600, 350, 680);
  cloth.addColorStop(0, '#236c50'); cloth.addColorStop(.6, '#1a5942'); cloth.addColorStop(1, '#104333');
  ctx.fillStyle = cloth; ctx.fillRect(70, 85, 1060, 530);
  ctx.save(); ctx.beginPath(); ctx.rect(70, 85, 1060, 530); ctx.clip();
  for (let i = 0; i < 42000; i++) {
    const x = 70 + random() * 1060, y = 85 + random() * 530;
    ctx.fillStyle = i % 2 ? '#a3c39609' : '#001a160e'; ctx.fillRect(x, y, .7, random() * 1.6 + .2);
  }
  for (let y = 85; y < 615; y += 2) { ctx.fillStyle = '#0b392c08'; ctx.fillRect(70, y, 1060, .6); }
  const shade = ctx.createLinearGradient(0, 85, 0, 115);
  shade.addColorStop(0, '#001b1977'); shade.addColorStop(1, '#001b1900'); ctx.fillStyle = shade; ctx.fillRect(70, 85, 1060, 30);
  ctx.strokeStyle = '#c9dfb31c'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(335, 85); ctx.lineTo(335, 615); ctx.stroke();
  ctx.beginPath(); ctx.arc(335, 350, 83, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
  for (const x of [335, 809]) { circle(ctx, x, 350, 2); ctx.fillStyle = '#e1ebcc36'; ctx.fill(); }
  ctx.textAlign = 'center'; ctx.fillStyle = '#dce6be0b'; ctx.font = '28px Georgia'; ctx.fillText('S I D E S P I N', 601, 340);
  ctx.font = '7px sans-serif'; ctx.fillStyle = '#dce6be18'; ctx.fillText('B I L L I A R D S   C L U B', 600, 359);
  ctx.restore();

  // Cushions have a bevel and a thin highlight along the cloth-facing edge.
  const segments = [
    [[100, 65], [559, 65], [575, 85], [102, 85]],
    [[641, 65], [1100, 65], [1098, 85], [625, 85]],
    [[100, 635], [559, 635], [575, 615], [102, 615]],
    [[641, 635], [1100, 635], [1098, 615], [625, 615]],
    [[50, 115], [70, 117], [70, 583], [50, 585]],
    [[1150, 115], [1130, 117], [1130, 583], [1150, 585]],
  ];
  segments.forEach((points, i) => {
    polygon(ctx, points); ctx.fillStyle = i < 2 ? '#124533' : i < 4 ? '#246047' : '#1b513c'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = '#052a2477'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(...points[2]); ctx.lineTo(...points[3]); ctx.strokeStyle = '#83ac6b38'; ctx.stroke();
  });

  // Leather pocket liners, brass collars, and the darkness below the table.
  POCKETS.forEach((p, i) => {
    const middle = i === 1 || i === 4;
    circle(ctx, p.x, p.y, middle ? 30 : 33); ctx.fillStyle = '#3b3529'; ctx.fill();
    ctx.strokeStyle = '#ae8b5b55'; ctx.lineWidth = 2.2; ctx.stroke();
    const hole = ctx.createRadialGradient(p.x, p.y + 2, 6, p.x, p.y, 28);
    hole.addColorStop(0, '#020a08'); hole.addColorStop(.72, '#030e0a'); hole.addColorStop(1, '#19251b');
    circle(ctx, p.x, p.y, middle ? 24 : 26.5); ctx.fillStyle = hole; ctx.fill();
    ctx.strokeStyle = '#0009'; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x, p.y, middle ? 27 : 29, .2, Math.PI - .2); ctx.strokeStyle = '#96754f30'; ctx.lineWidth = 1; ctx.stroke();
  });

  // Mother-of-pearl diamond sights and a cabinet nameplate.
  ctx.fillStyle = '#d7c9a3a1';
  for (const x of [202.5, 335, 467.5, 732.5, 865, 997.5]) for (const y of [51, 649]) {
    polygon(ctx, [[x, y - 3], [x + 2.4, y], [x, y + 3], [x - 2.4, y]]); ctx.fill();
  }
  for (const x of [35, 1165]) for (const y of [217.5, 350, 482.5]) {
    polygon(ctx, [[x, y - 3], [x + 2.4, y], [x, y + 3], [x - 2.4, y]]); ctx.fill();
  }
  ctx.fillStyle = '#a68c5d'; ctx.beginPath(); ctx.roundRect(567, 643, 66, 12, 2); ctx.fill();
  ctx.fillStyle = '#413722'; ctx.font = '5px Georgia'; ctx.textAlign = 'center'; ctx.fillText('S I D E S P I N', 600, 651);
  ctx.restore();
  return canvas;
}

export function drawBall(ctx, ball, alpha = 1, scale = 1) {
  const r = R * scale;
  ctx.save(); ctx.globalAlpha = alpha;
  circle(ctx, ball.x + 2, ball.y + 4, r * .94); ctx.shadowBlur = 5 * scale; ctx.shadowColor = '#001b1abd'; ctx.fillStyle = '#001b1a66'; ctx.fill(); ctx.shadowColor = 'transparent';
  const colors = ball.color === 'white' ? ['#fffef4', '#e5e5d9', '#9faea0'] : ball.color === 'red' ? ['#f88263', '#c9362b', '#641b1d'] : ball.color === 'yellow' ? ['#fff09b', '#ebc039', '#9b6817'] : ['#525b4f', '#17251e', '#030a08'];
  const gradient = ctx.createRadialGradient(ball.x - r * .34, ball.y - r * .4, r * .05, ball.x + r * .2, ball.y + r * .25, r * 1.2);
  gradient.addColorStop(0, colors[0]); gradient.addColorStop(.5, colors[1]); gradient.addColorStop(1, colors[2]);
  circle(ctx, ball.x, ball.y, r); ctx.fillStyle = gradient; ctx.fill(); ctx.lineWidth = .6; ctx.strokeStyle = '#ffffff1a'; ctx.stroke();
  if (ball.id === 8) {
    circle(ctx, ball.x - r * .05, ball.y - r * .1, r * .5); ctx.fillStyle = '#f0efd9'; ctx.fill();
    ctx.font = `bold ${r * .79}px Georgia`; ctx.fillStyle = '#1c2a20'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('8', ball.x - r * .04, ball.y - r * .04);
  }
  circle(ctx, ball.x - r * .32, ball.y - r * .4, r * .19); ctx.fillStyle = '#ffffff80'; ctx.fill();
  ctx.beginPath(); ctx.ellipse(ball.x - r * .12, ball.y - r * .59, r * .37, r * .1, -.4, 0, Math.PI * 2); ctx.fillStyle = '#ffffff23'; ctx.fill();
  ctx.restore();
}

function drawCue(ctx, cue, angle, color, pull = 0, strikeProgress = null) {
  ctx.save(); ctx.translate(cue.x, cue.y); ctx.rotate(angle);
  let gap = R + 10 + pull * 85;
  if (strikeProgress !== null) gap = R + 10 + 75 * (1 - strikeProgress) ** 2 - strikeProgress * 12;
  ctx.shadowColor = '#0007'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 4;
  const shaft = ctx.createLinearGradient(0, -5, 0, 5);
  shaft.addColorStop(0, '#987044'); shaft.addColorStop(.3, '#e4ca92'); shaft.addColorStop(.55, '#dfc28b'); shaft.addColorStop(1, '#94703f');
  polygon(ctx, [[-gap, -2.2], [-gap - 221, -4.9], [-gap - 221, 4.9], [-gap, 2.2]]); ctx.fillStyle = shaft; ctx.fill(); ctx.shadowColor = 'transparent';
  for (let i = 0; i < 5; i++) {
    ctx.beginPath(); ctx.moveTo(-gap - 13, -1.7 + i * .7); ctx.bezierCurveTo(-gap - 65, -3 + i, -gap - 140, -3 + i * 1.2, -gap - 220, -4.4 + i * 1.9); ctx.strokeStyle = i % 2 ? '#8b5c242c' : '#fff2b622'; ctx.lineWidth = .4; ctx.stroke();
  }
  const butt = ctx.createLinearGradient(0, -7, 0, 7);
  butt.addColorStop(0, '#282019'); butt.addColorStop(.35, '#755132'); butt.addColorStop(.5, '#68462c'); butt.addColorStop(1, '#251e18');
  polygon(ctx, [[-gap - 221, -4.9], [-gap - 320, -7], [-gap - 320, 7], [-gap - 221, 4.9]]); ctx.fillStyle = butt; ctx.fill();
  for (let i = 0; i < 17; i++) { const x = -gap - 239 - i * 3; ctx.fillStyle = '#131d1738'; ctx.fillRect(x, -5.4, 1, 10.8); }
  ctx.fillStyle = color === 'yellow' ? '#d7b147' : '#bc5142'; ctx.fillRect(-gap - 305, -6.6, 8, 13.2);
  ctx.fillStyle = '#c9b281'; ctx.fillRect(-gap - 307, -6.6, 1.5, 13.2); ctx.fillRect(-gap - 296, -6.3, 1.5, 12.6); ctx.fillRect(-gap - 225, -5, 3, 10);
  ctx.fillStyle = '#101d18'; ctx.fillRect(-gap - 323, -7, 4, 14);
  ctx.fillStyle = '#eee5c9'; ctx.fillRect(-gap - 12, -2.3, 9, 4.6);
  ctx.fillStyle = '#72a2a2'; ctx.fillRect(-gap - 3, -2.4, 3, 4.8);
  ctx.restore();
}

export class TableRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.art = makeTableArt();
    this.positions = new Map();
    this.pots = [];
    this.lastTime = performance.now();
    this.receivedAt = this.lastTime;
  }

  setState(state, events = []) {
    this.state = state;
    this.receivedAt = performance.now();
    for (const event of events) {
      if (event.type === 'strike') this.strikeAt = performance.now();
      if (event.type === 'pocket') {
        const ball = state.balls.find((b) => b.id === event.ball);
        if (ball) this.pots.push({ ...ball, at: performance.now() });
      }
    }
  }

  render({ angle, pull, myTurn, guide, color, placement, pointer, spin } = {}) {
    const ctx = this.ctx, now = performance.now();
    const elapsed = Math.min(.05, (now - this.lastTime) / 1000); this.lastTime = now;
    ctx.clearRect(0, 0, W, H); ctx.drawImage(this.art, 0, 0);
    if (!this.state) return;
    const state = this.state;
    const balls = state.balls;
    const cue = balls.find((b) => b.id === 0);
    if (!state.moving && !placement && guide && cue && !cue.pocketed && state.phase === 'playing') {
      const aim = aimGuide(balls, angle);
      if (aim) {
        ctx.save(); ctx.globalAlpha = myTurn ? 1 : .38;
        ctx.strokeStyle = '#eff1ca70'; ctx.lineWidth = 1.3; ctx.setLineDash([5, 7]);
        ctx.beginPath(); ctx.moveTo(cue.x, cue.y); ctx.lineTo(aim.x, aim.y); ctx.stroke(); ctx.setLineDash([]);
        circle(ctx, aim.x, aim.y, R); ctx.strokeStyle = '#e6edcb90'; ctx.lineWidth = 1; ctx.stroke();
        if (aim.hit) {
          const nx = (aim.hit.x - aim.x) / (2 * R), ny = (aim.hit.y - aim.y) / (2 * R);
          ctx.beginPath(); ctx.moveTo(aim.hit.x + nx * R, aim.hit.y + ny * R); ctx.lineTo(aim.hit.x + nx * 73, aim.hit.y + ny * 73); ctx.strokeStyle = '#dbe8b87a'; ctx.stroke();
          circle(ctx, aim.hit.x, aim.hit.y, R + 3.5); ctx.strokeStyle = '#e1edc34d'; ctx.stroke();
        }
        ctx.restore();
      }
    }
    // Smooth the authoritative 30 Hz snapshots. Extrapolation is bounded so a
    // delayed frame cannot send a ball through a cushion on the client.
    const lead = Math.min(.025, (now - this.receivedAt) / 1000);
    for (const ball of balls) {
      const targetX = ball.x + (state.moving ? ball.vx * lead : 0);
      const targetY = ball.y + (state.moving ? ball.vy * lead : 0);
      let position = this.positions.get(ball.id);
      if (!position || !state.moving || Math.hypot(position.x - targetX, position.y - targetY) > 120) position = { x: targetX, y: targetY };
      else { const t = 1 - Math.exp(-35 * elapsed); position.x += (targetX - position.x) * t; position.y += (targetY - position.y) * t; }
      this.positions.set(ball.id, position);
      if (!ball.pocketed) drawBall(ctx, { ...ball, ...position });
    }
    this.pots = this.pots.filter((b) => now - b.at < 230);
    this.pots.forEach((b) => { const t = (now - b.at) / 230; drawBall(ctx, b, 1 - t, 1 - t * .7); });
    if (placement && pointer) {
      ctx.save(); ctx.globalAlpha = .65;
      drawBall(ctx, { id: 0, color: 'white', x: pointer.x, y: pointer.y });
      circle(ctx, pointer.x, pointer.y, R + 5); ctx.strokeStyle = pointer.valid ? '#d5e9a9' : '#f28c72'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.restore();
    }
    const progress = this.strikeAt ? (now - this.strikeAt) / 115 : 2;
    if (cue && !cue.pocketed && state.phase === 'playing' && !placement && (!state.moving || progress < 1)) {
      drawCue(ctx, cue, angle, color, pull, state.moving ? Math.min(1, progress) : null);
      if (myTurn && !state.moving) {
        circle(ctx, cue.x, cue.y, R + 4); ctx.strokeStyle = '#e6edbb24'; ctx.lineWidth = .8; ctx.stroke();
        if (spin && (Math.abs(spin.side) > .05 || Math.abs(spin.top) > .05)) { circle(ctx, cue.x + spin.side * 4, cue.y - spin.top * 4, 1.3); ctx.fillStyle = '#bd5145'; ctx.fill(); }
      }
    }
  }

  point(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * W / rect.width, y: (event.clientY - rect.top) * H / rect.height };
  }
}

export function drawPreview(canvas) {
  const ctx = canvas.getContext('2d'); const art = makeTableArt();
  ctx.drawImage(art, 0, 0);
  const balls = createRack();
  // A mid-frame arrangement, rather than another perfect rack.
  const positions = [[0, 333, 385], [1, 442, 218], [2, 775, 421], [3, 913, 198], [4, 696, 314], [5, 982, 532], [6, 527, 459], [7, 836, 280], [8, 841, 365], [9, 370, 178], [10, 657, 505], [11, 977, 334], [12, 512, 288], [13, 752, 204], [14, 948, 452], [15, 226, 471]];
  positions.forEach(([id, x, y]) => { const b = balls.find((b) => b.id === id); b.x = x; b.y = y; drawBall(ctx, b); });
  drawCue(ctx, balls[0], -.28, 'red');
}

export function drawSpin(canvas, side, top, enabled) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 180, 180);
  ctx.save(); ctx.globalAlpha = enabled ? 1 : .55;
  const gradient = ctx.createRadialGradient(66, 57, 4, 100, 103, 83);
  gradient.addColorStop(0, '#fffef0'); gradient.addColorStop(.65, '#d9dfcf'); gradient.addColorStop(1, '#8eaa91');
  circle(ctx, 90, 90, 69); ctx.shadowColor = '#0006'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 8; ctx.fillStyle = gradient; ctx.fill(); ctx.shadowColor = 'transparent';
  ctx.setLineDash([3, 5]); circle(ctx, 90, 90, 45); ctx.strokeStyle = '#4a60443d'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(40, 90); ctx.lineTo(140, 90); ctx.moveTo(90, 40); ctx.lineTo(90, 140); ctx.strokeStyle = '#344b3826'; ctx.lineWidth = 1; ctx.stroke();
  circle(ctx, 90 + side * 48, 90 - top * 48, 8); ctx.fillStyle = '#c95643'; ctx.shadowColor = '#4a1d1a55'; ctx.shadowBlur = 4; ctx.fill(); ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#fff4dc'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
}
