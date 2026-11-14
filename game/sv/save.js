'use strict';
// Save / load. The world itself is rebuilt from the seed; only what changed is stored
// (tiles, looted containers, structures, every living thing, stash, quests, explored map).

const SAVE_KEY = 'nightfall.save.v2';
const SKIP_G = new Set(['players', 'ents', 'frozen', 'structs', 'core', 'bench', 'radio', 'fxOut', 'booms', 'shots']);
const SKIP_E = new Set(['def', 'target', 'path', 'pathGoal', 'blockStruct', 'owner', 'frozen', 'far', 'sees']);
const STRUCT_DEFS = () => ({ core: CORE_DEF, bench: BENCH_DEF, radio: RADIO_DEF, gate: GATE_DEF });

function saveInfo() { try { const s = localStorage.getItem(SAVE_KEY); if (!s) return null; const d = JSON.parse(s); return { day: d.G.day, t: d.t, kills: d.G.kills }; } catch (e) { return null; } }
function saveGame(quiet) {
  if (!G || G.over || NET.role === 'client') return false;
  try {
    const g = {}; for (const k in G) if (!SKIP_G.has(k)) g[k] = G[k];
    const ent = e => { const o = {}; for (const k in e) if (!SKIP_E.has(k)) o[k] = e[k]; if (o.goto) delete o.goto; return o; };
    const data = {
      v: 2, t: Date.now(), seed: G.seed, G: g,
      ents: everyone().filter(e => !e.dead && !(e.cat === 'mob' && !e.home && !e.tag)).map(ent),
      structs: G.structs.map(s => ({ id: s.id, type: s.type, cells: s.cells, hp: s.hp, ammo: s.ammo, angle: s.angle })),
      looted: W.conts.filter(c => c.looted).map(c => c.id),
      cars: W.conts.filter(c => c.kind === 'car' && (c.gone || c.fuel !== undefined)).map(c => ({ id: c.id, cells: c.cells, x: c.x, y: c.y, horiz: c.horiz, fuel: c.fuel, hp: c.hp, gone: !!c.gone })),
      players: G.players.map(p => p && { x: p.x, y: p.y, hp: p.hp, hunger: p.hunger, stamina: p.stamina, wpn: p.wpn, mag: p.mag, armor: p.armor || 0, angle: p.angle, veh: p.veh || null, r: p.r }),
      fog: V.seen && V.fogSeed === W.seed ? Array.from(V.seen).join('') : null,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    if (!quiet) say('게임을 저장했습니다', '#9fe6a0', V.me);
    return true;
  } catch (e) { if (!quiet) say('저장 실패: ' + e.message, '#ff9a8a', V.me); return false; }
}
function loadGame() {
  let d; try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return false; }
  if (!d || d.v !== 2) return false;
  genWorld(d.seed);
  G = Object.assign({ players: [], ents: [], frozen: [], structs: [], fxOut: [], booms: [], shots: [], drops: [], hazards: [] }, d.G);
  for (const k in G.tileDiff) { const i = +k; W.tile[i] = G.tileDiff[k]; }
  for (const id of d.looted) if (W.conts[id]) W.conts[id].looted = true;
  for (const q of d.cars || []) {
    const c = W.conts[q.id]; if (!c) continue;
    for (const k of c.cells) if (W.contAt[k] === c) W.contAt[k] = null;
    Object.assign(c, q);
    if (!c.gone) for (const k of c.cells) W.contAt[k] = c;
  }
  rebuildMoveGrid();
  const defs = STRUCT_DEFS();
  for (const s0 of d.structs) {
    const s = addStruct(s0.type, s0.cells, defs[s0.type] || STRUCTS[s0.type]);
    s.id = s0.id; s.hp = s0.hp; s.ammo = s0.ammo; s.angle = s0.angle;
    if (s.type === 'core') G.core = s; else if (s.type === 'bench') G.bench = s; else if (s.type === 'radio') G.radio = s;
  }
  for (const o of d.ents) {
    o.def = MOBS[o.kind] || HUMANS[o.kind]; if (!o.def) continue;
    o.target = null; o.path = null; o.frozen = true;
    G.frozen.push(o);
  }
  d.players.forEach((q, pid) => { if (!q) return; const p = makePlayer(pid); Object.assign(p, q); G.players[pid] = p; });
  if (pid0Missing()) G.players[0] = makePlayer(0);
  activation();
  G.ents = G.ents.filter(e => !e.frozen);
  if (d.fog) { fogCanvas(); const fc = V.fogCv.getContext('2d'); for (let k = 0; k < d.fog.length; k++) if (d.fog[k] === '1') { V.seen[k] = 1; fc.clearRect(k % FW, (k / FW) | 0, 1, 1); } }
  return true;
}
const pid0Missing = () => !G.players[0];
