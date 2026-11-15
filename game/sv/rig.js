'use strict';
// Top-down character rig. Every person and zombie is built from the same parts seen from
// above — feet, legs, torso (shoulders), arms, hands, head — so they all share one style and
// actually animate: feet step, arms swing, the body sways, guns sit in both hands.
// Local frame: +x = facing, +y = the character's right. Sizes scale with `s` (≈ body radius px).

const RIG_LIGHT = -2.4; // light comes from the top-left of the screen
const OL = 'rgba(14,11,9,.9)';
function rigShade(hex, k) { return shade(hex.length === 4 ? '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3] : hex, k); }
// filled ellipse with an outline and a soft highlight toward the light
function blob(g, x, y, rx, ry, col, rot = 0, hl = 0.18) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.fillStyle = OL; g.beginPath(); g.ellipse(0, 0, rx + 1.2, ry + 1.2, 0, 0, TAU); g.fill();
  const gr = g.createRadialGradient(-rx * 0.35, -ry * 0.35, 0, 0, 0, Math.max(rx, ry) * 1.1);
  gr.addColorStop(0, rigShade(col, 1 + hl)); gr.addColorStop(1, rigShade(col, 0.78));
  g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.fill();
  g.restore();
}
function limb(g, x0, y0, x1, y1, w, col) {
  g.lineCap = 'round';
  g.strokeStyle = OL; g.lineWidth = w + 2.4; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
}
// deterministic per-entity look
const SKIN = ['#e8c4a0', '#d8a880', '#c08a64', '#f0d0b0'], ZSKIN = ['#8fb070', '#9aa878', '#a0a890', '#7a9a6a', '#b0b098'];
const HAIR = ['#2a2018', '#4a3020', '#1a1a1a', '#6a4a2a', '#8a8070'], PANTS = ['#2a2e3a', '#3a3a30', '#24304a', '#4a3a2a'];
const ZSHIRT = ['#5f8a4b', '#4a5a7a', '#7a4a3a', '#6a6a5a', '#3a4a3a', '#8a7a5a', '#5a3a4a', '#4a6a6a', '#9a9a90', '#7a2a2a'];
const pickH = (arr, id, salt) => arr[Math.floor(hash(id * 7 + salt, salt * 3 + 1) * arr.length) % arr.length];

// o: { s, ang, walk, moving, flash, alpha, body, pants, skin, hair, hat, pose, wpn, zombie, kind, id, aim, swing, hurt, backpack, scale }
function drawRig(g, wx, wy, o) {
  const s = o.s, a = o.ang, ph = o.walk || 0, mv = o.moving ? 1 : 0, kind = o.kind || '', Z = o.zombie, crawl = kind === 'crawler';
  const t = (typeof V !== 'undefined' ? V.frame : 0) / 60 + (o.id || 0) * 0.37;
  // gait: zombies limp (one leg drags), runners lean in, everyone breathes when still
  const limp = Z && kind !== 'runner' && kind !== 'hound' ? 0.45 : 1;
  const step = Math.sin(ph) * s * (kind === 'runner' ? 0.75 : 0.55) * mv;
  const sway = (Math.sin(ph) * 0.08 + (Z ? Math.sin(t * 1.3) * 0.06 : 0)) * (mv || (Z ? 0.6 : 0));
  const breathe = 1 + Math.sin(t * 2.2) * 0.025 * (1 - mv);
  const bob = 1 + Math.abs(Math.sin(ph)) * 0.05 * mv;
  const lean = (kind === 'runner' ? s * 0.25 * mv : 0) + (o.atk || 0) * s * 0.45 - (o.flash ? s * 0.25 : 0);
  g.save();
  g.translate(wx, wy - s * 0.15);
  if (o.alpha !== undefined) g.globalAlpha = o.alpha;
  // shadow
  g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(s * 0.25, s * 0.35, s * 1.15 * bob, s * 0.8 * bob, 0, 0, TAU); g.fill();
  g.rotate(a + sway);
  // hit flash / hurt tint are applied to the colours themselves (compositing would also paint the ground)
  const T_ = c => c && (o.flash ? '#f4f0ea' : o.hurt > 0.05 ? mixHex(c, '#a00000', Math.min(0.6, o.hurt * 0.45)) : c);
  const skin = T_(o.skin), body = T_(o.body), pants = T_(o.pants), hair = T_(o.hair || '#2a2018'), hat = T_(o.hat);
  // ── feet / legs (alternate as you walk) ──
  if (!crawl) {
    const fl = kind === 'goliath' || kind === 'brute' ? 1.25 : 1;
    for (const sd of [-1, 1]) {
      const drag = Z && sd > 0 ? limp : 1;                 // the right leg drags behind on a limping zombie
      const fx = step * sd * drag - (Z && sd > 0 ? s * 0.25 * mv : 0), fy = sd * s * 0.42 * fl;
      const lift = Math.max(0, Math.sin(ph + (sd > 0 ? Math.PI : 0))) * mv;  // the foot in the air gets a little bigger
      limb(g, 0, fy * 0.8, fx, fy, s * 0.42 * fl, pants);
      blob(g, fx + s * 0.18, fy, s * 0.3 * fl * (1 + lift * 0.15), s * 0.22 * fl * (1 + lift * 0.15), Z ? rigShade(pants, 0.7) : '#2a2622', 0, 0.1);
    }
  } else { // dragging legless torso: a smear behind
    g.fillStyle = 'rgba(110,10,10,.55)'; g.beginPath(); g.ellipse(-s * 1.3, 0, s * 0.9, s * 0.3, 0, 0, TAU); g.fill();
  }
  g.translate(lean, 0); g.scale(bob * breathe, bob * breathe);
  // ── arms (drawn under the torso when reaching forward from the shoulders) ──
  const sh = s * 0.82; // shoulder half-width
  const arm = s * 0.36;
  let hands = null;
  if (o.pose === 'zombie') {
    const reach = s * (kind === 'screamer' ? 1.8 : kind === 'x13' ? 2.0 : 1.35) * (1 + (o.atk || 0) * 0.35);
    const spread = kind === 'screamer' ? 1.0 : 0.25;
    hands = [-1, 1].map(sd => [reach + Math.sin(ph * 0.9 + sd * 1.7 + t * (mv ? 0 : 1.5)) * s * 0.22, sd * (sh * (0.55 + spread)) + Math.sin(t * 1.1 + sd) * s * 0.12]);
    for (const [k, [hx, hy]] of hands.entries()) limb(g, s * 0.1, (k ? 1 : -1) * sh, hx, hy, arm, skin);
  } else if (o.pose === 'gun') {
    const two = !['pistol', 'revolver'].includes(o.wpn);
    const kb = o.kick || 0; // recoil pushes the hands back
    hands = two ? [[s * 0.75 - kb, -s * 0.12], [s * 1.55 - kb, s * 0.18]] : [[s * 1.25 - kb, -s * 0.05], [s * 1.2 - kb, s * 0.25]];
    limb(g, 0, -sh, hands[0][0], hands[0][1], arm, body); limb(g, 0, sh, hands[1][0], hands[1][1], arm, body);
  } else if (o.pose === 'melee') {
    const sw = o.swing || 0;
    hands = [[s * 0.9 * Math.cos(sw), s * 0.9 * Math.sin(sw) - s * 0.2], [s * 0.9 * Math.cos(sw), s * 0.9 * Math.sin(sw) + s * 0.15]];
    limb(g, 0, -sh, hands[0][0], hands[0][1], arm, body); limb(g, 0, sh, hands[1][0], hands[1][1], arm, body);
  } else { // relaxed: arms swing opposite to the feet
    hands = [-1, 1].map(sd => [-step * sd * 0.6 + s * 0.15, sd * (sh + s * 0.15)]);
    for (const [k, [hx, hy]] of hands.entries()) limb(g, 0, (k ? 1 : -1) * sh, hx, hy, arm, body);
  }
  // ── back items ──
  if (o.backpack) blob(g, -s * 0.75, 0, s * 0.45, s * 0.62, o.backpack, 0, 0.12);
  if (kind === 'broodmother') { blob(g, -s * 0.9, 0, s * 1.2, s * 1.05, '#e0d0b8', 0, 0.25); for (let k = 0; k < 6; k++) { const aa = k * 1.05 + ph * 0.1; blob(g, -s * 0.9 + Math.cos(aa) * s * 0.65, Math.sin(aa) * s * 0.6, s * 0.18, s * 0.18, '#c8b8a0'); } }
  if (kind === 'toxic') { g.fillStyle = `rgba(140,220,60,${0.18 + 0.06 * Math.sin(ph)})`; g.beginPath(); g.arc(0, 0, s * 2.2, 0, TAU); g.fill(); }
  // ── torso ──
  const tw = kind === 'bloater' ? 1.35 : kind === 'brute' || kind === 'goliath' ? 1.3 : kind === 'runner' || kind === 'screamer' || kind === 'stalker' || kind === 'x13' ? 0.85 : 1;
  const td = kind === 'bloater' ? 1.5 : kind === 'brute' || kind === 'goliath' ? 1.15 : 1;
  blob(g, -s * 0.05, 0, s * 0.62 * td, sh * tw, body, 0, 0.2);
  // clothing detail
  if (Z && !['bloater', 'riot', 'toxic', 'stalker', 'x13', 'fiend', 'goliath', 'broodmother'].includes(kind)) { // torn shirt + wounds
    g.fillStyle = skin; g.beginPath(); g.ellipse(s * 0.1, sh * 0.3 * (hash(o.id, 2) > 0.5 ? 1 : -1), s * 0.22, s * 0.16, 0.5, 0, TAU); g.fill();
    g.fillStyle = 'rgba(110,8,8,.75)'; g.beginPath(); g.arc(-s * 0.2, sh * (hash(o.id, 5) - 0.5), s * 0.16, 0, TAU); g.fill();
  }
  if (kind === 'bloater') for (let k = 0; k < 5; k++) { g.fillStyle = '#d8d070'; g.beginPath(); g.arc((hash(o.id, k) - 0.5) * s, (hash(k, o.id) - 0.5) * sh * 2, s * 0.13, 0, TAU); g.fill(); }
  if (kind === 'goliath') { g.strokeStyle = '#9a9aa0'; g.lineWidth = 2; for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(hands[sd > 0 ? 1 : 0][0] - s * 0.3, hands[sd > 0 ? 1 : 0][1]); g.lineTo(hands[sd > 0 ? 1 : 0][0] - s * 1.0, hands[sd > 0 ? 1 : 0][1] + sd * s * 0.6 + Math.sin(ph) * s * 0.3); g.stroke(); } }
  if (kind === 'x13') { g.strokeStyle = 'rgba(90,255,255,.8)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-s * 0.4, -sh * 0.5); g.lineTo(s * 0.1, 0); g.lineTo(-s * 0.3, sh * 0.5); g.moveTo(s * 0.1, 0); g.lineTo(-s * 0.5, 0); g.stroke(); }
  if (kind === 'spitter') blob(g, s * 0.25, 0, s * 0.42, s * 0.55, '#9fd06a', 0, 0.3);
  if (kind === 'fiend') for (let k = 0; k < 4; k++) { g.strokeStyle = 'rgba(255,190,60,.8)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo((hash(k, 1) - 0.5) * s, (hash(k, 2) - 0.5) * sh * 1.6); g.lineTo((hash(k, 3) - 0.5) * s, (hash(k, 4) - 0.5) * sh * 1.6); g.stroke(); }
  // ── hands ──
  for (const [hx, hy] of hands) {
    if (o.pose === 'zombie') { blob(g, hx, hy, s * 0.24, s * 0.2, skin, 0, 0.1); g.strokeStyle = OL; g.lineWidth = 1; for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(hx + s * 0.15, hy + k * s * 0.1); g.lineTo(hx + s * (kind === 'x13' ? 0.6 : 0.35), hy + k * s * 0.13); g.stroke(); } }
    else blob(g, hx, hy, s * 0.2, s * 0.2, skin, 0, 0.1);
  }
  // ── weapon in the hands ──
  if (o.pose === 'gun' && o.wpn) { g.save(); g.translate(-s * 0.2 - (o.kick || 0), 0); drawGunLocal(g, o.wpn); g.restore(); }
  // ── head ──
  const hx = s * 0.12, hr = s * 0.5 * (kind === 'brute' || kind === 'goliath' ? 0.85 : kind === 'bloater' ? 0.75 : 1);
  // the head leads: it turns toward the aim before the body, and lolls on zombies
  g.save(); g.translate(hx, 0); g.rotate((o.headTurn || 0) + (Z ? Math.sin(t * 1.7) * 0.35 : 0)); g.translate(-hx, Z ? Math.sin(t * 1.7) * s * 0.08 : 0);
  if (kind === 'riot') { blob(g, hx, 0, hr * 1.12, hr * 1.12, '#1a2028', 0, 0.35); g.fillStyle = 'rgba(160,200,230,.5)'; g.fillRect(hx + hr * 0.4, -hr * 0.6, hr * 0.35, hr * 1.2); }
  else if (hat) blob(g, hx, 0, hr * 1.05, hr * 1.05, hat, 0, 0.3);
  else {
    blob(g, hx, 0, hr, hr, Z ? skin : hair, 0, 0.3);
    if (Z && kind !== 'stalker') { g.fillStyle = hair; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(hx - hr * 0.3 + (hash(o.id, 10 + k) - 0.5) * hr, (hash(o.id, 20 + k) - 0.5) * hr * 1.4, hr * 0.28, 0, TAU); g.fill(); } }
    if (!Z) { g.fillStyle = rigShade(skin, 1); g.beginPath(); g.ellipse(hx + hr * 0.55, 0, hr * 0.38, hr * 0.62, 0, -1.2, 1.2); g.fill(); } // a sliver of face/forehead
  }
  if (kind === 'fiend') for (const sd of [-1, 1]) { g.fillStyle = '#e8d8b0'; g.strokeStyle = OL; g.lineWidth = 1; g.beginPath(); g.moveTo(hx, sd * hr * 0.6); g.quadraticCurveTo(hx - hr * 0.2, sd * hr * 1.8, hx + hr * 0.9, sd * hr * 1.5); g.lineTo(hx + hr * 0.2, sd * hr * 0.4); g.fill(); g.stroke(); }
  g.restore(); // head
  if (o.backpackStrap) { g.strokeStyle = rigShade(o.backpack, 0.7); g.lineWidth = 2; for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(-s * 0.5, sd * sh * 0.55); g.lineTo(s * 0.25, sd * sh * 0.5); g.stroke(); } }
  // riot shield in front
  if (kind === 'riot') { g.fillStyle = OL; g.fillRect(s * 1.25, -sh * 1.25, s * 0.35, sh * 2.5); g.fillStyle = 'rgba(150,190,220,.55)'; g.fillRect(s * 1.3, -sh * 1.2, s * 0.25, sh * 2.4); }
  g.restore();
}
function mixHex(a, b, k) {
  const p = h => { h = h.length === 4 ? '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3] : h; const n = parseInt(h.slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  if (!a || a[0] !== '#') return a;
  const x = p(a), y = p(b), m = i => Math.round(x[i] + (y[i] - x[i]) * k).toString(16).padStart(2, '0');
  return '#' + m(0) + m(1) + m(2);
}
// gun drawn in the rig's local frame (same shapes as drawGun, without the hands)
function drawGunLocal(g, wid) {
  const ol = OL, R = (x0, y0, w, h, c, r = 1) => { g.fillStyle = ol; roundRect(g, x0 - 1, y0 - 1, w + 2, h + 2, r + 1); g.fill(); g.fillStyle = c; roundRect(g, x0, y0, w, h, r); g.fill(); };
  switch (wid) {
    case 'pistol': R(9, -2, 11, 4, '#2a2c30'); R(10, -1.2, 9, 1.4, '#4a4e54', 0); break;
    case 'revolver': R(9, -2, 12, 4, '#3a3c40'); g.fillStyle = ol; g.beginPath(); g.arc(13, 0, 3.6, 0, TAU); g.fill(); g.fillStyle = '#6a6e74'; g.beginPath(); g.arc(13, 0, 2.6, 0, TAU); g.fill(); break;
    case 'smg': R(4, -3, 15, 6, '#2a2c2e', 2); R(18, -1.2, 6, 2.4, '#1a1a1a', 0); R(10, 3, 3, 5, '#3a3a3a', 0); break;
    case 'rifle': R(-4, -2.5, 8, 5, '#1e1e20', 2); R(4, -3, 16, 6, '#2a2e26', 2); R(19, -1.2, 12, 2.4, '#151515', 0); R(10, 3, 4, 6, '#2a2a2a', 0); R(8, -1.4, 4, 2.8, '#c84030', 0); break;
    case 'shotgun': R(-5, -2.5, 10, 5, '#6a4426', 2); R(5, -2.5, 10, 5, '#2a2a2c', 1); R(14, -1.6, 18, 3.2, '#1c1c1e', 0); R(17, -3, 7, 6, '#7a5030', 2); break;
    case 'sniper': R(-7, -2.5, 10, 5, '#3a3020', 2); R(3, -2.5, 14, 5, '#2a3020', 1); R(16, -1, 22, 2, '#151515', 0); R(5, -2.2, 12, 4.4, '#101214', 2); break;
    case 'launcher': R(-10, -4, 44, 8, '#4a5a3a', 3); break;
    case 'bazooka': R(-12, -5, 48, 10, '#556b3a', 4); break;
    case 'crossbow': R(2, -2, 20, 4, '#6a4426', 1); g.strokeStyle = '#3a3a3e'; g.lineWidth = 2.5; g.beginPath(); g.arc(17, 0, 11, -1.15, 1.15); g.stroke(); break;
    case 'flamer': R(2, -3, 16, 6, '#3a3a3c', 2); R(17, -1.6, 11, 3.2, '#5a5a5e', 0); break;
    case 'machete': R(4, -1.5, 18, 3, '#c8ccd0', 0); break;
    default: R(9, -2, 11, 4, '#2a2c30');
  }
}
// the look of a given entity, kept stable per id
function rigLook(e) {
  const d = e.def, id = e.id || 0;
  if (e.cat === 'mob') {
    const zs = e.kind === 'stalker' ? '#26262c' : e.kind === 'x13' ? '#8a9aa0' : e.kind === 'fiend' ? '#a8302a' : pickH(ZSKIN, id, 1);
    const body = { walker: pickH(ZSHIRT, id, 2), runner: pickH(ZSHIRT, id, 3), crawler: pickH(ZSHIRT, id, 4), spitter: '#4f7a5a', brute: '#5a4a5a', bloater: '#a8a060',
      screamer: '#c8c8d0', riot: '#22262e', toxic: '#d8c020', stalker: '#18181c', fiend: '#8a2420', broodmother: '#c8b8a0', goliath: '#d07a2a', x13: '#6a7a80', hound: '#5a4a3a' }[e.kind] || pickH(ZSHIRT, id, 2);
    return { zombie: true, skin: zs, body, pants: e.kind === 'goliath' ? '#c86a20' : e.kind === 'toxic' ? '#b8a018' : pickH(PANTS, id, 5), hair: pickH(HAIR, id, 6), pose: 'zombie', kind: e.kind,
             s: Math.max(9, d.r * TILE * 0.95) };
  }
  return { zombie: false, skin: pickH(SKIN, id, 7), body: d.body, pants: pickH(PANTS, id, 8), hair: pickH(HAIR, id, 9), hat: d.hat, pose: e.wpn ? (WEAPONS[e.wpn].melee ? 'melee' : 'gun') : 'none',
           wpn: e.wpn, kind: e.kind, s: d.boss ? 13 : 11 };
}
