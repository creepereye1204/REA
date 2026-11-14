'use strict';
// Authoritative simulation. In co-op the host runs this; the guest only renders snapshots.

let G = null;
let SR = rng((Date.now() ^ 0x5bd1e995) >>> 0);
const flowBase = new Int32Array(MW * MH), flowPl = new Int32Array(MW * MH);
let flowBaseDirty = true, flowBaseCD = 0, flowPlKey = '', flowPlCD = 0;
const CORE_DEF = { name: '발전기 코어', hp: 5000, block: true }, BENCH_DEF = { name: '작업대', hp: 1e9, block: true };
const RADIO_DEF = { name: '무전기', hp: 1e9, block: true }, GATE_DEF = { name: '연구소 보안문', hp: 1e9, block: true };
const INVULN = { bench: 1, radio: 1, gate: 1 };
const KIND_LIST = [...Object.keys(MOBS), ...Object.keys(HUMANS)];
const PCOLORS = ['#3f8fc4', '#e08a2f'];

// ── setup ─────────────────────────────────────────────────────────────────
function newGame(seed) {
  genWorld(seed);
  G = {
    seed, t: 0, tick: 0, clock: 7 * 60, day: 1, phase: 'day', players: [], ents: [], structs: [], drops: [], shots: [], booms: [],
    stash: { cash: 80, wood: 40, scrap: 20, food: 6, meds: 2, grenade: 2, mine: 1, mags: { pistol: [12, 12, 12] }, owned: { machete: 1, pistol: 1 }, upg: {} },
    vh: W.villages.map(() => 0), merchantHostile: false, kills: 0, over: null, nextId: 1, waves: [], spawnQ: [], warn: null,
    raidAt: -1, fxOut: [], tileDiff: {}, core: null, bench: null, nightN: 0, lootLog: 0, hazards: [], milHostile: false, Q: newQuestState(), frozen: [], away: null,
  };
  const b = W.base;
  // core (2×2) + workbench
  const coreCells = [idx(b.cx - 1, b.cy - 1), idx(b.cx, b.cy - 1), idx(b.cx - 1, b.cy), idx(b.cx, b.cy)];
  G.core = addStruct('core', coreCells, CORE_DEF);
  G.bench = addStruct('bench', [idx(b.cx + 4, b.cy - 3)], BENCH_DEF);
  G.radio = addStruct('radio', [idx(b.cx - 5, b.cy - 3)], RADIO_DEF);
  for (const c of W.gates) addStruct('gate', [c], GATE_DEF);
  // starter wooden perimeter with doors on the roads
  const x0 = b.cx - 8, x1 = b.cx + 7, y0 = b.cy - 7, y1 = b.cy + 6;
  for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) starter(x, y);
  for (let y = y0 + 1; y < y1; y++) for (const x of [x0, x1]) starter(x, y);
  function starter(x, y) {
    const onRoadV = Math.abs(x - b.cx) <= 1 && (y === y0 || y === y1), onRoadH = Math.abs(y - b.cy) <= 1 && (x === x0 || x === x1);
    const gate = (onRoadV && x === b.cx) || (onRoadH && y === b.cy);
    addStruct(gate ? 'door' : 'wall_wood', [idx(x, y)]);
  }
  for (const s of W.npcSpawns) spawnFromDef(s);
  spawnMerchant();
  for (let k = 0; k < 14; k++) spawnSurvivor();
  G.players[0] = makePlayer(0); // activation needs someone to measure distance from; main.js replaces it
  activation(true);
  G.players = [];
  startQuest('m1', true);
  return G;
}

function makePlayer(pid) {
  const b = W.base;
  return {
    id: -1 - pid, pid, cat: 'player', team: 'player', name: 'P' + (pid + 1), color: PCOLORS[pid],
    x: b.cx + 0.5 + (pid ? 2 : -2), y: b.cy + 3.5, r: 0.3, angle: -Math.PI / 2,
    hp: 100, maxHp: 100, hunger: 100, stamina: 100, wpn: 'pistol', mag: { pistol: 12, machete: 0 },
    reloadT: 0, fireT: 0, prevFire: false, down: false, downT: 0, dead: false, healT: 0, flash: 0, walk: 0,
    in: { fire: false, use: false, sprint: false, crouch: false, ax: 0, ay: 0, moving: false },
    useT: 0, useKey: null, useP: 0, useLabel: '', noAmmoT: 0, joined: true,
  };
}
function addPlayer(pid) { const p = makePlayer(pid); G.players[pid] = p; return p; }

function newEnt(o) { o.id = G.nextId++; o.flash = 0; o.walk = 0; o.vx = 0; o.vy = 0; o.atkAnim = 0; G.ents.push(o); return o; }

function spawnMob(kind, x, y, wave, o = {}) {
  const d = MOBS[kind];
  const hpMul = d.boss ? 1 + Math.max(0, G.day - 1) * 0.05 : 1 + Math.max(0, G.day - 1) * 0.09;
  return newEnt({ cat: 'mob', kind, def: d, team: 'zombie', x, y, r: d.r, angle: SR.r(0, TAU), hp: d.hp * hpMul, maxHp: d.hp * hpMul,
                  speed: d.speed * SR.r(0.9, 1.1), state: 'wander', target: null, seenT: -99, atkT: 0, spitT: SR.r(0, 2), wave: !!wave,
                  wanderT: 0, wx: 0, wy: 0, stuckT: 0, invest: null, screamed: false, tag: o.tag || null, home: o.home || null, skillT: SR.r(2, 4), dashT: 0 });
}
// world spawn entries (villages, camps, landmarks) — remember where they live
function spawnFromDef(s) {
  if (MOBS[s.kind]) return spawnMob(s.kind, s.x, s.y, false, { tag: s.tag, home: { x: s.x, y: s.y, r: MOBS[s.kind].boss ? 6 : 9 } });
  return spawnHuman(s.kind, s.x, s.y, s);
}
function spawnHuman(kind, x, y, o = {}) {
  const d = HUMANS[kind];
  const h = newEnt({
    cat: 'human', kind, def: d, team: d.team, x, y, r: 0.32, angle: SR.r(0, TAU), hp: d.hp, maxHp: d.hp, speed: d.speed,
    wpn: d.wpn, mag: d.wpn && !WEAPONS[d.wpn].melee ? WEAPONS[d.wpn].mag : 0, reloadT: 0, fireT: 0, target: null, seenT: -99,
    village: o.village !== undefined ? o.village : -1, camp: o.camp !== undefined ? o.camp : -1, home: o.home || { x, y },
    path: null, pathT: 0, pathGoal: null, wanderT: 0, wx: x, wy: y, strafe: 1, strafeT: 0, alert: 0, sees: false, mode: o.mode || 'idle',
    inv: { cash: 5 + SR.i(25), food: SR.chance(0.4) ? 1 : 0, meds: SR.chance(0.2) ? 1 : 0 }, atkT: 0,
    tag: o.tag || null, title: o.title || null, poi: o.poi || null, skillT: SR.r(2, 5),
  });
  if (d.team === 'military') { h.inv['mag:' + d.wpn] = 1 + SR.i(2); if (SR.chance(0.3)) h.inv.armor = 1; if (SR.chance(0.4)) h.inv.grenade = 1; }
  if (d.team === 'cult') { h.inv.cash += 10 + SR.i(30); if (SR.chance(0.5)) h.inv.molotov = 1 + SR.i(2); if (SR.chance(0.2)) h.inv.jewel = 1; }
  if (kind === 'cult_priest') { h.inv.gold = 2; h.inv.cash += 200; h.inv['wpn:smg'] = 1; }
  if (kind === 'yoon') h.stock = makeStock('military', SR);
  if (kind === 'elder' || kind === 'lost' || kind === 'dr_han') h.inv = { cash: 0 };
  if (d.npc === 'dr_han' || kind === 'lost') h.hunger = 0;
  if (o.tag && o.tag.startsWith('camp')) { h.inv.cash += 120; h.inv.gold = 1; }
  if (d.team === 'bandit') { h.inv.cash += 15 + SR.i(40); if (d.wpn && !WEAPONS[d.wpn].melee) h.inv['mag:' + d.wpn] = 1 + SR.i(2); if (SR.chance(0.3)) h.inv.grenade = 1; }
  if (kind === 'bandit_boss') { h.inv.cash += 150; h.inv['wpn:rifle'] = 1; h.inv['mag:rifle'] = 3; }
  if (kind === 'guard') h.inv['mag:rifle'] = 1 + SR.i(2);
  if (d.shop && !h.stock) h.stock = makeStock(kind, SR);
  return h;
}
function spawnMerchant() {
  const b = W.base;
  const m = spawnHuman('merchant', b.cx - 4.5, b.cy + 3.5, { home: { x: b.cx - 4.5, y: b.cy + 3.5 } });
  G.merchantHostile = false;
  return m;
}
function spawnSurvivor() {
  const spots = W.survivorSpots.filter(s => !G.ents.some(e => e.kind === 'survivor' && dist(e.x, e.y, s.x, s.y) < 3));
  if (!spots.length) return null;
  const s = SR.pick(spots);
  if (cellBlocked(idx(Math.floor(s.x), Math.floor(s.y)), 'player')) return null;
  const h = spawnHuman('survivor', s.x, s.y, { mode: 'wait' });
  h.name = SR.i(SURVIVOR_NAMES.length); h.perk = SR.pick(Object.keys(PERKS));
  h.wpn = SR.pick(['pistol', 'pistol', 'smg', 'shotgun']); h.mag = WEAPONS[h.wpn].mag; h.hunger = 0;
  return h;
}
// ── structures ──────────────────────────────────────────────────────────────
function addStruct(type, cells, def) {
  def = def || STRUCTS[type];
  let sx = 0, sy = 0;
  for (const c of cells) { sx += cellX(c) + 0.5; sy += cellY(c) + 0.5; }
  const s = { id: G.nextId++, type, def, cells, x: sx / cells.length, y: sy / cells.length, hp: def.hp, maxHp: def.hp, angle: -Math.PI / 2,
              ammo: def.ammo || 0, fireT: 0, fuse: -1, flash: 0 };
  for (const c of cells) { W.structAt[c] = s; updateCellMB(c); }
  G.structs.push(s);
  flowBaseDirty = true;
  return s;
}
function removeStruct(s) {
  for (const c of s.cells) { if (W.structAt[c] === s) W.structAt[c] = null; updateCellMB(c); }
  const i = G.structs.indexOf(s); if (i >= 0) G.structs.splice(i, 1);
  flowBaseDirty = true;
}
function damageStruct(s, dmg, src) {
  if (s.dead || INVULN[s.type]) return;
  if (src && src.team === 'player' && s.type !== 'barrel') dmg *= 0.3;
  s.hp -= dmg; s.flash = 4;
  if (s.type === 'core') {
    if (G.tick % 20 === 0) fx({ k: 'msg', text: '⚠ 코어가 공격받고 있습니다!', c: '#ff6b5c', big: 0 });
    if (s.hp <= 0) { s.hp = 0; gameOver('core'); }
    return;
  }
  if (s.hp <= 0) destroyStruct(s);
}
function destroyStruct(s) {
  if (s.dead) return;
  s.dead = true; removeStruct(s);
  fx({ k: 'debris', x: s.x, y: s.y, c: s.type === 'wall_metal' ? '#8a8f9c' : '#8a6a44' });
  if (s.type === 'barrel') explode(s.x, s.y, 150, 2.8, null);
  else if (s.type === 'mine') explode(s.x, s.y, 130, 2.6, null);
}
function canPlace(type, cell) {
  if (cell < 0 || cell >= MW * MH) return false;
  const x = cellX(cell), y = cellY(cell);
  if (type !== 'campfire' && dist(x + 0.5, y + 0.5, G.core.x, G.core.y) > BUILD_RADIUS && !G.structs.some(s => s.type === 'campfire' && dist(s.x, s.y, x + 0.5, y + 0.5) <= OUTPOST_RADIUS)) return false;
  if (type === 'campfire' && G.structs.some(s => s.type === 'campfire' && dist(s.x, s.y, x + 0.5, y + 0.5) < 20)) return false;
  if (W.mb[cell] & (MB_TERRAIN | MB_OBJ)) return false;
  if (W.structAt[cell] || W.tile[cell] === T.WATER) return false;
  if (STRUCTS[type].block) {
    for (const p of G.players) if (p && !p.dead && Math.floor(p.x) === x && Math.floor(p.y) === y) return false;
    for (const e of G.ents) if (Math.floor(e.x) === x && Math.floor(e.y) === y) return false;
  }
  return true;
}
function canAfford(cost) { for (const k in cost) if ((G.stash[k] || 0) < cost[k]) return false; return true; }
function pay(cost) { for (const k in cost) G.stash[k] -= cost[k]; }

// ── helpers ──────────────────────────────────────────────────────────────────
function fx(o) { G.fxOut.push(o); if (typeof applyFx === 'function') applyFx(o); }
function say(text, c = '#fff', pid = -1, big = 0) { fx({ k: 'msg', text, c, pid, big }); }
function sfxAt(n, x, y) { fx({ k: 'sfx', n, x, y }); }
const alivePlayers = () => G.players.filter(p => p && p.joined && !p.dead && !p.down);
const isNight = () => G.phase === 'night' || G.phase === 'dawn' && false;
const inBase = (x, y) => { const b = W.base; return x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h; };
function villageAt(x, y) { for (const v of W.villages) if (x >= v.x && y >= v.y && x < v.x + v.w && y < v.y + v.h) return v; return null; }

function hostile(a, b) {
  if (a === b || !b || b.dead) return false;
  if (b.cat === 'player' && (b.down || b.dead)) return false;
  if (b.mode === 'wait' && b.team === 'player' || a.mode === 'wait' && a.team === 'player') return false; // captives hide until rescued
  const ta = a.team, tb = b.team;
  if (ta === tb) return false;
  if (ta === 'zombie' || tb === 'zombie') return true;
  if (ta === 'bandit' || tb === 'bandit') return true;
  if (ta === 'cult' || tb === 'cult') return true;
  if (ta === 'military' || tb === 'military') return (ta === 'player' || tb === 'player') && G.milHostile;
  if ((ta === 'village' && tb === 'player') || (ta === 'player' && tb === 'village')) {
    const v = ta === 'village' ? a.village : b.village;
    return v >= 0 && G.vh[v] > 0;
  }
  if ((ta === 'merchant' && tb === 'player') || (ta === 'player' && tb === 'merchant')) return G.merchantHostile;
  return false;
}
// can a shot fired by `sh` hit `e`? Player-side shots hit anyone not on the player team.
function canHit(sh, e) {
  if (e === sh || e.dead || e.hp <= 0) return false;
  if (e.cat === 'player') return sh.team !== 'player' && !e.down;
  if (sh.team === 'player') return e.team !== 'player' && !(e.team === 'military' && !G.milHostile && sh.cat !== 'player');
  return hostile(sh, e);
}
function allActors() { const a = G.ents.slice(); for (const p of G.players) if (p && p.joined && !p.dead) a.push(p); return a; }

function magCap(wid) { const u = (G.stash.upg[wid] || {}); return Math.round(WEAPONS[wid].mag * (1 + UPG_STATS.mag.per * (u.mag || 0))); }
function wstat(wid, stat) {
  const w = WEAPONS[wid], u = G.stash.upg[wid] || {}, l = u[stat] || 0;
  if (stat === 'dmg') return w.dmg * (1 + UPG_STATS.dmg.per * l);
  if (stat === 'rate') return w.rate * (1 - UPG_STATS.rate.per * l);
  if (stat === 'reload') return (w.reload || 0) * (1 - UPG_STATS.reload.per * l);
  if (stat === 'mag') return magCap(wid);
  return w[stat];
}

function giveItem(id, n, pid = -1, x, y) {
  if (!n) return;
  const S = G.stash;
  if (id.startsWith('mag:')) {
    const w = id.slice(4); S.mags[w] = S.mags[w] || [];
    for (let k = 0; k < n; k++) S.mags[w].push(magCap(w));
  } else if (id.startsWith('wpn:')) {
    const w = id.slice(4);
    if (!S.owned[w]) { S.owned[w] = 1; say(`새 무기 획득: ${WEAPONS[w].name} (${WEAPONS[w].key})`, '#ffd166', -1, 1); sfxAt('unlock', x, y); }
    giveItem('mag:' + w, 2, pid);
  } else S[id] = (S[id] || 0) + n;
  if (id === 'armor') for (const p of G.players) if (p && p.joined && !p.dead) autoArmor(p);
  if (x !== undefined) fx({ k: 'float', x, y, text: `+${n} ${itemName(id)}`, c: id === 'cash' ? '#ffd166' : '#cfe8ff', icon: itemIcon(id) });
}
function rollLoot(kind) {
  const tbl = CONTAINERS[kind].loot, out = {};
  const rolls = 1 + SR.i(kind === 'safe' || kind === 'stash' ? 3 : 2) + (kind === 'car' ? 1 : 0);
  const tot = tbl.reduce((s, e) => s + e[3], 0);
  for (let r = 0; r < rolls; r++) {
    let q = SR.f() * tot;
    for (const [id, a, b, w] of tbl) { if ((q -= w) <= 0) { const n = a + SR.i(b - a + 1); if (n) out[id] = (out[id] || 0) + n; break; } }
  }
  return out;
}

// ── noise ──────────────────────────────────────────────────────────────────
function makeNoise(x, y, r, src) {
  if (r < 2) return;
  for (const e of G.ents) {
    if (e.cat !== 'mob' || e.target) continue;
    if (dist(e.x, e.y, x, y) < r) { e.invest = { x, y, t: G.t + 12 }; if (src && src.cat === 'player' && dist(e.x, e.y, x, y) < r * 0.5) { e.target = src; e.seenT = G.t; } }
  }
}

// ── combat ─────────────────────────────────────────────────────────────────
function damage(e, dmg, src, kx = 0, ky = 0) {
  if (e.dead) return;
  if (e.cat === 'player') {
    if (e.down || G.over) return;
    if (src && src.team === 'player') dmg *= 0.5;
    if (e.adrT > 0) dmg *= 0.8;
    if (e.veh) { e.veh.hp -= dmg * 0.7; dmg *= 0.3; if (e.veh.hp <= 0) wreckCar(e); }
    if (e.armor > 0) { const a = Math.min(e.armor, dmg * 0.5); e.armor -= a; dmg -= a; if (e.armor <= 0) { e.armor = 0; say('방탄조끼가 망가졌습니다', '#ffb36b', e.pid); autoArmor(e); } }
    e.hp -= dmg; e.flash = 5;
    fx({ k: 'hurt', pid: e.pid, x: e.x, y: e.y });
    if (e.hp <= 0) downPlayer(e);
    return;
  }
  if (e.def.armor) dmg *= e.def.armor;
  if (e.def.shield && src && src.x !== undefined && kx + ky !== 0 && Math.abs(angDiff(e.angle, Math.atan2(src.y - e.y, src.x - e.x))) < 1.0) {
    dmg *= 0.2; if (SR.chance(0.5)) fx({ k: 'spark', x: e.x + Math.cos(e.angle) * 0.4, y: e.y + Math.sin(e.angle) * 0.4 });
  }
  if (e.def.stealth) e.revealT = 3;
  e.hp -= dmg; e.flash = 4;
  const kb = (e.def.heavy ? 0.15 : 1) * Math.min(0.25, dmg / 260);
  e.vx += kx * kb; e.vy += ky * kb;
  if (SR.chance(0.5)) fx({ k: 'blood', x: e.x, y: e.y, z: e.cat === 'mob' ? 1 : 0 });
  if (src && src.team === 'player') {
    if (e.team === 'village' && e.village >= 0 && G.vh[e.village] <= 0) villageHostile(e.village, '공격');
    if (e.team === 'merchant' && !G.merchantHostile) { G.merchantHostile = true; say('떠돌이 상인이 총을 꺼냅니다!', '#ff6b5c', -1, 1); }
    if (e.team === 'military' && !G.milHostile && src.cat === 'player') { G.milHostile = true; say('잔존군이 적대적으로 변했습니다! 탈출 루트가 막힐 수 있습니다.', '#ff5c4c', -1, 1); }
  }
  if (src && (src.cat === 'player' || src.cat === 'mob' || src.cat === 'human') && hostile(e, src)) { e.target = src; e.seenT = G.t; }
  if (e.hp <= 0) kill(e, src);
}
function kill(e, src) {
  if (e.dead) return;
  e.dead = true; e.hp = 0;
  const byPlayer = src && src.team === 'player';
  if (e.cat === 'mob') {
    fx({ k: 'gib', x: e.x, y: e.y, c: e.def.body, big: e.def.r > 0.5 ? 1 : 0 });
    sfxAt('kill', e.x, e.y);
    if (byPlayer) {
      G.kills++;
      const c = e.def.cash[0] + SR.i(e.def.cash[1] - e.def.cash[0] + 1);
      if (c) { G.stash.cash += c; fx({ k: 'float', x: e.x, y: e.y - 0.4, text: '$' + c, c: '#ffd166' }); }
      if (SR.chance(e.def.boss ? 1 : 0.04)) dropBag(e.x - 0.3, e.y, e.def.boss ? { cash: 150, 'mag:launcher': 2, grenade: 3, meds: 2, gold: 1, chem: 2 } : rollLoot(SR.pick(['cabinet', 'crate', 'desk'])), e.def.boss ? e.def.name : '');
    }
    if (e.def.explode) explode(e.x, e.y, e.def.explode.dmg, e.def.explode.r, e);
    if (e.def.gas) addHazard('gas', e.x, e.y, e.def.gas.r, e.def.gas.t, e.def.gas.dps, 'zombie');
  } else {
    fx({ k: 'gib', x: e.x, y: e.y, c: '#7a1414', big: 0 });
    sfxAt('kill', e.x, e.y);
    const items = { ...e.inv };
    if (e.wpn && !WEAPONS[e.wpn].melee) { items['mag:' + e.wpn] = (items['mag:' + e.wpn] || 0) + 1; if (e.kind !== 'survivor') items['wpn:' + e.wpn] = 1; }
    if (e.stock) for (const k in e.stock) items[k] = (items[k] || 0) + e.stock[k];
    if (e.kind !== 'survivor' && e.team !== 'player') dropBag(e.x, e.y, items, e.title || e.def.name);
    if (byPlayer) G.kills++;
    if (e.kind === 'survivor' && e.mode !== 'wait') say(`${SURVIVOR_NAMES[e.name]} 사망…`, '#ff8a7a');
    if (e.team === 'village' && byPlayer && e.village >= 0) { G.vh[e.village] = Math.max(G.vh[e.village], 3); }
    if (e.kind === 'trader') say(`${W.villages[e.village].name}의 상인이 죽었습니다. 소지품을 챙길 수 있습니다.`, '#ffd166');
    if (e.kind === 'merchant') say('떠돌이 상인을 처치했습니다. 모든 물건이 떨어졌습니다.', '#ffd166');
    if (e.def.boss && e.tag && e.tag.startsWith('camp')) say(`${e.title} 처치!`, '#ffd166', -1, 1);
  }
  questOnKill(e, src);
}
function addHazard(k, x, y, r, t, dps, team) { G.hazards.push({ k, x, y, r, t, dps, team }); if (G.hazards.length > 40) G.hazards.shift(); }
function updateHazards() {
  if (!G.hazards.length) return;
  const tickDmg = G.tick % 10 === 0;
  for (const h of G.hazards) {
    h.t -= DT;
    if (!tickDmg) continue;
    for (const e of allActors()) {
      if (dist(e.x, e.y, h.x, h.y) > h.r + e.r) continue;
      if (h.k === 'gas' && e.team === 'zombie') continue;
      if (h.team === e.team && e.cat !== 'player') continue;
      if (e.cat === 'player') { if (!e.down) { e.hp -= h.dps * 0.2; e.flash = 4; fx({ k: 'hurt', pid: e.pid }); if (e.hp <= 0) downPlayer(e); } }
      else damage(e, h.dps * 0.2, { team: h.team === 'player' ? 'player' : 'none', cat: 'hazard' });
    }
    if (h.k === 'fire') for (let yy = Math.floor(h.y - h.r); yy <= h.y + h.r; yy++) for (let xx = Math.floor(h.x - h.r); xx <= h.x + h.r; xx++) {
      const s = inMap(xx, yy) && W.structAt[idx(xx, yy)]; if (s && (s.type === 'wall_wood' || s.type === 'door' || s.type === 'spikes')) damageStruct(s, h.dps * 0.15, null);
    }
  }
  G.hazards = G.hazards.filter(h => h.t > 0);
}
function autoArmor(p) { if (G.stash.armor > 0 && !(p.armor > 0)) { G.stash.armor--; p.armor = 100; say(`${p.name}: 방탄조끼 착용`, '#cfe8ff', p.pid); } }
// which item a dropped bag shows on the ground
const DROP_RANK = ['keycard', 'sample', 'wpn:', 'gold', 'jewel', 'armor', 'mag:launcher', 'mag:sniper', 'mag:rifle', 'watch', 'adrenaline', 'meds', 'grenade', 'molotov', 'mag:', 'cash'];
function dropTop(b) {
  const ks = Object.keys(b.items).filter(k => b.items[k] > 0);
  if (ks.length > 2) return 'bag';
  for (const r of DROP_RANK) { const k = ks.find(q => q.startsWith(r)); if (k) return itemIcon(k); }
  return ks.length ? itemIcon(ks[0]) : 'bag';
}
function dropBag(x, y, items, from) {
  let any = false; for (const k in items) if (items[k] > 0) any = true;
  if (!any) return;
  G.drops.push({ id: G.nextId++, x, y, items, from: from || '', ttl: FPS * 60 * 5 });
  if (G.drops.length > 80) G.drops.shift();
}

function downPlayer(p) {
  p.hp = 0;
  if (p.veh) exitCar(p, true);
  const others = G.players.filter(q => q && q !== p && q.joined && !q.dead && !q.down);
  if (!others.length) { gameOver('dead'); return; }
  p.down = true; p.downT = 45; p.reloadT = 0;
  say(`${p.name} 쓰러짐! 가까이 가서 [E]를 눌러 살리세요`, '#ff6b5c', -1, 1);
}
function gameOver(reason) {
  if (G.over) return;
  G.over = { reason, day: G.day, kills: G.kills };
  fx({ k: 'over', reason });
}

// hitscan: walls stop it, player-side bullets pass over own structures, others hit them
function hitscan(sh, x, y, a, range, dmg, pierce = 1, color) {
  const dx = Math.cos(a), dy = Math.sin(a);
  let structHit = null;
  const wallD = rayCells(x, y, dx, dy, range, (i, t) => {
    if (TILE_OPAQUE[W.tile[i]]) return true;
    const s = W.structAt[i];
    if (s && s.def.block && sh.team !== 'player' && t > 0.3) { structHit = s; return true; }
    if (s && s.type === 'barrel' && sh.team === 'player' && t > 0.3) { structHit = s; return true; }
    return false;
  });
  const hits = [];
  for (const e of allActors()) {
    if (!canHit(sh, e)) continue;
    const ex = e.x - x, ey = e.y - y, pr = ex * dx + ey * dy;
    if (pr < 0 || pr > wallD) continue;
    if (Math.abs(ex * dy - ey * dx) < e.r + 0.05) hits.push([pr, e]);
  }
  hits.sort((p, q) => p[0] - q[0]);
  let end = wallD;
  for (let k = 0; k < hits.length && k < pierce; k++) {
    const [pr, e] = hits[k];
    damage(e, dmg, sh, dx, dy);
    if (k === pierce - 1) end = pr;
  }
  if (structHit && hits.length < pierce) damageStruct(structHit, dmg, sh);
  else if (!hits.length && end < range && SR.chance(0.4)) fx({ k: 'spark', x: x + dx * end, y: y + dy * end });
  fx({ k: 'tr', x1: +x.toFixed(2), y1: +y.toFixed(2), x2: +(x + dx * end).toFixed(2), y2: +(y + dy * end).toFixed(2), c: color || 0 });
}

function fireGun(sh, wid, a, opt = {}) {
  const w = WEAPONS[wid];
  const mx = sh.x + Math.cos(a) * 0.45, my = sh.y + Math.sin(a) * 0.45;
  const dmg = (sh.cat === 'player' ? wstat(wid, 'dmg') : w.dmg) * (opt.dmgMul || 1);
  const spread = w.spread * (opt.spreadMul || 1) * (sh.in && sh.in.crouch ? 0.6 : 1);
  if (w.rocket) {
    G.shots.push({ k: 'rocket', x: mx, y: my, vx: Math.cos(a) * 16, vy: Math.sin(a) * 16, dmg, team: sh.team, owner: sh, life: 2 });
  } else {
    const n = w.pellets || 1;
    for (let k = 0; k < n; k++) {
      const aa = a + (SR.f() + SR.f() - 1) * spread;
      hitscan(sh, mx, my, aa, w.range * (n > 1 ? SR.r(0.75, 1) : 1), dmg, w.pierce || 1, wid === 'sniper' ? 2 : 0);
    }
  }
  fx({ k: 'flash', x: +mx.toFixed(2), y: +my.toFixed(2), a: +a.toFixed(2) });
  sfxAt(wid, sh.x, sh.y);
  makeNoise(sh.x, sh.y, w.noise * (sh.in && sh.in.crouch ? 0.7 : 1), sh);
}
function melee(sh, dmg, range, arc) {
  let hit = false;
  for (const e of allActors()) {
    if (!canHit(sh, e)) continue;
    const d = dist(sh.x, sh.y, e.x, e.y);
    if (d > range + e.r) continue;
    if (Math.abs(angDiff(sh.angle, Math.atan2(e.y - sh.y, e.x - sh.x))) > arc / 2 && d > 0.6) continue;
    damage(e, dmg, sh, (e.x - sh.x) / (d || 1), (e.y - sh.y) / (d || 1)); hit = true;
  }
  fx({ k: 'swing', x: sh.x, y: sh.y, a: +sh.angle.toFixed(2) });
  sfxAt(hit ? 'chop' : 'swish', sh.x, sh.y);
  return hit;
}

function explode(x, y, dmg, r, src) {
  G.booms.push({ x, y, dmg, r, src, delay: 0 });
}
function processBooms() {
  const list = G.booms; G.booms = [];
  for (const b of list) {
    if (b.delay-- > 0) { G.booms.push(b); continue; }
    fx({ k: 'boom', x: +b.x.toFixed(2), y: +b.y.toFixed(2), r: b.r });
    makeNoise(b.x, b.y, 22, null);
    for (const e of allActors()) {
      const d = dist(e.x, e.y, b.x, b.y);
      if (d > b.r + e.r) continue;
      const q = d / b.r, dm = q <= 0.5 ? b.dmg : q <= 0.75 ? b.dmg * 0.75 : b.dmg * 0.5;
      const src = b.src || { team: 'none', cat: 'none' };
      if (e.cat === 'player') { if (!e.down) { e.hp -= dm * 0.4; e.flash = 5; fx({ k: 'hurt', pid: e.pid }); if (e.hp <= 0) downPlayer(e); } }
      else if (!(b.src && b.src.team === 'player' && e.team === 'player')) damage(e, dm, src, (e.x - b.x) / (d || 1), (e.y - b.y) / (d || 1));
    }
    const seen = new Set();
    for (let yy = Math.floor(b.y - b.r); yy <= b.y + b.r; yy++) for (let xx = Math.floor(b.x - b.r); xx <= b.x + b.r; xx++) {
      if (!inMap(xx, yy)) continue;
      const s = W.structAt[idx(xx, yy)];
      if (!s || seen.has(s) || dist(s.x, s.y, b.x, b.y) > b.r) continue;
      seen.add(s);
      if (s.type === 'barrel' || s.type === 'mine') { if (!s.dead) { s.dead = true; removeStruct(s); G.booms.push({ x: s.x, y: s.y, dmg: 150, r: 2.8, src: b.src, delay: 4 }); } }
      else damageStruct(s, b.dmg * 0.6, b.src);
    }
  }
}

// ── players ────────────────────────────────────────────────────────────────
function updatePlayer(p) {
  if (!p || !p.joined) return;
  p.flash = Math.max(0, p.flash - 1);
  if (p.dead) return;
  if (p.down) {
    p.downT -= DT;
    if (p.downT <= 0) { p.down = false; p.dead = true; say(`${p.name} 사망. 다음 아침 기지에서 부활합니다.`, '#ff6b5c', -1, 1);
      if (!alivePlayers().length) gameOver('dead'); }
    return;
  }
  // survival stats
  p.hunger = Math.max(0, p.hunger - 100 / (6.5 * 60 * FPS * 1.1));
  if (p.hunger <= 0) { p.hp -= 0.6 * DT; if (p.hp <= 0) downPlayer(p); }
  else if (p.hunger > 50 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 0.35 * DT);
  if (p.healT > 0) { p.healT -= DT; p.hp = Math.min(p.maxHp, p.hp + 25 * DT); }
  if (p.adrT > 0) { p.adrT -= DT; p.stamina = 100; }
  if (p.in.sprint && p.in.moving && p.stamina > 0) p.stamina = Math.max(0, p.stamina - 22 * DT);
  else p.stamina = Math.min(100, p.stamina + 14 * DT);
  if (p.in.moving) p.walk += 0.25;
  p.angle = Math.atan2(p.in.ay, p.in.ax) || p.angle;

  if (p.veh) { updateDriving(p); p.prevFire = p.in.fire; p.useT = 0; p.useP = 0; return; }
  // weapon
  const wid = p.wpn, w = WEAPONS[wid];
  if (p.fireT > 0) p.fireT -= DT;
  if (p.noAmmoT > 0) p.noAmmoT -= DT;
  if (p.reloadT > 0) {
    p.reloadT -= DT;
    if (p.reloadT <= 0) finishReload(p);
  } else {
    const fire = p.in.fire && (w.auto || w.melee || !p.prevFire);
    if (fire && p.fireT <= 0) {
      if (w.melee) { melee(p, wstat(wid, 'dmg'), w.range, w.arc); p.fireT = w.rate; }
      else if ((p.mag[wid] || 0) > 0) { p.mag[wid]--; fireGun(p, wid, p.angle); p.fireT = wstat(wid, 'rate'); }
      else startReload(p, true);
    }
  }
  p.prevFire = p.in.fire;

  // interact (hold actions)
  if (p.in.use) {
    const it = findInteract(p, G);
    if (it && !it.instant && !it.ui) {
      if (p.useKey !== it.key) { p.useKey = it.key; p.useT = 0; }
      p.useT += DT; p.useP = Math.min(1, p.useT / it.time); p.useLabel = it.label;
      if (it.steal && G.tick % 8 === 0) checkWitness(p, it);
      if (it.kind === 'cont') lootTension(p, it);
      if (p.useT >= it.time) { completeInteract(p, it); p.useT = 0; }
    } else { p.useT = 0; p.useKey = null; p.useP = 0; }
  } else { p.useT = 0; p.useKey = null; p.useP = 0; }
}
function startReload(p, auto) {
  const wid = p.wpn, w = WEAPONS[wid];
  if (w.melee || p.reloadT > 0) return;
  if ((p.mag[wid] || 0) >= magCap(wid)) return;
  const spare = G.stash.mags[wid] || [];
  if (!spare.length) {
    if (p.noAmmoT <= 0) { say(`${w.name} 예비 탄창이 없습니다 — 상인에게 구매하세요`, '#ff9a8a', p.pid); sfxAt('empty', p.x, p.y); p.noAmmoT = 1.2; }
    return;
  }
  p.reloadT = wstat(wid, 'reload'); p.reloadW = wid;
  sfxAt('reload', p.x, p.y);
}
// magazines are real: the fullest spare goes in, the partial one goes back to the pouch
function finishReload(p) {
  const wid = p.reloadW; p.reloadT = 0;
  if (wid !== p.wpn) return;
  const spare = G.stash.mags[wid] || [];
  if (!spare.length) return;
  let bi = 0; for (let k = 1; k < spare.length; k++) if (spare[k] > spare[bi]) bi = k;
  const m = spare.splice(bi, 1)[0];
  const cur = p.mag[wid] || 0;
  if (cur > 0) spare.push(cur);
  p.mag[wid] = m;
}

// ── interaction (shared by host and guest so both see the same prompt) ──────
function findInteract(p, S, onlyInstant) {
  if (!p || p.down || p.dead || p.veh) return null;
  let best = null, bs = 1e9;
  const consider = (o, d) => {
    if (onlyInstant && !o.instant) return;
    const s = d - (Math.abs(angDiff(p.angle, Math.atan2(o.y - p.y, o.x - p.x))) < 1 ? 0.4 : 0);
    if (s < bs) { bs = s; best = o; }
  };
  for (const q of S.players) if (q && q !== p && q.down && !q.dead) { const d = dist(p.x, p.y, q.x, q.y); if (d < 1.6) consider({ key: 'rev' + q.pid, kind: 'revive', q, x: q.x, y: q.y, time: 3, label: `${q.name} 살리는 중` }, d - 1); }
  for (const b of S.drops) { const d = dist(p.x, p.y, b.x, b.y); if (d < 1.3) consider({ key: 'd' + b.id, kind: 'drop', b, x: b.x, y: b.y, instant: true, label: `줍기${b.from ? ' — ' + b.from + '의 소지품' : ''}` }, d - 0.5); }
  for (const e of S.ents) {
    if (e.dead) continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d > 1.8) continue;
    const nk = npcKeyOf(e);
    if (e.kind === 'survivor') {
      const lbl = e.mode === 'wait' ? '구출하기 (합류)' : e.mode === 'follow' ? '여기서 경계 명령' : '따라오기 명령';
      consider({ key: 'sv' + e.id, kind: 'survivor', e, x: e.x, y: e.y, instant: true, label: `${SURVIVOR_NAMES[e.name]}(${PERKS[e.perk].name}) — ${lbl}` }, d);
    } else if ((e.kind === 'lost' || e.kind === 'dr_han') && e.mode === 'wait') {
      consider({ key: 'rs' + e.id, kind: 'rescue', e, x: e.x, y: e.y, instant: true, label: `${e.title || e.def.name} 구출하기 (따라오게 하기)` }, d);
    } else if (nk && (e.kind === 'elder' || e.kind === 'yoon' || e.kind === 'dr_han') && !(e.team === 'village' && S.vh[e.village] > 0) && !(e.team === 'military' && S.milHostile)) {
      consider({ key: 'talk' + e.id, kind: 'talk', npc: nk, e, x: e.x, y: e.y, ui: 'talk', label: `${CAST[nk].name}와 대화` }, d);
    } else if (e.def.shop && e.kind !== 'yoon') {
      const hostileNow = e.team === 'merchant' ? S.merchantHostile : S.vh[e.village] > 0;
      if (!hostileNow) consider({ key: 'shop' + e.id, kind: 'shop', e, x: e.x, y: e.y, ui: 'shop', label: `${e.def.name}과 거래` }, d);
    }
  }
  const cx = Math.floor(p.x), cy = Math.floor(p.y);
  for (let yy = cy - 2; yy <= cy + 2; yy++) for (let xx = cx - 2; xx <= cx + 2; xx++) {
    if (!inMap(xx, yy)) continue;
    const i = idx(xx, yy);
    const c = W.contAt[i];
    if (c && c.looted && c.drive && !onlyInstant) {
      const d = Math.max(0, dist(p.x, p.y, xx + 0.5, yy + 0.5) - 0.5);
      if (d < 1.1) consider({ key: 'dv' + c.id, kind: 'drive', c, x: c.x, y: c.y, time: 1.2, label: c.fuel > 5 ? `운전하기 (연료 ${c.fuel | 0}%)` : '시동 걸기 — 연료 1 사용' }, d);
    }
    if (c && !c.looted) {
      const d = Math.max(0, dist(p.x, p.y, xx + 0.5, yy + 0.5) - 0.5);
      if (d < 1.1) {
        const steal = c.village >= 0 && !(S.vh[c.village] > 0 && villageEmpty(S, c.village));
        const CD = CONTAINERS[c.kind];
        consider({ key: 'c' + c.id, kind: 'cont', c, x: c.x, y: c.y, time: CD.time * 2.3 * (steal && p.in.crouch ? 1.3 : 1), steal, label: steal ? `${CD.name} 훔치기 (들키면 전투!)` : `${CD.name} 뒤지기 — 소리가 납니다` }, d);
      }
    }
    const tt = W.tile[i], G_ = GATHER[tt];
    if (G_) {
      const d = dist(p.x, p.y, xx + 0.5, yy + 0.5) - 0.5;
      if (d < 0.9) consider({ key: 't' + i, kind: 'gather', i, x: xx + 0.5, y: yy + 0.5, time: G_.time, label: G_.label }, d + 0.6);
    }
    const s = W.structAt[i];
    if (s && s.type !== 'mine') {
      const d = dist(p.x, p.y, xx + 0.5, yy + 0.5) - 0.5;
      if (d > 1.0) continue;
      if (s.type === 'campfire') consider({ key: 'tv' + s.id, kind: 'travel', to: 'base', x: s.x, y: s.y, time: 2, label: '기지로 이동 (식량 1)' }, d);
      if (s.type === 'core' && s.hp >= s.maxHp) { const cf = S.structs.filter(q => q.type === 'campfire').pop(); if (cf) consider({ key: 'tvc', kind: 'travel', to: cf.id, x: s.x, y: s.y, time: 2, label: '최근 모닥불 거점으로 이동 (식량 1)' }, d + 0.2); }
      if (s.type === 'bench') consider({ key: 'bench', kind: 'bench', x: s.x, y: s.y, ui: 'bench', label: '작업대 — 무기 강화 · 제작' }, d);
      else if (s.type === 'radio') consider({ key: 'radio', kind: 'talk', npc: 'radio', x: s.x, y: s.y, ui: 'talk', label: '무전기' }, d);
      else if (s.type === 'gate') continue;
      else if (s.type === 'turret' && s.ammo < 300) consider({ key: 'ta' + s.id, kind: 'turret', s, x: s.x, y: s.y, time: 0.8, label: `포탑 탄약 보충 (고철 5 → +100) [${s.ammo}]` }, d);
      else if (s.hp < s.maxHp) consider({ key: 'rp' + s.id, kind: 'repair', s, x: s.x, y: s.y, time: 0.6, label: `${s.def.name} 수리 (${s.type === 'core' ? '고철 5' : s.type === 'wall_metal' || s.type === 'turret' ? '고철 2' : '목재 2'})` }, d + 0.3);
    }
  }
  if (S.Q && !onlyInstant) for (const tr of W.triggers) {
    const d = dist(p.x, p.y, tr.x, tr.y); if (d > 1.6) continue;
    const label = triggerLabel(tr); if (label) consider({ key: 'tr' + tr.id, kind: 'trigger', tr, x: tr.x, y: tr.y, time: 1.5, label }, d);
  }
  return best;
}
const villageEmpty = (S, v) => !S.ents.some(e => !e.dead && e.team === 'village' && e.village === v && e.kind !== 'villager');

function interactTap(p) {
  const it = findInteract(p, G, true);
  if (!it || !it.instant) return;
  if (it.kind === 'drop') {
    const b = it.b;
    for (const k in b.items) giveItem(k, b.items[k], p.pid, b.x, b.y - 0.3 * Object.keys(b.items).indexOf(k));
    G.drops.splice(G.drops.indexOf(b), 1);
    sfxAt('pickup', b.x, b.y);
  } else if (it.kind === 'rescue') {
    const e = it.e; e.mode = 'follow'; e.follow = p.pid;
    say(`${e.title || e.def.name}: 고마워요! 따라갈게요.`, '#7dff9a', -1, 1); sfxAt('unlock', e.x, e.y);
  } else if (it.kind === 'survivor') {
    const e = it.e, nm = SURVIVOR_NAMES[e.name];
    if (e.mode === 'wait') { e.mode = 'follow'; e.follow = p.pid; say(`${nm}(${PERKS[e.perk].name}) 합류! ${PERKS[e.perk].desc}`, '#7dff9a', -1, 1); sfxAt('unlock', e.x, e.y); }
    else if (e.mode === 'follow') { e.mode = 'guard'; e.home = { x: e.x, y: e.y }; say(`${nm}: 여기를 지키겠습니다.`, '#cfe8ff', p.pid); }
    else { e.mode = 'follow'; e.follow = p.pid; say(`${nm}: 따라가겠습니다.`, '#cfe8ff', p.pid); }
  }
}
// ── vehicles: looted cars that still run can be driven (fuel, ramming, noise) ──
function enterCar(p, c) {
  for (const k of c.cells) { W.contAt[k] = null; updateCellMB(k); }
  c.gone = true; flowBaseDirty = true;
  p.veh = { id: c.id, color: c.color || "#5a6a8a", fuel: c.fuel || 0, spd: 0, ang: c.horiz ? 0 : -Math.PI / 2, hp: c.hp || 420 };
  p.x = c.x; p.y = c.y; p.r = 0.48;
  fx({ k: 'contgone', id: c.id }); fx({ k: 'tp', pid: p.pid, x: p.x, y: p.y });
  sfxAt('engine', p.x, p.y);
  say('시동을 걸었습니다 — 이동키로 운전, [E] 내리기. 소리가 큽니다!', '#cfe8ff', p.pid);
}
function exitCar(p, force) {
  const v = p.veh; if (!v) return true;
  const c = W.conts[v.id];
  const horiz = Math.abs(Math.cos(v.ang)) > Math.abs(Math.sin(v.ang));
  const free = i => !W.mb[i] && !W.contAt[i];
  for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2]]) {
    const x = Math.floor(p.x - (horiz ? 0.5 : 0)) + ox, y = Math.floor(p.y - (horiz ? 0 : 0.5)) + oy;
    if (!inMap(x, y) || !inMap(x + 1, y + 1)) continue;
    const a = idx(x, y), b = horiz ? idx(x + 1, y) : idx(x, y + 1);
    if (!free(a) || !free(b)) continue;
    const spots = horiz ? [[x + 1, y + 1.5], [x + 1, y - 0.5], [x - 0.5, y + 0.5], [x + 2.5, y + 0.5]] : [[x + 1.5, y + 1], [x - 0.5, y + 1], [x + 0.5, y - 0.5], [x + 0.5, y + 2.5]];
    const sp = spots.find(([sx, sy]) => inMap(Math.floor(sx), Math.floor(sy)) && !cellBlocked(idx(Math.floor(sx), Math.floor(sy)), 'player'));
    if (!sp) continue;
    c.cells = [a, b]; c.horiz = horiz; c.x = horiz ? x + 1 : x + 0.5; c.y = horiz ? y + 0.5 : y + 1; c.fuel = v.fuel; c.hp = v.hp; c.gone = false;
    for (const k of c.cells) { W.contAt[k] = c; updateCellMB(k); }
    flowBaseDirty = true;
    p.veh = null; p.r = 0.3; p.x = sp[0]; p.y = sp[1];
    fx({ k: 'contmove', id: c.id, cells: c.cells, x: c.x, y: c.y, horiz, fuel: c.fuel });
    fx({ k: 'tp', pid: p.pid, x: p.x, y: p.y });
    return true;
  }
  if (force) { p.veh = null; p.r = 0.3; return true; }
  say('여기서는 내릴 수 없습니다 — 넓은 곳에 세우세요', '#ff9a8a', p.pid);
  return false;
}
function wreckCar(p) {
  const v = p.veh; p.veh = null; p.r = 0.3;
  say('차량이 폭발합니다!', '#ff5c4c', -1, 1);
  explode(p.x, p.y, 70, 2.6, null);
  fx({ k: 'smoke', x: p.x, y: p.y });
  return v;
}
function updateDriving(p) {
  const v = p.veh;
  if (p.pid !== V.me && p.in.vs !== undefined) { v.spd = p.in.vs; v.ang = p.in.va; }
  if (p.in.use && !p.useLatch) { p.useLatch = true; exitCar(p); return; }
  if (!p.in.use) p.useLatch = false;
  const sp = Math.abs(v.spd);
  if (sp > 3) {
    const ca = Math.cos(v.ang), sa = Math.sin(v.ang);
    for (const e of G.ents) {
      if (e.dead || (e.team === 'player' && e.cat !== 'mob') || Math.abs(e.x - p.x) > 1.6 || Math.abs(e.y - p.y) > 1.6) continue;
      if (dist(e.x, e.y, p.x, p.y) > 0.55 + e.r || (e.carT || 0) > G.t) continue;
      e.carT = G.t + 0.35;
      damage(e, sp * (e.def.heavy ? 4 : 9), p, ca, sa);
      if (!e.dead) { e.vx += ca * sp * 0.03; e.vy += sa * sp * 0.03; }
      v.hp -= e.def.heavy ? 30 : 5; v.spd *= e.def.heavy ? 0.3 : 0.85;
      sfxAt('thud', e.x, e.y); fx({ k: 'blood', x: e.x, y: e.y, z: 1 });
    }
  }
  if (G.tick % 20 === 0 && sp > 0.5) makeNoise(p.x, p.y, 8 + sp, p);
  if (v.hp <= 0) wreckCar(p);
}
// Gathering, Minecraft-style: anything natural can be broken down for resources
const GATHER = {
  [T.TREE]:     { to: T.STUMP, time: 2.4, label: '나무 베기 (목재)', give: [['wood', 4, 6, 1]], sfx: 'chop', noise: 5 },
  [T.DEADTREE]: { to: T.STUMP, time: 1.6, label: '고목 베기 (목재)', give: [['wood', 2, 4, 1]], sfx: 'chop', noise: 5 },
  [T.ROCK]:     { to: T.GRAVEL, time: 3.4, label: '바위 깨기 (고철·광석)', give: [['scrap', 2, 4, 1], ['parts', 1, 1, 0.08], ['gold', 1, 1, 0.015]], sfx: 'thud', noise: 7 },
  [T.BUSH]:     { to: T.GRASS, time: 1.2, label: '덤불 뒤지기 (열매·약초)', give: [['food', 1, 1, 0.45], ['meds', 1, 1, 0.06], ['wood', 1, 1, 0.5]], sfx: 'swish', noise: 2 },
  [T.RUIN]:     { to: T.RUBBLE, time: 3.0, label: '잔해 해체 (고철·부품)', give: [['scrap', 3, 6, 1], ['parts', 1, 1, 0.25]], sfx: 'thud', noise: 8 },
  [T.RUBBLE]:   { to: T.DIRT, time: 1.4, label: '잔해 뒤지기', give: [['scrap', 1, 2, 0.8], ['cash', 2, 10, 0.25]], sfx: 'swish', noise: 3 },
  [T.CROP]:     { to: T.DIRT, time: 1.0, label: '작물 수확 (식량)', give: [['food', 1, 2, 0.8]], sfx: 'swish', noise: 1 },
};
// Looting is loud and slow. Every container rolls once for something to go wrong while you are in it:
// the dead push in through the door, something was hiding inside, a car alarm, or the owner comes home.
function lootTension(p, it) {
  const c = it.c;
  if (G.tick % 25 === 0) makeNoise(p.x, p.y, p.in.crouch ? 3 : 5.5, p);
  if (c.ev === undefined) {
    const bi = W.bldAt[idx(Math.floor(p.x), Math.floor(p.y))], b = bi >= 0 ? W.buildings[bi] : null;
    const dark = G.phase !== 'day' ? 0.15 : 0, lvl = Math.min(0.2, G.day * 0.02);
    const r = SR.f();
    c.ev = null;
    if (c.village >= 0) { if (it.steal && b && r < 0.4) c.ev = { k: 'owner', at: SR.r(0.2, 0.55), b }; }
    else if (b) { if (r < 0.12) c.ev = { k: 'closet', at: SR.r(0.3, 0.8) }; else if (r < 0.42 + dark + lvl) c.ev = { k: 'breakin', at: SR.r(0.15, 0.5), b }; }
    else if (c.kind === 'car') { if (r < 0.22 + lvl) c.ev = { k: 'alarm', at: SR.r(0.1, 0.6) }; }
    else if (r < 0.2 + dark) c.ev = { k: 'pack', at: SR.r(0.2, 0.6) };
  }
  const ev = c.ev;
  if (!ev || ev.done || p.useP < ev.at) return;
  ev.done = true;
  const lure = (e, hold) => { e.target = p; e.seenT = G.t + (hold || 8); };
  switch (ev.k) {
    case 'breakin': {
      const b = ev.b, door = SR.pick(b.doors);
      const ox = door[1] === b.y ? 0 : door[1] === b.y + b.h - 1 ? 0 : door[0] === b.x ? -1 : 1, oy = door[1] === b.y ? -1 : door[1] === b.y + b.h - 1 ? 1 : 0;
      const n = 2 + SR.i(2) + (G.day >= 4 ? 1 : 0) + (G.phase !== 'day' ? 1 : 0);
      const pool = BIOME_MOBS[W.biome[idx(door[0], door[1])]] || BIOME_MOBS[BIO.CITY];
      for (let k = 0; k < n; k++) {
        const d = 2 + k * 0.7, x = door[0] + 0.5 + ox * d + SR.r(-0.6, 0.6), y = door[1] + 0.5 + oy * d + SR.r(-0.6, 0.6);
        if (!inMap(Math.floor(x), Math.floor(y)) || blockedAt(x, y, 'zombie')) continue;
        const ok = pool.filter(m => (m[2] || 0) <= G.day && m[0] !== 'hound');
        lure(spawnMob(SR.pick(ok)[0], x, y, false), 12);
      }
      say('쿵… 쿵… 문 쪽에서 무언가 밀고 들어옵니다!', '#ff7a5c', p.pid, 1); sfxAt('door', door[0] + 0.5, door[1] + 0.5);
      fx({ k: 'alarmping', x: door[0] + 0.5, y: door[1] + 0.5 });
      break;
    }
    case 'closet': {
      const a = SR.r(0, TAU), x = c.x + Math.cos(a) * 0.9, y = c.y + Math.sin(a) * 0.9;
      const e = spawnMob(G.day >= 3 && SR.chance(0.4) ? 'stalker' : SR.pick(['walker', 'crawler']), blockedAt(x, y, 'zombie') ? p.x - Math.cos(p.angle) : x, blockedAt(x, y, 'zombie') ? p.y - Math.sin(p.angle) : y, false);
      lure(e); e.atkT = 0.4; e.revealT = 3;
      say('안에 숨어 있던 놈이 튀어나왔다!', '#ff5c4c', p.pid, 1); sfxAt('scream', c.x, c.y); fx({ k: 'hurt', pid: p.pid });
      p.useT = 0; p.useKey = null; p.useP = 0;
      break;
    }
    case 'alarm': {
      say('삐용삐용! 차량 경보가 울립니다 — 근처 좀비들이 몰려옵니다!', '#ff5c4c', p.pid, 1);
      sfxAt('alarm', c.x, c.y); makeNoise(c.x, c.y, 30, null);
      for (let k = 0; k < 4 + SR.i(4); k++) { const q = ringCell(SR, c.x, c.y, 14, 24); if (q) lure(spawnMob(SR.pick(['walker', 'walker', 'runner', 'crawler']), q.x, q.y, false), 14); }
      break;
    }
    case 'pack': {
      const n = 2 + SR.i(3);
      for (let k = 0; k < n; k++) { const q = ringCell(SR, p.x, p.y, 12, 18); if (q) lure(spawnMob(G.day >= 2 ? 'hound' : 'walker', q.x, q.y, false), 10); }
      say('으르렁… 소리를 듣고 무언가 다가옵니다', '#ffb36b', p.pid);
      break;
    }
    case 'owner': {
      const b = ev.b, door = b.doors[0];
      const h = spawnHuman('villager', door[0] + 0.5, door[1] + 0.5 + (door[1] === b.y ? -1.5 : 1.5), { village: c.village });
      h.goto = { x: c.x, y: c.y, t: G.t + 14 }; h.angle = Math.atan2(c.y - h.y, c.x - h.x);
      say('발소리… 집주인이 돌아오고 있습니다! 빨리 끝내거나 숨으세요', '#ffb36b', p.pid, 1); sfxAt('door', door[0] + 0.5, door[1] + 0.5);
      break;
    }
  }
}
function completeInteract(p, it) {
  const S = G.stash;
  switch (it.kind) {
    case 'revive': it.q.down = false; it.q.hp = 40; say(`${it.q.name} 부활!`, '#7dff9a'); break;
    case 'cont': {
      const c = it.c; c.looted = true; fx({ k: 'cont', id: c.id, v: 1 });
      const items = rollLoot(c.kind);
      questLootBonus(c, items);
      let n = 0; for (const k in items) giveItem(k, items[k], p.pid, c.x, c.y - 0.35 * n++);
      maybeNote(c);
      if (!n) fx({ k: 'float', x: c.x, y: c.y, text: '비어 있음', c: '#999' });
      sfxAt('pickup', c.x, c.y);
      if (it.steal) checkWitness(p, it, true);
      break;
    }
    case 'gather': {
      const g = GATHER[W.tile[it.i]]; if (!g) break;
      W.tile[it.i] = g.to; G.tileDiff[it.i] = g.to; updateCellMB(it.i); flowBaseDirty = true;
      fx({ k: 'tile', i: it.i, v: g.to });
      for (const [id, a, b, ch] of g.give) if (SR.chance(ch)) giveItem(id, a + SR.i(b - a + 1), p.pid, it.x, it.y);
      sfxAt(g.sfx, it.x, it.y); makeNoise(it.x, it.y, g.noise, p);
      p.useKey = null;
      break;
    }
    case 'trigger': useTrigger(p, it.tr); p.useKey = null; break;
    case 'drive': {
      const c = it.c; p.useKey = null;
      if (!(c.fuel > 5)) {
        if ((S.fuel || 0) < 1) { say('연료가 필요합니다 — 주유기·차량에서 구하거나 상인에게 사세요', '#ff9a8a', p.pid); break; }
        S.fuel--; c.fuel = 100;
      }
      enterCar(p, c);
      break;
    }
    case 'travel': {
      p.useKey = null;
      if (G.phase === 'night') { say('밤에는 이동할 수 없습니다 — 길이 너무 위험합니다', '#ff9a8a', p.pid); break; }
      if (S.food < 1) { say('식량이 부족합니다 (여정에 식량 1 필요)', '#ff9a8a', p.pid); break; }
      const dst = it.to === 'base' ? { x: G.core.x + 0.5, y: G.core.y + 2.5 } : (() => { const cf = G.structs.find(q => q.id === it.to); return cf && { x: cf.x, y: cf.y + 1.2 }; })();
      if (!dst) break;
      S.food--; G.clock = Math.min(G.clock + 60, DUSK - 1); // the trip takes an hour
      p.x = dst.x; p.y = dst.y; fx({ k: 'tp', pid: p.pid, x: p.x, y: p.y });
      say('먼 길을 돌아 도착했습니다 (1시간 경과)', '#cfe8ff', p.pid); sfxAt('place', p.x, p.y);
      break;
    }
    case 'turret': if (S.scrap >= 5) { S.scrap -= 5; it.s.ammo = Math.min(400, it.s.ammo + 100); sfxAt('reload', it.s.x, it.s.y); } else say('고철이 부족합니다', '#ff9a8a', p.pid); break;
    case 'repair': {
      const s = it.s, core = s.type === 'core', metal = s.type === 'wall_metal' || s.type === 'turret';
      const res = core || metal ? 'scrap' : 'wood', amt = core ? 5 : 2;
      if (S[res] < amt) { say(`${ITEMS[res].name}가 부족합니다`, '#ff9a8a', p.pid); break; }
      S[res] -= amt; s.hp = Math.min(s.maxHp, s.hp + (core ? 150 : s.maxHp * 0.25)); sfxAt('place', s.x, s.y);
      break;
    }
  }
}
// stealing: any villager/guard/trader who can see the thief raises the alarm
function checkWitness(p, it, final) {
  const v = it.c.village;
  if (v < 0 || G.vh[v] > 0) return;
  const night = G.phase === 'night';
  for (const e of G.ents) {
    if (e.dead || e.team !== 'village' || e.village !== v) continue;
    const range = (p.in.crouch ? 4.5 : 8) * (night ? 0.65 : 1);
    const d = dist(e.x, e.y, p.x, p.y);
    if (d > range) continue;
    const facing = Math.abs(angDiff(e.angle, Math.atan2(p.y - e.y, p.x - e.x))) < 1.15;
    if ((facing || d < 2) && los(e.x, e.y, p.x, p.y)) {
      e.alert = 3; e.target = p; e.seenT = G.t;
      villageHostile(v, '절도');
      return;
    }
  }
  if (final) say('들키지 않고 훔쳤습니다…', '#9fe6a0', p.pid);
}
function villageHostile(v, why) {
  G.vh[v] = 3;
  const V = W.villages[v];
  say(`${why} 발각! ${V.name}이(가) 적대적으로 변했습니다!`, '#ff5c4c', -1, 1);
  sfxAt('alarm', V.x + V.w / 2, V.y + V.h / 2);
  for (const e of G.ents) if (e.team === 'village' && e.village === v) e.alert = 3;
}

// ── commands from either peer ──────────────────────────────────────────────
function doCmd(pid, c) {
  const p = G.players[pid]; if (!p || G.over) return;
  const S = G.stash;
  switch (c.c) {
    case 'wpn': if (S.owned[c.w] && p.wpn !== c.w && !p.down) { p.wpn = c.w; p.reloadT = 0; p.fireT = 0.15; if (p.mag[c.w] === undefined) p.mag[c.w] = 0; sfxAt('switch', p.x, p.y); } break;
    case 'reload': if (!p.down) startReload(p); break;
    case 'tap': interactTap(p); break;
    case 'eat':
      if (S.food <= 0) say('식량이 없습니다', '#ff9a8a', pid);
      else if (p.hunger > 92) say('배가 부릅니다', '#ccc', pid);
      else { S.food--; p.hunger = Math.min(100, p.hunger + 40); sfxAt('eat', p.x, p.y); }
      break;
    case 'heal':
      if (p.hp >= p.maxHp) say('체력이 가득합니다', '#ccc', pid);
      else if ((S.bandage || 0) > 0 && (p.hp > p.maxHp - 40 || S.meds <= 0)) { S.bandage--; p.healT = 1; sfxAt('eat', p.x, p.y); }
      else if (S.meds <= 0) say('의약품·붕대가 없습니다', '#ff9a8a', pid);
      else { S.meds--; p.healT = 2; sfxAt('eat', p.x, p.y); }
      break;
    case 'adren':
      if ((S.adrenaline || 0) <= 0) say('아드레날린이 없습니다', '#ff9a8a', pid);
      else { S.adrenaline--; p.adrT = 12; p.hp = Math.min(p.maxHp, p.hp + 15); say('💉 아드레날린! 12초간 기력 무한·피해 감소', '#ffd166', pid); sfxAt('eat', p.x, p.y); }
      break;
    case 'molotov': {
      if ((S.molotov || 0) <= 0 || p.down) { say('화염병이 없습니다', '#ff9a8a', pid); break; }
      S.molotov--;
      const d = clamp(c.d || 6, 2, 9), a = p.angle, sp = d * 0.95;
      G.shots.push({ k: 'molotov', x: p.x, y: p.y, z: 0.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 3.2, life: 1.9, dmg: 0, team: 'player', owner: p });
      sfxAt('throw', p.x, p.y);
      break;
    }
    case 'craft': {
      const r = RECIPES.find(q => q.id === c.id);
      if (!r || dist(p.x, p.y, G.bench.x, G.bench.y) > 3.5) break;
      if (!canAfford(r.cost)) { say('재료가 부족합니다', '#ff9a8a', pid); break; }
      pay(r.cost); giveItem(r.id, r.n, pid, G.bench.x, G.bench.y - 0.5); sfxAt('place', p.x, p.y);
      break;
    }
    case 'q': questAction(pid, c); break;
    case 'grenade': {
      if (S.grenade <= 0 || p.down) { say('수류탄이 없습니다', '#ff9a8a', pid); break; }
      S.grenade--;
      const d = clamp(c.d || 6, 2, 9), a = p.angle, sp = d * 0.95;
      G.shots.push({ k: 'grenade', x: p.x, y: p.y, z: 0.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 3.2, life: 1.9, dmg: 160, team: 'player', owner: p });
      sfxAt('throw', p.x, p.y);
      break;
    }
    case 'build': {
      const def = STRUCTS[c.t]; if (!def) break;
      if (!canPlace(c.t, c.cell)) { say('여기에는 지을 수 없습니다', '#ff9a8a', pid); break; }
      if (!canAfford(def.cost)) { say('재료가 부족합니다', '#ff9a8a', pid); break; }
      pay(def.cost); const s = addStruct(c.t, [c.cell]);
      fx({ k: 'float', x: s.x, y: s.y, text: def.name, c: '#cfe8ff' }); sfxAt('place', s.x, s.y);
      break;
    }
    case 'demolish': {
      const s = W.structAt[c.cell];
      if (!s || s.type === 'core' || s.type === 'bench') break;
      const def = STRUCTS[s.type], f = 0.5 * s.hp / s.maxHp;
      for (const k in def.cost) S[k] += Math.floor(def.cost[k] * f);
      removeStruct(s); sfxAt('place', s.x, s.y);
      break;
    }
    case 'buy': case 'sell': {
      const e = G.ents.find(q => q.id === c.npc);
      if (!e || e.dead || !e.def.shop || dist(e.x, e.y, p.x, p.y) > 3.5) break;
      if (e.team === 'merchant' ? G.merchantHostile : G.vh[e.village] > 0) break;
      const n = Math.max(1, c.n | 0), price = buyPrice(e, c.item);
      if (c.c === 'buy') {
        if ((e.stock[c.item] || 0) < n) { say('재고가 없습니다', '#ff9a8a', pid); break; }
        if (c.item.startsWith('wpn:') && S.owned[c.item.slice(4)]) { say('이미 가진 무기입니다', '#ccc', pid); break; }
        if (S.cash < price * n) { say('돈이 부족합니다', '#ff9a8a', pid); break; }
        S.cash -= price * n; e.stock[c.item] -= n; e.stock.cash = (e.stock.cash || 0) + price * n;
        giveItem(c.item, n, pid); sfxAt('buy', p.x, p.y);
      } else {
        if (!SELLABLE.includes(c.item) || (S[c.item] || 0) < n) break;
        const gain = Math.floor(price / 2) * n;
        if ((e.stock.cash || 0) < gain) { say('상인의 돈이 부족합니다', '#ff9a8a', pid); break; }
        S[c.item] -= n; S.cash += gain; e.stock[c.item] = (e.stock[c.item] || 0) + n; e.stock.cash -= gain; sfxAt('buy', p.x, p.y);
      }
      break;
    }
    case 'upg': {
      if (!S.owned[c.w] || !UPG_STATS[c.s] || dist(p.x, p.y, G.bench.x, G.bench.y) > 3.5) break;
      if (c.s === 'mag' && WEAPONS[c.w].melee) break;
      if ((c.s === 'reload' || c.s === 'mag') && WEAPONS[c.w].melee) break;
      const u = S.upg[c.w] || (S.upg[c.w] = { dmg: 0, mag: 0, rate: 0, reload: 0 });
      if (u[c.s] >= UPG_MAX) break;
      const cost = upgCost(c.w, u[c.s]);
      if (!canAfford(cost)) { say('재료가 부족합니다', '#ff9a8a', pid); break; }
      pay(cost); u[c.s]++;
      say(`${WEAPONS[c.w].name} ${UPG_STATS[c.s].name} Lv.${u[c.s]}`, '#ffd166', pid); sfxAt('unlock', p.x, p.y);
      break;
    }
  }
}

function buyPrice(e, item) { const rep = e && e.village >= 0 && G.Q ? G.Q.rep[e.village] || 0 : 0; return Math.max(1, Math.round(priceOf(item) * (1 - 0.08 * rep))); }

// ── mobs ───────────────────────────────────────────────────────────────────
function groundSlow(x, y) { const cx = Math.floor(x), cy = Math.floor(y); return inMap(cx, cy) ? TILE_SLOW[W.tile[idx(cx, cy)]] : 1; }
function stepToward(e, tx, ty, sp) {
  const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
  if (d < 0.01) return true;
  sp *= groundSlow(e.x, e.y);
  const s = Math.min(sp * DT, d);
  const before = e.x + e.y;
  const ok = moveActor(e, dx / d * s, dy / d * s);
  e.angle = Math.atan2(dy, dx);
  e.walk += s * 4;
  if (!ok && Math.abs(e.x + e.y - before) < s * 0.2) e.stuckT += DT; else e.stuckT = Math.max(0, e.stuckT - DT);
  return ok;
}
// follow a flow field one cell at a time; returns a struct blocking the way (to attack) or null
function flowMove(e, field, sp) {
  const cx = Math.floor(e.x), cy = Math.floor(e.y), c = idx(cx, cy);
  let best = -1, bv = field[c];
  if (bv >= FLOW_INF) return { lost: true };
  for (const [dx, dy] of N8) {
    const nx = cx + dx, ny = cy + dy; if (!inMap(nx, ny)) continue;
    const ni = idx(nx, ny), m = W.mb[ni];
    if (m & (MB_TERRAIN | MB_OBJ)) continue;
    if (dx && dy && ((W.mb[idx(nx, cy)] | W.mb[idx(cx, ny)]) & (MB_TERRAIN | MB_OBJ | MB_STRUCT))) continue;
    if (field[ni] < bv) { bv = field[ni]; best = ni; }
  }
  if (best < 0) return { arrived: true };
  const s = W.structAt[best];
  if (s && s.def.block) return { struct: s };
  // steer to the next cell centre, with a little lookahead so motion is smooth
  stepToward(e, cellX(best) + 0.5, cellY(best) + 0.5, sp);
  return {};
}
function perceive(e, range) {
  let best = null, bd = range;
  const consider = t => {
    if (Math.abs(t.x - e.x) >= bd || Math.abs(t.y - e.y) >= bd || !hostile(e, t)) return;
    const d = dist(e.x, e.y, t.x, t.y);
    if (d >= bd) return;
    if (d > 2.5 && !los(e.x, e.y, t.x, t.y)) return;
    bd = d; best = t;
  };
  for (const p of G.players) if (p && p.joined && !p.dead) consider(p);
  for (const t of G.ents) if (t.cat === 'human') consider(t);
  if (e.cat === 'human') for (const t of G.ents) if (t.cat === 'mob') consider(t);
  return best;
}
function updateMob(e) {
  const d0 = e.def;
  e.flash = Math.max(0, e.flash - 1);
  e.atkAnim = Math.max(0, e.atkAnim - DT * 3);
  if (e.atkT > 0) e.atkT -= DT;
  if (e.spitT > 0) e.spitT -= DT;
  if (e.skillT > 0) e.skillT -= DT;
  if (e.revealT > 0) e.revealT -= DT;
  if (e.dashT > 0) return dashStep(e);
  if (Math.abs(e.vx) + Math.abs(e.vy) > 0.002) { moveActor(e, e.vx, e.vy); e.vx *= 0.7; e.vy *= 0.7; return; }
  const night = G.phase === 'night';
  if ((G.tick + e.id) % 12 === 0) {
    const t = perceive(e, (night ? 6.5 : 8) * (d0.low ? 0.7 : 1));
    if (t) {
      if (!e.target && d0.scream && !e.screamed) scream(e);
      e.target = t; e.seenT = G.t;
    }
  }
  let t = e.target;
  if (t && (t.dead || (t.cat === 'player' && (t.down || !t.joined)) || G.t - e.seenT > 7 || !hostile(e, t))) { t = e.target = null; }
  // landmark guards don't chase forever
  if (t && e.home && dist(e.x, e.y, e.home.x, e.home.y) > (d0.boss ? 20 : 28)) { t = e.target = null; e.invest = null; }
  const sp = e.speed * (onSpikes(e) ? 0.45 : 1);

  if (t) {
    const d = dist(e.x, e.y, t.x, t.y);
    if (mobSkill(e, t, d)) return;
    const ranged = d0.spit || d0.fire;
    if (ranged && e.spitT <= 0 && d < ranged.range && d > 1.6 && los(e.x, e.y, t.x, t.y)) {
      const a = Math.atan2(t.y - e.y, t.x - e.x) + SR.r(-0.06, 0.06);
      e.angle = a; e.spitT = ranged.rate; e.atkAnim = 1;
      G.shots.push({ k: d0.fire ? 'fireball' : 'spit', x: e.x + Math.cos(a) * 0.5, y: e.y + Math.sin(a) * 0.5, vx: Math.cos(a) * ranged.speed, vy: Math.sin(a) * ranged.speed,
                     dmg: ranged.dmg, team: 'zombie', owner: e, life: 2.5 });
      sfxAt(d0.fire ? 'fireball' : 'spit', e.x, e.y);
      return;
    }
    if (d < d0.reach + t.r) {
      e.angle = Math.atan2(t.y - e.y, t.x - e.x);
      if (d0.explode) { kill(e, null); return; }
      if (e.atkT <= 0) { e.atkT = d0.atk; e.atkAnim = 1; damage(t, d0.dmg, e, (t.x - e.x) / (d || 1), (t.y - e.y) / (d || 1)); sfxAt('bite', e.x, e.y); }
      return;
    }
    if (d0.spit && d < 3.5 && los(e.x, e.y, t.x, t.y)) { stepToward(e, e.x - (t.x - e.x), e.y - (t.y - e.y), sp * 0.8); return; }
    if (t.cat === 'player' && (d > 8 || e.stuckT > 0.5 || !los(e.x, e.y, t.x, t.y))) {
      const r = flowMove(e, flowPl, sp);
      if (r.struct) return attackStruct(e, r.struct);
      if (!r.lost) return;
    }
    stepToward(e, t.x, t.y, sp);
    if (e.stuckT > 1.5) { const r = flowMove(e, flowBase, sp); if (r.struct) attackStruct(e, r.struct); }
    return;
  }
  if (e.hunt !== undefined) { // a night horde that tracks a player by scent
    const p = G.players[e.hunt];
    if (p && p.joined && !p.dead && !p.down) { e.target = p; e.seenT = G.t; return; }
    e.hunt = undefined;
  }
  if ((night || e.wave) && !e.home) {
    const r = flowMove(e, flowBase, sp);
    if (r.struct) return attackStruct(e, r.struct);
    if (r.lost && e.wave) { stepToward(e, G.core.x, G.core.y, sp); return; }
    if (!r.lost && !r.arrived) return;
  }
  if (e.home && !e.invest && dist(e.x, e.y, e.home.x, e.home.y) > e.home.r) { stepToward(e, e.home.x, e.home.y, sp * 0.6); if (e.stuckT > 2) { e.x = e.home.x; e.y = e.home.y; e.stuckT = 0; } return; }
  if (e.invest) {
    if (G.t > e.invest.t || dist(e.x, e.y, e.invest.x, e.invest.y) < 1) e.invest = null;
    else { stepToward(e, e.invest.x, e.invest.y, sp * 0.8); if (e.stuckT > 1) e.invest = null; return; }
  }
  // idle wander
  if ((e.wanderT -= DT) <= 0) { e.wanderT = SR.r(2, 5); const a = SR.r(0, TAU), r = SR.r(1, 4); e.wx = e.x + Math.cos(a) * r; e.wy = e.y + Math.sin(a) * r; if (SR.chance(0.4)) { e.wx = e.x; e.wy = e.y; } }
  stepToward(e, e.wx, e.wy, sp * 0.35);
}
// special moves; return true if the mob used its turn
function mobSkill(e, t, d) {
  const d0 = e.def;
  if (d0.brood && e.skillT <= 0) {
    e.skillT = 5.5; e.atkAnim = 1;
    let near = 0; for (const o of G.ents) if (o.kind === 'crawler' && dist(o.x, o.y, e.x, e.y) < 10) near++;
    if (near < 10) for (let k = 0; k < 2; k++) { const p = randomFreeCell(SR, e.x - 2, e.y - 2, e.x + 2, e.y + 2); if (p) { const c = spawnMob('crawler', p.x, p.y, false, { home: e.home }); c.target = t; c.seenT = G.t; } }
    fx({ k: 'splat', x: e.x, y: e.y, r: 1.2 }); sfxAt('spit', e.x, e.y);
  }
  if (d0.charge && e.skillT <= 0 && d > 2.5 && d < 10 && los(e.x, e.y, t.x, t.y)) {
    const a = Math.atan2(t.y - e.y, t.x - e.x);
    e.skillT = 6; e.dashT = 0.9; e.dsp = 9; e.dvx = Math.cos(a); e.dvy = Math.sin(a); e.angle = a; e.dashHit = false; e.atkAnim = 1;
    fx({ k: 'scream', x: e.x, y: e.y }); sfxAt('horn', e.x, e.y); return true;
  }
  if (d0.blink && e.skillT <= 0 && d > 2.5 && d < 12) {
    const a = Math.atan2(t.y - e.y, t.x - e.x);
    e.skillT = 3.5 + SR.f() * 2; e.dashT = Math.min(0.45, (d + 1.2) / 18); e.dsp = 18; e.dvx = Math.cos(a); e.dvy = Math.sin(a); e.dashHit = false;
    fx({ k: 'smoke', x: e.x, y: e.y }); sfxAt('swish', e.x, e.y); return true;
  }
  if (d0.lunge && e.skillT <= 0 && d > 1.4 && d < 5 && los(e.x, e.y, t.x, t.y)) {
    const a = Math.atan2(t.y - e.y, t.x - e.x);
    e.skillT = 3; e.dashT = 0.35; e.dsp = 9; e.dvx = Math.cos(a); e.dvy = Math.sin(a); e.dashHit = false; e.revealT = 2; e.atkAnim = 1;
    sfxAt('scream', e.x, e.y); return true;
  }
  return false;
}
function dashStep(e) {
  e.dashT -= DT;
  const vx = e.dvx * e.dsp * DT, vy = e.dvy * e.dsp * DT;
  const ok = moveActor(e, vx, vy);
  e.walk += 0.6;
  if (!e.dashHit) for (const o of allActors()) {
    if (!hostile(e, o) || dist(o.x, o.y, e.x, e.y) > e.r + o.r + 0.25) continue;
    e.dashHit = true; damage(o, e.def.dmg * (e.def.charge ? 1.2 : 1), e, e.dvx, e.dvy);
    if (o.cat !== 'player') { o.vx += e.dvx * 0.25; o.vy += e.dvy * 0.25; }
    sfxAt('bite', e.x, e.y); break;
  }
  if (!ok && e.def.charge) { // smashes whatever stopped it
    const s = W.structAt[idx(Math.floor(e.x + e.dvx * 0.8), Math.floor(e.y + e.dvy * 0.8))];
    if (s) { damageStruct(s, 260, e); fx({ k: 'debris', x: s.x, y: s.y, c: '#888' }); }
    e.dashT = 0; fx({ k: 'boom', x: +e.x.toFixed(2), y: +e.y.toFixed(2), r: 0.8 });
  }
}
function attackStruct(e, s) {
  e.angle = Math.atan2(s.y - e.y, s.x - e.x);
  if (e.def.explode) { kill(e, null); return; }
  if (e.atkT > 0) return;
  const dmg = e.cat === 'mob' ? e.def.dmg * (e.def.structMul || 1) : 14;
  e.atkT = e.cat === 'mob' ? e.def.atk : 1.0; e.atkAnim = 1;
  damageStruct(s, dmg, e);
  sfxAt(s.type === 'wall_metal' ? 'clang' : 'thud', s.x, s.y);
}
function scream(e) {
  e.screamed = true; e.atkAnim = 1;
  fx({ k: 'scream', x: e.x, y: e.y });
  sfxAt('scream', e.x, e.y);
  makeNoise(e.x, e.y, 18, null);
  for (let k = 0; k < 3; k++) { const p = randomFreeCell(SR, e.x - 3, e.y - 3, e.x + 3, e.y + 3); if (p) spawnMob('runner', p.x, p.y, true); }
}
function onSpikes(e) {
  const s = W.structAt[idx(Math.floor(e.x), Math.floor(e.y))];
  return s && s.type === 'spikes';
}

// ── humans ─────────────────────────────────────────────────────────────────
function pathTo(e, tx, ty, sp) {
  const d = dist(e.x, e.y, tx, ty);
  if (d < 0.25) return true;
  if (d < 5 && los(e.x, e.y, tx, ty) && e.stuckT < 0.4) { stepToward(e, tx, ty, sp); return false; }
  const goalKey = Math.floor(tx) + ',' + Math.floor(ty);
  if (!e.path || G.t > e.pathT || e.pathGoal !== goalKey || e.stuckT > 0.6) {
    e.path = findPath(e.x, e.y, tx, ty, e.team, 2500); e.pathT = G.t + 1 + SR.f(); e.pathGoal = goalKey; e.stuckT = 0;
  }
  while (e.path.length && dist(e.x, e.y, cellX(e.path[0]) + 0.5, cellY(e.path[0]) + 0.5) < 0.3) e.path.shift();
  if (!e.path.length) { stepToward(e, tx, ty, sp); return false; }
  const n = e.path[0];
  const s = W.structAt[n];
  if (s && s.def.block && cellBlocked(n, e.team)) { e.blockStruct = s; return false; }
  stepToward(e, cellX(n) + 0.5, cellY(n) + 0.5, sp);
  return false;
}
function npcFire(e, t) {
  const w = WEAPONS[e.wpn];
  if (e.reloadT > 0) { e.reloadT -= DT; if (e.reloadT <= 0) e.mag = w.mag; return; }
  if (e.fireT > 0) return;
  const want = Math.atan2(t.y - e.y, t.x - e.x);
  if (Math.abs(angDiff(e.angle, want)) > 0.25) return;
  if (w.melee) { if (dist(e.x, e.y, t.x, t.y) < w.range + t.r) { melee(e, w.dmg * 0.6, w.range, w.arc); e.fireT = w.rate * 2; } return; }
  if (e.mag <= 0) { e.reloadT = w.reload * 1.3; return; }
  e.mag--;
  const ally = e.team === 'player', perk = e.perk === 'guard' ? 1.4 : 1;
  fireGun(e, e.wpn, e.angle, { spreadMul: 2.4 / e.def.acc / perk, dmgMul: (ally ? 0.8 : t.cat === 'player' ? 0.45 : 0.7) * perk });
  e.fireT = w.rate * (w.auto ? 1.5 : 2.2) * SR.r(0.9, 1.3);
}
function updateHuman(e) {
  const d0 = e.def;
  e.flash = Math.max(0, e.flash - 1);
  e.atkAnim = Math.max(0, e.atkAnim - DT * 3);
  if (e.fireT > 0) e.fireT -= DT;
  if (e.skillT > 0) e.skillT -= DT;
  if (e.alert > 0) e.alert -= DT;
  if (Math.abs(e.vx) + Math.abs(e.vy) > 0.002) { moveActor(e, e.vx, e.vy); e.vx *= 0.7; e.vy *= 0.7; }
  const night = G.phase === 'night';
  if ((G.tick + e.id) % 10 === 0) {
    const t = perceive(e, (e.kind === 'bandit_sniper' ? 14 : e.kind === 'guard' ? 11 : 9) * (night ? 0.75 : 1));
    if (t && (!e.target || dist(e.x, e.y, t.x, t.y) < dist(e.x, e.y, e.target.x, e.target.y) - 1)) { e.target = t; e.seenT = G.t; }
    else if (e.target && !e.target.dead && los(e.x, e.y, e.target.x, e.target.y) && dist(e.x, e.y, e.target.x, e.target.y) < 14) e.seenT = G.t;
    // "eye" indicator: a villager who could catch you stealing
    e.sees = false;
    if (e.team === 'village' && G.vh[e.village] <= 0) {
      for (const p of G.players) if (p && p.joined && !p.dead) {
        const d = dist(e.x, e.y, p.x, p.y), range = (p.in.crouch ? 4.5 : 8) * (night ? 0.65 : 1);
        if (d < range && (Math.abs(angDiff(e.angle, Math.atan2(p.y - e.y, p.x - e.x))) < 1.15 || d < 2) && los(e.x, e.y, p.x, p.y)) e.sees = true;
      }
    }
  }
  let t = e.target;
  if (t && (t.dead || G.t - e.seenT > 6 || !hostile(e, t))) t = e.target = null;
  const hpk = e.hp / e.maxHp;
  const sp = e.speed;

  // flee: civilians, or badly hurt non-bosses
  if (t && (d0.coward || (hpk < 0.3 && !d0.boss && e.kind !== 'guard' && e.team !== 'player' && !d0.shop))) {
    const a = Math.atan2(e.y - t.y, e.x - t.x);
    pathTo(e, e.x + Math.cos(a) * 6, e.y + Math.sin(a) * 6, sp * 1.1);
    if (e.team === 'village') e.alert = 1;
    return;
  }
  if (t && e.wpn) return combat(e, t);
  if (e.kind === 'villager' && e.village >= 0 && G.vh[e.village] > 0) {
    // stay indoors / away from players when the village is hostile
    const p = G.players.find(q => q && q.joined && !q.dead && dist(q.x, q.y, e.x, e.y) < 7);
    if (p) { const a = Math.atan2(e.y - p.y, e.x - p.x); pathTo(e, e.x + Math.cos(a) * 5, e.y + Math.sin(a) * 5, sp); return; }
  }
  if (e.goto) {
    if (G.t > e.goto.t || dist(e.x, e.y, e.goto.x, e.goto.y) < 1.2) { e.goto = null; e.wanderT = 0; }
    else { pathTo(e, e.goto.x, e.goto.y, sp * 0.75); return; }
  }
  // idle roles
  if (e.kind === 'elder') { if (dist(e.x, e.y, e.home.x, e.home.y) > 0.5) pathTo(e, e.home.x, e.home.y, sp); else faceNearestPlayer(e); return; }
  switch (e.team === 'player' && e.mode !== 'idle' ? e.mode : e.team) {
    case 'wait': {
      const z = G.ents.find(m => m.cat === 'mob' && dist(m.x, m.y, e.x, e.y) < 3);
      if (z) { const a = Math.atan2(e.y - z.y, e.x - z.x); stepToward(e, e.x + Math.cos(a), e.y + Math.sin(a), sp * 0.6); }
      return;
    }
    case 'follow': {
      const p = G.players[e.follow] && !G.players[e.follow].dead ? G.players[e.follow] : alivePlayers()[0];
      if (!p) return;
      if (dist(e.x, e.y, p.x, p.y) > 2.4) pathTo(e, p.x, p.y, sp * (dist(e.x, e.y, p.x, p.y) > 6 ? 1.3 : 1));
      else e.angle += angDiff(e.angle, p.angle) * 0.05;
      return;
    }
    case 'guard': if (dist(e.x, e.y, e.home.x, e.home.y) > 0.6) pathTo(e, e.home.x, e.home.y, sp); return;
    case 'bandit': {
      if (e.mode === 'raid') {
        const r = flowMove(e, flowBase, sp);
        if (r.struct) { e.angle = Math.atan2(r.struct.y - e.y, r.struct.x - e.x); if (e.fireT <= 0) { e.fireT = 0.9; e.atkAnim = 1; damageStruct(r.struct, 22, e); sfxAt(e.wpn === 'machete' ? 'thud' : 'pistol', e.x, e.y); } }
        return;
      }
      return wanderIn(e, W.camps[e.camp], sp * 0.5);
    }
    case 'village': {
      if (e.def.shop) { if (dist(e.x, e.y, e.home.x, e.home.y) > 0.5) pathTo(e, e.home.x, e.home.y, sp); else faceNearestPlayer(e); return; }
      return wanderIn(e, W.villages[e.village], sp * 0.45);
    }
    case 'military': {
      if (e.def.shop) { if (dist(e.x, e.y, e.home.x, e.home.y) > 0.5) pathTo(e, e.home.x, e.home.y, sp); else faceNearestPlayer(e); return; }
      return wanderIn(e, poiOf('military'), sp * 0.4);
    }
    case 'cult': return wanderIn(e, poiOf('church'), sp * 0.45);
    case 'merchant': {
      if (G.phase !== 'day' && G.phase !== 'dawn') { pathTo(e, W.base.cx + 0.5, W.base.cy - 40, sp); if (e.y < W.base.cy - 30 && !G.players.some(p => p && dist(p.x, p.y, e.x, e.y) < 16)) e.dead = true; return; }
      if (dist(e.x, e.y, e.home.x, e.home.y) > 0.5) pathTo(e, e.home.x, e.home.y, sp); else faceNearestPlayer(e);
      return;
    }
  }
}
function faceNearestPlayer(e) {
  const p = G.players.filter(q => q && q.joined && !q.dead).sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y))[0];
  if (p && dist(p.x, p.y, e.x, e.y) < 6) e.angle += angDiff(e.angle, Math.atan2(p.y - e.y, p.x - e.x)) * 0.1;
}
function wanderIn(e, area, sp) {
  if (!area) return;
  if ((e.wanderT -= DT) <= 0) {
    e.wanderT = SR.r(3, 8);
    const p = randomFreeCell(SR, area.x + 1, area.y + 1, area.x + area.w - 1, area.y + area.h - 1, e.team);
    if (p && SR.chance(0.7)) { e.wx = p.x; e.wy = p.y; } else { e.wx = e.x; e.wy = e.y; }
  }
  if (dist(e.x, e.y, e.wx, e.wy) > 0.4) pathTo(e, e.wx, e.wy, sp);
  else if (SR.chance(0.01)) e.angle += SR.r(-1.5, 1.5);
}
function combat(e, t) {
  const w = WEAPONS[e.wpn], d = dist(e.x, e.y, t.x, t.y);
  const see = los(e.x, e.y, t.x, t.y);
  const want = Math.atan2(t.y - e.y, t.x - e.x);
  e.angle += clamp(angDiff(e.angle, want), -0.2, 0.2);
  const sp = e.speed;
  // survivors on guard duty don't wander off chasing
  const leash = e.kind === 'survivor' && e.mode === 'guard' ? 1 : e.kind === 'survivor' ? 0.5 : 0;
  if (w.melee) {
    if (d > w.range + t.r - 0.2) pathTo(e, t.x, t.y, sp * 1.1);
    npcFire(e, t);
    return;
  }
  const pref = e.def.keepFar ? 11 : e.wpn === 'shotgun' ? 3.5 : Math.min(w.range * 0.5, 7);
  if (!see || d > w.range * 0.9) {
    if (leash === 1) return;
    pathTo(e, t.x, t.y, sp);
    if (e.blockStruct && e.team !== 'player') { const s = e.blockStruct; e.blockStruct = null; e.angle = Math.atan2(s.y - e.y, s.x - e.x); if (e.fireT <= 0) { e.fireT = 0.9; damageStruct(s, 18, e); sfxAt('thud', s.x, s.y); } }
  } else if (d < pref - 2) {
    stepToward(e, e.x - Math.cos(want), e.y - Math.sin(want), sp * 0.8);
    e.angle = want;
  } else if (leash !== 1) {
    if ((e.strafeT -= DT) <= 0) { e.strafeT = SR.r(0.8, 2); e.strafe = SR.chance(0.5) ? 1 : -1; if (SR.chance(0.25)) e.strafe = 0; }
    if (e.strafe) { const sa = want + e.strafe * Math.PI / 2; stepToward(e, e.x + Math.cos(sa), e.y + Math.sin(sa), sp * 0.55); e.angle = want; }
  }
  if (see && e.def.molotov && e.skillT <= 0 && d > 2.5 && d < 8.5) {
    e.skillT = 5 + SR.f() * 3; e.atkAnim = 1;
    const a = want + SR.r(-0.1, 0.1), sp2 = d * 0.95;
    G.shots.push({ k: 'molotov', x: e.x, y: e.y, z: 0.6, vx: Math.cos(a) * sp2, vy: Math.sin(a) * sp2, vz: 3.2, life: 1.9, dmg: 0, team: e.team, owner: e });
    sfxAt('throw', e.x, e.y); return;
  }
  if (see) npcFire(e, t);
}

// ── shots ──────────────────────────────────────────────────────────────────
function updateShots() {
  const keep = [];
  for (const s of G.shots) {
    s.life -= DT;
    if (s.k === 'grenade' || s.k === 'molotov') {
      s.vz -= 9 * DT; s.z += s.vz * DT;
      if (s.z <= 0) { s.z = 0; s.vz = Math.abs(s.vz) * 0.35; s.vx *= 0.6; s.vy *= 0.6; if (s.vz < 0.6) s.vz = 0; }
      const nx = s.x + s.vx * DT, ny = s.y + s.vy * DT;
      if (blockedAt(nx, s.y, 'player') && s.z < 0.8) s.vx *= -0.4; else s.x = nx;
      if (blockedAt(s.x, ny, 'player') && s.z < 0.8) s.vy *= -0.4; else s.y = ny;
      if (s.k === 'molotov' && s.z <= 0.05 && s.life < 1.6) s.life = 0;
      if (s.life <= 0) {
        if (s.k === 'molotov') { addHazard('fire', s.x, s.y, 1.9, 6, 24, s.team); fx({ k: 'boom', x: +s.x.toFixed(2), y: +s.y.toFixed(2), r: 1.2, fire: 1 }); sfxAt('fireball', s.x, s.y); makeNoise(s.x, s.y, 8, null); }
        else explode(s.x, s.y, s.dmg, 2.9, s.owner);
        continue;
      }
    } else {
      if (s.k === 'fireball') { s.vx *= 1.012; s.vy *= 1.012; }
      const steps = 3; let hit = false;
      for (let k = 0; k < steps && !hit; k++) {
        const nx = s.x + s.vx * DT / steps, ny = s.y + s.vy * DT / steps;
        const ci = inMap(Math.floor(nx), Math.floor(ny)) ? idx(Math.floor(nx), Math.floor(ny)) : -1;
        if (ci < 0 || TILE_OPAQUE[W.tile[ci]]) hit = true;
        else {
          const st = W.structAt[ci];
          if (st && st.def.block && s.team !== 'player') { hit = true; damageStruct(st, s.dmg * (s.k === 'rocket' ? 0 : 1), s.owner); }
          if (st && st.type === 'barrel' && s.team === 'player') hit = true;
          for (const e of allActors()) if (canHit(s.owner || { team: s.team }, e) && dist(nx, ny, e.x, e.y) < e.r + 0.15) { hit = true; if (s.k !== 'rocket') damage(e, s.dmg, s.owner, s.vx / 8, s.vy / 8); break; }
        }
        s.x = nx; s.y = ny;
      }
      if (hit || s.life <= 0) {
        if (s.k === 'rocket') explode(s.x, s.y, s.dmg, 3, s.owner);
        else fx({ k: s.k === 'spit' ? 'splat' : 'boom', x: s.x, y: s.y, r: 0.6, fire: 1 });
        continue;
      }
    }
    keep.push(s);
  }
  G.shots = keep;
}

// ── structures tick ────────────────────────────────────────────────────────
function updateStructs() {
  for (const s of G.structs.slice()) {
    s.flash = Math.max(0, s.flash - 1);
    if (s.type === 'campfire' && G.tick % 25 === 0) for (const p of G.players) if (p && p.joined && !p.dead && !p.down && dist(p.x, p.y, s.x, s.y) < 3.5) p.hp = Math.min(p.maxHp, p.hp + 1.5);
    if (s.type === 'turret') {
      if (s.fireT > 0) s.fireT -= DT;
      if ((G.tick + s.id) % 6 === 0) {
        s.tgt = null; let bd = 9;
        for (const e of G.ents) {
          if (e.team !== 'zombie' && e.team !== 'bandit' && !(e.team === 'village' && G.vh[e.village] > 0)) continue;
          const d = dist(s.x, s.y, e.x, e.y);
          if (d < bd && los(s.x, s.y, e.x, e.y)) { bd = d; s.tgt = e; }
        }
      }
      if (s.tgt && !s.tgt.dead) {
        const want = Math.atan2(s.tgt.y - s.y, s.tgt.x - s.x);
        s.angle += clamp(angDiff(s.angle, want), -0.25, 0.25);
        if (s.ammo > 0 && s.fireT <= 0 && Math.abs(angDiff(s.angle, want)) < 0.15) {
          s.ammo--; s.fireT = 0.16;
          const sh = { team: 'player', cat: 'turret', x: s.x, y: s.y };
          hitscan(sh, s.x + Math.cos(s.angle) * 0.5, s.y + Math.sin(s.angle) * 0.5, s.angle + SR.r(-0.04, 0.04), 9, 12, 1);
          fx({ k: 'flash', x: s.x + Math.cos(s.angle) * 0.5, y: s.y + Math.sin(s.angle) * 0.5, a: s.angle });
          sfxAt('turret', s.x, s.y);
          makeNoise(s.x, s.y, 8, null);
        }
      }
    } else if (s.type === 'spikes' || s.type === 'mine') {
      const c = s.cells[0], x = cellX(c), y = cellY(c);
      for (const e of G.ents) {
        if (Math.floor(e.x) !== x || Math.floor(e.y) !== y || e.team === 'player' || e.team === 'village' || e.team === 'merchant') continue;
        if (s.type === 'mine') { if (s.fuse < 0) { s.fuse = 0.3; sfxAt('beep', s.x, s.y); } }
        else { damage(e, 26 * DT, { team: 'player', cat: 'trap' }); s.hp -= 3 * DT; if (s.hp <= 0) destroyStruct(s); }
      }
      if (s.fuse >= 0 && (s.fuse -= DT) < 0 && !s.dead) { s.dead = true; removeStruct(s); explode(s.x, s.y, 140, 2.7, { team: 'player', cat: 'trap' }); }
    }
  }
  // survivors' perks (once a second)
  if (G.tick % FPS === 0) {
    for (const e of G.ents) {
      if (e.kind !== 'survivor' || e.mode === 'wait' || e.dead) continue;
      if (e.perk === 'mechanic' && inBase(e.x, e.y) && G.phase === 'day') {
        const s = G.structs.filter(q => q.hp < q.maxHp && q.type !== 'bench').sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        if (s) { s.hp = Math.min(s.maxHp, s.hp + (s.type === 'core' ? 15 : 10)); }
      } else if (e.perk === 'medic') {
        for (const p of G.players) if (p && p.joined && !p.dead && !p.down && dist(p.x, p.y, e.x, e.y) < 5) p.hp = Math.min(p.maxHp, p.hp + 2);
        for (const o of G.ents) if (o.team === 'player' && dist(o.x, o.y, e.x, e.y) < 5) o.hp = Math.min(o.maxHp, o.hp + 2);
      }
    }
  }
}

// ── day / night ────────────────────────────────────────────────────────────
function phaseOf(c) { return c >= DAWN && c < DUSK ? 'day' : c >= DUSK && c < NIGHT ? 'dusk' : c >= LATE && c < DAWN ? 'dawn' : 'night'; }
function updateClock() {
  G.clock += MIN_PER_TICK;
  if (G.clock >= 1440) G.clock -= 1440;
  const ph = phaseOf(G.clock);
  if (ph !== G.phase) {
    G.phase = ph;
    if (ph === 'dusk') say('해가 지고 있습니다… 기지로 돌아가 방어를 준비하세요!', '#ffb36b', -1, 1);
    if (ph === 'night') startNight();
    if (ph === 'dawn') say('곧 날이 밝습니다. 조금만 더 버티세요!', '#ffe9a8', -1, 1);
    if (ph === 'day') startDay();
  }
  // bandit raid
  if (G.raidAt >= 0 && G.phase === 'day' && G.clock >= G.raidAt) { G.raidAt = -1; startRaid(); }
}
function startNight() {
  const n = ++G.nightN;
  const total = Math.min(260, Math.round((20 + 12 * n + 2.2 * n * n) * (G.Q && G.Q.lines.cure === 'c6' ? 1.35 : 1)));
  const kinds = Object.keys(MOBS).filter(k => MOBS[k].minNight <= n);
  const dirs = [0, 1, 2, 3].sort(() => SR.f() - 0.5).slice(0, n >= 5 ? 3 : n >= 2 ? 2 : 1);
  const offs = [0.4, 2.0, 3.8, 5.6, 7.0]; // game hours after 20:00
  G.waves = offs.map((h, k) => ({ at: h * 60 / MIN_PER_TICK, n: Math.round(total / 5 * (k === 4 ? 1.4 : 1)), dir: dirs[k % dirs.length], kinds, k, boss: k === 4 && n % 4 === 0 }));
  G.waveIdx = 0; G.nightTick = 0;
  G.away = { dmg: 0, lost: [] };
  say(`${n}번째 밤 — 좀비 무리가 몰려옵니다!`, '#ff5c4c', -1, 1);
  sfxAt('horn', W.base.cx, W.base.cy);
}
const BASE_NEAR = 95; // a player this close to the core draws the horde to the base
const baseDefended = () => G.players.some(p => p && p.joined && !p.dead && dist(p.x, p.y, G.core.x, G.core.y) < BASE_NEAR);
// nobody home: the horde hits the base "off screen"; turrets, guards and walls soak it up
function siegeOffscreen(wv) {
  let power = wv.n * 7 * (wv.boss ? 1.6 : 1);
  for (const s of G.structs) if (s.type === 'turret' && s.ammo > 0 && power > 0) { const use = Math.min(s.ammo, 30); s.ammo -= use; power -= use * 2.2; }
  for (const e of G.ents) if (e.kind === 'survivor' && e.mode === 'guard' && inBase(e.x, e.y) && power > 0) { power -= 30; if (SR.chance(0.08)) { e.hp -= 60; if (e.hp <= 0) { kill(e, null); G.away.lost.push(SURVIVOR_NAMES[e.name]); } } }
  if (power <= 0) return;
  const walls = G.structs.filter(s => s.def.block && !INVULN[s.type] && s.type !== 'core' && s.type !== 'turret');
  for (let k = 0; k < 6 && power > 0 && walls.length; k++) { const w = SR.pick(walls); const d = Math.min(power, w.hp * 0.6); damageStruct(w, d, null); power -= d * 0.7; G.away.dmg += d; }
  if (power > 0) { const d = Math.min(power * 0.8, G.core.maxHp * 0.12); damageStruct(G.core, d, null); G.away.dmg += d; }
  if (G.tick % 3 === 0) say(`📻 기지가 습격받고 있습니다! (피해 ${Math.round(G.away.dmg)}) — 돌아가서 막으세요`, '#ff7a5c', -1, 0);
}
function startDay() {
  G.day++;
  say(`☀ ${G.day}일차 아침 — 밤을 버텨냈습니다!`, '#ffe9a8', -1, 1);
  if (G.away && G.away.dmg > 0) say(`기지 피해 보고: 구조물 피해 ${Math.round(G.away.dmg)}${G.away.lost.length ? ' · 전사: ' + G.away.lost.join(', ') : ''}`, '#ffb36b', -1, 1);
  G.away = null;
  G.waves = []; G.spawnQ = [];
  // respawn dead co-op players at the core
  for (const p of G.players) if (p && p.dead) { p.dead = false; p.down = false; p.hp = 60; p.x = G.core.x + 0.5; p.y = G.core.y + 2.5; fx({ k: 'tp', pid: p.pid, x: p.x, y: p.y }); }
  // survivors eat
  const crew = G.ents.filter(e => e.kind === 'survivor' && e.mode !== 'wait');
  for (const e of crew) {
    if (G.stash.food > 0) { G.stash.food--; e.hunger = 0; }
    else if (++e.hunger >= 2) { e.dead = true; say(`${SURVIVOR_NAMES[e.name]}이(가) 굶주림을 못 견디고 떠났습니다.`, '#ff8a7a'); }
    else say(`${SURVIVOR_NAMES[e.name]}: 배가 고파요… (식량 부족)`, '#ffb36b');
    if (!e.dead && e.perk === 'scavenger' && inBase(e.x, e.y)) {
      const it = rollLoot(SR.pick(['crate', 'cabinet', 'shelf']));
      for (const k in it) giveItem(k, it[k], -1);
      say(`${SURVIVOR_NAMES[e.name]}(수집가)이 물자를 구해 왔습니다.`, '#9fe6a0');
    }
  }
  // world refresh
  for (let v = 0; v < G.vh.length; v++) if (G.vh[v] > 0 && --G.vh[v] === 0) say(`${W.villages[v].name}의 분노가 가라앉았습니다.`, '#9fe6a0');
  for (const c of W.conts) if (c.looted && SR.chance(c.village >= 0 ? 0.6 : 0.2)) { c.looted = false; c.ev = undefined; fx({ k: 'cont', id: c.id, v: 0 }); }
  for (const e of G.ents) if (e.def.shop && e.kind === 'trader') e.stock = makeStock('trader', SR);
  if (!G.ents.some(e => e.kind === 'merchant')) spawnMerchant();
  else { const m = G.ents.find(e => e.kind === 'merchant'); m.stock = makeStock('merchant', SR); }
  G.merchantHostile = false;
  if (G.day % 3 === 0) for (const c of W.camps) {
    const n = everyone().filter(e => e.camp === c.id && !e.dead).length;
    for (let k = n; k < 6; k++) { const p = randomFreeCell(SR, c.x + 2, c.y + 2, c.x + c.w - 2, c.y + c.h - 2, 'bandit'); if (p) spawnHuman(SR.pick(['bandit_thug', 'bandit_gunner', 'bandit_smg', 'bandit_shotgun']), p.x, p.y, { camp: c.id }); }
  }
  for (let k = 0; k < 1 + SR.i(2); k++) spawnSurvivor();
  repopulateLandmarks();
  questOnDay();
  if (typeof saveGame === 'function') setTimeout(() => saveGame(false), 0);
  if (G.day >= 3 && SR.chance(0.45)) G.raidAt = (10 + SR.i(5)) * 60;
}
const POI_MOBS = { hospital: ['crawler', 'toxic', 'walker'], prison: ['riot', 'hound', 'walker'], lab: ['stalker', 'walker'], station: ['walker', 'runner', 'toxic'],
                   farm: ['hound', 'walker'], school: ['walker', 'crawler'], tower: ['walker', 'runner'], helipad: ['walker', 'runner'], ...POI_MOB_POOL };
function repopulateLandmarks() {
  const all = everyone();
  for (const P of W.pois) {
    const pool = POI_MOBS[P.key]; if (!pool) continue;
    if (G.players.some(p => p && inRect(p.x, p.y, P, 30))) continue;
    let have = 0; for (const e of all) if (e.cat === 'mob' && e.home && !e.dead && inRect(e.home.x, e.home.y, P)) have++;
    for (let k = have; k < (P.generic ? 5 : 6); k++) {
      const pt = randomFreeCell(SR, P.x + 2, P.y + 2, P.x + P.w - 2, P.y + P.h - 2); if (!pt) continue;
      const e = spawnMob(SR.pick(pool), pt.x, pt.y, false, { home: { x: pt.x, y: pt.y, r: 9 } });
      e.frozen = true; G.frozen.push(e); G.ents.splice(G.ents.indexOf(e), 1);
    }
  }
  const church = poiOf('church');
  if (church && !G.Q.flags.priestDead) {
    const n = all.filter(e => e.team === 'cult' && !e.dead).length;
    for (let k = n; k < 6; k++) { const pt = randomFreeCell(SR, church.x + 2, church.y + 13, church.x + church.w - 2, church.y + church.h - 2, 'cult'); if (pt) spawnHuman(SR.pick(['cultist', 'cultist', 'zealot']), pt.x, pt.y); }
  }
  const mil = poiOf('military');
  if (mil && !G.milHostile) {
    const n = all.filter(e => e.kind === 'soldier' && !e.dead).length;
    for (let k = n; k < 4; k++) { const pt = randomFreeCell(SR, mil.x + 3, mil.y + 12, mil.x + mil.w - 3, mil.y + mil.h - 6, 'military'); if (pt) spawnHuman('soldier', pt.x, pt.y); }
  }
}
function startRaid() {
  const n = Math.min(10, 3 + (G.day >> 1)), dir = SR.i(4);
  for (let k = 0; k < n; k++) {
    const c = ringCell(SR, W.base.cx, W.base.cy, 48, 60, dir * Math.PI / 2 - Math.PI / 2, 0.4, 'bandit');
    if (!c) continue;
    const h = spawnHuman(SR.pick(['bandit_thug', 'bandit_gunner', 'bandit_smg', 'bandit_shotgun', 'bandit_gunner']), c.x, c.y, { mode: 'raid' });
    h.mode = 'raid';
  }
  say(`약탈단 ${n}명이 ${['북', '동', '남', '서'][dir]}쪽에서 기지를 습격하러 옵니다!`, '#ff5c4c', -1, 1);
  G.warn = { dir, t: 8 };
  sfxAt('alarm', W.base.cx, W.base.cy);
}
// pick a wave kind by weight
function waveKind(kinds) {
  let tot = 0; for (const q of kinds) tot += MOBS[q].w;
  let r = SR.f() * tot;
  for (const q of kinds) if ((r -= MOBS[q].w) <= 0) return q;
  return 'walker';
}
function updateSpawns() {
  if (G.phase === 'night' || G.phase === 'dawn') {
    G.nightTick++;
    const wv = G.waves[G.waveIdx];
    const home = baseDefended();
    if (wv && G.nightTick >= wv.at - 8 * FPS && !wv.warned) {
      wv.warned = true; G.warn = home ? { dir: wv.dir, t: 10 } : null;
      say(home ? `웨이브 ${wv.k + 1}/${G.waves.length} — ${['북', '동', '남', '서'][wv.dir]}쪽에서 접근 중!${wv.boss ? (G.nightN % 8 === 0 ? ' 골리앗 출현!' : ' 피의 악마 출현!') : ''}`
               : `웨이브 ${wv.k + 1}/${G.waves.length} — 어둠 속에서 무언가 당신의 냄새를 쫓고 있습니다…`, '#ff7a5c', -1, 1);
    }
    if (wv && G.nightTick >= wv.at) {
      G.waveIdx++;
      if (home) {
        for (let k = 0; k < wv.n; k++) G.spawnQ.push({ kind: waveKind(wv.kinds), dir: SR.chance(0.8) ? wv.dir : SR.i(4) });
        if (wv.boss) G.spawnQ.push({ kind: G.nightN % 8 === 0 ? 'goliath' : 'fiend', dir: wv.dir });
      } else {
        // out in the wild: a smaller pack hunts each player, and the base takes the rest
        for (const p of alivePlayers()) for (let k = 0; k < Math.round(wv.n * 0.35); k++) G.spawnQ.push({ kind: waveKind(wv.kinds), hunt: p.pid });
        siegeOffscreen(wv);
      }
    }
  }
  if (G.spawnQ.length && G.tick % 4 === 0 && G.ents.length < 420) {
    const q = G.spawnQ.shift();
    if (q.hunt !== undefined) {
      const p = G.players[q.hunt];
      const c = p && ringCell(SR, p.x, p.y, 24, 34);
      if (c) { const e = spawnMob(q.kind, c.x, c.y, true); e.hunt = q.hunt; }
    } else {
      const c = ringCell(SR, W.base.cx, W.base.cy, 44, 58, q.dir * Math.PI / 2 - Math.PI / 2, 0.55);
      if (c) spawnMob(q.kind, c.x, c.y, true);
    }
  }
  if (G.tick % FPS === 0) ambientSpawns();
  if (G.warn && (G.warn.t -= DT) <= 0) G.warn = null;
}
// Minecraft-style ambient spawning: zombies appear out of sight around each player,
// with the mix decided by the biome, and despawn when everyone is far away.
function ambientSpawns() {
  const ps = alivePlayers(); if (!ps.length) return;
  const dark = G.phase === 'night' || G.phase === 'dusk' || G.phase === 'dawn';
  const cap = Math.min(80, 26 + G.day * 4) * (dark ? 1.5 : 1) / Math.max(1, ps.length * 0.75);
  for (const p of ps) {
    let n = 0;
    for (const e of G.ents) if (e.cat === 'mob' && !e.home && !e.wave && Math.abs(e.x - p.x) < 50 && Math.abs(e.y - p.y) < 50) n++;
    if (n >= cap) continue;
    for (let k = 0; k < (dark ? 3 : 2); k++) {
      const c = ringCell(SR, p.x, p.y, 23, 44);
      if (!c) continue;
      if (ps.some(q => dist(q.x, q.y, c.x, c.y) < 21) || villageAt(c.x, c.y) || dist(c.x, c.y, W.base.cx, W.base.cy) < 24) continue;
      if (W.bldAt[c.i] >= 0 && W.buildings[W.bldAt[c.i]].village >= 0) continue;
      const pool = BIOME_MOBS[W.biome[c.i]] || BIOME_MOBS[BIO.PLAINS];
      const ok = pool.filter(m => (m[2] || 0) <= G.day);
      let tot = 0; for (const m of ok) tot += m[1];
      let r = SR.f() * tot, kind = 'walker';
      for (const m of ok) if ((r -= m[1]) <= 0) { kind = m[0]; break; }
      const pack = kind === 'hound' ? 3 + SR.i(3) : kind === 'walker' && SR.chance(0.12) ? 4 + SR.i(5) : 1; // packs and small hordes
      for (let j = 0; j < pack; j++) {
        const e = spawnMob(kind, c.x + SR.r(-1.2, 1.2), c.y + SR.r(-1.2, 1.2), false);
        if (blockedAt(e.x, e.y, 'zombie')) { e.x = c.x; e.y = c.y; }
      }
    }
  }
}
// Minecraft-style chunk loading: anything far from every player is unloaded (frozen) and
// comes back when someone walks near again. Ambient zombies simply despawn.
const ACT_IN = 62, ACT_OUT = 82;
function activation(force) {
  const ps = G.players.filter(p => p && p.joined && !p.dead);
  if (!ps.length) return;
  const near = (x, y, r) => { for (const p of ps) if (Math.abs(p.x - x) < r && Math.abs(p.y - y) < r) return true; return false; };
  for (const e of G.ents) {
    if (e.dead || e.tag || e.wave || e.hunt !== undefined || e.mode === 'follow' || e.mode === 'raid' || e.mode === 'guard' || e.kind === 'merchant' || e.goto) continue;
    if (e.kind === 'survivor' && e.mode !== 'wait') continue;
    if (near(e.x, e.y, ACT_OUT)) continue;
    if (e.cat === 'mob' && !e.home) { e.dead = true; continue; } // despawn
    e.frozen = true; e.target = null; e.path = null; e.invest = null; G.frozen.push(e);
  }
  for (let k = G.frozen.length - 1; k >= 0; k--) {
    const e = G.frozen[k];
    if (e.dead || !near(e.x, e.y, ACT_IN)) continue;
    G.frozen.splice(k, 1); e.frozen = false; G.ents.push(e);
  }
  if (force) G.ents = G.ents.filter(e => !e.frozen && !e.dead);
}
const everyone = () => G.frozen.length ? G.ents.concat(G.frozen) : G.ents;

// ── flows & separation ─────────────────────────────────────────────────────
function updateFlows() {
  if (--flowBaseCD <= 0 && flowBaseDirty) { flowBaseDirty = false; flowBaseCD = 25; flowField(flowBase, G.core.cells, 1300); }
  if (--flowPlCD <= 0) {
    const ps = alivePlayers(), key = ps.map(p => idx(Math.floor(p.x), Math.floor(p.y))).join(',');
    if (key !== flowPlKey) { flowPlKey = key; flowPlCD = 8; flowField(flowPl, ps.map(p => idx(Math.floor(p.x), Math.floor(p.y))), 420); }
  }
}
const sepGrid = new Map();
function separate() {
  sepGrid.clear();
  for (const e of G.ents) { const k = Math.floor(e.x / 2) * 1024 + Math.floor(e.y / 2); let a = sepGrid.get(k); if (!a) sepGrid.set(k, a = []); a.push(e); }
  for (const e of G.ents) {
    const gx = Math.floor(e.x / 2), gy = Math.floor(e.y / 2);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const a = sepGrid.get((gx + ox) * 1024 + gy + oy); if (!a) continue;
      for (const o of a) {
        if (o.id <= e.id) continue;
        const dx = o.x - e.x, dy = o.y - e.y, d = Math.hypot(dx, dy), m = (e.r + o.r) * 0.85;
        if (d >= m || d < 1e-4) continue;
        const push = (m - d) * 0.5, nx = dx / d * push, ny = dy / d * push;
        const we = e.def.heavy ? 0.2 : 1, wo = o.def.heavy ? 0.2 : 1;
        moveActor(e, -nx * we, -ny * we); moveActor(o, nx * wo, ny * wo);
      }
    }
  }
  // mobs don't overlap players (the player's own position is authoritative on its owner)
  for (const p of G.players) {
    if (!p || !p.joined || p.dead) continue;
    for (const e of G.ents) {
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy), m = (e.r + p.r) * 0.9;
      if (d < m && d > 1e-4) moveActor(e, dx / d * (m - d), dy / d * (m - d));
    }
  }
}

// ── main tick ─────────────────────────────────────────────────────────────
function simTick() {
  if (G.over) return;
  G.tick++; G.t += DT;
  updateClock();
  updateFlows();
  for (const p of G.players) updatePlayer(p);
  // level of detail: things far from every player think less often
  const lodPass = G.tick % 25 === 0, ps = lodPass ? G.players.filter(p => p && p.joined && !p.dead) : null;
  for (const e of G.ents) {
    if (e.dead) continue;
    if (lodPass) { let m = 1e9; for (const p of ps) { const d = Math.abs(p.x - e.x) + Math.abs(p.y - e.y); if (d < m) m = d; } e.far = m > 56 ? 2 : m > 36 ? 1 : 0; }
    if (e.far && !e.wave && !e.target && !e.dashT && e.mode !== 'follow' && e.mode !== 'raid' && (G.tick + e.id) % (e.far === 2 ? 6 : 3) !== 0) continue;
    (e.cat === 'mob' ? updateMob : updateHuman)(e);
  }
  separate();
  updateShots();
  updateStructs();
  updateHazards();
  processBooms();
  updateSpawns();
  if (G.tick % 25 === 7) activation();
  questTick();
  if (lodPass) for (const e of G.ents) if (e.def.boss && e.def.por && !G.Q.seenBoss.includes(e.kind) && G.players.some(p => p && p.joined && !p.dead && dist(p.x, p.y, e.x, e.y) < 13)) {
    G.Q.seenBoss.push(e.kind); fx({ k: 'boss', por: e.def.por, name: e.title || e.def.name }); sfxAt('horn', e.x, e.y); qBump();
  }
  if (G.ents.some(e => e.dead || e.frozen)) G.ents = G.ents.filter(e => !e.dead && !e.frozen);
  for (const d of G.drops) d.ttl--;
  if (G.tick % 50 === 0) G.drops = G.drops.filter(d => d.ttl > 0);
}
