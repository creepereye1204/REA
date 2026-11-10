'use strict';
/* Cell Siege \u2014 top-down grid survival shooter.
 * Architecture follows the structure recovered from the analyzed SWF:
 *   - cell grid map + collide flags           (CMap / CMap_Cell)
 *   - BFS distance field from the player      (CMap_Cell.Nav_Update / NF_4 / Nav_Direction)
 *   - cell-to-cell creature state machine     (CThing_Creature.SetState / State_CellToCell)
 *   - combo multiplier w/ decaying window     (CUpgrades.__set__mMultiplier / GetTicks)
 *   - multiplier-threshold weapon upgrades    (CUpgrades.InitLists / ApplyUpgrade_Weapon)
 *   - level table + spawn throttling          (CUpgrades.Process / CWorld.Spawn_*)
 *   - need-weighted random pickups            (CThing_Creature_Player.RandomPickup)
 */

const CELL = 32, MW = 40, MH = 30;
const VIEW_W = 960, VIEW_H = 640;
const DT = 1 / 60;
const INF = 1e9;
const DIRS = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]]; // 8 directions, 0 = east, clockwise (screen y down)

const idx = (x, y) => y * MW + x;
const inMap = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// ── Map ───────────────────────────────────────────────────────────────────
const solid = new Uint8Array(MW * MH);
const objAt = new Array(MW * MH).fill(null); // barrels
const occ = new Int16Array(MW * MH);         // creature reservations
const flow = new Int32Array(MW * MH);
let spawnPoints = [], crateSpots = [];
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
  // gates in the outer wall — creatures enter here
  spawnPoints = [];
  const gate = (cells) => { for (const [x, y] of cells) { solid[idx(x, y)] = 0; spawnPoints.push({ x, y }); } };
  gate([[19,0],[20,0],[21,0]]); gate([[19,MH-1],[20,MH-1]]);
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
  for (const s of spawnPoints) { g.fillStyle = 'rgba(160,40,40,0.35)'; g.fillRect(s.x * CELL, s.y * CELL, CELL, CELL); }
}

function decal(x, y, r, color, n = 6) {
  const g = floorCtx; g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    g.globalAlpha = rand(0.25, 0.6);
    g.beginPath(); g.arc((x + rand(-r, r)) * CELL, (y + rand(-r, r)) * CELL, rand(2, 2 + r * CELL * 0.35), 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}

const blocked = (x, y) => !inMap(x, y) || solid[idx(x, y)] || objAt[idx(x, y)];

// BFS distance field from the player cell (4-neighbour, like NF_4 on ac[0,2,4,6])
let flowFrom = -1, flowDirty = true;
function updateFlow() {
  const pc = idx(player.x | 0, player.y | 0);
  if (pc === flowFrom && !flowDirty) return;
  flowFrom = pc; flowDirty = false;
  flow.fill(INF);
  const q = new Int32Array(MW * MH); let h = 0, t = 0;
  flow[pc] = 0; q[t++] = pc;
  while (h < t) {
    const c = q[h++], cx = c % MW, cy = (c / MW) | 0, d = flow[c] + 1;
    for (let k = 0; k < 8; k += 2) {
      const nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
      if (blocked(nx, ny)) continue;
      const n = idx(nx, ny);
      if (flow[n] > d) { flow[n] = d; q[t++] = n; }
    }
  }
}

function canStep(cx, cy, k) {
  const [dx, dy] = DIRS[k], nx = cx + dx, ny = cy + dy;
  if (blocked(nx, ny)) return false;
  if (dx && dy && (blocked(cx + dx, cy) || blocked(cx, cy + dy))) return false;
  return true;
}

function lineOfSight(ax, ay, bx, by) {
  const d = dist(ax, ay, bx, by), steps = Math.ceil(d / 0.25);
  for (let i = 1; i < steps; i++) {
    const x = ax + (bx - ax) * i / steps, y = ay + (by - ay) * i / steps;
    if (solid[idx(x | 0, y | 0)]) return false;
  }
  return true;
}

// ── State ─────────────────────────────────────────────────────────────────
let player, creatures, shots, effects, pickups, mines, tracers, floaters, messages;
let mode = 'title', paused = false, time = 0, shake = 0, cam = { x: 0, y: 0 };
let combo, chain, level, score, best = 0, kills = 0;

function newWeaponState(id) {
  return { id, flags: new Set(), ammo: 0, cd: 0, stats: null };
}
function computeStats(w) {
  // recomputed from base stats each time, like ApplyUpgrade_Weapon(mOriginalStats)
  const b = WEAPONS[w.id], f = w.flags, s = { ...b };
  if (f.has('quadDmg')) s.dmg = b.dmg * 4; else if (f.has('doubleDmg')) s.dmg = b.dmg * 2;
  if (f.has('auto')) s.auto = true;
  if (f.has('fastFire')) { s.rate = Math.max(b.rate / 2.5, 0.05); s.auto = true; }
  if (f.has('wider')) s.wide = 2; else if (f.has('wide')) s.wide = 1;
  if (f.has('bigBang')) s.radius = b.radius * 1.5;
  if (f.has('longShot')) s.range = b.range * 1.5;
  if (f.has('infinite')) s.ammo = Infinity;
  else if (f.has('quadAmmo')) s.ammo = b.ammo * 4;
  else if (f.has('doubleAmmo')) s.ammo = b.ammo * 2;
  w.stats = s;
  return s;
}

function resetGame() {
  buildMap();
  player = { x: 20.5, y: 15.5, hp: 200, maxHp: 200, speed: 6.5, r: 0.33, face: 0, aim: 0,
             weapons: {}, cur: 'pistol', inv: 2, hurtFlash: 0, walk: 0 };
  addWeapon('pistol');
  creatures = []; shots = []; effects = []; pickups = []; mines = []; tracers = []; floaters = []; messages = [];
  combo = { m: 1, t: 0, rewards: new Map() };
  for (const r of COMBO_REWARDS) { if (!combo.rewards.has(r[0])) combo.rewards.set(r[0], []); combo.rewards.get(r[0]).push(r); }
  chain = { n: 0, t: 0 };
  score = 0; kills = 0; time = 0; shake = 0;
  for (let i = 0; i < 4; i++) placeBarrel([9, 30, 20, 20][i] + 0, [15, 14, 8, 22][i]);
  for (const c of crateSpots) pickups.push({ x: c.x + 0.5, y: c.y + 0.5, ttl: Infinity, spot: c });
  cam.x = player.x * CELL - VIEW_W / 2; cam.y = player.y * CELL - VIEW_H / 2;
  flowDirty = true;
  setLevel(1);
}

function addWeapon(id) {
  let w = player.weapons[id];
  if (!w) { w = player.weapons[id] = newWeaponState(id); }
  w.ghost = false;
  computeStats(w); w.ammo = w.stats.ammo;
  return w;
}

function setLevel(n) {
  level = { n, spec: levelSpec(n), walkersLeft: 0, brutesLeft: 0, walkerTimer: 0, bruteTimer: 0 };
  level.walkersLeft = level.spec.walkerTotal;
  level.brutesLeft = level.spec.bruteTotal;
  level.walkerTimer = 1.5; level.bruteTimer = level.spec.bruteEvery;
  msg(`\u2014 LEVEL ${n} \u2014`, '#fff', 2.2, true);
}

function msg(text, color = '#fff', ttl = 2.5, big = false) {
  messages.push({ text, color, ttl, max: ttl, big });
  if (messages.length > 6) messages.shift();
}

// ── Combo / multiplier (ported semantics) ──────────────────────────────────
function setMultiplier(m) {
  m = clamp(m, 1, 999);
  const up = m > combo.m;
  combo.m = m; combo.t = comboWindow(m);
  if (up && combo.rewards.has(m)) {
    for (const [, wid, type, label] of combo.rewards.get(m)) applyReward(wid, type, label);
    combo.rewards.delete(m); // one-shot, like `delete this.mMultipliers[index]`
  }
}
function applyReward(wid, type, label) {
  if (type === 'unlock') { addWeapon(wid); msg(label, '#ffd166', 3.5); sfx('unlock'); return; }
  const w = player.weapons[wid] || newWeaponState(wid);
  if (!player.weapons[wid]) { player.weapons[wid] = w; w.ghost = true; } // upgrade before unlock: keep flag
  w.flags.add(type);
  computeStats(w);
  if (type.endsWith('Ammo') || type === 'infinite') w.ammo = w.stats.ammo;
  else if (w.ammo > w.stats.ammo) w.ammo = w.stats.ammo;
  msg(label, '#8fd3ff', 3);
}
function ownsWeapon(id) { const w = player.weapons[id]; return w && !w.ghost; }

function onKill(c) {
  kills++;
  setMultiplier(combo.m + 1);
  chain.n++; chain.t = comboWindow(chain.n) / 3;
  const pts = c.def.score * combo.m;
  score += pts;
  floaters.push({ x: c.x, y: c.y - 0.6, text: '+' + pts, ttl: 1, color: combo.m > 9 ? '#ffd166' : '#fff' });
  if (c.type === 'walker') level.walkersLeft = Math.max(0, level.walkersLeft - 1);
  else level.brutesLeft = Math.max(0, level.brutesLeft - 1);
  // drops: brute always, walker every 5th kill in a fast chain (LogKill: mMultipleKill % 5 == 0)
  if (c.type === 'brute' || chain.n % 5 === 0) dropCrate(c.x, c.y);
}

function dropCrate(x, y) {
  const cx = x | 0, cy = y | 0;
  if (solid[idx(cx, cy)]) return;
  pickups.push({ x: cx + 0.5, y: cy + 0.5, ttl: 10 });
}

// RandomPickup(): weight by how empty each owned weapon is, plus life by damage taken
function randomPickup() {
  const list = []; let total = 0;
  for (const id of WEAPON_ORDER) {
    if (!ownsWeapon(id) || id === 'pistol') continue;
    const w = player.weapons[id];
    if (!isFinite(w.stats.ammo)) continue;
    const ch = (1 - w.ammo / w.stats.ammo) * 0.75 + 0.25;
    total += ch; list.push({ id, idx: total });
  }
  if (player.hp < player.maxHp) {
    const ch = (1 - player.hp / player.maxHp) * Math.max(total, 1);
    total += ch; list.push({ id: 'life', idx: total });
  }
  if (!list.length) { score += 250; floaters.push({ x: player.x, y: player.y - 0.8, text: '+250', ttl: 1, color: '#9f9' }); return; }
  const r = Math.random() * total;
  for (const e of list) {
    if (r < e.idx) {
      if (e.id === 'life') { player.hp = player.maxHp; msg('Life up!', '#7dff9a', 1.6); }
      else { const w = addWeapon(e.id); msg('Picked up ' + w.stats.name, '#ddd', 1.6); }
      break;
    }
  }
  sfx('pickup');
}

// ── Spawning (Spawn_ValidPosition / Spawn_Zombie / Spawn_Devil) ────────────
function aliveCount(type) { let n = 0; for (const c of creatures) if (c.type === type) n++; return n; }
function spawn(type) {
  const n = spawnPoints.length; let i = (Math.random() * n) | 0;
  for (let k = 0; k < n; k++, i = (i + 1) % n) {
    const s = spawnPoints[i], ci = idx(s.x, s.y);
    if (occ[ci] || dist(s.x + .5, s.y + .5, player.x, player.y) < 5) continue;
    const def = ENEMIES[type];
    const c = { type, def, x: s.x + .5, y: s.y + .5, cx: s.x, cy: s.y, hp: def.hp, maxHp: def.hp,
                state: 'think', t: 0, cd: 0, fireCd: rand(1, def.fireCD || 1), move: null, face: Math.PI / 2,
                flash: 0, walk: Math.random() * 6, speed: def.speed * level.spec.speedMul * rand(0.9, 1.1) };
    occ[ci]++;
    creatures.push(c);
    return true;
  }
  return false;
}

function updateLevel(dt) {
  const L = level, S = L.spec;
  const walkersAlive = aliveCount('walker'), brutesAlive = aliveCount('brute');
  if (L.walkersLeft <= 0 && L.brutesLeft <= 0 && walkersAlive === 0 && brutesAlive === 0) { setLevel(L.n + 1); sfx('level'); return; }
  L.walkerTimer -= dt;
  if (L.walkerTimer <= 0 && walkersAlive < Math.min(S.walkerCap, L.walkersLeft)) {
    if (spawn('walker')) L.walkerTimer = S.walkerEvery;
  }
  L.bruteTimer -= dt;
  if (L.bruteTimer <= 0 && brutesAlive < Math.min(Math.max(S.bruteCap, 1), L.brutesLeft)) {
    if (spawn('brute')) L.bruteTimer = S.bruteEvery;
  }
}

// ── Creatures: cell-to-cell state machine ──────────────────────────────────
function updateCreature(c, dt) {
  c.flash = Math.max(0, c.flash - dt); c.cd -= dt; c.fireCd -= dt;
  const dP = dist(c.x, c.y, player.x, player.y);
  const reach = 0.95 + c.def.radius;

  if (c.state === 'move') {
    const m = c.move; m.t += dt * c.speed / m.len;
    c.walk += dt * c.speed * 6;
    if (m.t >= 1) {
      c.x = m.tx + .5; c.y = m.ty + .5;
      occ[idx(c.cx, c.cy)]--; c.cx = m.tx; c.cy = m.ty; c.move = null; c.state = 'think';
      if (mineCheck(c)) return;
    } else { c.x = m.fx + .5 + (m.tx - m.fx) * m.t; c.y = m.fy + .5 + (m.ty - m.fy) * m.t; }
    return;
  }
  if (c.state === 'attack') {
    c.t -= dt;
    if (c.t <= 0) {
      if (dist(c.x, c.y, player.x, player.y) < reach + 0.35) hurtPlayer(c.def.dmg);
      c.cd = c.def.attackCD; c.state = 'think';
    }
    return;
  }
  if (c.state === 'fire') {
    c.t -= dt;
    if (c.t <= 0) {
      const a = Math.atan2(player.y - c.y, player.x - c.x);
      shots.push({ kind: 'fireball', x: c.x + Math.cos(a) * .6, y: c.y + Math.sin(a) * .6, vx: Math.cos(a) * 6.5, vy: Math.sin(a) * 6.5, life: 3, dmg: c.def.fireDmg, owner: c });
      c.fireCd = c.def.fireCD; c.state = 'think'; sfx('fireball');
    }
    return;
  }
  if (c.state === 'wait') { c.t -= dt; if (c.t <= 0) c.state = 'think'; return; }

  // think
  c.face = turnToward(c.face, Math.atan2(player.y - c.y, player.x - c.x), dt * 8);
  if (dP < reach && c.cd <= 0) { c.state = 'attack'; c.t = c.def.attackTime; return; }
  if (dP < reach) return;
  if (c.type === 'brute' && dP < c.def.fireRange && c.fireCd <= 0 && lineOfSight(c.x, c.y, player.x, player.y)) {
    c.state = 'fire'; c.t = 0.45; return;
  }
  // Nav_Direction: step to a neighbour with smaller distance, prefer the one facing the target
  const cur = idx(c.cx, c.cy), cd = flow[cur];
  const want = Math.atan2(player.y - c.y, player.x - c.x);
  let bestK = -1, bestScore = Infinity, anyBetter = false;
  for (let k = 0; k < 8; k++) {
    if (!canStep(c.cx, c.cy, k)) continue;
    const n = idx(c.cx + DIRS[k][0], c.cy + DIRS[k][1]);
    const fd = flow[n];
    if (cd < INF && fd >= cd) continue;
    anyBetter = true;
    if (occ[n] || n === flowFrom) continue;
    const align = Math.cos(Math.atan2(DIRS[k][1], DIRS[k][0]) - want);
    const sc = fd * 2 - align * 1.5 + (DIRS[k][0] && DIRS[k][1] ? 0.4 : 0) + Math.random() * 0.2;
    if (sc < bestScore) { bestScore = sc; bestK = k; }
  }
  if (bestK < 0) {
    if (!anyBetter && cd >= INF) { // no path: wander (State_Wander)
      const k = (Math.random() * 8) | 0;
      if (canStep(c.cx, c.cy, k) && !occ[idx(c.cx + DIRS[k][0], c.cy + DIRS[k][1])]) bestK = k;
    }
    if (bestK < 0) { c.state = 'wait'; c.t = rand(0.08, 0.25); return; }
  }
  const tx = c.cx + DIRS[bestK][0], ty = c.cy + DIRS[bestK][1];
  occ[idx(tx, ty)]++;
  c.move = { fx: c.cx, fy: c.cy, tx, ty, t: 0, len: Math.hypot(DIRS[bestK][0], DIRS[bestK][1]) };
  // continue from current position (could be offset after knockback)
  c.state = 'move';
}

function turnToward(a, b, max) {
  let d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + clamp(d, -max, max);
}

function damageCreature(c, dmg, ax, ay) {
  if (c.dead) return;
  c.hp -= dmg; c.flash = 0.08;
  decal(c.x, c.y, 0.25, '#5b0f0f', 2);
  if (ax !== undefined && c.state !== 'move') {
    // small knockback inside its cell (BulletHit)
    const kx = c.x + Math.cos(ax) * 0.08, ky = c.y + Math.sin(ax) * 0.08;
    if (Math.abs(kx - (c.cx + .5)) < 0.3) c.x = kx;
    if (Math.abs(ky - (c.cy + .5)) < 0.3) c.y = ky;
  }
  if (c.hp <= 0) killCreature(c);
}
function killCreature(c) {
  c.dead = true;
  occ[idx(c.cx, c.cy)]--;
  if (c.move) occ[idx(c.move.tx, c.move.ty)]--;
  decal(c.x, c.y, c.type === 'brute' ? 0.6 : 0.4, '#4a0c0c', c.type === 'brute' ? 14 : 8);
  effects.push({ kind: 'gib', x: c.x, y: c.y, t: 0, life: 0.35, color: c.def.color, big: c.type === 'brute' });
  sfx('kill');
  onKill(c);
}

// ── Player ────────────────────────────────────────────────────────────────
function hurtPlayer(dmg) {
  if (player.inv > 0 || mode !== 'play') return;
  player.hp -= dmg; player.hurtFlash = 0.25; shake = Math.max(shake, 6);
  decal(player.x, player.y, 0.25, '#6a1010', 3);
  sfx('hurt');
  if (player.hp <= 0) { player.hp = 0; gameOver(); }
}

function gameOver() {
  mode = 'over';
  try { best = Math.max(best, +localStorage.getItem('cellsiege.best') || 0); if (score > best) { best = score; localStorage.setItem('cellsiege.best', String(best)); } }
  catch (e) { best = Math.max(best, score); }
}

function solidAt(x, y) {
  const cx = Math.floor(x), cy = Math.floor(y);
  return !inMap(cx, cy) || solid[idx(cx, cy)] || objAt[idx(cx, cy)];
}
function boxFree(x, y, r) {
  return !solidAt(x - r, y - r) && !solidAt(x + r, y - r) && !solidAt(x - r, y + r) && !solidAt(x + r, y + r);
}

function updatePlayer(dt) {
  const p = player;
  p.inv = Math.max(0, p.inv - dt); p.hurtFlash = Math.max(0, p.hurtFlash - dt);
  // regen: maxLife / (FPS*30) per frame  →  full heal in 30 s
  if (p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.maxHp / 30 * dt);

  let mx = 0, my = 0;
  if (keys.left) mx -= 1; if (keys.right) mx += 1; if (keys.up) my -= 1; if (keys.down) my += 1;
  if (touch.active) { mx = touch.mx; my = touch.my; }
  const len = Math.hypot(mx, my);
  if (len > 0.2) {
    // facing snaps to 8 directions, like the original's direction-indexed sprites
    p.face = Math.round(Math.atan2(my, mx) / (Math.PI / 4)) * (Math.PI / 4);
    const sp = p.speed * dt * Math.min(1, len);
    const vx = mx / len * sp, vy = my / len * sp;
    if (boxFree(p.x + vx, p.y, p.r)) p.x += vx;
    if (boxFree(p.x, p.y + vy, p.r)) p.y += vy;
    p.walk += sp * 3;
  }
  p.aim = turnToward(p.aim, p.face, dt * 30);
  // push out of creatures
  for (const c of creatures) {
    const d = dist(p.x, p.y, c.x, c.y), min = p.r + c.def.radius * 0.9;
    if (d < min && d > 0.001) {
      const nx = p.x + (p.x - c.x) / d * (min - d), ny = p.y + (p.y - c.y) / d * (min - d);
      if (boxFree(nx, p.y, p.r)) p.x = nx;
      if (boxFree(p.x, ny, p.r)) p.y = ny;
    }
  }
  // weapon select
  for (const id of WEAPON_ORDER) if (keys.pressed['Digit' + WEAPONS[id].key] && ownsWeapon(id)) selectWeapon(id);
  if (keys.pressed.KeyQ || keys.pressed.prevW) cycleWeapon(-1);
  if (keys.pressed.KeyE || keys.pressed.nextW) cycleWeapon(1);
  // fire
  const w = p.weapons[p.cur]; w.cd -= dt;
  const s = w.stats;
  const trigger = s.auto ? (keys.fire || touch.fire) : (keys.firePressed || touch.firePressed);
  if (trigger && w.cd <= 0) {
    if (w.ammo > 0) { fireWeapon(w); w.cd = s.rate; if (isFinite(w.ammo)) w.ammo--; }
    else { sfx('empty'); w.cd = 0.2; }
    if (w.ammo <= 0 && p.cur !== 'pistol') { msg(`${s.name} empty`, '#aaa', 1.2); selectWeapon('pistol'); }
  }
  // pickups
  for (let i = pickups.length - 1; i >= 0; i--) {
    const k = pickups[i];
    if (dist(p.x, p.y, k.x, k.y) < 0.65) {
      randomPickup();
      if (k.spot) { k.respawn = 20; k.hidden = true; } else pickups.splice(i, 1);
    }
  }
}
function selectWeapon(id) { if (player.cur !== id) { player.cur = id; sfx('switch'); } }
function cycleWeapon(d) {
  const owned = WEAPON_ORDER.filter(id => ownsWeapon(id) && (player.weapons[id].ammo > 0));
  const i = owned.indexOf(player.cur);
  selectWeapon(owned[(i + d + owned.length) % owned.length]);
}

// ── Weapons ───────────────────────────────────────────────────────────────
function fireWeapon(w) {
  const p = player, s = w.stats, a = p.face;
  const ox = p.x + Math.cos(a) * 0.45, oy = p.y + Math.sin(a) * 0.45;
  switch (s.kind) {
    case 'ray': hitscan(ox, oy, a + rand(-0.02, 0.02), s.range, s.dmg, false, s.color); flashAt(ox, oy, a); sfx('shot'); break;
    case 'spread': {
      // centre pellet + pairs at ±k·step, step = 1.25°·(wide+1)  (CThing_Weapon_Shotgun.Fire)
      hitscan(ox, oy, a, s.range, s.dmg, false, s.color);
      const step = 1.25 * (s.wide + 1) * Math.PI / 180 * 3;
      for (let k = 1; k <= 2 + s.wide; k++) {
        hitscan(ox, oy, a - step * k, s.range, s.dmg, false, s.color);
        hitscan(ox, oy, a + step * k, s.range, s.dmg, false, s.color);
      }
      flashAt(ox, oy, a); shake = Math.max(shake, 3); sfx('shotgun'); break;
    }
    case 'pierce': hitscan(ox, oy, a, s.range, s.dmg, true, s.color); shake = Math.max(shake, 4); sfx('rail'); break;
    case 'rocket':
      shots.push({ kind: 'rocket', x: ox, y: oy, vx: Math.cos(a) * 13, vy: Math.sin(a) * 13, life: s.range / 13, dmg: s.dmg, radius: s.radius });
      sfx('rocket'); break;
    case 'grenade': {
      const r = s.range;
      shots.push({ kind: 'grenade', x: ox, y: oy, vx: Math.cos(a) * r / 0.7, vy: Math.sin(a) * r / 0.7, t: 0, air: 0.7, fuse: 0.35, dmg: s.dmg, radius: s.radius });
      sfx('throw'); break;
    }
    case 'barrel': {
      const tx = Math.floor(p.x + Math.cos(a) * 1.0), ty = Math.floor(p.y + Math.sin(a) * 1.0);
      if (!placeBarrel(tx, ty, s)) { w.ammo++; sfx('empty'); } else sfx('place');
      break;
    }
    case 'mine':
      mines.push({ x: p.x, y: p.y, arm: 0.6, dmg: s.dmg, radius: s.radius }); sfx('place'); break;
  }
}

function placeBarrel(tx, ty, s) {
  if (!inMap(tx, ty) || solid[idx(tx, ty)] || objAt[idx(tx, ty)] || occ[idx(tx, ty)]) return false;
  if (player && Math.floor(player.x) === tx && Math.floor(player.y) === ty) return false;
  const st = s || (player && player.weapons.barrel && player.weapons.barrel.stats) || WEAPONS.barrel;
  objAt[idx(tx, ty)] = { kind: 'barrel', x: tx + .5, y: ty + .5, dmg: st.dmg, radius: st.radius, fuse: -1 };
  flowDirty = true;
  return true;
}

function flashAt(x, y, a) { effects.push({ kind: 'flash', x, y, a, t: 0, life: 0.05 }); }

function hitscan(x, y, a, range, dmg, pierce, color) {
  const dx = Math.cos(a), dy = Math.sin(a), step = 0.1;
  const near = creatures.filter(c => dist(c.x, c.y, x, y) < range + 1);
  const hit = new Set();
  let ex = x, ey = y;
  for (let d = 0; d <= range; d += step) {
    ex = x + dx * d; ey = y + dy * d;
    const cx = Math.floor(ex), cy = Math.floor(ey);
    if (!inMap(cx, cy) || solid[idx(cx, cy)]) { effects.push({ kind: 'spark', x: ex, y: ey, t: 0, life: 0.15 }); break; }
    const o = objAt[idx(cx, cy)];
    if (o && dist(ex, ey, o.x, o.y) < 0.35) { triggerBarrel(o, 0); break; }
    let stop = false;
    for (const c of near) {
      if (c.dead || hit.has(c)) continue;
      if (dist(ex, ey, c.x, c.y) < c.def.radius) {
        hit.add(c); damageCreature(c, dmg, a);
        if (!pierce) { stop = true; break; }
      }
    }
    if (stop) break;
  }
  tracers.push({ x1: x, y1: y, x2: ex, y2: ey, t: 0, life: pierce ? 0.25 : 0.06, color, w: pierce ? 4 : 1.5 });
}

function triggerBarrel(o, delay) { if (o.fuse < 0) o.fuse = delay; }

function explode(x, y, radius, dmg, fromPlayer = true) {
  shake = Math.max(shake, 10 + radius * 2);
  effects.push({ kind: 'boom', x, y, r: radius, t: 0, life: 0.4 });
  decal(x, y, radius * 0.35, '#1d1a17', 10);
  sfx('boom');
  for (const c of creatures) {
    const d = dist(c.x, c.y, x, y);
    if (d < radius + c.def.radius) damageCreature(c, dmg * (1 - 0.5 * clamp(d / radius, 0, 1)), Math.atan2(c.y - y, c.x - x));
  }
  const dp = dist(player.x, player.y, x, y);
  if (dp < radius) hurtPlayer(dmg * (fromPlayer ? 0.25 : 1) * (1 - 0.5 * dp / radius));
  // chain reaction
  for (let cy = Math.floor(y - radius); cy <= y + radius; cy++)
    for (let cx = Math.floor(x - radius); cx <= x + radius; cx++) {
      if (!inMap(cx, cy)) continue;
      const o = objAt[idx(cx, cy)];
      if (o && dist(o.x, o.y, x, y) < radius) triggerBarrel(o, 0.12);
    }
  for (const m of mines) if (dist(m.x, m.y, x, y) < radius) m.trigger = true;
}

function mineCheck(c) {
  for (const m of mines) if (m.arm <= 0 && dist(m.x, m.y, c.x, c.y) < 0.7) { m.trigger = true; return false; }
  return false;
}

function updateShots(dt) {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    if (s.kind === 'grenade') {
      s.t += dt;
      if (s.t < s.air) {
        const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt;
        if (solidAt(nx, s.y)) s.vx *= -0.4; else s.x = nx;
        if (solidAt(s.x, ny)) s.vy *= -0.4; else s.y = ny;
      } else if (s.t > s.air + s.fuse) { explode(s.x, s.y, s.radius, s.dmg); shots.splice(i, 1); }
      continue;
    }
    s.life -= dt;
    const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt;
    let boom = s.life <= 0 || solidAt(nx, ny);
    if (s.kind === 'rocket') {
      effects.push({ kind: 'smoke', x: s.x, y: s.y, t: 0, life: 0.5 });
      for (const c of creatures) if (!c.dead && dist(nx, ny, c.x, c.y) < c.def.radius + 0.1) boom = true;
      if (boom) { explode(s.x, s.y, s.radius, s.dmg); shots.splice(i, 1); continue; }
    } else if (s.kind === 'fireball') {
      if (dist(nx, ny, player.x, player.y) < player.r + 0.25) { hurtPlayer(s.dmg); boom = true; }
      const o = inMap(nx | 0, ny | 0) && objAt[idx(nx | 0, ny | 0)];
      if (o) { triggerBarrel(o, 0); boom = true; }
      if (boom) { effects.push({ kind: 'boom', x: s.x, y: s.y, r: 0.7, t: 0, life: 0.25, fire: true }); shots.splice(i, 1); continue; }
    }
    s.x = nx; s.y = ny;
  }
  for (let i = mines.length - 1; i >= 0; i--) {
    const m = mines[i];
    m.arm -= dt;
    if (m.arm <= 0 && !m.trigger) for (const c of creatures) if (dist(m.x, m.y, c.x, c.y) < 0.7) m.trigger = true;
    if (m.trigger) { mines.splice(i, 1); explode(m.x, m.y, m.radius, m.dmg); }
  }
  for (let i = 0; i < objAt.length; i++) {
    const o = objAt[i];
    if (o && o.fuse >= 0) { o.fuse -= dt; if (o.fuse < 0) { objAt[i] = null; flowDirty = true; explode(o.x, o.y, o.radius, o.dmg); } }
  }
}

// ── Main update ───────────────────────────────────────────────────────────
function update(dt) {
  if (mode !== 'play') {
    if (keys.pressed.Enter || keys.pressed.Space || touch.firePressed) { resetGame(); mode = 'play'; sfx('level'); }
    return;
  }
  if (keys.pressed.KeyP || keys.pressed.Escape) paused = !paused;
  if (paused) return;
  time += dt;
  updatePlayer(dt);
  updateFlow();
  for (const c of creatures) if (!c.dead) updateCreature(c, dt);
  updateShots(dt);
  creatures = creatures.filter(c => !c.dead);
  updateLevel(dt);
  // combo decay: when the window runs out the multiplier drops by one (not to zero)
  if (combo.m > 1) { combo.t -= dt; if (combo.t < 0) setMultiplier(combo.m - 1); }
  if (chain.n > 0) { chain.t -= dt; if (chain.t < 0) chain.n = 0; }
  for (const k of pickups) {
    if (k.spot && k.hidden) { k.respawn -= dt; if (k.respawn <= 0) k.hidden = false; }
    else if (isFinite(k.ttl)) k.ttl -= dt;
  }
  pickups = pickups.filter(k => k.ttl > 0);
  effects = effects.filter(e => (e.t += dt) < e.life);
  tracers = tracers.filter(e => (e.t += dt) < e.life);
  floaters = floaters.filter(f => (f.ttl -= dt, f.y -= dt * 0.8, f.ttl > 0));
  messages = messages.filter(m => (m.ttl -= dt) > 0);
  shake *= 0.85; if (shake < 0.3) shake = 0;
  // camera: eased follow, clamped to map (Process_Tracking)
  const tx = clamp(player.x * CELL - VIEW_W / 2, 0, MW * CELL - VIEW_W), ty = clamp(player.y * CELL - VIEW_H / 2, 0, MH * CELL - VIEW_H);
  cam.x += (tx - cam.x) * 0.15; cam.y += (ty - cam.y) * 0.15;
}

// ── Rendering ─────────────────────────────────────────────────────────────
let canvas, ctx;
const WALL_H = 14;

function draw() {
  const g = ctx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#16171b'; g.fillRect(0, 0, VIEW_W, VIEW_H);
  if (!player) { drawTitle(); return; }
  const sx = Math.round(cam.x + rand(-shake, shake)), sy = Math.round(cam.y + rand(-shake, shake));
  g.save(); g.translate(-sx, -sy);
  g.drawImage(floorCanvas, 0, 0);

  // ground layer
  for (const m of mines) {
    g.fillStyle = m.arm > 0 ? '#665' : ((time * 4) % 1 < 0.5 ? '#e33' : '#822');
    g.beginPath(); g.arc(m.x * CELL, m.y * CELL, 5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#222'; g.lineWidth = 2; g.stroke();
  }
  for (const k of pickups) {
    if (k.hidden) continue;
    if (isFinite(k.ttl) && k.ttl < 3 && (time * 8 % 1) < 0.5) continue;
    const x = k.x * CELL, y = k.y * CELL, b = Math.sin(time * 5) * 2;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x - 9, y + 4, 18, 6);
    g.fillStyle = '#c9a25a'; g.fillRect(x - 9, y - 12 + b, 18, 16);
    g.fillStyle = '#e8c27a'; g.fillRect(x - 9, y - 14 + b, 18, 4);
    g.fillStyle = '#7a4'; g.fillRect(x - 2, y - 11 + b, 4, 12); g.fillRect(x - 6, y - 7 + b, 12, 4);
  }

  // y-sorted solids & actors
  const list = [];
  const x0 = Math.max(0, Math.floor(sx / CELL) - 1), x1 = Math.min(MW, Math.ceil((sx + VIEW_W) / CELL) + 1);
  const y0 = Math.max(0, Math.floor(sy / CELL) - 1), y1 = Math.min(MH, Math.ceil((sy + VIEW_H) / CELL) + 2);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (solid[idx(x, y)]) list.push({ y: y + 1, f: () => drawWall(g, x, y) });
    const o = objAt[idx(x, y)]; if (o) list.push({ y: y + 0.9, f: () => drawBarrel(g, o) });
  }
  for (const c of creatures) list.push({ y: c.y + 0.3, f: () => drawCreature(g, c) });
  list.push({ y: player.y + 0.3, f: () => drawPlayer(g) });
  list.sort((a, b) => a.y - b.y);
  for (const d of list) d.f();

  for (const s of shots) {
    const x = s.x * CELL, y = s.y * CELL;
    if (s.kind === 'grenade') {
      const h = s.t < s.air ? Math.sin(s.t / s.air * Math.PI) * 26 : 0;
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
      g.fillStyle = '#4a5'; g.beginPath(); g.arc(x, y - h, 4, 0, 7); g.fill();
    } else if (s.kind === 'rocket') {
      g.fillStyle = '#ddd'; g.beginPath(); g.arc(x, y - 10, 4, 0, 7); g.fill();
    } else {
      const r = 6 + Math.sin(time * 30) * 1.5;
      g.fillStyle = '#ff7a1a'; g.beginPath(); g.arc(x, y - 12, r, 0, 7); g.fill();
      g.fillStyle = '#ffe28a'; g.beginPath(); g.arc(x, y - 12, r * 0.5, 0, 7); g.fill();
    }
  }
  for (const t of tracers) {
    g.globalAlpha = 1 - t.t / t.life; g.strokeStyle = t.color || '#ffe08a'; g.lineWidth = t.w;
    g.beginPath(); g.moveTo(t.x1 * CELL, t.y1 * CELL - 12); g.lineTo(t.x2 * CELL, t.y2 * CELL - 12); g.stroke();
  }
  g.globalAlpha = 1;
  for (const e of effects) drawEffect(g, e);
  g.font = 'bold 13px system-ui, sans-serif'; g.textAlign = 'center';
  for (const f of floaters) { g.globalAlpha = Math.min(1, f.ttl * 2); g.fillStyle = f.color; g.fillText(f.text, f.x * CELL, f.y * CELL - 20); }
  g.globalAlpha = 1;
  g.restore();
  drawHud(g);
}

function drawWall(g, x, y) {
  const px = x * CELL, py = y * CELL;
  g.fillStyle = '#2b2d33'; g.fillRect(px, py + CELL - WALL_H, CELL, WALL_H);           // front face
  g.fillStyle = '#5b5f6a'; g.fillRect(px, py - WALL_H, CELL, CELL);                    // top
  g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(px, py - WALL_H, CELL, 2);
}
function drawBarrel(g, o) {
  const x = o.x * CELL, y = o.y * CELL;
  const blink = o.fuse >= 0 && (time * 30 % 1) < 0.5;
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(x, y + 6, 11, 5, 0, 0, 7); g.fill();
  g.fillStyle = blink ? '#fff' : '#a3322a'; g.fillRect(x - 10, y - 18, 20, 24);
  g.fillStyle = blink ? '#fff' : '#c8463a'; g.beginPath(); g.ellipse(x, y - 18, 10, 4, 0, 0, 7); g.fill();
  g.fillStyle = '#ffcc33'; g.fillRect(x - 10, y - 8, 20, 3);
}
function drawBody(g, x, y, face, color, r, walk, flash, opts = {}) {
  const px = x * CELL, py = y * CELL, s = r * CELL;
  const bob = Math.sin(walk) * 1.5;
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(px, py + 3, s * 0.9, s * 0.45, 0, 0, 7); g.fill();
  // legs
  g.fillStyle = '#222';
  const lx = Math.cos(face + Math.PI / 2) * s * 0.35, ly = Math.sin(face + Math.PI / 2) * s * 0.2;
  g.fillRect(px + lx - 3 + Math.cos(face) * bob, py - 6 + ly, 6, 8);
  g.fillRect(px - lx - 3 - Math.cos(face) * bob, py - 6 - ly, 6, 8);
  // torso (rounded capsule)
  g.fillStyle = flash ? '#fff' : color;
  roundRect(g, px - s * 0.75, py - s * 1.9 + bob, s * 1.5, s * 1.4, s * 0.45); g.fill();
  // arms / weapon pointing along facing
  const ax = Math.cos(face), ay = Math.sin(face);
  g.strokeStyle = flash ? '#fff' : (opts.arm || color); g.lineWidth = opts.armW || 4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(px, py - s * 1.25 + bob); g.lineTo(px + ax * s * (opts.reach || 1.1), py - s * 1.25 + ay * s * 0.6 + bob); g.stroke();
  // head
  g.fillStyle = flash ? '#fff' : (opts.head || color);
  g.beginPath(); g.arc(px + ax * 2, py - s * 2.2 + bob + ay, s * 0.55, 0, 7); g.fill();
  // eyes
  g.fillStyle = opts.eye || '#111';
  const ex = px + ax * s * 0.35 + 2, ey = py - s * 2.25 + bob + ay * 2;
  if (ay > -0.6) { g.fillRect(ex - 3 + ay * 2, ey - 1, 2, 2); g.fillRect(ex + 1 + ay * 2, ey - 1, 2, 2); }
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function drawCreature(g, c) {
  const brute = c.type === 'brute';
  const attacking = c.state === 'attack' || c.state === 'fire';
  drawBody(g, c.x, c.y, c.face, c.def.color, brute ? 0.5 : 0.38, c.walk, c.flash > 0, {
    head: brute ? '#7a2420' : '#9cc47a', eye: brute ? '#ffd23a' : '#300',
    reach: attacking ? 1.6 : 1.2, armW: brute ? 7 : 4, arm: brute ? '#8a2e2a' : '#86b062' });
  if (c.hp < c.maxHp) {
    const w = brute ? 34 : 22, px = c.x * CELL - w / 2, py = c.y * CELL - (brute ? 46 : 36);
    g.fillStyle = '#000'; g.fillRect(px, py, w, 3); g.fillStyle = brute ? '#f84' : '#7d4'; g.fillRect(px, py, w * c.hp / c.maxHp, 3);
  }
}
function drawPlayer(g) {
  const p = player;
  if (p.inv > 0 && (time * 12 % 1) < 0.4) return;
  drawBody(g, p.x, p.y, p.aim, '#3f8fc4', 0.36, p.walk, p.hurtFlash > 0.15, { head: '#f0c9a0', arm: '#555', armW: 5, reach: 1.3 });
}
function drawEffect(g, e) {
  const k = e.t / e.life, x = e.x * CELL, y = e.y * CELL;
  if (e.kind === 'boom') {
    const r = e.r * CELL * (0.4 + 0.6 * k);
    g.globalAlpha = 1 - k;
    g.fillStyle = e.fire ? '#ff7a1a' : '#ffb347'; g.beginPath(); g.arc(x, y - 8, r, 0, 7); g.fill();
    g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(x, y - 8, r * 0.5 * (1 - k), 0, 7); g.fill();
    g.globalAlpha = 1;
  } else if (e.kind === 'flash') {
    g.fillStyle = '#fff6b0'; g.beginPath(); g.arc(x + Math.cos(e.a) * 4, y - 12 + Math.sin(e.a) * 4, 6, 0, 7); g.fill();
  } else if (e.kind === 'spark') {
    g.fillStyle = `rgba(255,220,150,${1 - k})`; g.fillRect(x - 2, y - 14, 4, 4);
  } else if (e.kind === 'smoke') {
    g.fillStyle = `rgba(180,180,180,${0.4 * (1 - k)})`; g.beginPath(); g.arc(x, y - 10, 3 + k * 8, 0, 7); g.fill();
  } else if (e.kind === 'gib') {
    g.fillStyle = e.color; g.globalAlpha = 1 - k;
    for (let i = 0; i < (e.big ? 10 : 6); i++) {
      const a = i * 2.4, r = k * (e.big ? 34 : 22);
      g.fillRect(x + Math.cos(a) * r - 3, y - 12 + Math.sin(a) * r - 3 + k * k * 20, 6, 6);
    }
    g.globalAlpha = 1;
  }
}

function drawHud(g) {
  const p = player;
  // HP
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(12, 12, 224, 22);
  g.fillStyle = p.hp > 60 ? '#5bd16a' : '#e04a3a'; g.fillRect(14, 14, 220 * p.hp / p.maxHp, 18);
  g.fillStyle = '#fff'; g.font = 'bold 12px system-ui, sans-serif'; g.textAlign = 'left';
  g.fillText(`HP ${Math.ceil(p.hp)}`, 20, 28);
  // Score / level
  g.textAlign = 'right'; g.font = 'bold 20px system-ui, sans-serif';
  g.fillText(score.toLocaleString(), VIEW_W - 16, 32);
  g.font = '12px system-ui, sans-serif'; g.fillStyle = '#bbb';
  g.fillText(`LEVEL ${level.n}  \u00b7  left ${level.walkersLeft + level.brutesLeft}  \u00b7  kills ${kills}`, VIEW_W - 16, 50);
  // Combo meter
  g.textAlign = 'left';
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(12, 40, 224, 30);
  g.fillStyle = combo.m >= 10 ? '#ffd166' : '#fff'; g.font = 'bold 20px system-ui, sans-serif';
  g.fillText('x' + combo.m, 18, 63);
  const ratio = combo.m > 1 ? combo.t / comboWindow(combo.m) : 0;
  g.fillStyle = '#333'; g.fillRect(80, 52, 148, 8);
  g.fillStyle = '#ffd166'; g.fillRect(80, 52, 148 * clamp(ratio, 0, 1), 8);
  const next = [...combo.rewards.keys()].filter(k => k > combo.m).sort((a, b) => a - b)[0];
  if (next) { g.fillStyle = '#999'; g.font = '10px system-ui, sans-serif'; g.fillText('next reward x' + next, 80, 48); }
  // Weapons bar
  let x = 12; const y = VIEW_H - 46;
  for (const id of WEAPON_ORDER) {
    if (!ownsWeapon(id)) continue;
    const w = p.weapons[id], sel = id === p.cur;
    g.fillStyle = sel ? 'rgba(255,209,102,.9)' : 'rgba(0,0,0,.55)'; g.fillRect(x, y, 92, 34);
    g.fillStyle = sel ? '#111' : '#ddd'; g.font = 'bold 11px system-ui, sans-serif';
    g.fillText(`${WEAPONS[id].key} ${w.stats.name}`, x + 6, y + 14);
    g.font = '11px system-ui, sans-serif';
    g.fillText(isFinite(w.ammo) ? String(w.ammo) : '\u221e', x + 6, y + 28);
    x += 96;
  }
  // Messages
  g.textAlign = 'center';
  let my = 110;
  for (const m of messages) {
    g.globalAlpha = Math.min(1, m.ttl / 0.5);
    g.font = m.big ? 'bold 34px system-ui, sans-serif' : 'bold 16px system-ui, sans-serif';
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillText(m.text, VIEW_W / 2 + 2, my + 2);
    g.fillStyle = m.color; g.fillText(m.text, VIEW_W / 2, my);
    my += m.big ? 42 : 24;
  }
  g.globalAlpha = 1;
  if (touch.enabled) drawTouch(g);
  if (paused) overlay(g, 'PAUSED', 'P to resume');
  if (mode === 'over') overlay(g, 'YOU DIED', `score ${score.toLocaleString()}   \u00b7   level ${level.n}   \u00b7   best ${best.toLocaleString()}\n\nEnter / tap to retry`);
}

function overlay(g, title, sub) {
  g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = 'bold 48px system-ui, sans-serif';
  g.fillText(title, VIEW_W / 2, VIEW_H / 2 - 20);
  g.font = '16px system-ui, sans-serif'; g.fillStyle = '#ccc';
  sub.split('\n').forEach((l, i) => g.fillText(l, VIEW_W / 2, VIEW_H / 2 + 20 + i * 22));
}

function drawTitle() {
  const g = ctx;
  g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = 'bold 56px system-ui, sans-serif';
  g.fillText('CELL SIEGE', VIEW_W / 2, 200);
  g.font = '16px system-ui, sans-serif'; g.fillStyle = '#bbb';
  const lines = [
    'Survive endless waves. Kill fast to build your combo multiplier \u2014',
    'higher combos unlock new weapons and upgrades.',
    '',
    'Move: WASD / Arrows     Fire: Space / J     Weapons: 1-8, Q / E     Pause: P',
    'Touch: drag left side to move, right button to fire',
    '',
    'Press Enter or tap to start',
  ];
  lines.forEach((l, i) => g.fillText(l, VIEW_W / 2, 270 + i * 26));
}

// ── Input ─────────────────────────────────────────────────────────────────
const keys = { up: false, down: false, left: false, right: false, fire: false, firePressed: false, pressed: {} };
const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'fire', KeyJ: 'fire', KeyK: 'fire' };
const touch = { enabled: false, active: false, mx: 0, my: 0, fire: false, firePressed: false, id: null, ox: 0, oy: 0, fireId: null };

function bindInput() {
  addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    const k = KEYMAP[e.code];
    if (k) { if (k === 'fire' && !keys.fire) keys.firePressed = true; keys[k] = true; }
    if (!e.repeat) keys.pressed[e.code] = true;
    audioUnlock();
  });
  addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
  addEventListener('blur', () => { for (const k of ['up', 'down', 'left', 'right', 'fire']) keys[k] = false; });

  const pos = t => { const r = canvas.getBoundingClientRect(); return { x: (t.clientX - r.left) * VIEW_W / r.width, y: (t.clientY - r.top) * VIEW_H / r.height }; };
  canvas.addEventListener('touchstart', e => {
    e.preventDefault(); touch.enabled = true; audioUnlock();
    for (const t of e.changedTouches) {
      const p = pos(t);
      if (p.x < VIEW_W * 0.45) { touch.id = t.identifier; touch.ox = p.x; touch.oy = p.y; touch.active = true; touch.mx = touch.my = 0; }
      else if (p.y < 120 && p.x > VIEW_W - 140) keys.pressed.nextW = true;
      else { touch.fireId = t.identifier; touch.fire = true; touch.firePressed = true; }
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === touch.id) {
      const p = pos(t), dx = p.x - touch.ox, dy = p.y - touch.oy, l = Math.hypot(dx, dy);
      touch.mx = l > 8 ? dx / Math.max(l, 50) : 0; touch.my = l > 8 ? dy / Math.max(l, 50) : 0;
    }
  }, { passive: false });
  const end = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === touch.id) { touch.active = false; touch.id = null; touch.mx = touch.my = 0; }
      if (t.identifier === touch.fireId) { touch.fire = false; touch.fireId = null; }
    }
  };
  canvas.addEventListener('touchend', end); canvas.addEventListener('touchcancel', end);
}
function drawTouch(g) {
  g.globalAlpha = 0.25; g.fillStyle = '#fff';
  if (touch.active) { g.beginPath(); g.arc(touch.ox, touch.oy, 50, 0, 7); g.fill(); g.beginPath(); g.arc(touch.ox + touch.mx * 50, touch.oy + touch.my * 50, 22, 0, 7); g.fill(); }
  g.beginPath(); g.arc(VIEW_W - 90, VIEW_H - 110, 48, 0, 7); g.fill();
  g.fillRect(VIEW_W - 130, 70, 118, 40);
  g.globalAlpha = 0.8; g.fillStyle = '#000'; g.textAlign = 'center'; g.font = 'bold 14px system-ui, sans-serif';
  g.fillText('FIRE', VIEW_W - 90, VIEW_H - 105); g.fillText('NEXT WPN', VIEW_W - 71, 95);
  g.globalAlpha = 1;
}

// ── Tiny synth SFX (WebAudio, no assets) ──────────────────────────────────
let actx = null;
function audioUnlock() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } } }
const SFX = {
  shot: [880, 0.04, 'square', 0.04], shotgun: [160, 0.12, 'sawtooth', 0.09], rail: [1400, 0.18, 'sine', 0.07],
  rocket: [220, 0.2, 'sawtooth', 0.05], throw: [500, 0.06, 'triangle', 0.05], place: [300, 0.06, 'triangle', 0.06],
  boom: [60, 0.35, 'noise', 0.25], kill: [140, 0.06, 'noise', 0.06], hurt: [120, 0.12, 'square', 0.08],
  pickup: [990, 0.12, 'triangle', 0.08], unlock: [660, 0.3, 'triangle', 0.09], level: [440, 0.25, 'triangle', 0.08],
  switch: [700, 0.03, 'square', 0.03], empty: [200, 0.03, 'square', 0.03], fireball: [180, 0.2, 'sawtooth', 0.05],
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

// ── Loop ──────────────────────────────────────────────────────────────────
let acc = 0, last = 0;
function frame(ts) {
  const now = ts / 1000; acc += Math.min(0.1, now - (last || now)); last = now;
  while (acc >= DT) {
    update(DT); acc -= DT;
    keys.pressed = {}; keys.firePressed = false; touch.firePressed = false;
  }
  sfxBudget = 0;
  draw();
  requestAnimationFrame(frame);
}

function boot() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');
  try { best = +localStorage.getItem('cellsiege.best') || 0; } catch (e) { best = 0; }
  bindInput();
  requestAnimationFrame(frame);
}
if (typeof window !== 'undefined' && !window.__HEADLESS__) window.addEventListener('load', boot);
