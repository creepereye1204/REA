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

const CAMP_NAMES = ['붉은 약탈단 캠프', '해골 약탈단 캠프', '까마귀 약탈단 캠프', '들개 약탈단 캠프', '독사 약탈단 캠프', '철갑 약탈단 캠프', '불개미 약탈단 캠프', '흑곰 약탈단 캠프', '이리떼 약탈단 캠프', '녹슨칼 약탈단 캠프'];
const CAMP_BOSSES = ['도끼 장', '백골', '까마귀', '들개 왕', '독사', '철갑', '불개미', '흑곰', '이리', '녹슨칼'];
const VNAMES = ['솔빛 마을', '은행나무 마을', '바람골 마을', '소금밭 마을', '갈대 마을', '돌담 마을', '벚꽃 마을', '능선 마을'];
const TOWN_NAMES = ['중앙 시가지', '북부 신도시', '동해 항구', '서부 공단', '남부 읍내', '강변 시가지'];

// ── Story landmarks: each is a fenced lot with a themed building, loot, guards and story hooks.
// ring = [min, max] distance from the base, so the campaign stays walkable in a big world.
const LANDMARKS = [
  { key: 'hospital', name: '종합병원',            w: 32, h: 24, ring: [60, 170] },
  { key: 'lab',      name: '한빛 생명공학 연구소', w: 28, h: 22, ring: [170, 300] },
  { key: 'military', name: '잔존군 검문소',        w: 28, h: 22, ring: [120, 250] },
  { key: 'tower',    name: '송신탑',              w: 16, h: 16, ring: [70, 160] },
  { key: 'church',   name: '붉은 새벽 교회',       w: 24, h: 22, ring: [120, 260] },
  { key: 'prison',   name: '교도소',              w: 34, h: 28, ring: [170, 320] },
  { key: 'station',  name: '고속도로 주유소',      w: 20, h: 16, ring: [60, 190] },
  { key: 'farm',     name: '햇살 농장',            w: 30, h: 24, ring: [60, 200] },
  { key: 'school',   name: '초등학교',            w: 24, h: 20, ring: [50, 160] },
  { key: 'helipad',  name: '옥상 헬기장',          w: 20, h: 20, ring: [190, 340] },
];
// ── Generic structures, scattered Minecraft-style: one roll per region, chosen by biome ──
const GENERIC = {
  apartment: { name: '폐허 아파트 단지', w: 30, h: 26 },
  mart:      { name: '대형마트',         w: 28, h: 24 },
  bunker:    { name: '비밀 벙커',        w: 16, h: 14 },
  crash:     { name: '추락한 수송기',    w: 24, h: 16 },
  cabin:     { name: '숲속 산장',        w: 14, h: 12 },
  station:   { name: '국도 주유소',      w: 20, h: 16 },
  farm:      { name: '버려진 농장',      w: 30, h: 24 },
  school:    { name: '폐교',             w: 24, h: 20 },
};
const REGION_POOL = {
  [BIO.CITY]: ['apartment', 'mart', 'apartment', 'school'], [BIO.FOREST]: ['cabin', 'bunker', 'crash', 'cabin'],
  [BIO.PLAINS]: ['farm', 'station', 'crash', 'cabin', 'school'], [BIO.FARM]: ['farm', 'farm', 'station'],
  [BIO.WASTE]: ['crash', 'bunker', 'mart', 'apartment'], [BIO.SWAMP]: ['cabin', 'crash'], [BIO.MOUNTAIN]: ['bunker', 'cabin', 'crash'], [BIO.BEACH]: ['station', 'crash'],
};
const POI_MOB_POOL = { apartment: ['walker', 'walker', 'runner', 'crawler', 'screamer'], mart: ['walker', 'walker', 'walker', 'runner', 'bloater'], bunker: ['stalker', 'riot', 'walker'],
                       crash: ['hound', 'hound', 'walker', 'riot'], cabin: ['walker', 'hound'], station: ['walker', 'runner', 'toxic'], farm: ['hound', 'walker'], school: ['walker', 'crawler', 'runner'] };

function structureBuilders(R, h) {
  const { set, addCont, buildHouse } = h;
  const fill = (x, y, w, hh, t) => { for (let j = y; j < y + hh; j++) for (let i = x; i < x + w; i++) set(i, j, t); };
  const fence = (x, y, w, hh, gaps) => {
    for (let i = x; i < x + w; i++) { set(i, y, T.FENCE); set(i, y + hh - 1, T.FENCE); }
    for (let j = y; j < y + hh; j++) { set(x, j, T.FENCE); set(x + w - 1, j, T.FENCE); }
    for (const [gx, gy] of gaps) set(gx, gy, T.CONCRETE);
  };
  const spawn = (kind, x, y, o = {}) => W.npcSpawns.push({ kind, x: x + 0.5, y: y + 0.5, poi: o.poi, ...o });
  function gateGaps(P) { const mx = P.x + (P.w >> 1), my = P.y + (P.h >> 1); return [[mx - 1, P.y + P.h - 1], [mx, P.y + P.h - 1], [mx + 1, P.y + P.h - 1], [P.x, my], [P.x, my + 1]]; }
  const mobs = (P, n, x0, y0, x1, y1) => { const pool = POI_MOB_POOL[P.key]; for (let k = 0; k < n; k++) spawn(R.pick(pool), x0 + R.i(Math.max(1, x1 - x0)), y0 + R.i(Math.max(1, y1 - y0))); };
  function buildLandmark(P, story) {
    const { x, y, w, h: hh } = P, mx = x + (w >> 1), my = y + (hh >> 1);
    const trig = (kind, tx, ty) => { if (story) W.triggers.push({ id: W.triggers.length, kind, poi: P.key, x: tx + 0.5, y: ty + 0.5 }); };
    switch (P.key) {
      case 'hospital': {
        fill(x, y, w, hh, T.CONCRETE); fence(x, y, w, hh, gateGaps(P));
        buildHouse(x + 3, y + 3, w - 6, hh - 8, 'hospital', 'S');
        spawn('broodmother', mx, my - 2, { tag: 'broodmother' });
        for (let k = 0; k < 7; k++) spawn(R.pick(['crawler', 'toxic', 'walker']), x + 5 + R.i(w - 10), y + 5 + R.i(hh - 12));
        P.ambulance = addCont('car', x + 4, y + hh - 4, -1, [idx(x + 4, y + hh - 4), idx(x + 5, y + hh - 4)]);
        if (P.ambulance) { P.ambulance.color = '#e8e8e8'; P.ambulance.horiz = true; P.ambulance.x += 0.5; }
        break;
      }
      case 'lab': {
        fill(x, y, w, hh, T.CONCRETE); fence(x, y, w, hh, gateGaps(P));
        const b = buildHouse(x + 4, y + 3, w - 8, hh - 8, 'lab', 'S');
        W.gates.push(...b.doors.map(([dx, dy]) => idx(dx, dy)));
        spawn('x13', mx, my - 2, { tag: 'x13' });
        for (let k = 0; k < 5; k++) spawn('stalker', x + 6 + R.i(w - 12), y + 5 + R.i(hh - 12));
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
        for (let k = 0; k < 4; k++) spawn('walker', x + 3 + R.i(w - 6), y + 8 + R.i(5));
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
        for (let k = 0; k < 5; k++) spawn('riot', x + 6 + R.i(w - 12), y + 8 + R.i(6));
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
        if (story) spawn('lost', x + 5, y + 5, { tag: 'child', mode: 'wait', title: '박민호' });
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
      // ── generic only ──
      case 'apartment': {
        fill(x, y, w, hh, T.CONCRETE); fence(x, y, w, hh, gateGaps(P));
        buildHouse(x + 2, y + 2, 12, 9, 'apartment', 'S'); buildHouse(x + w - 14, y + 2, 12, 9, 'apartment', 'S');
        buildHouse(x + 2, y + 13, 12, 9, 'apartment', 'S');
        for (let k = 0; k < 3; k++) { const c = addCont('car', x + 17 + k * 3, y + hh - 5, -1, [idx(x + 17 + k * 3, y + hh - 5), idx(x + 17 + k * 3, y + hh - 4)]); if (c) { c.y += 0.5; c.color = R.pick(['#7a2f2f', '#2f4a7a', '#8a8a8a', '#d0c080']); } }
        mobs(P, 9, x + 3, y + 3, x + w - 3, y + hh - 3);
        break;
      }
      case 'mart': {
        fill(x, y, w, hh, T.CONCRETE);
        buildHouse(x + 2, y + 2, w - 4, hh - 10, 'mart', 'S');
        for (let k = 0; k < 4; k++) { const cx2 = x + 3 + k * 6; const c = addCont('car', cx2, y + hh - 5, -1, [idx(cx2, y + hh - 5), idx(cx2, y + hh - 4)]); if (c) { c.y += 0.5; c.color = R.pick(['#7a2f2f', '#2f4a7a', '#4a6a3a', '#8a8a8a', '#3a3a3a']); } }
        mobs(P, 10, x + 3, y + 3, x + w - 3, y + hh - 9);
        break;
      }
      case 'bunker': {
        fill(x, y, w, hh, T.GRAVEL);
        buildHouse(x + 3, y + 2, w - 6, hh - 5, 'bunker', 'S');
        for (let i = x + 1; i < x + w - 1; i += 2) if (Math.abs(i - mx) > 2) set(i, y + hh - 2, T.FENCE);
        mobs(P, 4, x + 4, y + 3, x + w - 4, y + hh - 4);
        break;
      }
      case 'crash': {
        fill(x, y, w, hh, T.ASH);
        for (let i = x + 2; i < x + w - 2; i++) { if (R.chance(0.85)) set(i, my - 2, T.RUIN); if (R.chance(0.85)) set(i, my + 2, T.RUIN); }
        for (let j = y + 1; j < y + hh - 1; j++) if (Math.abs(j - my) > 2 && R.chance(0.7)) set(mx + 2, j, T.RUIN);
        for (let k = 0; k < 30; k++) set(x + R.i(w), y + R.i(hh), T.RUBBLE);
        for (let i = x + 3; i < x + w - 3; i++) for (let j = my - 1; j <= my + 1; j++) set(i, j, T.RUBBLE);
        addCont('milcrate', x + 5, my, -1); addCont('ammobox', x + w - 6, my, -1); addCont('milcrate', mx - 2, my - 5, -1); addCont('crate', mx + 5, my + 5, -1);
        P.wreck = true;
        mobs(P, 5, x + 2, y + 2, x + w - 2, y + hh - 2);
        break;
      }
      case 'cabin': {
        fill(x, y, w, hh, T.DIRT);
        buildHouse(x + 3, y + 2, 8, 6, 'cabin', 'S');
        addCont('crate', x + 2, y + hh - 3, -1); addCont('barn', x + w - 3, y + hh - 3, -1);
        mobs(P, 2, x + 2, y + 9, x + w - 2, y + hh - 1);
        break;
      }
    }
  }
  return { buildLandmark };
}

function genWorld(seed) {
  const R = rng(seed), N = MW * MH;
  Object.assign(W, {
    seed, tile: new Uint8Array(N), mb: new Uint8Array(N), structAt: new Array(N).fill(null),
    contAt: new Array(N).fill(null), conts: [], buildings: [], villages: [], camps: [], towns: [],
    npcSpawns: [], survivorSpots: [], reserved: new Uint8Array(N), floorStyle: new Uint8Array(N), bldAt: new Int16Array(N).fill(-1),
    pois: [], triggers: [], gates: [], biome: new Uint8Array(N),
  });
  const tile = W.tile, res = W.reserved, bio = W.biome;
  const set = (x, y, t) => { if (inMap(x, y)) tile[idx(x, y)] = t; };
  const get = (x, y) => inMap(x, y) ? tile[idx(x, y)] : T.WATER;
  const reserve = (x, y, w, h, m = 0) => { for (let j = y - m; j < y + h + m; j++) for (let i = x - m; i < x + w + m; i++) if (inMap(i, j)) res[idx(i, j)] = 1; };
  const SOFT = new Uint8Array(32); for (const t of [T.GRASS, T.DIRT, T.MUD, T.ASH, T.GRAVEL, T.SAND]) SOFT[t] = 1;
  const areaFree = (x, y, w, h, allowRoad) => {
    if (x < 4 || y < 4 || x + w > MW - 4 || y + h > MH - 4) return false;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      const k = idx(i, j); if (res[k]) return false;
      const t = tile[k]; if (!SOFT[t] && !(allowRoad && (t === T.ROAD || t === T.WALK))) return false;
    }
    return true;
  };
  const cx = MW >> 1, cy = MH >> 1;

  // ── terrain: island mask + biomes from layered noise (like Minecraft's climate parameters) ──
  const fbm = oct => { const ns = oct.map(([c, w]) => [valueNoise(R, c), w]), tw = oct.reduce((s, o) => s + o[1], 0); return (u, v) => { let s = 0; for (const [n, w] of ns) s += n(u, v) * w; return s / tw; }; };
  const stretch = v => clamp((v - 0.5) * 1.9 + 0.5, 0, 1); // averaged noise bunches up around 0.5
  const elev = fbm([[5, .55], [12, .3], [31, .15]]), moist = fbm([[4, .6], [10, .3], [26, .1]]), heat = fbm([[3, .7], [8, .3]]), river = fbm([[5, .75], [14, .25]]), fine = valueNoise(R, 140);
  // the climate fields are smooth, so sample them every 4 tiles and interpolate
  const Q = 4, QW = MW / Q + 1, QH = MH / Q + 1, qe = new Float32Array(QW * QH), qm = new Float32Array(QW * QH), qh = new Float32Array(QW * QH), qr = new Float32Array(QW * QH);
  for (let j = 0; j < QH; j++) for (let i = 0; i < QW; i++) { const u = i * Q / MW, v = j * Q / MH, k = j * QW + i; qe[k] = stretch(elev(u, v)); qm[k] = stretch(moist(u, v)); qh[k] = stretch(heat(u, v)); qr[k] = river(u, v); }
  const samp = (A, x, y) => { const fx = x / Q, fy = y / Q, ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, k = iy * QW + ix; return (A[k] * (1 - tx) + A[k + 1] * tx) * (1 - ty) + (A[k + QW] * (1 - tx) + A[k + QW + 1] * tx) * ty; };
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const u = x / MW, v = y / MH, i = y * MW + x;
    const e = samp(qe, x, y), m = samp(qm, x, y), h = samp(qh, x, y), f = fine(u, v);
    const d = Math.hypot(x - cx, y - cy) / (MW / 2);
    const land = 1 - 1.15 * Math.pow(d, 2.4) + (e - 0.5) * 0.5;
    let b, t = T.GRASS;
    if (land < 0.05) { b = BIO.OCEAN; t = T.WATER; }
    else if (land < 0.1) { b = BIO.BEACH; t = T.SAND; }
    else {
      b = e > 0.72 ? BIO.MOUNTAIN : m > 0.74 && e < 0.46 ? BIO.SWAMP : h > 0.6 && m < 0.5 ? BIO.WASTE : m > 0.54 ? BIO.FOREST : m > 0.4 && e < 0.55 ? BIO.FARM : BIO.PLAINS;
      if (b === BIO.WASTE) t = f > 0.5 ? T.ASH : T.DIRT;
      else if (b === BIO.SWAMP) t = f > 0.64 ? T.WATER : f > 0.44 ? T.MUD : T.GRASS;
      else if (b === BIO.MOUNTAIN) t = e > 0.82 && f > 0.42 ? T.ROCK : f > 0.55 ? T.GRAVEL : T.DIRT;
      else if (f > 0.72 && b !== BIO.FARM) t = T.DIRT;
      if (d > 0.08) { const r = Math.abs(samp(qr, x, y) - 0.5); if (r < 0.007) t = T.WATER; else if (r < 0.011 && t !== T.ROCK) t = b === BIO.SWAMP ? T.MUD : T.SAND; }
    }
    tile[i] = t; bio[i] = b;
  }

  // ── towns (the central one holds the base) ──
  W.towns.push({ id: 0, name: TOWN_NAMES[0], x: cx, y: cy, r: 70, grid: 22 });
  for (let k = 1; k < TOWN_NAMES.length; k++) {
    for (let tries = 0; tries < 300; tries++) {
      const a = (k - 1) / (TOWN_NAMES.length - 1) * TAU + R.r(-0.5, 0.5), dd = R.r(220, 370), rr = 34 + R.i(16);
      const x = Math.round(cx + Math.cos(a) * dd), y = Math.round(cy + Math.sin(a) * dd);
      let ok = true;
      for (let q = 0; q < 12 && ok; q++) { const px = Math.round(x + Math.cos(q / 12 * TAU) * rr), py = Math.round(y + Math.sin(q / 12 * TAU) * rr); if (!inMap(px, py) || bio[idx(px, py)] === BIO.OCEAN || bio[idx(px, py)] === BIO.BEACH) ok = false; }
      if (!ok || W.towns.some(t => dist(t.x, t.y, x, y) < t.r + rr + 70)) continue;
      W.towns.push({ id: k, name: TOWN_NAMES[k], x, y, r: rr, grid: 19 + R.i(4) });
      break;
    }
  }
  for (const tw of W.towns) {
    for (let y = tw.y - tw.r - 8; y <= tw.y + tw.r + 8; y++) for (let x = tw.x - tw.r - 8; x <= tw.x + tw.r + 8; x++) {
      if (!inMap(x, y) || dist(x, y, tw.x, tw.y) > tw.r + 8) continue;
      const i = idx(x, y); if (bio[i] === BIO.OCEAN) continue;
      bio[i] = BIO.CITY;
      if (tile[i] !== T.WATER || dist(x, y, tw.x, tw.y) < 24) tile[i] = hash2(x, y) > 0.82 ? T.DIRT : T.GRASS;
    }
  }
  // ── roads: town street grids + highways between towns ──
  const road = (x, y) => { if (inMap(x, y)) tile[idx(x, y)] = T.ROAD; };
  const roadH = (y, x0, x1) => { if (x0 > x1) [x0, x1] = [x1, x0]; for (let x = x0; x <= x1; x++) for (let k = -1; k <= 1; k++) road(x, y + k); };
  const roadV = (x, y0, y1) => { if (y0 > y1) [y0, y1] = [y1, y0]; for (let y = y0; y <= y1; y++) for (let k = -1; k <= 1; k++) road(x + k, y); };
  for (const tw of W.towns) {
    const g = tw.grid, r = tw.r;
    for (let o = -Math.floor(r / g) * g; o <= r; o += g) {
      const span = Math.floor(Math.sqrt(Math.max(0, r * r - o * o)));
      if (span < 10) continue;
      roadH(tw.y + o, tw.x - span, tw.x + span); roadV(tw.x + o, tw.y - span, tw.y + span);
    }
  }
  const highway = (a, b) => { if (R.chance(0.5)) { roadH(a.y, a.x, b.x); roadV(b.x, a.y, b.y); } else { roadV(a.x, a.y, b.y); roadH(b.y, a.x, b.x); } };
  for (let k = 1; k < W.towns.length; k++) { highway(W.towns[0], W.towns[k]); highway(W.towns[k], W.towns[k + 1 < W.towns.length ? k + 1 : 1]); }
  // sidewalks in towns
  for (const tw of W.towns) for (let y = tw.y - tw.r - 8; y <= tw.y + tw.r + 8; y++) for (let x = tw.x - tw.r - 8; x <= tw.x + tw.r + 8; x++) {
    if (!inMap(x, y)) continue;
    const t = tile[idx(x, y)];
    if (t === T.ROAD || t === T.WATER || bio[idx(x, y)] !== BIO.CITY) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (get(x + dx, y + dy) === T.ROAD) { set(x, y, T.WALK); break; }
  }
  // base
  W.base = { cx, cy, x: cx - 11, y: cy - 10, w: 22, h: 20 };
  for (let y = W.base.y; y < W.base.y + W.base.h; y++) for (let x = W.base.x; x < W.base.x + W.base.w; x++) set(x, y, T.CONCRETE);
  reserve(W.base.x, W.base.y, W.base.w, W.base.h, 4);

  // ── placement helpers ──
  const ringSpot = (w, h, rmin, rmax, allowRoad, extra) => {
    for (let tries = 0; tries < 1500; tries++) {
      const a = R.r(0, TAU), d = R.r(rmin, rmax);
      const x = Math.round(cx + Math.cos(a) * d - w / 2), y = Math.round(cy + Math.sin(a) * d - h / 2);
      if (extra && !extra(x, y)) continue;
      if (areaFree(x, y, w, h, allowRoad)) return { x, y };
    }
    return null;
  };
  const farFrom = (list, m) => (x, y) => !list.some(o => dist(o.x, o.y, x, y) < m);

  // villages (fenced, friendly — trade or steal). The first four carry the story.
  const placeVillage = (vi, rmin, rmax) => {
    const vw = 24, vh = 20;
    const s = ringSpot(vw, vh, rmin, rmax, false, farFrom(W.villages, 70));
    if (!s) return;
    const { x, y } = s;
    const v = { id: W.villages.length, name: VNAMES[vi], x, y, w: vw, h: vh, hostile: 0 };
    for (let j = y; j < y + vh; j++) for (let i = x; i < x + vw; i++) set(i, j, T.VFLOOR);
    for (let i = x; i < x + vw; i++) { set(i, y, T.FENCE); set(i, y + vh - 1, T.FENCE); }
    for (let j = y; j < y + vh; j++) { set(x, j, T.FENCE); set(x + vw - 1, j, T.FENCE); }
    const gx = x + (vw >> 1), gy = y + (vh >> 1);
    for (let k = -1; k <= 1; k++) { set(gx + k, y, T.VFLOOR); set(gx + k, y + vh - 1, T.VFLOOR); set(x, gy + k, T.VFLOOR); set(x + vw - 1, gy + k, T.VFLOOR); }
    const houses = [[x + 2, y + 2], [x + vw - 9, y + 2], [x + 2, y + vh - 8], [x + vw - 9, y + vh - 8]];
    houses.forEach(([hx, hy], hi) => { const b = buildHouse(hx, hy, 7, 6, 'house', hi < 2 ? 'S' : 'N', v.id); b.village = v.id; });
    v.stall = { x: gx + 0.5, y: gy + 0.5 };
    addCont('stash', gx - 3, gy - 1, v.id); addCont('stash', gx + 3, gy + 1, v.id);
    addCont('crate', gx - 3, gy + 2, v.id); addCont('safe', gx + 3, gy - 2, v.id);
    W.npcSpawns.push({ kind: 'trader', x: gx + 0.5, y: gy + 0.5, village: v.id, home: v.stall });
    for (let k = 0; k < 3; k++) W.npcSpawns.push({ kind: 'guard', x: gx + 0.5 + (k - 1) * 4, y: gy + 3.5, village: v.id });
    for (let k = 0; k < 4; k++) W.npcSpawns.push({ kind: 'villager', x: x + 4 + R.i(vw - 8) + 0.5, y: gy + R.i(3) - 1 + 0.5, village: v.id });
    if (v.id < 4) W.npcSpawns.push({ kind: 'elder', x: gx + 0.5, y: gy - 2.5, village: v.id, tag: 'elder' + v.id, home: { x: gx + 0.5, y: gy - 2.5 } });
    reserve(x, y, vw, vh, 2);
    W.villages.push(v);
  };
  // bandit camps (hostile, rich loot). The first four bosses are story targets.
  const placeCamp = (rmin, rmax) => {
    const w = 18, h = 15, ci = W.camps.length;
    const s = ringSpot(w, h, rmin, rmax, false, farFrom(W.camps, 60));
    if (!s) return;
    const { x, y } = s;
    const c = { id: ci, name: CAMP_NAMES[ci], boss: CAMP_BOSSES[ci], x, y, w, h };
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, T.CAMPDIRT);
    for (let i = x; i < x + w; i++) { if (R.chance(0.7)) set(i, y, T.FENCE); if (R.chance(0.7)) set(i, y + h - 1, T.FENCE); }
    for (let j = y; j < y + h; j++) { if (R.chance(0.7)) set(x, j, T.FENCE); if (R.chance(0.7)) set(x + w - 1, j, T.FENCE); }
    for (const [tx, ty] of [[x + 2, y + 2], [x + w - 6, y + 2], [x + 2, y + h - 5]]) for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) set(tx + i, ty + j, T.TENT);
    const mx = x + (w >> 1), my = y + (h >> 1);
    addCont('ammobox', mx - 2, my, -1); addCont('crate', mx + 2, my, -1); addCont('safe', x + w - 3, y + h - 3, -1);
    addCont('crate', mx, my + 3, -1); addCont('ammobox', x + w - 5, y + h - 3, -1);
    const kinds = ['bandit_thug', 'bandit_gunner', 'bandit_smg', 'bandit_shotgun', 'bandit_sniper', 'bandit_gunner'];
    for (let k = 0; k < kinds.length; k++) W.npcSpawns.push({ kind: kinds[k], x: mx + R.r(-4, 4), y: my + R.r(-3, 3), camp: ci });
    W.npcSpawns.push({ kind: 'bandit_boss', x: mx + 0.5, y: my + 1.5, camp: ci, tag: ci < 4 ? 'camp' + ci : null, title: CAMP_BOSSES[ci] });
    c.fire = { x: mx + 0.5, y: my - 1.5 };
    reserve(x, y, w, h, 2);
    W.camps.push(c);
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
      const gapBlock = [[1, 0], [-1, 0]].some(([a]) => get(i + a, j) === T.FLOOR && get(i - a, j) === T.WALL && get(i + a * 2, j) === T.WALL);
      if (adjWall && !gapBlock) spots.push([i, j]);
    }
    for (let k = spots.length - 1; k > 0; k--) { const r = R.i(k + 1); [spots[k], spots[r]] = [spots[r], spots[k]]; }
    for (const kind of B.conts) {
      while (spots.length) {
        const [i, j] = spots.pop();
        const free = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => get(i + a, j + b) === T.FLOOR && !W.contAt[idx(i + a, j + b)]).length;
        if (free < 2) continue;
        if (addCont(kind, i, j, village)) break;
      }
    }
    const b = { id: bi, x, y, w, h, type, name: B.name, roof: B.roof, doors, village: -1 };
    W.buildings.push(b);
    reserve(x, y, w, h, 1);
    if (village === undefined || village < 0) W.survivorSpots.push({ x: x + 1.5 + R.i(w - 3), y: y + 1.5 + R.i(h - 3), b: bi });
    return b;
  }
  const { buildLandmark } = structureBuilders(R, { set, addCont, buildHouse });

  for (let k = 0; k < 4; k++) placeVillage(k, 90, 250);
  for (let k = 0; k < 4; k++) placeCamp(100, 290);
  // story landmarks
  for (const L of LANDMARKS) {
    const s = ringSpot(L.w, L.h, L.ring[0], L.ring[1], true, (x, y) => !W.pois.some(p => dist(p.x + p.w / 2, p.y + p.h / 2, x + L.w / 2, y + L.h / 2) < 40));
    if (!s) continue;
    const P = { id: W.pois.length, key: L.key, name: L.name, x: s.x, y: s.y, w: L.w, h: L.h, story: true };
    buildLandmark(P, true); W.pois.push(P); reserve(s.x, s.y, L.w, L.h, 2);
  }
  for (let k = 4; k < VNAMES.length; k++) placeVillage(k, 230, 450);
  for (let k = 4; k < CAMP_NAMES.length; k++) placeCamp(180, 460);
  // generic structures: one roll per region
  const RSZ = 80;
  for (let ry = 0; ry < MH / RSZ; ry++) for (let rx = 0; rx < MW / RSZ; rx++) {
    if (!R.chance(0.7)) continue;
    for (let tries = 0; tries < 30; tries++) {
      const x = rx * RSZ + R.i(RSZ), y = ry * RSZ + R.i(RSZ);
      if (!inMap(x, y) || dist(x, y, cx, cy) < 45) continue;
      const pool = REGION_POOL[bio[idx(x, y)]]; if (!pool) continue;
      const key = R.pick(pool), D = GENERIC[key], X = x - (D.w >> 1), Y = y - (D.h >> 1);
      if (W.pois.some(p => dist(p.x + p.w / 2, p.y + p.h / 2, x, y) < 36)) continue;
      if (!areaFree(X, Y, D.w, D.h, true)) continue;
      const P = { id: W.pois.length, key, name: D.name, x: X, y: Y, w: D.w, h: D.h, generic: true };
      buildLandmark(P, false); W.pois.push(P); reserve(X, Y, D.w, D.h, 2);
      break;
    }
  }

  // town buildings along the streets
  const typeBag = ['house', 'house', 'house', 'house', 'store', 'store', 'garage', 'warehouse', 'clinic', 'police', 'office', 'apartment'];
  for (const tw of W.towns) {
    const want = Math.round(tw.r * tw.r * 0.034);
    let built = 0;
    for (let tries = 0; tries < want * 60 && built < want; tries++) {
      const a = R.r(0, TAU), d = Math.sqrt(R.f()) * tw.r, rx = Math.round(tw.x + Math.cos(a) * d), ry = Math.round(tw.y + Math.sin(a) * d);
      if (!inMap(rx, ry) || tile[idx(rx, ry)] !== T.ROAD) continue;
      let hl = 0, vl = 0;
      for (let k = 1; k <= 4; k++) { if (get(rx + k, ry) === T.ROAD) hl++; if (get(rx - k, ry) === T.ROAD) hl++; if (get(rx, ry + k) === T.ROAD) vl++; if (get(rx, ry - k) === T.ROAD) vl++; }
      if (hl === vl) continue;
      const horiz = hl > vl;
      const type = R.pick(typeBag), big = type === 'warehouse' || type === 'store' || type === 'police' || type === 'apartment';
      const w = big ? 10 + R.i(4) : 7 + R.i(3), h = big ? 8 + R.i(3) : 6 + R.i(2);
      let x, y, side;
      if (horiz) {
        let top = ry, bot = ry; while (get(rx, top - 1) === T.ROAD) top--; while (get(rx, bot + 1) === T.ROAD) bot++;
        const north = R.chance(0.5);
        x = rx - (w >> 1); y = north ? top - 2 - h : bot + 2; side = north ? 'S' : 'N';
      } else {
        let lf = rx, rt = rx; while (get(lf - 1, ry) === T.ROAD) lf--; while (get(rt + 1, ry) === T.ROAD) rt++;
        const west = R.chance(0.5);
        y = ry - (h >> 1); x = west ? lf - 2 - w : rt + 2; side = west ? 'E' : 'W';
      }
      if (!areaFree(x - 1, y - 1, w + 2, h + 2, false)) continue;
      buildHouse(x, y, w, h, type, side);
      built++;
    }
  }
  for (const need of ['police', 'clinic', 'garage']) {
    if (W.buildings.some(b => b.type === need)) continue;
    const s = ringSpot(12, 10, 20, 90, false); if (s) buildHouse(s.x + 1, s.y + 1, 10, 8, need, R.pick(['N', 'S', 'E', 'W']));
  }

  // dirt tracks from every site to the road network
  const trail = (x0, y0) => {
    let best = null, bd = 1e9;
    for (const tw of W.towns) { const d = dist(tw.x, tw.y, x0, y0); if (d < bd) { bd = d; best = tw; } }
    if (!best) return;
    let x = x0, y = y0; const hFirst = R.chance(0.5);
    const step = () => { const i = idx(x, y), t = tile[i]; if (t === T.ROAD || t === T.WALK) return true; if (!res[i] && (SOFT[t] || t === T.WATER || t === T.TREE || t === T.ROCK)) { tile[i] = T.DIRT; if (inMap(x + 1, y) && !res[i + 1] && SOFT[tile[i + 1]]) tile[i + 1] = T.DIRT; } return false; };
    for (let n = 0; n < 900; n++) {
      if (!inMap(x, y) || step()) return;
      const dx = Math.sign(best.x - x), dy = Math.sign(best.y - y);
      if (!dx && !dy) return;
      if ((hFirst && dx) || !dy) x += dx; else y += dy;
    }
  };
  for (const v of W.villages) trail(v.x + (v.w >> 1), v.y + v.h + 1);
  for (const c of W.camps) trail(c.x + (c.w >> 1), c.y + c.h + 1);
  for (const P of W.pois) trail(P.x + (P.w >> 1), P.y + P.h + 1);

  // farm fields and paddies
  for (let y = 2; y < MH - 2; y++) for (let x = 2; x < MW - 2; x++) {
    const i = idx(x, y); if (bio[i] !== BIO.FARM || res[i] || !SOFT[tile[i]]) continue;
    const px = x % 14, py = y % 11; if (px >= 12 || py >= 9) continue;
    const kind = hash2(Math.floor(x / 14), Math.floor(y / 11) + 999);
    if (kind < 0.4) tile[i] = T.PADDY; else if (kind < 0.75) tile[i] = (px & 1) ? T.CROP : T.DIRT;
  }
  // ruins in the wasteland and city outskirts
  for (let k = 0, tries = 0; k < 260 && tries < 8000; tries++) {
    const x = 4 + R.i(MW - 8), y = 4 + R.i(MH - 8), b = bio[idx(x, y)];
    if (b !== BIO.WASTE && !(b === BIO.CITY && R.chance(0.3))) continue;
    const len = 3 + R.i(5), hz = R.chance(0.5);
    let ok = true; for (let n = -1; n <= len; n++) { const xx = hz ? x + n : x, yy = hz ? y : y + n; if (!inMap(xx, yy) || res[idx(xx, yy)] || !SOFT[tile[idx(xx, yy)]]) ok = false; }
    if (!ok) continue;
    for (let n = 0; n < len; n++) if (R.chance(0.8)) set(hz ? x + n : x, hz ? y : y + n, T.RUIN);
    if (R.chance(0.6)) for (let n = 1; n < 3; n++) set(hz ? x : x + n, hz ? y + n : y, T.RUIN);
    for (let n = 0; n < 6; n++) { const xx = x + R.i(7) - 3, yy = y + R.i(7) - 3; if (inMap(xx, yy) && !res[idx(xx, yy)] && SOFT[tile[idx(xx, yy)]]) set(xx, yy, T.RUBBLE); }
    k++;
  }

  // cars on roads (2 cells, lootable)
  for (let k = 0, tries = 0; k < 700 && tries < 40000; tries++) {
    const x = 2 + R.i(MW - 4), y = 2 + R.i(MH - 4);
    if (tile[idx(x, y)] !== T.ROAD || res[idx(x, y)]) continue;
    const hz = get(x - 2, y) === T.ROAD && get(x + 2, y) === T.ROAD && get(x, y - 2) !== T.ROAD;
    const x2 = hz ? x + 1 : x, y2 = hz ? y : y + 1;
    if (get(x2, y2) !== T.ROAD || W.contAt[idx(x2, y2)] || W.contAt[idx(x, y)]) continue;
    if (dist(x, y, cx, cy) < 20) continue;
    const c = addCont('car', x, y, -1, [idx(x, y), idx(x2, y2)]);
    if (c) { c.x = (x + x2) / 2 + 0.5; c.y = (y + y2) / 2 + 0.5; c.horiz = hz; c.color = R.pick(['#7a2f2f', '#2f4a7a', '#4a6a3a', '#8a8a8a', '#d0c080', '#3a3a3a', '#e8e8e8']); k++; }
  }

  for (const c of W.conts) if (c.kind === 'car') c.drive = hash2(c.id, 4242) < 0.4; // some still run
  // vegetation and rocks by biome
  const dens = valueNoise(R, 46);
  for (let y = 1; y < MH - 1; y++) for (let x = 1; x < MW - 1; x++) {
    const i = idx(x, y), t = tile[i];
    if (res[i] || !SOFT[t]) continue;
    const q = R.f(), dn = dens(x / MW, y / MH);
    let nt = -1;
    switch (bio[i]) {
      case BIO.FOREST: nt = q < 0.05 + dn * 0.32 ? T.TREE : q < 0.09 + dn * 0.32 ? T.BUSH : -1; break;
      case BIO.PLAINS: nt = q < 0.01 + (dn > 0.64 ? 0.18 : 0) ? T.TREE : q < 0.035 ? T.BUSH : q < 0.038 ? T.ROCK : -1; break;
      case BIO.FARM: nt = q < 0.006 ? T.TREE : q < 0.012 ? T.BUSH : -1; break;
      case BIO.SWAMP: nt = q < 0.05 ? T.TREE : q < 0.09 ? T.DEADTREE : q < 0.17 ? T.BUSH : -1; break;
      case BIO.WASTE: nt = q < 0.02 ? T.DEADTREE : q < 0.05 ? T.RUBBLE : q < 0.054 ? T.ROCK : -1; break;
      case BIO.MOUNTAIN: nt = q < 0.07 ? T.ROCK : q < 0.15 ? T.TREE : q < 0.17 ? T.BUSH : -1; break;
      case BIO.BEACH: nt = q < 0.004 ? T.ROCK : -1; break;
      case BIO.CITY: nt = q < 0.006 ? T.TREE : q < 0.01 ? T.BUSH : q < 0.016 ? T.RUBBLE : -1; break;
    }
    if (nt >= 0) tile[i] = nt;
  }
  // crates of supplies lying around outside
  for (let k = 0, tries = 0; k < 520 && tries < 20000; tries++) {
    const x = 3 + R.i(MW - 6), y = 3 + R.i(MH - 6), t = get(x, y);
    if (!SOFT[t] || res[idx(x, y)] || dist(x, y, cx, cy) < 20) continue;
    if (addCont(R.chance(0.3) ? 'ammobox' : 'crate', x, y, -1)) k++;
  }
  rebuildMoveGrid();
  return W;
}
const hash2 = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// a free cell on a ring around (x, y): used for waves, raids and ambient spawning
function ringCell(R, x, y, rmin, rmax, a0, spread, team = 'zombie') {
  for (let k = 0; k < 40; k++) {
    const a = a0 === undefined ? R.r(0, TAU) : a0 + R.r(-spread, spread), d = R.r(rmin, rmax);
    const px = Math.floor(x + Math.cos(a) * d), py = Math.floor(y + Math.sin(a) * d);
    if (!inMap(px, py)) continue;
    const i = idx(px, py);
    if (cellBlocked(i, team) || W.tile[i] === T.WATER) continue;
    return { x: px + 0.5, y: py + 0.5, i };
  }
  return null;
}
const biomeAt = (x, y) => { const cx = Math.floor(x), cy = Math.floor(y); return inMap(cx, cy) ? W.biome[idx(cx, cy)] : BIO.OCEAN; };

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
const heapC = new Int32Array(1 << 21), heapK = new Int32Array(1 << 21);
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
