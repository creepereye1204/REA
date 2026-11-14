'use strict';
// P2P co-op over WebRTC (PeerJS). The host runs the simulation; the guest sends its input
// and its own position (client-authoritative movement), and renders host snapshots.

const NET = { role: 'solo', peer: null, conn: null, code: '', lastSnap: 0, ping: 0, connected: false };
const PEER_PREFIX = 'cellsiege-nf-';
const STRUCT_TYPES = ['core', 'bench', 'radio', 'gate', ...STRUCT_ORDER];
const SHOT_KINDS = ['grenade', 'rocket', 'spit', 'fireball', 'molotov'];
const TAGS = ['', 'elder0', 'elder1', 'elder2', 'elder3', 'yoon', 'dr_han', 'priest', 'mechanic', 'child', 'broodmother', 'x13', 'goliath', 'camp0', 'camp1', 'camp2', 'camp3'];
const tagTitle = t => t.startsWith('camp') ? CAMP_BOSSES[+t[4]] : t === 'mechanic' ? '정비공 백도윤' : t === 'child' ? '박민호' : null;
const MODES = ['idle', 'wait', 'follow', 'guard', 'raid'];
const PERK_LIST = Object.keys(PERKS);

function loadPeerJS() {
  if (window.Peer) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
    s.onload = () => res(); s.onerror = () => rej(new Error('PeerJS 로드 실패 (인터넷 연결 확인)'));
    document.head.appendChild(s);
  });
}
// On the self-hosted copy (boxhunter.p-e.kr) signaling goes through our own PeerJS server;
// elsewhere (GitHub Pages) it falls back to the public PeerJS cloud. Room codes only work
// between players on the same site.
function peerOpts() {
  const h = (typeof location !== 'undefined' && location.hostname) || '';
  if (/(^|\.)boxhunter\.p-e\.kr$/.test(h)) return { debug: 0, host: 'api.boxhunter.p-e.kr', port: 443, secure: true, path: '/' };
  return { debug: 0 };
}
function makeCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let k = 0; k < 5; k++) s += A[(Math.random() * A.length) | 0]; return s; }
function netSend(o) { if (NET.conn && NET.conn.open) { try { NET.conn.send(o); } catch (e) { /* closed */ } } }
function sendCmd(c) { if (NET.role === 'client') netSend({ k: 'cmd', c }); else if (G) doCmd(V.me, c); }

// ── host ──────────────────────────────────────────────────────────────────
async function hostOpen() {
  await loadPeerJS();
  NET.code = makeCode();
  return new Promise((res, rej) => {
    const peer = new Peer(PEER_PREFIX + NET.code, peerOpts());
    NET.peer = peer;
    peer.on('open', () => { V.net = `방 코드: ${NET.code} — 친구를 기다리는 중`; res(); });
    peer.on('error', e => { if (e.type === 'unavailable-id') { NET.code = makeCode(); } V.net = '네트워크 오류: ' + e.type; rej(e); });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
    peer.on('connection', conn => {
      if (NET.conn && NET.conn.open) { conn.on('open', () => { conn.send({ k: 'full' }); setTimeout(() => conn.close(), 500); }); return; }
      NET.conn = conn;
      conn.on('open', () => {
        if (conn._ok) return; conn._ok = true;
        NET.connected = true;
        const p = G.players[1] || addPlayer(1);
        p.joined = true; if (p.dead) { p.dead = false; p.hp = 50; }
        p.x = G.players[0].x + 1; p.y = G.players[0].y;
        conn.send({ k: 'init', seed: G.seed, pid: 1, tiles: G.tileDiff, looted: W.conts.filter(c => c.looted).map(c => c.id) });
        say('친구(P2)가 참가했습니다!', '#7dff9a', -1, 1);
        V.net = `방 코드: ${NET.code} — P2 연결됨`;
      });
      conn.on('data', d => hostRecv(d));
      conn.on('close', () => {
        NET.connected = false; NET.conn = null;
        if (G && G.players[1]) G.players[1].joined = false;
        say('P2 연결이 끊겼습니다. 같은 코드로 다시 참가할 수 있습니다.', '#ffb36b', -1, 1);
        V.net = `방 코드: ${NET.code} — 친구를 기다리는 중`;
      });
    });
  });
}
function hostRecv(d) {
  if (!G) return;
  const p = G.players[1]; if (!p) return;
  if (d.k === 'in') {
    if (Number.isFinite(d.x) && Number.isFinite(d.y) && !p.down && !p.dead) { p.x = clamp(d.x, 0, MW - 0.01); p.y = clamp(d.y, 0, MH - 0.01); }
    Object.assign(p.in, d.in);
  } else if (d.k === 'cmd') doCmd(1, d.c);
  else if (d.k === 'ping') netSend({ k: 'pong', t: d.t });
}
const r2 = v => Math.round(v * 100);
function encodeSnap(forPid) {
  const P = G.players[forPid];
  const near = e => !P || dist(e.x, e.y, P.x, P.y) < 40 || e.kind === 'survivor' || (e.def && e.def.shop);
  const E = [];
  for (const e of G.ents) {
    if (!near(e)) continue;
    const flags = (e.flash > 0 ? 1 : 0) | (e.atkAnim > 0.3 ? 2 : 0) | (e.alert > 0 ? 4 : 0) | (e.sees ? 8 : 0) | (e.wave ? 16 : 0) | (e.revealT > 0 || e.dashT > 0 ? 32 : 0);
    E.push(e.id, KIND_LIST.indexOf(e.kind), r2(e.x), r2(e.y), r2(e.angle), Math.round(e.hp / e.maxHp * 1000), flags,
           e.wpn ? WEAPON_ORDER.indexOf(e.wpn) : -1, e.cat === 'human' ? e.village : 0,
           e.kind === 'survivor' ? e.name * 64 + PERK_LIST.indexOf(e.perk) * 8 + MODES.indexOf(e.mode) : e.mode ? MODES.indexOf(e.mode) : 0,
           e.tag ? TAGS.indexOf(e.tag) : 0, e.team === 'player' && e.kind !== 'survivor' ? 1 : e.team === 'military' && e.kind === 'lost' ? 2 : e.team === 'village' && e.kind === 'lost' ? 3 : 0);
  }
  const S = [];
  for (const s of G.structs) S.push(s.id, STRUCT_TYPES.indexOf(s.type), s.cells[0], Math.round(s.hp), r2(s.angle), s.ammo | 0, s.fuse >= 0 ? 1 : 0);
  const shops = {};
  for (const e of G.ents) if (e.def.shop) shops[e.id] = e.stock;
  const sendQ = NET.qv !== G.Q.v || G.tick % 150 === 0; NET.qv = G.Q.v;
  return {
    k: 's', t: G.tick, c: G.clock, d: G.day, ph: G.phase, n: G.nightN, wi: G.waveIdx || 0, o: G.over, mh: G.merchantHostile, vh: G.vh, w: G.warn, kl: G.kills,
    mil: G.milHostile, q: sendQ ? G.Q : undefined, H: G.hazards.map(h => [h.k === 'fire' ? 1 : 0, r2(h.x), r2(h.y), r2(h.r), r2(h.t)]),
    st: G.stash, sh: shops,
    P: G.players.map(p => p && { j: p.joined, x: r2(p.x) / 100, y: r2(p.y) / 100, a: r2(p.angle) / 100, hp: p.hp, hu: p.hunger, sta: p.stamina, w: p.wpn, m: p.mag,
                                 rl: p.reloadT, dn: p.down, dd: p.dead, dt: p.downT, up: p.useP, ul: p.useLabel, f: p.flash, ft: p.fireT, cr: p.in.crouch, mv: p.in.moving,
                                 ar: p.armor | 0, ad: p.adrT > 0 ? 1 : 0, vh: p.veh ? [p.veh.color, r2(p.veh.ang), r2(p.veh.spd), p.veh.fuel | 0, p.veh.hp | 0] : 0 }),
    E, S,
    D: G.drops.map(b => [b.id, r2(b.x), r2(b.y), b.from, dropTop(b)]),
    X: G.shots.map(s => [SHOT_KINDS.indexOf(s.k), r2(s.x), r2(s.y), r2(s.z || 0)]),
    fx: G.fxOut,
  };
}

// ── guest ─────────────────────────────────────────────────────────────────
async function joinRoom(code) {
  await loadPeerJS();
  NET.code = code.toUpperCase().trim();
  return new Promise((res, rej) => {
    const peer = new Peer(peerOpts());
    NET.peer = peer;
    const to = setTimeout(() => rej(new Error('연결 시간 초과 — 코드를 확인하세요')), 15000);
    peer.on('open', () => {
      const conn = peer.connect(PEER_PREFIX + NET.code, { reliable: true });
      NET.conn = conn;
      conn.on('open', () => { NET.connected = true; V.net = `호스트 연결됨 (${NET.code})`; });
      conn.on('data', d => {
        if (d.k === 'init') { clearTimeout(to); clientInit(d); res(); }
        else if (d.k === 'full') { clearTimeout(to); rej(new Error('방이 가득 찼습니다')); }
        else if (d.k === 's') clientSnap(d);
        else if (d.k === 'pong') NET.ping = performance.now() - d.t;
      });
      conn.on('close', () => { NET.connected = false; if (G) { say('호스트와 연결이 끊겼습니다.', '#ff6b5c', -1, 1); setTimeout(quitToTitle, 2500); } });
      conn.on('error', e => rej(e));
    });
    peer.on('error', e => { clearTimeout(to); rej(new Error(e.type === 'peer-unavailable' ? '해당 코드의 방이 없습니다' : '네트워크 오류: ' + e.type)); });
  });
}
function clientInit(d) {
  genWorld(d.seed);
  for (const i in d.tiles) { W.tile[+i] = d.tiles[i]; }
  for (const id of d.looted) if (W.conts[id]) W.conts[id].looted = true;
  rebuildMoveGrid();
  G = { seed: d.seed, t: 0, tick: 0, clock: 420, day: 1, phase: 'day', players: [], ents: [], structs: [], drops: [], shots: [], booms: [],
        stash: { cash: 0, wood: 0, scrap: 0, food: 0, meds: 0, grenade: 0, mine: 0, mags: {}, owned: { machete: 1, pistol: 1 }, upg: {} },
        vh: W.villages.map(() => 0), merchantHostile: false, kills: 0, over: null, nextId: 1, fxOut: [], core: null, bench: null, tileDiff: {},
        hazards: [], milHostile: false, Q: newQuestState() };
  V.me = d.pid;
  G.players[0] = makePlayer(0);
  G.players[1] = makePlayer(1);
  NET.entMap = new Map(); NET.structMap = new Map();
}
function clientSnap(s) {
  if (!G) return;
  NET.lastSnap = performance.now();
  G.tick = s.t; G.clock = s.c; G.day = s.d; G.phase = s.ph; G.nightN = s.n; G.waveIdx = s.wi; G.merchantHostile = s.mh; G.vh = s.vh; G.warn = s.w; G.kills = s.kl;
  G.milHostile = s.mil; if (s.q) G.Q = s.q;
  G.hazards = s.H.map(([f, x, y, r, t]) => ({ k: f ? 'fire' : 'gas', x: x / 100, y: y / 100, r: r / 100, t: t / 100 }));
  if (s.o && !G.over) { G.over = s.o; }
  G.stash = s.st;
  // players
  s.P.forEach((q, pid) => {
    if (!q) return;
    const p = G.players[pid] || (G.players[pid] = makePlayer(pid));
    p.joined = q.j; p.hp = q.hp; p.hunger = q.hu; p.stamina = q.sta; p.wpn = q.w; p.mag = q.m; p.reloadT = q.rl; p.down = q.dn; p.dead = q.dd; p.downT = q.dt;
    p.useP = q.up; p.useLabel = q.ul; p.flash = q.f; p.fireT = q.ft; p.armor = q.ar; p.adrT = q.ad ? 1 : 0;
    if (q.vh) {
      if (!p.veh) { p.veh = { id: -1, color: q.vh[0], ang: q.vh[1] / 100, spd: 0, fuel: q.vh[3], hp: q.vh[4] }; p.r = 0.48; }
      p.veh.fuel = pid === V.me ? Math.min(p.veh.fuel, q.vh[3] + 1) : q.vh[3]; p.veh.hp = q.vh[4]; p.veh.color = q.vh[0];
      if (pid !== V.me) { p.veh.ang = q.vh[1] / 100; p.veh.spd = q.vh[2] / 100; }
    } else if (p.veh) { p.veh = null; p.r = 0.3; }
    if (pid !== V.me) {
      if (Math.abs(p.x - q.x) > 0.01 || Math.abs(p.y - q.y) > 0.01) p.walk += 0.6;
      p.tx = q.x; p.ty = q.y; p.angle = q.a; p.in.crouch = q.cr; p.in.moving = q.mv;
      if (p.x === undefined || dist(p.x, p.y, q.x, q.y) > 6) { p.x = q.x; p.y = q.y; }
    }
  });
  // entities
  const seen = new Set(), E = s.E;
  const list = [];
  for (let k = 0; k < E.length; k += 12) {
    const id = E[k], kind = KIND_LIST[E[k + 1]];
    let e = NET.entMap.get(id);
    const x = E[k + 2] / 100, y = E[k + 3] / 100;
    if (!e || e.kind !== kind) {
      const def = MOBS[kind] || HUMANS[kind];
      e = { id, kind, def, cat: MOBS[kind] ? 'mob' : 'human', team: def.team || 'zombie', r: def.r || 0.32, x, y, rx: x, ry: y, walk: 0, maxHp: 1, stock: null };
      NET.entMap.set(id, e);
    }
    if (Math.abs(e.x - x) + Math.abs(e.y - y) > 0.005) e.walk += 0.5;
    e.x = x; e.y = y; e.angle = E[k + 4] / 100; e.hp = E[k + 5] / 1000; e.maxHp = 1;
    const f = E[k + 6]; e.flash = f & 1 ? 2 : 0; e.atkAnim = f & 2 ? 1 : 0; e.alert = f & 4 ? 1 : 0; e.sees = !!(f & 8); e.wave = !!(f & 16); e.revealT = f & 32 ? 1 : 0;
    e.wpn = E[k + 7] >= 0 ? WEAPON_ORDER[E[k + 7]] : null; e.village = E[k + 8];
    if (e.kind === 'survivor') { const v = E[k + 9]; e.name = v >> 6; e.perk = PERK_LIST[(v >> 3) & 7]; e.mode = MODES[v & 7]; }
    else e.mode = MODES[E[k + 9]];
    e.tag = TAGS[E[k + 10]] || null; e.title = e.tag ? tagTitle(e.tag) : null;
    const tm = E[k + 11]; if (tm === 1) e.team = 'player'; else if (tm === 2) e.team = 'military'; else if (tm === 3) e.team = 'village';
    if (s.sh[id]) e.stock = s.sh[id];
    seen.add(id); list.push(e);
  }
  for (const id of NET.entMap.keys()) if (!seen.has(id)) NET.entMap.delete(id);
  G.ents = list;
  // structures → also the collision grid
  const S = s.S, keepS = new Set(), slist = [];
  for (let k = 0; k < S.length; k += 7) {
    const id = S[k], type = STRUCT_TYPES[S[k + 1]], c0 = S[k + 2];
    let st = NET.structMap.get(id);
    if (!st) {
      const def = type === 'core' ? CORE_DEF : type === 'bench' ? BENCH_DEF : type === 'radio' ? RADIO_DEF : type === 'gate' ? GATE_DEF : STRUCTS[type];
      const cells = type === 'core' ? [c0, c0 + 1, c0 + MW, c0 + MW + 1] : [c0];
      let sx = 0, sy = 0; for (const c of cells) { sx += cellX(c) + 0.5; sy += cellY(c) + 0.5; }
      st = { id, type, def, cells, x: sx / cells.length, y: sy / cells.length, maxHp: def.hp, flash: 0 };
      NET.structMap.set(id, st);
      for (const c of cells) { W.structAt[c] = st; updateCellMB(c); }
    }
    if (S[k + 3] < st.hp) st.flash = 3;
    st.hp = S[k + 3]; st.angle = S[k + 4] / 100; st.ammo = S[k + 5]; st.fuse = S[k + 6] ? 0 : -1;
    keepS.add(id); slist.push(st);
    if (type === 'core') G.core = st; else if (type === 'bench') G.bench = st; else if (type === 'radio') G.radio = st;
  }
  for (const [id, st] of NET.structMap) if (!keepS.has(id)) { NET.structMap.delete(id); for (const c of st.cells) if (W.structAt[c] === st) { W.structAt[c] = null; updateCellMB(c); } }
  G.structs = slist;
  G.drops = s.D.map(([id, x, y, from, top]) => ({ id, x: x / 100, y: y / 100, from, top }));
  G.shots = s.X.map(([k, x, y, z]) => ({ k: SHOT_KINDS[k], x: x / 100, y: y / 100, z: z / 100 }));
  for (const o of s.fx) {
    if (o.k === 'tp' && o.pid === V.me) { const p = G.players[V.me]; p.x = o.x; p.y = o.y; }
    applyFx(o);
  }
}
// smooth remote things between snapshots
function clientSmooth() {
  for (const e of G.ents) { e.rx = lerp(e.rx, e.x, 0.3); e.ry = lerp(e.ry, e.y, 0.3); }
  for (const p of G.players) if (p && p.tx !== undefined && G.players.indexOf(p) !== V.me) { p.x = lerp(p.x, p.tx, 0.3); p.y = lerp(p.y, p.ty, 0.3); }
}
function netClose() {
  try { if (NET.conn) NET.conn.close(); } catch (e) { /* ignore */ }
  try { if (NET.peer) NET.peer.destroy(); } catch (e) { /* ignore */ }
  Object.assign(NET, { role: 'solo', peer: null, conn: null, connected: false, code: '' });
  V.net = '';
}
