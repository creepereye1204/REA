'use strict';
// Village job boards: every morning each friendly village posts a couple of jobs.
// fetch = bring supplies · hunt = kill a kind of zombie · clear = empty a site · scout = visit a site

const JOB_FETCH = [['food', 4, 8], ['wood', 15, 30], ['scrap', 10, 20], ['meds', 2, 4], ['fuel', 1, 3], ['parts', 1, 3], ['chem', 2, 3], ['bandage', 3, 6]];
const JOB_HUNT = [['walker', 12, 20], ['runner', 6, 10], ['hound', 6, 10], ['spitter', 4, 6], ['toxic', 3, 5], ['brute', 1, 2], ['stalker', 2, 4], ['riot', 2, 4]];
const MAX_TAKEN = 4;

function boardPos(v) { return { x: v.stall.x - 2, y: v.stall.y - 4 }; }
function postJobs() {
  G.jobs = (G.jobs || []).filter(j => j.taken && !j.done);
  for (const v of W.villages) {
    if (G.vh[v.id] > 0) continue;
    for (let k = 0; k < 2; k++) {
      const r = SR.f(), id = G.nextId++, base = { id, v: v.id, taken: false, done: false, have: 0 };
      let j;
      if (r < 0.35) { const [item, a, b] = SR.pick(JOB_FETCH); j = { ...base, k: 'fetch', item, n: a + SR.i(b - a + 1) }; j.reward = Math.round(priceOf(j.item) * j.n * 1.6 + 20); }
      else if (r < 0.65) { const ok = JOB_HUNT.filter(h => MOBS[h[0]].minNight <= Math.max(1, G.day)); const [kind, a, b] = SR.pick(ok); j = { ...base, k: 'hunt', kind, n: a + SR.i(b - a + 1) }; j.reward = Math.round(MOBS[kind].hp / 6 * j.n + 30); }
      else {
        const sites = W.pois.filter(P => P.generic && dist(P.x, P.y, v.x, v.y) < 260);
        if (!sites.length) continue;
        const P = SR.pick(sites);
        j = r < 0.85 ? { ...base, k: 'clear', poi: P.id, reward: 120 + G.day * 10 } : { ...base, k: 'scout', poi: P.id, reward: 60 };
      }
      G.jobs.push(j);
    }
  }
}
function jobText(j) {
  const P = j.poi !== undefined ? W.pois[j.poi] : null;
  switch (j.k) {
    case 'fetch': return `물자 요청: ${itemName(j.item)} ${j.n}개 전달`;
    case 'hunt': return `사냥: ${MOBS[j.kind].name} ${j.n}마리 처치 (${Math.min(j.have, j.n)}/${j.n})`;
    case 'clear': return `소탕: ${P.name}의 좀비 전멸시키기`;
    case 'scout': return `정찰: ${P.name}에 다녀오기`;
  }
  return '';
}
function jobTarget(j) { const P = j.poi !== undefined ? W.pois[j.poi] : null; return P ? { x: P.x + P.w / 2, y: P.y + P.h / 2 } : j.k === 'fetch' || j.ready ? boardPos(W.villages[j.v]) : null; }
function jobReady(j) { return j.k === 'fetch' ? (G.stash[j.item] || 0) >= j.n : j.ready; }
// kill tracking and site checks (host)
function jobsOnKill(e, src) {
  if (!G.jobs || !src || src.team !== 'player' || e.cat !== 'mob') return;
  for (const j of G.jobs) if (j.taken && !j.done && j.k === 'hunt' && j.kind === e.kind && ++j.have >= j.n && !j.ready) { j.ready = true; say(`의뢰 완료 조건 달성 — ${W.villages[j.v].name} 게시판에 보고하세요`, '#9fe6a0', -1); }
}
function jobsTick() {
  if (!G.jobs) return;
  for (const j of G.jobs) {
    if (!j.taken || j.done || j.ready) continue;
    const P = j.poi !== undefined ? W.pois[j.poi] : null;
    if (j.k === 'scout' && G.players.some(p => p && p.joined && !p.dead && inRect(p.x, p.y, P))) { j.ready = true; say(`${P.name} 정찰 완료 — 게시판에 보고하세요`, '#9fe6a0', -1); }
    if (j.k === 'clear' && G.players.some(p => p && p.joined && !p.dead && inRect(p.x, p.y, P, 6))) {
      let left = 0; for (const e of everyone()) if (e.cat === 'mob' && !e.dead && e.home && inRect(e.home.x, e.home.y, P)) left++;
      j.left = left;
      if (!left) { j.ready = true; say(`${P.name} 소탕 완료 — 게시판에 보고하세요`, '#9fe6a0', -1); }
    }
  }
}
function jobCmd(p, c) {
  const j = (G.jobs || []).find(q => q.id === c.id); if (!j) return;
  const v = W.villages[j.v];
  if (G.vh[v.id] > 0 || dist(p.x, p.y, boardPos(v).x, boardPos(v).y) > 4) return;
  if (c.a === 'take' && !j.taken) {
    if (G.jobs.filter(q => q.taken && !q.done).length >= MAX_TAKEN) { say(`의뢰는 동시에 ${MAX_TAKEN}개까지 받을 수 있습니다`, '#ff9a8a', p.pid); return; }
    j.taken = true; say('의뢰 수락: ' + jobText(j), '#cfe8ff', p.pid); sfxAt('click', p.x, p.y);
  } else if (c.a === 'turnin' && j.taken && !j.done && jobReady(j)) {
    if (j.k === 'fetch') G.stash[j.item] -= j.n;
    xpAll(45);
    j.done = true; G.stash.cash += j.reward;
    if (G.Q && j.v < G.Q.rep.length) { G.Q.rep[j.v] = Math.min(5, (G.Q.rep[j.v] || 0) + 1); qBump(); }
    const bonus = SR.pick(['meds', 'grenade', 'bandage', 'molotov', 'adrenaline', 'mag:rifle', 'mag:shotgun']); giveItem(bonus, 1, p.pid);
    say(`의뢰 보상: $${j.reward} + ${itemName(bonus)}${j.v < 4 ? ' · 마을 신뢰도 상승' : ''}`, '#ffd166', -1, 1); sfxAt('buy', p.x, p.y);
  }
}
function drawJobs(g) {
  const v = W.villages[V.panel.v], me = meP();
  const b = panelBox(g, 620, 470, `${v.name} — 의뢰 게시판`);
  const list = (G.jobs || []).filter(j => j.v === v.id && !j.done);
  const taken = (G.jobs || []).filter(j => j.taken && !j.done);
  txt(g, `진행 중 ${taken.length}/${MAX_TAKEN} · 매일 아침 새 의뢰가 붙습니다`, b.x + 20, b.y + 52, '#aaa', 11, 'left', false);
  if (!list.length) txt(g, '지금은 붙어 있는 의뢰가 없습니다.', b.x + 20, b.y + 90, '#ccc', 13);
  list.slice(0, 6).forEach((j, k) => {
    const y = b.y + 68 + k * 58;
    g.fillStyle = 'rgba(255,255,255,.05)'; roundRect(g, b.x + 14, y, b.w - 28, 50, 6); g.fill();
    txt(g, jobText(j), b.x + 26, y + 21, j.taken ? '#ffd166' : '#eee', 13);
    txt(g, `보상 $${j.reward} + 물자${j.v < 4 ? ' · 신뢰도 +1' : ''}${j.k === 'clear' && j.left !== undefined ? ` · 남은 좀비 ${j.left}` : ''}`, b.x + 26, y + 40, '#9fe6a0', 11, 'left', false);
    const bx = b.x + b.w - 130;
    if (!j.taken) button(g, bx, y + 9, 104, 32, '수락', () => sendCmd({ c: 'job', a: 'take', id: j.id }));
    else if (jobReady(j)) button(g, bx, y + 9, 104, 32, '보고하기', () => sendCmd({ c: 'job', a: 'turnin', id: j.id }), { color: '#7dff9a' });
    else txt(g, '진행 중', bx + 52, y + 30, '#888', 12, 'center');
  });
  button(g, b.x + b.w / 2 - 60, b.y + b.h - 50, 120, 36, '닫기', () => { V.panel = null; });
  if (me && dist(me.x, me.y, boardPos(v).x, boardPos(v).y) > 4) V.panel = null;
}
// a notice board in each village square
function drawBoard(g, v) {
  const p = boardPos(v), x = p.x * TILE, y = p.y * TILE;
  g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x - 16, y + 6, 34, 6);
  g.fillStyle = '#4a3420'; g.fillRect(x - 13, y - 6, 4, 14); g.fillRect(x + 9, y - 6, 4, 14);
  g.fillStyle = '#7a5a34'; g.fillRect(x - 16, y - 30, 32, 26); g.strokeStyle = '#3a2814'; g.lineWidth = 2; g.strokeRect(x - 16, y - 30, 32, 26);
  g.fillStyle = '#e8e0c8'; g.fillRect(x - 12, y - 26, 10, 12); g.fillRect(x + 1, y - 24, 11, 9); g.fillStyle = '#d8c8a0'; g.fillRect(x - 6, y - 13, 12, 7);
  const n = (G.jobs || []).filter(j => j.v === v.id && !j.done && (!j.taken || jobReady(j))).length;
  if (n && G.vh[v.id] <= 0) { g.font = 'bold 18px system-ui'; g.textAlign = 'center'; g.fillStyle = '#000'; g.fillText('!', x + 1, y - 35 + Math.sin(V.frame / 9) * 2); g.fillStyle = '#ffd166'; g.fillText('!', x, y - 36 + Math.sin(V.frame / 9) * 2); }
}
