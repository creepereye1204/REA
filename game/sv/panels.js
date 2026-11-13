'use strict';
// Story UI: quest tracker & waypoint, radio transmissions, boss cards, dialogue, journal, crafting, endings.

// ── quest helpers for display ────────────────────────────────────────────
function npcMarker(key) {
  const Q = G.Q; if (!Q) return '';
  for (const id of activeQuests()) {
    const o = QUESTS[id].obj;
    if ((o.t === 'deliver' && o.to === key && hasItems(o.items)) || (o.t === 'talk' && o.to === key)) return '?';
  }
  if (key.startsWith('elder')) {
    const cur = Q.lines['v' + key[5]];
    if (cur && !Q.active[cur]) return '!';
    if (Q.lines.community === 'k1') return '!';
  }
  return '';
}
function spawnPos(tag) { const s = W.npcSpawns.find(q => q.tag === tag); return s ? { x: s.x, y: s.y } : null; }
function npcPos(key) {
  if (key === 'radio') return G.radio ? { x: G.radio.x, y: G.radio.y } : null;
  const e = G.ents.find(q => npcKeyOf(q) === key && !q.dead);
  if (e) return { x: e.x, y: e.y };
  if (key.startsWith('elder')) { const v = W.villages[+key[5]]; return v && v.stall; }
  return spawnPos(key);
}
function poiCenter(key) { const P = poiOf(key); return P ? { x: P.x + P.w / 2, y: P.y + P.h / 2 } : null; }
function questTarget(id) {
  const q = QUESTS[id], o = q.obj;
  switch (o.t) {
    case 'deliver': {
      if (!hasItems(o.items) && id === 'm1') {
        const p = meP(); let best = null, bd = 1e9;
        for (const b of W.buildings) if ((b.type === 'police' || b.type === 'garage' || b.type === 'office') && b.village < 0) { const d = dist(p.x, p.y, b.x + b.w / 2, b.y + b.h / 2); if (d < bd) { bd = d; best = { x: b.x + b.w / 2, y: b.y + b.h / 2 }; } }
        return best;
      }
      if (!hasItems(o.items) && q.poi) return poiCenter(q.poi);
      return npcPos(o.to);
    }
    case 'talk': return npcPos(o.to);
    case 'use': case 'defend': { const tr = W.triggers.find(t => t.kind === o.trig); return tr && { x: tr.x, y: tr.y }; }
    case 'goto': return poiCenter(o.poi);
    case 'have': return q.poi ? poiCenter(q.poi) : null;
    case 'killTag': {
      for (const t of o.tags) if (!G.Q.flags['dead_' + t]) {
        const e = G.ents.find(q2 => q2.tag === t); if (e) return { x: e.x, y: e.y };
        if (t.startsWith('camp')) { const c = W.camps[+t[4]]; return c && { x: c.x + c.w / 2, y: c.y + c.h / 2 }; }
        return spawnPos(t) || (q.poi && poiCenter(q.poi));
      }
      return null;
    }
    case 'kill': return q.poi ? poiCenter(q.poi) : o.kinds.includes('hound') ? poiCenter('farm') : null;
    case 'escort': {
      const e = G.ents.find(q2 => q2.tag === o.tag);
      if (!e || e.mode === 'wait') return e ? { x: e.x, y: e.y } : spawnPos(o.tag);
      if (o.to === 'base') return { x: W.base.cx, y: W.base.cy };
      if (o.to[0] === 'v') { const v = W.villages[+o.to[1]]; return v && v.stall; }
      return poiCenter(o.to);
    }
    case 'survive': case 'crew': return { x: W.base.cx, y: W.base.cy };
  }
  return null;
}
function questProgress(id) {
  const q = QUESTS[id], o = q.obj;
  switch (o.t) {
    case 'deliver': return Object.entries(o.items).map(([k, v]) => `${itemName(k)} ${Math.min(countItem(k), v)}/${v}`).join(' · ') + ` → ${CAST[o.to].name.split(' (')[0]}`;
    case 'kill': return `처치 ${G.Q.prog[id] || 0}/${o.n}`;
    case 'killTag': return o.tags.map(t => `${t.startsWith('camp') ? CAMP_BOSSES[+t[4]] : (MOBS[t] || {}).name || CAST[t]?.name || t} ${G.Q.flags['dead_' + t] ? '✔' : '✗'}`).join(' · ');
    case 'have': return Object.keys(o.items).map(k => `${itemName(k)} 찾기`).join(', ');
    case 'escort': { const e = G.ents.find(q2 => q2.tag === o.tag); return !e || e.mode === 'wait' ? `${CAST[o.tag].name} 구출하기` : `${CAST[o.tag].name} 호위 중`; }
    case 'defend': return G.Q.ev && G.Q.ev.id === id ? `버티기 ${Math.ceil(G.Q.ev.t)}초` : '제어 지점에서 [E] 길게 누르기';
    case 'use': return '지점에서 [E] 길게 누르기';
    case 'talk': return `${CAST[o.to].name}와 대화`;
    case 'survive': return `밤 ${Math.max(0, G.nightN - (G.Q.prog[id] || 0))}/${o.n} 버티기`;
    case 'crew': return `동료 ${G.ents.filter(e => e.kind === 'survivor' && e.mode !== 'wait').length}/${o.n} · 마을 대표와 대화`;
    case 'goto': return `${poiOf(o.poi)?.name || ''}로 이동`;
  }
  return '';
}
function trackedQuests() {
  const ids = activeQuests();
  const order = l => ({ main: 0, cure: 1, evac: 2, community: 3 }[l] ?? 4);
  ids.sort((a, b) => order(QUESTS[a].line) - order(QUESTS[b].line));
  if (V.track && ids.includes(V.track)) { ids.splice(ids.indexOf(V.track), 1); ids.unshift(V.track); }
  return ids;
}

// ── HUD pieces ───────────────────────────────────────────────────────────
function drawQuestHud(g, x, y, w) {
  if (!G.Q) return;
  const ids = trackedQuests().slice(0, I.touch ? 2 : 3);
  if (!ids.length) return;
  const small = VIEW_W < 760;
  g.fillStyle = 'rgba(0,0,0,.45)'; roundRect(g, x, y, w, 10 + ids.length * 34, 8); g.fill();
  ids.forEach((id, k) => {
    const q = QUESTS[id], yy = y + 18 + k * 34;
    txt(g, (k === 0 ? '◆ ' : '◇ ') + q.title, x + 8, yy, k === 0 ? '#ffd166' : '#e8d8a8', small ? 11 : 12);
    g.font = `${small ? 10 : 11}px ${FONT}`;
    let pr = questProgress(id); while (g.measureText(pr).width > w - 20 && pr.length > 4) pr = pr.slice(0, -2);
    txt(g, pr, x + 18, yy + 15, '#bbb', small ? 10 : 11, 'left', false);
  });
  uiBtn(x, y, w, 10 + ids.length * 34, () => { V.panel = { k: 'journal', tab: 0 }; });
  // defence bar
  const ev = G.Q.ev;
  if (ev) {
    const bw = Math.min(360, VIEW_W - 40), bx = (VIEW_W - bw) / 2, by = 58;
    g.fillStyle = 'rgba(0,0,0,.65)'; roundRect(g, bx - 6, by - 4, bw + 12, 26, 6); g.fill();
    g.fillStyle = '#5a1a10'; g.fillRect(bx, by + 6, bw, 10);
    g.fillStyle = '#ffd166'; g.fillRect(bx, by + 6, bw * (1 - ev.t / ev.total), 10);
    txt(g, `${QUESTS[ev.id].title} — ${Math.ceil(ev.t)}초 버티기`, VIEW_W / 2, by + 3, '#fff', 11, 'center');
  }
}
function questArrow(g, arrow) {
  const ids = trackedQuests(); if (!ids.length) return;
  const t = questTarget(ids[0]); if (!t) return;
  arrow(t.x, t.y, '#ffd166', '◆');
}
// radio / dialogue lines that play over the game
function drawComm(g) {
  if (!V.comm.length) return;
  const [who, text] = V.comm[0], c = CAST[who] || CAST.radio;
  const dur = Math.max(4, text.length / 11);
  V.commT += V.dt || 0.016;
  if (V.commT > dur) { V.comm.shift(); V.commT = 0; return; }
  const w = Math.min(620, VIEW_W - 16), x = (VIEW_W - w) / 2, ps = I.touch ? 70 : 64;
  const y = I.touch ? VIEW_H - 330 : VIEW_H - 160 - (V.build ? 60 : 0);
  g.font = `13px ${FONT}`;
  const lines = wrapLines2(g, text, w - ps - 30);
  const h = Math.max(ps + 16, 34 + lines.length * 18);
  g.globalAlpha = Math.min(1, V.commT * 4, (dur - V.commT) * 3);
  g.fillStyle = 'rgba(10,12,16,.88)'; roundRect(g, x, y, w, h, 8); g.fill();
  g.strokeStyle = who === 'you' ? 'rgba(255,255,255,.25)' : 'rgba(125,255,154,.45)'; g.lineWidth = 1.5; g.stroke();
  if (c.por) drawPortrait(g, c.por, x + 8, y + 8, ps); else { g.fillStyle = '#1a2a1a'; g.fillRect(x + 8, y + 8, ps, ps); txt(g, who === 'you' ? '💭' : '📻', x + 8 + ps / 2, y + 8 + ps / 2 + 8, '#7dff9a', 26, 'center'); }
  txt(g, c.name + (V.comm.length > 1 ? `  (${V.comm.length - 1}개 더)` : ''), x + ps + 20, y + 22, who === 'you' ? '#ddd' : '#7dff9a', 12);
  lines.forEach((l, i) => txt(g, l, x + ps + 20, y + 42 + i * 18, '#eee', 13, 'left', false));
  g.globalAlpha = 1;
  uiBtn(x, y, w, h, () => { V.comm.shift(); V.commT = 0; });
}
function wrapLines2(g, text, maxW) { // Korean-friendly wrap (falls back to per-character breaks)
  const out = []; let line = '';
  for (const word of text.split(' ')) {
    const t = line ? line + ' ' + word : word;
    if (g.measureText(t).width <= maxW) { line = t; continue; }
    if (line) out.push(line);
    line = word;
    while (g.measureText(line).width > maxW) { let k = line.length; while (k > 1 && g.measureText(line.slice(0, k)).width > maxW) k--; out.push(line.slice(0, k)); line = line.slice(k); }
  }
  if (line) out.push(line);
  return out;
}
function drawBossCard(g) {
  const B = V.boss; if (!B) return;
  B.t -= V.dt || 0.016; if (B.t <= 0) { V.boss = null; return; }
  const a = Math.min(1, (4.5 - B.t) * 3, B.t * 2), s = Math.min(170, VIEW_W * 0.32), x = VIEW_W / 2 - s / 2, y = VIEW_H * 0.16;
  g.globalAlpha = a;
  g.fillStyle = 'rgba(40,0,0,.75)'; roundRect(g, x - 20, y - 34, s + 40, s + 84, 10); g.fill();
  txt(g, '⚠ 보스 출현', VIEW_W / 2, y - 12, '#ff5c4c', 15, 'center');
  drawPortrait(g, B.por, x, y, s);
  g.strokeStyle = '#ff5c4c'; g.lineWidth = 2; g.strokeRect(x, y, s, s);
  txt(g, B.name, VIEW_W / 2, y + s + 30, '#ffd166', 20, 'center');
  g.globalAlpha = 1;
}
function drawEnding(g) {
  const E = V.ending; if (!E) return;
  E.t += V.dt || 0.016;
  const D = ENDINGS[E.key];
  g.globalAlpha = Math.min(1, E.t / 1.5);
  g.fillStyle = '#05060a'; g.fillRect(0, 0, VIEW_W, VIEW_H);
  uiBtn(0, 0, VIEW_W, VIEW_H, null, { block: true });
  const img = sceneImg(D.scene);
  const iw = Math.min(VIEW_W - 24, 960), ih = iw * 9 / 16, ix = (VIEW_W - iw) / 2, iy = Math.max(12, VIEW_H * 0.06);
  if (img) g.drawImage(img, ix, iy, iw, ih); else { g.fillStyle = '#1a1c24'; g.fillRect(ix, iy, iw, ih); }
  const gr = g.createLinearGradient(0, iy + ih * 0.6, 0, iy + ih); gr.addColorStop(0, 'rgba(5,6,10,0)'); gr.addColorStop(1, 'rgba(5,6,10,1)');
  g.fillStyle = gr; g.fillRect(ix, iy + ih * 0.6, iw, ih * 0.4 + 1);
  let y = iy + ih + 10;
  txt(g, '— 엔딩 —', VIEW_W / 2, y, '#aaa', 12, 'center'); y += 34;
  txt(g, D.title, VIEW_W / 2, y, '#ffd166', VIEW_W < 700 ? 24 : 30, 'center'); y += 30;
  g.font = `14px ${FONT}`;
  for (const l of wrapLines2(g, D.text, Math.min(760, VIEW_W - 40))) { txt(g, l, VIEW_W / 2, y, '#ddd', 14, 'center', false); y += 22; }
  y += 6;
  txt(g, `${G.day}일차 · 처치 ${G.kills} · 완료한 임무 ${G.Q.done.length} · 기록 ${G.Q.notes.length}/${NOTES.length}`, VIEW_W / 2, y, '#9fd0ff', 12, 'center'); y += 20;
  g.globalAlpha = 1;
  if (E.t > 2) {
    const bw = Math.min(220, (VIEW_W - 40) / 2 - 8);
    button(g, VIEW_W / 2 - bw - 8, Math.min(y, VIEW_H - 60), bw, 42, '계속 생존하기', () => { V.ending = null; if (NET.role !== 'client') G.Q.endingSeen = 1; }, { size: 14 });
    button(g, VIEW_W / 2 + 8, Math.min(y, VIEW_H - 60), bw, 42, '타이틀로', () => { V.ending = null; quitToTitle(); }, { size: 14 });
  }
}

// ── dialogue panel ───────────────────────────────────────────────────────
function drawTalk(g) {
  const P = V.panel, p = meP();
  const pos = npcPos(P.npc);
  if (!pos || dist(pos.x, pos.y, p.x, p.y) > 4) { V.panel = null; return; }
  const c = CAST[P.npc];
  const T = talkOptions(P.npc);
  const b = panelBox(g, 760, 440, c.name);
  const ps = Math.min(200, b.w * 0.3);
  if (c.por) drawPortrait(g, c.por, b.x + 16, b.y + 48, ps); else { g.fillStyle = '#1a2a1a'; g.fillRect(b.x + 16, b.y + 48, ps, ps); txt(g, '📻', b.x + 16 + ps / 2, b.y + 48 + ps / 2 + 14, '#7dff9a', 44, 'center'); }
  const tx = b.x + ps + 34, tw = b.w - ps - 50;
  let y = b.y + 64;
  g.font = `14px ${FONT}`;
  for (const l of T.lines) for (const w of wrapLines2(g, l, tw)) { if (y < b.y + b.h - 70) txt(g, w, tx, y, l.startsWith('[') ? '#ffe9a8' : l.startsWith('(') ? '#9fd0ff' : '#ddd', 14, 'left', false); y += 21; }
  const acts = T.acts;
  const bw = Math.min(200, (b.w - 32) / Math.max(1, acts.length) - 8);
  acts.forEach((a, k) => {
    button(g, b.x + b.w - 16 - (acts.length - k) * (bw + 8), b.y + b.h - 56, bw, 42, a.label, () => {
      if (a.a === 'shop') { const e = G.ents.find(q => npcKeyOf(q) === P.npc); if (e) { V.panel = { k: 'shop', npc: e.id }; V.shopScroll = 0; } return; }
      sendCmd({ c: 'q', a: a.a, id: a.id });
    }, { disabled: !a.ok, size: 13 });
  });
}

// ── journal ──────────────────────────────────────────────────────────────
function drawJournal(g) {
  const P = V.panel;
  const b = panelBox(g, 880, 620, '일지');
  const tabs = ['임무', `기록 ${G.Q.notes.length}/${NOTES.length}`];
  tabs.forEach((t, k) => button(g, b.x + 110 + k * 130, b.y + 10, 120, 30, t, () => { P.tab = k; P.sel = null; }, { color: P.tab === k ? '#ffd166' : null, size: 12 }));
  const x0 = b.x + 18, w = b.w - 36;
  let y = b.y + 66;
  g.font = `13px ${FONT}`;
  if (P.tab === 0) {
    const ids = trackedQuests();
    if (!ids.length) txt(g, '진행 중인 임무가 없습니다. 마을 대표(!)에게 말을 걸어 보세요.', x0, y, '#aaa', 13, 'left', false);
    for (const id of ids) {
      const q = QUESTS[id];
      if (y > b.y + b.h - 120) break;
      const tracked = trackedQuests()[0] === id;
      txt(g, (tracked ? '◆ ' : '◇ ') + q.title, x0, y, tracked ? '#ffd166' : '#e8d8a8', 14);
      button(g, x0 + w - 90, y - 16, 86, 22, tracked ? '추적 중' : '추적', () => { V.track = id; }, { disabled: tracked, size: 11 });
      y += 20;
      for (const l of wrapLines2(g, q.desc, w - 20)) { txt(g, l, x0 + 16, y, '#ccc', 12, 'left', false); y += 17; }
      txt(g, '→ ' + questProgress(id), x0 + 16, y, '#9fd0ff', 12, 'left', false); y += 26;
    }
    const done = G.Q.done.map(id => QUESTS[id].title);
    if (done.length && y < b.y + b.h - 40) {
      txt(g, `완료한 임무 ${done.length}`, x0, y, '#7dff9a', 13); y += 18;
      for (const l of wrapLines2(g, done.join(' · '), w)) { if (y > b.y + b.h - 14) break; txt(g, l, x0, y, '#8a9a8a', 11, 'left', false); y += 16; }
    }
    const rep = G.Q.rep.map((r, v) => `${W.villages[v] ? W.villages[v].name : ''} ${r}`).join(' · ');
    txt(g, '마을 신뢰도: ' + rep, x0, b.y + b.h - 12, '#9fd0ff', 11, 'left', false);
  } else {
    const lw = Math.min(280, w * 0.38), list = G.Q.notes;
    if (!list.length) txt(g, '아직 발견한 기록이 없습니다. 서랍·책상·사물함을 뒤지면 가끔 나옵니다.', x0, y, '#aaa', 13, 'left', false);
    list.forEach((n, k) => {
      const yy = y - 14 + k * 28; if (yy > b.y + b.h - 40) return;
      const sel = P.sel === n;
      g.fillStyle = sel ? 'rgba(255,209,102,.18)' : 'rgba(255,255,255,.04)'; g.fillRect(x0, yy, lw, 24);
      drawIcon(g, NOTES[n][0].startsWith('녹음') ? 'tape' : 'note', x0 + 13, yy + 12, 22);
      txt(g, NOTES[n][0], x0 + 28, yy + 17, sel ? '#ffd166' : '#ddd', 12, 'left', false);
      uiBtn(x0, yy, lw, 24, () => { P.sel = n; });
    });
    if (P.sel !== null && P.sel !== undefined) {
      const rx = x0 + lw + 20, rw = w - lw - 20;
      g.fillStyle = 'rgba(232,220,190,.08)'; g.fillRect(rx, y - 18, rw, b.h - 100);
      txt(g, NOTES[P.sel][0], rx + 14, y + 6, '#ffe9a8', 15); let yy = y + 34;
      g.font = `14px ${FONT}`;
      for (const l of wrapLines2(g, NOTES[P.sel][1], rw - 28)) { txt(g, l, rx + 14, yy, '#e8e0d0', 14, 'left', false); yy += 22; }
    }
  }
}

// ── workbench crafting tab ───────────────────────────────────────────────
function drawCraft(g, b) {
  const S = G.stash, rh = 58, x0 = b.x + 18;
  RECIPES.forEach((r, k) => {
    const y = b.y + 56 + k * rh, ok = canAfford(r.cost);
    g.fillStyle = 'rgba(255,255,255,.04)'; g.fillRect(x0 - 6, y, b.w - 24, rh - 6);
    drawIcon(g, itemIcon(r.id), x0 + 22, y + 26, 44);
    txt(g, `${itemName(r.id)} ×${r.n}`, x0 + 56, y + 22, '#fff', 14);
    txt(g, `보유 ${countItem(r.id)}`, x0 + 56, y + 40, '#999', 11, 'left', false);
    let cx = x0 + 230;
    for (const [k2, v] of Object.entries(r.cost)) {
      drawIcon(g, itemIcon(k2), cx + 12, y + 26, 26);
      txt(g, `${v}`, cx + 28, y + 24, countItem(k2) >= v ? '#ddd' : '#ff8a7a', 13);
      txt(g, `(${countItem(k2)})`, cx + 28, y + 40, '#888', 10, 'left', false);
      cx += 92;
    }
    button(g, b.x + b.w - 120, y + 10, 96, 34, '제작', () => sendCmd({ c: 'craft', id: r.id }), { disabled: !ok, size: 13 });
  });
  txt(g, '재료: 화학약품(병원·연구소 냉장고), 전자부품(공구함·책상·차량), 연료(주유기·차량)', x0, b.y + b.h - 14, '#888', 11, 'left', false);
}
