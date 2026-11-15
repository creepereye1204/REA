'use strict';
// Rendering: terrain chunks, y-sorted objects, roofs, lighting, particles, HUD and panels.

let canvas, ctx, VIEW_W = 960, VIEW_H = 640, RS = 1;
const V = {
  me: 0, cam: { x: 0, y: 0 }, parts: [], tracers: [], floaters: [], msgs: [], panel: null, build: false, buildSel: 'wall_wood',
  shake: 0, hurt: 0, chunks: new Map(), roofA: [], mapOpen: false, aimX: 0, aimY: 0, frame: 0, lights: [], help: false, net: '',
  mini: null, ghost: null, banner: null, comm: [], commT: 0, boss: null, ending: null, dmgNums: [], hitMark: null, hitStop: 0, recoil: 0,
};

// ── generated art (item icons, portraits, illustrations) ──────────────────
const ART_V = 4; // bump when assets/ change so browsers refetch
const ART = { items: null, im: {}, por: null, pm: {}, scenes: {}, sceneSrc: {} };
function loadArt() {
  if (typeof fetch !== 'function' || typeof Image === 'undefined') return;
  fetch('assets/art.json?v=' + ART_V).then(r => r.json()).then(m => {
    ART.im = m.items.map; ART.pm = m.portraits.map; ART.sceneSrc = m.scenes;
    if (m.ground) loadGroundArt(m.ground);
    if (m.sprites) loadSprites(m.sprites);
    if (m.chars) loadChars(m.chars);
    ART.items = new Image(); ART.items.src = 'assets/' + m.items.file + '?v=' + ART_V;
    ART.por = new Image(); ART.por.src = 'assets/' + m.portraits.file + '?v=' + ART_V;
    sceneImg('scene_title');
  }).catch(() => {});
}
const imgOk = i => i && i.complete && i.naturalWidth > 0;
function drawIcon(g, key, x, y, s) {
  const r = ART.im[key];
  if (r && imgOk(ART.items)) { g.drawImage(ART.items, r[0], r[1], r[2], r[2], x - s / 2, y - s / 2, s, s); return true; }
  const wk = key.startsWith('wpn_') || key.startsWith('mag_') ? key.slice(4) : null;
  if (wk && GUN_LOOK[wk]) { // drawn silhouette for weapons without a painted icon
    const [len, col, wd] = GUN_LOOK[wk], k = s / 34;
    g.save(); g.translate(x, y); g.rotate(-0.6); g.lineCap = 'round';
    if (key.startsWith('mag_')) { g.fillStyle = '#2a2a2a'; g.fillRect(-4 * k, -8 * k, 8 * k, 16 * k); g.fillStyle = '#c8a040'; g.fillRect(-3 * k, -9 * k, 6 * k, 3 * k); }
    else { g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = (wd + 3) * k; g.beginPath(); g.moveTo(-len * 0.55 * k, 0); g.lineTo(len * 0.55 * k, 0); g.stroke(); g.strokeStyle = col; g.lineWidth = wd * k; g.stroke(); g.fillStyle = '#4a3020'; g.fillRect(-len * 0.55 * k - 2, -2 * k, 7 * k, 4 * k); }
    g.restore(); return false;
  }
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
  if (!ART.scenes[key]) { ART.scenes[key] = new Image(); ART.scenes[key].src = 'assets/' + ART.sceneSrc[key] + '?v=' + ART_V; }
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
  const X0 = cx * CH, Y0 = cy * CH;
  for (const b of W.buildings) if (b.x < X0 + CH && b.x + b.w > X0 && b.y < Y0 + CH && b.y + b.h > Y0) drawFurniture(g, b, X0 * TILE, Y0 * TILE);
  V.chunks.set(key, c);
  return c;
}
function invalidateChunkAt(i) {
  V.chunks.delete(Math.floor(cellX(i) / CH) + ',' + Math.floor(cellY(i) / CH));
  if (V.mini) { const g = V.mini.getContext('2d'), c = miniCol(W.tile[i], cellX(i), cellY(i)); g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; g.fillRect(cellX(i), cellY(i), 1, 1); }
}
function groundOf(t, x, y) {
  if (t === T.TREE || t === T.STUMP || t === T.BUSH) { const b = W.biome[idx(x, y)]; return b === BIO.SWAMP ? T.MUD : b === BIO.MOUNTAIN ? T.DIRT : T.GRASS; }
  if (t === T.ROCK) { const b = W.biome[idx(x, y)]; return b === BIO.MOUNTAIN ? T.GRAVEL : b === BIO.BEACH ? T.SAND : T.GRASS; }
  if (t === T.DEADTREE || t === T.RUIN) { const b = W.biome[idx(x, y)]; return b === BIO.WASTE ? T.ASH : b === BIO.SWAMP ? T.MUD : T.DIRT; }
  if (t === T.WALL || t === T.DOOR) return T.FLOOR;
  if (t === T.FENCE) { const v = W.villages.some(v => x >= v.x && y >= v.y && x < v.x + v.w && y < v.y + v.h); return v ? T.VFLOOR : T.CAMPDIRT; }
  if (t === T.TENT) return T.CAMPDIRT;
  if (t === T.GRAVE) return T.DIRT;
  return t;
}
const GROUND = {
  [T.GRASS]: [62, 92, 46], [T.DIRT]: [104, 88, 60], [T.ROAD]: [56, 57, 61], [T.WALK]: [128, 126, 120], [T.FLOOR]: [120, 90, 60],
  [T.CONCRETE]: [112, 114, 116], [T.WATER]: [38, 86, 120], [T.SAND]: [196, 176, 120], [T.VFLOOR]: [140, 116, 80], [T.CAMPDIRT]: [92, 72, 50],
  [T.CROP]: [96, 84, 52], [T.PAD]: [70, 74, 80], [T.MUD]: [74, 66, 46], [T.ASH]: [78, 74, 70], [T.PADDY]: [70, 96, 82], [T.GRAVEL]: [118, 112, 104], [T.RUBBLE]: [100, 96, 90],
};
function miniCol(t, x, y) {
  return t === T.TREE ? [30, 60, 24] : t === T.WALL ? [150, 120, 100] : t === T.FENCE ? [120, 90, 50] : t === T.ROCK ? [110, 110, 110] : t === T.TENT ? [130, 110, 70] : t === T.ROAD ? [40, 40, 44]
    : t === T.DEADTREE ? [60, 50, 40] : t === T.RUIN ? [130, 126, 120] : t === T.BUSH ? [44, 76, 34] : t === T.WATER ? (W.biome[idx(x, y)] === BIO.OCEAN ? [24, 58, 92] : [38, 86, 120]) : GROUND[groundOf(t, x, y)] || [80, 80, 80];
}
function drawGround(g, tx, ty, px, py) {
  const i = idx(tx, ty), t0 = W.tile[i], t = groundOf(t0, tx, ty), h = hash(tx, ty);
  buildTextures();
  if (TEX_READY && paintGroundTex(g, tx, ty, px, py, t)) groundOverlay(g, tx, ty, px, py, t, h);
  else {
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
      const rd = (a, b) => inMap(a, b) && W.tile[idx(a, b)] === T.ROAD;
      const centerH = rd(tx, ty - 1) && rd(tx, ty + 1) && !rd(tx, ty - 2) && !rd(tx, ty + 2), centerV = rd(tx - 1, ty) && rd(tx + 1, ty) && !rd(tx - 2, ty) && !rd(tx + 2, ty);
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
    } else if (t === T.MUD) {
      g.fillStyle = 'rgba(30,26,16,.35)'; g.beginPath(); g.ellipse(px + h * 20 + 6, py + 14, 8, 4, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(120,140,110,.15)'; g.fillRect(px + (1 - h) * 22, py + 24, 6, 2);
    } else if (t === T.ASH) {
      g.fillStyle = 'rgba(20,18,16,.25)'; for (let k = 0; k < 4; k++) g.fillRect(px + hash(tx + k, ty) * 28, py + hash(tx, ty + k) * 28, 3, 3);
      if (h > 0.85) { g.fillStyle = 'rgba(200,90,40,.35)'; g.fillRect(px + h * 20, py + 10, 2, 2); }
    } else if (t === T.PADDY) {
      g.fillStyle = 'rgba(160,200,230,.18)'; g.fillRect(px, py, TILE, TILE);
      g.fillStyle = '#6a9a3a'; for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) g.fillRect(px + 5 + k * 10, py + 4 + j * 10, 2, 6);
    } else if (t === T.GRAVEL || t === T.RUBBLE) {
      for (let k = 0; k < (t === T.RUBBLE ? 7 : 5); k++) { g.fillStyle = k % 2 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.1)'; g.fillRect(px + hash(tx * 3 + k, ty) * 28, py + hash(tx, ty * 3 + k) * 28, t === T.RUBBLE ? 5 : 3, t === T.RUBBLE ? 4 : 2); }
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
  }
  if (t0 === T.DOOR) { g.fillStyle = '#5a3a20'; g.fillRect(px + 2, py + 2, TILE - 4, TILE - 4); g.fillStyle = '#7a5a34'; g.fillRect(px + 5, py + 5, TILE - 10, TILE - 10); }
  if (t0 === T.STUMP) { g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(px + 16, py + 20, 9, 4, 0, 0, TAU); g.fill(); g.fillStyle = '#6a4a2a'; g.beginPath(); g.arc(px + 16, py + 17, 7, 0, TAU); g.fill(); g.fillStyle = '#a07a4a'; g.beginPath(); g.arc(px + 16, py + 16, 5, 0, TAU); g.fill(); }
}
// where am I? village / camp / landmark / town, else the biome
function placeName(x, y) {
  for (const v of W.villages) if (inRect(x, y, v)) return v.name;
  for (const c of W.camps) if (inRect(x, y, c, 2)) return c.name;
  for (const P of W.pois) if (inRect(x, y, P, 1)) return P.name;
  if (inBase(x, y)) return '생존자 기지';
  for (const t of W.towns) if (dist(x, y, t.x, t.y) < t.r + 4) return t.name;
  return BIOME_NAMES[biomeAt(x, y)];
}
// markings drawn over textured ground
function groundOverlay(g, tx, ty, px, py, t, h) {
  if (t === T.ROAD) {
    const rd = (a, b) => inMap(a, b) && W.tile[idx(a, b)] === T.ROAD;
    const centerH = rd(tx, ty - 1) && rd(tx, ty + 1) && !rd(tx, ty - 2) && !rd(tx, ty + 2), centerV = rd(tx - 1, ty) && rd(tx + 1, ty) && !rd(tx - 2, ty) && !rd(tx + 2, ty);
    g.fillStyle = 'rgba(214,190,90,.85)';
    if (centerH && !centerV && tx % 3 !== 0) g.fillRect(px + 2, py + 15, TILE - 4, 2);
    if (centerV && !centerH && ty % 3 !== 0) g.fillRect(px + 15, py + 2, 2, TILE - 4);
    const edgeN = !rd(tx, ty - 1) && W.tile[idx(tx, Math.max(0, ty - 1))] !== T.ROAD, edgeS = !rd(tx, ty + 1);
    g.fillStyle = 'rgba(0,0,0,.18)'; if (edgeN) g.fillRect(px, py, TILE, 2); if (edgeS) g.fillRect(px, py + TILE - 2, TILE, 2);
    if (!rd(tx - 1, ty)) g.fillRect(px, py, 2, TILE); if (!rd(tx + 1, ty)) g.fillRect(px + TILE - 2, py, 2, TILE);
    if (h > 0.93) { g.fillStyle = 'rgba(20,20,20,.35)'; g.beginPath(); g.ellipse(px + 16, py + 16, 9, 6, h * 6, 0, TAU); g.fill(); }
  } else if (t === T.CONCRETE) {
    const b0 = W.base;
    if ((tx === b0.x + 1 || tx === b0.x + b0.w - 2 || ty === b0.y + 1 || ty === b0.y + b0.h - 2) && ((tx + ty) % 2)) { g.fillStyle = 'rgba(220,180,40,0.55)'; g.fillRect(px + 6, py + 6, 20, 20); }
  } else if (t === T.PAD) {
    g.strokeStyle = 'rgba(240,210,60,.8)'; g.lineWidth = 2;
    if (W.tile[idx(tx, ty - 1)] !== T.PAD) { g.beginPath(); g.moveTo(px, py + 2); g.lineTo(px + TILE, py + 2); g.stroke(); }
    if (W.tile[idx(tx, ty + 1)] !== T.PAD) { g.beginPath(); g.moveTo(px, py + TILE - 2); g.lineTo(px + TILE, py + TILE - 2); g.stroke(); }
    if (W.tile[idx(tx - 1, ty)] !== T.PAD) { g.beginPath(); g.moveTo(px + 2, py); g.lineTo(px + 2, py + TILE); g.stroke(); }
    if (W.tile[idx(tx + 1, ty)] !== T.PAD) { g.beginPath(); g.moveTo(px + TILE - 2, py); g.lineTo(px + TILE - 2, py + TILE); g.stroke(); }
  } else if (t === T.GRASS && h > 0.9) {
    g.fillStyle = ['#d8d860', '#e0a0c0', '#f0f0f0', '#a0b8ff'][(h * 1000 | 0) % 4]; g.fillRect(px + h * 24, py + (1 - h) * 24 + 4, 3, 3);
  } else if (t === T.WATER) {
    // foam where water meets land
    const land = (a, b) => inMap(a, b) && W.tile[idx(a, b)] !== T.WATER && W.tile[idx(a, b)] !== T.ROAD;
    g.fillStyle = 'rgba(220,235,240,.35)';
    if (land(tx, ty - 1)) g.fillRect(px, py, TILE, 3); if (land(tx, ty + 1)) g.fillRect(px, py + TILE - 3, TILE, 3);
    if (land(tx - 1, ty)) g.fillRect(px, py, 3, TILE); if (land(tx + 1, ty)) g.fillRect(px + TILE - 3, py, 3, TILE);
  }
  // soft contact shadow along the foot of walls
  if (inMap(tx, ty - 1) && TILE_OPAQUE[W.tile[idx(tx, ty - 1)]] && W.tile[idx(tx, ty - 1)] !== T.BUSH) { const gr = g.createLinearGradient(0, py, 0, py + 12); gr.addColorStop(0, 'rgba(0,0,0,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(px, py, TILE, 12); }
}
// sprite corpse: the character lying where it fell, darkened, in a pool of blood
function corpseSprite(x, y, key, size, a) {
  const cx = Math.floor(x / CH), cy = Math.floor(y / CH), c = V.chunks.get(cx + ',' + cy), r = CHR.map[key];
  if (!c || !r) return;
  const g = c.getContext('2d'), ox = (x - cx * CH) * TILE + Math.cos(a) * 10, oy = (y - cy * CH) * TILE - 8 + Math.sin(a) * 10, s = size / Math.max(r[2], r[3]);
  g.fillStyle = 'rgba(70,6,6,.55)'; g.beginPath(); g.ellipse(ox, oy, size * 0.45, size * 0.32, a, 0, TAU); g.fill();
  g.save(); g.translate(ox, oy); g.rotate(a + Math.PI / 2 + 1.3); g.globalAlpha = 0.9;
  g.drawImage(CHR.img, r[0], r[1], r[2], r[3], -r[2] * s * 0.44, -r[3] * s * 0.44, r[2] * s * 0.88, r[3] * s * 0.88);
  g.globalAlpha = 0.45; g.drawImage(chrTint(key, '#1a0606'), -r[2] * s * 0.44, -r[3] * s * 0.44, r[2] * s * 0.88, r[3] * s * 0.88);
  g.restore();
}
// a body left on the ground (drawn into the terrain chunk, so it stays until the chunk is evicted)
function corpse(x, y, color, big) {
  const cx = Math.floor(x / CH), cy = Math.floor(y / CH), c = V.chunks.get(cx + ',' + cy);
  if (!c) return;
  const g = c.getContext('2d'), ox = (x - cx * CH) * TILE, oy = (y - cy * CH) * TILE, a = rnd(0, TAU), s = big ? 1.7 : 1;
  g.save(); g.translate(ox, oy); g.rotate(a);
  g.fillStyle = 'rgba(70,6,6,.55)'; g.beginPath(); g.ellipse(2, 2, 15 * s, 10 * s, 0.3, 0, TAU); g.fill();
  g.fillStyle = shade(color && color[0] === '#' ? color : '#5a5a4a', 0.55); roundRect(g, -10 * s, -5 * s, 18 * s, 10 * s, 4 * s); g.fill();
  g.fillStyle = 'rgba(30,20,16,.9)'; g.beginPath(); g.arc(11 * s, 0, 4.5 * s, 0, TAU); g.fill();
  g.strokeStyle = shade(color && color[0] === '#' ? color : '#5a5a4a', 0.45); g.lineWidth = 3 * s; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-2 * s, -5 * s); g.lineTo(6 * s, -12 * s); g.moveTo(-2 * s, 5 * s); g.lineTo(-8 * s, 12 * s); g.stroke();
  g.restore();
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
    const col = miniCol(W.tile[i], cellX(i), cellY(i)), o = i * 4;
    im.data[o] = col[0]; im.data[o + 1] = col[1]; im.data[o + 2] = col[2]; im.data[o + 3] = 255;
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
    case 'hit': {
      const mine = o.pid === V.me;
      // spray of blood in the shot direction
      for (let k = 0; k < (o.kill ? 10 : 5) + (o.c ? 4 : 0); k++) { const a = o.a + rnd(-0.6, 0.6), sp = rnd(2, 6); V.parts.push({ k: 'drop', x: o.x, y: o.y, z: 0.7, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rnd(1, 3), c: k % 3 ? '#9a1010' : '#5a0808', t: 0, life: 0.7 }); }
      decal(o.x + Math.cos(o.a) * 0.5, o.y + Math.sin(o.a) * 0.5, o.kill ? 0.45 : 0.25, '#5b0f0f', o.kill ? 6 : 3);
      V.parts.push({ k: 'impact', x: o.x, y: o.y, t: 0, life: 0.14, c: o.c });
      if (mine) {
        V.dmgNums.push({ x: o.x + rnd(-0.2, 0.2), y: o.y, d: o.d, c: o.c, kill: o.kill, t: 0, vx: Math.cos(o.a) * 0.6 + rnd(-0.3, 0.3) });
        V.hitMark = { t: 0, kill: o.kill, c: o.c };
        sfx(o.kill ? 'killm' : o.c ? 'critm' : 'hitm');
        if (o.kill) { V.shake = Math.max(V.shake, o.big ? 9 : 4); V.hitStop = o.big ? 0.09 : 0.04; V.parts.push({ k: 'killring', x: o.x, y: o.y, t: 0, life: 0.35 }); }
        else if (o.c) V.shake = Math.max(V.shake, 3);
      }
      break;
    }
    case 'flash': V.parts.push({ k: 'flash', x: o.x, y: o.y, a: o.a, t: 0, life: 0.06, big: o.w === 'shotgun' || o.w === 'sniper' || o.w === 'launcher' });
      if (o.pid === V.me) { const kick = { pistol: 2, smg: 1.6, rifle: 2.4, shotgun: 6, sniper: 8, launcher: 7 }[o.w] || 1.5; V.shake = Math.max(V.shake, kick); V.recoil = Math.min(14, (V.recoil || 0) + kick * 1.4); V.kickA = o.a; } V.lights.push({ x: o.x, y: o.y, r: 3, t: 0.06, c: '255,200,120' });
      if (V.parts.length < 400) V.parts.push({ k: 'shell', x: o.x, y: o.y, z: 0.5, vx: Math.cos(o.a + 1.6) * rnd(1.5, 3), vy: Math.sin(o.a + 1.6) * rnd(1.5, 3), vz: rnd(2, 3.5), t: 0, life: 1.2, rot: rnd(0, 6) });
      break;
    case 'lightning': V.flashT = 0.35; V.shake = Math.max(V.shake, 3); setTimeout(() => sfx('thunder'), 300 + Math.random() * 900); break;
    case 'blood': for (let k = 0; k < 5; k++) V.parts.push({ k: 'drop', x: o.x, y: o.y, z: 0.6, vx: rnd(-2, 2), vy: rnd(-2, 2), vz: rnd(1, 3), c: o.z ? '#3a5a1a' : '#8a1010', t: 0, life: 0.6 }); decal(o.x, o.y, 0.25, o.z ? '#2a3a12' : '#5b0f0f', 2); break;
    case 'gib': if (o.kind && chrOk(charKey(o.kind, o.id || 0))) { const key = charKey(o.kind, o.id || 0); V.parts.push({ k: 'dying', key, x: o.x, y: o.y, a: o.a || rnd(0, TAU), size: charSize(o.kind), t: 0, life: 0.45 }); setTimeout(() => corpseSprite(o.x, o.y, key, charSize(o.kind), o.a || 0), 450); } else corpse(o.x, o.y, o.c, o.big);
      for (let k = 0; k < (o.big ? 14 : 8); k++) V.parts.push({ k: 'chunk', x: o.x, y: o.y, z: 0.6, vx: rnd(-3, 3), vy: rnd(-3, 3), vz: rnd(2, 5), c: k % 2 ? o.c : '#5a0a0a', t: 0, life: 0.9 }); decal(o.x, o.y, o.big ? 0.6 : 0.4, '#4a0c0c', o.big ? 14 : 8); break;
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
    case 'flame': for (let k = 0; k < 3; k++) { const a = o.a + rnd(-0.22, 0.22), sp = rnd(5, 9); V.parts.push({ k: 'fire', x: o.x, y: o.y, vx0: Math.cos(a) * sp, vy0: Math.sin(a) * sp, t: 0, life: rnd(0.35, 0.6), s: rnd(4, 8) }); } V.lights.push({ x: o.x, y: o.y, r: 3, t: 0.08, c: '255,140,40' }); break;
    case 'tele': V.parts.push({ k: 'tele', x: o.x, y: o.y, a: o.a, len: o.len, w: o.w, t: 0, life: o.t }); break;
    case 'alarmping': V.parts.push({ k: 'ring', x: o.x, y: o.y, t: 0, life: 0.8 }); break;
    case 'float': V.floaters.push({ x: o.x, y: o.y, text: o.text, c: o.c, icon: o.icon, t: 0, life: o.icon ? 1.8 : 1.4 }); break;
    case 'hurt': if (o.pid === V.me) { V.hurt = 1; V.shake = Math.max(V.shake, 5); sfx('hurt'); } break;
    case 'tile': W.tile[o.i] = o.v; updateCellMB(o.i); invalidateChunkAt(o.i); break;
    case 'cont': if (W.conts[o.id]) W.conts[o.id].looted = !!o.v; break;
    case 'newcont': if (NET.role === 'client' && !W.conts[o.id]) { const c = W.addCont(o.kind, o.x, o.y, -1); if (c) updateCellMB(idx(o.x, o.y)); } break;
    case 'contgone': { const c = W.conts[o.id]; if (c) { for (const k of c.cells) if (W.contAt[k] === c) { W.contAt[k] = null; updateCellMB(k); } c.gone = true; } break; }
    case 'contmove': { const c = W.conts[o.id]; if (c) { for (const k of c.cells) if (W.contAt[k] === c) { W.contAt[k] = null; updateCellMB(k); } Object.assign(c, { cells: o.cells, x: o.x, y: o.y, horiz: o.horiz, fuel: o.fuel, gone: false, looted: true }); for (const k of c.cells) { W.contAt[k] = c; updateCellMB(k); } } break; }
    case 'tp': if (o.pid === V.me) V.camInit = false; break;
    case 'over': sfx('over'); break;
    case 'died': if (o.pid === V.me) { sfx('over'); V.shake = 10; } break;
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
  if (!G) { drawTitle(g); drawUI(g); if (typeof updateAudio === "function") updateAudio(0.016); return; }
  const me = meP();
  const zoom = 1;
  if (V.frame % 10 === 0) {
    revealAround(me.x, me.y, 3);
    for (const q of G.players) if (q && q !== me && q.joined) revealAround(q.x, q.y, 2);
    const nm = placeName(me.x, me.y);
    if (nm !== V.place) { if (V.place !== undefined) V.banner = { text: nm, t: 0 }; V.place = nm; }
  }
  const tx = me.x * TILE - VIEW_W / 2, ty = me.y * TILE - VIEW_H / 2;
  if (!V.camInit) { V.cam.x = tx; V.cam.y = ty; V.camInit = true; }
  V.cam.x += (tx - V.cam.x) * 0.15; V.cam.y += (ty - V.cam.y) * 0.15;
  V.cam.x = clamp(V.cam.x, -TILE * 2, MW * TILE - VIEW_W + TILE * 2); V.cam.y = clamp(V.cam.y, -TILE * 2, MH * TILE - VIEW_H + TILE * 2);
  const kx = V.recoil ? -Math.cos(V.kickA || 0) * V.recoil : 0, ky = V.recoil ? -Math.sin(V.kickA || 0) * V.recoil : 0;
  const sx = Math.round(V.cam.x + kx + rnd(-V.shake, V.shake)), sy = Math.round(V.cam.y + ky + rnd(-V.shake, V.shake));
  V.shake *= 0.85; if (V.shake < 0.3) V.shake = 0;
  g.save(); g.translate(-sx, -sy); g.scale(zoom, zoom);

  // ground
  const c0x = Math.floor(sx / TILE / CH), c1x = Math.floor((sx + VIEW_W) / TILE / CH), c0y = Math.floor(sy / TILE / CH), c1y = Math.floor((sy + VIEW_H + WALL_H) / TILE / CH);
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) if (cx >= 0 && cy >= 0 && cx * CH < MW && cy * CH < MH) g.drawImage(chunkCanvas(cx, cy), cx * CH * TILE, cy * CH * TILE);

  // flat things: spikes, mines, drops, build radius
  const x0 = Math.max(0, Math.floor(sx / TILE) - 1), x1 = Math.min(MW, Math.ceil((sx + VIEW_W) / TILE) + 1);
  const y0 = Math.max(0, Math.floor(sy / TILE) - 1), y1 = Math.min(MH, Math.ceil((sy + VIEW_H) / TILE) + 2);
  waterShimmer(g, x0, y0, x1, y1);
  sunShadows(g, x0, y0, x1, y1);
  if (V.build) {
    g.strokeStyle = 'rgba(120,200,255,0.35)'; g.setLineDash([8, 8]); g.lineWidth = 2; g.beginPath(); g.arc(G.core.x * TILE, G.core.y * TILE, BUILD_RADIUS * TILE, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(255,180,80,0.4)'; for (const s of G.structs) if (s.type === 'campfire') { g.beginPath(); g.arc(s.x * TILE, s.y * TILE, OUTPOST_RADIUS * TILE, 0, TAU); g.stroke(); }
    g.setLineDash([]);
  }
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
    else if (t === T.DEADTREE) list.push({ y: y + 0.8, f: drawDeadTree, a: x, b: y });
    else if (t === T.BUSH) list.push({ y: y + 0.7, f: drawBush, a: x, b: y });
    else if (t === T.RUIN) list.push({ y: y + 1, f: drawRuin, a: x, b: y });
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
  for (const v of W.villages) { const bp = boardPos(v); if (bp.x > x0 - 2 && bp.x < x1 + 2 && bp.y > y0 - 2 && bp.y < y1 + 3) list.push({ y: bp.y + 0.3, f: drawBoard, a: v }); }
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
    g.globalAlpha = 1 - t.t / t.life; g.strokeStyle = t.c === 2 ? '#bfe6ff' : t.c === 3 ? '#ff9a40' : '#ffe9a0'; g.lineWidth = t.c === 2 ? 3 : t.c === 3 ? 2.2 : 1.6;
    g.beginPath(); g.moveTo(t.x1 * TILE, t.y1 * TILE - 14); g.lineTo(t.x2 * TILE, t.y2 * TILE - 14); g.stroke();
  }
  g.globalAlpha = 1;
  for (const p of V.parts) drawPart(g, p);
  ambient(g, sx, sy);
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
  for (const n of V.dmgNums) {
    const k = n.t / 0.9, pop = n.t < 0.08 ? 1 + (0.08 - n.t) * 12 : 1, size = (n.c ? 20 : n.kill ? 17 : 14) * pop;
    g.globalAlpha = clamp((1 - k) * 2, 0, 1); g.font = `900 ${size | 0}px system-ui, sans-serif`; g.textAlign = 'center';
    const px = (n.x + n.vx * n.t) * TILE, py = n.y * TILE - 34 - n.t * 46 + n.t * n.t * 30;
    const s = (n.c ? '치명타 ' : '') + n.d;
    g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(s, px, py);
    g.fillStyle = n.c ? '#ffd23a' : n.kill ? '#ff6a4a' : '#ffffff'; g.fillText(s, px, py);
  }
  g.globalAlpha = 1;
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
  if (V.banner) {
    const b = V.banner; b.t += Math.min(0.05, dtReal || 0.016);
    const a = clamp(Math.min(b.t / 0.5, (3.2 - b.t) / 0.8), 0, 1);
    if (b.t > 3.2) V.banner = null;
    else {
      g.globalAlpha = a; g.textAlign = 'center';
      g.font = `600 ${VIEW_W < 700 ? 20 : 28}px "Noto Serif KR", serif`;
      const w = g.measureText(b.text).width, y = VIEW_H * 0.24;
      const gr = g.createLinearGradient(VIEW_W / 2 - w, 0, VIEW_W / 2 + w, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(VIEW_W / 2 - w, y - 34, w * 2, 50);
      g.fillStyle = '#efe4c4'; g.fillText(b.text, VIEW_W / 2, y);
      g.fillStyle = 'rgba(239,228,196,.6)'; g.fillRect(VIEW_W / 2 - w * 0.4, y + 9, w * 0.8, 1);
      g.globalAlpha = 1;
    }
  }
  drawHud(g);
  drawUI(g);
  drawCrosshair(g);
  if (typeof updateAudio === 'function') updateAudio(V.dt);
  // advance local particles in real time
  const dt = Math.min(0.05, dtReal);
  for (const p of V.parts) { p.t += dt; if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; p.vz -= 12 * dt; p.z += p.vz * dt; if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.5; p.vy *= 0.5; } } }
  V.parts = V.parts.filter(p => p.t < p.life);
  for (const t of V.tracers) t.t += dt; V.tracers = V.tracers.filter(t => t.t < t.life);
  for (const f of V.floaters) f.t += dt; V.floaters = V.floaters.filter(f => f.t < f.life);
  for (const n of V.dmgNums) n.t += dt; V.dmgNums = V.dmgNums.filter(n => n.t < 0.9); if (V.dmgNums.length > 40) V.dmgNums.splice(0, V.dmgNums.length - 40);
  if (V.hitMark) { V.hitMark.t += dt; if (V.hitMark.t > 0.25) V.hitMark = null; }
  V.recoil = (V.recoil || 0) * Math.pow(0.002, dt);
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
// painted sprite versions (when the atlas is loaded): a trunk, a ground shadow and the crown seen from above
function spriteTree(g, x, y, key, size) {
  const px = x * TILE + 16, py = y * TILE + 16, h = hash(x, y), s = size * (0.85 + h * 0.35), sway = Math.sin(V.frame / 70 + h * 10) * 1.2;
  g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(px + 8, py + 8, s * 0.42, s * 0.22, 0, 0, TAU); g.fill();
  g.fillStyle = '#4a3020'; g.fillRect(px - 3, py - 8, 6, 16);
  const me = meP(), under = me && Math.abs(me.x - x - 0.5) < 1.6 && me.y - y < 0.8 && y - me.y < 2.6;
  return drawSprite(g, key, px + sway, py - s * 0.36, s, h * TAU, under ? 0.4 : undefined);
}
function drawTree(g, x, y) {
  const px = x * TILE + 16, py = y * TILE + 16, h = hash(x, y), s = 0.85 + h * 0.4;
  if (SPR.img) { const b = W.biome[idx(x, y)], key = b === BIO.MOUNTAIN || (b === BIO.FOREST && h > 0.72) ? (h > 0.86 ? 'pine2' : 'pine1') : ['tree1', 'tree2', 'tree3'][(h * 3) | 0]; if (sprOk(key) && spriteTree(g, x, y, key, 74)) return; }
  const sway = Math.sin(V.frame / 60 + h * 10) * 1.5;
  g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(px + 4, py + 8, 18 * s, 8 * s, 0, 0, TAU); g.fill();
  g.fillStyle = '#4a3020'; g.fillRect(px - 3, py - 10, 6, 18);
  const cols = h > 0.5 ? ['#1f4a22', '#2a5e2c', '#3a7a36'] : ['#26472a', '#30603a', '#43784a'];
  for (let k = 0; k < 3; k++) { g.fillStyle = cols[k]; g.beginPath(); g.arc(px + sway * (k + 1) / 3 - k * 2, py - 22 - k * 5, (18 - k * 4) * s, 0, TAU); g.fill(); }
}
function drawDeadTree(g, x, y) {
  const px = x * TILE + 16, py = y * TILE + 22, h = hash(x, y);
  if (sprOk('deadtree1') && spriteTree(g, x, y, W.biome[idx(x, y)] === BIO.WASTE ? 'deadtree2' : 'deadtree1', 62)) return;
  g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(px + 3, py + 2, 10, 4, 0, 0, TAU); g.fill();
  g.strokeStyle = '#3a2e24'; g.lineCap = 'round'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(px, py); g.lineTo(px + (h - 0.5) * 6, py - 34); g.stroke();
  g.lineWidth = 2.5;
  for (let k = 0; k < 4; k++) { const a = -Math.PI / 2 + (k - 1.5) * 0.7 + (h - 0.5), sy = py - 14 - k * 5; g.beginPath(); g.moveTo(px + (h - 0.5) * 3, sy); g.lineTo(px + Math.cos(a) * 16, sy + Math.sin(a) * 12); g.stroke(); }
}
function drawBush(g, x, y) {
  const px = x * TILE + 16, py = y * TILE + 20, h = hash(x, y), b = W.biome[idx(x, y)];
  if (sprOk('bush1')) { g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(px + 3, py + 2, 15, 6, 0, 0, TAU); g.fill(); if (drawSprite(g, h > 0.6 ? 'bush2' : 'bush1', px, py - 6, 38 + h * 8, h * TAU)) return; }
  const cols = b === BIO.SWAMP ? ['#2c4026', '#3a5430', '#4a6638'] : ['#2f5a26', '#3d7030', '#4f8a3a'];
  g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(px + 2, py + 2, 14, 5, 0, 0, TAU); g.fill();
  for (let k = 0; k < 3; k++) { g.fillStyle = cols[k]; g.beginPath(); g.arc(px - 7 + k * 7 + (h - 0.5) * 4, py - 6 - (k === 1 ? 5 : 0), 9 - k, 0, TAU); g.fill(); }
  if (h > 0.6) { g.fillStyle = '#c0303a'; for (let k = 0; k < 3; k++) g.fillRect(px - 6 + k * 6, py - 10 + (k % 2) * 4, 3, 3); }
}
function drawRuin(g, x, y) {
  const px = x * TILE, py = y * TILE, h = hash(x, y), ht = 10 + h * 14;
  const crash = W.pois.some(P => P.wreck && x >= P.x && y >= P.y && x < P.x + P.w && y < P.y + P.h);
  g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(px + 2, py + TILE - 6, TILE, 8);
  g.fillStyle = crash ? '#5a6068' : '#6a645c'; g.fillRect(px, py + TILE - ht, TILE, ht);
  g.fillStyle = crash ? '#8a929c' : '#8e877c';
  g.beginPath(); g.moveTo(px, py + TILE - ht); g.lineTo(px + TILE * 0.3, py + TILE - ht - 6 - h * 6); g.lineTo(px + TILE * 0.7, py + TILE - ht - 2); g.lineTo(px + TILE, py + TILE - ht - 8 * h); g.lineTo(px + TILE, py + TILE - ht + 6); g.lineTo(px, py + TILE - ht + 6); g.fill();
  g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(px + 6, py + TILE - ht + 8, 3, ht - 10); g.fillRect(px + 20, py + TILE - ht + 10, 2, ht - 12);
}
function drawRock(g, x, y) {
  const px = x * TILE + 16, py = y * TILE + 18;
  if (sprOk('rock1')) { const h = hash(x, y); g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(px + 3, py + 4, 16, 7, 0, 0, TAU); g.fill(); if (drawSprite(g, ['rock1', 'rock2', 'rock3'][(h * 3) | 0], px, py - 5, 36 + h * 8, h * TAU)) return; }
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
const ROOF_OF = { house: 'roof_red', store: 'roof_metal', police: 'roof_concrete', clinic: 'roof_concrete', garage: 'roof_metal', warehouse: 'roof_green', office: 'roof_concrete',
  hospital: 'roof_concrete', lab: 'roof_concrete', barracks: 'roof_green', church: 'roof_shingle', cellblock: 'roof_concrete', school: 'roof_red', station: 'roof_metal',
  farmhouse: 'roof_shingle', tower: 'roof_concrete', apartment: 'roof_concrete', mart: 'roof_metal', bunker: 'roof_concrete', cabin: 'roof_shingle' };
const roofPat = {};
function drawRoof(g, b, a) {
  const px = b.x * TILE, py = b.y * TILE - WALL_H, w = b.w * TILE, h = b.h * TILE;
  const rk = ROOF_OF[b.type], rt = rk && TEX[rk];
  if (rt) {
    g.globalAlpha = a;
    const pat = roofPat[rk] || (roofPat[rk] = g.createPattern(rt, 'repeat'));
    g.save(); g.translate(px - 3, py - 3); g.fillStyle = pat; g.fillRect(0, 0, w + 6, h + 6); g.restore();
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(px - 3, py - 3, w + 6, h / 2 + 3); // lit slope
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(px - 3, py + h / 2, w + 6, h / 2 + 3);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(px - 3, py + h / 2 - 1, w + 6, 3); // ridge
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 2; g.strokeRect(px - 3, py - 3, w + 6, h + 6);
    if (b.village >= 0 && G.vh[b.village] <= 0) { g.fillStyle = 'rgba(255,200,120,.5)'; g.fillRect(px + w * 0.3, py + h * 0.75, 6, 4); }
    if (a > 0.6) { g.font = 'bold 12px system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.8)'; g.fillText(b.village >= 0 ? '민가' : b.name, px + w / 2, py + h / 2 - 6); }
    g.globalAlpha = 1;
    return;
  }
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
// top-down car, rotated; used for parked and driven cars
const CAR_SPR = { '#7a2f2f': 'car_red', '#2f4a7a': 'car_blue', '#e8e8e8': 'car_white', '#d0c080': 'car_white', '#8a8a8a': 'car_white' };
function drawCar(g, x, y, ang, color, o = {}) {
  const ck = o.wreck ? 'car_wreck' : CAR_SPR[color] || (hash(color.length, color.charCodeAt(2)) > 0.5 ? 'car_blue' : 'car_red');
  if (sprOk(ck)) {
    g.save(); g.translate(x + 3, y + 4); g.rotate(ang); g.fillStyle = 'rgba(0,0,0,.38)'; roundRect(g, -30, -15, 60, 30, 10); g.fill(); g.restore();
    g.globalAlpha = o.dim && o.dim < 1 ? 0.85 : 1; drawSprite(g, ck, x, y - 6, 64, ang); g.globalAlpha = 1;
    if (o.driver) { g.fillStyle = o.driver; g.beginPath(); g.arc(x - Math.cos(ang) * 4, y - 6 - Math.sin(ang) * 4, 4, 0, TAU); g.fill(); }
    if (o.lights) { g.fillStyle = 'rgba(255,250,200,.9)'; for (const sd of [-1, 1]) g.fillRect(x + Math.cos(ang) * 30 - Math.sin(ang) * 9 * sd - 2, y - 6 + Math.sin(ang) * 30 + Math.cos(ang) * 9 * sd - 2, 4, 4); }
    return;
  }
  const L = 58, Wd = 28, dim = o.dim || 1, body = shade(color, dim), dark = shade(color, dim * 0.62), lite = shade(color, Math.min(1.5, dim * 1.28));
  g.save(); g.translate(x, y + 4); g.fillStyle = 'rgba(0,0,0,.38)'; g.rotate(ang); roundRect(g, -L / 2 + 3, -Wd / 2 + 3, L, Wd, 9); g.fill(); g.restore();
  g.save(); g.translate(x, y - 6); g.rotate(ang);
  g.fillStyle = '#121212'; for (const [wx, wy] of [[-17, -15], [13, -15], [-17, 11], [13, 11]]) g.fillRect(wx, wy, 9, 4);
  g.fillStyle = dark; roundRect(g, -L / 2, -Wd / 2, L, Wd, 9); g.fill();
  g.fillStyle = body; roundRect(g, -L / 2 + 2, -Wd / 2 + 2, L - 4, Wd - 4, 8); g.fill();
  g.fillStyle = lite; roundRect(g, -L / 2 + 6, -Wd / 2 + 4, L * 0.32, Wd - 8, 5); g.fill(); // hood
  g.fillStyle = o.wreck ? 'rgba(40,40,40,.85)' : 'rgba(120,170,210,.75)';
  roundRect(g, 2, -Wd / 2 + 4, 9, Wd - 8, 3); g.fill(); // windscreen
  g.fillStyle = o.wreck ? 'rgba(30,30,30,.85)' : 'rgba(90,130,170,.7)'; roundRect(g, -20, -Wd / 2 + 5, 7, Wd - 10, 3); g.fill(); // rear window
  g.fillStyle = shade(color, dim * 0.9); g.fillRect(-13, -Wd / 2 + 4, 15, Wd - 8); // roof
  g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(-12, -Wd / 2 + 5, 13, 3);
  g.fillStyle = o.lights ? '#fff6c0' : '#d8d0a0'; g.fillRect(L / 2 - 4, -Wd / 2 + 3, 3, 5); g.fillRect(L / 2 - 4, Wd / 2 - 8, 3, 5);
  g.fillStyle = o.brake ? '#ff3020' : '#7a1810'; g.fillRect(-L / 2 + 1, -Wd / 2 + 3, 2, 5); g.fillRect(-L / 2 + 1, Wd / 2 - 8, 2, 5);
  if (o.driver) { g.fillStyle = o.driver; g.beginPath(); g.arc(-4, -4, 4.5, 0, TAU); g.fill(); }
  if (o.rust) { g.fillStyle = 'rgba(90,50,20,.35)'; g.beginPath(); g.arc(-10, 6, 6, 0, TAU); g.arc(16, -7, 4, 0, TAU); g.fill(); }
  g.restore();
}
function drawCont(g, c) {
  const D = CONTAINERS[c.kind], x = c.x * TILE, y = c.y * TILE;
  const dim = c.looted ? 0.72 : 1;
  if (c.kind === 'car') {
    drawCar(g, x, y, c.horiz ? (hash(c.id, 3) > 0.5 ? 0 : Math.PI) : (hash(c.id, 5) > 0.5 ? Math.PI / 2 : -Math.PI / 2), c.color || '#555', { dim, wreck: !c.drive, rust: !c.drive });
    if (c.looted && c.drive) { const p = meP(); if (p && dist(p.x, p.y, c.x, c.y) < 5) { g.fillStyle = '#9fe6ff'; g.font = 'bold 10px system-ui'; g.textAlign = 'center'; g.fillText('🔑', x, y - 30); } }
  } else if (c.kind === 'airdrop') {
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x - 16, y + 2, 34, 10);
    g.fillStyle = '#3a5470'; g.fillRect(x - 16, y - 14, 32, 22); g.fillStyle = '#4e6e90'; g.fillRect(x - 16, y - 20, 32, 8);
    g.strokeStyle = '#c8b060'; g.lineWidth = 2; g.strokeRect(x - 15, y - 19, 30, 26); g.beginPath(); g.moveTo(x, y - 20); g.lineTo(x, y + 8); g.stroke();
    if (!c.looted) { g.fillStyle = 'rgba(240,240,230,.85)'; g.beginPath(); g.ellipse(x + 26, y + 4, 18, 9, 0.4, 0, TAU); g.fill(); if (Math.random() < 0.5) V.parts.push({ k: 'redsmoke', x: c.x + 0.5, y: c.y, t: 0, life: rnd(2.5, 4), s: rnd(5, 9), vx0: rnd(-0.2, 0.4) }); }
  } else if (sprOk(c.kind) || (c.kind === 'locker' && sprOk('cabinet'))) {
    g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(x + 3, y + 6, 15, 6, 0, 0, TAU); g.fill();
    g.globalAlpha = c.looted ? 0.7 : 1; drawSprite(g, sprOk(c.kind) ? c.kind : 'cabinet', x, y - 4, 32); g.globalAlpha = 1;
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
  if (sprOk('grave')) { g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(px - 9, py + 2, 20, 5); if (drawSprite(g, 'grave', px, py - 6, 26)) return; }
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
const STRUCT_SPR = { core: ['core', 72], bench: ['bench', 40], radio: ['radio', 34], barrel: ['barrel', 26] };
function drawStruct(g, s) {
  const x = s.x * TILE, y = s.y * TILE, fl = s.flash > 0, sp = STRUCT_SPR[s.type];
  if (sp && sprOk(sp[0]) && !s.ghost) {
    g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(x + 3, y + 6, sp[1] * 0.5, sp[1] * 0.22, 0, 0, TAU); g.fill();
    drawSprite(g, sp[0], x, y - 6, sp[1]);
    if (fl) { g.globalAlpha = 0.5; g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y - 6, sp[1] * 0.4, 0, TAU); g.fill(); g.globalAlpha = 1; }
    if (s.type === 'core') { g.fillStyle = (V.frame >> 4) & 1 ? 'rgba(120,220,255,.5)' : 'rgba(60,170,220,.4)'; g.beginPath(); g.arc(x, y - 8, 9, 0, TAU); g.fill(); }
    if (s.type === 'radio') { g.fillStyle = (V.frame >> 4) & 1 ? '#7dff9a' : '#2a5a2a'; g.fillRect(x - 6, y - 10, 4, 3); }
    return;
  }
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
    case 'farm': {
      const gr = s.grow || 0, px = x - 15, py = y - 15;
      g.fillStyle = '#4a3624'; g.fillRect(px, py, 30, 30); g.fillStyle = '#3a2a1a'; for (let k = 0; k < 4; k++) g.fillRect(px + 2, py + 3 + k * 7, 26, 3);
      if (gr > 0.05) for (let k = 0; k < 4; k++) for (let j = 0; j < 3; j++) {
        const cx = px + 5 + j * 10, cy = py + 5 + k * 7, h = 2 + gr * 7;
        g.fillStyle = gr >= 1 ? '#d8b040' : gr > 0.6 ? '#5a9a3a' : '#6ab04a'; g.fillRect(cx - 1, cy - h + 3, 2, h);
        if (gr > 0.5) { g.fillRect(cx - 3, cy - h + 4, 2, 2); g.fillRect(cx + 1, cy - h + 3, 2, 2); }
      }
      if (gr >= 1 && (V.frame >> 4) & 1) { g.fillStyle = '#ffd166'; g.beginPath(); g.arc(x, y - 22, 3, 0, TAU); g.fill(); }
      break;
    }
    case 'campfire': {
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(x, y + 4, 15, 6, 0, 0, TAU); g.fill();
      g.fillStyle = '#6a6460'; for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; g.beginPath(); g.arc(x + Math.cos(a) * 11, y + Math.sin(a) * 5, 3.5, 0, TAU); g.fill(); }
      g.strokeStyle = '#5a3a20'; g.lineWidth = 4; g.beginPath(); g.moveTo(x - 8, y + 2); g.lineTo(x + 8, y - 3); g.moveTo(x - 8, y - 3); g.lineTo(x + 8, y + 2); g.stroke();
      if (!s.ghost) {
        const f = Math.sin(V.frame / 3) * 2;
        g.fillStyle = '#ff6a1a'; g.beginPath(); g.ellipse(x, y - 8 - f / 2, 7, 12 + f, 0, 0, TAU); g.fill();
        g.fillStyle = '#ffd36a'; g.beginPath(); g.ellipse(x, y - 5, 4, 7 + f / 2, 0, 0, TAU); g.fill();
        if (Math.random() < 0.2) V.parts.push({ k: 'ember', x: s.x + rnd(-0.2, 0.2), y: s.y, t: 0, life: rnd(0.8, 1.6), vx0: rnd(-0.3, 0.3) });
      }
      break;
    }
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
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1.2; g.stroke();
  if (!fl) { g.fillStyle = 'rgba(255,255,255,.13)'; g.fillRect(px - bw / 2 + 2, bodyY + 2, bw * 0.35, s * 0.9 * low); }
  if (o.torn) { g.fillStyle = o.torn; g.fillRect(px - bw * 0.3, bodyY + s * 0.5, bw * 0.25, 3); g.fillRect(px + bw * 0.05, bodyY + s * 0.9, bw * 0.3, 2); }
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
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1.2; g.stroke();
  if (o.hat) { g.fillStyle = o.hat; g.beginPath(); g.arc(hx, hy - s * 0.2, s * 0.56, Math.PI, TAU); g.fill(); }
  if (o.horns) { g.fillStyle = '#2a0a08'; g.beginPath(); g.moveTo(hx - 7, hy - 6); g.lineTo(hx - 11, hy - 18); g.lineTo(hx - 3, hy - 8); g.moveTo(hx + 7, hy - 6); g.lineTo(hx + 11, hy - 18); g.lineTo(hx + 3, hy - 8); g.fill(); }
  if (ay > -0.6) {
    g.fillStyle = o.eye || '#111';
    const ex = hx + ax * s * 0.3, ey = hy - 1 + ay * 2;
    g.fillRect(ex - 3 + ay * 2, ey - 1, 2, 2); g.fillRect(ex + 1 + ay * 2, ey - 1, 2, 2);
  }
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const GUN_LOOK = { pistol: [10, '#222', 4], smg: [15, '#2a2a2a', 5], shotgun: [20, '#4a3020', 5], rifle: [22, '#2a3020', 5], sniper: [28, '#203020', 4], launcher: [24, '#3a4a3a', 8], machete: [16, '#ccc', 3],
  knife: [10, '#ddd', 2], bat: [20, '#b08850', 4], spear: [30, '#a08a5a', 2], axe: [20, '#c84030', 5], katana: [26, '#e8eef4', 2], sledge: [22, '#606268', 7], chainsaw: [22, '#e0a020', 7],
  revolver: [12, '#4a4a50', 4], crossbow: [18, '#6a4a2a', 5], flamer: [22, '#a03020', 6] };
function drawEnt(g, e) {
  const x = e.rx !== undefined ? e.rx : e.x, y = e.ry !== undefined ? e.ry : e.y;
  const ck = charKey(e.kind, e.id);
  if (chrOk(ck)) {
    const d = e.def;
    let alpha;
    if (d.stealth && !(e.revealT > 0) && !(e.flash > 0)) { const p = meP(); alpha = p && dist(p.x, p.y, x, y) < 4.5 ? 0.85 : 0.13; }
    if (d.gas) { g.fillStyle = `rgba(140,220,60,${0.18 + 0.08 * Math.sin(V.frame / 7 + e.id)})`; g.beginPath(); g.arc(x * TILE, y * TILE - 8, 22, 0, TAU); g.fill(); }
    if (d.explode) { const p = meP(); if (p && dist(p.x, p.y, x, y) < d.explode.r + 2.5) { g.strokeStyle = `rgba(255,170,40,${0.35 + 0.25 * Math.sin(V.frame / 4)})`; g.lineWidth = 2; g.setLineDash([6, 5]); g.beginPath(); g.ellipse(x * TILE, y * TILE, d.explode.r * TILE, d.explode.r * TILE * 0.8, 0, 0, TAU); g.stroke(); g.setLineDash([]); } }
    if (e.kind === 'x13' && e.revealT > 0) drawChar(g, ck, x - Math.cos(e.angle) * 0.6, y - Math.sin(e.angle) * 0.6, e.angle, charSize(e.kind), { alpha: 0.3 });
    drawChar(g, ck, x, y, e.angle, charSize(e.kind) * (d.boss && e.cat === 'human' ? 1.15 : 1), { walk: e.walk * 0.9, atk: e.atkAnim, flash: e.flash > 0, alpha, hurt: e.maxHp ? Math.max(0, 0.6 - e.hp / e.maxHp) : 0 });
    if (e.cat === 'human' && e.wpn && !WEAPONS[e.wpn].melee && e.fireT > 0 && e.fireT > WEAPONS[e.wpn].rate) { /* muzzle flash comes from fx */ }
    if (e.hp < e.maxHp) bar(g, x, y - (d.r > 0.5 ? 1.5 : 1.05), d.boss ? 40 : 22, e.hp / e.maxHp, e.cat === 'mob' ? (d.boss ? '#f84' : '#9d5') : e.team === 'player' ? '#7dff9a' : '#e84');
    return;
  }
  if (e.cat === 'mob') {
    const d = e.def;
    if (d.dog) { drawHound(g, x, y, e); if (e.hp < e.maxHp) bar(g, x, y - 0.9, 18, e.hp / e.maxHp, '#9d5'); return; }
    let alpha = 1;
    if (d.stealth && !(e.revealT > 0) && !(e.flash > 0)) { const p = meP(); alpha = p && dist(p.x, p.y, x, y) < 4.5 ? 0.85 : 0.13; }
    if (d.gas) { g.fillStyle = `rgba(140,220,60,${0.18 + 0.08 * Math.sin(V.frame / 7 + e.id)})`; g.beginPath(); g.arc(x * TILE, y * TILE - 12, 20, 0, TAU); g.fill(); }
    if (e.kind === 'x13' && e.revealT > 0) { g.globalAlpha = 0.3; drawBody(g, x - Math.cos(e.angle) * 0.6, y - Math.sin(e.angle) * 0.6, e.angle, { r: d.r, body: '#5ff', head: '#5ff', walk: e.walk, zombie: true }); g.globalAlpha = 1; }
    g.globalAlpha = alpha;
    const shirt = !d.boss && (e.kind === 'walker' || e.kind === 'runner' || e.kind === 'crawler') ? ZSHIRTS[e.id % ZSHIRTS.length] : d.body;
    drawBody(g, x, y, e.angle, { r: d.r, body: shirt, head: d.head, walk: e.walk + (e.kind === 'walker' ? Math.sin(e.walk * 0.5) * 0.4 : 0), flash: e.flash > 0, zombie: true, reach: e.atkAnim > 0.3 ? 1.7 : 1.2, torn: '#5a0f0f',
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
const ZSHIRTS = ['#5f8a4b', '#4a5a7a', '#7a4a3a', '#6a6a5a', '#3a4a3a', '#8a7a5a', '#5a3a4a', '#4a6a6a', '#7a6a4a', '#5a5a6a'];
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
// tyre marks on the road and dust off-road behind a moving car
function carTrail(p) {
  const v = p.veh, sp = Math.abs(v.spd); if (sp < 2) { v.pa = v.ang; return; }
  const turn = Math.abs(angDiff(v.pa === undefined ? v.ang : v.pa, v.ang)) / (V.dt || 0.016); v.pa = v.ang;
  const cx = Math.floor(p.x), cy = Math.floor(p.y), t = inMap(cx, cy) ? W.tile[idx(cx, cy)] : 0, paved = t === T.ROAD || t === T.CONCRETE || t === T.WALK;
  for (const sd of [-1, 1]) {
    const wx = p.x - Math.cos(v.ang) * 0.75 - Math.sin(v.ang) * 0.38 * sd, wy = p.y - Math.sin(v.ang) * 0.75 + Math.cos(v.ang) * 0.38 * sd;
    if (paved && turn > 1.6 && sp > 6) decal(wx, wy, 0.02, 'rgba(15,15,15,.6)', 1);
    else if (!paved && Math.random() < 0.5) V.parts.push({ k: 'smoke', x: wx, y: wy + 0.3, t: 0, life: rnd(0.5, 1), s: rnd(3, 6), dust: 1 });
  }
}
function drawPlayer(g, p) {
  if (p.veh) carTrail(p);
  if (p.ride !== undefined) { const d = G.players[p.ride]; if (d && d.veh) { const x = p.x * TILE, y = p.y * TILE - 8; g.strokeStyle = '#222'; g.lineWidth = 4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(p.angle) * 16, y + Math.sin(p.angle) * 16); g.stroke(); g.fillStyle = p.color; g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill(); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1; g.stroke(); return; } }
  if (p.veh) { drawCar(g, p.x * TILE, p.y * TILE, p.veh.ang, p.veh.color, { lights: G.phase !== 'day', brake: p.veh.spd < 1, driver: p.color }); return; }
  const gl = GUN_LOOK[p.wpn];
  const swing = p.wpn === 'machete' && p.fireT > 0.2;
  const pk = p.pid ? 'player_orange' : 'player_blue';
  if (chrOk(pk)) {
    drawChar(g, pk, p.x, p.y, p.angle + (swing ? 0.6 : 0), 38, { walk: p.walk * 0.8, flash: p.flash > 0, down: p.down });
    if (!p.down) { // the weapon in your hands
      const gl2 = GUN_LOOK[p.wpn], a = p.angle + (swing ? 0.8 : 0), hx = p.x * TILE + Math.cos(a) * 8, hy = p.y * TILE - 8 + Math.sin(a) * 8;
      g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = gl2[2] + 2; g.lineCap = 'butt'; g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + Math.cos(a) * gl2[0], hy + Math.sin(a) * gl2[0]); g.stroke();
      g.strokeStyle = gl2[1]; g.lineWidth = gl2[2]; g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + Math.cos(a) * gl2[0], hy + Math.sin(a) * gl2[0]); g.stroke();
    }
    if (p.in && p.in.crouch && !p.down) { g.fillStyle = 'rgba(160,200,255,.7)'; g.font = '10px system-ui'; g.textAlign = 'center'; g.fillText('은신', p.x * TILE, p.y * TILE + 22); }
    return;
  }
  if (!p.down) { // backpack, on the side away from where you aim
    const bx = p.x * TILE - Math.cos(p.angle) * 6, by = p.y * TILE - 17 - Math.sin(p.angle) * 3;
    g.fillStyle = '#5a4a32'; roundRect(g, bx - 7, by - 6, 14, 13, 4); g.fill(); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = '#7a6440'; g.fillRect(bx - 5, by - 4, 10, 3);
  }
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
    case 'flash': { const r = p.big ? 13 : 8, fx2 = x + Math.cos(p.a) * 10, fy2 = y - 14 + Math.sin(p.a) * 6;
      g.fillStyle = 'rgba(255,200,90,.55)'; g.beginPath(); g.arc(fx2, fy2, r * 1.6, 0, TAU); g.fill();
      g.fillStyle = '#fff6b0'; g.beginPath(); g.moveTo(fx2 + Math.cos(p.a) * r * 2.2, fy2 + Math.sin(p.a) * r * 2.2); g.lineTo(fx2 + Math.cos(p.a + 1.6) * r * 0.7, fy2 + Math.sin(p.a + 1.6) * r * 0.7); g.lineTo(fx2 + Math.cos(p.a - 1.6) * r * 0.7, fy2 + Math.sin(p.a - 1.6) * r * 0.7); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(fx2, fy2, r * 0.5, 0, TAU); g.fill(); break; }
    case 'drop': case 'chunk': g.fillStyle = p.c; const s = p.k === 'chunk' ? 5 : 3; g.fillRect(x - s / 2, y - p.z * TILE - s / 2, s, s); break;
    case 'boom': {
      const r = p.r * TILE * (0.35 + 0.65 * k);
      g.globalAlpha = 1 - k;
      g.fillStyle = p.green ? '#8ad040' : p.fire ? '#ff7a1a' : '#ffb347'; g.beginPath(); g.arc(x, y - 8, r, 0, TAU); g.fill();
      g.fillStyle = p.green ? '#d0ff90' : '#fff3c4'; g.beginPath(); g.arc(x, y - 8, r * 0.5 * (1 - k), 0, TAU); g.fill();
      g.globalAlpha = 1; break;
    }
    case 'smoke': g.fillStyle = p.dust ? `rgba(150,130,100,${0.35 * (1 - k)})` : `rgba(90,90,90,${0.35 * (1 - k)})`; g.beginPath(); g.arc(x, y - 14 - k * 20, (p.s || 6) * (0.5 + k), 0, TAU); g.fill(); break;
    case 'spark': g.fillStyle = `rgba(255,220,150,${1 - k})`; g.fillRect(x - 2, y - 16, 4, 4); break;
    case 'swing': g.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`; g.lineWidth = 3; g.beginPath(); g.arc(x, y - 16, 26, p.a - 0.9, p.a + 0.9); g.stroke(); break;
    case 'dying': { // topple over, flash red, sink
      const r = CHR.map[p.key]; if (!r) break;
      const s = p.size / Math.max(r[2], r[3]), w = r[2] * s * (1 - k * 0.12), h = r[3] * s * (1 - k * 0.12);
      g.save(); g.translate(x + Math.cos(p.a) * k * 10, y - 8 + Math.sin(p.a) * k * 10); g.rotate(p.a + Math.PI / 2 + k * 1.3);
      g.globalAlpha = 1 - k * 0.3; g.drawImage(CHR.img, r[0], r[1], r[2], r[3], -w / 2, -h / 2, w, h);
      g.globalAlpha = (1 - k) * 0.6; g.drawImage(chrTint(p.key, '#900000'), -w / 2, -h / 2, w, h); g.restore(); g.globalAlpha = 1; break;
    }
    case 'impact': { const r = 6 + k * 14; g.strokeStyle = p.c ? `rgba(255,220,80,${1 - k})` : `rgba(255,255,255,${0.9 * (1 - k)})`; g.lineWidth = 2.5; g.beginPath(); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.78; g.moveTo(x + Math.cos(a) * r * 0.4, y - 16 + Math.sin(a) * r * 0.4); g.lineTo(x + Math.cos(a) * r, y - 16 + Math.sin(a) * r); } g.stroke(); break; }
    case 'fire': { const fx3 = x + p.vx0 * p.t * TILE, fy3 = y - 12 + p.vy0 * p.t * TILE; g.fillStyle = `rgba(255,${200 - k * 150 | 0},40,${0.85 * (1 - k)})`; g.beginPath(); g.arc(fx3, fy3, p.s * (0.6 + k * 1.4), 0, TAU); g.fill(); break; }
    case 'tele': { // attack warning lane, filling up until the hit lands
      g.save(); g.translate(x, y - 6); g.rotate(p.a);
      const L = p.len * TILE, Wd = p.w * TILE;
      g.fillStyle = `rgba(255,40,30,${0.12 + 0.1 * Math.sin(p.t * 40)})`; g.fillRect(0, -Wd / 2, L, Wd);
      g.fillStyle = 'rgba(255,60,40,.38)'; g.fillRect(0, -Wd / 2, L * k, Wd);
      g.strokeStyle = 'rgba(255,90,70,.8)'; g.lineWidth = 2; g.strokeRect(0, -Wd / 2, L, Wd);
      g.restore(); break;
    }
    case 'killring': g.strokeStyle = `rgba(255,80,60,${0.8 * (1 - k)})`; g.lineWidth = 3; g.beginPath(); g.arc(x, y - 14, 10 + k * 34, 0, TAU); g.stroke(); break;
    case 'shell': { g.save(); g.translate(x, y - p.z * TILE); g.rotate(p.rot + p.t * 12 * (p.z > 0 ? 1 : 0)); g.fillStyle = '#d8b040'; g.fillRect(-2, -1, 4, 2); g.restore(); break; }
    case 'redsmoke': g.fillStyle = `rgba(210,60,50,${0.38 * (1 - k)})`; g.beginPath(); g.arc(x + p.vx0 * p.t * 40 + Math.sin(p.t * 2) * 6, y - 14 - p.t * 46, p.s * (0.6 + k * 1.6), 0, TAU); g.fill(); break;
    case 'ember': g.fillStyle = `rgba(255,${160 + (p.t * 80 | 0)},60,${1 - k})`; g.fillRect(x + Math.sin(p.t * 5) * 4 + p.vx0 * p.t * 30, y - 14 - p.t * 40, 2, 2); break;
    case 'ring': g.strokeStyle = `rgba(220,220,255,${1 - k})`; g.lineWidth = 3; g.beginPath(); g.arc(x, y - 20, k * 200, 0, TAU); g.stroke(); break;
  }
}

// ── lighting, colour grading, weather, atmosphere ───────────────────────────
// colour of the light at a given time of day (multiplied over the scene)
function gradeColor(c) {
  const keys = [[0, [150, 160, 210]], [300, [150, 160, 210]], [360, [255, 196, 170]], [480, [255, 240, 224]], [720, [255, 255, 250]], [960, [255, 246, 228]],
                [1080, [255, 214, 170]], [1170, [240, 150, 120]], [1230, [170, 160, 210]], [1440, [150, 160, 210]]];
  for (let k = 1; k < keys.length; k++) if (c <= keys[k][0]) { const [c0, a] = keys[k - 1], [c1, b] = keys[k], t = (c - c0) / (c1 - c0); return [a[0] + (b[0] - a[0]) * t | 0, a[1] + (b[1] - a[1]) * t | 0, a[2] + (b[2] - a[2]) * t | 0]; }
  return [255, 255, 255];
}
let vignCv = null, fogCvA = null;
function vignette() {
  if (vignCv && vignCv.width === VIEW_W && vignCv.height === VIEW_H) return vignCv;
  vignCv = document.createElement('canvas'); vignCv.width = VIEW_W; vignCv.height = VIEW_H;
  const g = vignCv.getContext('2d'), r = Math.hypot(VIEW_W, VIEW_H) / 2;
  const gr = g.createRadialGradient(VIEW_W / 2, VIEW_H / 2, r * 0.45, VIEW_W / 2, VIEW_H / 2, r);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = gr; g.fillRect(0, 0, VIEW_W, VIEW_H);
  return vignCv;
}
function fogTex() {
  if (fogCvA) return fogCvA;
  fogCvA = document.createElement('canvas'); fogCvA.width = fogCvA.height = 256;
  const g = fogCvA.getContext('2d'), im = g.createImageData(256, 256), n1 = periodicNoise(5, 4), n2 = periodicNoise(9, 9);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const v = n1(x / 256, y / 256) * 0.65 + n2(x / 256, y / 256) * 0.35, o = (y * 256 + x) * 4; im.data[o] = 200; im.data[o + 1] = 206; im.data[o + 2] = 214; im.data[o + 3] = clamp((v - 0.3) * 1.6, 0, 1) * 255; }
  g.putImageData(im, 0, 0);
  return fogCvA;
}
// building shadows cast by the sun (drawn on the ground before walls)
function sunShadows(g, x0, y0, x1, y1) {
  const c = G.clock; if (c < DAWN || c > DUSK) return;
  const t = (c - DAWN) / (DUSK - DAWN), elev = Math.sin(t * Math.PI), len = 10 + (1 - elev) * 34, dx = (t < 0.5 ? -1 : 1) * len * Math.abs(Math.cos(t * Math.PI)) * -1, dy = 8 + (1 - elev) * 6;
  const w = G.weather, a = 0.26 * (1 - (w ? w.i * 0.8 : 0)) * Math.min(1, elev * 3);
  if (a < 0.02) return;
  g.fillStyle = `rgba(10,14,24,${a})`;
  for (const b of W.buildings) {
    if (b.x > x1 + 2 || b.x + b.w < x0 - 2 || b.y > y1 + 2 || b.y + b.h < y0 - 3) continue;
    g.fillRect(b.x * TILE + dx, b.y * TILE - WALL_H + dy, b.w * TILE, b.h * TILE);
  }
}
// animated water highlights
function waterShimmer(g, x0, y0, x1, y1) {
  const f = V.frame;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (W.tile[idx(x, y)] !== T.WATER) continue;
    const h = hash(x, y), ph = h * TAU + f * 0.035, a = 0.05 + 0.07 * Math.sin(ph);
    if (a <= 0.02) continue;
    g.fillStyle = `rgba(200,230,255,${a})`;
    g.fillRect(x * TILE + 4 + Math.sin(ph * 0.7) * 6, y * TILE + 6 + h * 18, 12 + h * 8, 2);
  }
}
// ambient particles by biome, time and weather
function ambient(g, sx, sy) {
  const me = meP(); if (!me) return;
  const b = biomeAt(me.x, me.y), night = G.phase !== 'day', w = G.weather || { k: 'clear', i: 0 };
  V.amb = V.amb || [];
  const want = b === BIO.FOREST && !night ? 'leaf' : b === BIO.WASTE ? 'ash' : night && w.k === 'clear' && (b === BIO.PLAINS || b === BIO.FOREST || b === BIO.FARM || b === BIO.SWAMP) ? 'fly' : b === BIO.SWAMP ? 'mist' : b === BIO.CITY ? 'dust' : null;
  if (want && V.amb.length < (want === 'fly' ? 40 : 34) && Math.random() < 0.5) {
    V.amb.push({ k: want, x: sx + Math.random() * VIEW_W, y: sy + Math.random() * VIEW_H, t: 0, life: 4 + Math.random() * 5, s: Math.random(), vx: rnd(-8, 8), vy: rnd(-4, 6) });
  }
  const dt = V.dt || 0.016;
  for (const p of V.amb) {
    p.t += dt; const k = Math.min(1, p.t, p.life - p.t);
    if (p.k === 'leaf') { p.x += (14 + Math.sin(p.t * 2 + p.s * 9) * 18) * dt; p.y += 12 * dt; g.fillStyle = `rgba(${150 + p.s * 60 | 0},${120 + p.s * 30 | 0},40,${0.8 * k})`; g.save(); g.translate(p.x, p.y); g.rotate(p.t * 3 + p.s * 6); g.fillRect(-3, -1.5, 6, 3); g.restore(); }
    else if (p.k === 'ash') { p.x += (6 + p.vx * 0.5) * dt; p.y += (8 + Math.sin(p.t + p.s * 5) * 6) * dt; g.fillStyle = p.s > 0.85 ? `rgba(255,140,60,${k})` : `rgba(200,196,190,${0.6 * k})`; g.fillRect(p.x, p.y, 2, 2); }
    else if (p.k === 'mist') { p.x += 5 * dt; g.fillStyle = `rgba(190,205,190,${0.06 * k})`; g.beginPath(); g.arc(p.x, p.y, 40 + p.s * 40, 0, TAU); g.fill(); }
    else if (p.k === 'dust') { p.x += (20 + p.vx) * dt; p.y += p.vy * 0.3 * dt; g.fillStyle = `rgba(210,200,180,${0.25 * k})`; g.fillRect(p.x, p.y, 2, 1); }
    else if (p.k === 'fly') { p.x += Math.sin(p.t * 1.3 + p.s * 9) * 10 * dt; p.y += Math.cos(p.t * 1.1 + p.s * 7) * 8 * dt; }
  }
  V.amb = V.amb.filter(p => p.t < p.life && p.x > sx - 80 && p.x < sx + VIEW_W + 80 && p.y > sy - 80 && p.y < sy + VIEW_H + 80);
}
function drawLighting(g, sx, sy) {
  const dk = darkness(), c = G.clock, w = G.weather || { k: 'clear', i: 0 };
  // colour grade (multiply)
  const [gr0, gg0, gb0] = gradeColor(c), wd = 1 - w.i * 0.22;
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = `rgb(${gr0 * wd | 0},${gg0 * wd | 0},${Math.min(255, gb0 * wd + w.i * 14) | 0})`; g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.globalCompositeOperation = 'source-over';
  if (c >= DUSK - 60 && c < NIGHT + 30) { g.fillStyle = `rgba(255,120,40,${0.1 * Math.sin(clamp((c - DUSK + 60) / 150, 0, 1) * Math.PI)})`; g.fillRect(0, 0, VIEW_W, VIEW_H); }
  // fog layer (scrolls with the wind, thins out right around you)
  if (w.k === 'fog' && w.i > 0.05) {
    // composed at quarter resolution, then stretched once (fog is soft anyway)
    const q = 4, fw = Math.ceil(VIEW_W / q), fh = Math.ceil(VIEW_H / q);
    if (!V.fogL) { V.fogL = document.createElement('canvas'); V.fogLG = V.fogL.getContext('2d'); }
    if (V.fogL.width !== fw || V.fogL.height !== fh) { V.fogL.width = fw; V.fogL.height = fh; }
    const F = V.fogLG, ft = fogTex(), ts = 256 * 3 / q, off = (V.frame * 0.25 / q) % ts;
    F.clearRect(0, 0, fw, fh); F.globalAlpha = 0.75 * w.i;
    for (let yy = -(((sy * 0.9 / q) % ts) + ts) % ts - ts; yy < fh; yy += ts) for (let xx = -(((sx * 0.9 / q + off) % ts) + ts) % ts - ts; xx < fw; xx += ts) F.drawImage(ft, xx, yy, ts, ts);
    F.globalAlpha = 1;
    const me = meP(), px = (me.x * TILE - sx) / q, py = (me.y * TILE - sy) / q;
    const cl = F.createRadialGradient(px, py, 0, px, py, 220 / q); cl.addColorStop(0, 'rgba(200,206,214,0)'); cl.addColorStop(1, `rgba(200,206,214,${0.35 * w.i})`);
    F.fillStyle = cl; F.fillRect(0, 0, fw, fh);
    g.drawImage(V.fogL, 0, 0, VIEW_W, VIEW_H);
  }
  const night = dk > 0.02;
  if (night) {
    const sc = 0.5, lw = Math.ceil(VIEW_W * sc), lh = Math.ceil(VIEW_H * sc);
    if (!lightCv) { lightCv = document.createElement('canvas'); lightG = lightCv.getContext('2d'); }
    if (lightCv.width !== lw || lightCv.height !== lh) { lightCv.width = lw; lightCv.height = lh; }
    const L = lightG;
    L.globalCompositeOperation = 'source-over';
    L.clearRect(0, 0, lw, lh);
    L.fillStyle = `rgba(4,8,22,${Math.min(0.94, dk + w.i * 0.06)})`; L.fillRect(0, 0, lw, lh);
    L.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a = 1) => {
      const px = (x * TILE - sx) * sc, py = (y * TILE - sy - 10) * sc, pr = r * TILE * sc;
      if (px < -pr || py < -pr || px > lw + pr || py > lh + pr) return;
      const gr = L.createRadialGradient(px, py, 0, px, py, pr);
      gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(0.6, `rgba(0,0,0,${a * 0.6})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      L.fillStyle = gr; L.beginPath(); L.arc(px, py, pr, 0, TAU); L.fill();
    };
    for (const p of G.players) if (p && p.joined && !p.dead) {
      hole(p.x, p.y, 3.2, 0.9);
      if (p.veh) {
        const px = (p.x * TILE - sx) * sc, py = (p.y * TILE - sy - 10) * sc, R = 16 * TILE * sc, a = p.veh.ang;
        const gr = L.createRadialGradient(px, py, 0, px, py, R); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.75, 'rgba(0,0,0,.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        L.fillStyle = gr; L.beginPath(); L.moveTo(px, py); L.arc(px, py, R, a - 0.38, a + 0.38); L.closePath(); L.fill();
      } else if (!p.down) { // flashlight cone
        const px = (p.x * TILE - sx) * sc, py = (p.y * TILE - sy - 10) * sc, R = 10 * TILE * sc * (w.k === 'fog' ? 1 - 0.35 * w.i : 1);
        const gr = L.createRadialGradient(px, py, 0, px, py, R);
        gr.addColorStop(0, 'rgba(0,0,0,.95)'); gr.addColorStop(0.7, 'rgba(0,0,0,.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        L.fillStyle = gr; L.beginPath(); L.moveTo(px, py); L.arc(px, py, R, p.angle - 0.42, p.angle + 0.42); L.closePath(); L.fill();
      }
    }
    hole(G.core.x, G.core.y, 6, 0.85);
    for (const s of G.structs) if (s.type === 'light') hole(s.x, s.y, 7.5, 0.95); else if (s.type === 'turret') hole(s.x, s.y, 1.6, 0.6); else if (s.type === 'campfire') hole(s.x, s.y, 6 + Math.sin(V.frame / 4) * 0.25, 0.92);
    for (const e of G.ents) { if (e.team === 'player') hole(e.x, e.y, 2.2, 0.6); else if (e.kind === 'fiend') hole(e.x, e.y, 2.5, 0.5); }
    for (const v of W.villages) { hole(v.stall.x, v.stall.y, 6, 0.8); hole(v.x + 4, v.y + v.h / 2, 3.5, 0.6); hole(v.x + v.w - 4, v.y + v.h / 2, 3.5, 0.6); }
    for (const cp of W.camps) hole(cp.fire.x, cp.fire.y, 5 + Math.sin(V.frame / 5) * 0.3, 0.8);
    for (const l of V.lights) hole(l.x, l.y, l.r, Math.min(1, l.t * 10));
    g.drawImage(lightCv, 0, 0, VIEW_W, VIEW_H);
    // coloured glow on top (additive)
    g.globalCompositeOperation = 'lighter';
    const glow = (x, y, r, col, a) => {
      const px = x * TILE - sx, py = y * TILE - sy - 10, pr = r * TILE;
      if (px < -pr || py < -pr || px > VIEW_W + pr || py > VIEW_H + pr) return;
      const gr = g.createRadialGradient(px, py, 0, px, py, pr); gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    };
    const fl = 0.9 + Math.sin(V.frame / 4) * 0.1, ga = Math.min(1, dk * 1.4);
    for (const s of G.structs) if (s.type === 'campfire') glow(s.x, s.y, 5, '255,130,40', 0.32 * fl * ga); else if (s.type === 'light') glow(s.x, s.y - 0.6, 5, '255,230,170', 0.2 * ga);
    for (const cp of W.camps) glow(cp.fire.x, cp.fire.y, 4.5, '255,120,40', 0.3 * fl * ga);
    for (const h of G.hazards) if (h.k === 'fire') glow(h.x, h.y, h.r * 2.4, '255,110,30', 0.35 * fl * ga);
    for (const v of W.villages) glow(v.stall.x, v.stall.y, 4.5, '255,190,110', 0.18 * ga);
    for (const l of V.lights) if (l.c) glow(l.x, l.y, l.r * 1.3, l.c, Math.min(0.5, l.t * 8) * ga);
    glow(G.core.x, G.core.y, 4, '120,200,255', 0.16 * ga);
    // eyes in the dark
    for (const e of G.ents) {
      if (e.cat !== 'mob') continue;
      const ex = (e.rx !== undefined ? e.rx : e.x) * TILE - sx, ey = (e.ry !== undefined ? e.ry : e.y) * TILE - sy - 8;
      if (ex < -20 || ey < -20 || ex > VIEW_W + 20 || ey > VIEW_H + 20) continue;
      const a = e.angle, f = e.def.r * TILE * 0.55, side = e.def.r * TILE * 0.28, col = e.kind === 'x13' ? '90,255,255' : e.kind === 'fiend' ? '255,210,60' : '255,40,30';
      const al = (e.def.stealth && !(e.revealT > 0) ? 0.35 : 0.85) * ga * (0.8 + 0.2 * Math.sin(V.frame / 7 + e.id));
      for (const sd of [-1, 1]) {
        const px = ex + Math.cos(a) * f - Math.sin(a) * side * sd, py = ey + Math.sin(a) * f + Math.cos(a) * side * sd;
        const gr = g.createRadialGradient(px, py, 0, px, py, 5); gr.addColorStop(0, `rgba(${col},${al})`); gr.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = gr; g.fillRect(px - 5, py - 5, 10, 10);
      }
    }
    for (const p of V.amb || []) if (p.k === 'fly') { const k = Math.min(1, p.t, p.life - p.t) * (0.5 + 0.5 * Math.sin(p.t * 4 + p.s * 10)); const gr = g.createRadialGradient(p.x - sx, p.y - sy, 0, p.x - sx, p.y - sy, 7); gr.addColorStop(0, `rgba(200,255,120,${0.9 * k})`); gr.addColorStop(1, 'rgba(200,255,120,0)'); g.fillStyle = gr; g.fillRect(p.x - sx - 7, p.y - sy - 7, 14, 14); }
    g.globalCompositeOperation = 'source-over';
  } else {
    // daytime: muzzle flashes and fires still glow a little
    g.globalCompositeOperation = 'lighter';
    for (const h of G.hazards) if (h.k === 'fire') { const px = h.x * TILE - sx, py = h.y * TILE - sy, pr = h.r * TILE * 1.8; const gr = g.createRadialGradient(px, py, 0, px, py, pr); gr.addColorStop(0, 'rgba(255,120,40,.18)'); gr.addColorStop(1, 'rgba(255,120,40,0)'); g.fillStyle = gr; g.fillRect(px - pr, py - pr, pr * 2, pr * 2); }
    g.globalCompositeOperation = 'source-over';
  }
  // campfire sprites at bandit camps
  for (const cp of W.camps) {
    const x = cp.fire.x * TILE - sx, y = cp.fire.y * TILE - sy;
    if (x < -40 || y < -40 || x > VIEW_W + 40 || y > VIEW_H + 40) continue;
    g.fillStyle = '#4a3a2a'; g.fillRect(x - 10, y - 2, 20, 5);
    g.fillStyle = '#ff7a1a'; g.beginPath(); g.arc(x, y - 6, 6 + Math.sin(V.frame / 3) * 1.5, 0, TAU); g.fill();
    g.fillStyle = '#ffe28a'; g.beginPath(); g.arc(x, y - 6, 3, 0, TAU); g.fill();
  }
  // rain / storm
  if ((w.k === 'rain' || w.k === 'storm') && w.i > 0.03) {
    const n = Math.round((w.k === 'storm' ? 320 : 200) * w.i), f = V.frame, wind = w.k === 'storm' ? 0.45 : 0.22;
    g.strokeStyle = `rgba(190,205,230,${0.35 + 0.2 * w.i})`; g.lineWidth = 1; g.beginPath();
    for (let k = 0; k < n; k++) {
      const hx = (k * 7919 % 1000) / 1000, hy = (k * 104729 % 1000) / 1000, sp = 0.8 + (k % 7) / 14;
      const x = ((hx * (VIEW_W + 200) + f * 9 * wind * sp * 3 - sx * 0.2) % (VIEW_W + 200) + VIEW_W + 200) % (VIEW_W + 200) - 100;
      const y = ((hy * (VIEW_H + 100) + f * 22 * sp - sy * 0.2) % (VIEW_H + 100) + VIEW_H + 100) % (VIEW_H + 100) - 50;
      g.moveTo(x, y); g.lineTo(x - 14 * wind * sp, y - 16 * sp);
    }
    g.stroke();
    g.fillStyle = `rgba(200,215,235,${0.25 * w.i})`;
    for (let k = 0; k < n / 4; k++) { const x = (Math.random() * VIEW_W) | 0, y = (Math.random() * VIEW_H) | 0; g.fillRect(x, y, 3, 1); }
  }
  if (V.flashT > 0) { g.fillStyle = `rgba(230,235,255,${V.flashT * 1.6})`; g.fillRect(0, 0, VIEW_W, VIEW_H); V.flashT -= V.dt || 0.016; }
  g.drawImage(vignette(), 0, 0);
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
