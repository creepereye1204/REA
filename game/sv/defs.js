'use strict';
// Cell Siege: Nightfall — data tables. Units: tiles and seconds (sim runs at 50 fps).

const TILE = 32, FPS = 50, DT = 1 / FPS;
const MW = 192, MH = 160;
const TAU = Math.PI * 2;

// ── Tiles ──────────────────────────────────────────────────────────────────
const T = { GRASS: 0, DIRT: 1, ROAD: 2, WALK: 3, FLOOR: 4, WALL: 5, TREE: 6, WATER: 7, CONCRETE: 8,
            STUMP: 9, ROCK: 10, FENCE: 11, DOOR: 12, SAND: 13, VFLOOR: 14, TENT: 15, CAMPDIRT: 16 };
const TILE_SOLID = new Uint8Array(32), TILE_OPAQUE = new Uint8Array(32);
for (const t of [T.WALL, T.TREE, T.WATER, T.ROCK, T.FENCE, T.TENT]) TILE_SOLID[t] = 1;
for (const t of [T.WALL, T.TREE, T.ROCK, T.TENT]) TILE_OPAQUE[t] = 1;

// ── Weapons ────────────────────────────────────────────────────────────────
// rate/reload in seconds, range in tiles, spread in radians, noise = radius zombies hear it
const WEAPONS = {
  machete:  { key: '1', name: '마체테',     melee: true, dmg: 42, rate: 0.42, range: 1.45, arc: 1.9, noise: 1.5, price: 0 },
  pistol:   { key: '2', name: '권총',       dmg: 24, rate: 0.2,  mag: 12, reload: 1.1, spread: 0.04, range: 14, noise: 9,  price: 0,   magPrice: 14 },
  smg:      { key: '3', name: '기관단총',   dmg: 15, rate: 0.075, mag: 30, reload: 1.6, spread: 0.11, range: 12, auto: true, noise: 10, price: 240, magPrice: 22 },
  shotgun:  { key: '4', name: '산탄총',     dmg: 13, pellets: 8, rate: 0.72, mag: 6, reload: 2.0, spread: 0.3, range: 8, noise: 13, price: 280, magPrice: 22 },
  rifle:    { key: '5', name: '돌격소총',   dmg: 30, rate: 0.1,  mag: 30, reload: 1.9, spread: 0.05, range: 18, auto: true, noise: 14, price: 480, magPrice: 38 },
  sniper:   { key: '6', name: '저격소총',   dmg: 150, rate: 1.1, mag: 5, reload: 2.4, spread: 0.004, range: 30, pierce: 4, noise: 18, price: 560, magPrice: 42 },
  launcher: { key: '7', name: '로켓발사기', dmg: 190, rate: 1.0, mag: 3, reload: 2.6, spread: 0.02, range: 22, rocket: true, noise: 16, price: 850, magPrice: 85 },
};
const WEAPON_ORDER = ['machete', 'pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'launcher'];
const UPG_STATS = {
  dmg:    { name: '피해량',    per: 0.15 },   // ×(1+0.15·lvl)
  mag:    { name: '탄창 용량', per: 0.25 },   // ×(1+0.25·lvl)
  rate:   { name: '연사 속도', per: 0.09 },   // time ×(1−0.09·lvl)
  reload: { name: '재장전',    per: 0.12 },   // time ×(1−0.12·lvl)
};
const UPG_MAX = 5;
const upgCost = (wid, lvl) => {
  const tier = { machete: 1, pistol: 1, smg: 1.4, shotgun: 1.5, rifle: 2, sniper: 2.2, launcher: 3 }[wid];
  return { cash: Math.round(35 * (lvl + 1) * tier), scrap: Math.round(4 * (lvl + 1) * tier) };
};

// ── Zombies ────────────────────────────────────────────────────────────────
// speed tiles/s, atk seconds between hits, minNight: first night it shows up in waves
const MOBS = {
  walker:   { name: '워커',     hp: 70,  speed: 1.3, dmg: 10, atk: 1.1, reach: 0.95, r: 0.36, body: '#5f8a4b', head: '#8fb070', minNight: 1, w: 10, cash: [1, 3] },
  crawler:  { name: '크롤러',   hp: 35,  speed: 2.2, dmg: 6,  atk: 0.8, reach: 0.8,  r: 0.3,  body: '#6a6f4a', head: '#9a9d6a', minNight: 1, w: 3,  cash: [0, 2], low: true },
  runner:   { name: '러너',     hp: 45,  speed: 3.4, dmg: 7,  atk: 0.7, reach: 0.9,  r: 0.33, body: '#8a5a4a', head: '#b98a6a', minNight: 2, w: 5,  cash: [1, 4] },
  spitter:  { name: '스피터',   hp: 60,  speed: 1.2, dmg: 8,  atk: 1.2, reach: 0.9,  r: 0.36, body: '#4f7a7a', head: '#9fd06a', minNight: 2, w: 3,  cash: [2, 5],
              spit: { range: 6.5, rate: 2.4, dmg: 12, speed: 7 } },
  brute:    { name: '브루트',   hp: 480, speed: 1.4, dmg: 34, atk: 1.6, reach: 1.2,  r: 0.58, body: '#5a4a6a', head: '#8a7a9a', minNight: 3, w: 2,  cash: [8, 20], structMul: 3, heavy: true },
  bloater:  { name: '블로터',   hp: 95,  speed: 1.0, dmg: 0,  atk: 1,   reach: 1.0,  r: 0.5,  body: '#8a8a3a', head: '#c0c060', minNight: 4, w: 2,  cash: [3, 8],
              explode: { dmg: 80, r: 2.5 } },
  screamer: { name: '스크리머', hp: 70,  speed: 1.9, dmg: 8,  atk: 1,   reach: 0.9,  r: 0.34, body: '#7a7a8a', head: '#d0d0e0', minNight: 5, w: 1,  cash: [5, 10], scream: true },
  fiend:    { name: '피의 악마', hp: 1800, speed: 1.7, dmg: 40, atk: 1.4, reach: 1.3, r: 0.62, body: '#9a2f2a', head: '#5a1410', minNight: 99, w: 0, cash: [80, 150],
              fire: { range: 8, rate: 1.8, dmg: 35, speed: 6 }, boss: true, heavy: true },
};

// ── Humans (team: bandit | village | merchant | player) ─────────────────────
const HUMANS = {
  bandit_thug:    { name: '약탈자',        team: 'bandit',   hp: 95,  speed: 2.8, wpn: 'machete', body: '#5b3a2a', head: '#c99a74', hat: '#222', acc: 1 },
  bandit_gunner:  { name: '약탈자 총잡이', team: 'bandit',   hp: 90,  speed: 2.5, wpn: 'pistol',  body: '#5b3a2a', head: '#c99a74', hat: '#7a1a1a', acc: 1.6 },
  bandit_smg:     { name: '약탈자 돌격병', team: 'bandit',   hp: 100, speed: 2.5, wpn: 'smg',     body: '#3a3a2a', head: '#c99a74', hat: '#7a1a1a', acc: 1.8 },
  bandit_shotgun: { name: '약탈자 산탄병', team: 'bandit',   hp: 120, speed: 2.4, wpn: 'shotgun', body: '#4a2a2a', head: '#b98a64', hat: '#333', acc: 1.2 },
  bandit_sniper:  { name: '약탈자 저격수', team: 'bandit',   hp: 80,  speed: 2.3, wpn: 'sniper',  body: '#3a4a3a', head: '#c99a74', hat: '#3a4a3a', acc: 1.3, keepFar: true },
  bandit_boss:    { name: '약탈단 두목',   team: 'bandit',   hp: 420, speed: 2.4, wpn: 'rifle',   body: '#2a2a2a', head: '#b98a64', hat: '#aa8a2a', acc: 1.5, boss: true },
  villager:       { name: '주민',          team: 'village',  hp: 70,  speed: 2.5, wpn: null,      body: '#7a8aa0', head: '#e0b890', hat: null, acc: 1, coward: true },
  guard:          { name: '경비병',        team: 'village',  hp: 150, speed: 2.6, wpn: 'rifle',   body: '#3a5a7a', head: '#e0b890', hat: '#2a3a4a', acc: 1.6 },
  trader:         { name: '마을 상인',     team: 'village',  hp: 140, speed: 2.4, wpn: 'shotgun', body: '#8a6a2a', head: '#e0b890', hat: '#5a3a1a', acc: 1.3, shop: true },
  merchant:       { name: '떠돌이 상인',   team: 'merchant', hp: 180, speed: 2.6, wpn: 'shotgun', body: '#6a4a8a', head: '#e8c4a0', hat: '#3a2a5a', acc: 1.3, shop: true },
  survivor:       { name: '생존자',        team: 'player',   hp: 110, speed: 2.9, wpn: 'pistol',  body: '#4a7a4a', head: '#e8c4a0', hat: null, acc: 1.4 },
};
const SURVIVOR_NAMES = ['민준', '서연', '지호', '하은', '도윤', '수아', '예준', '지우', '시우', '하린', '주원', '윤서', '현우', '채원', '건우', '다은', '우진', '소율'];
const PERKS = {
  guard:     { name: '사수',     desc: '명중률·피해 +40%' },
  mechanic:  { name: '정비공',   desc: '낮에 기지 구조물 자동 수리' },
  medic:     { name: '의무병',   desc: '기지 근처 아군 체력 회복' },
  scavenger: { name: '수집가',   desc: '매일 아침 자원을 주워 옴' },
};

// ── Structures (build menu) ─────────────────────────────────────────────────
const STRUCTS = {
  wall_wood:  { name: '나무 벽',   hp: 260,  cost: { wood: 8 },                block: true, key: '1' },
  wall_metal: { name: '철판 벽',   hp: 800,  cost: { scrap: 8, wood: 2 },      block: true, key: '2' },
  door:       { name: '출입문',    hp: 420,  cost: { wood: 6, scrap: 4 },      block: true, door: true, key: '3' },
  spikes:     { name: '가시 함정', hp: 160,  cost: { wood: 4, scrap: 2 },      block: false, key: '4' },
  turret:     { name: '자동 포탑', hp: 320,  cost: { scrap: 22, cash: 60 },    block: true, key: '5', ammo: 160 },
  light:      { name: '조명등',    hp: 80,   cost: { scrap: 3 },               block: false, key: '6' },
  barrel:     { name: '폭발 드럼', hp: 1,    cost: { scrap: 5 },               block: true, key: '7' },
  mine:       { name: '지뢰',      hp: 1,    cost: { mine: 1 },                block: false, key: '8' },
};
const STRUCT_ORDER = ['wall_wood', 'wall_metal', 'door', 'spikes', 'turret', 'light', 'barrel', 'mine'];
const BUILD_RADIUS = 18; // tiles from the core

// ── Items / shop ────────────────────────────────────────────────────────────
const ITEMS = {
  cash: { name: '현금' }, wood: { name: '목재' }, scrap: { name: '고철' }, food: { name: '식량' },
  meds: { name: '의약품' }, grenade: { name: '수류탄' }, mine: { name: '지뢰' },
};
function itemName(id) {
  if (id.startsWith('mag:')) return WEAPONS[id.slice(4)].name + ' 탄창';
  if (id.startsWith('wpn:')) return WEAPONS[id.slice(4)].name;
  return ITEMS[id].name;
}
// buy price; sell price = half (resources only)
const PRICES = { wood: 3, scrap: 5, food: 12, meds: 30, grenade: 35, mine: 40 };
function priceOf(id) {
  if (id.startsWith('mag:')) return WEAPONS[id.slice(4)].magPrice;
  if (id.startsWith('wpn:')) return WEAPONS[id.slice(4)].price;
  return PRICES[id];
}
const SELLABLE = ['wood', 'scrap', 'food', 'meds'];
function makeStock(kind, rnd) {
  const s = { food: 4 + rnd.i(5), meds: 2 + rnd.i(3), grenade: 2 + rnd.i(3), mine: 1 + rnd.i(3), wood: 20, scrap: 15,
              'mag:pistol': 6, 'mag:smg': 4, 'mag:shotgun': 4, 'mag:rifle': 3 + rnd.i(2), 'mag:sniper': 2, 'mag:launcher': 1 + rnd.i(2) };
  if (kind === 'merchant') { s['wpn:smg'] = 1; s['wpn:shotgun'] = 1; s['wpn:rifle'] = 1; }
  else { s['wpn:sniper'] = 1; s['wpn:launcher'] = 1; s['wpn:rifle'] = 1; }
  s.cash = 200 + rnd.i(300); // what you take if you kill them
  return s;
}

// ── Containers / loot ──────────────────────────────────────────────────────
// [item, min, max, weight]
const CONTAINERS = {
  cabinet:  { name: '서랍장',   color: '#7a5a3a', time: 1.0, loot: [['cash', 5, 25, 4], ['food', 1, 2, 3], ['meds', 1, 1, 1], ['scrap', 1, 3, 2], ['mag:pistol', 1, 1, 2]] },
  fridge:   { name: '냉장고',   color: '#c8ccd0', time: 0.8, loot: [['food', 1, 4, 8], ['meds', 1, 1, 1]] },
  shelf:    { name: '선반',     color: '#8a6a4a', time: 1.0, loot: [['wood', 2, 5, 3], ['scrap', 2, 5, 3], ['food', 1, 2, 2], ['mag:smg', 1, 1, 1]] },
  locker:   { name: '무기 보관함', color: '#4a5a6a', time: 1.6, loot: [['mag:pistol', 1, 2, 3], ['mag:smg', 1, 2, 2], ['mag:shotgun', 1, 2, 2], ['mag:rifle', 1, 1, 2], ['grenade', 1, 2, 2], ['wpn:smg', 1, 1, 1], ['wpn:shotgun', 1, 1, 1]] },
  medcab:   { name: '약품함',   color: '#e8e8e8', time: 1.0, loot: [['meds', 1, 3, 6], ['food', 1, 1, 1]] },
  crate:    { name: '나무 상자', color: '#9a7a4a', time: 1.2, loot: [['wood', 4, 10, 4], ['scrap', 3, 8, 4], ['mine', 1, 1, 1]] },
  car:      { name: '차량',     color: '#5a6a8a', time: 1.8, loot: [['scrap', 3, 9, 6], ['cash', 0, 20, 2], ['food', 1, 1, 1], ['grenade', 1, 1, 1]] },
  safe:     { name: '금고',     color: '#3a3a3a', time: 2.5, loot: [['cash', 40, 140, 6], ['grenade', 1, 2, 1], ['mag:sniper', 1, 1, 1]] },
  ammobox:  { name: '탄약 상자', color: '#4a5a3a', time: 1.4, loot: [['mag:rifle', 1, 2, 3], ['mag:shotgun', 1, 2, 3], ['mag:smg', 1, 2, 3], ['mag:launcher', 1, 1, 1], ['grenade', 1, 2, 2], ['wpn:rifle', 1, 1, 1]] },
  stash:    { name: '마을 창고', color: '#a08050', time: 2.0, loot: [['food', 2, 6, 4], ['meds', 1, 3, 3], ['cash', 20, 80, 3], ['scrap', 4, 10, 3], ['mag:rifle', 1, 2, 2], ['grenade', 1, 2, 1]] },
};

const BUILDING_TYPES = {
  house:     { name: '주택',     roof: '#7a3f34', floor: 'wood',  conts: ['cabinet', 'fridge', 'cabinet', 'shelf'] },
  store:     { name: '상점',     roof: '#3f5a7a', floor: 'tile',  conts: ['shelf', 'shelf', 'fridge', 'shelf', 'cabinet', 'safe'] },
  police:    { name: '경찰서',   roof: '#2f3a5a', floor: 'tile',  conts: ['locker', 'locker', 'cabinet', 'ammobox', 'safe'] },
  clinic:    { name: '병원',     roof: '#d8d8d8', floor: 'tile',  conts: ['medcab', 'medcab', 'medcab', 'cabinet', 'fridge'] },
  garage:    { name: '정비소',   roof: '#5a5a5a', floor: 'conc',  conts: ['shelf', 'crate', 'crate', 'shelf', 'ammobox'] },
  warehouse: { name: '창고',     roof: '#6a5a3a', floor: 'conc',  conts: ['crate', 'crate', 'crate', 'crate', 'shelf', 'ammobox'] },
};

// ── Day clock: minutes of the day per tick. A full day is ~6.5 real minutes. ──
const MIN_PER_TICK = 1440 / (6.5 * 60 * FPS);
const DAWN = 6 * 60, DUSK = 19 * 60, NIGHT = 20 * 60, LATE = 5 * 60;
