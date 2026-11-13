'use strict';
// HUD, panels (shop / workbench / map / help), title, input and synth audio.

const FONT = 'system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
V.btns = [];
function uiBtn(x, y, w, h, fn, opt = {}) { V.btns.push({ x, y, w, h, fn, ...opt }); }
function button(g, x, y, w, h, label, fn, o = {}) {
  const hot = I.mouse && I.mx >= x && I.mx <= x + w && I.my >= y && I.my <= y + h;
  g.fillStyle = o.disabled ? 'rgba(60,60,64,.85)' : o.fill || (hot ? 'rgba(255,209,102,.95)' : 'rgba(40,42,48,.92)');
  roundRect(g, x, y, w, h, 6); g.fill();
  if (o.stroke) { g.strokeStyle = o.stroke; g.lineWidth = 2; g.stroke(); }
  g.fillStyle = o.disabled ? '#888' : hot && !o.fill ? '#111' : o.color || '#eee';
  g.font = `${o.bold === false ? '' : 'bold '}${o.size || 13}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, x + w / 2, y + h / 2 + 1);
  g.textBaseline = 'alphabetic';
  if (!o.disabled && fn) uiBtn(x, y, w, h, fn, o);
}
function txt(g, s, x, y, c = '#eee', size = 13, align = 'left', bold = true) {
  g.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`; g.textAlign = align; g.fillStyle = c; g.fillText(s, x, y);
}
function panelBox(g, w, h, title) {
  w = Math.min(w, VIEW_W - 16); h = Math.min(h, VIEW_H - 16);
  const x = (VIEW_W - w) / 2 | 0, y = (VIEW_H - h) / 2 | 0;
  g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, VIEW_W, VIEW_H);
  uiBtn(0, 0, VIEW_W, VIEW_H, null, { block: true });
  g.fillStyle = 'rgba(22,24,30,.97)'; roundRect(g, x, y, w, h, 10); g.fill();
  g.strokeStyle = 'rgba(255,209,102,.35)'; g.lineWidth = 1.5; g.stroke();
  txt(g, title, x + 16, y + 28, '#ffd166', 17);
  button(g, x + w - 40, y + 8, 30, 30, '✕', () => { V.panel = null; });
  return { x, y, w, h };
}

// ── HUD ────────────────────────────────────────────────────────────────────
const touchUI = () => I.touch;
function drawHud(g) {
  const p = meP(), S = G.stash, T_ = touchUI(), small = VIEW_W < 760;
  V.btns = [];
  // stats
  const bw = small ? 150 : 210;
  g.fillStyle = 'rgba(0,0,0,.5)'; roundRect(g, 8, 8, bw + 16, 58, 8); g.fill();
  const statBar = (y, k, c, label) => {
    g.fillStyle = '#222'; g.fillRect(16, y, bw, 12);
    g.fillStyle = c; g.fillRect(16, y, bw * clamp(k, 0, 1), 12);
    txt(g, label, 20, y + 10, '#fff', 10);
  };
  statBar(14, p.hp / p.maxHp, p.hp > 35 ? '#4fc26a' : '#e04a3a', `체력 ${Math.ceil(p.hp)}`);
  statBar(30, p.hunger / 100, p.hunger > 25 ? '#d99a3a' : '#e04a3a', `허기 ${Math.ceil(p.hunger)}`);
  statBar(46, p.stamina / 100, '#d8d050', `기력 ${Math.ceil(p.stamina)}`);

  // clock
  const c = G.clock, hh = Math.floor(c / 60), mm = Math.floor(c % 60);
  const night = G.phase === 'night' || G.phase === 'dawn';
  const cx = VIEW_W / 2, cw = small ? 150 : 210;
  g.fillStyle = night ? 'rgba(30,10,20,.7)' : 'rgba(0,0,0,.5)'; roundRect(g, cx - cw / 2, 8, cw, 40, 8); g.fill();
  txt(g, `${night ? '☾' : '☀'} ${G.day}일차  ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, cx, 26, night ? '#ff9a8a' : '#ffe9a8', small ? 13 : 15, 'center');
  const sub = night ? `밤 ${G.nightN} · 웨이브 ${Math.min(G.waveIdx || 0, 4)}/4` : G.phase === 'dusk' ? '해질녘 — 방어 준비!' : `밤까지 ${fmtMin(((NIGHT - c) + 1440) % 1440)}`;
  txt(g, sub, cx, 42, '#bbb', 10, 'center', false);

  // resources
  const res = [['$', S.cash, '#ffd166'], ['목재', S.wood, '#c89a5a'], ['고철', S.scrap, '#a8b0c0'], ['식량', S.food, '#9fd06a'], ['약', S.meds, '#ff9a9a'], ['수류탄', S.grenade, '#9fc'], ['지뢰', S.mine, '#dca']];
  const crew = G.ents.filter(e => e.kind === 'survivor' && e.mode !== 'wait').length;
  res.push(['동료', crew, '#7dff9a']);
  const rw = small ? 56 : 66, cols = VIEW_W >= 1240 ? 8 : 4, rx0 = VIEW_W - 8 - cols * rw - (T_ ? 0 : 0);
  g.fillStyle = 'rgba(0,0,0,.5)'; roundRect(g, rx0 - 6, 8, cols * rw + 6, cols === 4 ? 44 : 24, 8); g.fill();
  res.forEach(([n, v, col], i) => {
    const x = rx0 + (i % cols) * rw, y = 24 + Math.floor(i / cols) * 18;
    txt(g, n, x, y, '#aaa', 10, 'left', false); txt(g, String(v), x + rw - 8, y, col, 11, 'right');
  });

  // hotbar
  const owned = WEAPON_ORDER.filter(w => S.owned[w]);
  const hw = small ? 54 : 74, hh2 = small ? 40 : 44;
  const hx0 = T_ ? (VIEW_W - owned.length * (hw + 4)) / 2 : (VIEW_W - owned.length * (hw + 4)) / 2;
  const hy = T_ ? 56 + (small ? 18 : 0) : VIEW_H - hh2 - 10;
  owned.forEach((w, k) => {
    const x = hx0 + k * (hw + 4), sel = p.wpn === w, D = WEAPONS[w];
    g.fillStyle = sel ? 'rgba(255,209,102,.92)' : 'rgba(0,0,0,.55)'; roundRect(g, x, hy, hw, hh2, 6); g.fill();
    const col = sel ? '#111' : '#ddd';
    txt(g, `${D.key} ${small ? D.name.slice(0, 3) : D.name}`, x + 5, hy + 15, col, 10);
    if (!D.melee) {
      const spare = (S.mags[w] || []);
      txt(g, `${p.mag[w] || 0}/${wstatC(w, 'mag')}`, x + 5, hy + 31, col, 11);
      txt(g, `+${spare.length}`, x + hw - 5, hy + 31, sel ? '#333' : '#999', 10, 'right', false);
    } else txt(g, '근접', x + 5, hy + 31, col, 10, 'left', false);
    const u = S.upg[w]; if (u) { const lv = u.dmg + u.mag + u.rate + u.reload; if (lv) txt(g, '★' + lv, x + hw - 5, hy + 15, sel ? '#7a4a00' : '#ffd166', 9, 'right'); }
    if (sel && p.reloadT > 0) { g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(x, hy + hh2 - 4, hw * (1 - p.reloadT / wstatC(w, 'reload')), 4); }
    uiBtn(x, hy, hw, hh2, () => sendCmd({ c: 'wpn', w }));
  });
  if (p.reloadT > 0) txt(g, '재장전 중…', VIEW_W / 2, T_ ? hy + hh2 + 16 : hy - 8, '#ffd166', 12, 'center');

  // interaction prompt
  const it = findInteract(p, G);
  if (it && !V.panel) {
    const label = (T_ ? '' : '[E] ') + it.label;
    g.font = `bold 13px ${FONT}`; const w = g.measureText(label).width + 24;
    const py = T_ ? VIEW_H - 200 : VIEW_H - 92;
    g.fillStyle = it.steal ? 'rgba(120,20,10,.8)' : 'rgba(0,0,0,.7)'; roundRect(g, VIEW_W / 2 - w / 2, py - 18, w, 26, 6); g.fill();
    txt(g, label, VIEW_W / 2, py, it.steal ? '#ffb3a0' : '#fff', 13, 'center');
  }
  if (p.in && p.in.crouch) txt(g, '은신 중 (발각 범위 감소)', 16, 86, '#9fd0ff', 11);

  // minimap
  const mmW = small ? 110 : 160, mmH = mmW * MH / MW, mmx = VIEW_W - mmW - 8, mmy = T_ ? (small ? 60 : 40) : VIEW_H - mmH - 8;
  if (!T_ || true) {
    const my2 = T_ ? mmy + 0 : mmy;
    const mx2 = T_ ? 8 : mmx, myy = T_ ? 96 + (p.in && p.in.crouch ? 12 : 0) : my2;
    drawMiniMap(g, mx2, myy, mmW, mmH, 1);
    uiBtn(mx2, myy, mmW, mmH, () => { V.mapOpen = true; });
  }

  // wave warning arrow
  if (G.warn) {
    const a = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][G.warn.dir];
    const ax = VIEW_W / 2 + Math.cos(a) * (VIEW_W / 2 - 50), ay = VIEW_H / 2 + Math.sin(a) * (VIEW_H / 2 - 70);
    g.save(); g.translate(ax, ay); g.rotate(a); g.globalAlpha = 0.6 + 0.4 * Math.sin(V.frame / 5);
    g.fillStyle = '#ff3b2b'; g.beginPath(); g.moveTo(22, 0); g.lineTo(-12, -16); g.lineTo(-12, 16); g.fill(); g.restore();
  }
  // off-screen arrows: partner + core
  const arrow = (x, y, col, label) => {
    const dx = x * TILE - (V.cam.x + VIEW_W / 2), dy = y * TILE - (V.cam.y + VIEW_H / 2);
    if (Math.abs(dx) < VIEW_W / 2 - 20 && Math.abs(dy) < VIEW_H / 2 - 20) return;
    const a = Math.atan2(dy, dx), k = Math.min((VIEW_W / 2 - 40) / Math.abs(Math.cos(a) || 1e-6), (VIEW_H / 2 - 60) / Math.abs(Math.sin(a) || 1e-6));
    const ax = VIEW_W / 2 + Math.cos(a) * k, ay = VIEW_H / 2 + Math.sin(a) * k;
    g.save(); g.translate(ax, ay); g.rotate(a); g.fillStyle = col; g.beginPath(); g.moveTo(12, 0); g.lineTo(-6, -8); g.lineTo(-6, 8); g.fill(); g.restore();
    txt(g, `${label} ${Math.round(Math.hypot(dx, dy) / TILE)}m`, ax, ay + 20, col, 10, 'center');
  };
  for (const q of G.players) if (q && q !== p && q.joined && !q.dead) arrow(q.x, q.y, q.color, q.name);
  if (dist(p.x, p.y, G.core.x, G.core.y) > 12) arrow(G.core.x, G.core.y, '#7df', '기지');

  // messages
  let my = T_ ? 150 : 108;
  for (const m of V.msgs) {
    g.globalAlpha = clamp(m.ttl, 0, 1);
    const sz = m.big ? (small ? 15 : 19) : 13;
    g.font = `bold ${sz}px ${FONT}`; g.textAlign = 'center';
    const lines = wrapLines(g, m.text, VIEW_W - 40);
    for (const l of lines) { g.fillStyle = 'rgba(0,0,0,.7)'; g.fillText(l, VIEW_W / 2 + 1, my + 1); g.fillStyle = m.c; g.fillText(l, VIEW_W / 2, my); my += sz + 6; }
    g.globalAlpha = 1;
  }
  if (V.net) txt(g, V.net, 10, VIEW_H - (T_ ? 6 : 22), '#8fd3ff', 11, 'left', true);

  // build bar
  if (V.build) drawBuildBar(g);
  if (T_) drawTouch(g);
  else if (!V.build) txt(g, 'B 건설 · E 상호작용 · F 먹기 · H 치료 · G 수류탄 · C 은신 · M 지도 · F1 도움말', 10, VIEW_H - (VIEW_W < 900 ? 64 : 6) , 'rgba(255,255,255,.35)', 10, 'left', false);
}
function fmtMin(m) { return `${Math.floor(m / 60)}시간 ${Math.floor(m % 60)}분`; }
function wstatC(w, s) { return wstat(w, s); }
function drawMiniMap(g, x, y, w, h, alphaEnts) {
  const p = meP();
  g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x - 2, y - 2, w + 4, h + 4);
  g.imageSmoothingEnabled = false; g.drawImage(miniMap(), x, y, w, h); g.imageSmoothingEnabled = true;
  const k = w / MW;
  const dot = (ox, oy, c, r = 2) => { g.fillStyle = c; g.fillRect(x + ox * k - r / 2, y + oy * k - r / 2, r, r); };
  for (const v of W.villages) { g.strokeStyle = G.vh[v.id] > 0 ? '#ff5c4c' : '#8fd3ff'; g.lineWidth = 1; g.strokeRect(x + v.x * k, y + v.y * k, v.w * k, v.h * k); }
  for (const c of W.camps) { g.strokeStyle = '#ff8a5c'; g.strokeRect(x + c.x * k, y + c.y * k, c.w * k, c.h * k); }
  for (const e of G.ents) {
    if (dist(e.x, e.y, p.x, p.y) > 34 && !(e.kind === 'survivor') && !e.def.shop) continue;
    dot(e.x, e.y, e.cat === 'mob' ? '#e33' : e.kind === 'survivor' ? (e.mode === 'wait' ? '#ffd166' : '#7dff9a') : e.def.shop ? '#ffd166' : e.team === 'bandit' ? '#ff8a5c' : '#8fd3ff', e.cat === 'mob' ? 2 : 3);
  }
  dot(G.core.x, G.core.y, '#7df', 5);
  for (const q of G.players) if (q && q.joined && !q.dead) dot(q.x, q.y, q === p ? '#fff' : q.color, 4);
  // view rect
  g.strokeStyle = 'rgba(255,255,255,.5)'; g.strokeRect(x + V.cam.x / TILE * k, y + V.cam.y / TILE * k, VIEW_W / TILE * k, VIEW_H / TILE * k);
}
function drawBuildBar(g) {
  const S = G.stash, T_ = touchUI();
  const n = STRUCT_ORDER.length, bw = Math.min(104, (VIEW_W - 16) / n - 4), bh = 50;
  const x0 = (VIEW_W - n * (bw + 4)) / 2, y = T_ ? Math.max(200, VIEW_H - 470) : VIEW_H - bh - 10;
  STRUCT_ORDER.forEach((t, k) => {
    const d = STRUCTS[t], x = x0 + k * (bw + 4), sel = V.buildSel === t, ok = canAfford(d.cost);
    g.fillStyle = sel ? 'rgba(120,200,255,.9)' : 'rgba(0,0,0,.65)'; roundRect(g, x, y, bw, bh, 6); g.fill();
    txt(g, `${d.key} ${d.name}`, x + 5, y + 16, sel ? '#111' : ok ? '#eee' : '#888', bw < 80 ? 9 : 11);
    const cost = Object.entries(d.cost).map(([k2, v]) => `${k2 === 'cash' ? '$' : ITEMS[k2].name}${v}`).join(' ');
    txt(g, cost, x + 5, y + 32, sel ? '#222' : ok ? '#bbb' : '#a66', 9, 'left', false);
    txt(g, `HP ${d.hp}`, x + 5, y + 45, sel ? '#333' : '#777', 9, 'left', false);
    uiBtn(x, y, bw, bh, () => { V.buildSel = t; });
  });
  const tip = T_ ? '조준 방향 앞에 설치 · 설치/철거 버튼 사용' : '좌클릭 설치 · 우클릭/X 철거(50% 환급) · B/Esc 종료 · 코어 반경 안에서만';
  txt(g, '건설 모드 — ' + tip, VIEW_W / 2, y - 8, '#8fd3ff', 11, 'center');
}

// ── panels ──────────────────────────────────────────────────────────────────
function drawUI(g) {
  if (!G) { return; }
  if (V.mapOpen) drawBigMap(g);
  if (V.panel && V.panel.k === 'shop') drawShop(g);
  if (V.panel && V.panel.k === 'bench') drawBench(g);
  if (V.help) drawHelp(g);
  if (V.paused) {
    const b = panelBox(g, 360, 230, NET.role === 'solo' ? '일시정지' : '메뉴 (게임은 계속 진행됩니다)');
    button(g, b.x + 30, b.y + 60, b.w - 60, 40, '계속하기', () => { V.paused = false; });
    button(g, b.x + 30, b.y + 110, b.w - 60, 40, '도움말', () => { V.help = true; });
    button(g, b.x + 30, b.y + 160, b.w - 60, 40, '타이틀로 나가기', () => { quitToTitle(); }, { color: '#ff9a8a' });
  }
  if (G.over) {
    const b = panelBox(g, 420, 230, G.over.reason === 'core' ? '기지가 무너졌습니다' : '모두 쓰러졌습니다');
    txt(g, `${G.over.day}일차까지 생존 · 처치 ${G.over.kills}`, VIEW_W / 2, b.y + 90, '#eee', 16, 'center');
    txt(g, `최고 기록: ${bestDays()}일`, VIEW_W / 2, b.y + 118, '#ffd166', 13, 'center');
    button(g, b.x + 40, b.y + 150, b.w - 80, 44, '타이틀로', () => quitToTitle());
  }
}
function drawBigMap(g) {
  const b = panelBox(g, 900, 760, '지도');
  const w = b.w - 32, h = b.h - 60, k = Math.min(w / MW, h / MH);
  const mx = b.x + (b.w - MW * k) / 2, my = b.y + 46;
  drawMiniMap(g, mx, my, MW * k, MH * k);
  for (const v of W.villages) txt(g, v.name + (G.vh[v.id] > 0 ? ' (적대)' : ''), mx + (v.x + v.w / 2) * k, my + v.y * k - 3, G.vh[v.id] > 0 ? '#ff6b5c' : '#8fd3ff', 11, 'center');
  for (const c of W.camps) txt(g, c.name, mx + (c.x + c.w / 2) * k, my + c.y * k - 3, '#ff8a5c', 11, 'center');
  for (const bd of W.buildings) if (bd.village < 0 && bd.type !== 'house' && bd.type !== 'store') txt(g, bd.name, mx + (bd.x + bd.w / 2) * k, my + (bd.y + bd.h / 2) * k, 'rgba(255,255,255,.7)', 9, 'center', false);
  txt(g, '기지', mx + G.core.x * k, my + G.core.y * k - 6, '#7df', 12, 'center');
  const p = meP();
  txt(g, '● 나  ● 동료/구조 대기(노랑)  ● 상인($)  ■ 마을(파랑)  ■ 약탈단 캠프(주황)', b.x + 16, b.y + b.h - 10, '#aaa', 10, 'left', false);
  uiBtn(b.x, b.y, b.w, b.h, () => { V.mapOpen = false; });
}
function shopNpc() { return V.panel && G.ents.find(e => e.id === V.panel.npc); }
function drawShop(g) {
  const e = shopNpc(), p = meP();
  if (!e || e.dead || dist(e.x, e.y, p.x, p.y) > 3.5 || (e.team === 'merchant' ? G.merchantHostile : G.vh[e.village] > 0)) { V.panel = null; return; }
  const S = G.stash, stock = e.stock || {};
  const b = panelBox(g, 780, 520, `${e.def.name}${e.village >= 0 ? ' — ' + W.villages[e.village].name : ''}`);
  txt(g, `보유 현금 $${S.cash}   ·   상인 자금 $${stock.cash || 0}`, b.x + b.w - 56, b.y + 28, '#ffd166', 13, 'right');
  const items = Object.keys(stock).filter(k => k !== 'cash' && stock[k] > 0);
  items.sort((a, c) => (a.startsWith('wpn') ? 0 : a.startsWith('mag') ? 1 : 2) - (c.startsWith('wpn') ? 0 : c.startsWith('mag') ? 1 : 2));
  const cols = b.w > 600 ? 2 : 1, cw = (b.w - 32 - (cols - 1) * 10) / cols, rh = 30;
  txt(g, '구매 — 탄창은 현재 탄창 용량만큼 가득 찬 상태로 들어옵니다', b.x + 16, b.y + 54, '#aaa', 11, 'left', false);
  const sellH = 70, listH = b.h - 74 - sellH;
  const rows = Math.ceil(items.length / cols), maxRows = Math.floor(listH / rh);
  V.shopScroll = clamp(V.shopScroll || 0, 0, Math.max(0, rows - maxRows));
  items.forEach((it, k) => {
    const r = Math.floor(k / cols) - V.shopScroll, c = k % cols;
    if (r < 0 || r >= maxRows) return;
    const x = b.x + 16 + c * (cw + 10), y = b.y + 64 + r * rh;
    const price = priceOf(it), owned = it.startsWith('wpn:') && S.owned[it.slice(4)];
    g.fillStyle = 'rgba(255,255,255,.04)'; g.fillRect(x, y, cw, rh - 4);
    txt(g, itemName(it) + (it.startsWith('wpn:') ? ' (무기)' : ''), x + 8, y + 18, it.startsWith('wpn:') ? '#ffd166' : '#eee', 12);
    txt(g, `재고 ${stock[it]}`, x + cw - 150, y + 18, '#999', 11, 'left', false);
    button(g, x + cw - 84, y + 2, 80, rh - 8, owned ? '보유 중' : `$${price}`, () => sendCmd({ c: 'buy', npc: e.id, item: it, n: 1 }), { disabled: owned || S.cash < price, size: 12 });
  });
  if (rows > maxRows) {
    button(g, b.x + b.w - 70, b.y + 58, 26, 22, '▲', () => { V.shopScroll--; }, { size: 11 });
    button(g, b.x + b.w - 40, b.y + 58, 26, 22, '▼', () => { V.shopScroll++; }, { size: 11 });
  }
  const sy = b.y + b.h - sellH;
  txt(g, '판매 (절반 가격)', b.x + 16, sy + 4, '#aaa', 11, 'left', false);
  const sw = (b.w - 32) / SELLABLE.length;
  SELLABLE.forEach((it, k) => {
    const x = b.x + 16 + k * sw, pr = Math.floor(priceOf(it) / 2);
    txt(g, `${itemName(it)} ${S[it]}개 · $${pr}`, x, sy + 24, '#ddd', 11, 'left', false);
    button(g, x, sy + 32, sw / 2 - 6, 26, '1개', () => sendCmd({ c: 'sell', npc: e.id, item: it, n: 1 }), { disabled: S[it] < 1, size: 11 });
    button(g, x + sw / 2 - 2, sy + 32, sw / 2 - 8, 26, '10개', () => sendCmd({ c: 'sell', npc: e.id, item: it, n: 10 }), { disabled: S[it] < 10, size: 11 });
  });
}
function drawBench(g) {
  const p = meP();
  if (dist(p.x, p.y, G.bench.x, G.bench.y) > 3.5) { V.panel = null; return; }
  const S = G.stash;
  const b = panelBox(g, 860, 520, '작업대 — 무기 강화');
  txt(g, `$${S.cash}  ·  고철 ${S.scrap}`, b.x + b.w - 56, b.y + 28, '#ffd166', 13, 'right');
  const owned = WEAPON_ORDER.filter(w => S.owned[w]);
  const rh = Math.min(62, (b.h - 60) / Math.max(owned.length, 1));
  const stats = Object.keys(UPG_STATS), nameW = b.w > 700 ? 150 : 90, sw = (b.w - 32 - nameW) / stats.length;
  owned.forEach((w, r) => {
    const y = b.y + 50 + r * rh, D = WEAPONS[w], u = S.upg[w] || { dmg: 0, mag: 0, rate: 0, reload: 0 };
    g.fillStyle = 'rgba(255,255,255,.04)'; g.fillRect(b.x + 12, y, b.w - 24, rh - 6);
    txt(g, D.name, b.x + 20, y + 20, '#fff', 13);
    const info = D.melee ? `피해 ${wstat(w, 'dmg') | 0}` : `피해 ${wstat(w, 'dmg') | 0}${D.pellets ? '×' + D.pellets : ''} · 탄창 ${magCap(w)} · ${(1 / wstat(w, 'rate')).toFixed(1)}발/초`;
    txt(g, info, b.x + 20, y + 38, '#999', 10, 'left', false);
    stats.forEach((s, k) => {
      const x = b.x + 16 + nameW + k * sw, lvl = u[s];
      const na = D.melee && s !== 'dmg' && s !== 'rate';
      txt(g, UPG_STATS[s].name, x, y + 14, na ? '#555' : '#bbb', 10, 'left', false);
      for (let q = 0; q < UPG_MAX; q++) { g.fillStyle = q < lvl ? '#ffd166' : '#333'; g.fillRect(x + q * 9, y + 20, 7, 6); }
      if (na) return;
      if (lvl >= UPG_MAX) { txt(g, 'MAX', x, y + 46, '#ffd166', 11); return; }
      const cost = upgCost(w, lvl);
      button(g, x, y + 30, sw - 8, rh - 38, `$${cost.cash} 고철${cost.scrap}`, () => sendCmd({ c: 'upg', w, s }), { disabled: !canAfford(cost), size: 10 });
    });
  });
}
function drawHelp(g) {
  const b = panelBox(g, 760, 560, '도움말');
  const lines = [
    '목표: 낮에는 파밍·거래·구조, 밤에는 기지(발전기 코어)를 지키며 최대한 오래 생존하세요.',
    '',
    '이동 WASD · 조준 마우스 · 사격 좌클릭 · 달리기 Shift · 은신 C(토글) / Ctrl',
    '재장전 R · 무기 1~7 / 휠 · 상호작용 E(누르기/길게) · 먹기 F · 치료 H · 수류탄 G · 건설 B · 지도 M',
    '',
    '• 탄창: 무기마다 예비 탄창이 따로 있습니다. 재장전하면 가장 꽉 찬 탄창을 끼우고 남은 탄창은 다시 보관합니다.',
    '   탄창은 상인에게서 사거나, 상자·적에게서 얻습니다.',
    '• 작업대(기지): 무기의 피해량/탄창 용량/연사/재장전을 5단계까지 강화.',
    '• 건설: 벽·문·가시·포탑·조명·드럼·지뢰. 좀비는 길을 막는 구조물을 부수며 코어로 갑니다.',
    '• 마을: 상인과 거래하거나, 창고·집 물건을 훔칠 수 있습니다(주황 표시). 주민 시야(눈 아이콘)에',
    '   들키면 마을 전체가 적대 → 전투. 죽이면 그 사람의 소지품·상점 재고 전부를 주울 수 있습니다.',
    '• 은신(C)하면 들키는 거리가 크게 줄고 소리도 작아집니다. 밤에는 시야가 더 짧습니다.',
    '• 생존자: "살려줘!" 표시된 사람을 [E]로 구출 → 따라오기/경계 전환. 매일 아침 식량 1개씩 먹습니다.',
    '   특기: 사수 · 정비공(자동 수리) · 의무병(회복) · 수집가(매일 물자).',
    '• 약탈단: 캠프에 좋은 물자가 있습니다. 3일차부터 낮에 기지를 습격하기도 합니다.',
    '• 좀비: 워커·크롤러·러너·스피터(산성)·브루트(벽 파괴)·블로터(자폭)·스크리머(동료 호출)·5일마다 보스.',
    '• 협동: 타이틀에서 "방 만들기" → 코드 공유 → 친구가 "참가하기". 자원은 공유, 쓰러지면 서로 살릴 수 있습니다.',
  ];
  lines.forEach((l, i) => txt(g, l, b.x + 18, b.y + 60 + i * 26, l.startsWith('•') ? '#ddd' : '#bbb', 12, 'left', false));
  uiBtn(b.x, b.y, b.w, b.h, () => { V.help = false; });
}
function wrapLines(g, text, maxW) {
  const out = []; let line = '';
  for (const word of text.split(' ')) { const t = line ? line + ' ' + word : word; if (g.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t; }
  out.push(line); return out;
}

// ── title ──────────────────────────────────────────────────────────────────
function drawTitle(g) {
  V.btns = [];
  const t = V.frame / 60;
  // ambient background: drifting fog + silhouettes
  const gr = g.createLinearGradient(0, 0, 0, VIEW_H); gr.addColorStop(0, '#0b0f1e'); gr.addColorStop(1, '#2a1410');
  g.fillStyle = gr; g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.fillStyle = '#e8d8b0'; g.beginPath(); g.arc(VIEW_W * 0.78, VIEW_H * 0.2, 40, 0, TAU); g.fill();
  for (let k = 0; k < 14; k++) {
    const x = ((k * 97 + t * 12 * (1 + k % 3)) % (VIEW_W + 80)) - 40, y = VIEW_H * 0.72 + (k % 4) * 10;
    drawBody(g, x / TILE, y / TILE, 0, { r: 0.4, body: '#1a1d14', head: '#1a1d14', walk: t * 4 + k, zombie: true, reach: 1.3, eye: '#c01010', legs: '#111' });
  }
  g.fillStyle = '#0a0a0a'; g.fillRect(0, VIEW_H * 0.78, VIEW_W, VIEW_H);
  const small = VIEW_W < 700;
  txt(g, 'CELL SIEGE', VIEW_W / 2, VIEW_H * 0.2, '#fff', small ? 40 : 58, 'center');
  txt(g, 'N I G H T F A L L', VIEW_W / 2, VIEW_H * 0.2 + (small ? 30 : 40), '#ff7a5c', small ? 16 : 22, 'center');
  txt(g, '낮에는 파밍·거래·약탈, 밤에는 기지 방어. 오픈 월드 생존 슈터.', VIEW_W / 2, VIEW_H * 0.2 + (small ? 58 : 74), '#bbb', small ? 12 : 14, 'center', false);
  const bw = Math.min(320, VIEW_W - 40), bx = (VIEW_W - bw) / 2;
  let by = VIEW_H * 0.2 + (small ? 80 : 104);
  const bh = small ? 40 : 46, gap = small ? 8 : 10;
  if (V.titleMsg) { txt(g, V.titleMsg, VIEW_W / 2, by + 4, '#8fd3ff', 13, 'center'); by += 22; }
  button(g, bx, by, bw, bh, '혼자 시작', () => startSolo(), { size: 16 }); by += bh + gap;
  button(g, bx, by, bw, bh, '친구와 함께 — 방 만들기', () => startHost(), { size: 15 }); by += bh + gap;
  button(g, bx, by, bw, bh, '친구 방 참가 — 코드 입력', () => startJoin(), { size: 15 }); by += bh + gap;
  button(g, bx, by, bw / 2 - 4, bh - 6, '도움말', () => { V.titleHelp = !V.titleHelp; }, { size: 13 });
  button(g, bx + bw / 2 + 4, by, bw / 2 - 4, bh - 6, '클래식 모드', () => { location.href = 'classic.html'; }, { size: 13 });
  if (V.titleHelp) {
    const lines = I.touch ? ['왼쪽 엄지: 이동 · 오른쪽 엄지: 조준+사격', '오른쪽 버튼: 상호작용 / 재장전 / 수류탄 / 건설 / 먹기 / 치료 / 은신', '위쪽 무기 칸을 눌러 무기 교체']
      : ['WASD 이동 · 마우스 조준/사격 · Shift 달리기 · C 은신', 'E 상호작용 · R 재장전 · G 수류탄 · B 건설 · F 먹기 · H 치료 · M 지도'];
    lines.forEach((l, i) => txt(g, l, VIEW_W / 2, by + bh + 14 + i * 20, '#aaa', 12, 'center', false));
  }
  const best = bestDays();
  if (best) txt(g, `최고 기록 ${best}일 생존`, VIEW_W / 2, VIEW_H - 16, '#ffd166', 12, 'center');
}
function bestDays() { try { return +localStorage.getItem('nightfall.best') || 0; } catch (e) { return 0; } }

// ── input ──────────────────────────────────────────────────────────────────
const I = { keys: {}, mx: 0, my: 0, mouse: false, lmb: false, rmb: false, touch: false, crouch: false,
            joy: { id: null, ox: 0, oy: 0, x: 0, y: 0 }, aim: { id: null, ox: 0, oy: 0, x: 0, y: 0, fire: false }, pulse: 0, lastAimA: 0 };
const JR = 58;
function screenToWorld(sx, sy) { return { x: (sx + V.cam.x) / TILE, y: (sy + V.cam.y + 12) / TILE }; }
function hitBtn(x, y) { for (let k = V.btns.length - 1; k >= 0; k--) { const b = V.btns[k]; if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b; } return null; }
function clickAt(x, y) { const b = hitBtn(x, y); if (b) { if (b.fn) { b.fn(); sfx('click'); } return true; } return false; }
function anyModal() { return V.panel || V.mapOpen || V.help || V.paused || (G && G.over); }

function bindInput() {
  addEventListener('keydown', e => {
    audioUnlock();
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'F1'].includes(e.code)) e.preventDefault();
    I.keys[e.code] = true;
    if (e.repeat || !G) return;
    const p = meP();
    if (e.code === 'Escape') { if (V.panel) V.panel = null; else if (V.mapOpen) V.mapOpen = false; else if (V.help) V.help = false; else if (V.build) V.build = false; else V.paused = !V.paused; return; }
    if (e.code === 'F1') { V.help = !V.help; return; }
    if (e.code === 'KeyM') { V.mapOpen = !V.mapOpen; return; }
    if (anyModal()) { if (e.code === 'KeyE' && V.panel) V.panel = null; return; }
    const digit = e.code.startsWith('Digit') ? +e.code.slice(5) : -1;
    if (V.build && digit >= 1 && digit <= STRUCT_ORDER.length) { V.buildSel = STRUCT_ORDER[digit - 1]; return; }
    if (digit >= 1 && digit <= 7) { const w = WEAPON_ORDER[digit - 1]; if (G.stash.owned[w]) sendCmd({ c: 'wpn', w }); return; }
    switch (e.code) {
      case 'KeyE': pressUse(); break;
      case 'KeyR': sendCmd({ c: 'reload' }); break;
      case 'KeyF': sendCmd({ c: 'eat' }); break;
      case 'KeyH': sendCmd({ c: 'heal' }); break;
      case 'KeyG': { const w = screenToWorld(I.mx, I.my); sendCmd({ c: 'grenade', d: dist(p.x, p.y, w.x, w.y) }); break; }
      case 'KeyB': V.build = !V.build; break;
      case 'KeyC': I.crouch = !I.crouch; break;
      case 'KeyX': if (V.build && V.ghost) sendCmd({ c: 'demolish', cell: V.ghost.cell }); break;
      case 'KeyQ': cycleWeapon(-1); break;
    }
  });
  addEventListener('keyup', e => { I.keys[e.code] = false; });
  addEventListener('blur', () => { I.keys = {}; I.lmb = I.rmb = false; });
  const pos = ev => { const r = canvas.getBoundingClientRect(); return { x: (ev.clientX - r.left) * VIEW_W / r.width, y: (ev.clientY - r.top) * VIEW_H / r.height }; };
  canvas.addEventListener('mousemove', ev => { const p = pos(ev); I.mx = p.x; I.my = p.y; I.mouse = true; });
  canvas.addEventListener('mousedown', ev => {
    audioUnlock();
    const p = pos(ev); I.mx = p.x; I.my = p.y; I.mouse = true;
    if (clickAt(p.x, p.y)) return;
    if (!G || anyModal()) return;
    if (ev.button === 0) { if (V.build) { if (V.ghost) sendCmd({ c: 'build', t: V.buildSel, cell: V.ghost.cell }); } else I.lmb = true; }
    if (ev.button === 2) { I.rmb = true; if (V.build && V.ghost) sendCmd({ c: 'demolish', cell: V.ghost.cell }); }
  });
  addEventListener('mouseup', ev => { if (ev.button === 0) I.lmb = false; if (ev.button === 2) I.rmb = false; });
  canvas.addEventListener('contextmenu', ev => ev.preventDefault());
  canvas.addEventListener('wheel', ev => { ev.preventDefault(); if (V.panel && V.panel.k === 'shop') { V.shopScroll = (V.shopScroll || 0) + Math.sign(ev.deltaY); return; } if (G && !anyModal()) cycleWeapon(Math.sign(ev.deltaY)); }, { passive: false });

  canvas.addEventListener('touchstart', ev => {
    ev.preventDefault(); audioUnlock(); goFullscreen();
    if (!I.touch) { I.touch = true; resize(); }
    for (const t of ev.changedTouches) {
      const p = pos(t);
      I.mouse = false;
      const hb = hitBtn(p.x, p.y);
      if (hb && hb.hold) { I.useHeld = true; I.useId = t.identifier; }
      if (clickAt(p.x, p.y)) continue;
      if (!G || anyModal()) continue;
      if (p.x < VIEW_W * 0.45) { if (I.joy.id === null) Object.assign(I.joy, { id: t.identifier, ox: p.x, oy: p.y, x: 0, y: 0 }); }
      else if (I.aim.id === null) Object.assign(I.aim, { id: t.identifier, ox: p.x, oy: p.y, x: 0, y: 0, fire: false });
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', ev => {
    ev.preventDefault();
    for (const t of ev.changedTouches) {
      const p = pos(t);
      for (const J of [I.joy, I.aim]) if (J.id === t.identifier) {
        let dx = p.x - J.ox, dy = p.y - J.oy; const l = Math.hypot(dx, dy);
        if (l > JR) { J.ox = p.x - dx / l * JR; J.oy = p.y - dy / l * JR; dx = dx / l * JR; dy = dy / l * JR; }
        J.x = dx / JR; J.y = dy / JR;
      }
    }
  }, { passive: false });
  const end = ev => { for (const t of ev.changedTouches) { if (t.identifier === I.useId) { I.useHeld = false; I.useId = null; } if (I.joy.id === t.identifier) Object.assign(I.joy, { id: null, x: 0, y: 0 }); if (I.aim.id === t.identifier) Object.assign(I.aim, { id: null, x: 0, y: 0, fire: false }); } };
  canvas.addEventListener('touchend', end); canvas.addEventListener('touchcancel', end);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { I.keys = {}; end({ changedTouches: [{ identifier: I.joy.id }, { identifier: I.aim.id }] }); if (G && NET.role === 'solo') V.paused = true; } });
}
function cycleWeapon(d) {
  const owned = WEAPON_ORDER.filter(w => G.stash.owned[w]), p = meP();
  sendCmd({ c: 'wpn', w: owned[(owned.indexOf(p.wpn) + d + owned.length) % owned.length] });
}
function pressUse() {
  const p = meP(), it = findInteract(p, G);
  if (!it) return;
  if (it.ui === 'shop') { V.panel = { k: 'shop', npc: it.e.id }; V.shopScroll = 0; sfx('click'); return; }
  if (it.ui === 'bench') { V.panel = { k: 'bench' }; sfx('click'); return; }
  sendCmd({ c: 'tap' });
}
// aim assist for touch: snap to the closest hostile in a cone
function assistAngle(p, a) {
  let best = null, bs = 0.45;
  for (const e of G.ents) {
    if (!(e.team === 'zombie' || e.team === 'bandit' || (e.team === 'village' && G.vh[e.village] > 0) || (e.team === 'merchant' && G.merchantHostile))) continue;
    const d = dist(p.x, p.y, e.x, e.y); if (d > 12) continue;
    const da = Math.abs(angDiff(a, Math.atan2(e.y - p.y, e.x - p.x)));
    if (da < bs) { bs = da; best = e; }
  }
  return best ? Math.atan2(best.y - p.y, best.x - p.x) : a;
}
// sample local controls into the player's input record
function sampleInput(p) {
  const K = I.keys, modal = anyModal();
  let mx = 0, my = 0;
  if (!modal) {
    if (K.KeyA || K.ArrowLeft) mx -= 1; if (K.KeyD || K.ArrowRight) mx += 1; if (K.KeyW || K.ArrowUp) my -= 1; if (K.KeyS || K.ArrowDown) my += 1;
    if (I.joy.id !== null && Math.hypot(I.joy.x, I.joy.y) > 0.15) { mx = I.joy.x; my = I.joy.y; }
  }
  const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
  let ax, ay, fire = false;
  if (I.touch) {
    const am = Math.hypot(I.aim.x, I.aim.y);
    let a;
    if (I.aim.id !== null && am > 0.2) { a = Math.atan2(I.aim.y, I.aim.x); a = assistAngle(p, a); fire = am > 0.45 && !V.build; I.lastAimA = a; }
    else if (l > 0.1) a = Math.atan2(my, mx), I.lastAimA = a;
    else a = I.lastAimA;
    ax = Math.cos(a); ay = Math.sin(a);
    // semi-auto weapons need trigger edges: pulse the trigger while the aim stick is pushed
    if (fire && !WEAPONS[p.wpn].auto) fire = (I.pulse++ % 4) < 2;
  } else {
    const w = screenToWorld(I.mx, I.my);
    ax = w.x - p.x; ay = w.y - p.y;
    fire = I.lmb && !V.build && !modal;
  }
  const crouch = I.crouch || !!K.ControlLeft;
  const use = !modal && (!!K.KeyE || !!I.useHeld);
  return { fire, use, sprint: !!(K.ShiftLeft || K.ShiftRight || I.sprint) && !crouch, crouch, ax, ay, moving: l > 0.1, mx, my };
}
function updateGhost(p) {
  if (!V.build) { V.ghost = null; return; }
  let w;
  if (I.touch) { const a = Math.atan2(p.in.ay, p.in.ax); w = { x: p.x + Math.cos(a) * 1.4, y: p.y + Math.sin(a) * 1.4 }; }
  else w = screenToWorld(I.mx, I.my);
  const cx = Math.floor(w.x), cy = Math.floor(w.y);
  if (!inMap(cx, cy)) { V.ghost = null; return; }
  const cell = idx(cx, cy);
  V.ghost = { cell, ok: canPlace(V.buildSel, cell) && canAfford(STRUCTS[V.buildSel].cost) };
}

// touch controls overlay
function drawTouch(g) {
  const J = I.joy, A = I.aim;
  const jx = J.id !== null ? J.ox : 90, jy = J.id !== null ? J.oy : VIEW_H - 100;
  g.globalAlpha = J.id !== null ? 0.3 : 0.14; g.fillStyle = '#fff'; g.beginPath(); g.arc(jx, jy, JR, 0, TAU); g.fill();
  g.globalAlpha = 0.45; g.beginPath(); g.arc(jx + J.x * JR, jy + J.y * JR, 24, 0, TAU); g.fill();
  const ax = A.id !== null ? A.ox : VIEW_W - 100, ay = A.id !== null ? A.oy : VIEW_H - 100;
  g.globalAlpha = A.id !== null ? 0.3 : 0.14; g.fillStyle = '#ffb3a0'; g.beginPath(); g.arc(ax, ay, JR, 0, TAU); g.fill();
  g.globalAlpha = 0.45; g.beginPath(); g.arc(ax + A.x * JR, ay + A.y * JR, 24, 0, TAU); g.fill();
  g.globalAlpha = 1;
  txt(g, '조준·사격', ax, ay + JR + 14, 'rgba(255,255,255,.4)', 10, 'center', false);
  // action buttons (right column)
  const R = 26, bx = VIEW_W - 34, by0 = VIEW_H - 200;
  const B = [
    ['사용', () => pressUse(), '#ffd166', () => { I.useHeld = true; }],
    ['장전', () => sendCmd({ c: 'reload' })],
    ['수류', () => sendCmd({ c: 'grenade', d: 6 })],
    [V.build ? '설치' : '건설', () => { if (V.build) { if (V.ghost) sendCmd({ c: 'build', t: V.buildSel, cell: V.ghost.cell }); } else V.build = true; }, V.build ? '#7dff9a' : null],
  ];
  B.forEach(([l, fn, c], k) => {
    const x = bx, y = by0 - k * (R * 2 + 8);
    g.globalAlpha = 0.85; g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.arc(x, y, R, 0, TAU); g.fill();
    g.strokeStyle = c || 'rgba(255,255,255,.4)'; g.lineWidth = 2; g.stroke(); g.globalAlpha = 1;
    txt(g, l, x, y + 4, c || '#eee', 11, 'center');
    uiBtn(x - R, y - R, R * 2, R * 2, fn, { hold: k === 0 });
  });
  const B2 = [['먹기', () => sendCmd({ c: 'eat' })], ['치료', () => sendCmd({ c: 'heal' })], [I.crouch ? '은신✓' : '은신', () => { I.crouch = !I.crouch; }], ['달리기' + (I.sprint ? '✓' : ''), () => { I.sprint = !I.sprint; }]];
  if (V.build) { B2.length = 0; B2.push(['철거', () => V.ghost && sendCmd({ c: 'demolish', cell: V.ghost.cell })], ['종료', () => { V.build = false; }]); }
  B2.forEach(([l, fn], k) => {
    const x = bx - R * 2 - 10, y = by0 - k * (R * 2 + 8) - 4;
    g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.arc(x, y, R - 4, 0, TAU); g.fill();
    txt(g, l, x, y + 4, '#ddd', 10, 'center');
    uiBtn(x - R, y - R, R * 2, R * 2, fn);
  });
  // menu / map
  button(g, VIEW_W - 48, 60 + (VIEW_W < 760 ? 18 : 0) + 0, 40, 32, '☰', () => { V.paused = true; }, { size: 16 });
}

// ── synth audio with distance falloff ─────────────────────────────────────
let actx = null, master = null, sfxBudget = 0;
const noiseBufs = {};
function audioUnlock() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); master = actx.createGain(); master.gain.value = 0.8; master.connect(actx.destination); } catch (e) { actx = null; } }
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
}
const SFX = {
  pistol: [900, 0.05, 'square', 0.05], smg: [1000, 0.035, 'square', 0.035], shotgun: [150, 0.14, 'noise', 0.14], rifle: [700, 0.05, 'sawtooth', 0.05],
  sniper: [300, 0.25, 'noise', 0.18], launcher: [200, 0.25, 'sawtooth', 0.07], machete: [400, 0.05, 'noise', 0.03], turret: [1200, 0.03, 'square', 0.025],
  boom: [60, 0.5, 'noise', 0.3], kill: [140, 0.08, 'noise', 0.05], hurt: [120, 0.15, 'square', 0.08], bite: [200, 0.06, 'noise', 0.04],
  pickup: [990, 0.12, 'triangle', 0.07], unlock: [660, 0.35, 'triangle', 0.09], reload: [1500, 0.04, 'square', 0.03], empty: [300, 0.03, 'square', 0.04],
  switch: [700, 0.03, 'square', 0.03], throw: [500, 0.06, 'triangle', 0.05], place: [300, 0.07, 'triangle', 0.06], chop: [180, 0.08, 'noise', 0.07],
  swish: [600, 0.05, 'noise', 0.02], eat: [500, 0.1, 'triangle', 0.05], buy: [1300, 0.1, 'triangle', 0.06], click: [800, 0.02, 'square', 0.02],
  spit: [300, 0.12, 'sawtooth', 0.04], fireball: [180, 0.2, 'sawtooth', 0.05], scream: [900, 0.6, 'sawtooth', 0.06], thud: [90, 0.08, 'noise', 0.07],
  clang: [500, 0.1, 'square', 0.04], beep: [1800, 0.08, 'square', 0.04], alarm: [880, 0.5, 'square', 0.06], horn: [110, 1.2, 'sawtooth', 0.09], over: [220, 1.0, 'sawtooth', 0.08],
};
function sfx(name, x, y) {
  if (!actx || sfxBudget > 8 || !SFX[name]) return;
  let vol = 1;
  const p = G && meP();
  if (p && x !== undefined) { const d = dist(p.x, p.y, x, y); if (d > 28) return; vol = 1 - d / 28; }
  sfxBudget++;
  const [f, d, type, v] = SFX[name], t = actx.currentTime, gn = actx.createGain();
  gn.gain.setValueAtTime(v * vol, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + d); gn.connect(master);
  if (type === 'noise') {
    let buf = noiseBufs[name]; // generated once per sound, reused for every shot
    if (!buf) {
      const len = Math.floor(actx.sampleRate * d), ch = (buf = noiseBufs[name] = actx.createBuffer(1, len, actx.sampleRate)).getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = actx.createBufferSource(), flt = actx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = f * 20;
    src.buffer = buf; src.connect(flt); flt.connect(gn); src.start(t);
  } else {
    const o = actx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.5, t + d);
    o.connect(gn); o.start(t); o.stop(t + d);
  }
}
