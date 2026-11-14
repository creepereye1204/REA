'use strict';
// Ground textures. Every ground type gets a seamless 256×256 texture (8×8 tiles); tiles sample
// it by world position, so there is no visible grid. Natural ground blends softly into its
// neighbours through noisy edge masks. Painted textures from assets/ replace the procedural
// ones when they load.

const TEX_N = 256;
const TEX = {};          // ground type → canvas (built on first use)
const GEN = {};          // ground type → generator
const getTex = k => TEX[k] || (GEN[k] ? (TEX[k] = GEN[k]()) : null);
let TEX_READY = false, TEX_ART = false;
// blend priority: a higher one spills over the edge of a lower one (0 = never blends)
const GPRI = { [T.WATER]: 1, [T.SAND]: 2, [T.MUD]: 3, [T.PADDY]: 3, [T.GRASS]: 5, [T.DIRT]: 4, [T.GRAVEL]: 4, [T.ASH]: 4, [T.CAMPDIRT]: 4, [T.RUBBLE]: 4, [T.CROP]: 0, [T.VFLOOR]: 0 };

function periodicNoise(seed, cells) { // value noise that wraps every `cells` cells
  let a = seed >>> 0; const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const g = new Float32Array(cells * cells); for (let i = 0; i < g.length; i++) g[i] = rnd();
  const sm = t => t * t * (3 - 2 * t);
  return (u, v) => { // u, v in [0, 1)
    const fx = u * cells, fy = v * cells, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
    const at = (i, j) => g[((j % cells + cells) % cells) * cells + ((i % cells + cells) % cells)];
    return lerp(lerp(at(ix, iy), at(ix + 1, iy), tx), lerp(at(ix, iy + 1), at(ix + 1, iy + 1), tx), ty);
  };
}
function texCanvas() { const c = document.createElement('canvas'); c.width = c.height = TEX_N; return c; }
// fill a texture from a per-pixel colour function (u, v → [r, g, b])
function paintTex(fn) {
  const c = texCanvas(), g = c.getContext('2d'), im = g.createImageData(TEX_N, TEX_N), d = im.data;
  for (let y = 0; y < TEX_N; y++) for (let x = 0; x < TEX_N; x++) {
    const [r, gg, b] = fn(x / TEX_N, y / TEX_N, x, y), o = (y * TEX_N + x) * 4;
    d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return c;
}
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const jit = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

function buildTextures() {
  if (TEX_READY || typeof document === 'undefined') return;
  const n1 = periodicNoise(11, 8), n2 = periodicNoise(23, 32), n3 = periodicNoise(37, 64), n4 = periodicNoise(51, 16), n5 = periodicNoise(77, 128);
  const fbm = (u, v) => n1(u, v) * 0.45 + n2(u, v) * 0.3 + n3(u, v) * 0.17 + n5(u, v) * 0.08;
  GEN[T.GRASS] = () => paintTex((u, v) => {
    const f = fbm(u, v), b = n5(u, v), dry = n4(u, v);
    let c = mix3([46, 74, 34], [86, 112, 52], f);
    c = mix3(c, [112, 108, 60], Math.max(0, dry - 0.62) * 1.6);
    return jit(c, 0.82 + b * 0.36);
  });
  GEN[T.DIRT] = () => paintTex((u, v) => { const f = fbm(u, v), b = n5(u, v); const c = mix3([86, 68, 46], [122, 100, 70], f); return jit(c, 0.84 + b * 0.32 - (n3(u, v) > 0.78 ? 0.18 : 0)); });
  GEN[T.CAMPDIRT] = () => paintTex((u, v) => { const f = fbm(u, v), b = n5(u, v); const c = mix3([66, 52, 38], [96, 76, 54], f); return jit(c, 0.8 + b * 0.35); });
  GEN[T.VFLOOR] = () => paintTex((u, v) => { const f = fbm(u, v), b = n5(u, v); const c = mix3([124, 104, 76], [156, 134, 98], f); return jit(c, 0.88 + b * 0.22 - (n3(u, v) > 0.8 ? 0.12 : 0)); });
  GEN[T.SAND] = () => paintTex((u, v) => { const f = fbm(u, v), rip = Math.sin((u * 7 + n1(u, v) * 1.6) * TAU * 3) * 0.04; const c = mix3([184, 164, 112], [214, 196, 146], f); return jit(c, 0.94 + rip + n5(u, v) * 0.1); });
  GEN[T.MUD] = () => paintTex((u, v) => { const f = fbm(u, v), w = n2(u, v) > 0.66; const c = w ? mix3([52, 56, 44], [70, 78, 62], f) : mix3([58, 48, 32], [86, 72, 48], f); return jit(c, 0.86 + n5(u, v) * 0.26); });
  GEN[T.ASH] = () => paintTex((u, v) => { const f = fbm(u, v), s = n5(u, v); const c = mix3([58, 56, 54], [96, 92, 86], f); const e = n3(u, v) > 0.86 && s > 0.7; return e ? [150, 70, 34] : jit(c, 0.84 + s * 0.3); });
  GEN[T.GRAVEL] = () => paintTex((u, v, x, y) => { const f = fbm(u, v), p = n5(u, v); const c = mix3([92, 88, 82], [138, 132, 122], f); return jit(c, p > 0.6 ? 1.18 : p < 0.3 ? 0.72 : 0.95); });
  GEN[T.RUBBLE] = () => paintTex((u, v) => { const f = fbm(u, v), p = n5(u, v), q = n3(u, v); const c = mix3([86, 80, 74], [128, 120, 110], f); return jit(q > 0.7 ? [150, 90, 70] : c, p > 0.62 ? 1.2 : p < 0.32 ? 0.7 : 0.95); });
  GEN[T.WATER] = () => paintTex((u, v) => { const f = fbm(u, v); return mix3([28, 66, 96], [46, 100, 128], f); });
  GEN[T.PADDY] = () => paintTex((u, v, x, y) => { const f = fbm(u, v), row = (x % 10 < 2 && y % 8 < 5); return row ? [86, 140, 52] : mix3([58, 86, 74], [82, 112, 92], f); });
  GEN[T.CROP] = () => paintTex((u, v, x, y) => { const f = fbm(u, v), furrow = Math.sin(x / 8 * TAU) > 0.2, leaf = furrow && n5(u, v) > 0.45; return leaf ? jit([78, 118, 42], 0.8 + f * 0.4) : jit(furrow ? [92, 74, 50] : [70, 56, 38], 0.85 + f * 0.3); });
  GEN[T.ROAD] = () => paintTex((u, v) => { const f = fbm(u, v), s = n5(u, v); const crack = Math.abs(n2(u, v) - 0.5) < 0.012; return crack ? [30, 30, 32] : jit(mix3([48, 49, 53], [66, 67, 72], f), 0.9 + s * 0.2); });
  GEN[T.WALK] = () => paintTex((u, v, x, y) => { const f = fbm(u, v), seam = x % 32 === 0 || y % 32 === 0 || (x % 32 === 16 && (y >> 5) % 2 === 0); return seam ? [96, 94, 90] : jit(mix3([124, 122, 116], [150, 148, 140], f), 0.94 + n5(u, v) * 0.1); });
  GEN[T.CONCRETE] = () => paintTex((u, v, x, y) => { const f = fbm(u, v), seam = x % 64 === 0 || y % 64 === 0, stain = n2(u, v) > 0.7; return seam ? [86, 88, 90] : jit(mix3([104, 106, 108], [130, 132, 134], f), stain ? 0.84 : 0.95 + n5(u, v) * 0.1); });
  GEN[T.PAD] = () => paintTex((u, v) => jit(mix3([60, 64, 70], [78, 82, 88], fbm(u, v)), 0.95 + n5(u, v) * 0.1));
  GEN.wood = () => paintTex((u, v, x, y) => { const plank = (y >> 3) % 2, grain = Math.sin((x + n2(u, v) * 40) * 0.35) * 0.06, seam = y % 8 === 0 || (x + plank * 37) % 64 === 0; return seam ? [70, 48, 30] : jit(mix3([118, 84, 52], [146, 108, 70], n4(u, v)), 0.9 + grain + n5(u, v) * 0.1); });
  GEN.tile = () => paintTex((u, v, x, y) => { const seam = x % 16 === 0 || y % 16 === 0, ch = ((x >> 4) + (y >> 4)) & 1; return seam ? [130, 128, 122] : jit(ch ? [188, 184, 172] : [170, 166, 156], 0.95 + n5(u, v) * 0.08); });
  GEN.conc = () => paintTex((u, v) => jit(mix3([96, 96, 94], [118, 118, 114], fbm(u, v)), 0.95 + n5(u, v) * 0.1));
  buildMasks();
  TEX_READY = true;
}

// edge masks (opaque at the shared edge, fading inward with a noisy front)
const MASK = {};
function buildMasks() {
  const nz = periodicNoise(91, 8);
  const mk = fn => { const c = document.createElement('canvas'); c.width = c.height = TILE; const g = c.getContext('2d'), im = g.createImageData(TILE, TILE);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) { const a = fn(x + 0.5, y + 0.5); im.data[(y * TILE + x) * 4 + 3] = clamp(a, 0, 1) * 255; }
    g.putImageData(im, 0, 0); return c; };
  const fade = (d, w) => 1 - d / w;
  for (let v = 0; v < 2; v++) { // two variants so edges don't repeat
    const wob = (s) => 9 + (nz(s / TILE * 0.5 + v * 0.37, v * 0.5) - 0.5) * 10;
    MASK['n' + v] = mk((x, y) => fade(y, wob(x)));
    MASK['s' + v] = mk((x, y) => fade(TILE - y, wob(x + 7)));
    MASK['w' + v] = mk((x, y) => fade(x, wob(y + 13)));
    MASK['e' + v] = mk((x, y) => fade(TILE - x, wob(y + 3)));
    MASK['nw' + v] = mk((x, y) => fade(Math.hypot(x, y), wob(x + y) * 1.05));
    MASK['ne' + v] = mk((x, y) => fade(Math.hypot(TILE - x, y), wob(x - y) * 1.05));
    MASK['sw' + v] = mk((x, y) => fade(Math.hypot(x, TILE - y), wob(y - x) * 1.05));
    MASK['se' + v] = mk((x, y) => fade(Math.hypot(TILE - x, TILE - y), wob(x * 2) * 1.05));
  }
}
let blendCv = null, blendG = null;
function texFor(t, i) {
  if (t === T.FLOOR) { const fs = W.floorStyle[i]; return getTex(fs === 1 ? 'wood' : fs === 2 ? 'tile' : 'conc'); }
  return getTex(t);
}
// paint one tile of ground from its texture, then let higher-priority neighbours spill over its edges
function paintGroundTex(g, tx, ty, px, py, t) {
  const i = idx(tx, ty), tex = texFor(t, i);
  if (!tex) return false;
  const sx = (tx * TILE) % TEX_N, sy = (ty * TILE) % TEX_N;
  g.drawImage(tex, sx, sy, TILE, TILE, px, py, TILE, TILE);
  const pr = GPRI[t];
  if (pr === undefined) return true;
  if (!blendCv) { blendCv = document.createElement('canvas'); blendCv.width = blendCv.height = TILE; blendG = blendCv.getContext('2d'); }
  const v = (tx * 7 + ty * 3) & 1;
  const nb = (dx, dy) => { const x = tx + dx, y = ty + dy; if (!inMap(x, y)) return -1; return groundOf(W.tile[idx(x, y)], x, y); };
  const over = (nt, mask) => {
    const ntex = getTex(nt); if (!ntex) return;
    blendG.globalCompositeOperation = 'source-over'; blendG.clearRect(0, 0, TILE, TILE);
    blendG.drawImage(ntex, sx, sy, TILE, TILE, 0, 0, TILE, TILE);
    blendG.globalCompositeOperation = 'destination-in'; blendG.drawImage(mask, 0, 0);
    g.drawImage(blendCv, px, py);
  };
  const N = nb(0, -1), S = nb(0, 1), Wt = nb(-1, 0), E = nb(1, 0);
  const hi = q => q >= 0 && q !== t && GPRI[q] > pr;
  if (hi(N)) over(N, MASK['n' + v]); if (hi(S)) over(S, MASK['s' + v]); if (hi(Wt)) over(Wt, MASK['w' + v]); if (hi(E)) over(E, MASK['e' + v]);
  const NW = nb(-1, -1), NE = nb(1, -1), SW = nb(-1, 1), SE = nb(1, 1);
  if (hi(NW) && NW !== N && NW !== Wt) over(NW, MASK['nw' + v]); if (hi(NE) && NE !== N && NE !== E) over(NE, MASK['ne' + v]);
  if (hi(SW) && SW !== S && SW !== Wt) over(SW, MASK['sw' + v]); if (hi(SE) && SE !== S && SE !== E) over(SE, MASK['se' + v]);
  return true;
}
// painted textures (generated offline) override the procedural ones
function loadGroundArt(map) {
  if (!map || typeof Image === 'undefined') return;
  let left = 0;
  for (const [key, file] of Object.entries(map)) {
    const tkey = T[key] !== undefined ? T[key] : key; left++;
    const im = new Image();
    im.onload = () => {
      const c = texCanvas(); c.getContext('2d').drawImage(im, 0, 0, TEX_N, TEX_N); TEX[tkey] = c;
      if (--left === 0) { TEX_ART = true; V.chunks.clear(); }
    };
    im.onerror = () => { left--; };
    im.src = 'assets/' + file + '?v=' + ART_V;
  }
}

// ── painted sprites (trees, rocks, props, cars) from an atlas; procedural art is the fallback ──
const SPR = { img: null, map: {} };
function loadSprites(m) {
  if (!m || typeof Image === 'undefined') return;
  const im = new Image();
  im.onload = () => { SPR.img = im; SPR.map = m.map; V.chunks.clear(); };
  im.src = 'assets/' + m.file + '?v=' + ART_V;
}
const sprOk = key => SPR.img && SPR.map[key];
// draw sprite `key` centred at (x, y) with the given width (height keeps the aspect), optional rotation
function drawSprite(g, key, x, y, w, rot, alpha) {
  const r = SPR.map[key]; if (!r || !SPR.img) return false;
  const h = w * r[3] / r[2];
  if (alpha !== undefined) g.globalAlpha = alpha;
  if (rot) { g.save(); g.translate(x, y); g.rotate(rot); g.drawImage(SPR.img, r[0], r[1], r[2], r[3], -w / 2, -h / 2, w, h); g.restore(); }
  else g.drawImage(SPR.img, r[0], r[1], r[2], r[3], x - w / 2, y - h / 2, w, h);
  if (alpha !== undefined) g.globalAlpha = 1;
  return true;
}

// ── interior furniture painted into the floor (flat, so it never blocks movement) ──
const FURN = {
  house: ['bed', 'table', 'sofa', 'rug', 'tv'], apartment: ['bed', 'sofa', 'table', 'rug', 'bed'], cabin: ['bed', 'fireplace', 'table'], farmhouse: ['bed', 'table', 'rug'],
  store: ['counter', 'aisle', 'aisle'], mart: ['counter', 'aisle', 'aisle', 'aisle', 'aisle', 'cart'], station: ['counter', 'aisle'],
  office: ['desks', 'desks', 'plant'], police: ['desks', 'bench', 'desks'], clinic: ['hbed', 'hbed', 'curtain'], hospital: ['hbed', 'hbed', 'hbed', 'hbed', 'curtain', 'hbed'],
  school: ['classroom', 'classroom'], church: ['pews', 'pews'], barracks: ['bunk', 'bunk', 'bunk'], bunker: ['bunk', 'table'], cellblock: ['cells', 'cells'],
  lab: ['labtable', 'labtable', 'labtable'], warehouse: ['pallet', 'pallet', 'pallet'], garage: ['oil', 'lift'], tower: ['desks'],
};
function drawFurniture(g, b, ox, oy) {
  const R = rng(W.seed ^ (b.id * 2654435761));
  const kinds = FURN[b.type] || []; if (!kinds.length) return;
  const ix = b.x + 1, iy = b.y + 1, iw = b.w - 2, ih = b.h - 2;
  const T2 = TILE, used = [];
  const free = (x, y, w, h) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { if (i < ix || j < iy || i >= ix + iw || j >= iy + ih) return false; const t = W.tile[idx(i, j)]; if (t !== T.FLOOR || W.contAt[idx(i, j)]) return false; if (b.doors.some(([dx, dy]) => Math.abs(dx - i) + Math.abs(dy - j) <= 1)) return false; }
    return !used.some(u => x < u[0] + u[2] && x + w > u[0] && y < u[1] + u[3] && y + h > u[1]);
  };
  const place = (w, h) => { for (let k = 0; k < 30; k++) { const x = ix + R.i(Math.max(1, iw - w + 1)), y = iy + R.i(Math.max(1, ih - h + 1)); if (free(x, y, w, h)) { used.push([x, y, w, h]); return [x * T2 - ox, y * T2 - oy, w * T2, h * T2]; } } return null; };
  const rect = (c, x, y, w, h, r = 3) => { g.fillStyle = c; roundRect(g, x, y, w, h, r); g.fill(); };
  const shadow = (x, y, w, h) => { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 3, y + 4, w, h); };
  for (const k of kinds) {
    switch (k) {
      case 'bed': { const p = place(2, 3) || place(3, 2); if (!p) break; const [x, y, w, h] = p; shadow(x + 3, y + 3, w - 6, h - 6); rect('#5a4030', x + 3, y + 3, w - 6, h - 6); rect(['#6a7a9a', '#9a6a6a', '#7a8a6a'][R.i(3)], x + 5, y + 14, w - 10, h - 20); rect('#e8e0d0', x + 7, y + 6, w - 14, 9); break; }
      case 'hbed': { const p = place(1, 2); if (!p) break; const [x, y, w, h] = p; shadow(x + 4, y + 2, w - 8, h - 4); rect('#c8ccd0', x + 4, y + 2, w - 8, h - 4); rect('#e8eef2', x + 6, y + 4, w - 12, 8); rect('#a8c0d0', x + 6, y + 16, w - 12, h - 22); if (R.f() < 0.5) { g.fillStyle = 'rgba(120,10,10,.5)'; g.beginPath(); g.arc(x + 16, y + 30, 6, 0, TAU); g.fill(); } break; }
      case 'bunk': { const p = place(1, 2); if (!p) break; const [x, y, w, h] = p; shadow(x + 3, y + 2, w - 6, h - 4); rect('#4a5040', x + 3, y + 2, w - 6, h - 4); rect('#6a7058', x + 5, y + 5, w - 10, h - 10); rect('#d0ccb8', x + 6, y + 6, w - 12, 7); break; }
      case 'table': { const p = place(2, 2); if (!p) break; const [x, y, w, h] = p; for (const [cx, cy] of [[x + 6, y + h / 2 - 5], [x + w - 16, y + h / 2 - 5], [x + w / 2 - 5, y + 2], [x + w / 2 - 5, y + h - 12]]) rect('#5a3c24', cx, cy, 10, 10, 2); shadow(x + 12, y + 12, w - 24, h - 24); rect('#8a6440', x + 12, y + 12, w - 24, h - 24, 4); break; }
      case 'sofa': { const p = place(3, 1) || place(1, 3); if (!p) break; const [x, y, w, h] = p; shadow(x + 2, y + 4, w - 4, h - 8); rect(['#6a4a5a', '#4a5a6a', '#6a5a3a'][R.i(3)], x + 2, y + 4, w - 4, h - 8, 5); g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x + 6, y + 8, w - 12, 4); break; }
      case 'rug': { const p = place(3, 2); if (!p) break; const [x, y, w, h] = p; rect(['#7a3030', '#30507a', '#6a5a2a'][R.i(3)], x + 4, y + 4, w - 8, h - 8, 2); g.strokeStyle = 'rgba(230,210,160,.5)'; g.lineWidth = 2; g.strokeRect(x + 9, y + 9, w - 18, h - 18); used.pop(); break; }
      case 'tv': { const p = place(2, 1); if (!p) break; const [x, y, w, h] = p; rect('#3a2a20', x + 2, y + 10, w - 4, 12); rect('#111', x + 10, y + 6, w - 20, 6, 1); break; }
      case 'fireplace': { const p = place(2, 1); if (!p) break; const [x, y, w, h] = p; rect('#6a6460', x + 2, y + 2, w - 4, h - 4); rect('#2a1a10', x + 10, y + 8, w - 20, h - 14); break; }
      case 'counter': { const p = place(3, 1); if (!p) break; const [x, y, w, h] = p; shadow(x, y + 6, w, h - 12); rect('#6a5a4a', x, y + 6, w, h - 12, 2); rect('#2a2a2a', x + 8, y + 10, 14, 10, 2); break; }
      case 'aisle': { const p = place(Math.min(5, iw - 1), 1); if (!p) break; const [x, y, w, h] = p; shadow(x + 2, y + 8, w - 4, h - 16); rect('#7a7a80', x + 2, y + 8, w - 4, h - 16, 1); for (let i = x + 4; i < x + w - 8; i += 7) { g.fillStyle = ['#c84a3a', '#e8c040', '#4a8ac8', '#6ab04a'][(i / 7 | 0) % 4]; g.fillRect(i, y + 10, 5, h - 20); } break; }
      case 'cart': { const p = place(1, 1); if (!p) break; const [x, y] = p; g.strokeStyle = '#aab'; g.lineWidth = 2; g.strokeRect(x + 6, y + 8, 20, 14); break; }
      case 'desks': { for (let n = 0; n < 3; n++) { const p = place(2, 1); if (!p) break; const [x, y, w, h] = p; shadow(x + 3, y + 6, w - 6, h - 12); rect('#7a6a52', x + 3, y + 6, w - 6, h - 12, 2); rect('#222', x + w / 2 - 6, y + 8, 12, 6, 1); g.fillStyle = '#e8e8e0'; g.fillRect(x + 8, y + 10, 8, 6); } break; }
      case 'bench': { const p = place(3, 1); if (!p) break; const [x, y, w, h] = p; rect('#5a4a3a', x + 2, y + 10, w - 4, 10, 2); break; }
      case 'plant': { const p = place(1, 1); if (!p) break; const [x, y] = p; rect('#6a4a30', x + 10, y + 12, 12, 12, 3); g.fillStyle = '#4a7a3a'; g.beginPath(); g.arc(x + 16, y + 12, 9, 0, TAU); g.fill(); break; }
      case 'curtain': { const p = place(1, 3); if (!p) break; const [x, y, w, h] = p; g.fillStyle = 'rgba(160,200,200,.6)'; g.fillRect(x + 14, y + 2, 4, h - 4); break; }
      case 'classroom': { for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) { const p = place(1, 1); if (!p) break; const [x, y] = p; rect('#8a6a40', x + 6, y + 8, 20, 12, 2); rect('#5a4a3a', x + 11, y + 22, 10, 6, 2); } break; }
      case 'pews': { for (let r = 0; r < 4; r++) { const p = place(Math.min(4, iw - 2), 1); if (!p) break; const [x, y, w, h] = p; shadow(x + 2, y + 10, w - 4, 10); rect('#5a3a24', x + 2, y + 10, w - 4, 10, 2); } break; }
      case 'cells': { const p = place(Math.min(6, iw - 1), 2); if (!p) break; const [x, y, w, h] = p; g.strokeStyle = '#6a6a70'; g.lineWidth = 2; for (let i = x; i <= x + w; i += 6) { g.beginPath(); g.moveTo(i, y + h - 2); g.lineTo(i, y + h - 10); g.stroke(); } g.beginPath(); g.moveTo(x, y + h - 6); g.lineTo(x + w, y + h - 6); g.stroke(); rect('#6a6458', x + 4, y + 4, 22, 12, 2); break; }
      case 'labtable': { const p = place(3, 1); if (!p) break; const [x, y, w, h] = p; shadow(x + 2, y + 6, w - 4, h - 12); rect('#c8d0d8', x + 2, y + 6, w - 4, h - 12, 2); for (let i = 0; i < 4; i++) { g.fillStyle = ['#5af', '#8f8', '#fa5', '#c8f'][i]; g.beginPath(); g.arc(x + 12 + i * 18, y + 16, 3, 0, TAU); g.fill(); } break; }
      case 'pallet': { const p = place(2, 2); if (!p) break; const [x, y, w, h] = p; rect('#8a6a40', x + 4, y + 4, w - 8, h - 8, 1); g.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 4; i++) g.fillRect(x + 6, y + 8 + i * 12, w - 12, 2); rect('#a89070', x + 10, y + 10, w - 20, h - 20, 2); break; }
      case 'oil': { const p = place(2, 2); if (!p) break; const [x, y, w, h] = p; g.fillStyle = 'rgba(10,10,14,.45)'; g.beginPath(); g.ellipse(x + w / 2, y + h / 2, w * 0.4, h * 0.3, 0.4, 0, TAU); g.fill(); used.pop(); break; }
      case 'lift': { const p = place(3, 2); if (!p) break; const [x, y, w, h] = p; g.strokeStyle = '#c8b040'; g.lineWidth = 3; g.strokeRect(x + 4, y + 4, w - 8, h - 8); break; }
    }
  }
  // clutter: papers, debris, blood
  for (let n = 0; n < (b.w * b.h) / 18; n++) {
    const x = (ix + R.i(iw)) * T2 - ox + R.i(24), y = (iy + R.i(ih)) * T2 - oy + R.i(24), k = R.f();
    if (k < 0.45) { g.fillStyle = 'rgba(230,226,210,.75)'; g.save(); g.translate(x, y); g.rotate(R.r(0, 3)); g.fillRect(-4, -3, 8, 6); g.restore(); }
    else if (k < 0.75) { g.fillStyle = 'rgba(60,50,40,.5)'; g.fillRect(x, y, 3 + R.i(4), 2 + R.i(3)); }
    else if (k < 0.88) { g.fillStyle = 'rgba(100,10,10,.45)'; g.beginPath(); g.arc(x, y, 3 + R.f() * 5, 0, TAU); g.fill(); }
  }
}

// ── top-down character sprites (face the top of the image; rotated to the actor's facing) ──
const CHR = { img: null, map: {}, tint: {} };
function loadChars(m) {
  if (!m || typeof Image === 'undefined') return;
  const im = new Image();
  im.onload = () => { CHR.img = im; CHR.map = m.map; CHR.tint = {}; };
  im.src = 'assets/' + m.file + '?v=' + ART_V;
}
const HUMAN_SPR = { bandit_thug: 'bandit', bandit_gunner: 'bandit', bandit_smg: 'bandit', bandit_shotgun: 'bandit_heavy', bandit_sniper: 'bandit_heavy', bandit_boss: 'bandit_boss',
  villager: 'villager', elder: 'villager', lost: 'villager', guard: 'guard', trader: 'trader', merchant: 'trader', survivor: 'survivor',
  soldier: 'soldier', soldier_heavy: 'soldier', yoon: 'soldier', cultist: 'cultist', zealot: 'cultist', cult_priest: 'priest', dr_han: 'scientist' };
function charKey(kind, id) {
  if (kind === 'walker') return 'walker' + (1 + (id % 3));
  return MOBS[kind] ? kind : HUMAN_SPR[kind];
}
const chrOk = key => CHR.img && key && CHR.map[key];
// a copy of the sprite filled with one colour (hit flash), cached
function chrTint(key, col) {
  const id = key + col; if (CHR.tint[id]) return CHR.tint[id];
  const r = CHR.map[key], c = document.createElement('canvas'); c.width = r[2]; c.height = r[3];
  const g = c.getContext('2d'); g.drawImage(CHR.img, r[0], r[1], r[2], r[3], 0, 0, r[2], r[3]);
  g.globalCompositeOperation = 'source-atop'; g.fillStyle = col; g.fillRect(0, 0, r[2], r[3]);
  return (CHR.tint[id] = c);
}
// size in px across the sprite's longer side
function charSize(kind) {
  const d = MOBS[kind] || HUMANS[kind];
  if (MOBS[kind]) return Math.max(34, d.r * TILE * 2.9) * (kind === 'hound' ? 1.15 : 1);
  return d && d.boss ? 46 : 38;
}
// o: { walk, atk, flash, alpha, scale, down }
function drawChar(g, key, x, y, ang, size, o = {}) {
  const r = CHR.map[key]; if (!r || !CHR.img) return false;
  const px = x * TILE, py = y * TILE - 8;
  const bob = Math.sin(o.walk || 0), lunge = (o.atk || 0) * 6;
  const k = size / Math.max(r[2], r[3]), w = r[2] * k * (o.scale || 1) * (1 + bob * 0.035), h = r[3] * k * (o.scale || 1) * (1 - bob * 0.02);
  g.fillStyle = 'rgba(0,0,0,.32)'; g.beginPath(); g.ellipse(px + 3, py + 11, w * 0.42, w * 0.22, 0, 0, TAU); g.fill();
  g.save();
  g.translate(px + Math.cos(ang) * lunge, py + Math.sin(ang) * lunge);
  g.rotate(ang + Math.PI / 2 + bob * 0.07 + (o.down ? 1.4 : 0));
  if (o.alpha !== undefined) g.globalAlpha = o.alpha;
  if (o.down) g.globalAlpha = (o.alpha === undefined ? 1 : o.alpha) * 0.85;
  g.drawImage(CHR.img, r[0], r[1], r[2], r[3], -w / 2, -h / 2, w, h);
  if (o.flash) { g.globalAlpha = 0.75; g.drawImage(chrTint(key, '#ffffff'), -w / 2, -h / 2, w, h); }
  else if (o.hurt) { g.globalAlpha = o.hurt * 0.45; g.drawImage(chrTint(key, '#b00000'), -w / 2, -h / 2, w, h); }
  g.restore();
  return true;
}
