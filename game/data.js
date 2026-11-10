'use strict';
// Gameplay tables ported 1:1 from the decompiled SWF (see ANALYSIS.md).
// Everything is in the original's units: cells and frames @ 50 fps.
// Visuals, names and map are this project's own.

const FPS = 50;
const INFINITE_AMMO = 999999; // CThing_Weapon.mInfinateAmmo

// ── Weapons (CThing_Weapon_* constructors) ────────────────────────────────
// rate: frames between shots (mFireRate). range: cells. trigger: 'press' | 'auto' | 'release'
const WEAPONS = {
  pistol:     { key: '1', name: 'Pistol',      kind: 'bullet',    dmg: 26,  rate: 8,  range: 8,  ammo: INFINITE_AMMO, trigger: 'press' },
  smg:        { key: '2', name: 'SMG',         kind: 'bullet',    dmg: 35,  rate: 4,  range: 8,  ammo: 100, trigger: 'auto' },
  shotgun:    { key: '3', name: 'Shotgun',     kind: 'shotgun',   dmg: 51,  rate: 12, range: 7,  ammo: 20,  trigger: 'press', wide: 0 },
  barrel:     { key: '4', name: 'Barrel',      kind: 'barrel',    dmg: 150, rate: 1,  range: 0,  ammo: 10,  trigger: 'press' },
  grenade:    { key: '5', name: 'Grenade',     kind: 'grenade',   dmg: 150, rate: 12, range: 6,  ammo: 20,  trigger: 'release' },
  fakewall:   { key: '6', name: 'Fake Wall',   kind: 'wall',      dmg: 100, rate: 1,  range: 0,  ammo: 5,   trigger: 'press' },
  mine:       { key: '7', name: 'Mine',        kind: 'mine',      dmg: 100, rate: 1,  range: 0,  ammo: 10,  trigger: 'press' },
  rocket:     { key: '8', name: 'Rocket',      kind: 'rocket',    dmg: 250, rate: 12, range: 0,  ammo: 20,  trigger: 'press' },
  chargepack: { key: '9', name: 'Charge Pack', kind: 'chargepack',dmg: 150, rate: 1,  range: 0,  ammo: 10,  trigger: 'press' },
  railgun:    { key: '0', name: 'Railgun',     kind: 'railgun',   dmg: 100, rate: 5,  range: 10, ammo: 15,  trigger: 'press' },
};
const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'barrel', 'grenade', 'fakewall', 'mine', 'rocket', 'chargepack', 'railgun'];

// ── Multiplier rewards (CUpgrades.InitLists → AddToMultipliers), complete table ──
// [multiplier, classID, prop]. classID: weapon id, 'obj_barrel' / 'obj_mine' / 'obj_chargepack', or 'player' (NW_ = new weapon)
const MULTIPLIER_REWARDS = [
  [3, 'pistol', 'FastFire'], [5, 'player', 'NW_smg'], [8, 'pistol', 'DoubleDamage'], [10, 'player', 'NW_shotgun'],
  [13, 'smg', 'RapidFire'], [15, 'player', 'NW_barrel'], [17, 'smg', 'DoubleAmmo'], [18, 'shotgun', 'FastFire'],
  [20, 'player', 'NW_grenade'], [21, 'shotgun', 'DoubleAmmo'], [23, 'smg', 'LongShot'], [26, 'barrel', 'DoubleAmmo'],
  [30, 'player', 'NW_fakewall'], [31, 'shotgun', 'WideShot'], [32, 'obj_barrel', 'BigBang'], [33, 'grenade', 'ClusterExplode'],
  [35, 'shotgun', 'LongShot'], [36, 'barrel', 'QuadAmmo'], [37, 'fakewall', 'DoubleAmmo'], [39, 'smg', 'QuadAmmo'],
  [40, 'player', 'NW_mine'], [41, 'shotgun', 'QuadAmmo'], [42, 'grenade', 'DoubleAmmo'], [43, 'shotgun', 'RapidFire'],
  [44, 'obj_barrel', 'BiggerBang'], [45, 'grenade', 'BigBang'], [47, 'obj_mine', 'ClusterExplode'], [48, 'smg', 'DoubleDamage'],
  [50, 'player', 'NW_rocket'], [51, 'shotgun', 'WiderShot'], [52, 'grenade', 'QuadAmmo'], [53, 'fakewall', 'QuadAmmo'],
  [54, 'mine', 'DoubleAmmo'], [55, 'player', 'NW_chargepack'], [56, 'shotgun', 'DoubleDamage'], [57, 'grenade', 'BiggerBang'],
  [58, 'obj_mine', 'BigBang'], [59, 'rocket', 'FastFire'], [61, 'smg', 'InfinateRange'], [62, 'obj_mine', 'BiggerBang'],
  [63, 'obj_chargepack', 'ClusterExplode'], [64, 'mine', 'QuadAmmo'], [66, 'rocket', 'DoubleAmmo'], [68, 'chargepack', 'DoubleAmmo'],
  [70, 'player', 'NW_railgun'], [72, 'rocket', 'BigBang'], [74, 'obj_chargepack', 'BigBang'], [76, 'chargepack', 'QuadAmmo'],
  [78, 'railgun', 'FastFire'], [80, 'railgun', 'DoubleAmmo'], [85, 'rocket', 'QuadAmmo'], [90, 'smg', 'QuadDamage'],
  [95, 'obj_chargepack', 'BiggerBang'], [100, 'railgun', 'RapidFire'], [105, 'rocket', 'BiggerBang'], [110, 'railgun', 'QuadAmmo'],
  [120, 'rocket', 'RapidFire'], [125, 'railgun', 'LongShot'],
];
const UPGRADE_LABEL = {
  FastFire: 'Fast Fire', RapidFire: 'Rapid Fire', DoubleDamage: 'Double Damage', QuadDamage: 'Quad Damage',
  DoubleAmmo: 'Double Ammo', QuadAmmo: 'Quad Ammo', LongShot: 'Long Shot', InfinateRange: 'Infinite Range',
  WideShot: 'Wide Shot', WiderShot: 'Wider Shot', BigBang: 'Big Bang', BiggerBang: 'Bigger Bang', ClusterExplode: 'Cluster Explode',
};
const OBJ_NAME = { obj_barrel: 'Barrel', obj_mine: 'Mine', obj_chargepack: 'Charge Pack' };

// ── Creatures (Process_Init) ──────────────────────────────────────────────
const CREATURES = {
  player: { life: 200, speed: 0.16, mass: 2, radius: 0.45 },
  zombie: { life: 100, speed: 0.02, mass: 1, radius: 0.45, damage: 50, score: 100 },
  devil:  { life: 1000, speed: 0.04, mass: 5, radius: 0.42, damage: 50, score: 1000, attackRange: 5, fireRate: 0, fireRateStart: 5 },
};

// ── Level table generator (CUpgrades.InitLists), ported loop ──────────────
function buildLevels() {
  const L = [];
  let r8 = 1 * FPS, r4 = 10, r5 = 10, r6 = 10 * FPS, r7 = 0, r9 = 0;
  for (let n = 1; n <= 100; n++) {
    const lv = {
      Zombie_SpawnRate: Math.floor(r8), Zombie_Count: Math.floor(r4), Zombie_TotalCount: Math.floor(r5),
      ZombieSpeedUp: Math.min(1 + n / 100 * 10, 5),
      Devil_SpawnRate: Math.floor(r6), Devil_Count: r7, Devil_TotalCount: r9,
      DevilSpeedUp: Math.min(1 + n / 100 * 10, 5),
    };
    L[n] = lv;
    r8 = Math.max(r8 - 1, 1); r4 = Math.min(r4 + 5, 60); r5 = r5 + 5;
    r7 = Math.min(r7 + 0.3, 5); r9 = r9 + 0.25; r6 = Math.max(r6 - 1, FPS);
  }
  return L;
}

// CUpgrades.GetTicks: multiplier window in frames
function getTicks(index) {
  if (index > 100) index = 100;
  index = 100 - (index - 1);
  return Math.pow(index, 2.5) / 100000 * (FPS * 3 - 3) + 3;
}

// CThing_Effect_Explosion: radius from damage
const explosionRange = dmg => 2 + Math.max(dmg - 100, 0) * 0.005;
