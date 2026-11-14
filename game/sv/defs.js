'use strict';
// Cell Siege: Nightfall — data tables. Units: tiles and seconds (sim runs at 50 fps).

const TILE = 32, FPS = 50, DT = 1 / FPS;
const MW = 1024, MH = 1024; // world border (an island in the sea), generated from the seed
const TAU = Math.PI * 2;

// ── Tiles ──────────────────────────────────────────────────────────────────
const T = { GRASS: 0, DIRT: 1, ROAD: 2, WALK: 3, FLOOR: 4, WALL: 5, TREE: 6, WATER: 7, CONCRETE: 8,
            STUMP: 9, ROCK: 10, FENCE: 11, DOOR: 12, SAND: 13, VFLOOR: 14, TENT: 15, CAMPDIRT: 16, CROP: 17, PAD: 18, GRAVE: 19,
            MUD: 20, ASH: 21, DEADTREE: 22, PADDY: 23, BUSH: 24, GRAVEL: 25, RUBBLE: 26, RUIN: 27 };
const TILE_SOLID = new Uint8Array(32), TILE_OPAQUE = new Uint8Array(32);
for (const t of [T.WALL, T.TREE, T.WATER, T.ROCK, T.FENCE, T.TENT, T.GRAVE, T.DEADTREE, T.RUIN]) TILE_SOLID[t] = 1;
for (const t of [T.WALL, T.TREE, T.ROCK, T.TENT, T.BUSH, T.RUIN]) TILE_OPAQUE[t] = 1; // bushes hide you but can be walked through
// ground that slows you down
const TILE_SLOW = new Float32Array(32).fill(1);
TILE_SLOW[T.MUD] = 0.7; TILE_SLOW[T.PADDY] = 0.65; TILE_SLOW[T.BUSH] = 0.75; TILE_SLOW[T.SAND] = 0.9; TILE_SLOW[T.RUBBLE] = 0.85;

// ── Biomes (Minecraft-style: chosen from elevation / moisture / heat noise) ─────
const BIO = { PLAINS: 0, FOREST: 1, SWAMP: 2, WASTE: 3, FARM: 4, MOUNTAIN: 5, BEACH: 6, OCEAN: 7, CITY: 8 };
const BIOME_NAMES = ['평원', '숲', '늪지대', '잿빛 황무지', '농경지', '바위 산악지대', '해안', '바다', '시가지'];
const BIOME_MOBS = {
  [BIO.PLAINS]:   [['walker', 5], ['runner', 2, 2], ['crawler', 1], ['hound', 1, 3]],
  [BIO.FOREST]:   [['walker', 3], ['hound', 2, 2], ['stalker', 1, 3], ['crawler', 2]],
  [BIO.SWAMP]:    [['toxic', 3, 2], ['crawler', 3], ['walker', 2], ['bloater', 1, 3]],
  [BIO.WASTE]:    [['spitter', 2, 2], ['brute', 1, 3], ['walker', 3], ['runner', 2], ['toxic', 1, 2]],
  [BIO.FARM]:     [['walker', 5], ['runner', 1, 2], ['hound', 1, 3]],
  [BIO.MOUNTAIN]: [['hound', 2], ['walker', 2], ['stalker', 1, 4], ['brute', 1, 5]],
  [BIO.BEACH]:    [['walker', 3], ['crawler', 2], ['bloater', 1, 2]],
  [BIO.CITY]:     [['walker', 6], ['runner', 2, 2], ['crawler', 2], ['spitter', 1, 2], ['riot', 1, 3], ['screamer', 1, 4], ['stalker', 1, 5]],
};

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
  walker:   { name: '워커',     hp: 105,  speed: 1.3, dmg: 12, atk: 1.1, reach: 0.95, r: 0.36, body: '#5f8a4b', head: '#8fb070', minNight: 1, w: 10, cash: [1, 3] },
  crawler:  { name: '크롤러',   hp: 50,  speed: 2.2, dmg: 7,  atk: 0.8, reach: 0.8,  r: 0.3,  body: '#6a6f4a', head: '#9a9d6a', minNight: 1, w: 3,  cash: [0, 2], low: true },
  runner:   { name: '러너',     hp: 70,  speed: 3.4, dmg: 8,  atk: 0.7, reach: 0.9,  r: 0.33, body: '#8a5a4a', head: '#b98a6a', minNight: 2, w: 5,  cash: [1, 4] },
  spitter:  { name: '스피터',   hp: 90,  speed: 1.2, dmg: 10,  atk: 1.2, reach: 0.9,  r: 0.36, body: '#4f7a7a', head: '#9fd06a', minNight: 2, w: 3,  cash: [2, 5],
              spit: { range: 6.5, rate: 2.4, dmg: 12, speed: 7 } },
  brute:    { name: '브루트',   hp: 720, speed: 1.4, dmg: 41, atk: 1.6, reach: 1.2,  r: 0.58, body: '#5a4a6a', head: '#8a7a9a', minNight: 3, w: 2,  cash: [8, 20], structMul: 3, heavy: true },
  bloater:  { name: '블로터',   hp: 140,  speed: 1.0, dmg: 0,  atk: 1,   reach: 1.0,  r: 0.5,  body: '#8a8a3a', head: '#c0c060', minNight: 4, w: 2,  cash: [3, 8],
              explode: { dmg: 80, r: 2.5 } },
  screamer: { name: '스크리머', hp: 105,  speed: 1.9, dmg: 10,  atk: 1,   reach: 0.9,  r: 0.34, body: '#7a7a8a', head: '#d0d0e0', minNight: 5, w: 1,  cash: [5, 10], scream: true },
  hound:    { name: '좀비견',   hp: 65,  speed: 4.3, dmg: 11,  atk: 0.6, reach: 0.85, r: 0.3,  body: '#5a4a3a', head: '#7a6a5a', minNight: 3, w: 4,  cash: [0, 3], dog: true },
  riot:     { name: '진압대 좀비', hp: 390, speed: 1.25, dmg: 19, atk: 1.2, reach: 1.0, r: 0.42, body: '#2a3440', head: '#8fa070', minNight: 4, w: 2, cash: [4, 10], shield: true, heavy: true },
  toxic:    { name: '독성 좀비', hp: 165, speed: 1.4, dmg: 12, atk: 1.1, reach: 0.95, r: 0.4,  body: '#4a6a2a', head: '#b0e040', minNight: 5, w: 2,  cash: [3, 7], gas: { r: 2.4, t: 5, dps: 14 } },
  stalker:  { name: '추적자',   hp: 140,  speed: 2.6, dmg: 22, atk: 0.9, reach: 1.0,  r: 0.34, body: '#3a3a44', head: '#6a6a7a', minNight: 6, w: 2,  cash: [5, 12], stealth: true, lunge: true },
  fiend:    { name: '피의 악마', hp: 2700, speed: 1.7, dmg: 48, atk: 1.4, reach: 1.3, r: 0.62, body: '#9a2f2a', head: '#5a1410', minNight: 99, w: 0, cash: [80, 150],
              fire: { range: 8, rate: 1.8, dmg: 35, speed: 6 }, boss: true, heavy: true, por: 'boss_fiend' },
  broodmother: { name: '산란체', hp: 3900, speed: 0.9, dmg: 36, atk: 1.5, reach: 1.4, r: 0.75, body: '#c8b8a0', head: '#a08878', minNight: 99, w: 0, cash: [100, 160],
              spit: { range: 7, rate: 2.0, dmg: 16, speed: 7 }, brood: true, boss: true, heavy: true, por: 'boss_broodmother' },
  goliath:  { name: '골리앗',   hp: 5100, speed: 1.5, dmg: 58, atk: 1.6, reach: 1.5, r: 0.8,  body: '#d07a2a', head: '#8a6a5a', minNight: 99, w: 0, cash: [120, 200],
              charge: true, structMul: 6, boss: true, heavy: true, por: 'boss_goliath' },
  x13:      { name: '실험체 X-13', hp: 3600, speed: 2.4, dmg: 41, atk: 0.9, reach: 1.2, r: 0.5, body: '#7a8a90', head: '#a0b8c0', minNight: 99, w: 0, cash: [150, 220],
              spit: { range: 8, rate: 1.6, dmg: 20, speed: 9 }, blink: true, boss: true, heavy: true, por: 'boss_x13' },
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
  // factions
  soldier:        { name: '잔존군 병사',   team: 'military', hp: 170, speed: 2.6, wpn: 'rifle',   body: '#4a5a3a', head: '#d8b088', hat: '#3a4a2a', acc: 2.0, armor: 0.75 },
  soldier_heavy:  { name: '잔존군 중화기병', team: 'military', hp: 260, speed: 2.2, wpn: 'shotgun', body: '#3a4430', head: '#d8b088', hat: '#2a3020', acc: 1.6, armor: 0.6 },
  yoon:           { name: '윤태건 중사',   team: 'military', hp: 400, speed: 2.6, wpn: 'rifle',   body: '#4a5a3a', head: '#d8b088', hat: '#5a6a3a', acc: 2.2, armor: 0.6, shop: true, npc: 'sgt_yoon' },
  cultist:        { name: '교단 광신도',   team: 'cult',     hp: 85,  speed: 3.1, wpn: 'machete', body: '#7a1a1a', head: '#d8c0a8', hat: '#5a0a0a', acc: 1 },
  zealot:         { name: '교단 방화범',   team: 'cult',     hp: 95,  speed: 2.6, wpn: 'pistol',  body: '#8a2a1a', head: '#d8c0a8', hat: '#3a0a0a', acc: 1.2, molotov: true },
  cult_priest:    { name: '붉은 사제 마르코', team: 'cult',  hp: 900, speed: 2.4, wpn: 'smg',     body: '#9a1010', head: '#e8d8c8', hat: '#600', acc: 1.6, boss: true, molotov: true, por: 'por_priest' },
  elder:          { name: '마을 대표',     team: 'village',  hp: 120, speed: 2.2, wpn: null,      body: '#6a6a50', head: '#e0b890', hat: '#4a4a3a', acc: 1, coward: true },
  lost:           { name: '실종자',        team: 'player',   hp: 90,  speed: 3.0, wpn: null,      body: '#5a7a9a', head: '#e8c4a0', hat: null, acc: 1, coward: true },
  dr_han:         { name: '한서진 박사',   team: 'player',   hp: 160, speed: 2.8, wpn: 'pistol',  body: '#d8d8d0', head: '#e8c4a0', hat: null, acc: 1.4, npc: 'dr_han' },
};
const FACTION_NAMES = { bandit: '약탈단', village: '마을', merchant: '상인', military: '잔존군', cult: '붉은 새벽 교단', zombie: '좀비', player: '아군' };
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
  campfire:   { name: '모닥불 거점', hp: 200, cost: { wood: 12, scrap: 2 }, block: false, key: '9', outpost: true },
};
const STRUCT_ORDER = ['wall_wood', 'wall_metal', 'door', 'spikes', 'turret', 'light', 'barrel', 'mine', 'campfire'];
const OUTPOST_RADIUS = 7; // you can build around any campfire, anywhere in the world
const BUILD_RADIUS = 18; // tiles from the core

// ── Items / shop ────────────────────────────────────────────────────────────
const ITEMS = {
  cash: { name: '현금' }, wood: { name: '목재' }, scrap: { name: '고철' }, food: { name: '식량' },
  meds: { name: '의약품' }, grenade: { name: '수류탄' }, mine: { name: '지뢰' },
  bandage: { name: '붕대' }, armor: { name: '방탄조끼' }, molotov: { name: '화염병' }, adrenaline: { name: '아드레날린' },
  fuel: { name: '연료' }, parts: { name: '전자부품' }, chem: { name: '화학약품' },
  gold: { name: '금괴' }, watch: { name: '고급 시계' }, jewel: { name: '보석 목걸이' },
  keycard: { name: '연구소 출입카드', quest: true }, radio_part: { name: '무전기 부품', quest: true }, sample: { name: 'X-13 조직 샘플', quest: true },
  flare: { name: '신호탄', quest: true },
};
// icon key in the generated item atlas
function itemIcon(id) {
  if (id.startsWith('mag:')) return 'mag_' + id.slice(4);
  if (id.startsWith('wpn:')) return 'wpn_' + id.slice(4);
  return id;
}
function itemName(id) {
  if (id.startsWith('mag:')) return WEAPONS[id.slice(4)].name + ' 탄창';
  if (id.startsWith('wpn:')) return WEAPONS[id.slice(4)].name;
  return ITEMS[id].name;
}
// buy price; sell price = half (resources only)
const PRICES = { wood: 3, scrap: 5, food: 12, meds: 30, grenade: 35, mine: 40, bandage: 12, armor: 160, molotov: 22, adrenaline: 45,
                 fuel: 18, parts: 26, chem: 20, gold: 120, watch: 50, jewel: 90 };
function priceOf(id) {
  if (id.startsWith('mag:')) return WEAPONS[id.slice(4)].magPrice;
  if (id.startsWith('wpn:')) return WEAPONS[id.slice(4)].price;
  return PRICES[id];
}
const SELLABLE = ['wood', 'scrap', 'food', 'meds', 'fuel', 'parts', 'chem', 'gold', 'watch', 'jewel'];
function makeStock(kind, rnd) {
  const s = { food: 4 + rnd.i(5), meds: 2 + rnd.i(3), grenade: 2 + rnd.i(3), mine: 1 + rnd.i(3), wood: 20, scrap: 15,
              bandage: 3 + rnd.i(4), molotov: 1 + rnd.i(3), chem: 2 + rnd.i(3), parts: 1 + rnd.i(3), fuel: 2 + rnd.i(3), armor: rnd.i(2), adrenaline: rnd.i(3),
              'mag:pistol': 6, 'mag:smg': 4, 'mag:shotgun': 4, 'mag:rifle': 3 + rnd.i(2), 'mag:sniper': 2, 'mag:launcher': 1 + rnd.i(2) };
  if (kind === 'military') return { 'mag:rifle': 8, 'mag:sniper': 4, 'mag:launcher': 3, grenade: 6, armor: 2, meds: 4, bandage: 6, adrenaline: 3, mine: 4, 'wpn:sniper': 1, 'wpn:launcher': 1, cash: 600 };
  if (kind === 'merchant') { s['wpn:smg'] = 1; s['wpn:shotgun'] = 1; s['wpn:rifle'] = 1; }
  else { s['wpn:sniper'] = 1; s['wpn:launcher'] = 1; s['wpn:rifle'] = 1; }
  s.cash = 200 + rnd.i(300); // what you take if you kill them
  return s;
}

// ── Containers / loot ──────────────────────────────────────────────────────
// [item, min, max, weight]
const CONTAINERS = {
  cabinet:  { name: '서랍장',   color: '#7a5a3a', time: 1.0, loot: [['cash', 5, 25, 4], ['food', 1, 2, 3], ['meds', 1, 1, 1], ['scrap', 1, 3, 2], ['mag:pistol', 1, 1, 2], ['bandage', 1, 2, 2], ['watch', 1, 1, 1], ['jewel', 1, 1, 1]] },
  fridge:   { name: '냉장고',   color: '#c8ccd0', time: 0.8, loot: [['food', 1, 4, 8], ['meds', 1, 1, 1]] },
  shelf:    { name: '선반',     color: '#8a6a4a', time: 1.0, loot: [['wood', 2, 5, 3], ['scrap', 2, 5, 3], ['food', 1, 2, 2], ['mag:smg', 1, 1, 1]] },
  locker:   { name: '무기 보관함', color: '#4a5a6a', time: 1.6, loot: [['mag:pistol', 1, 2, 3], ['mag:smg', 1, 2, 2], ['mag:shotgun', 1, 2, 2], ['mag:rifle', 1, 1, 2], ['grenade', 1, 2, 2], ['wpn:smg', 1, 1, 1], ['wpn:shotgun', 1, 1, 1]] },
  medcab:   { name: '약품함',   color: '#e8e8e8', time: 1.0, loot: [['meds', 1, 3, 6], ['bandage', 1, 3, 5], ['chem', 1, 2, 2], ['adrenaline', 1, 1, 1]] },
  crate:    { name: '나무 상자', color: '#9a7a4a', time: 1.2, loot: [['wood', 4, 10, 4], ['scrap', 3, 8, 4], ['mine', 1, 1, 1], ['chem', 1, 1, 1], ['molotov', 1, 2, 1]] },
  car:      { name: '차량',     color: '#5a6a8a', time: 1.8, loot: [['scrap', 3, 9, 6], ['cash', 0, 20, 2], ['food', 1, 1, 1], ['grenade', 1, 1, 1], ['fuel', 1, 2, 3], ['parts', 1, 1, 2]] },
  safe:     { name: '금고',     color: '#3a3a3a', time: 2.5, loot: [['cash', 40, 140, 6], ['grenade', 1, 2, 1], ['mag:sniper', 1, 1, 1], ['gold', 1, 1, 3], ['jewel', 1, 1, 2], ['watch', 1, 1, 2]] },
  ammobox:  { name: '탄약 상자', color: '#4a5a3a', time: 1.4, loot: [['mag:rifle', 1, 2, 3], ['mag:shotgun', 1, 2, 3], ['mag:smg', 1, 2, 3], ['mag:launcher', 1, 1, 1], ['grenade', 1, 2, 2], ['wpn:rifle', 1, 1, 1]] },
  stash:    { name: '마을 창고', color: '#a08050', time: 2.0, loot: [['food', 2, 6, 4], ['meds', 1, 3, 3], ['cash', 20, 80, 3], ['scrap', 4, 10, 3], ['mag:rifle', 1, 2, 2], ['grenade', 1, 2, 1], ['jewel', 1, 1, 1]] },
  milcrate: { name: '군용 보급상자', color: '#4a5a32', time: 1.8, loot: [['mag:rifle', 1, 3, 4], ['mag:sniper', 1, 2, 2], ['mag:launcher', 1, 1, 1], ['grenade', 1, 3, 3], ['armor', 1, 1, 1], ['adrenaline', 1, 1, 2], ['mine', 1, 2, 2]] },
  labfridge: { name: '연구용 냉장고', color: '#d8e0e8', time: 1.2, loot: [['chem', 1, 3, 5], ['meds', 1, 2, 3], ['adrenaline', 1, 1, 2], ['parts', 1, 2, 2]] },
  altar:    { name: '교단 제단', color: '#6a1010', time: 1.6, loot: [['gold', 1, 1, 2], ['jewel', 1, 1, 2], ['watch', 1, 1, 2], ['cash', 30, 90, 3], ['molotov', 1, 3, 3]] },
  pump:     { name: '주유기', color: '#c83a2a', time: 2.2, loot: [['fuel', 1, 3, 1]] },
  barn:     { name: '헛간 곳간', color: '#8a4a2a', time: 1.4, loot: [['food', 2, 6, 6], ['wood', 3, 8, 3], ['fuel', 1, 1, 1]] },
  desk:     { name: '책상', color: '#6a5040', time: 0.9, loot: [['parts', 1, 2, 3], ['cash', 3, 15, 3], ['watch', 1, 1, 1], ['bandage', 1, 2, 2]] },
  toolbox:  { name: '공구함', color: '#b84a2a', time: 1.2, loot: [['parts', 1, 3, 4], ['scrap', 3, 8, 4], ['fuel', 1, 1, 1]] },
};

const BUILDING_TYPES = {
  house:     { name: '주택',     roof: '#7a3f34', floor: 'wood',  conts: ['cabinet', 'fridge', 'cabinet', 'shelf'] },
  store:     { name: '상점',     roof: '#3f5a7a', floor: 'tile',  conts: ['shelf', 'shelf', 'fridge', 'shelf', 'cabinet', 'safe'] },
  police:    { name: '경찰서',   roof: '#2f3a5a', floor: 'tile',  conts: ['locker', 'locker', 'cabinet', 'ammobox', 'safe'] },
  clinic:    { name: '병원',     roof: '#d8d8d8', floor: 'tile',  conts: ['medcab', 'medcab', 'medcab', 'cabinet', 'fridge'] },
  garage:    { name: '정비소',   roof: '#5a5a5a', floor: 'conc',  conts: ['shelf', 'toolbox', 'crate', 'toolbox', 'ammobox'] },
  warehouse: { name: '창고',     roof: '#6a5a3a', floor: 'conc',  conts: ['crate', 'crate', 'crate', 'crate', 'shelf', 'ammobox'] },
  office:    { name: '사무실',   roof: '#4a4f5a', floor: 'tile',  conts: ['desk', 'desk', 'cabinet', 'desk', 'safe'] },
  // landmark interiors
  hospital:  { name: '종합병원', roof: '#e0e0e0', floor: 'tile',  conts: ['medcab', 'medcab', 'medcab', 'medcab', 'labfridge', 'desk', 'medcab', 'cabinet', 'medcab', 'desk'] },
  lab:       { name: '한빛 생명공학 연구소', roof: '#3a4a5a', floor: 'tile', conts: ['labfridge', 'labfridge', 'desk', 'labfridge', 'toolbox', 'safe', 'desk', 'labfridge'] },
  barracks:  { name: '군 막사',   roof: '#4a5a3a', floor: 'conc',  conts: ['milcrate', 'milcrate', 'locker', 'milcrate', 'cabinet'] },
  church:    { name: '교회',     roof: '#5a2a2a', floor: 'wood',  conts: ['altar', 'altar', 'cabinet', 'altar'] },
  cellblock: { name: '교도소 감방동', roof: '#5a5a60', floor: 'conc', conts: ['locker', 'locker', 'cabinet', 'ammobox', 'milcrate', 'locker'] },
  school:    { name: '초등학교', roof: '#8a6a3a', floor: 'wood',  conts: ['desk', 'desk', 'desk', 'cabinet', 'fridge', 'medcab'] },
  station:   { name: '주유소',   roof: '#c83a2a', floor: 'tile',  conts: ['shelf', 'shelf', 'fridge', 'safe'] },
  farmhouse: { name: '농가',     roof: '#7a4a2a', floor: 'wood',  conts: ['barn', 'barn', 'fridge', 'cabinet'] },
  tower:     { name: '송신소',   roof: '#4a4a4a', floor: 'conc',  conts: ['toolbox', 'desk', 'toolbox'] },
  apartment: { name: '아파트',   roof: '#8a8a84', floor: 'tile',  conts: ['cabinet', 'fridge', 'cabinet', 'desk', 'medcab', 'cabinet', 'safe', 'fridge'] },
  mart:      { name: '대형마트', roof: '#2f6a5a', floor: 'tile',  conts: ['shelf', 'shelf', 'shelf', 'fridge', 'fridge', 'shelf', 'shelf', 'safe', 'medcab', 'shelf', 'fridge', 'shelf'] },
  bunker:    { name: '비밀 벙커', roof: '#3a3f38', floor: 'conc', conts: ['milcrate', 'milcrate', 'ammobox', 'locker', 'medcab', 'safe'] },
  cabin:     { name: '산장',     roof: '#5a3a24', floor: 'wood',  conts: ['cabinet', 'fridge', 'crate', 'toolbox'] },
};
// workbench crafting
const RECIPES = [
  { id: 'grenade', n: 1, cost: { chem: 1, scrap: 4 } },
  { id: 'molotov', n: 2, cost: { fuel: 1, scrap: 1 } },
  { id: 'bandage', n: 3, cost: { meds: 1 } },
  { id: 'adrenaline', n: 1, cost: { chem: 2, meds: 1 } },
  { id: 'mine', n: 1, cost: { chem: 1, scrap: 3, parts: 1 } },
  { id: 'armor', n: 1, cost: { scrap: 25, parts: 2 } },
];

// ── Day clock: minutes of the day per tick ──
const MIN_PER_TICK = 1440 / (9 * 60 * FPS); // a full day is 9 real minutes (the world is big)
const DAWN = 6 * 60, DUSK = 19 * 60, NIGHT = 20 * 60, LATE = 5 * 60;
