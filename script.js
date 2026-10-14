(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const TAU = Math.PI * 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tween = (dur, fn) => new Promise(res => {
  const t0 = performance.now();
  const f = now => { const t = Math.min(1, (now - t0) / dur); fn(t); t < 1 ? requestAnimationFrame(f) : res(); };
  requestAnimationFrame(f);
});
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

/* ================= dados do tabuleiro ================= */
const COL = [
  { name: 'Vermelho', main: '#ef4444', dark: '#a51d1d', light: '#ffb8b8' },
  { name: 'Verde',    main: '#22b455', dark: '#126b32', light: '#a8f0c0' },
  { name: 'Amarelo',  main: '#fbc40f', dark: '#9c6c05', light: '#fff2a6' },
  { name: 'Azul',     main: '#3b82f6', dark: '#1c4aa8', light: '#b8d4ff' }
];
const TRACK = [];
(function () {
  const seg = (c, r, dc, dr, n) => { for (let i = 0; i < n; i++) TRACK.push([c + dc * i, r + dr * i]); };
  seg(1, 6, 1, 0, 5);  seg(6, 5, 0, -1, 6); seg(7, 0, 1, 0, 2);
  seg(8, 1, 0, 1, 5);  seg(9, 6, 1, 0, 6);  seg(14, 7, 0, 1, 2);
  seg(13, 8, -1, 0, 5); seg(8, 9, 0, 1, 6); seg(7, 14, -1, 0, 2);
  seg(6, 13, 0, -1, 5); seg(5, 8, -1, 0, 6); seg(0, 7, 0, -1, 2);
})();
const START = [0, 13, 26, 39];
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const HOME = [
  [[1,7],[2,7],[3,7],[4,7],[5,7]],
  [[7,1],[7,2],[7,3],[7,4],[7,5]],
  [[13,7],[12,7],[11,7],[10,7],[9,7]],
  [[7,13],[7,12],[7,11],[7,10],[7,9]]
];
const QUAD = [[0,0],[9,0],[9,9],[0,9]];
const YARD = [[2,2],[4,2],[2,4],[4,4]];
const FIN = [{ b: [6.62,7.5], d: [0,1] }, { b: [7.5,6.62], d: [1,0] }, { b: [8.38,7.5], d: [0,1] }, { b: [7.5,8.38], d: [1,0] }];
const ENTRY_DIR = [[1,0],[0,1],[-1,0],[0,-1]];

function basePos(c, p, i) {
  if (p < 0) { const q = QUAD[c], y = YARD[i]; return [q[0] + y[0], q[1] + y[1]]; }
  if (p <= 50) { const t = TRACK[(START[c] + p) % 52]; return [t[0] + .5, t[1] + .5]; }
  if (p <= 55) { const t = HOME[c][p - 51]; return [t[0] + .5, t[1] + .5]; }
  const f = FIN[c], o = (i - 1.5) * .28; return [f.b[0] + f.d[0] * o, f.b[1] + f.d[1] * o];
}

/* ================= estado / config ================= */
const NEXT = { human: 'ai', ai: 'off', off: 'human' };
const LABEL = { human: '👤 Humano', ai: '🤖 IA', off: '✖ Fora' };
const cfg = Object.assign({ slots: ['human', 'ai', 'ai', 'ai'], diff: 1, sound: true, auto: true, theme: null }, store.get('ludo.cfg', {}));
if (!Array.isArray(cfg.slots) || cfg.slots.length !== 4) cfg.slots = ['human', 'ai', 'ai', 'ai'];
let wins = store.get('ludo.wins', [0, 0, 0, 0]);
if (!Array.isArray(wins) || wins.length !== 4) wins = [0, 0, 0, 0];
const saveCfg = () => store.set('ludo.cfg', cfg);
if (cfg.theme) document.documentElement.dataset.theme = cfg.theme;
const IS_TOUCH = matchMedia('(pointer:coarse)').matches;

let G = null, screen = 'menu';

/* ================= som ================= */
const Snd = {
  ctx: null, on: cfg.sound,
  init() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(f, d, type = 'sine', v = .12, delay = 0, f2) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + d + .03);
  },
  noise(d, v, delay = 0, hp = 900) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay, n = Math.floor(c.sampleRate * d), buf = c.createBuffer(1, n, c.sampleRate), a = buf.getChannelData(0);
    for (let i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const g = c.createGain(); g.gain.value = v; s.connect(f); f.connect(g); g.connect(c.destination); s.start(t);
  },
  click() { this.tone(820, .05, 'square', .04); },
  roll() {
    for (let i = 0; i < 9; i++) this.noise(.05, .24 * (1 - i * .07), i * .105, 1300 - i * 60);
    this.tone(150, .14, 'sine', .2, .96, 60);
  },
  step() { this.tone(620, .07, 'triangle', .09, 0, 800); },
  six() { [523, 659, 784].forEach((f, i) => this.tone(f, .14, 'triangle', .1, i * .08)); },
  capture() { this.tone(520, .28, 'sawtooth', .09, 0, 110); this.noise(.22, .22, 0, 500); },
  home() { [659, 784, 988, 1318].forEach((f, i) => this.tone(f, .16, 'triangle', .11, i * .09)); },
  nomove() { this.tone(210, .22, 'square', .05, 0, 140); },
  win() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, .22, 'triangle', .12, i * .13)); }
};
window.addEventListener('pointerdown', () => Snd.init(), { passive: true });

/* ================= dado 3D ================= */
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const FACE = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, -180] };
const DI = { rx: 0, ry: 0, rz: 0 };
function buildCube(el) {
  el.innerHTML = [1, 2, 3, 4, 5, 6].map(n => '<span class="face f' + n + '">' +
    [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => '<i class="' + (PIPS[n].includes(i) ? 'on' : '') + '"></i>').join('') + '</span>').join('');
}
function applyCube(trans) {
  const c = $('#cube'); c.style.transition = trans || 'none';
  c.style.transform = 'rotateX(' + DI.rx + 'deg) rotateY(' + DI.ry + 'deg) rotateZ(' + DI.rz + 'deg)';
}
function setDice(v) { DI.rx = FACE[v][0]; DI.ry = FACE[v][1]; DI.rz = 0; applyCube(); }
function tumbleDice(v) {
  const f = FACE[v], tgt = (base, cur, turns) => base + 360 * Math.ceil((cur - base) / 360 + turns);
  DI.rx = tgt(f[0], DI.rx, 2 + Math.floor(Math.random() * 2));
  DI.ry = tgt(f[1], DI.ry, 3 + Math.floor(Math.random() * 2));
  DI.rz = tgt(0, DI.rz, 1 + Math.floor(Math.random() * 2));
  void $('#cube').offsetWidth;
  applyCube('transform 1.05s cubic-bezier(.17,.67,.25,1)');
}

/* ================= canvas ================= */
const cv = $('#board'), ctx = cv.getContext('2d'), area = $('#boardArea');
let S = 0, dpr = 1, cell = 0, bc = null;
const parts = [];

function rr(x, a, b, w, h, r) {
  x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r);
  x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath();
}
function starPath(x, cx, cy, r) {
  x.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + k * Math.PI / 5, rad = k % 2 ? r * .45 : r;
    const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
    k ? x.lineTo(px, py) : x.moveTo(px, py);
  }
  x.closePath();
}

function resize() {
  const w = area.clientWidth, h = area.clientHeight;
  if (!w || !h) return;
  const size = Math.floor(Math.max(150, Math.min(w - 20, h - 20, 840)));
  const nd = Math.min(window.devicePixelRatio || 1, 3);
  if (size === S && nd === dpr && bc) return;
  S = size; dpr = nd; cell = S / 15;
  cv.width = cv.height = Math.round(S * dpr);
  cv.style.width = cv.style.height = S + 'px';
  buildBoard();
}

function buildBoard() {
  bc = document.createElement('canvas');
  bc.width = bc.height = Math.round(S * dpr);
  const b = bc.getContext('2d'), c = cell;
  b.scale(bc.width / S, bc.width / S);
  const bg = b.createLinearGradient(0, 0, S, S); bg.addColorStop(0, '#fffdf7'); bg.addColorStop(1, '#efe9da');
  b.fillStyle = bg; b.fillRect(0, 0, S, S);

  // bases
  for (let k = 0; k < 4; k++) {
    const x = QUAD[k][0] * c, y = QUAD[k][1] * c, w = 6 * c;
    const g = b.createLinearGradient(x, y, x + w, y + w); g.addColorStop(0, COL[k].main); g.addColorStop(1, COL[k].dark);
    b.fillStyle = g; b.fillRect(x, y, w, w);
    b.save(); b.beginPath(); b.rect(x, y, w, w); b.clip();
    b.strokeStyle = 'rgba(255,255,255,.1)'; b.lineWidth = c * .28;
    for (let s = -w; s < w * 2; s += c * .95) { b.beginPath(); b.moveTo(x + s, y); b.lineTo(x + s + w, y + w); b.stroke(); }
    const gl = b.createRadialGradient(x + w * .2, y + w * .12, 0, x + w * .2, y + w * .12, w * .9);
    gl.addColorStop(0, 'rgba(255,255,255,.34)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    b.fillStyle = gl; b.fillRect(x, y, w, w); b.restore();
    b.save(); b.shadowColor = 'rgba(0,0,0,.34)'; b.shadowBlur = c * .5; b.shadowOffsetY = c * .16;
    b.fillStyle = '#fffdf8'; rr(b, x + c, y + c, 4 * c, 4 * c, c * .85); b.fill(); b.restore();
    b.strokeStyle = COL[k].main; b.globalAlpha = .35; b.lineWidth = c * .08; rr(b, x + c * 1.18, y + c * 1.18, 3.64 * c, 3.64 * c, c * .7); b.stroke(); b.globalAlpha = 1;
    for (const [ox, oy] of YARD) {
      const cx = x + ox * c, cy = y + oy * c;
      b.fillStyle = 'rgba(0,0,0,.18)'; b.beginPath(); b.arc(cx, cy + c * .06, c * .7, 0, TAU); b.fill();
      const rg = b.createRadialGradient(cx - c * .18, cy - c * .2, c * .06, cx, cy, c * .72);
      rg.addColorStop(0, COL[k].light); rg.addColorStop(.6, COL[k].main); rg.addColorStop(1, COL[k].dark);
      b.fillStyle = rg; b.beginPath(); b.arc(cx, cy, c * .66, 0, TAU); b.fill();
      b.lineWidth = c * .05; b.strokeStyle = 'rgba(255,255,255,.7)'; b.beginPath(); b.arc(cx, cy, c * .66, 0, TAU); b.stroke();
    }
  }
  // casas do percurso
  const inCross = (col, r) => ((col >= 6 && col <= 8) || (r >= 6 && r <= 8)) && !(col >= 6 && col <= 8 && r >= 6 && r <= 8);
  for (let r = 0; r < 15; r++) for (let col = 0; col < 15; col++) if (inCross(col, r)) {
    const g = b.createLinearGradient(0, r * c, 0, (r + 1) * c); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#f1eee6');
    b.fillStyle = g; b.fillRect(col * c, r * c, c, c);
  }
  const gloss = (col, r) => {
    const g = b.createLinearGradient(0, r * c, 0, (r + 1) * c); g.addColorStop(0, 'rgba(255,255,255,.42)'); g.addColorStop(.55, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.12)');
    b.fillStyle = g; b.fillRect(col * c, r * c, c, c);
  };
  for (let k = 0; k < 4; k++) {
    b.fillStyle = COL[k].main;
    for (const [col, r] of HOME[k]) { b.fillStyle = COL[k].main; b.fillRect(col * c, r * c, c, c); gloss(col, r); }
    const st = TRACK[START[k]]; b.fillStyle = COL[k].main; b.fillRect(st[0] * c, st[1] * c, c, c); gloss(st[0], st[1]);
    // setas dentro da coluna final
    const [dx, dy] = ENTRY_DIR[k], px = -dy, py = dx, a = c * .15;
    b.strokeStyle = 'rgba(255,255,255,.75)'; b.lineWidth = c * .09; b.lineCap = 'round'; b.lineJoin = 'round';
    HOME[k].forEach(([col, r]) => {
      const cx = (col + .5) * c, cy = (r + .5) * c;
      b.beginPath(); b.moveTo(cx - dx * a + px * a * 1.2, cy - dy * a + py * a * 1.2); b.lineTo(cx + dx * a, cy + dy * a);
      b.lineTo(cx - dx * a - px * a * 1.2, cy - dy * a - py * a * 1.2); b.stroke();
    });
  }
  b.strokeStyle = 'rgba(60,50,95,.3)'; b.lineWidth = Math.max(1, c * .035);
  for (let r = 0; r < 15; r++) for (let col = 0; col < 15; col++) if (inCross(col, r)) b.strokeRect(col * c, r * c, c, c);
  // estrelas
  SAFE.forEach(idx => {
    const [col, r] = TRACK[idx], isStart = START.includes(idx);
    starPath(b, (col + .5) * c, (r + .5) * c, c * .34);
    b.fillStyle = isStart ? '#ffffff' : '#a5adc2'; b.fill();
    b.lineWidth = Math.max(1, c * .03); b.strokeStyle = isStart ? 'rgba(0,0,0,.25)' : 'rgba(60,60,90,.35)'; b.stroke();
  });
  // setas de entrada na coluna final
  for (let k = 0; k < 4; k++) {
    const [col, r] = TRACK[(START[k] + 50) % 52], [dx, dy] = ENTRY_DIR[k], cx = (col + .5) * c, cy = (r + .5) * c, rad = c * .3;
    b.fillStyle = COL[k].main; b.beginPath();
    b.moveTo(cx + dx * rad, cy + dy * rad);
    b.lineTo(cx - dx * rad - dy * rad * .95, cy - dy * rad + dx * rad * .95);
    b.lineTo(cx - dx * rad + dy * rad * .95, cy - dy * rad - dx * rad * .95);
    b.closePath(); b.fill();
  }
  // centro
  const x0 = 6 * c, y0 = 6 * c, s3 = 3 * c, mid = 7.5 * c;
  const tris = [[[x0,y0],[x0,y0+s3]], [[x0,y0],[x0+s3,y0]], [[x0+s3,y0],[x0+s3,y0+s3]], [[x0,y0+s3],[x0+s3,y0+s3]]];
  tris.forEach((t, k) => {
    const g = b.createLinearGradient(t[0][0], t[0][1], mid, mid); g.addColorStop(0, COL[k].light); g.addColorStop(.35, COL[k].main); g.addColorStop(1, COL[k].dark);
    b.fillStyle = g; b.beginPath(); b.moveTo(t[0][0], t[0][1]); b.lineTo(t[1][0], t[1][1]); b.lineTo(mid, mid); b.closePath(); b.fill();
    b.strokeStyle = '#fff'; b.lineWidth = Math.max(1.5, c * .06); b.stroke();
  });
  const quarters = [[.75, 1.25], [1.25, 1.75], [-.25, .25], [.25, .75]];
  b.save(); b.shadowColor = 'rgba(0,0,0,.35)'; b.shadowBlur = c * .2; b.fillStyle = '#fff'; b.beginPath(); b.arc(mid, mid, c * .46, 0, TAU); b.fill(); b.restore();
  quarters.forEach((q, k) => { b.fillStyle = COL[k].main; b.beginPath(); b.moveTo(mid, mid); b.arc(mid, mid, c * .34, q[0] * Math.PI, q[1] * Math.PI); b.closePath(); b.fill(); });
  b.strokeStyle = 'rgba(30,20,70,.4)'; b.lineWidth = c * .08; b.strokeRect(0, 0, S, S);
}

function drawPawn(x, y, z, s, k) {
  const col = COL[k], r = cell * .46 * s, px = x * cell, gy = y * cell, py = gy - z * cell - r * .1, sh = 1 - Math.min(.5, z * .6);
  ctx.save();
  ctx.fillStyle = 'rgba(15,23,42,.32)'; ctx.beginPath(); ctx.ellipse(px + r * .08, gy + r * .7, r * .95 * sh, r * .34 * sh, 0, 0, TAU); ctx.fill();
  const g = ctx.createLinearGradient(px - r, 0, px + r, 0); g.addColorStop(0, col.light); g.addColorStop(.45, col.main); g.addColorStop(1, col.dark);
  ctx.fillStyle = g; ctx.strokeStyle = col.dark; ctx.lineWidth = Math.max(1, r * .13); ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.ellipse(px, py + r * .62, r * .95, r * .38, 0, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(px - r * .62, py + r * .6); ctx.quadraticCurveTo(px - r * .2, py + r * .25, px - r * .26, py - r * .2);
  ctx.lineTo(px + r * .26, py - r * .2); ctx.quadraticCurveTo(px + r * .2, py + r * .25, px + r * .62, py + r * .6); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(px, py - r * .2, r * .46, r * .16, 0, 0, TAU); ctx.fill(); ctx.stroke();
  const hg = ctx.createRadialGradient(px - r * .2, py - r * .75, r * .05, px, py - r * .5, r * .62);
  hg.addColorStop(0, col.light); hg.addColorStop(.5, col.main); hg.addColorStop(1, col.dark);
  ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(px, py - r * .52, r * .5, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.ellipse(px - r * .17, py - r * .7, r * .15, r * .1, -.6, 0, TAU); ctx.fill();
  ctx.restore();
}

function restTargets(g) {
  const groups = new Map(), out = [];
  for (const c of g.active) for (let i = 0; i < 4; i++) {
    const v = g.vis[c][i]; if (v.anim) continue;
    const p = g.pawns[c][i], [x, y] = basePos(c, p, i), t = { c, i, x, y, s: p === 56 ? .62 : 1 };
    out.push(t);
    if (p >= 0 && p <= 55) { const key = x.toFixed(2) + ',' + y.toFixed(2); (groups.get(key) || groups.set(key, []).get(key)).push(t); }
  }
  const OFF = {
    2: [[-.2, -.04], [.2, .04]],
    3: [[-.22, .1], [.22, .1], [0, -.2]],
    4: [[-.22, -.2], [.22, -.2], [-.22, .2], [.22, .2]]
  };
  groups.forEach(arr => {
    const n = arr.length; if (n < 2) return;
    const sc = n === 2 ? .8 : n <= 4 ? .68 : .55;
    arr.forEach((t, k) => {
      const o = OFF[n] ? OFF[n][k] : [Math.cos(k / n * TAU) * .26, Math.sin(k / n * TAU) * .26];
      t.x += o[0]; t.y += o[1]; t.s = sc;
    });
  });
  return out;
}

function burst(x, y, color, n = 18) {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * TAU, sp = 2 + Math.random() * 4;
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, life: .7, max: .7, color, r: .06 + Math.random() * .08 });
  }
}

function draw(now, dt) {
  const g = G, t = now / 1000;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, S, S);
  ctx.drawImage(bc, 0, 0, S, S);
  const cur = g.active[g.cur];
  if (!g.over) {
    const q = QUAD[cur];
    ctx.save(); ctx.globalAlpha = .45 + .35 * Math.sin(t * 4.5); ctx.strokeStyle = '#fff'; ctx.lineWidth = cell * .2;
    rr(ctx, q[0] * cell + cell * .1, q[1] * cell + cell * .1, 6 * cell - cell * .2, 6 * cell - cell * .2, cell * .35); ctx.stroke(); ctx.restore();
  }
  const k = 1 - Math.pow(1e-4, dt);
  for (const tg of restTargets(g)) {
    const v = g.vis[tg.c][tg.i];
    v.x += (tg.x - v.x) * k; v.y += (tg.y - v.y) * k; v.s += (tg.s - v.s) * k; v.z += (0 - v.z) * k;
  }
  const sel = (g.selectResolve && g.selectable.length) ? g.selectable : [];
  if (sel.length) {
    ctx.save(); ctx.setLineDash([cell * .14, cell * .1]); ctx.lineWidth = cell * .07; ctx.strokeStyle = COL[cur].dark;
    for (const i of sel) {
      const p = g.pawns[cur][i], np = p === -1 ? 0 : p + g.roll, [x, y] = basePos(cur, np, i);
      ctx.globalAlpha = .55 + .45 * Math.sin(t * 6);
      ctx.beginPath(); ctx.arc(x * cell, y * cell, cell * .4, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
  const list = [];
  for (const c of g.active) for (let i = 0; i < 4; i++) list.push({ c, i, v: g.vis[c][i] });
  list.sort((a, b) => (a.v.anim - b.v.anim) || (a.v.y - b.v.y));
  for (const e of list) {
    const { c, i, v } = e, isSel = c === cur && sel.includes(i) && !v.anim;
    let z = v.z;
    if (isSel) {
      const pr = cell * (.64 + .1 * Math.sin(t * 6));
      ctx.beginPath(); ctx.arc(v.x * cell, v.y * cell, pr, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fill();
      ctx.lineWidth = cell * .11; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.lineWidth = cell * .05; ctx.strokeStyle = COL[c].main; ctx.stroke();
      z += .1 + .08 * Math.sin(t * 8 + i);
    }
    drawPawn(v.x, v.y, z, v.s, c);
  }
  for (let n = parts.length - 1; n >= 0; n--) {
    const p = parts[n]; p.life -= dt;
    if (p.life <= 0) { parts.splice(n, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 7 * dt;
    ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x * cell, p.y * cell, p.r * cell, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, (now - lastT) / 1000); lastT = now;
  if (!G || screen !== 'game' || !bc) return;
  draw(now, dt);
}
requestAnimationFrame(frame);
new ResizeObserver(resize).observe(area);
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));

/* ================= UI do jogo ================= */
function toast(msg, ms = 1300) {
  const el = $('#toast'); el.textContent = msg; el.classList.remove('show'); void el.offsetWidth;
  el.style.animationDuration = ms + 'ms'; el.classList.add('show');
}
function setCanRoll(b) {
  $('#dice').classList.toggle('ready', b); $('#dice').disabled = !b; $('#bRoll').disabled = !b;
}
function setStatus(main, sub) { $('#stMain').innerHTML = '<i class="dot"></i><span>' + main + '</span>'; $('#stSub').textContent = sub || ''; }
function turnTitle(c) { const n = G.seats[c].name; return n === 'Você' ? 'Sua vez' : 'Vez de ' + n; }
function setTurn(c) {
  $('#game').style.setProperty('--pc', 'var(--c' + c + ')');
  $('#bRoll').classList.toggle('dk', c === 0 || c === 3);
  renderScore();
}
function renderScore() {
  const g = G; if (!g) return;
  $('#score').innerHTML = g.active.map(c => {
    const home = g.pawns[c].filter(p => p === 56).length;
    const pips = [0, 1, 2, 3].map(k => '<i class="' + (k < home ? 'on' : '') + '"></i>').join('');
    const cur = g.active[g.cur] === c && !g.over;
    return '<div class="chip' + (cur ? ' cur' : '') + '" style="--c:var(--c' + c + ')"><div class="r1"><span>' +
      (g.seats[c].type === 'ai' ? '🤖' : '👤') + '</span><b>' + g.seats[c].name + '</b></div><div class="r2"><span class="pp" title="Peões em casa">' +
      pips + '</span><span>🏆' + wins[c] + '</span></div></div>';
  }).join('');
}

/* ================= regras ================= */
function getMoves(g, c, v) {
  const r = [];
  for (let i = 0; i < 4; i++) { const p = g.pawns[c][i]; if (p === -1) { if (v === 6) r.push(i); } else if (p + v <= 56) r.push(i); }
  return r;
}
function uniqueMoves(g, c, moves) {
  const seen = new Set(), r = [];
  for (const i of moves) { const p = g.pawns[c][i]; if (!seen.has(p)) { seen.add(p); r.push(i); } }
  return r;
}
function hitsAt(g, c, gd) {
  const out = [];
  for (const o of g.active) {
    if (o === c) continue;
    const hit = [];
    for (let j = 0; j < 4; j++) { const q = g.pawns[o][j]; if (q >= 0 && q <= 50 && (START[o] + q) % 52 === gd) hit.push(j); }
    if (hit.length) out.push({ o, hit });
  }
  return out;
}
function threatAt(g, c, gd) {
  let n = 0;
  for (const o of g.active) {
    if (o === c) continue;
    for (let j = 0; j < 4; j++) {
      const q = g.pawns[o][j]; if (q < 0 || q > 50) continue;
      const d = (gd - (START[o] + q) % 52 + 52) % 52;
      if (d >= 1 && d <= 6 && q + d <= 50) n++;
    }
  }
  return n;
}
function aiScore(g, c, i, v) {
  const p0 = g.pawns[c][i], p1 = p0 === -1 ? 0 : p0 + v;
  const gd = p1 <= 50 ? (START[c] + p1) % 52 : -1, g0 = p0 >= 0 && p0 <= 50 ? (START[c] + p0) % 52 : -1;
  let s = 0;
  if (p1 === 56) s += 130;
  if (p0 === -1) s += 60;
  if (p1 >= 51 && p0 < 51) s += 45;
  if (gd >= 0) {
    if (SAFE.has(gd)) s += 24;
    else {
      for (const h of hitsAt(g, c, gd)) if (h.hit.length === 1) s += 95 + g.pawns[h.o][h.hit[0]] * .8;
      let own = 0; for (let j = 0; j < 4; j++) if (j !== i && g.pawns[c][j] >= 0 && g.pawns[c][j] <= 50 && (START[c] + g.pawns[c][j]) % 52 === gd) own++;
      if (own) s += 12; else s -= threatAt(g, c, gd) * 38;
    }
  }
  if (g0 >= 0 && !SAFE.has(g0) && threatAt(g, c, g0) > 0) s += 34;
  return s + p1 * .35;
}
function aiChoose(g, c, v, moves) {
  if (cfg.diff === 0) return moves[Math.floor(Math.random() * moves.length)];
  const noise = cfg.diff === 1 ? 20 : 3; let best = moves[0], bs = -1e9;
  for (const i of moves) { const s = aiScore(g, c, i, v) + Math.random() * noise; if (s > bs) { bs = s; best = i; } }
  return best;
}

/* ================= fluxo da partida ================= */
function waitRoll(g) { return new Promise(res => { g.rollResolve = res; setCanRoll(true); }); }
function waitSelect(g, opts) { return new Promise(res => { g.selectable = opts; g.selectResolve = res; }); }
function onRollPress() {
  Snd.init();
  if (!G || G.dead || !G.rollResolve) return;
  const r = G.rollResolve; G.rollResolve = null; setCanRoll(false); r();
}

async function rollDice(g, v) {
  const d = $('#dice');
  d.classList.remove('ready'); void d.offsetWidth; d.classList.add('rolling');
  Snd.roll(); tumbleDice(v);
  await sleep(1080);
  d.classList.remove('rolling');
  if (g.dead) return;
  if (v === 6) Snd.six();
  await sleep(260);
}

async function movePawn(g, c, i, v) {
  const p0 = g.pawns[c][i], p1 = p0 === -1 ? 0 : p0 + v, vis = g.vis[c][i];
  g.pawns[c][i] = p1; vis.anim = true; vis.s = 1;
  const steps = []; if (p0 === -1) steps.push(0); else for (let p = p0 + 1; p <= p1; p++) steps.push(p);
  for (const p of steps) {
    const [tx, ty] = basePos(c, p, i), fx = vis.x, fy = vis.y, dur = p0 === -1 ? 300 : steps.length > 5 ? 100 : 135, hop = p0 === -1 ? .7 : .42;
    Snd.step();
    await tween(dur, t => { vis.x = fx + (tx - fx) * t; vis.y = fy + (ty - fy) * t; vis.z = Math.sin(Math.PI * t) * hop; });
    if (g.dead) return {};
  }
  vis.z = 0; vis.anim = false;
  let captured = 0; const finished = p1 === 56;
  if (p1 <= 50) {
    const gd = (START[c] + p1) % 52;
    if (!SAFE.has(gd)) {
      for (const h of hitsAt(g, c, gd)) {
        if (h.hit.length !== 1) continue;
        const j = h.hit[0], v2 = g.vis[h.o][j];
        burst(v2.x, v2.y, COL[h.o].main); g.pawns[h.o][j] = -1; captured++;
      }
    }
  }
  const [bx, by] = basePos(c, p1, i);
  if (captured) { Snd.capture(); toast('Captura! 💥'); await sleep(650); }
  if (finished) { burst(bx, by, COL[c].main, 26); Snd.home(); toast('Peão em casa! 🏠'); await sleep(650); }
  else if (!captured) await sleep(120);
  return { captured, finished };
}

async function run(g) {
  const live = () => !g.dead;
  while (live() && !g.over) {
    const c = g.active[g.cur], seat = g.seats[c];
    setTurn(c); g.sixes = 0;
    let again = true;
    while (again && live() && !g.over) {
      again = false;
      if (seat.type === 'human') {
        setStatus(turnTitle(c), IS_TOUCH ? 'Toque no dado para rolar' : 'Clique no dado ou aperte espaço');
        await waitRoll(g);
      } else {
        setStatus(turnTitle(c), 'A IA está jogando…'); await sleep(650);
      }
      if (!live()) return;
      const v = 1 + Math.floor(Math.random() * 6);
      await rollDice(g, v); if (!live()) return;
      g.roll = v;
      if (v === 6) {
        g.sixes++;
        if (g.sixes >= 3) {
          toast('Três 6 seguidos! Perdeu a vez', 1500); setStatus(turnTitle(c), 'Três 6 seguidos: a vez passa'); Snd.nomove();
          await sleep(1600); break;
        }
      } else g.sixes = 0;
      const moves = getMoves(g, c, v);
      if (!moves.length) {
        setStatus(turnTitle(c), 'Saiu ' + v + '. Sem jogadas possíveis'); toast('Sem jogadas possíveis'); Snd.nomove();
        await sleep(1200); break;
      }
      const uniq = uniqueMoves(g, c, moves); let pawn;
      if (uniq.length === 1 && (seat.type === 'ai' || cfg.auto)) {
        setStatus(turnTitle(c), 'Saiu ' + v); await sleep(seat.type === 'ai' ? 550 : 380); pawn = uniq[0];
      } else if (seat.type === 'ai') {
        setStatus(turnTitle(c), 'Saiu ' + v); await sleep(700); pawn = aiChoose(g, c, v, moves);
      } else {
        setStatus(turnTitle(c), 'Saiu ' + v + '. Escolha um peão brilhante'); pawn = await waitSelect(g, moves);
      }
      if (!live()) return;
      const res = await movePawn(g, c, pawn, v); if (!live()) return;
      renderScore();
      if (g.pawns[c].every(p => p === 56)) {
        g.over = true; wins[c]++; store.set('ludo.wins', wins); renderScore(); Snd.win(); confetti();
        setStatus(COL[c].name + ' venceu!', 'Fim de jogo');
        await sleep(1300); if (!live()) return; showWin(c); return;
      }
      if (v === 6 || res.captured || res.finished) {
        again = true; setStatus(turnTitle(c), 'Jogue novamente!');
        if (v === 6 && !res.captured && !res.finished) toast('Seis! Jogue de novo');
        await sleep(500); if (!live()) return;
      }
    }
    if (live() && !g.over) g.cur = (g.cur + 1) % g.active.length;
  }
}

/* ================= entrada (toque / teclado) ================= */
cv.addEventListener('pointerdown', e => {
  Snd.init();
  const g = G; if (!g || g.dead || !g.selectResolve) return;
  e.preventDefault();
  const rect = cv.getBoundingClientRect(), px = (e.clientX - rect.left) / rect.width * 15, py = (e.clientY - rect.top) / rect.height * 15;
  const c = g.active[g.cur]; let best = -1, bd = 1e9;
  for (const i of g.selectable) {
    const v = g.vis[c][i], p = g.pawns[c][i], np = p === -1 ? 0 : p + g.roll, [dx, dy] = basePos(c, np, i);
    const d = Math.min(Math.hypot(v.x - px, v.y - py), Math.hypot(dx - px, dy - py) + .5);
    if (d < bd) { bd = d; best = i; }
  }
  if (best >= 0 && bd < 2.4) { const r = g.selectResolve; g.selectResolve = null; g.selectable = []; Snd.click(); r(best); }
  else toast('Toque em um peão brilhante', 1000);
});
cv.addEventListener('contextmenu', e => e.preventDefault());
$('#dice').addEventListener('click', onRollPress);
$('#bRoll').addEventListener('click', onRollPress);
window.addEventListener('keydown', e => {
  if ((e.code === 'Space' || e.code === 'Enter') && screen === 'game' && e.target === document.body && !$('.modal.open')) { e.preventDefault(); onRollPress(); }
});

/* ================= telas / modais ================= */
function show(s) {
  screen = s;
  ['menu', 'setup', 'game'].forEach(id => {
    const el = $('#' + id), on = id === s;
    el.classList.toggle('hidden', !on);
    el.classList.remove('enter');
    if (on) { void el.offsetWidth; el.classList.add('enter'); }
  });
  $('#bgfx').classList.toggle('hidden', s === 'game');
  if (s === 'game') requestAnimationFrame(() => { resize(); });
}
const openM = id => $('#' + id).classList.add('open');
const closeM = id => $('#' + id).classList.remove('open');
$$('[data-close]').forEach(b => b.addEventListener('click', () => closeM(b.dataset.close)));
$$('.modal').forEach(m => m.addEventListener('pointerdown', e => { if (e.target === m && m.id !== 'mWin') m.classList.remove('open'); }));
function confirmBox(title, text, ok, fn) {
  $('#cTitle').textContent = title; $('#cText').textContent = text; $('#cYes').textContent = ok;
  $('#cYes').onclick = () => { closeM('mConfirm'); fn(); }; openM('mConfirm');
}
$('#cNo').addEventListener('click', () => closeM('mConfirm'));

function goMenu() { if (G) G.dead = true; closeM('mWin'); show('menu'); }
function goSetup() { if (G) G.dead = true; closeM('mWin'); renderSetup(); show('setup'); }

function showWin(c) {
  const g = G;
  $('#wTitle').textContent = (g.seats[c].name === 'Você' ? 'Você venceu!' : COL[c].name + ' venceu!');
  $('#wText').textContent = 'Todos os 4 peões chegaram ao centro.';
  const rank = g.active.slice().sort((a, b) => {
    const ha = g.pawns[a].filter(p => p === 56).length, hb = g.pawns[b].filter(p => p === 56).length;
    return hb - ha || g.pawns[b].reduce((x, y) => x + Math.max(0, y), 0) - g.pawns[a].reduce((x, y) => x + Math.max(0, y), 0);
  });
  $('#wRank').innerHTML = rank.map((k, n) =>
    '<li style="--c:var(--c' + k + ')">' + (n === 0 ? '🥇' : n === 1 ? '🥈' : n === 2 ? '🥉' : '4º') + ' ' + g.seats[k].name +
    '<span>' + g.pawns[k].filter(p => p === 56).length + '/4 em casa</span></li>').join('');
  openM('mWin');
}

function confetti() {
  const cvs = $('#confetti'); cvs.width = innerWidth; cvs.height = innerHeight;
  const x = cvs.getContext('2d'), W = cvs.width, H = cvs.height;
  const ps = Array.from({ length: 150 }, () => ({
    x: Math.random() * W, y: -20 - Math.random() * H * .6, vx: (Math.random() - .5) * 2.2, vy: 2.5 + Math.random() * 4,
    s: 6 + Math.random() * 8, r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: COL[Math.floor(Math.random() * 4)].main
  }));
  const t0 = performance.now();
  (function f(now) {
    x.clearRect(0, 0, W, H);
    for (const p of ps) { p.x += p.vx; p.y += p.vy; p.r += p.vr; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * .6); x.restore(); }
    if (now - t0 < 4800) requestAnimationFrame(f); else x.clearRect(0, 0, W, H);
  })(t0);
}

function startGame() {
  const slots = cfg.slots, active = [0, 1, 2, 3].filter(i => slots[i] !== 'off');
  if (active.length < 2) {
    $('#menuWarn').textContent = 'Escolha pelo menos 2 jogadores.';
    const sl = $('#slots'); sl.classList.remove('shake'); void sl.offsetWidth; sl.classList.add('shake'); return;
  }
  $('#menuWarn').textContent = '';
  if (G) G.dead = true;
  closeM('mWin'); closeM('mConfirm');
  const humans = active.filter(i => slots[i] === 'human');
  const seats = [0, 1, 2, 3].map(i => ({ type: slots[i], name: COL[i].name }));
  if (humans.length === 1 && active.length > 1) seats[humans[0]].name = 'Você';
  const g = {
    dead: false, seats, active, cur: 0, pawns: [0, 1, 2, 3].map(() => [-1, -1, -1, -1]), vis: [[], [], [], []],
    roll: 1, sixes: 0, over: false, selectable: [], rollResolve: null, selectResolve: null
  };
  for (const c of active) for (let i = 0; i < 4; i++) { const [x, y] = basePos(c, -1, i); g.vis[c][i] = { x, y, z: 0, s: 1, anim: false }; }
  G = g; parts.length = 0;
  setDice(1); setCanRoll(false); renderScore();
  show('game'); run(g);
}

function effectiveDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
function renderSetup() {
  $('#slots').innerHTML = cfg.slots.map((t, i) =>
    '<button class="slot' + (t === 'off' ? ' off' : '') + '" data-i="' + i + '" style="--c:var(--c' + i + ')"><svg viewBox="0 0 48 64"><use href="#pawn"/></svg>' +
    '<span class="st"><b>' + COL[i].name + '</b><em>' + LABEL[t] + '</em></span></button>').join('');
  $$('#slots .slot').forEach(b => b.onclick = () => {
    const i = +b.dataset.i; cfg.slots[i] = NEXT[cfg.slots[i]]; Snd.init(); Snd.click(); saveCfg(); $('#menuWarn').textContent = ''; renderSetup();
  });
  $$('#diff button').forEach(b => b.classList.toggle('on', +b.dataset.d === cfg.diff));
  $('#swSound').classList.toggle('on', cfg.sound); $('#swAuto').classList.toggle('on', cfg.auto); $('#swTheme').classList.toggle('on', effectiveDark());
  $('#winList').innerHTML = [0, 1, 2, 3].map(i => '<span style="--c:var(--c' + i + ')"><i></i>' + wins[i] + '</span>').join('');
  $('#bSound').textContent = cfg.sound ? '🔊' : '🔇';
}
$$('#diff button').forEach(b => b.addEventListener('click', () => { cfg.diff = +b.dataset.d; saveCfg(); renderSetup(); }));
$('#swSound').addEventListener('click', () => { cfg.sound = !cfg.sound; Snd.on = cfg.sound; Snd.init(); Snd.click(); saveCfg(); renderSetup(); });
$('#swAuto').addEventListener('click', () => { cfg.auto = !cfg.auto; saveCfg(); renderSetup(); });
$('#swTheme').addEventListener('click', () => { cfg.theme = effectiveDark() ? 'light' : 'dark'; document.documentElement.dataset.theme = cfg.theme; saveCfg(); renderSetup(); });
$('#bResetWins').addEventListener('click', () => { wins = [0, 0, 0, 0]; store.set('ludo.wins', wins); renderSetup(); });
$('#bPlay').addEventListener('click', () => { Snd.init(); Snd.click(); renderSetup(); show('setup'); });
$('#sBack').addEventListener('click', () => { Snd.click(); show('menu'); });
$('#sStart').addEventListener('click', () => { Snd.init(); Snd.click(); startGame(); });
$('#bRulesMenu').addEventListener('click', () => openM('mRules'));
$('#bRules').addEventListener('click', () => openM('mRules'));
$('#bSound').addEventListener('click', () => { cfg.sound = !cfg.sound; Snd.on = cfg.sound; Snd.init(); Snd.click(); saveCfg(); renderSetup(); });
$('#bMenu').addEventListener('click', () => {
  if (G && !G.over) confirmBox('Voltar ao menu?', 'A partida atual será encerrada.', 'Sair', goSetup); else goSetup();
});
$('#bRestart').addEventListener('click', () => {
  if (G && !G.over) confirmBox('Reiniciar partida?', 'Todos os peões voltam para a base.', 'Reiniciar', startGame); else startGame();
});
$('#wAgain').addEventListener('click', startGame);
$('#wMenu').addEventListener('click', goSetup);

/* ================= fundo animado do menu ================= */
function buildBgFx() {
  let h = '';
  for (let i = 0; i < 28; i++) {
    const sz = 22 + Math.random() * 28, left = Math.random() * 100, dur = 7 + Math.random() * 8, del = -Math.random() * dur;
    const rot = (Math.random() < .5 ? -1 : 1) * (120 + Math.random() * 420), x = (Math.random() - .5) * 120, k = Math.floor(Math.random() * 4);
    const base = 'left:' + left.toFixed(1) + '%;--d:' + dur.toFixed(1) + 's;--dl:' + del.toFixed(1) + 's;--r:' + rot.toFixed(0) + 'deg;--x:' + x.toFixed(0) + 'px;';
    h += Math.random() < .7
      ? '<svg class="fx" viewBox="0 0 48 64" style="' + base + 'width:' + (sz * .75).toFixed(0) + 'px;height:' + sz.toFixed(0) + 'px;color:var(--c' + k + ')"><use href="#pawn"/></svg>'
      : '<span class="fx" style="' + base + 'width:' + (sz * .6).toFixed(0) + 'px;height:' + (sz * .6).toFixed(0) + 'px;border-radius:50%;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.75),rgba(255,255,255,0) 45%),var(--c' + k + ');box-shadow:inset 0 -3px 0 rgba(0,0,0,.25)"></span>';
  }
  $('#bgfx').innerHTML = h;
}

/* ================= início ================= */
Snd.on = cfg.sound;
buildCube($('#cube'));
setDice(1);
buildBgFx();
renderSetup();
show('menu');
})();