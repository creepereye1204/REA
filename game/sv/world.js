'use strict';
// World generation (deterministic from a seed so co-op peers build the same map),
// collision grid, flow fields, A* and line tests.

function rng(seed) {
  let a = seed >>> 0;
  const f = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  return { f, i: n => (f() * n) | 0, r: (a, b) => a + f() * (b - a), pick: arr => arr[(f() * arr.length) | 0], chance: p => f() < p };
}
const idx = (x, y) => y * MW + x;
const inMap = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const cellX = i => i % MW, cellY = i => (i / MW) | 0;

// move-block bits
const MB_TERRAIN = 1, MB_OBJ = 2, MB_STRUCT = 4, MB_DOOR = 8;
const W = {};

function valueNoise(R, cells) {
  const gw = cells + 2, g = new Float32Array(gw * gw);
  for (let i = 0; i < g.length; i++) g[i] = R.f();
  const sm = t => t * t * (3 - 2 * t);
  return (x, y) => { // x,y in 0..1
    const fx = x * cells, fy = y * cells, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
    const v = (a, b) => g[(iy + b) * gw + ix + a];
    return lerp(lerp(v(0, 0), v(1, 0), tx), lerp(v(0, 1), v(1, 1), tx), ty);
  };
}

const CAMP_NAMES = ['붉은 약탈단 캠프', '해골 약탈단 캠프', '까마귀 약탈단 캠프', '들개 약탈단 캠프'];
const CAMP_BOSSES = ['도끼 장', '백골', '까마귀', '들개 왕'];

// ── Landmarks: each is a fenced lot with a themed building, loot, guards and story hooks ──
const LANDMARKS = [
  { key: 'hospital', name: '종합병원',            w: 32, h: 24 },
  { key: 'lab',      name: '한빛 생명공학 연구소', w: 28, h: 22 },
  { key: 'military', name: '잔존군 검문소',        w: 28, h: 22 },
  { key: 'tower',    name: '송신탑',              w: 16, h: 16 },
  { key: 'church',   name: '붉은 새벽 교회',       w: 24, h: 22 },
  { key: 'prison',   name: '교도소',              w: 34, h: 28 },
  { key: 'station',  name: '고속도로 주유소',      w: 20, h: 16 },
  { key: 'farm',     name: '햇살 농장',            w: 30, h: 24 },
  { key: 'school',   name: '초등학교',            w: 24, h: 20 },
  { key: 'helipad',  name: '옥상 헬기장',          w: 20, h: 20 },
];
function placeLandmarks(R, h) {
  const { set, get, reserve, areaFree, addCont, buildHouse, cx, cy } = h;
  const fill = (x, y, w, hh, t) => { for (let j = y; j < y + hh; j++) for (let i = x; i < x + w; i++) set(i, j, t); };
  const fence = (x, y, w, hh, gaps) => {
    for (let i = x; i < x + w; i++) { set(i, y, T.FENCE); set(i, y + hh - 1, T.FENCE); }
    for (let j = y; j < y + hh; j++) { set(x, j, T.FENCE); set(x + w - 1, j, T.FENCE); }
    for (const [gx, gy] of gaps) set(gx, gy, T.CONCRETE);
  };
  const spawn = (kind, x, y, o = {}) => W.npcSpawns.push({ kind, x: x + 0.5, y: y + 0.5, poi: o.poi, ...o });
  const far = [['lab', 70], ['prison', 60], ['helipad', 70], ['military', 55], ['hospital', 45], ['church', 50]];
  for (const L of LANDMARKS) {
    const minD = (far.find(f => f[0] === L.key) || [0, 38])[1];
    let placed = false;
    for (let tries = 0; tries < 900 && !placed; tries++) {
      const x = 4 + R.i(MW - L.w - 8), y = 4 + R.i(MH - L.h - 8);
      if (dist(x + L.w / 2, y + L.h / 2, cx, cy) < minD) continue;
      if (W.pois.some(p => dist(p.x + p.w / 2, p.y + p.h / 2, x + L.w / 2, y + L.h / 2) < 34)) continue;
      if (!areaFree(x, y, L.w, L.h, true)) continue;
      const P = { id: W.pois.length, key: L.key, name: L.name, x, y, w: L.w, h: L.h };
      buildLandmark(P);
      W.pois.push(P);
      reserve(x, y, L.w, L.h, 2);
      placed = true;
    }
  }
  function gateGaps(P) { const mx = P.x + (P.w >> 1), my = P.y + (P.h >> 1); return [[mx - 1, P.y + P.h - 1], [mx, P.y + P.h - 1], [mx + 1, P.y + P.h - 1], [P.x, my], [P.x, my + 1]]; }
  function buildLandmark(P) {
    const { x, y, w, h: hh } = P, mx = x + (w >> 1), my = y + (hh >> 1);
    const trig = (kind, tx, ty) => W.triggers.push({ id: W.triggers.length, kind, poi: P.key, x: tx + 0.5, y: ty + 0.5 });
    switch (P.key) {
      case 'hospital': {
        fill(x, y, w, hh, T.CONCRETE); fence(x, y, w, hh, gateGaps(P));
        buildHouse(x + 3, y + 3, w - 6, hh - 8, 'hospital', 'S');
        spawn('broodmother', mx, my - 2, { tag: 'broodmother' });
        for (let k = 0; k < 5; k++) spawn(R.pick(['crawler', 'toxic', 'walker']), x + 5 + R.i(w - 10), y + 5 + R.i(hh - 12));
        P.ambulance = addCont('car', x + 4, y + hh - 4, -1, [idx(x + 4, y + hh - 4), idx(x + 5, y + hh - 4)]);
        if (P.ambulance) { P.ambulance.color = '#e8e8e8'; P.ambulance.horiz = true; P.ambulance.x += 0.5; }
        break;
      }
      case 'lab': {
        fill(x, y, w, hh, T.CONCRETE); fence(x, y, w, hh, gateGaps(P));
        const b = buildHouse(x + 4, y + 3, w - 8, hh - 8, 'lab', 'S');
        W.gates.push(...b.doors.map(([dx, dy]) => idx(dx, dy)));
        spawn('x13', mx, my - 2, { tag: 'x13' });
        for (let k = 0; k < 4; k++) spawn('stalker', x + 6 + R.i(w - 12), y + 5 + R.i(hh - 12));
        spawn('dr_han', x + 6, y + 5, { tag: 'dr_han', mode: 'wait' });
        trig('lab_gate', b.doors[0][0], b.doors[0][1] + 1);
        break;
      }
      case 'military': {
        fill(x, y, w, hh, T.CONCRETE); fence(x, y, w, hh, gateGaps(P));
        buildHouse(x + 3, y + 3, 12, 8, 'barracks', 'S');
        buildHouse(x + w - 13, y + 3, 10, 8, 'barracks', 'S');
        for (let i = x + 3; i < x + w - 3; i += 3) set(i, y + hh - 5, T.FENCE); // sandbag line
        addCont('milcrate', x + 4, y + hh - 3, -1); addCont('milcrate', x + w - 5, y + hh - 3, -1);
        spawn('yoon', mx, my + 2, { tag: 'yoon', home: { x: mx + 0.5, y: my + 2.5 } });
        for (let k = 0; k < 4; k++) spawn('soldier', x + 4 + R.i(w - 8), my + 1 + R.i(4), { home: { x: mx, y: my } });
        for (let k = 0; k < 2; k++) spawn('soldier_heavy', mx - 3 + k * 6, y + hh - 4);
        break;
      }
      case 'tower': {
        fill(x, y, w, hh, T.CONCRETE); fence(x, y, w, hh, gateGaps(P));
        buildHouse(x + 2, y + 2, 7, 5, 'tower', 'S');
        set(mx + 2, my + 2, T.ROCK); P.mast = { x: mx + 2.5, y: my + 2.5 };
        trig('tower', mx + 1, my + 3);
        for (let k = 0; k < 3; k++) spawn('walker', x + 3 + R.i(w - 6), y + 8 + R.i(5));
        break;
      }
      case 'church': {
        fill(x, y, w, hh, T.DIRT);
        fence(x, y, w, hh, gateGaps(P));
        buildHouse(x + 6, y + 2, 12, 11, 'church', 'S');
        for (let j = y + 15; j < y + hh - 2; j += 2) for (let i = x + 2; i < x + w - 2; i += 3) if (R.chance(0.7) && Math.abs(i - mx) > 1) set(i, j, T.GRAVE);
        spawn('cult_priest', mx, y + 6, { tag: 'priest' });
        for (let k = 0; k < 4; k++) spawn('cultist', x + 3 + R.i(w - 6), y + 14 + R.i(4));
        for (let k = 0; k < 2; k++) spawn('zealot', x + 8 + R.i(8), y + 9);
        spawn('lost', x + 8, y + 4, { tag: 'mechanic', mode: 'wait', title: '정비공 백도윤' });
        break;
      }
      case 'prison': {
        fill(x, y, w, hh, T.CONCRETE); fence(x, y, w, hh, gateGaps(P));
        fence(x + 2, y + 2, w - 4, hh - 4, [[mx - 1, y + hh - 3], [mx, y + hh - 3], [mx + 1, y + hh - 3]]);
        buildHouse(x + 6, y + 5, w - 12, 13, 'cellblock', 'S');
        spawn('goliath', mx, y + hh - 7, { tag: 'goliath' });
        for (let k = 0; k < 4; k++) spawn('riot', x + 6 + R.i(w - 12), y + 8 + R.i(6));
        for (let k = 0; k < 4; k++) spawn('hound', x + 5 + R.i(w - 10), y + hh - 6);
        break;
      }
      case 'station': {
        fill(x, y, w, hh, T.CONCRETE);
        buildHouse(x + 2, y + 2, 8, 6, 'station', 'S');
        for (let k = 0; k < 4; k++) { const px = x + 4 + (k % 2) * 8, py = y + 10 + (k >> 1) * 3; const c = addCont('pump', px, py, -1); if (c) c.respawn = 1; }
        P.canopy = { x: x + 2, y: y + 9, w: 15, h: 6 };
        for (let k = 0; k < 4; k++) spawn(R.pick(['walker', 'walker', 'runner', 'toxic']), x + 2 + R.i(w - 4), y + 9 + R.i(5));
        break;
      }
      case 'farm': {
        fill(x, y, w, hh, T.DIRT); fence(x, y, w, hh, gateGaps(P));
        buildHouse(x + 2, y + 2, 9, 7, 'farmhouse', 'S');
        buildHouse(x + w - 11, y + 2, 9, 7, 'warehouse', 'S');
        for (let j = y + 11; j < y + hh - 2; j++) for (let i = x + 2; i < x + w - 2; i++) if ((i - x) % 4 !== 0 && Math.abs(i - mx) > 1) set(i, j, T.CROP);
        trig('farm_pump', mx, y + 9);
        for (let k = 0; k < 4; k++) spawn('hound', x + 4 + R.i(w - 8), y + 12 + R.i(6));
        break;
      }
      case 'school': {
        fill(x, y, w, hh, T.DIRT); fence(x, y, w, hh, gateGaps(P));
        buildHouse(x + 2, y + 2, w - 4, 10, 'school', 'S');
        spawn('lost', x + 5, y + 5, { tag: 'child', mode: 'wait', title: '박민호' });
        for (let k = 0; k < 6; k++) spawn(R.pick(['walker', 'crawler', 'runner']), x + 3 + R.i(w - 6), y + 13 + R.i(4));
        break;
      }
      case 'helipad': {
        fill(x, y, w, hh, T.CONCRETE); fence(x, y, w, hh, gateGaps(P));
        fill(mx - 3, my - 3, 7, 7, T.PAD);
        addCont('milcrate', x + 3, y + 3, -1); addCont('milcrate', x + w - 4, y + 3, -1);
        trig('flare', mx, my + 4);
        break;
      }
    }
  }
}

function genWorld(seed) {
  const R = rng(seed);
  Object.assign(W, {
    seed, tile: new Uint8Array(MW * MH), mb: new Uint8Array(MW * MH), structAt: new Array(MW * MH).fill(null),
    contAt: new Array(MW * MH).fill(null), conts: [], buildings: [], villages: [], camps: [], spawnsEdge: [[], [], [], []],
    npcSpawns: [], survivorSpots: [], reserved: new Uint8Array(MW * MH), floorStyle: new Uint8Array(MW * MH), bldAt: new Int16Array(MW * MH).fill(-1),
    pois: [], triggers: [], gates: [],
  });
  const tile = W.tile, res = W.reserved;
  const set = (x, y, t) => { if (inMap(x, y)) tile[idx(x, y)] = t; };
  const get = (x, y) => inMap(x, y) ? tile[idx(x, y)] : T.ROCK;
  const reserve = (x, y, w, h, m = 0) => { for (let j = y - m; j < y + h + m; j++) for (let i = x - m; i < x + w + m; i++) if (inMap(i, j)) res[idx(i, j)] = 1; };
  const areaFree = (x, y, w, h, allowRoad) => {
    if (x < 2 || y < 2 || x + w > MW - 2 || y + h > MH - 2) return false;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      const k = idx(i, j); if (res[k]) return false;
      const t = tile[k]; if (t !== T.GRASS && t !== T.DIRT && !(allowRoad && (t === T.ROAD || t === T.WALK))) return false;
    }
    return true;
  };

  // ground
  const n1 = valueNoise(R, 10), n2 = valueNoise(R, 7), n3 = valueNoise(R, 5);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (n1(x / MW, y / MH) > 0.66) set(x, y, T.DIRT);

  // base
  const cx = MW >> 1, cy = MH >> 1;
  W.base = { cx, cy, x: cx - 11, y: cy - 10, w: 22, h: 20 };
  // roads (3 wide) — main cross through the base + ring roads
  const roadH = (y, x0, x1) => { for (let x = x0; x <= x1; x++) for (let k = -1; k <= 1; k++) set(x, y + k, T.ROAD); };
  const roadV = (x, y0, y1) => { for (let y = y0; y <= y1; y++) for (let k = -1; k <= 1; k++) set(x + k, y, T.ROAD); };
  roadH(cy, 0, MW - 1); roadV(cx, 0, MH - 1);
  const ry1 = 26 + R.i(8), ry2 = MH - 28 - R.i(8), rx1 = 30 + R.i(8), rx2 = MW - 32 - R.i(8);
  roadH(ry1, rx1, rx2); roadH(ry2, rx1, rx2); roadV(rx1, ry1, ry2); roadV(rx2, ry1, ry2);
  // inner ring around the town centre
  const iy1 = cy - 26, iy2 = cy + 26, ix1 = cx - 34, ix2 = cx + 34;
  roadH(iy1, ix1, ix2); roadH(iy2, ix1, ix2); roadV(ix1, iy1, iy2); roadV(ix2, iy1, iy2);
  W.roads = { ry1, ry2, rx1, rx2, iy1, iy2, ix1, ix2 };
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const t = tile[idx(x, y)];
    if (t === T.ROAD) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (get(x + dx, y + dy) === T.ROAD) { set(x, y, T.WALK); break; }
  }
  for (let y = W.base.y; y < W.base.y + W.base.h; y++) for (let x = W.base.x; x < W.base.x + W.base.w; x++) set(x, y, T.CONCRETE);
  reserve(W.base.x, W.base.y, W.base.w, W.base.h, 4);

  // lakes
  for (let k = 0; k < 7; k++) {
    for (let tries = 0; tries < 60; tries++) {
      const lx = 10 + R.i(MW - 20), ly = 10 + R.i(MH - 20), lr = 3 + R.f() * 4;
      if (dist(lx, ly, cx, cy) < 30) continue;
      let ok = true;
      for (let y = ly - 9; y <= ly + 9 && ok; y++) for (let x = lx - 9; x <= lx + 9; x++) { const t = get(x, y); if (t === T.ROAD || t === T.WALK || (inMap(x, y) && res[idx(x, y)])) { ok = false; break; } }
      if (!ok) continue;
      for (let y = ly - 9; y <= ly + 9; y++) for (let x = lx - 9; x <= lx + 9; x++) {
        const d = dist(x, y, lx, ly) / (lr * (0.8 + 0.4 * n3(x / MW, y / MH)));
        if (d < 1) set(x, y, T.WATER); else if (d < 1.35) set(x, y, T.SAND);
      }
      reserve(lx - 9, ly - 9, 19, 19);
      break;
    }
  }

  // villages (fenced, friendly — trade or steal)
  const VNAMES = ['솔빛 마을', '은행나무 마을', '바람골 마을', '소금밭 마을'];
  const placeVillage = (vi) => {
    const vw = 24, vh = 20;
    for (let tries = 0; tries < 400; tries++) {
      const x = 4 + R.i(MW - vw - 8), y = 4 + R.i(MH - vh - 8);
      if (dist(x + vw / 2, y + vh / 2, cx, cy) < 36) continue;
      if (W.villages.some(v => dist(v.x, v.y, x, y) < 60)) continue;
      if (!areaFree(x, y, vw, vh, false)) continue;
      const v = { id: vi, name: VNAMES[vi], x, y, w: vw, h: vh, hostile: 0 };
      for (let j = y; j < y + vh; j++) for (let i = x; i < x + vw; i++) set(i, j, T.VFLOOR);
      for (let i = x; i < x + vw; i++) { set(i, y, T.FENCE); set(i, y + vh - 1, T.FENCE); }
      for (let j = y; j < y + vh; j++) { set(x, j, T.FENCE); set(x + vw - 1, j, T.FENCE); }
      const gx = x + (vw >> 1), gy = y + (vh >> 1);
      for (let k = -1; k <= 1; k++) { set(gx + k, y, T.VFLOOR); set(gx + k, y + vh - 1, T.VFLOOR); set(x, gy + k, T.VFLOOR); set(x + vw - 1, gy + k, T.VFLOOR); }
      const houses = [[x + 2, y + 2], [x + vw - 9, y + 2], [x + 2, y + vh - 8], [x + vw - 9, y + vh - 8]];
      houses.forEach(([hx, hy], hi) => {
        const b = buildHouse(hx, hy, 7, 6, 'house', hi < 2 ? 'S' : 'N', vi);
        b.village = vi;
      });
      v.stall = { x: gx + 0.5, y: gy + 0.5 };
      addCont('stash', gx - 3, gy - 1, vi); addCont('stash', gx + 3, gy + 1, vi);
      addCont('crate', gx - 3, gy + 2, vi); addCont('safe', gx + 3, gy - 2, vi);
      W.npcSpawns.push({ kind: 'trader', x: gx + 0.5, y: gy + 0.5, village: vi, home: v.stall });
      for (let k = 0; k < 3; k++) W.npcSpawns.push({ kind: 'guard', x: gx + 0.5 + (k - 1) * 4, y: gy + 3.5, village: vi });
      for (let k = 0; k < 4; k++) W.npcSpawns.push({ kind: 'villager', x: x + 4 + R.i(vw - 8) + 0.5, y: gy + R.i(3) - 1 + 0.5, village: vi });
      W.npcSpawns.push({ kind: 'elder', x: gx + 0.5, y: gy - 2.5, village: vi, tag: 'elder' + vi, home: { x: gx + 0.5, y: gy - 2.5 } });
      reserve(x, y, vw, vh, 2);
      W.villages.push(v);
      return;
    }
  };

  // bandit camps (hostile, rich loot)
  const placeCamp = (ci) => {
    const w = 18, h = 15;
    for (let tries = 0; tries < 400; tries++) {
      const x = 4 + R.i(MW - w - 8), y = 4 + R.i(MH - h - 8);
      if (dist(x + w / 2, y + h / 2, cx, cy) < 32) continue;
      if (!areaFree(x, y, w, h, false)) continue;
      if (W.camps.some(o => dist(o.x, o.y, x, y) < 40)) continue;
      const c = { id: ci, name: CAMP_NAMES[ci], boss: CAMP_BOSSES[ci], x, y, w, h };
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, T.CAMPDIRT);
      for (let i = x; i < x + w; i++) { if (R.chance(0.7)) set(i, y, T.FENCE); if (R.chance(0.7)) set(i, y + h - 1, T.FENCE); }
      for (let j = y; j < y + h; j++) { if (R.chance(0.7)) set(x, j, T.FENCE); if (R.chance(0.7)) set(x + w - 1, j, T.FENCE); }
      for (const [tx, ty] of [[x + 2, y + 2], [x + w - 6, y + 2], [x + 2, y + h - 5]]) for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) set(tx + i, ty + j, T.TENT);
      const mx = x + (w >> 1), my = y + (h >> 1);
      addCont('ammobox', mx - 2, my, -1); addCont('crate', mx + 2, my, -1); addCont('safe', x + w - 3, y + h - 3, -1);
      addCont('crate', mx, my + 3, -1); addCont('ammobox', x + w - 5, y + h - 3, -1);
      const kinds = ['bandit_thug', 'bandit_gunner', 'bandit_smg', 'bandit_shotgun', 'bandit_sniper'];
      for (let k = 0; k < 5; k++) W.npcSpawns.push({ kind: kinds[k], x: mx + R.r(-4, 4), y: my + R.r(-3, 3), camp: ci });
      W.npcSpawns.push({ kind: 'bandit_boss', x: mx + 0.5, y: my + 1.5, camp: ci, tag: 'camp' + ci, title: CAMP_BOSSES[ci] });
      c.fire = { x: mx + 0.5, y: my - 1.5 };
      reserve(x, y, w, h, 2);
      W.camps.push(c);
      return;
    }
  };

  function addCont(kind, x, y, village, cells) {
    if (!inMap(x, y)) return null;
    const i = idx(x, y);
    if (W.contAt[i] || TILE_SOLID[tile[i]]) return null;
    const c = { id: W.conts.length, kind, x: x + 0.5, y: y + 0.5, cells: cells || [i], looted: false, village: village === undefined ? -1 : village, horiz: false };
    for (const k of c.cells) W.contAt[k] = c;
    W.conts.push(c);
    return c;
  }
  W.addCont = addCont;

  // a building: walls, floor, door(s), containers
  function buildHouse(x, y, w, h, type, doorSide, village) {
    const B = BUILDING_TYPES[type], bi = W.buildings.length;
    const style = B.floor === 'wood' ? 1 : B.floor === 'tile' ? 2 : 3;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      const edge = i === x || j === y || i === x + w - 1 || j === y + h - 1;
      set(i, j, edge ? T.WALL : T.FLOOR); W.floorStyle[idx(i, j)] = style; W.bldAt[idx(i, j)] = bi;
    }
    const doors = [];
    const door = side => {
      let dx, dy;
      if (side === 'S') { dx = x + 1 + R.i(w - 3); dy = y + h - 1; }
      else if (side === 'N') { dx = x + 1 + R.i(w - 3); dy = y; }
      else if (side === 'W') { dx = x; dy = y + 1 + R.i(h - 3); }
      else { dx = x + w - 1; dy = y + 1 + R.i(h - 3); }
      set(dx, dy, T.DOOR); doors.push([dx, dy]);
      if (w > 9 && (side === 'S' || side === 'N')) { set(dx + 1, dy, T.DOOR); doors.push([dx + 1, dy]); }
    };
    door(doorSide);
    if (w * h > 70 && R.chance(0.6)) door({ S: 'N', N: 'S', W: 'E', E: 'W' }[doorSide]);
    // partition
    if (w >= 10) {
      const px = x + (w >> 1), gap = y + 1 + R.i(h - 3);
      for (let j = y + 1; j < y + h - 1; j++) if (j !== gap && j !== gap + 1) set(px, j, T.WALL);
    }
    const nearDoor = (i, j) => doors.some(([a, b]) => Math.abs(a - i) + Math.abs(b - j) <= 2);
    const spots = [];
    for (let j = y + 1; j < y + h - 1; j++) for (let i = x + 1; i < x + w - 1; i++) {
      if (get(i, j) !== T.FLOOR || nearDoor(i, j)) continue;
      const adjWall = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => get(i + a, j + b) === T.WALL);
      // keep partition gaps clear
      const gapBlock = [[1, 0], [-1, 0]].some(([a]) => get(i + a, j) === T.FLOOR && get(i - a, j) === T.WALL && get(i + a * 2, j) === T.WALL);
      if (adjWall && !gapBlock) spots.push([i, j]);
    }
    for (let k = spots.length - 1; k > 0; k--) { const r = R.i(k + 1); [spots[k], spots[r]] = [spots[r], spots[k]]; }
    let placed = 0;
    for (const kind of B.conts) {
      while (spots.length) {
        const [i, j] = spots.pop();
        // don't block a 1-wide corridor: need floor on at least 2 orthogonal sides
        const free = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => get(i + a, j + b) === T.FLOOR && !W.contAt[idx(i + a, j + b)]).length;
        if (free < 2) continue;
        if (addCont(kind, i, j, village)) { placed++; break; }
      }
    }
    const b = { id: bi, x, y, w, h, type, name: B.name, roof: B.roof, doors, village: -1 };
    W.buildings.push(b);
    reserve(x, y, w, h, 1);
    if (village === undefined || village < 0) W.survivorSpots.push({ x: x + 1.5 + R.i(w - 3), y: y + 1.5 + R.i(h - 3), b: bi });
    return b;
  }

  for (let k = 0; k < 4; k++) placeVillage(k);
  for (let k = 0; k < 4; k++) placeCamp(k);
  placeLandmarks(R, { set, get, reserve, areaFree, addCont, buildHouse, cx, cy });

  // town: buildings along the roads; the NE-ish block is denser
  const typeBag = ['house', 'house', 'house', 'house', 'store', 'store', 'garage', 'warehouse', 'clinic', 'police', 'office'];
  let built = 0;
  for (let tries = 0; tries < 12000 && built < 150; tries++) {
    const horiz = R.chance(0.5);
    let rx, ry;
    if (horiz) { ry = R.pick([cy, ry1, ry2, iy1, iy2]); rx = 3 + R.i(MW - 6); } else { rx = R.pick([cx, rx1, rx2, ix1, ix2]); ry = 3 + R.i(MH - 6); }
    if (tile[idx(rx, ry)] !== T.ROAD) continue;
    const type = R.pick(typeBag), big = type === 'warehouse' || type === 'store' || type === 'police';
    const w = big ? 10 + R.i(4) : 7 + R.i(3), h = big ? 8 + R.i(3) : 6 + R.i(2);
    let x, y, side;
    if (horiz) {
      const north = R.chance(0.5);
      x = rx - (w >> 1); y = north ? ry - 3 - h : ry + 3; side = north ? 'S' : 'N';
    } else {
      const west = R.chance(0.5);
      y = ry - (h >> 1); x = west ? rx - 3 - w : rx + 3; side = west ? 'E' : 'W';
    }
    if (!areaFree(x - 1, y - 1, w + 2, h + 2, false)) continue;
    buildHouse(x, y, w, h, type, side);
    built++;
  }
  // make sure the important ones exist at least once
  for (const need of ['police', 'clinic', 'garage']) {
    if (W.buildings.some(b => b.type === need)) continue;
    for (let tries = 0; tries < 2000; tries++) {
      const x = 4 + R.i(MW - 16), y = 4 + R.i(MH - 14);
      if (!areaFree(x - 1, y - 1, 12, 10, false)) continue;
      buildHouse(x, y, 10, 8, need, R.pick(['N', 'S', 'E', 'W']));
      break;
    }
  }

  // cars on roads (2 cells, lootable)
  for (let k = 0, tries = 0; k < 70 && tries < 6000; tries++) {
    const x = 2 + R.i(MW - 4), y = 2 + R.i(MH - 4);
    if (tile[idx(x, y)] !== T.ROAD || res[idx(x, y)]) continue;
    const hz = tile[idx(x - 2, y)] === T.ROAD && tile[idx(x + 2, y)] === T.ROAD && get(x, y - 2) !== T.ROAD;
    const x2 = hz ? x + 1 : x, y2 = hz ? y : y + 1;
    if (tile[idx(x2, y2)] !== T.ROAD || W.contAt[idx(x2, y2)] || W.contAt[idx(x, y)]) continue;
    // keep the middle lane free near the base so waves can still path in
    if (dist(x, y, cx, cy) < 18) continue;
    const c = addCont('car', x, y, -1, [idx(x, y), idx(x2, y2)]);
    if (c) { c.x = (x + x2) / 2 + 0.5; c.y = (y + y2) / 2 + 0.5; c.horiz = hz; c.color = R.pick(['#7a2f2f', '#2f4a7a', '#4a6a3a', '#8a8a8a', '#d0c080', '#3a3a3a']); k++; }
  }

  // forests, rocks, scattered trees
  for (let y = 1; y < MH - 1; y++) for (let x = 1; x < MW - 1; x++) {
    const i = idx(x, y), t = tile[i];
    if ((t !== T.GRASS && t !== T.DIRT) || res[i]) continue;
    const f = n2(x / MW, y / MH);
    if (f > 0.6 && R.chance(0.5)) set(x, y, T.TREE);
    else if (R.chance(0.018)) set(x, y, T.TREE);
    else if (R.chance(0.004)) set(x, y, T.ROCK);
  }
  // crates of supplies lying around outside
  for (let k = 0, tries = 0; k < 45 && tries < 3000; tries++) {
    const x = 3 + R.i(MW - 6), y = 3 + R.i(MH - 6), t = get(x, y);
    if ((t !== T.GRASS && t !== T.DIRT) || res[idx(x, y)] || dist(x, y, cx, cy) < 20) continue;
    if (addCont(R.chance(0.3) ? 'ammobox' : 'crate', x, y, -1)) k++;
  }

  // edge spawn tiles: 0 N, 1 E, 2 S, 3 W
  for (let x = 0; x < MW; x++) for (let y = 0; y < 3; y++) { pushSpawn(0, x, y); pushSpawn(2, x, MH - 1 - y); }
  for (let y = 0; y < MH; y++) for (let x = 0; x < 3; x++) { pushSpawn(3, x, y); pushSpawn(1, MW - 1 - x, y); }
  function pushSpawn(d, x, y) { const i = idx(x, y); if (!TILE_SOLID[tile[i]] && !W.contAt[i]) W.spawnsEdge[d].push(i); }

  rebuildMoveGrid();
  return W;
}

function rebuildMoveGrid() {
  const mb = W.mb;
  for (let i = 0; i < MW * MH; i++) {
    let m = TILE_SOLID[W.tile[i]] ? MB_TERRAIN : 0;
    if (W.contAt[i]) m |= MB_OBJ;
    const s = W.structAt[i];
    if (s) { if (s.def.block) m |= MB_STRUCT; if (s.def.door) m |= MB_DOOR; }
    mb[i] = m;
  }
}
function updateCellMB(i) {
  let m = TILE_SOLID[W.tile[i]] ? MB_TERRAIN : 0;
  if (W.contAt[i]) m |= MB_OBJ;
  const s = W.structAt[i];
  if (s) { if (s.def.block) m |= MB_STRUCT; if (s.def.door) m |= MB_DOOR; }
  W.mb[i] = m;
}

// can `team` stand in cell i?
function cellBlocked(i, team) {
  const m = W.mb[i];
  if (m & (MB_TERRAIN | MB_OBJ)) return true;
  if (m & MB_STRUCT) return !((m & MB_DOOR) && (team === 'player'));
  return false;
}
function blockedAt(x, y, team) {
  const cx = Math.floor(x), cy = Math.floor(y);
  if (!inMap(cx, cy)) return true;
  return cellBlocked(idx(cx, cy), team);
}
function boxFree(x, y, r, team) {
  return !blockedAt(x - r, y - r, team) && !blockedAt(x + r, y - r, team) && !blockedAt(x - r, y + r, team) && !blockedAt(x + r, y + r, team);
}
// slide-move an actor; returns true if fully moved
function moveActor(a, vx, vy) {
  let ok = true;
  if (vx && boxFree(a.x + vx, a.y, a.r, a.team)) a.x += vx; else if (vx) ok = false;
  if (vy && boxFree(a.x, a.y + vy, a.r, a.team)) a.y += vy; else if (vy) ok = false;
  return ok;
}
const opaqueCell = i => TILE_OPAQUE[W.tile[i]] || (W.structAt[i] && W.structAt[i].def.block && W.structAt[i].type !== 'barrel' && W.structAt[i].type !== 'turret');
function los(ax, ay, bx, by) {
  const d = dist(ax, ay, bx, by), n = Math.ceil(d / 0.3);
  for (let k = 1; k < n; k++) {
    const x = Math.floor(ax + (bx - ax) * k / n), y = Math.floor(ay + (by - ay) * k / n);
    if (!inMap(x, y) || opaqueCell(idx(x, y))) return false;
  }
  return true;
}
// Amanatides–Woo grid walk. cb(cellIndex, tEnter) → true to stop. Returns the stop distance.
function rayCells(x, y, dx, dy, maxD, cb) {
  let cx = Math.floor(x), cy = Math.floor(y);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const tdx = dx ? Math.abs(1 / dx) : 1e9, tdy = dy ? Math.abs(1 / dy) : 1e9;
  let tmx = dx ? ((dx > 0 ? cx + 1 - x : x - cx) * tdx) : 1e9, tmy = dy ? ((dy > 0 ? cy + 1 - y : y - cy) * tdy) : 1e9;
  let t = 0;
  while (t <= maxD) {
    if (!inMap(cx, cy)) return t;
    if (cb(idx(cx, cy), t)) return t;
    if (tmx < tmy) { t = tmx; tmx += tdx; cx += sx; } else { t = tmy; tmy += tdy; cy += sy; }
  }
  return maxD;
}

// ── Flow fields (Dijkstra, ×10 costs, 8-neighbour, no corner cutting) ───────
const N8 = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]];
const FLOW_INF = 1 << 30;
const heapC = new Int32Array(MW * MH * 4), heapK = new Int32Array(MW * MH * 4);
function flowField(out, sources, maxCost = FLOW_INF) {
  out.fill(FLOW_INF);
  let n = 0;
  const push = (c, k) => { let i = n++; while (i > 0) { const p = (i - 1) >> 1; if (heapK[p] <= k) break; heapC[i] = heapC[p]; heapK[i] = heapK[p]; i = p; } heapC[i] = c; heapK[i] = k; };
  const pop = () => {
    const c = heapC[0], lk = heapK[--n], lc = heapC[n]; let i = 0;
    for (;;) { let m = i * 2 + 1; if (m >= n) break; if (m + 1 < n && heapK[m + 1] < heapK[m]) m++; if (heapK[m] >= lk) break; heapC[i] = heapC[m]; heapK[i] = heapK[m]; i = m; }
    heapC[i] = lc; heapK[i] = lk; return c;
  };
  for (const s of sources) { out[s] = 0; push(s, 0); }
  const mb = W.mb;
  while (n > 0) {
    const k0 = heapK[0], c = pop();
    if (k0 > out[c]) continue;
    const x = c % MW, y = (c / MW) | 0;
    for (const [dx, dy, base] of N8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
      const ni = ny * MW + nx, m = mb[ni];
      if (m & (MB_TERRAIN | MB_OBJ)) continue;
      if (dx && dy && ((mb[y * MW + nx] | mb[ny * MW + x]) & (MB_TERRAIN | MB_OBJ | MB_STRUCT))) continue;
      let cost = base;
      if (m & MB_STRUCT) { const s = W.structAt[ni]; cost += s ? Math.min(600, 20 + (s.hp / 3) | 0) : 50; }
      const nk = out[c] + cost;
      if (nk < out[ni] && nk <= maxCost && n < heapC.length) { out[ni] = nk; push(ni, nk); }
    }
  }
}

// ── A* for human NPCs ──────────────────────────────────────────────────────
const asG = new Float32Array(MW * MH), asFrom = new Int32Array(MW * MH), asSeen = new Int32Array(MW * MH), asClosed = new Int32Array(MW * MH);
let asGen = 1;
function findPath(sx, sy, tx, ty, team, maxNodes = 3000) {
  const s = idx(clamp(Math.floor(sx), 0, MW - 1), clamp(Math.floor(sy), 0, MH - 1));
  let t = idx(clamp(Math.floor(tx), 0, MW - 1), clamp(Math.floor(ty), 0, MH - 1));
  if (s === t) return [];
  asGen++;
  const tX = cellX(t), tY = cellY(t);
  const h = c => { const dx = Math.abs(cellX(c) - tX), dy = Math.abs(cellY(c) - tY); return (dx + dy) + (1.414 - 2) * Math.min(dx, dy); };
  let n = 0;
  const hc = heapC, hk = heapK;
  const push = (c, k) => { let i = n++; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hc[i] = hc[p]; hk[i] = hk[p]; i = p; } hc[i] = c; hk[i] = k; };
  const pop = () => {
    const c = hc[0], lk = hk[--n], lc = hc[n]; let i = 0;
    for (;;) { let m = i * 2 + 1; if (m >= n) break; if (m + 1 < n && hk[m + 1] < hk[m]) m++; if (hk[m] >= lk) break; hc[i] = hc[m]; hk[i] = hk[m]; i = m; }
    hc[i] = lc; hk[i] = lk; return c;
  };
  asSeen[s] = asGen; asG[s] = 0; asFrom[s] = -1; push(s, h(s) * 1000 | 0);
  let best = s, bestH = h(s), expanded = 0;
  while (n > 0 && expanded < maxNodes) {
    const c = pop();
    if (asClosed[c] === asGen) continue;
    asClosed[c] = asGen; expanded++;
    if (c === t) { best = c; break; }
    const hh = h(c); if (hh < bestH) { bestH = hh; best = c; }
    const x = cellX(c), y = cellY(c);
    for (const [dx, dy, base] of N8) {
      const nx = x + dx, ny = y + dy;
      if (!inMap(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (ni !== t && cellBlocked(ni, team)) continue;
      if (dx && dy && (cellBlocked(idx(nx, y), team) || cellBlocked(idx(x, ny), team))) continue;
      const g = asG[c] + base / 10;
      if (asSeen[ni] === asGen && asG[ni] <= g) continue;
      asSeen[ni] = asGen; asG[ni] = g; asFrom[ni] = c;
      push(ni, (g + h(ni)) * 1000 | 0);
    }
  }
  const path = [];
  for (let c = best; c !== s && c >= 0; c = asFrom[c]) path.push(c);
  path.reverse();
  return path;
}

function randomFreeCell(R, x0, y0, x1, y1, team = 'zombie') {
  for (let k = 0; k < 200; k++) {
    const x = clamp(Math.floor(R.r(x0, x1)), 0, MW - 1), y = clamp(Math.floor(R.r(y0, y1)), 0, MH - 1), i = idx(x, y);
    if (!cellBlocked(i, team)) return { x: x + 0.5, y: y + 0.5 };
  }
  return null;
}
