'use strict';
/* Cell Siege — gameplay systems ported 1:1 from the decompiled SWF, running at the
 * original's fixed 50 fps in its own units (cells, frames). Art, names and map are original.
 * Source of each rule is noted as Class.method (see ANALYSIS.md).
 */

const CELL = 32, MW = 40, MH = 30;
let VIEW_W = 960, VIEW_H = 640, RS = 1;
const INF = 1e9;
const TAU = Math.PI * 2;
const DIRS = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]]; // 0 = east, clockwise (screen y down)
const DIR_ANG = k => k * Math.PI / 4;
const angToDir = a => ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;

const idx = (x, y) => y * MW + x;
const inMap = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);
const irand = n => (Math.random() * n) | 0;            // AS2 random(n)
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const cellOf = t => idx(Math.floor(t.x), Math.floor(t.y));

// ── Map ───────────────────────────────────────────────────────────────────
const solid = new Uint8Array(MW * MH);     // mCollide_Solid / StaticImpassable
const objAt = new Array(MW * MH).fill(null); // blocking objects: barrel, fake wall (mCollide_Object)
const occ = new Int16Array(MW * MH);       // mCollide_Creature (rebuilt every frame)
const flow = new Int32Array(MW * MH);      // nDist
let spawnZombie = [], spawnDevil = [], crateSpots = [];
let floorCanvas, floorCtx;

function buildMap() {
  solid.fill(0); objAt.fill(null); occ.fill(0);
  for (let x = 0; x < MW; x++) { solid[idx(x, 0)] = 1; solid[idx(x, MH - 1)] = 1; }
  for (let y = 0; y < MH; y++) { solid[idx(0, y)] = 1; solid[idx(MW - 1, y)] = 1; }
  const rects = [
    [6,6,3,3],[31,6,3,3],[6,21,3,3],[31,21,3,3],
    [14,10,5,1],[22,10,5,1],[14,19,5,1],[22,19,5,1],
    [11,13,1,4],[28,13,1,4],[19,4,2,2],[19,24,2,2],
    [3,14,2,1],[35,15,2,1],
  ];
  for (const [rx, ry, rw, rh] of rects)
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) solid[idx(x, y)] = 1;
  spawnZombie = []; spawnDevil = [];
  const gate = (cells, devil) => { for (const [x, y] of cells) { solid[idx(x, y)] = 0; spawnZombie.push({ x, y }); if (devil) spawnDevil.push({ x, y }); } };
  gate([[19,0],[20,0],[21,0]], true); gate([[19,MH-1],[20,MH-1]], true);
  gate([[0,8],[0,9]]); gate([[0,22],[0,23]]);
  gate([[MW-1,8],[MW-1,9]]); gate([[MW-1,21],[MW-1,22]]);
  crateSpots = [{ x: 4, y: 4 }, { x: MW - 5, y: MH - 5 }];
  renderFloor();
}

function renderFloor() {
  floorCanvas = document.createElement('canvas');
  floorCanvas.width = MW * CELL; floorCanvas.height = MH * CELL;
  floorCtx = floorCanvas.getContext('2d');
  const g = floorCtx;
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const n = (x * 7 + y * 13) % 5;
    g.fillStyle = ((x + y) & 1) ? `rgb(${58 + n},${60 + n},${66 + n})` : `rgb(${52 + n},${54 + n},${60 + n})`;
    g.fillRect(x * CELL, y * CELL, CELL, CELL);
  }
  g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1;
  for (let x = 0; x <= MW; x++) { g.beginPath(); g.moveTo(x * CELL + .5, 0); g.lineTo(x * CELL + .5, MH * CELL); g.stroke(); }
  for (let y = 0; y <= MH; y++) { g.beginPath(); g.moveTo(0, y * CELL + .5); g.lineTo(MW * CELL, y * CELL + .5); g.stroke(); }
  for (const s of spawnZombie) { g.fillStyle = 'rgba(160,40,40,0.35)'; g.fillRect(s.x * CELL, s.y * CELL, CELL, CELL); }
}

function decal(x, y, r, color, n = 6) {
  const g = floorCtx; g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    g.globalAlpha = rand(0.25, 0.6);
    g.beginPath(); g.arc((x + rand(-r, r)) * CELL, (y + rand(-r, r)) * CELL, rand(2, 2 + r * CELL * 0.35), 0, TAU); g.fill();
  }
  g.globalAlpha = 1;
}

const isSolid = (x, y) => !inMap(x, y) || solid[idx(x, y)];
const objBlock = i => objAt[i] && objAt[i].active;

// CMap_Cell.Nav_Update: 4-neighbour BFS from the player's cell through static terrain only
let flowFrom = -1;
function updateFlow() {
  const pc = cellOf(player);
  if (pc === flowFrom) return;
  flowFrom = pc;
  flow.fill(INF);
  const q = new Int32Array(MW * MH); let h = 0, t = 0;
  flow[pc] = 0; q[t++] = pc;
  while (h < t) {
    const c = q[h++], cx = c % MW, cy = (c / MW) | 0, d = flow[c] + 1;
    for (let k = 0; k < 8; k += 2) {
      const nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
      if (isSolid(nx, ny)) continue;
      const n = idx(nx, ny);
      if (flow[n] > d) { flow[n] = d; q[t++] = n; }
    }
  }
}

// collide flags of the neighbouring cell in direction k (CMap_Cell.NavReal_k)
const F_SOLID = 1, F_OBJECT = 2, F_CREATURE = 4, F_PLAYER = 8;
function navReal(cx, cy, k) {
  const [dx, dy] = DIRS[k], nx = cx + dx, ny = cy + dy;
  if (isSolid(nx, ny)) return F_SOLID;
  const n = idx(nx, ny);
  let f = 0;
  if (objBlock(n)) f |= F_OBJECT;
  if (occ[n]) f |= F_CREATURE;
  if (n === cellOf(player) && player.life > 0) f |= F_PLAYER;
  if (dx && dy) { // no corner cutting
    if (isSolid(cx + dx, cy) || isSolid(cx, cy + dy) || objBlock(idx(cx + dx, cy)) || objBlock(idx(cx, cy + dy))) f |= F_SOLID;
  }
  return f;
}
const NON_MOVABLE = F_SOLID | F_OBJECT | F_CREATURE | F_PLAYER;

// CMap_Cell.Nav_Direction
let fullScanCount = 0;
function navDirection(cx, cy, cDir, tDir, force) {
  const cur = idx(cx, cy), cd = flow[cur];
  const nd = k => { const nx = cx + DIRS[k][0], ny = cy + DIRS[k][1]; return inMap(nx, ny) ? flow[idx(nx, ny)] : INF; };
  if (cd >= INF) return (navReal(cx, cy, tDir) & NON_MOVABLE) ? -1 : tDir; // cell not reached by BFS: NavReal_Dir
  if (nd(tDir) < cd && !(navReal(cx, cy, tDir) & NON_MOVABLE)) return tDir;
  if (nd(cDir) < cd && !(navReal(cx, cy, cDir) & NON_MOVABLE)) return cDir;
  if (!force && ++fullScanCount > 5) return -1;
  let best = -1, bd = INF + 1;
  for (let k = 0; k < 8; k++) {
    if (navReal(cx, cy, k) & NON_MOVABLE) continue;
    if (nd(k) < bd) { bd = nd(k); best = k; }
  }
  return best;
}

function lineOfSight(ax, ay, bx, by) {
  const d = dist(ax, ay, bx, by), steps = Math.ceil(d / 0.2);
  for (let i = 1; i < steps; i++) {
    const x = ax + (bx - ax) * i / steps, y = ay + (by - ay) * i / steps;
    const c = idx(Math.floor(x), Math.floor(y));
    if (solid[c] || objBlock(c)) return false;
  }
  return true;
}

// ── State ─────────────────────────────────────────────────────────────────
let player, creatures, shots, explosions, floorObjs, pickups, effects, tracers, floaters, messages;
let mode = 'title', paused = false, frameNo = 0, shake = 0, cam = { x: 0, y: 0 };
let up, levels, score = 0, best = 0, kills = 0;

// ── Upgrades (CUpgrades) ──────────────────────────────────────────────────
function newUpgrades() {
  const u = { idCount: 0, classes: {}, multiplier: 1, mTick: 0, mTickTotal: 1, multiKill: 0, kTick: 1e5, kTickTotal: 1e5,
              rewards: new Map(), level: 0, L: null, zombieAlive: 0, devilAlive: 0 };
  for (const [m, cls, prop] of MULTIPLIER_REWARDS) {
    if (!u.rewards.has(m)) u.rewards.set(m, []);
    u.rewards.get(m).push({ cls, prop, active: false });
  }
  return u;
}
function upClass(c) { return up.classes[c] || (up.classes[c] = { IDCount: 0 }); }

function rewardName(cls, prop) {
  if (cls === 'player') { const id = prop.slice(3); return `New Weapon: ${WEAPONS[id].name} (Key ${WEAPONS[id].key})`; }
  const base = WEAPONS[cls] ? WEAPONS[cls].name : OBJ_NAME[cls];
  return `${base}+: ${UPGRADE_LABEL[prop]}`;
}
// CUpgrades.AddUpgrade
function addUpgrade(cls, prop) {
  const c = upClass(cls);
  c[prop] = true; c.IDCount = ++up.idCount;
  if (cls === 'player') newWeapon(prop.slice(3));
  else if (player.weapons[cls]) applyUpgradeWeapon(player.weapons[cls]);
  msg(rewardName(cls, prop), cls === 'player' ? '#ffd166' : '#8fd3ff', 3);
  sfx(cls === 'player' ? 'unlock' : 'pickup');
}

// CUpgrades.ApplyUpgrade_Weapon — always recomputed from the original stats
function applyUpgradeWeapon(w) {
  const c = up.classes[w.id] || {}, o = WEAPONS[w.id];
  if (c.IDCount === w.idCount) return;
  w.idCount = c.IDCount;
  const s = w.s;
  s.dmg = c.FatalDamage ? o.dmg * 10 : c.QuadDamage ? o.dmg * 4 : c.DoubleDamage ? o.dmg * 2 : o.dmg;
  if (c.RapidFire) { s.rate = Math.round(Math.max(o.rate / 4, 2)); w.count = 0; s.trigger = 'auto'; }
  else if (c.FastFire) { s.rate = o.rate; s.trigger = 'auto'; }
  else { s.rate = o.rate; s.trigger = o.trigger; }
  s.biggerBang = c.BiggerBang ? 2 : c.BigBang ? 1 : 0;
  s.cluster = c.ClusterExplode ? 1 : 0;
  s.wide = c.WiderShot ? 2 : c.WideShot ? 1 : (o.wide || 0);
  if (c.InfinateAmmo) { w.total = w.ammo = INFINITE_AMMO; }
  else if (c.QuadAmmo) { w.total = w.ammo = o.ammo * 4; }
  else if (c.DoubleAmmo) { w.total = w.ammo = o.ammo * 2; }
  s.range = c.InfinateRange ? 100 : c.LongShot ? o.range * 1.5 : o.range;
}
// CUpgrades.ApplyUpgrade_Object
function objectUpgrades(kind) {
  const c = up.classes['obj_' + kind] || {};
  return { biggerBang: c.BiggerBang ? 2 : c.BigBang ? 1 : 0, cluster: c.ClusterExplode ? 1 : 0 };
}

// multiplier setter (__set__mMultiplier): clamp 1..999, reset window, fire unclaimed rewards at this index
function setMultiplier(a) {
  up.multiplier = clamp(a, 1, 999);
  up.mTick = up.mTickTotal = getTicks(up.multiplier);
  if (a > 1 && up.rewards.has(up.multiplier))
    for (const r of up.rewards.get(up.multiplier)) if (!r.active) { r.active = true; addUpgrade(r.cls, r.prop); }
}
function setMultipleKill(a) {
  up.multiKill = Math.max(0, a);
  if (up.multiKill) up.kTick = up.kTickTotal = getTicks(up.multiKill) / 6;
  else up.kTick = up.kTickTotal = 100000;
}
// __set__mLevel
function setLevel(n) {
  up.level = n;
  const t = levels[Math.min(n, 100)];
  up.L = { ...t, mSpawnCount_Zombie: t.Zombie_SpawnRate, mSpawnCount_Devil: t.Devil_SpawnRate };
  up.zombieAlive = 0; up.devilAlive = 0; // Level.mZombieCount / mDevilCount restart per level
  msg(`-+-+-+- LEVEL ${n} -+-+-+-`, '#fff', 2.5, true);
  for (const c of creatures) applySpeedUp(c);
}
function applySpeedUp(c) {
  const L = up.L; c.speed = c.def.speed * (c.type === 'zombie' ? L.ZombieSpeedUp : L.DevilSpeedUp);
}

// CUpgrades.Process
function processUpgrades() {
  const L = up.L;
  const zAlive = creatures.some(c => c.type === 'zombie'), dAlive = creatures.some(c => c.type === 'devil');
  if (!zAlive && !dAlive && L.Zombie_Count <= 0 && L.Devil_Count <= 0) { setLevel(up.level + 1); sfx('level'); }
  else {
    if (up.zombieAlive < Math.min(L.Zombie_Count, 60)) {
      if (--L.mSpawnCount_Zombie <= 0 && spawnCreature('zombie')) L.mSpawnCount_Zombie = L.Zombie_SpawnRate;
    }
    if (up.devilAlive < L.Devil_Count) {
      if (--L.mSpawnCount_Devil <= 0 && spawnCreature('devil')) L.mSpawnCount_Devil = L.Devil_SpawnRate;
    }
  }
  if (--up.kTick < 0) setMultipleKill(0);
  if (--up.mTick < 0) setMultiplier(up.multiplier - 1);
}

// __set__mZombieCount / __set__mDevilCount with a decrease → LogKills(1)
function countDown(type) {
  const L = up.L;
  if (type === 'zombie') {
    up.zombieAlive--; L.Zombie_TotalCount--;
    if (L.Zombie_TotalCount < L.Zombie_Count) L.Zombie_Count = L.Zombie_TotalCount;
  } else {
    up.devilAlive--; L.Devil_TotalCount--;
    if (L.Devil_TotalCount < L.Devil_Count) L.Devil_Count = L.Devil_TotalCount;
  }
  setMultipleKill(up.multiKill + 1);
  setMultiplier(up.multiplier + 1);
}

// CWorld.LogKill
function logKill(c) {
  kills++;
  countDown(c.type);
  if (c.type === 'devil' || up.multiKill % 5 === 0) createPickup(c.x, c.y);
  const pts = c.def.score * up.multiplier;
  score += pts;
  floaters.push({ x: c.x, y: c.y - 0.6, text: '+' + pts, ttl: 50, color: up.multiplier > 9 ? '#ffd166' : '#fff' });
}

// ── Spawning (CWorld.Spawn_ValidPosition / _NonStrict) ─────────────────────
function spawnCreature(type) {
  const list = type === 'zombie' ? spawnZombie : spawnDevil;
  const n = list.length; let i = irand(n);
  for (let k = 0; k < n; k++, i = (i + 1) % n) {
    const s = list[i], ci = idx(s.x, s.y);
    if (occ[ci] || ci === cellOf(player)) continue;
    const def = CREATURES[type];
    const c = { type, def, x: s.x + .5, y: s.y + .5, life: def.life, maxLife: def.life, mass: def.mass, r: def.radius,
                angle: Math.atan2(player.y - s.y, player.x - s.x), state: 'goto', ret: 'goto', count: 0,
                move: null, dx: 0, dy: 0, flash: 0, walk: Math.random() * 6, fireCount: def.fireRateStart || 0, anim: 0 };
    applySpeedUp(c);
    occ[ci]++;
    creatures.push(c);
    if (type === 'zombie') up.zombieAlive++; else up.devilAlive++;
    return true;
  }
  return false;
}

// ── Creatures (CThing_Creature state machine) ──────────────────────────────
function dirOf(c) { return angToDir(c.angle); }
function setState(c, s) {
  c.ret = c.state; c.state = s; c.count = 0;
  if (s === 'wait') c.count = FPS;                                   // State_Wait_Init
  if (s === 'attack') c.anim = 0;
}
function setStateWithDirection(c, s, tDir) {                        // SetState_WithDirection
  if (tDir === dirOf(c)) { setState(c, s); return; }
  startTurn(c, tDir);
}
function setStateWithDirectionWait(c, s, tDir) {                    // SetState_WithDirection_Wait
  if (tDir === dirOf(c)) { setState(c, s); c.moveDir = tDir; return; }
  if (c.ret === 'turn') { setState(c, 'sleep'); c.count = Math.round(FPS / 3); c.ret = 'goto'; return; }
  startTurn(c, tDir);
}
function startTurn(c, tDir) {                                       // State_Turn_Init
  const target = DIR_ANG(tDir);
  const diff = Math.atan2(Math.sin(target - c.angle), Math.cos(target - c.angle));
  setState(c, 'turn');
  c.turnTo = target;
  c.turnStep = Math.sign(diff) * c.speed * 10;
  c.count = Math.max(1, Math.ceil(Math.abs(diff) / (c.speed * 10)));
}

function updateCreature(c) {
  c.flash = Math.max(0, c.flash - 1);
  if (c.type === 'devil' && c.fireCount > 0) c.fireCount--;
  switch (c.state) {
    case 'goto': return c.type === 'zombie' ? zombieGoto(c) : devilGoto(c);
    case 'turn':
      if (--c.count > 0) { c.angle += c.turnStep; return; }
      c.angle = c.turnTo; c.state = 'goto'; c.ret = 'turn'; return;
    case 'move': return cellToCell(c);
    case 'attack': return c.type === 'zombie' ? zombieAttack(c) : devilAttack(c);
    case 'hit': return bulletHit(c);
    case 'wait': if (--c.count <= 0) { c.ret = 'wait'; c.state = 'goto'; } return;
    case 'sleep': if (--c.count <= 0) { c.state = c.ret || 'goto'; c.ret = 'sleep'; } return;
  }
}

function targetDir(c) {
  const tx = Math.floor(player.x) + 0.5, ty = Math.floor(player.y) + 0.5;
  return angToDir(Math.atan2(ty - c.y, tx - c.x));
}

// CThing_Creature_Zombie.State_GotoPlayer
function zombieGoto(c) {
  if (player.life <= 0) return;
  const cx = Math.floor(c.x), cy = Math.floor(c.y), cDir = dirOf(c), tDir = targetDir(c);
  if (navReal(cx, cy, tDir) & F_PLAYER) { setStateWithDirection(c, 'attack', tDir); return; }
  const d = navDirection(cx, cy, cDir, tDir, false);
  if (d === -1) { setState(c, 'wait'); return; }
  setStateWithDirectionWait(c, 'move', d);
}
// CThing_Creature_Devil.State_GotoPlayer (+ Brain → State_Attack_Decision)
function devilGoto(c) {
  if (player.life <= 0) return;
  if (devilAttackDecision(c)) { c.attackAngle = Math.atan2(player.y - c.y, player.x - c.x); setState(c, 'attack'); return; }
  const cx = Math.floor(c.x), cy = Math.floor(c.y), cDir = dirOf(c), tDir = targetDir(c);
  const f = navReal(cx, cy, tDir);
  if (f & (F_PLAYER | F_OBJECT)) { c.attackAngle = DIR_ANG(tDir); setStateWithDirection(c, 'attack', tDir); return; }
  const d = navDirection(cx, cy, cDir, tDir, true);
  if (d === -1) { setState(c, 'wait'); return; }
  setStateWithDirectionWait(c, 'move', d);
}
function devilAttackDecision(c) {
  if (c.fireCount > 0 || player.life <= 0) return false;
  const a = Math.atan2(player.y - c.y, player.x - c.x);
  if (angToDir(a) !== dirOf(c)) return false;
  if (dist(c.x, c.y, player.x, player.y) > c.def.attackRange) return false;
  return lineOfSight(c.x, c.y, player.x, player.y);
}

// State_CellToCell: glide from current position to the next cell centre
function cellToCell(c) {
  if (!c.move) {
    const k = c.moveDir !== undefined ? c.moveDir : dirOf(c);
    const tx = Math.floor(c.x) + DIRS[k][0], ty = Math.floor(c.y) + DIRS[k][1];
    if (navReal(Math.floor(c.x), Math.floor(c.y), k) & NON_MOVABLE) { c.state = 'goto'; c.moveDir = undefined; return; }
    const frames = Math.max(1, Math.round(((DIRS[k][0] && DIRS[k][1]) ? Math.SQRT2 : 1) / c.speed));
    c.move = { tx, ty, sx: c.x, sy: c.y, t: 0, n: frames };
    occ[idx(tx, ty)]++;
  }
  const m = c.move;
  m.t++;
  c.walk += 0.34 * 0.6;
  c.x = m.sx + (m.tx + .5 - m.sx) * m.t / m.n; c.y = m.sy + (m.ty + .5 - m.sy) * m.t / m.n;
  if (m.t >= m.n) { c.move = null; c.moveDir = undefined; c.state = 'goto'; c.ret = 'move'; }
}

// CThing_Creature_Zombie.State_Attack: animate at min(0.3*speed*25*1.5, 1) frames/tick over an 8-frame swing
const ATTACK_ANIM_FRAMES = 8;
function zombieAttack(c) {
  c.anim += Math.min(0.3 * (c.speed * 25) * 1.5, 1);
  if (c.anim < ATTACK_ANIM_FRAMES) return;
  const k = dirOf(c), nx = Math.floor(c.x) + DIRS[k][0], ny = Math.floor(c.y) + DIRS[k][1];
  const n = idx(nx, ny);
  if (n === cellOf(player)) affectCreature(player, { type: 'zombie', dmg: c.def.damage, from: c });
  else if (objAt[n] && objAt[n].kind === 'wall') damageObject(objAt[n], c.def.damage);
  const r = c.ret;
  setState(c, 'sleep'); c.count = 10; c.ret = r === 'turn' ? 'goto' : (r || 'goto');
}
// CThing_Creature_Devil.State_Attack: fireball released on animation frame 3
function devilAttack(c) {
  c.anim++;
  if (c.anim === 15) {
    const a = c.attackAngle, r = c.r;
    shots.push({ kind: 'fireball', x: c.x + Math.cos(a) * r * 1.5, y: c.y + Math.sin(a) * r * 1.5, z: 0.84,
                 dx: Math.cos(a) * 0.15, dy: Math.sin(a) * 0.15, dmg: c.def.damage, owner: c, life: 200 });
    c.fireCount = c.def.fireRate; sfx('fireball');
  }
  if (c.anim >= 30) { c.state = 'goto'; c.ret = 'attack'; }
}

// State_BulletHit: knock-back that decays ×0.65 per frame, then a 3-frame sleep
function bulletHit(c) {
  if (c.move) { c.move = null; }
  const nx = c.x + c.dx, ny = c.y + c.dy;
  if (!isSolid(Math.floor(nx), Math.floor(c.y)) && !objBlock(idx(Math.floor(nx), Math.floor(c.y)))) c.x = nx; else c.dx = 0;
  if (!isSolid(Math.floor(c.x), Math.floor(ny)) && !objBlock(idx(Math.floor(c.x), Math.floor(ny)))) c.y = ny; else c.dy = 0;
  c.dx *= 0.65; c.dy *= 0.65;
  if (--c.count < 0) {
    if (c.life <= 0) { killCreature(c); return; }
    if (c === player) { c.state = 'control'; return; }
    c.angle = c.returnAngle; setState(c, 'sleep'); c.count = 3; c.ret = 'goto';
  }
}
function hitFrames(len) { let n = 0; while (len >= 0.01) { n++; len *= 0.65; } return n; }

// CThing_Creature.ProcessAffects
function affectCreature(c, a) {
  if (c.dead) return;
  if (c === player && (player.invincible > 0 || mode !== 'play')) return;
  let dmg, len;
  const fx = a.fx !== undefined ? a.fx : a.from.x, fy = a.fy !== undefined ? a.fy : a.from.y;
  if (a.type === 'explosion') {
    const d = dist(c.x, c.y, fx, fy), r = d / a.range;
    dmg = r <= 0.5 ? a.dmg : r <= 0.75 ? a.dmg * 0.75 : a.dmg * 0.5;         // CThing_Affect_Explosion.AffectThing
    len = Math.min((dmg / 5) * 2 / CELL / c.mass, 0.3);
  } else if (a.type === 'zombie') {
    dmg = a.dmg; len = Math.max((dmg / 5) / CELL / c.mass, 0.3);
  } else { // bullet, fireball
    dmg = a.dmg; len = Math.max((dmg / 5) * 2 / CELL, 0.3) / c.mass;
  }
  c.life -= dmg; c.flash = 4;
  let vx = c.x - fx, vy = c.y - fy; const vl = Math.hypot(vx, vy) || 1;
  c.dx = vx / vl * len; c.dy = vy / vl * len;
  c.returnAngle = c.angle;
  if (c !== player) c.angle = Math.atan2(c.dy, c.dx) + Math.PI;
  c.state = 'hit'; c.count = hitFrames(len);
  if (c.move) { c.move = null; c.moveDir = undefined; }
  decal(c.x, c.y, 0.25, '#5b0f0f', 2);
  if (c === player) { shake = Math.max(shake, 6); sfx('hurt'); if (player.life <= 0) { player.life = 0; gameOver(); } }
}
function killCreature(c) {
  c.dead = true;
  decal(c.x, c.y, c.type === 'devil' ? 0.6 : 0.4, '#4a0c0c', c.type === 'devil' ? 14 : 8);
  effects.push({ kind: 'gib', x: c.x, y: c.y, t: 0, life: 18, color: c.type === 'devil' ? '#b0413e' : '#7fae5a', big: c.type === 'devil' });
  sfx('kill');
  logKill(c);
}

// ── Objects ───────────────────────────────────────────────────────────────
function placeObject(kind, w) {
  const cx = Math.floor(player.x), cy = Math.floor(player.y), i = idx(cx, cy);
  if (objAt[i] || floorObjs.some(o => o.i === i)) return false;            // GetCell(...).mChildCount > 1
  const o = { kind, i, x: cx + .5, y: cy + .5, dmg: w ? w.s.dmg : 100, active: false };
  if (kind === 'barrel' || kind === 'wall') {
    o.life = kind === 'wall' ? 1000 : 1; o.maxLife = o.life;
    objAt[i] = o;                                                          // Process_PlayerOnCell: solid once the player steps off
  } else { o.count = -1; floorObjs.push(o); }
  return true;
}
function damageObject(o, dmg) {
  if (o.dead) return;
  if (o.kind === 'barrel') { detonateBarrel(o); return; }
  o.life -= dmg; o.flash = 4;
  if (o.life <= 0) { o.dead = true; objAt[o.i] = null; effects.push({ kind: 'gib', x: o.x, y: o.y, t: 0, life: 18, color: '#8a8f9c', big: true }); }
}
function detonateBarrel(o) {
  if (o.dead) return;
  o.dead = true; objAt[o.i] = null;
  const u = objectUpgrades('barrel');
  addExplosion(o.x, o.y, o.dmg, u.biggerBang, u.cluster);
}

// ── Explosions (CThing_Effect_Explosion) ──────────────────────────────────
function addExplosion(x, y, dmg, biggerBang = 0, cluster = 0, delay = 0) {
  explosions.push({ x, y, dmg, range: explosionRange(dmg), biggerBang, cluster, delay, init: false });
}
function processExplosions() {
  const list = explosions; explosions = [];
  for (const e of list) {
    if (!e.init) {
      e.init = true;
      if (e.cluster) {
        const step = TAU / 4;
        for (let a = 0; a < TAU; a += step) {
          const ang = a + Math.random() * (step / 2) - step / 4, sp = 0.05 + Math.random() * 0.05;
          shots.push({ kind: 'cluster', x: e.x, y: e.y, z: 0, dx: Math.cos(ang) * sp, dy: Math.sin(ang) * sp, dz: 0.5, life: 16 + irand(8), dmg: e.dmg });
        }
      }
      if (e.biggerBang) {
        const step = TAU / (e.biggerBang * 1.5);
        for (let a = 0; a < TAU; a += step) {
          const ang = a + Math.random() * (step / 4) - step / 8;
          addExplosion(e.x + Math.cos(ang), e.y + Math.sin(ang), e.dmg, 0, 0, 2 + irand(4));
        }
      }
    }
    if (--e.delay >= 0) { explosions.push(e); continue; }
    // Process_Delay → AffectArea(rect ± range, CThing_Affect_Explosion)
    shake = Math.max(shake, 12);
    effects.push({ kind: 'boom', x: e.x, y: e.y, r: e.range, t: 0, life: 20 });
    decal(e.x, e.y, e.range * 0.3, '#1d1a17', 10);
    sfx('boom');
    const a = { type: 'explosion', dmg: e.dmg, range: e.range, fx: e.x, fy: e.y };
    for (const c of creatures) if (dist(c.x, c.y, e.x, e.y) <= e.range) affectCreature(c, a);
    if (dist(player.x, player.y, e.x, e.y) <= e.range) affectCreature(player, a); // CThing_Creature.mDamageActive = true
    for (let cy = Math.floor(e.y - e.range); cy <= e.y + e.range; cy++)
      for (let cx = Math.floor(e.x - e.range); cx <= e.x + e.range; cx++) {
        if (!inMap(cx, cy)) continue;
        const o = objAt[idx(cx, cy)];
        if (!o || dist(o.x, o.y, e.x, e.y) > e.range) continue;
        if (o.kind === 'barrel') detonateBarrel(o);
        else { const r = dist(o.x, o.y, e.x, e.y) / e.range; damageObject(o, r <= 0.5 ? e.dmg : r <= 0.75 ? e.dmg * 0.75 : e.dmg * 0.5); }
      }
  }
}

// ── Player ────────────────────────────────────────────────────────────────
function newWeaponState(id) {
  const o = WEAPONS[id];
  return { id, ammo: o.ammo, total: o.ammo, count: 0, idCount: -1, active: true, detonate: false,
           s: { name: o.name, kind: o.kind, dmg: o.dmg, rate: o.rate, range: o.range, trigger: o.trigger, wide: o.wide || 0, biggerBang: 0, cluster: 0 } };
}
// Player.NewWeapon / AddWeapon: (re)arm with full ammo
function newWeapon(id) {
  let w = player.weapons[id];
  if (!w) w = player.weapons[id] = newWeaponState(id);
  w.idCount = -1; applyUpgradeWeapon(w);
  w.ammo = w.total;
  return w;
}
const ownsWeapon = id => !!player.weapons[id];

function resetGame() {
  buildMap();
  levels = buildLevels();
  creatures = []; shots = []; explosions = []; floorObjs = []; pickups = []; effects = []; tracers = []; floaters = []; messages = [];
  const d = CREATURES.player;
  player = { x: 20.5, y: 15.5, life: d.life, maxLife: d.life, speed: d.speed, mass: d.mass, r: 0.3, angle: 0,
             weapons: {}, cur: 'pistol', invincible: 200, state: 'control', dx: 0, dy: 0, flash: 0, walk: 0, def: d };
  up = newUpgrades();
  newWeapon('pistol');
  score = 0; kills = 0; frameNo = 0; shake = 0;
  for (const [x, y] of [[9, 15], [30, 14], [20, 8], [20, 22]]) objAt[idx(x, y)] = { kind: 'barrel', i: idx(x, y), x: x + .5, y: y + .5, dmg: 100, life: 1, active: true };
  for (const c of crateSpots) pickups.push({ x: c.x + 0.5, y: c.y + 0.5, ttl: Infinity, spot: true });
  cam.x = player.x * CELL - VIEW_W / 2; cam.y = player.y * CELL - VIEW_H / 2;
  flowFrom = -1;
  setMultiplier(1); setMultipleKill(0);
  setLevel(1);
}

function msg(text, color = '#fff', sec = 2.5, big = false) {
  messages.push({ text, color, ttl: sec * FPS, max: sec * FPS, big });
  if (messages.length > 6) messages.shift();
}

function gameOver() {
  mode = 'over';
  try { best = Math.max(best, +localStorage.getItem('cellsiege.best') || 0); if (score > best) { best = score; localStorage.setItem('cellsiege.best', String(best)); } }
  catch (e) { best = Math.max(best, score); }
}

function blockedForPlayer(x, y) {
  const cx = Math.floor(x), cy = Math.floor(y);
  if (isSolid(cx, cy)) return true;
  const o = objAt[idx(cx, cy)];
  return !!(o && o.active);
}
function boxFree(x, y, r) {
  return !blockedForPlayer(x - r, y - r) && !blockedForPlayer(x + r, y - r) && !blockedForPlayer(x - r, y + r) && !blockedForPlayer(x + r, y + r);
}

// CThing_Creature_Player.State_PlayerControl
function updatePlayer() {
  const p = player;
  if (p.invincible > 0) p.invincible--;
  p.flash = Math.max(0, p.flash - 1);
  if (p.state === 'hit') { bulletHit(p); return; }
  if (p.life < p.maxLife) p.life = Math.min(p.life + p.maxLife / (FPS * 30), p.maxLife);

  let mx = 0, my = 0;
  if (keys.left) mx -= 1; if (keys.right) mx += 1; if (keys.up) my -= 1; if (keys.down) my += 1;
  if (touch.active && (touch.mx || touch.my)) { mx = touch.mx; my = touch.my; }
  const len = Math.hypot(mx, my);
  if (len > 0.2) {
    const k = angToDir(Math.atan2(my, mx));
    p.angle = DIR_ANG(k);
    const sp = p.speed * Math.min(1, len) / (DIRS[k][0] && DIRS[k][1] ? Math.SQRT2 : 1);
    const vx = DIRS[k][0] * sp, vy = DIRS[k][1] * sp;
    if (boxFree(p.x + vx, p.y, p.r)) p.x += vx;
    if (boxFree(p.x, p.y + vy, p.r)) p.y += vy;
    p.walk += sp * 3;
  }
  for (const c of creatures) { // KeepDistance
    const d = dist(p.x, p.y, c.x, c.y), min = p.r + c.r * 0.8;
    if (d < min && d > 0.001) {
      const nx = p.x + (p.x - c.x) / d * (min - d), ny = p.y + (p.y - c.y) / d * (min - d);
      if (boxFree(nx, p.y, p.r)) p.x = nx;
      if (boxFree(p.x, ny, p.r)) p.y = ny;
    }
  }
  // blocking objects dropped on the player's cell turn solid once the player leaves it
  for (let i = 0; i < objAt.length; i++) { const o = objAt[i]; if (o && !o.active && i !== cellOf(p)) o.active = true; }

  for (const id of WEAPON_ORDER) if (keys.pressed['Digit' + WEAPONS[id].key] && ownsWeapon(id)) selectWeapon(id);
  if (keys.pressed.KeyQ || keys.pressed.prevW) cycleWeapon(-1);
  if (keys.pressed.KeyE || keys.pressed.nextW) cycleWeapon(1);

  updateWeapon(p.weapons[p.cur]);

  for (let i = pickups.length - 1; i >= 0; i--) {
    const k = pickups[i];
    if (k.hidden || Math.floor(k.x) !== Math.floor(p.x) || Math.floor(k.y) !== Math.floor(p.y)) continue;
    randomPickup();
    if (k.spot) { k.hidden = true; k.respawn = 20 * FPS; } else pickups.splice(i, 1);
  }
}
function selectWeapon(id) { if (player.cur !== id) { player.cur = id; player.weapons[id].count = 0; sfx('switch'); } }
function cycleWeapon(d) {
  const owned = WEAPON_ORDER.filter(id => ownsWeapon(id) && player.weapons[id].ammo > 0);
  const i = owned.indexOf(player.cur);
  selectWeapon(owned[(i + d + owned.length) % owned.length]);
}

// CThing_Weapon.Update
function updateWeapon(w) {
  applyUpgradeWeapon(w);
  if (!(w.ammo > 0)) { msg(w.s.name + ' is out of ammo!', '#f88', 1.5); selectWeapon('pistol'); return; }
  if (--w.count > 0) return;
  w.count = 0;
  const T = w.s.trigger;
  if (T === 'auto') { if (fireDown()) fire(w); }
  else if (T === 'release') { if (fireReleased()) fire(w, (frameNo - fireDownFrame) / FPS); }
  else if (firePressed()) fire(w);
}
function decrementAmmo(w) { if (w.total !== INFINITE_AMMO) w.ammo--; w.count = w.s.rate; }

function weaponPos() { return { x: player.x + Math.cos(player.angle) * 0.4, y: player.y + Math.sin(player.angle) * 0.4 }; }

function fire(w, held) {
  const s = w.s, a = player.angle, o = weaponPos();
  switch (s.kind) {
    case 'bullet':
      decrementAmmo(w); bullet(o.x, o.y, a, s.dmg, s.range); flash(o.x, o.y, a); sfx('shot'); break;
    case 'shotgun': {   // CThing_Weapon_Shotgun.Fire: centre + 1 pair (2 pairs if WideShot), spacing 1.25°×(wide+1)
      decrementAmmo(w);
      bullet(o.x, o.y, a, s.dmg, s.range);
      const step = 1.25 * (s.wide + 1), pairs = s.wide ? 2 : 1;
      for (let i = 1; i <= pairs; i++) {
        const r = step * i * Math.PI / 180;
        bullet(o.x, o.y, a - r, s.dmg, s.range); bullet(o.x, o.y, a + r, s.dmg, s.range);
      }
      flash(o.x, o.y, a); shake = Math.max(shake, 3); sfx('shotgun'); break;
    }
    case 'railgun': decrementAmmo(w); railgun(o.x, o.y, a, s.dmg, s.range); shake = Math.max(shake, 4); sfx('rail'); break;
    case 'rocket':
      decrementAmmo(w);
      shots.push({ kind: 'rocket', x: o.x, y: o.y, dx: Math.cos(a) * 0.5, dy: Math.sin(a) * 0.5, dmg: s.dmg, bb: s.biggerBang, cl: s.cluster });
      sfx('rocket'); break;
    case 'grenade': {   // CThing_Weapon_Grenade.Fire: power = hold time clamped to 0.25..0.75 s
      const power = clamp(held || 0, 0.25, 0.75);
      shots.push({ kind: 'grenade', x: o.x, y: o.y, z: 40 / CELL, dx: Math.cos(a) * power, dy: Math.sin(a) * power, dz: 0.5 * power,
                   life: 60, dmg: s.dmg, bb: s.biggerBang, cl: s.cluster });
      decrementAmmo(w); sfx('throw'); break;
    }
    case 'barrel': if (placeObject('barrel', w)) { decrementAmmo(w); sfx('place'); } break;
    case 'wall':   if (placeObject('wall', w))   { decrementAmmo(w); sfx('place'); } break;
    case 'mine':   if (placeObject('mine', w))   { decrementAmmo(w); sfx('place'); } break;
    case 'chargepack':  // CThing_Weapon_ChargePack.Fire: place one, next press detonates all of them
      if (w.detonate) {
        for (const f of floorObjs) if (f.kind === 'chargepack' && f.count < 0) f.count = Math.round(FPS / 10);
        w.detonate = false; sfx('switch');
      } else if (placeObject('chargepack', w)) { w.detonate = true; decrementAmmo(w); sfx('place'); }
      break;
  }
}

function flash(x, y, a) { effects.push({ kind: 'flash', x, y, a, t: 0, life: 3 }); }

// things a bullet can hit (mAffect_Bullet): creatures, barrels, fake walls — never the shooter
function hitThing(x, y, r, skip) {
  for (const c of creatures) if (!c.dead && !(skip && skip.has(c)) && dist(x, y, c.x, c.y) < c.r + r) return c;
  const o = inMap(Math.floor(x), Math.floor(y)) && objAt[idx(Math.floor(x), Math.floor(y))];
  if (o && !(skip && skip.has(o)) && dist(x, y, o.x, o.y) < 0.42 + r) return o;
  return null;
}
function hitThingWith(t, dmg, ox, oy) {
  if (t.kind) damageObject(t, dmg);
  else affectCreature(t, { type: 'bullet', dmg, fx: ox, fy: oy });
}
// CThing_Shot_Bullet: Collide_Line(origin → origin + range, radius 0.04), first thing or wall
function bullet(x, y, a, dmg, range) {
  const dx = Math.cos(a), dy = Math.sin(a);
  let ex = x, ey = y;
  for (let d = 0; d <= range; d += 0.05) {
    ex = x + dx * d; ey = y + dy * d;
    if (isSolid(Math.floor(ex), Math.floor(ey))) { if (!irand(3)) effects.push({ kind: 'spark', x: ex, y: ey, t: 0, life: 8 }); break; }
    const t = hitThing(ex, ey, 0.04);
    if (t) { hitThingWith(t, dmg, x, y); break; }
  }
  tracers.push({ x1: x, y1: y, x2: ex, y2: ey, t: 0, life: 3, color: '#ffe08a', w: 1.5 });
}
// CThing_Shot_Railgun: line to the first wall, every thing on it is hit
function railgun(x, y, a, dmg, range) {
  const dx = Math.cos(a), dy = Math.sin(a), hit = new Set();
  let ex = x, ey = y;
  for (let d = 0; d <= range; d += 0.05) {
    ex = x + dx * d; ey = y + dy * d;
    if (isSolid(Math.floor(ex), Math.floor(ey))) break;
    let t; while ((t = hitThing(ex, ey, 0.04, hit))) { hit.add(t); hitThingWith(t, dmg, x, y); }
  }
  tracers.push({ x1: x, y1: y, x2: ex, y2: ey, t: 0, life: 12, color: '#8fd3ff', w: 4 });
}

// ── Shots ─────────────────────────────────────────────────────────────────
function bounceStep(s) {  // CThing_Shot_Grenade / ClusterShell.Process_Normal
  s.dz -= 0.06;
  if (s.z + s.dz < 0) {
    s.dz = Math.abs(s.dz); if (s.dz <= 0.06) s.dz = 0;
    s.dx *= 0.5; s.dy *= 0.5; s.z = 0;
  }
  const nx = s.x + s.dx, ny = s.y + s.dy;
  if (blockedForPlayer(nx, s.y)) { s.dx *= -0.25; s.dy *= 0.25; }
  if (blockedForPlayer(s.x, ny)) { s.dy *= -0.25; s.dx *= 0.25; }
  s.x += s.dx; s.y += s.dy; s.z += s.dz;
}
function updateShots() {
  const list = shots; shots = [];
  for (const s of list) {
    if (s.kind === 'grenade' || s.kind === 'cluster') {
      bounceStep(s);
      if (--s.life <= 0) { addExplosion(s.x, s.y, s.dmg, s.bb || 0, s.cl || 0); continue; }
    } else if (s.kind === 'rocket') {   // CThing_Shot_Rocket: delta 0.5, ×1.1 per frame, explode on first contact
      if (irand(2)) effects.push({ kind: 'smoke', x: s.x, y: s.y, t: 0, life: 25 });
      s.dx *= 1.1; s.dy *= 1.1;
      const steps = Math.ceil(Math.hypot(s.dx, s.dy) / 0.05);
      let boom = false;
      for (let i = 1; i <= steps && !boom; i++) {
        const x = s.x + s.dx * i / steps, y = s.y + s.dy * i / steps;
        if (isSolid(Math.floor(x), Math.floor(y)) || hitThing(x, y, 0.04)) { boom = true; s.x = x; s.y = y; }
      }
      if (boom || !inMap(Math.floor(s.x), Math.floor(s.y))) { addExplosion(s.x, s.y, s.dmg, s.bb, s.cl); continue; }
      s.x += s.dx; s.y += s.dy;
    } else if (s.kind === 'fireball') { // CThing_Shot_FireBall: delta ×1.02 per frame, area hit radius 0.25
      s.dx *= 1.02; s.dy *= 1.02;
      const nx = s.x + s.dx, ny = s.y + s.dy;
      let hit = isSolid(Math.floor(nx), Math.floor(ny)) || --s.life <= 0;
      if (!hit && dist(nx, ny, player.x, player.y) < 0.25 + player.r) hit = true;
      if (!hit) for (const c of creatures) if (c !== s.owner && dist(nx, ny, c.x, c.y) < 0.25 + c.r) { hit = true; break; }
      if (!hit) { const o = inMap(Math.floor(nx), Math.floor(ny)) && objAt[idx(Math.floor(nx), Math.floor(ny))]; if (o && o.active) hit = true; }
      if (hit) {
        const a = { type: 'fireball', dmg: s.dmg, fx: s.x, fy: s.y };
        if (dist(nx, ny, player.x, player.y) < 0.5 + player.r) affectCreature(player, a);
        for (const c of creatures) if (c !== s.owner && dist(nx, ny, c.x, c.y) < 0.5 + c.r) affectCreature(c, a);
        const o = inMap(Math.floor(nx), Math.floor(ny)) && objAt[idx(Math.floor(nx), Math.floor(ny))];
        if (o) damageObject(o, s.dmg);
        effects.push({ kind: 'boom', x: nx, y: ny, r: 0.6, t: 0, life: 12, fire: true });
        continue;
      }
      s.x = nx; s.y = ny;
    }
    shots.push(s);
  }
}

// mines (CThing_Object_Mine): creature on the cell → 2 s fuse; charge packs: 1/10 s after detonation
function updateFloorObjs() {
  const keep = [];
  for (const f of floorObjs) {
    if (f.kind === 'mine' && f.count < 0 && occ[f.i]) f.count = FPS * 2;
    if (f.count >= 0 && --f.count < 0) {
      const u = objectUpgrades(f.kind);
      addExplosion(f.x, f.y, f.dmg, u.biggerBang, u.cluster);
      continue;
    }
    keep.push(f);
  }
  floorObjs = keep;
}

// CThing_Creature_Player.RandomPickup
function randomPickup() {
  const list = []; let total = 0;
  for (const id of WEAPON_ORDER) {
    const w = player.weapons[id];
    if (!w || id === 'pistol') continue;
    const ch = (1 - w.ammo / w.total) * 0.75 + 0.25;
    total += ch; list.push({ id, idx: total });
  }
  if (player.life < player.maxLife) {
    const ch = (1 - player.life / player.maxLife) * total;
    total += ch; list.push({ id: 'life', idx: total });
  }
  const r = Math.random() * total;
  for (const e of list) {
    if (r < e.idx) {
      if (e.id === 'life') { player.life = player.maxLife; msg('Life up!', '#7dff9a', 1.6); }
      else { const w = newWeapon(e.id); msg('Picked up ' + w.s.name, '#ddd', 1.6); }
      sfx('pickup'); return true;
    }
  }
  return false;
}
// CWorld._CreatePickup: only on passable cells, deleted after FPS*10 frames
function createPickup(x, y) {
  const cx = Math.floor(x), cy = Math.floor(y);
  if (isSolid(cx, cy)) return;
  pickups.push({ x: cx + 0.5, y: cy + 0.5, ttl: FPS * 10 });
}

// ── Frame ─────────────────────────────────────────────────────────────────
function rebuildOcc() {
  occ.fill(0);
  for (const c of creatures) { occ[cellOf(c)]++; if (c.move) occ[idx(c.move.tx, c.move.ty)]++; }
}

function update() {
  if (mode !== 'play') {
    if (keys.pressed.Enter || keys.pressed.Space || touch.firePressed) { resetGame(); mode = 'play'; sfx('level'); }
    return;
  }
  if (keys.pressed.KeyP || keys.pressed.Escape) paused = !paused;
  if (paused) return;
  frameNo++;
  fullScanCount = 0;
  rebuildOcc();
  updatePlayer();
  updateFlow();
  for (const c of creatures) if (!c.dead) updateCreature(c);
  creatures = creatures.filter(c => !c.dead);
  rebuildOcc();
  updateShots();
  updateFloorObjs();
  processExplosions();
  creatures = creatures.filter(c => !c.dead);
  processUpgrades();
  for (const k of pickups) {
    if (k.spot && k.hidden) { if (--k.respawn <= 0) k.hidden = false; }
    else if (isFinite(k.ttl)) k.ttl--;
  }
  pickups = pickups.filter(k => k.ttl > 0);
  effects = effects.filter(e => ++e.t < e.life);
  tracers = tracers.filter(e => ++e.t < e.life);
  floaters = floaters.filter(f => (f.ttl--, f.y -= 0.016, f.ttl > 0));
  messages = messages.filter(m => --m.ttl > 0);
  shake *= 0.5; if (shake < 0.5) shake = 0;            // CWorld.Process_Shake: ×0.5 per frame
  const tx = clamp(player.x * CELL - VIEW_W / 2, 0, MW * CELL - VIEW_W), ty = clamp(player.y * CELL - VIEW_H / 2, 0, MH * CELL - VIEW_H);
  cam.x += (tx - cam.x) * 0.18; cam.y += (ty - cam.y) * 0.18;
}

// ── Rendering (original art) ──────────────────────────────────────────────
let canvas, ctx;
const WALL_H = 14;

function draw() {
  const g = ctx;
  g.setTransform(RS, 0, 0, RS, 0, 0);
  g.fillStyle = '#16171b'; g.fillRect(0, 0, VIEW_W, VIEW_H);
  if (!player) { drawTitle(); return; }
  const sx = Math.round(cam.x + rand(-shake, shake)), sy = Math.round(cam.y + rand(-shake, shake));
  g.save(); g.translate(-sx, -sy);
  g.drawImage(floorCanvas, 0, 0);

  for (const f of floorObjs) {
    const x = f.x * CELL, y = f.y * CELL;
    if (f.kind === 'mine') {
      g.fillStyle = f.count >= 0 ? ((frameNo >> 2) & 1 ? '#f33' : '#811') : '#5a5a4a';
      g.beginPath(); g.arc(x, y, 6, 0, TAU); g.fill(); g.strokeStyle = '#222'; g.lineWidth = 2; g.stroke();
    } else {
      g.fillStyle = '#2e3a4a'; g.fillRect(x - 7, y - 5, 14, 10);
      g.fillStyle = (frameNo >> 3) & 1 ? '#39f' : '#126'; g.fillRect(x - 2, y - 2, 4, 4);
    }
  }
  for (const k of pickups) {
    if (k.hidden) continue;
    if (isFinite(k.ttl) && k.ttl < 3 * FPS && ((frameNo >> 2) & 1)) continue;
    const x = k.x * CELL, y = k.y * CELL, b = Math.sin(frameNo / 10) * 2;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x - 9, y + 4, 18, 6);
    g.fillStyle = '#c9a25a'; g.fillRect(x - 9, y - 12 + b, 18, 16);
    g.fillStyle = '#e8c27a'; g.fillRect(x - 9, y - 14 + b, 18, 4);
    g.fillStyle = '#7a4'; g.fillRect(x - 2, y - 11 + b, 4, 12); g.fillRect(x - 6, y - 7 + b, 12, 4);
  }

  const list = [];
  const x0 = Math.max(0, Math.floor(sx / CELL) - 1), x1 = Math.min(MW, Math.ceil((sx + VIEW_W) / CELL) + 1);
  const y0 = Math.max(0, Math.floor(sy / CELL) - 1), y1 = Math.min(MH, Math.ceil((sy + VIEW_H) / CELL) + 2);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (solid[idx(x, y)]) list.push({ y: y + 1, f: () => drawWall(g, x, y, '#5b5f6a', '#2b2d33') });
    const o = objAt[idx(x, y)];
    if (o) list.push({ y: y + 0.9, f: () => o.kind === 'barrel' ? drawBarrel(g, o) : drawFakeWall(g, o) });
  }
  for (const c of creatures) list.push({ y: c.y + 0.3, f: () => drawCreature(g, c) });
  list.push({ y: player.y + 0.3, f: () => drawPlayer(g) });
  list.sort((a, b) => a.y - b.y);
  for (const d of list) d.f();

  for (const s of shots) {
    const x = s.x * CELL, y = s.y * CELL;
    if (s.kind === 'grenade' || s.kind === 'cluster') {
      const h = s.z * CELL;
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fill();
      g.fillStyle = s.kind === 'grenade' ? '#4a5' : '#cc4'; g.beginPath(); g.arc(x, y - h, s.kind === 'grenade' ? 4 : 3, 0, TAU); g.fill();
    } else if (s.kind === 'rocket') {
      g.fillStyle = '#ddd'; g.beginPath(); g.arc(x, y - 10, 4, 0, TAU); g.fill();
    } else {
      const r = 6 + Math.sin(frameNo) * 1.5, h = (s.z || 0) * CELL * 0.5 + 8;
      g.fillStyle = '#ff7a1a'; g.beginPath(); g.arc(x, y - h, r, 0, TAU); g.fill();
      g.fillStyle = '#ffe28a'; g.beginPath(); g.arc(x, y - h, r * 0.5, 0, TAU); g.fill();
    }
  }
  for (const t of tracers) {
    g.globalAlpha = 1 - t.t / t.life; g.strokeStyle = t.color; g.lineWidth = t.w;
    g.beginPath(); g.moveTo(t.x1 * CELL, t.y1 * CELL - 12); g.lineTo(t.x2 * CELL, t.y2 * CELL - 12); g.stroke();
  }
  g.globalAlpha = 1;
  for (const e of effects) drawEffect(g, e);
  g.font = 'bold 13px system-ui, sans-serif'; g.textAlign = 'center';
  for (const f of floaters) { g.globalAlpha = Math.min(1, f.ttl / 25); g.fillStyle = f.color; g.fillText(f.text, f.x * CELL, f.y * CELL - 20); }
  g.globalAlpha = 1;
  g.restore();
  drawHud(g);
}

function drawWall(g, x, y, top, front) {
  const px = x * CELL, py = y * CELL;
  g.fillStyle = front; g.fillRect(px, py + CELL - WALL_H, CELL, WALL_H);
  g.fillStyle = top; g.fillRect(px, py - WALL_H, CELL, CELL);
  g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(px, py - WALL_H, CELL, 2);
}
function drawFakeWall(g, o) {
  const x = Math.floor(o.x), y = Math.floor(o.y);
  g.globalAlpha = o.active ? 1 : 0.5;
  drawWall(g, x, y, o.flash ? '#fff' : '#7d6a4f', '#4a3d2c');
  g.globalAlpha = 1;
  if (o.life < o.maxLife) { g.fillStyle = '#000'; g.fillRect(x * CELL + 3, y * CELL - WALL_H - 6, CELL - 6, 3); g.fillStyle = '#da5'; g.fillRect(x * CELL + 3, y * CELL - WALL_H - 6, (CELL - 6) * o.life / o.maxLife, 3); }
}
function drawBarrel(g, o) {
  const x = o.x * CELL, y = o.y * CELL;
  g.globalAlpha = o.active ? 1 : 0.6;
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(x, y + 6, 11, 5, 0, 0, TAU); g.fill();
  g.fillStyle = '#a3322a'; g.fillRect(x - 10, y - 18, 20, 24);
  g.fillStyle = '#c8463a'; g.beginPath(); g.ellipse(x, y - 18, 10, 4, 0, 0, TAU); g.fill();
  g.fillStyle = '#ffcc33'; g.fillRect(x - 10, y - 8, 20, 3);
  g.globalAlpha = 1;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function drawBody(g, x, y, face, color, r, walk, flash, opts = {}) {
  const px = x * CELL, py = y * CELL, s = r * CELL;
  const bob = Math.sin(walk) * 1.5;
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(px, py + 3, s * 0.9, s * 0.45, 0, 0, TAU); g.fill();
  g.fillStyle = '#222';
  const lx = Math.cos(face + Math.PI / 2) * s * 0.35, ly = Math.sin(face + Math.PI / 2) * s * 0.2;
  g.fillRect(px + lx - 3 + Math.cos(face) * bob, py - 6 + ly, 6, 8);
  g.fillRect(px - lx - 3 - Math.cos(face) * bob, py - 6 - ly, 6, 8);
  g.fillStyle = flash ? '#fff' : color;
  roundRect(g, px - s * 0.75, py - s * 1.9 + bob, s * 1.5, s * 1.4, s * 0.45); g.fill();
  const ax = Math.cos(face), ay = Math.sin(face);
  g.strokeStyle = flash ? '#fff' : (opts.arm || color); g.lineWidth = opts.armW || 4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(px, py - s * 1.25 + bob); g.lineTo(px + ax * s * (opts.reach || 1.1), py - s * 1.25 + ay * s * 0.6 + bob); g.stroke();
  g.fillStyle = flash ? '#fff' : (opts.head || color);
  g.beginPath(); g.arc(px + ax * 2, py - s * 2.2 + bob + ay, s * 0.55, 0, TAU); g.fill();
  g.fillStyle = opts.eye || '#111';
  const ex = px + ax * s * 0.35 + 2, ey = py - s * 2.25 + bob + ay * 2;
  if (ay > -0.6) { g.fillRect(ex - 3 + ay * 2, ey - 1, 2, 2); g.fillRect(ex + 1 + ay * 2, ey - 1, 2, 2); }
}
function drawCreature(g, c) {
  const devil = c.type === 'devil';
  const attacking = c.state === 'attack';
  drawBody(g, c.x, c.y, c.angle, devil ? '#b0413e' : '#7fae5a', devil ? 0.5 : 0.38, c.walk + (c.move ? c.move.t * 0.5 : 0), c.flash > 0, {
    head: devil ? '#7a2420' : '#9cc47a', eye: devil ? '#ffd23a' : '#300',
    reach: attacking ? 1.6 : 1.2, armW: devil ? 7 : 4, arm: devil ? '#8a2e2a' : '#86b062' });
  if (c.life < c.maxLife) {
    const w = devil ? 34 : 22, px = c.x * CELL - w / 2, py = c.y * CELL - (devil ? 46 : 36);
    g.fillStyle = '#000'; g.fillRect(px, py, w, 3); g.fillStyle = devil ? '#f84' : '#7d4'; g.fillRect(px, py, w * clamp(c.life / c.maxLife, 0, 1), 3);
  }
}
function drawPlayer(g) {
  const p = player;
  if (p.invincible > 0 && (p.invincible % 2)) return;   // mVisible = !(mInvincible % 2)
  drawBody(g, p.x, p.y, p.angle, '#3f8fc4', 0.36, p.walk, p.flash > 0, { head: '#f0c9a0', arm: '#555', armW: 5, reach: 1.3 });
}
function drawEffect(g, e) {
  const k = e.t / e.life, x = e.x * CELL, y = e.y * CELL;
  if (e.kind === 'boom') {
    const r = e.r * CELL * (0.4 + 0.6 * k);
    g.globalAlpha = 1 - k;
    g.fillStyle = e.fire ? '#ff7a1a' : '#ffb347'; g.beginPath(); g.arc(x, y - 8, r, 0, TAU); g.fill();
    g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(x, y - 8, r * 0.5 * (1 - k), 0, TAU); g.fill();
    g.globalAlpha = 1;
  } else if (e.kind === 'flash') {
    g.fillStyle = '#fff6b0'; g.beginPath(); g.arc(x + Math.cos(e.a) * 4, y - 12 + Math.sin(e.a) * 4, 6, 0, TAU); g.fill();
  } else if (e.kind === 'spark') {
    g.fillStyle = `rgba(255,220,150,${1 - k})`; g.fillRect(x - 2, y - 14, 4, 4);
  } else if (e.kind === 'smoke') {
    g.fillStyle = `rgba(180,180,180,${0.4 * (1 - k)})`; g.beginPath(); g.arc(x, y - 10, 3 + k * 8, 0, TAU); g.fill();
  } else if (e.kind === 'gib') {
    g.fillStyle = e.color; g.globalAlpha = 1 - k;
    for (let i = 0; i < (e.big ? 10 : 6); i++) {
      const a = i * 2.4, r = k * (e.big ? 34 : 22);
      g.fillRect(x + Math.cos(a) * r - 3, y - 12 + Math.sin(a) * r - 3 + k * k * 20, 6, 6);
    }
    g.globalAlpha = 1;
  }
}

let uiButtons = [];
function btn(id, x, y, w, h) { uiButtons.push({ id, x, y, w, h }); }

function drawHud(g) {
  const p = player, T = touch.enabled;
  uiButtons = [];
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(12, 12, 224, 22);
  g.fillStyle = p.life > 60 ? '#5bd16a' : '#e04a3a'; g.fillRect(14, 14, 220 * clamp(p.life / p.maxLife, 0, 1), 18);
  g.fillStyle = '#fff'; g.font = 'bold 12px system-ui, sans-serif'; g.textAlign = 'left';
  g.fillText(`LIFE ${Math.ceil(p.life)}`, 20, 28);
  const rx = VIEW_W - 16 - (T ? 54 : 0);
  g.textAlign = 'right'; g.font = 'bold 20px system-ui, sans-serif';
  g.fillText(score.toLocaleString(), rx, 32);
  g.font = '12px system-ui, sans-serif'; g.fillStyle = '#bbb';
  const left = Math.max(0, Math.ceil(up.L.Zombie_TotalCount));
  g.fillText(VIEW_W < 700 ? `LV ${up.level} · left ${left}` : `LEVEL ${up.level}  ·  zombies left ${left}  ·  kills ${kills}`, rx, 50);
  g.textAlign = 'left';
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(12, 40, 224, 32);
  g.fillStyle = up.multiplier >= 10 ? '#ffd166' : '#fff'; g.font = 'bold 20px system-ui, sans-serif';
  g.fillText('x' + up.multiplier, 18, 64);
  const ratio = up.multiplier > 1 ? up.mTick / up.mTickTotal : 0;
  g.fillStyle = '#333'; g.fillRect(80, 50, 148, 7);
  g.fillStyle = '#ffd166'; g.fillRect(80, 50, 148 * clamp(ratio, 0, 1), 7);
  const kr = up.multiKill ? up.kTick / up.kTickTotal : 0;
  g.fillStyle = '#333'; g.fillRect(80, 60, 148, 4);
  g.fillStyle = '#ff7a5c'; g.fillRect(80, 60, 148 * clamp(kr, 0, 1), 4);
  const next = [...up.rewards.keys()].filter(k => k > up.multiplier && up.rewards.get(k).some(r => !r.active)).sort((a, b) => a - b)[0];
  if (next) { g.fillStyle = '#999'; g.font = '10px system-ui, sans-serif'; g.fillText('next reward x' + next, 80, 47); }
  const owned = WEAPON_ORDER.filter(ownsWeapon);
  const sw = Math.min(92, Math.floor((VIEW_W - 24) / owned.length) - 4), sh = T ? 38 : 34;
  let x = 12; const y = T ? 82 : VIEW_H - 46;
  for (const id of owned) {
    const w = p.weapons[id], sel = id === p.cur, compact = sw < 70;
    g.fillStyle = sel ? 'rgba(255,209,102,.9)' : 'rgba(0,0,0,.55)'; g.fillRect(x, y, sw, sh);
    g.fillStyle = sel ? '#111' : '#ddd'; g.font = 'bold 11px system-ui, sans-serif';
    g.fillText(compact ? `${WEAPONS[id].key} ${w.s.name.slice(0, 4)}` : `${WEAPONS[id].key} ${w.s.name}`, x + 5, y + 15);
    g.font = '11px system-ui, sans-serif';
    g.fillText(w.total === INFINITE_AMMO ? '∞' : String(w.ammo), x + 5, y + 30);
    btn('w:' + id, x, y, sw, sh);
    x += sw + 4;
  }
  g.textAlign = 'center';
  let my = T ? 160 : 110;
  for (const m of messages) {
    g.globalAlpha = Math.min(1, m.ttl / 25);
    g.font = m.big ? `bold ${VIEW_W < 700 ? 24 : 32}px system-ui, sans-serif` : 'bold 16px system-ui, sans-serif';
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillText(m.text, VIEW_W / 2 + 2, my + 2);
    g.fillStyle = m.color; g.fillText(m.text, VIEW_W / 2, my);
    my += m.big ? 40 : 24;
  }
  g.globalAlpha = 1;
  if (T) drawTouch(g);
  if (paused) overlay(g, 'PAUSED', T ? 'Tap to resume' : 'P to resume');
  if (mode === 'over') overlay(g, 'YOU DIED', `score ${score.toLocaleString()}  ·  level ${up.level}  ·  best ${best.toLocaleString()}\n\n${T ? 'Tap' : 'Enter / tap'} to retry`);
}

function wrapLines(g, text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (g.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}
function overlay(g, title, sub) {
  g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = 'bold 48px system-ui, sans-serif';
  g.fillText(title, VIEW_W / 2, VIEW_H / 2 - 20);
  g.font = '16px system-ui, sans-serif'; g.fillStyle = '#ccc';
  wrapLines(g, sub, VIEW_W - 48).forEach((l, i) => g.fillText(l, VIEW_W / 2, VIEW_H / 2 + 20 + i * 22));
}
function drawTitle() {
  const g = ctx, T = touch.enabled;
  const top = Math.max(120, VIEW_H / 2 - 150);
  g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = `bold ${VIEW_W < 600 ? 44 : 56}px system-ui, sans-serif`;
  g.fillText('CELL SIEGE', VIEW_W / 2, top);
  g.font = '16px system-ui, sans-serif'; g.fillStyle = '#bbb';
  const text = 'Survive endless waves. Every kill raises the multiplier; reaching new multipliers unlocks weapons and upgrades.\n\n' +
    (T ? 'Left thumb: drag to move.\nRight thumb: hold to fire (grenades throw on release).\nTap a weapon at the top to switch.\n\nTap to start'
       : 'Move: WASD / Arrows   ·   Fire: Space / J (grenade: hold & release)\nWeapons: 1-9, 0, Q / E   ·   Pause: P\n\nPress Enter or click to start');
  wrapLines(g, text, Math.min(VIEW_W - 48, 680)).forEach((l, i) => {
    if (/start$/.test(l)) { g.fillStyle = '#ffd166'; g.font = 'bold 18px system-ui, sans-serif'; }
    g.fillText(l, VIEW_W / 2, top + 60 + i * 26);
  });
}

// ── Input ─────────────────────────────────────────────────────────────────
const keys = { up: false, down: false, left: false, right: false, fire: false, pressed: {} };
const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'fire', KeyJ: 'fire', KeyK: 'fire' };
const touch = { enabled: false, active: false, mx: 0, my: 0, fire: false, firePressed: false, id: null, ox: 0, oy: 0, fireId: null };
const JOY_R = 60;
const fireBtn = () => ({ x: VIEW_W - 100, y: VIEW_H - 110, r: 62 });
const swapBtn = () => ({ x: VIEW_W - 196, y: VIEW_H - 60, r: 32 });
// CInput key edges, sampled once per game frame
let fireWas = false, fireIs = false, fireDownFrame = 0;
const fireDown = () => fireIs;
const firePressed = () => fireIs && !fireWas;
const fireReleased = () => !fireIs && fireWas;
function sampleFire() {
  fireWas = fireIs; fireIs = keys.fire || touch.fire;
  if (fireIs && !fireWas) fireDownFrame = frameNo;
}

function bindInput() {
  addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    const k = KEYMAP[e.code];
    if (k) keys[k] = true;
    if (!e.repeat) keys.pressed[e.code] = true;
    audioUnlock();
  });
  addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
  addEventListener('blur', () => { for (const k of ['up', 'down', 'left', 'right', 'fire']) keys[k] = false; touchReset(); });
  canvas.addEventListener('mousedown', () => { audioUnlock(); if (mode !== 'play') keys.pressed.Enter = true; });

  const pos = t => { const r = canvas.getBoundingClientRect(); return { x: (t.clientX - r.left) * VIEW_W / r.width, y: (t.clientY - r.top) * VIEW_H / r.height }; };
  canvas.addEventListener('touchstart', e => {
    e.preventDefault(); audioUnlock(); goFullscreen();
    if (!touch.enabled) { touch.enabled = true; resize(); }
    for (const t of e.changedTouches) {
      const p = pos(t);
      if (mode !== 'play') { touch.firePressed = true; continue; }
      if (paused) { paused = false; continue; }
      const b = uiButtons.find(b => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
      if (b) {
        if (b.id === 'pause') paused = true;
        else if (b.id.startsWith('w:')) { const id = b.id.slice(2); if (ownsWeapon(id) && player.weapons[id].ammo > 0) selectWeapon(id); }
        continue;
      }
      const sb = swapBtn();
      if (dist(p.x, p.y, sb.x, sb.y) < sb.r + 8) { keys.pressed.nextW = true; continue; }
      if (p.x < VIEW_W * 0.5 && touch.id === null) {
        touch.id = t.identifier; touch.ox = p.x; touch.oy = p.y; touch.active = true; touch.mx = touch.my = 0;
      } else if (touch.fireId === null) { touch.fireId = t.identifier; touch.fire = true; touch.firePressed = true; }
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === touch.id) {
      const p = pos(t); let dx = p.x - touch.ox, dy = p.y - touch.oy; const l = Math.hypot(dx, dy);
      if (l > JOY_R) { touch.ox = p.x - dx / l * JOY_R; touch.oy = p.y - dy / l * JOY_R; dx = dx / l * JOY_R; dy = dy / l * JOY_R; }
      const m = Math.hypot(dx, dy);
      touch.mx = m > 10 ? dx / JOY_R : 0; touch.my = m > 10 ? dy / JOY_R : 0;
    }
  }, { passive: false });
  const end = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === touch.id) { touch.active = false; touch.id = null; touch.mx = touch.my = 0; }
      if (t.identifier === touch.fireId) { touch.fire = false; touch.fireId = null; }
    }
  };
  canvas.addEventListener('touchend', end); canvas.addEventListener('touchcancel', end);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { touchReset(); if (mode === 'play') paused = true; } });
}
function touchReset() { touch.active = false; touch.id = null; touch.mx = touch.my = 0; touch.fire = false; touch.fireId = null; }
function goFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !document.body.classList.contains('mobile')) return;
  try { const r = (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' }); if (r && r.catch) r.catch(() => {}); } catch (e) { /* iOS Safari */ }
}
function drawTouch(g) {
  const bx = touch.active ? touch.ox : 110, by = touch.active ? touch.oy : VIEW_H - 120;
  g.globalAlpha = touch.active ? 0.3 : 0.15; g.fillStyle = '#fff';
  g.beginPath(); g.arc(bx, by, JOY_R, 0, TAU); g.fill();
  g.globalAlpha = touch.active ? 0.55 : 0.3;
  g.beginPath(); g.arc(touch.active ? bx + touch.mx * JOY_R : bx, touch.active ? by + touch.my * JOY_R : by, 26, 0, TAU); g.fill();
  const f = fireBtn();
  g.globalAlpha = touch.fire ? 0.5 : 0.25; g.fillStyle = touch.fire ? '#ffd166' : '#fff';
  g.beginPath(); g.arc(f.x, f.y, f.r, 0, TAU); g.fill();
  const s = swapBtn();
  g.globalAlpha = 0.22; g.fillStyle = '#fff'; g.beginPath(); g.arc(s.x, s.y, s.r, 0, TAU); g.fill();
  g.fillRect(VIEW_W - 58, 14, 44, 40); btn('pause', VIEW_W - 62, 10, 52, 48);
  g.globalAlpha = 0.85; g.fillStyle = '#000'; g.textAlign = 'center';
  g.font = 'bold 16px system-ui, sans-serif'; g.fillText('FIRE', f.x, f.y + 6);
  g.font = 'bold 12px system-ui, sans-serif'; g.fillText('WPN', s.x, s.y + 4);
  g.fillStyle = '#fff'; g.fillRect(VIEW_W - 42, 24, 5, 20); g.fillRect(VIEW_W - 33, 24, 5, 20);
  g.globalAlpha = 1;
}

// ── Synth SFX ─────────────────────────────────────────────────────────────
let actx = null;
function audioUnlock() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
}
const SFX = {
  shot: [880, 0.04, 'square', 0.04], shotgun: [160, 0.12, 'sawtooth', 0.09], rail: [1400, 0.18, 'sine', 0.07],
  rocket: [220, 0.2, 'sawtooth', 0.05], throw: [500, 0.06, 'triangle', 0.05], place: [300, 0.06, 'triangle', 0.06],
  boom: [60, 0.35, 'noise', 0.25], kill: [140, 0.06, 'noise', 0.06], hurt: [120, 0.12, 'square', 0.08],
  pickup: [990, 0.12, 'triangle', 0.08], unlock: [660, 0.3, 'triangle', 0.09], level: [440, 0.25, 'triangle', 0.08],
  switch: [700, 0.03, 'square', 0.03], fireball: [180, 0.2, 'sawtooth', 0.05],
};
let sfxBudget = 0;
function sfx(name) {
  if (!actx || sfxBudget > 6) return; sfxBudget++;
  const [f, d, type, vol] = SFX[name], t = actx.currentTime, gn = actx.createGain();
  gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + d); gn.connect(actx.destination);
  if (type === 'noise') {
    const len = Math.floor(actx.sampleRate * d), buf = actx.createBuffer(1, len, actx.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = actx.createBufferSource(), flt = actx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = f * 20;
    src.buffer = buf; src.connect(flt); flt.connect(gn); src.start(t);
  } else {
    const o = actx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.5, t + d);
    o.connect(gn); o.start(t); o.stop(t + d);
  }
}

// ── Loop: fixed 50 fps simulation like the original ────────────────────────
const DT = 1 / FPS;
let acc = 0, last = 0;
function step() {
  sampleFire();
  update();
  keys.pressed = {}; touch.firePressed = false;
}
function frame(ts) {
  const now = ts / 1000; acc += Math.min(0.1, now - (last || now)); last = now;
  while (acc >= DT) { step(); acc -= DT; }
  sfxBudget = 0;
  draw();
  requestAnimationFrame(frame);
}

function isMobile() {
  return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || innerWidth < 760;
}
function resize() {
  const mobile = isMobile() || touch.enabled;
  document.body.classList.toggle('mobile', mobile);
  let cssW, cssH;
  if (mobile) {
    cssW = innerWidth; cssH = innerHeight;
    const k = Math.min(560 / Math.min(cssW, cssH), (MW * CELL) / cssW, (MH * CELL) / cssH);
    VIEW_W = Math.min(Math.round(cssW * k), MW * CELL); VIEW_H = Math.min(Math.round(cssH * k), MH * CELL);
  } else {
    VIEW_W = 960; VIEW_H = 640;
    cssW = canvas.getBoundingClientRect().width || 960; cssH = cssW * VIEW_H / VIEW_W;
  }
  const dpr = window.devicePixelRatio || 1;
  RS = clamp(Math.min(cssW / VIEW_W, cssH / VIEW_H) * dpr, 1, 3);
  canvas.width = Math.round(VIEW_W * RS); canvas.height = Math.round(VIEW_H * RS);
}

function boot() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');
  touch.enabled = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  resize();
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 200));
  try { best = +localStorage.getItem('cellsiege.best') || 0; } catch (e) { best = 0; }
  bindInput();
  requestAnimationFrame(frame);
}
if (typeof window !== 'undefined' && !window.__HEADLESS__) window.addEventListener('load', boot);
