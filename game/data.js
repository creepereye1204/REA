'use strict';
// Game tuning tables.
// Mechanics mirror what was recovered from the analyzed SWF (see ANALYSIS.md),
// numbers and names are this project's own.

const FPS_REF = 50; // the analyzed game ran at 50 fps; frame-based formulas are converted with this

// ── Weapons ────────────────────────────────────────────────────────────────
// kind: 'ray' (hitscan bullet), 'spread', 'pierce', 'rocket', 'grenade', 'barrel', 'mine'
const WEAPONS = {
  pistol:  { key: 1, name: 'Pistol',   kind: 'ray',     dmg: 26,  rate: 0.16, range: 8,  ammo: Infinity, auto: false, color: '#ffe08a' },
  smg:     { key: 2, name: 'SMG',      kind: 'ray',     dmg: 30,  rate: 0.08, range: 8,  ammo: 120, auto: true,  color: '#ffd166' },
  shotgun: { key: 3, name: 'Shotgun',  kind: 'spread',  dmg: 50,  rate: 0.26, range: 7,  ammo: 25,  auto: false, color: '#ffb35c', wide: 0 },
  barrel:  { key: 4, name: 'Barrel',   kind: 'barrel',  dmg: 150, rate: 0.25, range: 1,  ammo: 8,   auto: false, radius: 2.2 },
  grenade: { key: 5, name: 'Grenade',  kind: 'grenade', dmg: 150, rate: 0.35, range: 6,  ammo: 15,  auto: false, radius: 2.2 },
  mine:    { key: 6, name: 'Mine',     kind: 'mine',    dmg: 130, rate: 0.3,  range: 0,  ammo: 10,  auto: false, radius: 2.0 },
  rocket:  { key: 7, name: 'Rocket',   kind: 'rocket',  dmg: 250, rate: 0.5,  range: 16, ammo: 12,  auto: false, radius: 2.5 },
  railgun: { key: 8, name: 'Railgun',  kind: 'pierce',  dmg: 120, rate: 0.6,  range: 14, ammo: 15,  auto: false, color: '#8fd3ff' },
};
const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'barrel', 'grenade', 'mine', 'rocket', 'railgun'];

// ── Combo-threshold unlocks ────────────────────────────────────────────────
// Reaching combo multiplier N fires every entry at N once per run.
// type 'unlock' gives a weapon; any other type is a weapon upgrade flag.
const COMBO_REWARDS = [
  [3,   'pistol',  'auto',        'Pistol+: Hair trigger'],
  [5,   'smg',     'unlock',      'NEW WEAPON: SMG  [2]'],
  [8,   'pistol',  'doubleDmg',   'Pistol+: Double damage'],
  [10,  'shotgun', 'unlock',      'NEW WEAPON: Shotgun  [3]'],
  [12,  'smg',     'doubleAmmo',  'SMG+: Double ammo'],
  [15,  'barrel',  'unlock',      'NEW WEAPON: Barrel  [4]'],
  [17,  'shotgun', 'fastFire',    'Shotgun+: Fast pump'],
  [20,  'smg',     'longShot',    'SMG+: Long range'],
  [22,  'grenade', 'unlock',      'NEW WEAPON: Grenade  [5]'],
  [25,  'shotgun', 'wide',        'Shotgun+: Wide spread'],
  [28,  'barrel',  'bigBang',     'Barrel+: Big bang'],
  [30,  'mine',    'unlock',      'NEW WEAPON: Mine  [6]'],
  [33,  'grenade', 'doubleAmmo',  'Grenade+: Double ammo'],
  [35,  'smg',     'doubleDmg',   'SMG+: Double damage'],
  [38,  'shotgun', 'doubleAmmo',  'Shotgun+: Double ammo'],
  [40,  'rocket',  'unlock',      'NEW WEAPON: Rocket  [7]'],
  [43,  'mine',    'bigBang',     'Mine+: Big bang'],
  [45,  'grenade', 'bigBang',     'Grenade+: Big bang'],
  [48,  'shotgun', 'wider',       'Shotgun+: Wider spread'],
  [50,  'rocket',  'doubleAmmo',  'Rocket+: Double ammo'],
  [55,  'railgun', 'unlock',      'NEW WEAPON: Railgun  [8]'],
  [60,  'rocket',  'fastFire',    'Rocket+: Fast reload'],
  [65,  'smg',     'quadDmg',     'SMG+: Quad damage'],
  [70,  'railgun', 'doubleAmmo',  'Railgun+: Double ammo'],
  [80,  'rocket',  'bigBang',     'Rocket+: Big bang'],
  [90,  'railgun', 'fastFire',    'Railgun+: Rapid fire'],
  [100, 'smg',     'infinite',    'SMG+: Infinite ammo'],
];

// ── Enemies ────────────────────────────────────────────────────────────────
const ENEMIES = {
  walker: { hp: 100, speed: 1.4, dmg: 25, score: 100,  radius: 0.4,  attackTime: 0.45, attackCD: 0.7, color: '#7fae5a' },
  brute:  { hp: 800, speed: 1.9, dmg: 45, score: 1000, radius: 0.55, attackTime: 0.5,  attackCD: 1.0, color: '#b0413e',
            fireRange: 6, fireCD: 2.4, fireDmg: 35 },
};

// ── Waves (ported from the level table generator) ──────────────────────────
// Level n: concurrent cap = min(10+5(n-1), 60), total = 10+5(n-1),
// spawn interval shrinks, speed multiplier = min(1 + n/10, cap),
// brutes: concurrent += 0.3/level, total += 0.25/level after level 1.
function levelSpec(n) {
  const k = n - 1;
  return {
    walkerCap: Math.min(10 + 5 * k, 60),
    walkerTotal: 10 + 5 * k,
    walkerEvery: Math.max(1.0 - 0.05 * k, 0.15),
    bruteCap: n === 1 ? 0 : Math.floor(Math.min(0.3 * k, 5)),
    bruteTotal: n === 1 ? 0 : Math.floor(0.25 * k),
    bruteEvery: Math.max(10 - 0.5 * k, 2),
    speedMul: Math.min(1 + n / 10, 2.5),
  };
}

// Combo window, ported from GetTicks():
//   ticks = (((101 - m) ^ 2.5) / 1e5) * (FPS*3 - 3) + 3     (frames @ 50fps)
function comboWindow(m) {
  m = Math.min(m, 100);
  const p = Math.pow(101 - m, 2.5) / 1e5;
  return (p * (FPS_REF * 3 - 3) + 3) / FPS_REF; // seconds
}
