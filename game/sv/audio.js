'use strict';
// Richer synthesized audio, layered on top of the basic SFX table in ui.js:
// gunshots with body + crack + room reverb, a living soundscape (wind, rain, crickets, birds,
// distant groans), a low drone at night and a heartbeat when things get tense.

const AUD = { rev: null, amb: null, nextBird: 0, nextCricket: 0, nextGroan: 0, beatT: 0, drone: null };
function audioGraph() {
  if (!actx || AUD.rev) return !!actx;
  // short room reverb from a generated impulse
  const len = Math.floor(actx.sampleRate * 1.6), ir = actx.createBuffer(2, len, actx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
  AUD.rev = actx.createConvolver(); AUD.rev.buffer = ir;
  AUD.revIn = actx.createGain(); AUD.revIn.gain.value = 0.32; AUD.revIn.connect(AUD.rev); AUD.rev.connect(master);
  // looping noise beds for wind and rain
  const nb = actx.createBuffer(1, actx.sampleRate * 3, actx.sampleRate), nd = nb.getChannelData(0);
  let b0 = 0; for (let i = 0; i < nd.length; i++) { b0 = 0.985 * b0 + 0.015 * (Math.random() * 2 - 1); nd[i] = b0 * 6 + (Math.random() * 2 - 1) * 0.06; }
  const bed = (type, freq, q) => { const s = actx.createBufferSource(); s.buffer = nb; s.loop = true; const f = actx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = actx.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(master); s.start(); return { g, f }; };
  AUD.wind = bed('lowpass', 420, 0.7);
  AUD.rain = bed('highpass', 1400, 0.3);
  // night drone: two detuned saws through a slow filter
  const dg = actx.createGain(); dg.gain.value = 0; const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.connect(dg); dg.connect(master);
  for (const f of [55, 55.6, 82.4]) { const o = actx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const og = actx.createGain(); og.gain.value = 0.05; o.connect(og); og.connect(lp); o.start(); }
  const lfo = actx.createOscillator(); lfo.frequency.value = 0.07; const lg = actx.createGain(); lg.gain.value = 120; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
  AUD.drone = dg;
  return true;
}
const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
function noiseSrc(dur) {
  const len = Math.max(1, Math.floor(actx.sampleRate * dur)), b = actx.createBuffer(1, len, actx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const s = actx.createBufferSource(); s.buffer = b; return s;
}
const GUN_SYN = {
  pistol: { thump: 140, crack: 2600, len: 0.16, vol: 0.5 }, smg: { thump: 160, crack: 3000, len: 0.1, vol: 0.38 }, rifle: { thump: 110, crack: 2200, len: 0.2, vol: 0.55 },
  shotgun: { thump: 70, crack: 1400, len: 0.32, vol: 0.75 }, sniper: { thump: 60, crack: 1800, len: 0.5, vol: 0.85 }, turret: { thump: 180, crack: 3200, len: 0.08, vol: 0.3 },
  launcher: { thump: 50, crack: 700, len: 0.4, vol: 0.6 }, bazooka: { thump: 38, crack: 500, len: 0.6, vol: 0.85 }, revolver: { thump: 100, crack: 2000, len: 0.25, vol: 0.65 },
  crossbow: { thump: 220, crack: 900, len: 0.08, vol: 0.2 }, flamer: { thump: 60, crack: 400, len: 0.09, vol: 0.18 },
};
// returns true when it handled the sound
function richSfx(name, vol) {
  if (!audioGraph()) return false;
  const t = actx.currentTime;
  const gs = GUN_SYN[name];
  if (gs) {
    const out = actx.createGain(); out.gain.value = gs.vol * vol; out.connect(master); out.connect(AUD.revIn);
    const o = actx.createOscillator(), og = actx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(gs.thump * 2, t); o.frequency.exponentialRampToValueAtTime(gs.thump * 0.5, t + gs.len * 0.6);
    env(og, t, 0.002, 0.9, gs.len * 0.6); o.connect(og); og.connect(out); o.start(t); o.stop(t + gs.len);
    const n = noiseSrc(gs.len), bp = actx.createBiquadFilter(), ng = actx.createGain(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(gs.crack, t); bp.frequency.exponentialRampToValueAtTime(gs.crack * 0.3, t + gs.len); bp.Q.value = 0.8;
    env(ng, t, 0.001, 1.0, gs.len); n.connect(bp); bp.connect(ng); ng.connect(out); n.start(t);
    return true;
  }
  if (name === 'groan' || name === 'bite' && Math.random() < 0.3) {
    const o = actx.createOscillator(), f = actx.createBiquadFilter(), g = actx.createGain(), base = 70 + Math.random() * 50, d = 0.6 + Math.random() * 0.8;
    o.type = 'sawtooth'; o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * (0.7 + Math.random() * 0.2), t + d);
    f.type = 'bandpass'; f.frequency.setValueAtTime(500 + Math.random() * 300, t); f.frequency.linearRampToValueAtTime(300, t + d); f.Q.value = 3;
    env(g, t, 0.12, 0.12 * vol, d); o.connect(f); f.connect(g); g.connect(master); g.connect(AUD.revIn); o.start(t); o.stop(t + d + 0.2);
    return name === 'groan';
  }
  if (name === 'thunder') {
    const n = noiseSrc(3), f = actx.createBiquadFilter(), g = actx.createGain(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(80, t + 2.5);
    env(g, t, 0.02, 0.7 * vol, 2.8); n.connect(f); f.connect(g); g.connect(master); g.connect(AUD.revIn); n.start(t);
    return true;
  }
  if (name === 'heart') {
    for (const [dt, p] of [[0, 1], [0.16, 0.7]]) { const o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(62, t + dt); o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.12); env(g, t + dt, 0.005, 0.35 * p * vol, 0.14); o.connect(g); g.connect(master); o.start(t + dt); o.stop(t + dt + 0.2); }
    return true;
  }
  if (name === 'bird' || name === 'cricket') {
    const bird = name === 'bird', n = bird ? 2 + (Math.random() * 4 | 0) : 3, f0 = bird ? 2400 + Math.random() * 1800 : 4200 + Math.random() * 600;
    for (let k = 0; k < n; k++) { const o = actx.createOscillator(), g = actx.createGain(), st = t + k * (bird ? 0.11 : 0.05); o.type = 'sine'; o.frequency.setValueAtTime(f0, st); if (bird) o.frequency.exponentialRampToValueAtTime(f0 * (0.7 + Math.random() * 0.6), st + 0.08); env(g, st, 0.004, (bird ? 0.04 : 0.018) * vol, bird ? 0.08 : 0.03); o.connect(g); g.connect(master); o.start(st); o.stop(st + 0.12); }
    return true;
  }
  return false;
}
// called every frame: fade the beds and schedule ambient one-shots
function updateAudio(dt) {
  if (!actx || !audioGraph()) return;
  const me = G && meP();
  if (!me) { const t0 = actx.currentTime; for (const g of [AUD.wind.g, AUD.rain.g, AUD.drone, AUD.eng && AUD.eng.gn, BGM.gain]) if (g) g.gain.setTargetAtTime(0, t0, 0.3); return; }
  const t = actx.currentTime, w = G.weather || { k: 'clear', i: 0 }, night = G.phase === 'night' || G.phase === 'dawn';
  const b = biomeAt(me.x, me.y), open = b !== BIO.CITY;
  const set = (g, v) => g.gain.setTargetAtTime(v, t, 0.6);
  set(AUD.wind.g, (open ? 0.05 : 0.025) + (w.k === 'storm' ? 0.12 : w.k === 'rain' ? 0.04 : 0) * w.i);
  AUD.wind.f.frequency.setTargetAtTime(300 + (w.k === 'storm' ? 500 : 0) * w.i + Math.sin(t * 0.3) * 120, t, 1);
  set(AUD.rain.g, (w.k === 'rain' || w.k === 'storm') ? 0.09 * w.i : 0);
  set(AUD.drone, night ? 0.5 : G.phase === 'dusk' ? 0.25 : 0);
  if (t > AUD.nextBird && !night && w.k === 'clear' && (b === BIO.FOREST || b === BIO.PLAINS || b === BIO.FARM)) { richSfx('bird', 1); AUD.nextBird = t + 2 + Math.random() * 7; }
  if (t > AUD.nextCricket && night && w.k === 'clear' && b !== BIO.CITY && b !== BIO.WASTE) { richSfx('cricket', 1); AUD.nextCricket = t + 0.4 + Math.random() * 1.6; }
  if (t > AUD.nextGroan) {
    let near = null, nd = 18;
    for (const e of G.ents) if (e.cat === 'mob') { const d = dist(e.x, e.y, me.x, me.y); if (d < nd) { nd = d; near = e; } }
    if (near) richSfx('groan', 1 - nd / 18);
    AUD.nextGroan = t + 1.5 + Math.random() * 4;
  }
  updateBgm(me);
  // engine hum while driving
  if (me.veh) {
    if (!AUD.eng) { const o = actx.createOscillator(), o2 = actx.createOscillator(), f = actx.createBiquadFilter(), gn = actx.createGain(); o.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 400; gn.gain.value = 0; o.connect(f); o2.connect(f); f.connect(gn); gn.connect(master); o.start(); o2.start(); AUD.eng = { o, o2, gn, f }; }
    const sp = Math.abs(me.veh.spd);
    AUD.eng.o.frequency.setTargetAtTime(38 + sp * 7, t, 0.1); AUD.eng.o2.frequency.setTargetAtTime(19 + sp * 3.5, t, 0.1); AUD.eng.f.frequency.setTargetAtTime(250 + sp * 60, t, 0.1);
    AUD.eng.gn.gain.setTargetAtTime(me.veh.fuel > 0 ? 0.05 + sp * 0.004 : 0, t, 0.15);
  } else if (AUD.eng) AUD.eng.gn.gain.setTargetAtTime(0, t, 0.2);
  const tense = (me.hp < 30 && !me.down) || (me.useP > 0 && me.useLabel && /뒤지기|훔치기/.test(me.useLabel));
  if (tense && t > AUD.beatT) { richSfx('heart', me.hp < 30 ? 1 : 0.6); AUD.beatT = t + (me.hp < 30 ? 0.75 : 1.0); }
}

// ── combat music: a looping minor-key ostinato with drums that swells while you fight ──
const BGM = { gain: null, level: 0, next: 0, step: 0, bpm: 132 };
const BASS = [55, 55, 65.41, 55, 49, 49, 58.27, 61.74]; // A1 A1 C2 A1 G1 G1 A#1 B1
function bgmNote(t, f, d, type, vol, filt) {
  const o = actx.createOscillator(), gn = actx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
  gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
  if (filt) { const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = filt; o.connect(lp); lp.connect(gn); } else o.connect(gn);
  gn.connect(BGM.gain); o.start(t); o.stop(t + d + 0.05);
}
function bgmHit(t, kind) {
  if (kind === 'kick') { const o = actx.createOscillator(), gn = actx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12); gn.gain.setValueAtTime(0.9, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.18); o.connect(gn); gn.connect(BGM.gain); o.start(t); o.stop(t + 0.2); return; }
  const n = noiseSrc(kind === 'snare' ? 0.18 : 0.05), f = actx.createBiquadFilter(), gn = actx.createGain();
  f.type = kind === 'snare' ? 'bandpass' : 'highpass'; f.frequency.value = kind === 'snare' ? 1800 : 7000;
  gn.gain.setValueAtTime(kind === 'snare' ? 0.5 : 0.18, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'snare' ? 0.16 : 0.04));
  n.connect(f); f.connect(gn); gn.connect(BGM.gain); n.start(t);
}
function updateBgm(me) {
  if (!BGM.gain) { BGM.gain = actx.createGain(); BGM.gain.gain.value = 0; BGM.gain.connect(master); }
  const t = actx.currentTime;
  // how hot is it? enemies hunting you nearby, a boss, or a night wave in progress
  let heat = 0;
  for (const e of G.ents) { if ((e.cat === 'mob' || e.team === 'bandit' || e.team === 'cult') && (e.target === me || e.wave || (e.alert > 0))) { const d = dist(e.x, e.y, me.x, me.y); if (d < 16) heat += e.def.boss ? 4 : 0.35; } }
  if (G.phase === 'night' && G.waveIdx > 0) heat += 0.4;
  const want = Math.min(1, heat / 2.2);
  BGM.level += (want - BGM.level) * (want > BGM.level ? 0.04 : 0.006);
  BGM.gain.gain.setTargetAtTime(BGM.level * 0.32, t, 0.3);
  if (BGM.level < 0.03) { BGM.next = 0; return; }
  const beat = 60 / BGM.bpm / 2; // eighth notes
  if (!BGM.next || BGM.next < t) BGM.next = t + 0.05;
  while (BGM.next < t + 0.25) {
    const s = BGM.step++ % 32, tt = BGM.next, bar = Math.floor(s / 8) % 4;
    bgmNote(tt, BASS[s % 8] * (bar === 3 && s % 8 > 5 ? 1.5 : 1), beat * 0.9, 'sawtooth', 0.32, 420 + BGM.level * 900);
    if (s % 4 === 0) bgmHit(tt, 'kick');
    if (s % 8 === 4) bgmHit(tt, 'snare');
    if (BGM.level > 0.4) bgmHit(tt, 'hat');
    if (BGM.level > 0.6 && s % 8 === 0) for (const f of [220, 261.6, 329.6]) bgmNote(tt, f * (bar === 2 ? 0.89 : 1), beat * 7.5, 'triangle', 0.05, 1600); // tension stab
    BGM.next += beat;
  }
}
