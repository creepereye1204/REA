'use strict';
// Rendering: terrain chunks, y-sorted objects, roofs, lighting, particles, HUD and panels.

let canvas, ctx, VIEW_W = 960, VIEW_H = 640, RS = 1;
const V = {
  me: 0, cam: { x: 0, y: 0 }, parts: [], tracers: [], floaters: [], msgs: [], panel: null, build: false, buildSel: 'wall_wood',
  shake: 0, hurt: 0, chunks: new Map(), roofA: [], mapOpen: false, aimX: 0, aimY: 0, frame: 0, lights: [], help: false, net: '',
  mini: null, ghost: null, banner: null, comm: [], commT: 0, boss: null, ending: null,
};

// ── generated art (item icons, portraits, illustrations) ──────────────────
const ART = { items: null, im: {}, por: null, pm: {}, scenes: {}, sceneSrc: {} };
function loadArt() {
  if (typeof fetch !== 'function' || typeof Image === 'undefined') return;
  fetch('assets/art.json').then(r => r.json()).then(m => {
    ART.im = m.items.map; ART.pm = m.portraits.map; ART.sceneSrc = m.scenes;
    ART.items = new Image(); ART.items.src = 'assets/' + m.items.file;
    ART.por = new Image(); ART.por.src = 'assets/' + m.portraits.file;
    sceneImg('scene_title');
  }).catch(() => {});
}
const imgOk = i => i && i.complete && i.naturalWidth > 0;
function drawIcon(g, key, x, y, s) {
  const r = ART.im[key];
  if (r && imgOk(ART.items)) { g.drawImage(ART.items, r[0], r[1], r[2], r[2], x - s / 2, y - s / 2, s, s); return true; }
  g.fillStyle = '#8a6a40'; g.beginPath(); g.arc(x, y, s * 0.32, 0, TAU); g.fill();
  return false;
}
function drawPortrait(g, key, x, y, s) {
  const r = ART.pm[key];
  if (r && imgOk(ART.por)) { g.drawImage(ART.por, r[0], r[1], r[2], r[2], x, y, s, s); return true; }
  g.fillStyle = '#2a2d36'; g.fillRect(x, y, s, s); g.fillStyle = '#556'; g.beginPath(); g.arc(x + s / 2, y + s * 0.42, s * 0.2, 0, TAU); g.fill(); g.fillRect(x + s * 0.25, y + s * 0.66, s * 0.5, s * 0.34);
  return false;
}
function sceneImg(key) {
  if (!ART.sceneSrc[key]) return null;
  if (!ART.scenes[key]) { ART.scenes[key] = new Image(); ART.scenes[key].src = 'assets/' + ART.sceneSrc[key]; }
  return imgOk(ART.scenes[key]) ? ART.scenes[key] : null;
}
const CH = 16; // chunk size in tiles
const WALL_H = 22;
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) ^ W.seed; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const rnd = (a, b) => a + Math.random() * (b - a);
const meP = () => G && G.players[V.me];

// ── terrain chunks ─────────────────────────────────────────────────────────
function chunkCanvas(cx, cy) {
  const key = cx + ',' + cy;
  let c = V.chunks.get(key);
  if (c) { V.chunks.delete(key); V.chunks.set(key, c); return c; } // LRU touch
  // Each chunk is a 512x512 canvas (~1MB); exploring the whole map kept 120 of them alive.
  // Keep the most recently used 36 (blood decals on evicted chunks are forgotten).
  if (V.chunks.size >= 36) V.chunks.delete(V.chunks.keys().next().value);
  c = document.createElement('canvas'); c.width = c.height = CH * TILE;
  const g = c.getContext('2d');
  for (let y = 0; y < CH; y++) for (let x = 0; x < CH; x++) {
    const tx = cx * CH + x, ty = cy * CH + y;
    if (inMap(tx, ty)) drawGround(g, tx, ty, x * TILE, y * TILE);
  }
  V.chunks.set(key, c);
  return c;
}
function invalidateChunkAt(i) { V.chunks.delete(Math.floor(cellX(i) / CH) + ',' + Math.floor(cellY(i) / CH)); V.mini = null; }
function groundOf(t, x, y) {
  if (t === T.TREE || t === T.ROCK || t === T.STUMP) return T.GRASS;
  if (t === T.WALL || t === T.DOOR) return T.FLOOR;
  if (t === T.FENCE) { const v = W.villages.some(v => x >= v.x && y >= v.y && x < v.x + v.w && y < v.y + v.h); return v ? T.VFLOOR : T.CAMPDIRT; }
  if (t === T.TENT) return T.CAMPDIRT;
  if (t === T.GRAVE) return T.DIRT;
  return t;
}
const GROUND = {
  [T.GRASS]: [62, 92, 46], [T.DIRT]: [104, 88, 60], [T.ROAD]: [56, 57, 61], [T.WALK]: [128, 126, 120], [T.FLOOR]: [120, 90, 60],
  [T.CONCRETE]: [112, 114, 116], [T.WATER]: [38, 86, 120], [T.SAND]: [196, 176, 120], [T.VFLOOR]: [140, 116, 80], [T.CAMPDIRT]: [92, 72, 50],
  [T.CROP]: [96, 84, 52], [T.PAD]: [70, 74, 80],
};
function drawGround(g, tx, ty, px, py) {
  const i = idx(tx, ty), t0 = W.tile[i], t = groundOf(t0, tx, ty), h = hash(tx, ty);
  let [r, gg, b] = GROUND[t] || [80, 80, 80];
  const fs = W.floorStyle[i];
  if (t === T.FLOOR && fs === 2) { const ch = (tx + ty) & 1; [r, gg, b] = ch ? [184, 180, 168] : [168, 164, 152]; }
  if (t === T.FLOOR && fs === 3) [r, gg, b] = [104, 104, 100];
  const v = (h - 0.5) * 14;
  g.fillStyle = `rgb(${r + v | 0},${gg + v | 0},${b + v | 0})`; g.fillRect(px, py, TILE, TILE);
  if (t === T.GRASS) {
    g.fillStyle = 'rgba(30,60,20,0.35)';
    for (let k = 0; k < 4; k++) { const a = hash(tx * 7 + k, ty * 3 - k); g.fillRect(px + a * 30, py + hash(tx + k, ty * 5) * 30, 2, 4); }
    if (h > 0.93) { g.fillStyle = ['#d8d860', '#e0a0c0', '#f0f0f0'][(h * 1000 | 0) % 3]; g.fillRect(px + h * 24, py + (1 - h) * 24 + 4, 3, 3); }
  } else if (t === T.DIRT || t === T.CAMPDIRT || t === T.VFLOOR) {
    g.fillStyle = 'rgba(0,0,0,0.12)'; for (let k = 0; k < 3; k++) g.fillRect(px + hash(tx + k, ty) * 28, py + hash(tx, ty + k) * 28, 3, 2);
  } else if (t === T.ROAD) {
    const R = W.roads, b0 = W.base;
    const centerH = ty === b0.cy || ty === R.ry1 || ty === R.ry2, centerV = tx === b0.cx || tx === R.rx1 || tx === R.rx2;
    g.fillStyle = 'rgba(0,0,0,0.15)'; if (h > 0.8) g.fillRect(px + 4 + h * 10, py + 8, 8, 5);
    g.fillStyle = '#c8b040';
    if (centerH && !centerV && tx % 3 !== 0) g.fillRect(px, py + 15, TILE, 2);
    if (centerV && !centerH && ty % 3 !== 0) g.fillRect(px + 15, py, 2, TILE);
  } else if (t === T.WALK) {
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1; g.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
  } else if (t === T.FLOOR && fs === 1) {
    g.fillStyle = 'rgba(0,0,0,0.18)'; for (let k = 0; k < 4; k++) g.fillRect(px, py + k * 8, TILE, 1);
    g.fillRect(px + ((ty * 13) % 4) * 8, py, 1, TILE);
  } else if (t === T.CONCRETE) {
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.strokeRect(px + 0.5, py + 0.5, TILE, TILE);
    const b0 = W.base;
    if ((tx === b0.x + 1 || tx === b0.x + b0.w - 2 || ty === b0.y + 1 || ty === b0.y + b0.h - 2) && ((tx + ty) % 2)) { g.fillStyle = 'rgba(220,180,40,0.55)'; g.fillRect(px + 6, py + 6, 20, 20); }
  } else if (t === T.WATER) {
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(px + h * 20, py + 10, 10, 2); g.fillRect(px + (1 - h) * 18, py + 22, 8, 2);
  } else if (t === T.SAND) {
    g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(px + h * 28, py + h * 20, 2, 2);
  } else if (t === T.CROP) {
    g.fillStyle = '#5a7a2a'; for (let k = 0; k < 4; k++) { const cx2 = px + 4 + k * 8; g.fillRect(cx2, py + 6, 3, 20); g.fillStyle = k % 2 ? '#7a9a3a' : '#5a7a2a'; g.fillRect(cx2 - 2, py + 4 + hash(tx + k, ty) * 6, 7, 5); }
  } else if (t === T.PAD) {
    g.strokeStyle = 'rgba(240,210,60,.8)'; g.lineWidth = 2;
    if (W.tile[idx(tx, ty - 1)] !== T.PAD) { g.beginPath(); g.moveTo(px, py + 2); g.lineTo(px + TILE, py + 2); g.stroke(); }
    if (W.tile[idx(tx, ty + 1)] !== T.PAD) { g.beginPath(); g.moveTo(px, py + TILE - 2); g.lineTo(px + TILE, py + TILE - 2); g.stroke(); }
    if (W.tile[idx(tx - 1, ty)] !== T.PAD) { g.beginPath(); g.moveTo(px + 2, py); g.lineTo(px + 2, py + TILE); g.stroke(); }
    if (W.tile[idx(tx + 1, ty)] !== T.PAD) { g.beginPath(); g.moveTo(px + TILE - 2, py); g.lineTo(px + TILE - 2, py + TILE); g.stroke(); }
  }
  if (t0 === T.DOOR) { g.fillStyle = '#5a3a20'; g.fillRect(px + 2, py + 2, TILE - 4, TILE - 4); g.fillStyle = '#7a5a34'; g.fillRect(px + 5, py + 5, TILE - 10, TILE - 10); }
  if (t0 === T.STUMP) { g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(px + 16, py + 20, 9, 4, 0, 0, TAU); g.fill(); g.fillStyle = '#6a4a2a'; g.beginPath(); g.arc(px + 16, py + 17, 7, 0, TAU); g.fill(); g.fillStyle = '#a07a4a'; g.beginPath(); g.arc(px + 16, py + 16, 5, 0, TAU); g.fill(); }
}
function decal(x, y, r, color, n) {
  const cx = Math.floor(x / CH), cy = Math.floor(y / CH), c = V.chunks.get(cx + ',' + cy);
  if (!c) return;
  const g = c.getContext('2d'), ox = (x - cx * CH) * TILE, oy = (y - cy * CH) * TILE;
  g.fillStyle = color;
  for (let k = 0; k < n; k++) { g.globalAlpha = rnd(0.25, 0.6); g.beginPath(); g.arc(ox + rnd(-r, r) * TILE, oy + rnd(-r, r) * TILE, rnd(1.5, 2 + r * TILE * 0.3), 0, TAU); g.fill(); }
  g.globalAlpha = 1;
}
function miniMap() {
  if (V.mini) return V.mini;
  const c = document.createElement('canvas'); c.width = MW; c.height = MH;
  const g = c.getContext('2d'), im = g.createImageData(MW, MH);
  for (let i = 0; i < MW * MH; i++) {
    const t = W.tile[i];
    const col = t === T.TREE ? [30, 60, 24] : t === T.WALL ? [150, 120, 100] : t === T.FENCE ? [120, 90, 50] : t === T.ROCK ? [110, 110, 110] : t === T.TENT ? [130, 110, 70] : GROUND[groundOf(t, cellX(i), cellY(i))] || [80, 80, 80];
    im.data.set([col[0], col[1], col[2], 255], i * 4);
  }
  g.putImageData(im, 0, 0);
  return (V.mini = c);
}

// ── fx from the simulation (local or network) ──────────────────────────────
function applyFx(o) {
  const me = meP();
  switch (o.k) {
    case 'msg': if (o.pid === -1 || o.pid === undefined || o.pid === V.me) { V.msgs.push({ text: o.text, c: o.c, ttl: o.big ? 4.5 : 3, big: o.big }); if (V.msgs.length > 6) V.msgs.shift(); } break;
    case 'sfx': sfx(o.n, o.x, o.y); break;
    case 'tr': V.tracers.push({ ...o, t: 0, life: o.c === 2 ? 0.25 : 0.06 }); break;
    case 'flash': V.parts.push({ k: 'flash', x: o.x, y: o.y, a: o.a, t: 0, life: 0.05 }); V.lights.push({ x: o.x, y: o.y, r: 3, t: 0.06 }); break;
    case 'blood': for (let k = 0; k < 5; k++) V.parts.push({ k: 'drop', x: o.x, y: o.y, z: 0.6, vx: rnd(-2, 2), vy: rnd(-2, 2), vz: rnd(1, 3), c: o.z ? '#3a5a1a' : '#8a1010', t: 0, life: 0.6 }); decal(o.x, o.y, 0.25, o.z ? '#2a3a12' : '#5b0f0f', 2); break;
    case 'gib': for (let k = 0; k < (o.big ? 14 : 8); k++) V.parts.push({ k: 'chunk', x: o.x, y: o.y, z: 0.6, vx: rnd(-3, 3), vy: rnd(-3, 3), vz: rnd(2, 5), c: k % 2 ? o.c : '#5a0a0a', t: 0, life: 0.9 }); decal(o.x, o.y, o.big ? 0.6 : 0.4, '#4a0c0c', o.big ? 14 : 8); break;
    case 'boom':
      V.parts.push({ k: 'boom', x: o.x, y: o.y, r: o.r, fire: o.fire, t: 0, life: o.r > 1 ? 0.45 : 0.25 });
      if (o.r > 1) {
        for (let k = 0; k < 10; k++) V.parts.push({ k: 'smoke', x: o.x + rnd(-1, 1), y: o.y + rnd(-1, 1), t: 0, life: rnd(0.8, 1.6), s: rnd(6, 14) });
        V.lights.push({ x: o.x, y: o.y, r: o.r * 3, t: 0.3 });
        decal(o.x, o.y, o.r * 0.35, '#1d1a17', 12); sfx('boom', o.x, o.y);
        if (me && dist(me.x, me.y, o.x, o.y) < 14) V.shake = Math.max(V.shake, 14 - dist(me.x, me.y, o.x, o.y));
      } else V.lights.push({ x: o.x, y: o.y, r: 2, t: 0.15 });
      break;
    case 'splat': V.parts.push({ k: 'boom', x: o.x, y: o.y, r: 0.5, green: 1, t: 0, life: 0.3 }); decal(o.x, o.y, 0.3, '#5a8a20', 4); break;
    case 'spark': V.parts.push({ k: 'spark', x: o.x, y: o.y, t: 0, life: 0.15 }); break;
    case 'debris': for (let k = 0; k < 10; k++) V.parts.push({ k: 'chunk', x: o.x, y: o.y, z: 0.5, vx: rnd(-3, 3), vy: rnd(-3, 3), vz: rnd(2, 5), c: o.c, t: 0, life: 0.8 }); break;
    case 'swing': V.parts.push({ k: 'swing', x: o.x, y: o.y, a: o.a, t: 0, life: 0.15 }); break;
    case 'scream': V.parts.push({ k: 'ring', x: o.x, y: o.y, t: 0, life: 0.8 }); break;
    case 'float': V.floaters.push({ x: o.x, y: o.y, text: o.text, c: o.c, icon: o.icon, t: 0, life: o.icon ? 1.8 : 1.4 }); break;
    case 'hurt': if (o.pid === V.me) { V.hurt = 1; V.shake = Math.max(V.shake, 5); sfx('hurt'); } break;
    case 'tile': W.tile[o.i] = o.v; updateCellMB(o.i); invalidateChunkAt(o.i); break;
    case 'cont': if (W.conts[o.id]) W.conts[o.id].looted = !!o.v; break;
    case 'tp': break;
    case 'over': sfx('over'); break;
    case 'comm': if (o.pid === -1 || o.pid === undefined || o.pid === V.me) { for (const l of o.lines) V.comm.push(l); if (V.comm.length === o.lines.length) V.commT = 0; sfx('beep'); } break;
    case 'boss': V.boss = { por: o.por, name: o.name, t: 4.5 }; break;
    case 'ending': V.ending = { key: o.e, t: 0 }; break;
    case 'smoke': for (let k = 0; k < 8; k++) V.parts.push({ k: 'smoke', x: o.x + rnd(-0.6, 0.6), y: o.y + rnd(-0.6, 0.6), t: 0, life: rnd(0.4, 0.9), s: rnd(5, 10) }); break;
  }
}

// ── main draw ─────────────────────────────────────────────────────────────
function darkness() {
  const c = G.clock;
  if (c >= DAWN + 30 && c < DUSK) return 0;
  if (c >= DUSK && c < NIGHT) return (c - DUSK) / 60 * 0.6;
  if (c >= LATE && c < DAWN + 30) return 0.82 * (1 - (c - LATE) / 90);
  const m = c >= NIGHT ? c - NIGHT : c + 1440 - NIGHT; // minutes into the night
  return 0.6 + 0.26 * Math.sin(Math.min(1, m / 540) * Math.PI);
}
let lightCv = null, lightG = null;
function draw(dtReal) {
  const g = ctx;
  V.frame++; V.dt = Math.min(0.05, dtReal || 0.016);
  g.setTransform(RS, 0, 0, RS, 0, 0);
  g.fillStyle = '#0d0e11'; g.fillRect(0, 0, VIEW_W, VIEW_H);
  if (!G) { drawTitle(g); drawUI(g); return; }
  const me = meP();
  const zoom = 1;
  const tx = me.x * TILE - VIEW_W / 2, ty = me.y * TILE - VIEW_H / 2;
  if (!V.camInit) { V.cam.x = tx; V.cam.y = ty; V.camInit = true; }
  V.cam.x += (tx - V.cam.x) * 0.15; V.cam.y += (ty - V.cam.y) * 0.15;
  V.cam.x = clamp(V.cam.x, -TILE * 2, MW * TILE - VIEW_W + TILE * 2); V.cam.y = clamp(V.cam.y, -TILE * 2, MH * TILE - VIEW_H + TILE * 2);
  const sx = Math.round(V.cam.x + rnd(-V.shake, V.shake)), sy = Math.round(V.cam.y + rnd(-V.shake, V.shake));
  V.shake *= 0.85; if (V.shake < 0.3) V.shake = 0;
  g.save(); g.translate(-sx, -sy); g.scale(zoom, zoom);

  // ground
  const c0x = Math.floor(sx / TILE / CH), c1x = Math.floor((sx + VIEW_W) / TILE / CH), c0y = Math.floor(sy / TILE / CH), c1y = Math.floor((sy + VIEW_H + WALL_H) / TILE / CH);
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) if (cx >= 0 && cy >= 0 && cx * CH < MW && cy * CH < MH) g.drawImage(chunkCanvas(cx, cy), cx * CH * TILE, cy * CH * TILE);

  // flat things: spikes, mines, drops, build radius
  const x0 = Math.max(0, Math.floor(sx / TILE) - 1), x1 = Math.min(MW, Math.ceil((sx + VIEW_W) / TILE) + 1);
  const y0 = Math.max(0, Math.floor(sy / TILE) - 1), y1 = Math.min(MH, Math.ceil((sy + VIEW_H) / TILE) + 2);
  if (V.build) { g.strokeStyle = 'rgba(120,200,255,0.35)'; g.setLineDash([8, 8]); g.lineWidth = 2; g.beginPath(); g.arc(G.core.x * TILE, G.core.y * TILE, BUILD_RADIUS * TILE, 0, TAU); g.stroke(); g.setLineDash([]); }
  for (const s of G.structs) if (!s.def.block && s.x > x0 - 1 && s.x < x1 + 1 && s.y > y0 - 1 && s.y < y1 + 1) drawStruct(g, s);
  for (const d of G.drops) drawDrop(g, d);
  for (const h of G.hazards) drawHazard(g, h);
  for (const P of W.pois) if (P.key === 'helipad' && P.x < x1 && P.x + P.w > x0 && P.y < y1 && P.y + P.h > y0) {
    const hx = (P.x + P.w / 2) * TILE, hy = (P.y + P.h / 2) * TILE;
    g.strokeStyle = 'rgba(240,240,240,.75)'; g.lineWidth = 5; g.beginPath(); g.arc(hx, hy, 3 * TILE - 8, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(240,240,240,.8)'; g.fillRect(hx - 30, hy - 40, 14, 80); g.fillRect(hx + 16, hy - 40, 14, 80); g.fillRect(hx - 16, hy - 7, 32, 14);
  }

  // y-sorted tall things
  const list = [];
  const viewEnts = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = idx(x, y), t = W.tile[i];
    if (t === T.WALL) list.push({ y: y + 1, f: drawWallTile, a: x, b: y });
    else if (t === T.TREE) list.push({ y: y + 0.8, f: drawTree, a: x, b: y });
    else if (t === T.ROCK) list.push({ y: y + 0.8, f: drawRock, a: x, b: y });
    else if (t === T.FENCE) list.push({ y: y + 0.9, f: drawFence, a: x, b: y });
    else if (t === T.TENT) list.push({ y: y + 1, f: drawTent, a: x, b: y });
    else if (t === T.GRAVE) list.push({ y: y + 0.8, f: drawGrave, a: x, b: y });
    const c = W.contAt[i];
    if (c && c.cells[0] === i) list.push({ y: c.y + 0.4, f: drawCont, a: c });
    const s = W.structAt[i];
    if (s && s.def.block && (s.cells[0] === i)) list.push({ y: s.y + (s.type === 'core' ? 1 : 0.5), f: drawStruct, a: s });
  }
  for (const e of G.ents) {
    const ex = e.rx !== undefined ? e.rx : e.x, ey = e.ry !== undefined ? e.ry : e.y;
    if (ex < x0 - 1 || ex > x1 + 1 || ey < y0 - 1 || ey > y1 + 2) continue;
    viewEnts.push(e);
    list.push({ y: ey + 0.3, f: drawEnt, a: e });
  }
  for (const p of G.players) if (p && p.joined && !p.dead) list.push({ y: p.y + 0.3, f: drawPlayer, a: p });
  for (const s of G.shots) list.push({ y: s.y + 0.3, f: drawShot, a: s });
  for (const P of W.pois) if (P.mast && P.mast.x > x0 - 2 && P.mast.x < x1 + 2 && P.mast.y > y0 - 2 && P.mast.y < y1 + 6) list.push({ y: P.mast.y + 0.5, f: drawMast, a: P.mast });
  list.sort((p, q) => p.y - q.y);
  for (const d of list) d.f(g, d.a, d.b);

  // roofs (fade when a local player is inside)
  for (const b of W.buildings) {
    if (b.x > x1 || b.x + b.w < x0 || b.y > y1 || b.y + b.h < y0 - 1) continue;
    const inside = me.x > b.x && me.x < b.x + b.w && me.y > b.y && me.y < b.y + b.h;
    const a = V.roofA[b.id] = lerp(V.roofA[b.id] === undefined ? 1 : V.roofA[b.id], inside ? 0 : 1, 0.15);
    if (a < 0.02) continue;
    drawRoof(g, b, a);
  }
  for (const P of W.pois) if (P.canopy && P.canopy.x < x1 && P.canopy.x + P.canopy.w > x0 && P.canopy.y < y1 && P.canopy.y + P.canopy.h > y0 - 2) {
    const c = P.canopy, under = inRect(me.x, me.y, c), a = V.canopyA = lerp(V.canopyA === undefined ? 1 : V.canopyA, under ? 0.25 : 0.9, 0.15);
    g.globalAlpha = a; g.fillStyle = '#c83a2a'; g.fillRect(c.x * TILE, c.y * TILE - 40, c.w * TILE, 14); g.fillStyle = '#e8e8e8'; g.fillRect(c.x * TILE, c.y * TILE - 26, c.w * TILE, c.h * TILE - 20); g.globalAlpha = 1;
  }
  // particles / tracers / floaters
  for (const t of V.tracers) {
    g.globalAlpha = 1 - t.t / t.life; g.strokeStyle = t.c === 2 ? '#bfe6ff' : '#ffe9a0'; g.lineWidth = t.c === 2 ? 3 : 1.6;
    g.beginPath(); g.moveTo(t.x1 * TILE, t.y1 * TILE - 14); g.lineTo(t.x2 * TILE, t.y2 * TILE - 14); g.stroke();
  }
  g.globalAlpha = 1;
  for (const p of V.parts) drawPart(g, p);
  // build ghost
  if (V.build && V.ghost) {
    const ok = V.ghost.ok, gx = cellX(V.ghost.cell) * TILE, gy = cellY(V.ghost.cell) * TILE;
    g.globalAlpha = 0.55; drawStruct(g, { type: V.buildSel, def: STRUCTS[V.buildSel], x: cellX(V.ghost.cell) + 0.5, y: cellY(V.ghost.cell) + 0.5, hp: 1, maxHp: 1, angle: -1.57, cells: [V.ghost.cell], ghost: 1 }); g.globalAlpha = 1;
    g.strokeStyle = ok ? '#7dff9a' : '#ff5c4c'; g.lineWidth = 2; g.strokeRect(gx + 1, gy + 1, TILE - 2, TILE - 2);
  }
  // labels over entities (names, eyes, alerts)
  g.textAlign = 'center';
  for (const e of viewEnts) drawEntLabel(g, e);
  for (const p of G.players) if (p && p.joined && !p.dead) {
    g.font = 'bold 11px system-ui, sans-serif'; g.fillStyle = p.color; g.fillText(p.name, p.x * TILE, p.y * TILE - 46);
    if (p.down) { g.fillStyle = '#ff6b5c'; g.fillText(`쓰러짐 ${Math.ceil(p.downT)}s`, p.x * TILE, p.y * TILE - 58); }
  }
  for (const f of V.floaters) {
    g.globalAlpha = clamp(2 - f.t / f.life * 2, 0, 1); g.font = 'bold 12px system-ui, sans-serif';
    const fy = f.y * TILE - 30 - f.t * 20, fxx = f.x * TILE + (f.icon ? 10 : 0);
    if (f.icon) { const w = g.measureText(f.text).width; drawIcon(g, f.icon, fxx - w / 2 - 14, fy - 4, 24); }
    g.fillStyle = '#000'; g.fillText(f.text, fxx + 1, fy + 1);
    g.fillStyle = f.c; g.fillText(f.text, fxx, fy);
  }
  g.globalAlpha = 1;
  // use progress
  if (me.useP > 0) {
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 6; g.beginPath(); g.arc(me.x * TILE, me.y * TILE - 20, 18, 0, TAU); g.stroke();
    g.strokeStyle = '#ffd166'; g.lineWidth = 4; g.beginPath(); g.arc(me.x * TILE, me.y * TILE - 20, 18, -Math.PI / 2, -Math.PI / 2 + TAU * me.useP); g.stroke();
  }
  g.restore();

  drawLighting(g, sx, sy);
  drawHud(g);
  drawUI(g);
  // advance local particles in real time
  const dt = Math.min(0.05, dtReal);
  for (const p of V.parts) { p.t += dt; if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; p.vz -= 12 * dt; p.z += p.vz * dt; if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.5; p.vy *= 0.5; } } }
  V.parts = V.parts.filter(p => p.t < p.life);
  for (const t of V.tracers) t.t += dt; V.tracers = V.tracers.filter(t => t.t < t.life);
  for (const f of V.floaters) f.t += dt; V.floaters = V.floaters.filter(f => f.t < f.life);
  for (const l of V.lights) l.t -= dt; V.lights = V.lights.filter(l => l.t > 0);
  for (const m of V.msgs) m.ttl -= dt; V.msgs = V.msgs.filter(m => m.ttl > 0);
  V.hurt = Math.max(0, V.hurt - dt * 2);
}

// ── tall object painters ───────────────────────────────────────────────────
function drawWallTile(g, x, y) {
  const px = x * TILE, py = y * TILE, b = W.buildings[W.bldAt[idx(x, y)]];
  const top = b ? shade(b.roof, 0.75) : '#6a6a6a';
  g.fillStyle = '#3a3330'; g.fillRect(px, py + TILE - WALL_H, TILE, WALL_H);
  g.fillStyle = '#5a504a'; g.fillRect(px, py + TILE - WALL_H, TILE, 3);
  g.fillStyle = top; g.fillRect(px, py - WALL_H, TILE, TILE);
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(px, py - WALL_H, TILE, 2);
}
function drawTree(g, x, y) {
  const px = x * TILE + 16, py = y * TILE + 16, h = hash(x, y), s = 0.85 + h * 0.4;
  const sway = Math.sin(V.frame / 60 + h * 10) * 1.5;
  g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(px + 4, py + 8, 18 * s, 8 * s, 0, 0, TAU); g.fill();
  g.fillStyle = '#4a3020'; g.fillRect(px - 3, py - 10, 6, 18);
  const cols = h > 0.5 ? ['#1f4a22', '#2a5e2c', '#3a7a36'] : ['#26472a', '#30603a', '#43784a'];
  for (let k = 0; k < 3; k++) { g.fillStyle = cols[k]; g.beginPath(); g.arc(px + sway * (k + 1) / 3 - k * 2, py - 22 - k * 5, (18 - k * 4) * s, 0, TAU); g.fill(); }
}
function drawRock(g, x, y) {
  const px = x * TILE + 16, py = y * TILE + 18;
  g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(px + 2, py + 4, 15, 6, 0, 0, TAU); g.fill();
  g.fillStyle = '#6a6a6e'; g.beginPath(); g.ellipse(px, py - 4, 14, 11, 0, 0, TAU); g.fill();
  g.fillStyle = '#8a8a8e'; g.beginPath(); g.ellipse(px - 3, py - 8, 8, 6, 0, 0, TAU); g.fill();
}
function drawFence(g, x, y) {
  const px = x * TILE, py = y * TILE;
  g.fillStyle = '#5a4026'; g.fillRect(px + 2, py + 4, 4, 22); g.fillRect(px + 26, py + 4, 4, 22);
  g.fillStyle = '#8a6a3e'; g.fillRect(px, py + 8, TILE, 4); g.fillRect(px, py + 18, TILE, 4);
}
function drawTent(g, x, y) {
  const px = x * TILE, py = y * TILE;
  g.fillStyle = '#4a4a30'; g.fillRect(px, py + 6, TILE, 26);
  g.fillStyle = (x + y) % 2 ? '#7a7448' : '#6a6440'; g.fillRect(px, py - 10, TILE, 18);
}
function drawRoof(g, b, a) {
  const px = b.x * TILE, py = b.y * TILE - WALL_H, w = b.w * TILE, h = b.h * TILE;
  g.globalAlpha = a;
  g.fillStyle = b.roof; g.fillRect(px - 3, py - 3, w + 6, h + 6);
  g.fillStyle = shade(b.roof, 1.15); g.fillRect(px - 3, py - 3, w + 6, h / 2 + 3);
  g.fillStyle = 'rgba(0,0,0,.15)'; for (let k = 8; k < h; k += 8) g.fillRect(px - 3, py + k, w + 6, 1);
  g.fillStyle = shade(b.roof, 0.7); g.fillRect(px - 3, py + h / 2, w + 6, 3);
  if (a > 0.6) {
    g.font = 'bold 12px system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.75)';
    const lbl = b.village >= 0 ? '민가' : b.name;
    g.fillText(lbl, px + w / 2, py + h / 2 - 6);
  }
  g.globalAlpha = 1;
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) * k, 0, 255) | 0, gg = clamp(((n >> 8) & 255) * k, 0, 255) | 0, b = clamp((n & 255) * k, 0, 255) | 0;
  return `rgb(${r},${gg},${b})`;
}
function drawCont(g, c) {
  const D = CONTAINERS[c.kind], x = c.x * TILE, y = c.y * TILE;
  const dim = c.looted ? 0.6 : 1;
  if (c.kind === 'car') {
    const w = c.horiz ? 60 : 28, h = c.horiz ? 28 : 60;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x - w / 2 + 3, y - h / 2 + 6, w, h);
    g.fillStyle = shade(c.color || '#555', dim); g.fillRect(x - w / 2, y - h / 2 - 8, w, h);
    g.fillStyle = 'rgba(160,200,230,.55)';
    if (c.horiz) { g.fillRect(x - 14, y - h / 2 - 4, 10, h - 8); g.fillRect(x + 6, y - h / 2 - 4, 8, h - 8); }
    else { g.fillRect(x - w / 2 + 4, y - 22, w - 8, 10); g.fillRect(x - w / 2 + 4, y + 4, w - 8, 8); }
    g.fillStyle = '#111'; if (c.horiz) { g.fillRect(x - 24, y + 4, 10, 4); g.fillRect(x + 14, y + 4, 10, 4); }
  } else {
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x - 13, y + 4, 28, 8);
    g.fillStyle = shade(D.color, 0.7 * dim); g.fillRect(x - 13, y - 6, 26, 14);
    g.fillStyle = shade(D.color, dim); g.fillRect(x - 13, y - 16, 26, 12);
    if (c.kind === 'fridge' || c.kind === 'locker' || c.kind === 'medcab') { g.fillStyle = shade(D.color, 0.85 * dim); g.fillRect(x - 11, y - 26, 22, 12); }
    if (c.kind === 'medcab') { g.fillStyle = '#d33'; g.fillRect(x - 2, y - 24, 4, 10); g.fillRect(x - 5, y - 21, 10, 4); }
    if (c.kind === 'safe') { g.fillStyle = '#999'; g.beginPath(); g.arc(x, y - 4, 4, 0, TAU); g.fill(); }
  }
  if (!c.looted) {
    const p = meP();
    if (p && dist(p.x, p.y, c.x, c.y) < 6) {
      g.fillStyle = c.village >= 0 ? '#ff8a5c' : '#ffd166';
      g.globalAlpha = 0.6 + 0.4 * Math.sin(V.frame / 8);
      g.beginPath(); g.arc(x, y - 30, 3, 0, TAU); g.fill(); g.globalAlpha = 1;
    }
  }
}
function drawDrop(g, d) {
  const x = d.x * TILE, y = d.y * TILE, b = Math.sin(V.frame / 12 + d.id) * 2.5;
  const key = d.top || (d.items ? dropTop(d) : 'bag'), rare = /^(keycard|sample|wpn_|gold|jewel|armor)/.test(key);
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(x, y + 5, 12, 4.5, 0, 0, TAU); g.fill();
  const pulse = 0.35 + 0.25 * Math.sin(V.frame / 9 + d.id);
  g.fillStyle = rare ? `rgba(255,200,60,${pulse})` : `rgba(255,255,255,${pulse * 0.45})`; g.beginPath(); g.ellipse(x, y + 3, 15, 6, 0, 0, TAU); g.fill();
  drawIcon(g, key, x, y - 10 + b, rare ? 38 : 32);
}
function drawHazard(g, h) {
  const x = h.x * TILE, y = h.y * TILE, r = h.r * TILE, fade = clamp(h.t, 0, 1);
  if (h.k === 'gas') {
    for (let k = 0; k < 5; k++) { const a = V.frame / 40 + k * 1.3; g.fillStyle = `rgba(120,200,60,${0.13 * fade})`; g.beginPath(); g.arc(x + Math.cos(a) * r * 0.35, y + Math.sin(a) * r * 0.25 - 6, r * (0.55 + 0.1 * k), 0, TAU); g.fill(); }
  } else {
    g.fillStyle = `rgba(40,20,10,${0.35 * fade})`; g.beginPath(); g.ellipse(x, y, r, r * 0.6, 0, 0, TAU); g.fill();
    for (let k = 0; k < 7; k++) {
      const a = k * 0.9 + h.x, rr = r * 0.6 * ((k * 37 % 10) / 10), fx2 = x + Math.cos(a) * rr, fy2 = y + Math.sin(a) * rr * 0.6, fl = Math.sin(V.frame / 3 + k) * 3;
      g.fillStyle = `rgba(255,${120 + k * 12},30,${0.8 * fade})`; g.beginPath(); g.ellipse(fx2, fy2 - 8 - fl, 5 + (k % 3), 10 + fl, 0, 0, TAU); g.fill();
      g.fillStyle = `rgba(255,230,140,${0.8 * fade})`; g.beginPath(); g.arc(fx2, fy2 - 5, 2.5, 0, TAU); g.fill();
    }
    V.lights.push({ x: h.x, y: h.y, r: h.r * 2.2, t: 0.03 });
  }
}
function drawGrave(g, x, y) {
  const px = x * TILE + 16, py = y * TILE + 18;
  g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(px - 9, py + 2, 20, 5);
  g.fillStyle = '#7a7a80'; roundRect(g, px - 8, py - 22, 16, 26, 6); g.fill();
  g.fillStyle = '#5a5a60'; g.fillRect(px - 1, py - 18, 2, 10); g.fillRect(px - 5, py - 15, 10, 2);
}
function drawMast(g, m) {
  const x = m.x * TILE, y = m.y * TILE;
  g.strokeStyle = '#8a8f98'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(x - 14, y); g.lineTo(x, y - 190); g.lineTo(x + 14, y); g.stroke();
  g.lineWidth = 1.5; for (let k = 0; k < 9; k++) { const yy = y - k * 20, w = 14 * (1 - k / 9.5); g.beginPath(); g.moveTo(x - w, yy); g.lineTo(x + w * 0.9, yy - 20); g.stroke(); }
  const blink = (V.frame >> 5) & 1, live = G.Q && (G.Q.ev || G.Q.done.includes('m2'));
  g.fillStyle = blink || live ? '#ff3b2b' : '#5a1010'; g.beginPath(); g.arc(x, y - 192, 4, 0, TAU); g.fill();
  if (live) V.lights.push({ x: m.x, y: m.y - 5, r: 3, t: 0.03 });
}
function drawStruct(g, s) {
  const x = s.x * TILE, y = s.y * TILE, fl = s.flash > 0;
  switch (s.type) {
    case 'core': {
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x - 30, y - 10, 64, 40);
      g.fillStyle = fl ? '#fff' : '#3a4a5a'; g.fillRect(x - 30, y - 26, 60, 48);
      g.fillStyle = '#4a6a8a'; g.fillRect(x - 30, y - 40, 60, 18);
      const on = (V.frame >> 4) & 1;
      g.fillStyle = on ? '#7df' : '#3ac'; g.fillRect(x - 20, y - 36, 40, 8);
      g.fillStyle = '#ffd166'; g.fillRect(x - 6, y - 16, 12, 22);
      g.fillStyle = '#222'; g.fillRect(x - 24, y - 16, 10, 30); g.fillRect(x + 14, y - 16, 10, 30);
      break;
    }
    case 'radio': {
      g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x - 13, y + 2, 28, 8);
      g.fillStyle = '#3a4038'; g.fillRect(x - 13, y - 16, 26, 22); g.fillStyle = '#5a6458'; g.fillRect(x - 13, y - 20, 26, 6);
      g.fillStyle = (V.frame >> 4) & 1 ? '#7dff9a' : '#2a5a2a'; g.fillRect(x - 9, y - 12, 6, 4);
      g.fillStyle = '#111'; g.beginPath(); g.arc(x + 5, y - 6, 4, 0, TAU); g.fill();
      g.strokeStyle = '#999'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 8, y - 20); g.lineTo(x + 14, y - 46); g.stroke();
      break;
    }
    case 'gate': {
      const px = x - 16, py = y - 16;
      g.fillStyle = '#2a3038'; g.fillRect(px, py + TILE - 16, TILE, 16);
      g.fillStyle = '#4a5560'; g.fillRect(px, py - 16, TILE, TILE);
      g.fillStyle = '#e0c040'; for (let k = 0; k < 4; k++) g.fillRect(px + k * 8, py - 2, 4, 4);
      g.fillStyle = (V.frame >> 4) & 1 ? '#ff3b2b' : '#6a1010'; g.fillRect(px + 13, py - 12, 6, 4);
      break;
    }
    case 'bench':
      g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x - 15, y + 2, 32, 8);
      g.fillStyle = '#6a4a2a'; g.fillRect(x - 15, y - 8, 30, 14); g.fillStyle = '#8a6a3a'; g.fillRect(x - 15, y - 16, 30, 9);
      g.fillStyle = '#aaa'; g.fillRect(x - 10, y - 20, 8, 5); g.fillStyle = '#c84'; g.fillRect(x + 3, y - 21, 7, 6);
      break;
    case 'wall_wood': case 'wall_metal': case 'door': {
      const px = x - 16, py = y - 16, metal = s.type === 'wall_metal';
      const top = fl ? '#fff' : s.type === 'door' ? '#6a4a2a' : metal ? '#8a8f9c' : '#8a6a44';
      const front = s.type === 'door' ? '#4a3018' : metal ? '#5a5e68' : '#5e4528';
      g.fillStyle = front; g.fillRect(px, py + TILE - 16, TILE, 16);
      g.fillStyle = top; g.fillRect(px, py - 16, TILE, TILE);
      g.fillStyle = 'rgba(0,0,0,.25)';
      if (metal) { g.fillRect(px + 3, py - 13, 3, 3); g.fillRect(px + 26, py - 13, 3, 3); g.fillRect(px + 3, py + 10, 3, 3); g.fillRect(px + 26, py + 10, 3, 3); }
      else for (let k = 0; k < 4; k++) g.fillRect(px + k * 8, py - 16, 1, TILE);
      if (s.type === 'door') { g.fillStyle = '#ffd166'; g.fillRect(px + 13, py - 4, 6, 6); }
      hpBar(g, s, px, py - 22);
      break;
    }
    case 'turret': {
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(x, y + 6, 13, 6, 0, 0, TAU); g.fill();
      g.fillStyle = '#4a4e56'; g.fillRect(x - 11, y - 8, 22, 14);
      g.fillStyle = fl ? '#fff' : '#6a707a'; g.beginPath(); g.arc(x, y - 12, 9, 0, TAU); g.fill();
      g.strokeStyle = '#2a2c30'; g.lineWidth = 4; g.beginPath(); g.moveTo(x, y - 12); g.lineTo(x + Math.cos(s.angle) * 18, y - 12 + Math.sin(s.angle) * 18); g.stroke();
      g.fillStyle = s.ammo > 0 ? '#7dff9a' : '#ff5c4c'; g.fillRect(x - 2, y - 14, 4, 4);
      hpBar(g, s, x - 14, y - 28);
      break;
    }
    case 'barrel':
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(x, y + 6, 11, 5, 0, 0, TAU); g.fill();
      g.fillStyle = '#a3322a'; g.fillRect(x - 10, y - 18, 20, 24);
      g.fillStyle = '#c8463a'; g.beginPath(); g.ellipse(x, y - 18, 10, 4, 0, 0, TAU); g.fill();
      g.fillStyle = '#ffcc33'; g.fillRect(x - 10, y - 8, 20, 3);
      break;
    case 'spikes':
      g.fillStyle = '#5a4a3a'; g.fillRect(x - 14, y - 6, 28, 12);
      g.fillStyle = '#bbb';
      for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(x - 12 + k * 6, y + 2); g.lineTo(x - 9 + k * 6, y - 10); g.lineTo(x - 6 + k * 6, y + 2); g.fill(); }
      break;
    case 'light':
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(x, y + 4, 6, 3, 0, 0, TAU); g.fill();
      g.fillStyle = '#444'; g.fillRect(x - 2, y - 30, 4, 34);
      g.fillStyle = '#ffe9a0'; g.beginPath(); g.arc(x, y - 32, 5, 0, TAU); g.fill();
      break;
    case 'mine':
      g.fillStyle = '#4a4a3a'; g.beginPath(); g.arc(x, y, 7, 0, TAU); g.fill();
      g.fillStyle = s.fuse >= 0 || (V.frame >> 4) & 1 ? '#f33' : '#600'; g.fillRect(x - 2, y - 2, 4, 4);
      break;
  }
}
function hpBar(g, s, x, y) {
  if (s.hp >= s.maxHp || s.ghost) return;
  g.fillStyle = '#000'; g.fillRect(x + 2, y, TILE - 4, 3);
  g.fillStyle = s.hp / s.maxHp > 0.5 ? '#9d5' : '#e84'; g.fillRect(x + 2, y, (TILE - 4) * clamp(s.hp / s.maxHp, 0, 1), 3);
}
function drawShot(g, s) {
  const x = s.x * TILE, y = s.y * TILE;
  if (s.k === 'molotov') {
    g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fill();
    g.fillStyle = '#c89040'; g.fillRect(x - 3, y - 10 - s.z * TILE, 6, 9); g.fillStyle = '#ff7a1a'; g.beginPath(); g.arc(x, y - 13 - s.z * TILE, 3 + Math.random() * 2, 0, TAU); g.fill();
    V.lights.push({ x: s.x, y: s.y, r: 1.5, t: 0.03 });
  } else if (s.k === 'grenade') {
    g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fill();
    g.fillStyle = '#4a5'; g.beginPath(); g.arc(x, y - 6 - s.z * TILE, 4, 0, TAU); g.fill();
  } else if (s.k === 'rocket') {
    g.fillStyle = '#ddd'; g.beginPath(); g.arc(x, y - 14, 4, 0, TAU); g.fill();
    if (Math.random() < 0.6) V.parts.push({ k: 'smoke', x: s.x, y: s.y, t: 0, life: 0.6, s: 4 });
  } else {
    const fire = s.k === 'fireball';
    g.fillStyle = fire ? '#ff7a1a' : '#8ad040'; g.beginPath(); g.arc(x, y - 14, fire ? 7 : 5, 0, TAU); g.fill();
    g.fillStyle = fire ? '#ffe28a' : '#d0ff90'; g.beginPath(); g.arc(x, y - 14, fire ? 3 : 2, 0, TAU); g.fill();
    if (fire) V.lights.push({ x: s.x, y: s.y, r: 2.5, t: 0.03 });
  }
}

// humanoid body
function drawBody(g, x, y, face, o) {
  const px = x * TILE, py = y * TILE, s = (o.r || 0.36) * TILE * (o.scale || 1);
  const bob = Math.sin(o.walk || 0) * 1.6, low = o.low ? 0.55 : 1;
  g.fillStyle = 'rgba(0,0,0,.33)'; g.beginPath(); g.ellipse(px, py + 3, s * 0.95, s * 0.45, 0, 0, TAU); g.fill();
  if (!o.down) {
    g.fillStyle = o.legs || '#222';
    const lx = Math.cos(face + Math.PI / 2) * s * 0.35, ly = Math.sin(face + Math.PI / 2) * s * 0.2, st = Math.sin(o.walk || 0) * 3;
    g.fillRect(px + lx - 3 + Math.cos(face) * st, py - 7 * low + ly, 6, 9 * low);
    g.fillRect(px - lx - 3 - Math.cos(face) * st, py - 7 * low - ly, 6, 9 * low);
  }
  const fl = o.flash;
  const bodyY = o.down ? py - s * 0.6 : py - s * 1.95 * low + bob;
  g.fillStyle = fl ? '#fff' : o.body;
  const bw = s * 1.5 * (o.fat ? 1.35 : 1);
  roundRect(g, px - bw / 2, bodyY, bw, s * 1.4 * (o.down ? 0.7 : low), s * 0.45); g.fill();
  // arms + weapon
  const ax = Math.cos(face), ay = Math.sin(face);
  const shY = bodyY + s * 0.65;
  if (o.gun) {
    const len = o.gunLen || 14;
    g.strokeStyle = fl ? '#fff' : (o.arm || o.body); g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(px, shY); g.lineTo(px + ax * s * 0.9, shY + ay * s * 0.5); g.stroke();
    g.strokeStyle = o.gunCol || '#222'; g.lineWidth = o.gunW || 4;
    g.beginPath(); g.moveTo(px + ax * s * 0.5, shY + ay * s * 0.3); g.lineTo(px + ax * (s * 0.5 + len), shY + ay * (s * 0.3 + len * 0.55)); g.stroke();
  } else {
    const reach = o.reach || 1.1;
    g.strokeStyle = fl ? '#fff' : (o.arm || o.body); g.lineWidth = o.armW || 4; g.lineCap = 'round';
    const off = o.zombie ? 0.35 : 0.5;
    for (const sd of [-1, 1]) {
      const bx = px + Math.cos(face + sd * off) * s * 0.55, by = shY + Math.sin(face + sd * off) * s * 0.3;
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + ax * s * reach, by + ay * s * reach * 0.55); g.stroke();
    }
  }
  // head
  const hx = px + ax * 2, hy = o.down ? py - s * 0.9 : bodyY - s * 0.3 + ay;
  g.fillStyle = fl ? '#fff' : o.head; g.beginPath(); g.arc(hx, hy, s * 0.55 * (o.bigHead || 1), 0, TAU); g.fill();
  if (o.hat) { g.fillStyle = o.hat; g.beginPath(); g.arc(hx, hy - s * 0.2, s * 0.56, Math.PI, TAU); g.fill(); }
  if (o.horns) { g.fillStyle = '#2a0a08'; g.beginPath(); g.moveTo(hx - 7, hy - 6); g.lineTo(hx - 11, hy - 18); g.lineTo(hx - 3, hy - 8); g.moveTo(hx + 7, hy - 6); g.lineTo(hx + 11, hy - 18); g.lineTo(hx + 3, hy - 8); g.fill(); }
  if (ay > -0.6) {
    g.fillStyle = o.eye || '#111';
    const ex = hx + ax * s * 0.3, ey = hy - 1 + ay * 2;
    g.fillRect(ex - 3 + ay * 2, ey - 1, 2, 2); g.fillRect(ex + 1 + ay * 2, ey - 1, 2, 2);
  }
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const GUN_LOOK = { pistol: [10, '#222', 4], smg: [15, '#2a2a2a', 5], shotgun: [20, '#4a3020', 5], rifle: [22, '#2a3020', 5], sniper: [28, '#203020', 4], launcher: [24, '#3a4a3a', 8], machete: [16, '#ccc', 3] };
function drawEnt(g, e) {
  const x = e.rx !== undefined ? e.rx : e.x, y = e.ry !== undefined ? e.ry : e.y;
  if (e.cat === 'mob') {
    const d = e.def;
    if (d.dog) { drawHound(g, x, y, e); if (e.hp < e.maxHp) bar(g, x, y - 0.9, 18, e.hp / e.maxHp, '#9d5'); return; }
    let alpha = 1;
    if (d.stealth && !(e.revealT > 0) && !(e.flash > 0)) { const p = meP(); alpha = p && dist(p.x, p.y, x, y) < 4.5 ? 0.85 : 0.13; }
    if (d.gas) { g.fillStyle = `rgba(140,220,60,${0.18 + 0.08 * Math.sin(V.frame / 7 + e.id)})`; g.beginPath(); g.arc(x * TILE, y * TILE - 12, 20, 0, TAU); g.fill(); }
    if (e.kind === 'x13' && e.revealT > 0) { g.globalAlpha = 0.3; drawBody(g, x - Math.cos(e.angle) * 0.6, y - Math.sin(e.angle) * 0.6, e.angle, { r: d.r, body: '#5ff', head: '#5ff', walk: e.walk, zombie: true }); g.globalAlpha = 1; }
    g.globalAlpha = alpha;
    drawBody(g, x, y, e.angle, { r: d.r, body: d.body, head: d.head, walk: e.walk, flash: e.flash > 0, zombie: true, reach: e.atkAnim > 0.3 ? 1.7 : 1.2,
      armW: e.kind === 'brute' || e.kind === 'fiend' || e.kind === 'goliath' ? 9 : e.kind === 'x13' ? 3 : 4,
      eye: e.kind === 'fiend' ? '#ffd23a' : e.kind === 'x13' ? '#5ff' : e.kind === 'stalker' ? '#fff' : '#c01010', low: d.low,
      fat: e.kind === 'bloater' || e.kind === 'broodmother', horns: e.kind === 'fiend', bigHead: e.kind === 'screamer' ? 1.2 : 1, legs: e.kind === 'goliath' ? '#c86a20' : '#2a2a22',
      hat: e.kind === 'riot' ? '#1a2028' : null });
    g.globalAlpha = 1;
    if (d.shield) {
      const sx2 = x * TILE + Math.cos(e.angle) * 12, sy2 = y * TILE - 16 + Math.sin(e.angle) * 6;
      g.save(); g.translate(sx2, sy2); g.rotate(e.angle + Math.PI / 2);
      g.fillStyle = e.flash > 0 ? '#fff' : '#1e2630'; g.fillRect(-13, -4, 26, 7); g.fillStyle = 'rgba(160,200,230,.5)'; g.fillRect(-8, -3, 16, 2); g.restore();
    }
    if (e.kind === 'broodmother') for (let k = 0; k < 4; k++) { g.fillStyle = 'rgba(230,210,180,.8)'; g.beginPath(); g.arc(x * TILE + Math.cos(k * 1.6 + V.frame / 30) * 16, y * TILE - 26 + Math.sin(k * 2.1) * 8, 6 + Math.sin(V.frame / 9 + k) * 2, 0, TAU); g.fill(); }
    if (e.kind === 'goliath') { g.strokeStyle = '#777'; g.lineWidth = 2; for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(x * TILE + sd * 22, y * TILE - 30); g.lineTo(x * TILE + sd * 26, y * TILE - 6); g.stroke(); } }
    if (e.kind === 'x13') { g.strokeStyle = 'rgba(90,255,255,.7)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x * TILE - 6, y * TILE - 34); g.lineTo(x * TILE + 2, y * TILE - 22); g.lineTo(x * TILE - 4, y * TILE - 12); g.stroke(); }
    if (e.kind === 'spitter' && e.atkAnim > 0) { g.fillStyle = '#9f6'; g.beginPath(); g.arc(x * TILE + Math.cos(e.angle) * 8, y * TILE - 24, 3, 0, TAU); g.fill(); }
    if (e.kind === 'bloater') { g.fillStyle = 'rgba(180,200,60,.5)'; g.beginPath(); g.arc(x * TILE, y * TILE - 16, 6 + Math.sin(V.frame / 6) * 2, 0, TAU); g.fill(); }
    if (e.hp < e.maxHp) bar(g, x, y - (d.r > 0.5 ? 1.75 : 1.25), d.boss ? 40 : 22, e.hp / e.maxHp, d.boss ? '#f84' : '#9d5');
  } else {
    const d = e.def, gl = e.wpn ? GUN_LOOK[e.wpn] : null;
    drawBody(g, x, y, e.angle, { r: 0.33, body: d.body, head: d.head, hat: d.hat, walk: e.walk, flash: e.flash > 0, gun: !!gl, gunLen: gl && gl[0], gunCol: gl && gl[1], gunW: gl && gl[2], legs: '#2a2a32', scale: d.boss ? 1.25 : 1 });
    if (e.hp < e.maxHp) bar(g, x, y - 1.35, 24, e.hp / e.maxHp, e.team === 'player' ? '#7dff9a' : '#e84');
  }
}
function drawHound(g, x, y, e) {
  const px = x * TILE, py = y * TILE, a = e.angle, ca = Math.cos(a), sa = Math.sin(a), st = Math.sin(e.walk) * 3, fl = e.flash > 0;
  g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(px, py + 2, 13, 5, 0, 0, TAU); g.fill();
  g.strokeStyle = '#2a2018'; g.lineWidth = 3;
  for (const [o, s2] of [[-7, 1], [7, -1]]) { g.beginPath(); g.moveTo(px + ca * o, py - 8 + sa * o * 0.5); g.lineTo(px + ca * o + st * s2 * ca, py + 1); g.stroke(); }
  g.fillStyle = fl ? '#fff' : e.def.body; g.beginPath(); g.ellipse(px, py - 10, 12 * Math.abs(ca) + 6, 6 + 4 * Math.abs(sa), 0, 0, TAU); g.fill();
  const hx = px + ca * 12, hy = py - 13 + sa * 6;
  g.fillStyle = fl ? '#fff' : e.def.head; g.beginPath(); g.arc(hx, hy, 6, 0, TAU); g.fill();
  g.fillStyle = '#c01010'; g.fillRect(hx + ca * 3 - 1, hy - 2, 2, 2);
  if (e.atkAnim > 0) { g.fillStyle = '#eee'; g.fillRect(hx + ca * 5 - 2, hy + 1, 4, 2); }
}
function bar(g, x, y, w, k, c) { const px = x * TILE - w / 2, py = y * TILE; g.fillStyle = '#000'; g.fillRect(px, py, w, 3); g.fillStyle = c; g.fillRect(px, py, w * clamp(k, 0, 1), 3); }
function drawPlayer(g, p) {
  const gl = GUN_LOOK[p.wpn];
  const swing = p.wpn === 'machete' && p.fireT > 0.2;
  drawBody(g, p.x, p.y, p.angle + (swing ? 0.8 : 0), { r: 0.34, body: p.color, head: '#f0c9a0', hat: '#2a2a2a', walk: p.walk, flash: p.flash > 0, gun: true, gunLen: gl[0], gunCol: gl[1], gunW: gl[2], legs: '#2a2a3a', down: p.down });
  if (p.in && p.in.crouch && !p.down) { g.fillStyle = 'rgba(160,200,255,.7)'; g.font = '10px system-ui'; g.textAlign = 'center'; g.fillText('은신', p.x * TILE, p.y * TILE + 16); }
}
function drawEntLabel(g, e) {
  const x = (e.rx !== undefined ? e.rx : e.x) * TILE, y = (e.ry !== undefined ? e.ry : e.y) * TILE;
  if (e.cat === 'mob') { if (e.def.boss) { g.font = 'bold 11px system-ui'; g.fillStyle = '#ff7a5c'; g.fillText(e.def.name, x, y - (e.def.r > 0.6 ? 80 : 64)); } return; }
  g.font = 'bold 10px system-ui, sans-serif';
  let name = e.title || e.def.name, col = '#ddd';
  const nk = npcKeyOf(e);
  if (nk && CAST[nk] && e.kind !== 'bandit_boss') name = CAST[nk].name;
  if (e.kind === 'survivor') { name = `${SURVIVOR_NAMES[e.name]} · ${PERKS[e.perk].name}`; col = e.mode === 'wait' ? '#ffd166' : '#7dff9a'; }
  else if (e.team === 'player') col = '#7dff9a';
  else if (e.team === 'military') col = G.milHostile ? '#ff6b5c' : '#b8d890';
  else if (e.team === 'cult') col = '#ff5c4c';
  else if (e.team === 'bandit') col = '#ff8a7a';
  else if (e.team === 'village') col = G.vh[e.village] > 0 ? '#ff6b5c' : '#9fd0ff';
  else if (e.team === 'merchant') col = G.merchantHostile ? '#ff6b5c' : '#e0b0ff';
  const p = meP();
  if (p && dist(p.x, p.y, e.x, e.y) < 9) { g.fillStyle = col; g.fillText(name, x, y - 50); }
  const qm = nk && G.Q ? npcMarker(nk) : '';
  if (qm) { g.font = 'bold 22px system-ui'; g.fillStyle = '#000'; g.fillText(qm, x + 1, y - 61 + Math.sin(V.frame / 9) * 2); g.fillStyle = qm === '?' ? '#7dff9a' : '#ffd166'; g.fillText(qm, x, y - 62 + Math.sin(V.frame / 9) * 2); }
  if ((e.kind === 'lost' || e.kind === 'dr_han') && e.mode === 'wait') { const b = Math.sin(V.frame / 10) * 2; g.font = 'bold 12px system-ui'; roundRect(g, x - 26, y - 78 + b, 52, 18, 6); g.fillStyle = 'rgba(0,0,0,.6)'; g.fill(); g.fillStyle = '#ffd166'; g.fillText('도와줘요!', x, y - 65 + b); }
  if (e.kind === 'survivor' && e.mode === 'wait') { g.fillStyle = '#fff'; g.font = 'bold 12px system-ui'; const b = Math.sin(V.frame / 10) * 2; roundRect(g, x - 22, y - 78 + b, 44, 18, 6); g.fillStyle = 'rgba(0,0,0,.6)'; g.fill(); g.fillStyle = '#ffd166'; g.fillText('살려줘!', x, y - 65 + b); }
  if (e.alert > 0) { g.fillStyle = '#ff3b2b'; g.font = 'bold 20px system-ui'; g.fillText('!', x, y - 60); }
  else if (e.sees) {
    g.fillStyle = 'rgba(255,220,80,.95)'; g.beginPath(); g.ellipse(x, y - 64, 8, 5, 0, 0, TAU); g.fill();
    g.fillStyle = '#222'; g.beginPath(); g.arc(x, y - 64, 2.5, 0, TAU); g.fill();
  }
  if (e.def.shop && !(e.team === 'merchant' ? G.merchantHostile : G.vh[e.village] > 0)) { g.fillStyle = '#ffd166'; g.font = 'bold 14px system-ui'; g.fillText('$', x + 14, y - 40); }
}
function drawPart(g, p) {
  const k = p.t / p.life, x = p.x * TILE, y = p.y * TILE;
  switch (p.k) {
    case 'flash': g.fillStyle = '#fff6b0'; g.beginPath(); g.arc(x + Math.cos(p.a) * 6, y - 14 + Math.sin(p.a) * 4, 7, 0, TAU); g.fill(); break;
    case 'drop': case 'chunk': g.fillStyle = p.c; const s = p.k === 'chunk' ? 5 : 3; g.fillRect(x - s / 2, y - p.z * TILE - s / 2, s, s); break;
    case 'boom': {
      const r = p.r * TILE * (0.35 + 0.65 * k);
      g.globalAlpha = 1 - k;
      g.fillStyle = p.green ? '#8ad040' : p.fire ? '#ff7a1a' : '#ffb347'; g.beginPath(); g.arc(x, y - 8, r, 0, TAU); g.fill();
      g.fillStyle = p.green ? '#d0ff90' : '#fff3c4'; g.beginPath(); g.arc(x, y - 8, r * 0.5 * (1 - k), 0, TAU); g.fill();
      g.globalAlpha = 1; break;
    }
    case 'smoke': g.fillStyle = `rgba(90,90,90,${0.35 * (1 - k)})`; g.beginPath(); g.arc(x, y - 14 - k * 20, (p.s || 6) * (0.5 + k), 0, TAU); g.fill(); break;
    case 'spark': g.fillStyle = `rgba(255,220,150,${1 - k})`; g.fillRect(x - 2, y - 16, 4, 4); break;
    case 'swing': g.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`; g.lineWidth = 3; g.beginPath(); g.arc(x, y - 16, 26, p.a - 0.9, p.a + 0.9); g.stroke(); break;
    case 'ring': g.strokeStyle = `rgba(220,220,255,${1 - k})`; g.lineWidth = 3; g.beginPath(); g.arc(x, y - 20, k * 200, 0, TAU); g.stroke(); break;
  }
}

// ── lighting ───────────────────────────────────────────────────────────────
function drawLighting(g, sx, sy) {
  const dk = darkness();
  const c = G.clock;
  if (c >= DUSK - 60 && c < NIGHT + 30) { g.fillStyle = `rgba(255,120,40,${0.12 * Math.sin(clamp((c - DUSK + 60) / 150, 0, 1) * Math.PI)})`; g.fillRect(0, 0, VIEW_W, VIEW_H); }
  if (dk > 0.02) {
    const sc = 0.5, w = Math.ceil(VIEW_W * sc), h = Math.ceil(VIEW_H * sc);
    if (!lightCv) { lightCv = document.createElement('canvas'); lightG = lightCv.getContext('2d'); }
    if (lightCv.width !== w || lightCv.height !== h) { lightCv.width = w; lightCv.height = h; }
    const L = lightG;
    L.globalCompositeOperation = 'source-over';
    L.clearRect(0, 0, w, h);
    L.fillStyle = `rgba(4,8,22,${dk})`; L.fillRect(0, 0, w, h);
    L.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a = 1) => {
      const px = (x * TILE - sx) * sc, py = (y * TILE - sy - 10) * sc, pr = r * TILE * sc;
      if (px < -pr || py < -pr || px > w + pr || py > h + pr) return;
      const gr = L.createRadialGradient(px, py, 0, px, py, pr);
      gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(0.6, `rgba(0,0,0,${a * 0.6})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      L.fillStyle = gr; L.beginPath(); L.arc(px, py, pr, 0, TAU); L.fill();
    };
    for (const p of G.players) if (p && p.joined && !p.dead) {
      hole(p.x, p.y, 3.2, 0.9);
      if (!p.down) { // flashlight cone
        const px = (p.x * TILE - sx) * sc, py = (p.y * TILE - sy - 10) * sc, R = 10 * TILE * sc;
        const gr = L.createRadialGradient(px, py, 0, px, py, R);
        gr.addColorStop(0, 'rgba(0,0,0,.95)'); gr.addColorStop(0.7, 'rgba(0,0,0,.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        L.fillStyle = gr; L.beginPath(); L.moveTo(px, py); L.arc(px, py, R, p.angle - 0.42, p.angle + 0.42); L.closePath(); L.fill();
      }
    }
    hole(G.core.x, G.core.y, 6, 0.85);
    for (const s of G.structs) if (s.type === 'light') hole(s.x, s.y, 7.5, 0.95); else if (s.type === 'turret') hole(s.x, s.y, 1.6, 0.6);
    for (const e of G.ents) { if (e.team === 'player') hole(e.x, e.y, 2.2, 0.6); else if (e.kind === 'fiend') hole(e.x, e.y, 2.5, 0.5); }
    for (const v of W.villages) { hole(v.stall.x, v.stall.y, 6, 0.8); hole(v.x + 4, v.y + v.h / 2, 3.5, 0.6); hole(v.x + v.w - 4, v.y + v.h / 2, 3.5, 0.6); }
    for (const cp of W.camps) hole(cp.fire.x, cp.fire.y, 5 + Math.sin(V.frame / 5) * 0.3, 0.8);
    for (const l of V.lights) hole(l.x, l.y, l.r, Math.min(1, l.t * 10));
    g.drawImage(lightCv, 0, 0, VIEW_W, VIEW_H);
  }
  // campfire glow sprites
  for (const cp of W.camps) {
    const x = cp.fire.x * TILE - sx, y = cp.fire.y * TILE - sy;
    if (x < -40 || y < -40 || x > VIEW_W + 40 || y > VIEW_H + 40) continue;
    g.fillStyle = '#4a3a2a'; g.fillRect(x - 10, y - 2, 20, 5);
    g.fillStyle = '#ff7a1a'; g.beginPath(); g.arc(x, y - 6, 6 + Math.sin(V.frame / 3) * 1.5, 0, TAU); g.fill();
    g.fillStyle = '#ffe28a'; g.beginPath(); g.arc(x, y - 6, 3, 0, TAU); g.fill();
  }
  if (V.hurt > 0) {
    const gr = g.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.3, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.8);
    gr.addColorStop(0, 'rgba(160,0,0,0)'); gr.addColorStop(1, `rgba(160,0,0,${0.3 * V.hurt})`);
    g.fillStyle = gr; g.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  const me = meP();
  if (me && me.hp < 30 && !me.down) {
    g.fillStyle = `rgba(120,0,0,${0.12 + 0.08 * Math.sin(V.frame / 8)})`; g.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}
