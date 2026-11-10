'use strict';
// Boot, game modes and the fixed-step loop.

function localMove(p, inp) {
  if (p.down || p.dead || G.over) { p.in.moving = false; return; }
  const sprint = inp.sprint && p.stamina > 4 && inp.moving;
  const sp = 4.4 * (sprint ? 1.55 : 1) * (inp.crouch ? 0.55 : 1);
  if (inp.moving) { moveActor(p, inp.mx * sp * DT, inp.my * sp * DT); if (NET.role === 'client') p.walk += 0.25; }
}

function step() {
  if (!G || !G.core) return;
  const p = meP();
  const inp = sampleInput(p);
  if (!(V.paused && NET.role === 'solo')) {
    localMove(p, inp);
    p.in = { fire: inp.fire, use: inp.use, sprint: inp.sprint, crouch: inp.crouch, ax: inp.ax, ay: inp.ay, moving: inp.moving };
    if (NET.role === 'client') {
      p.angle = Math.atan2(inp.ay, inp.ax);
      if (G.tick % 2 === 0 || inp.fire !== V.lastFire) netSend({ k: 'in', x: p.x, y: p.y, in: p.in });
      V.lastFire = inp.fire;
      G.tick++;
      clientSmooth();
      if (G.tick % 100 === 0) netSend({ k: 'ping', t: performance.now() });
    } else {
      simTick();
      if (NET.role === 'host' && NET.connected && G.tick % 3 === 0) { netSend(encodeSnap(1)); G.fxOut = []; }
      else if (NET.role !== 'host' || !NET.connected) G.fxOut = [];
    }
    updateGhost(p);
    if (G.over && !V.savedBest) { V.savedBest = true; try { if (G.over.day > bestDays()) localStorage.setItem('nightfall.best', String(G.over.day)); } catch (e) { /* private mode */ } }
  }
}

function startGame() {
  V.camInit = false; V.parts = []; V.tracers = []; V.floaters = []; V.msgs = []; V.panel = null; V.build = false; V.paused = false; V.savedBest = false;
  V.chunks.clear(); V.mini = null; V.roofA = [];
}
function startSolo() {
  netClose(); NET.role = 'solo';
  newGame((Math.random() * 2 ** 31) | 0);
  G.tileDiff = {};
  addPlayer(0); V.me = 0;
  startGame();
  say('1일차 — 낮 동안 물자를 모으고, 밤이 오기 전에 기지로 돌아오세요. (F1 도움말)', '#ffe9a8', -1, 1);
  if (I.touch) say('왼쪽 엄지 이동 · 오른쪽 엄지 조준/사격 · 노란 버튼 = 사용', '#ccc');
}
async function startHost() {
  V.titleMsg = '방을 여는 중…';
  netClose();
  newGame((Math.random() * 2 ** 31) | 0);
  G.tileDiff = {};
  addPlayer(0); V.me = 0;
  try {
    NET.role = 'host';
    await hostOpen();
    startGame();
    V.titleMsg = '';
    say(`방 코드 ${NET.code} — 친구에게 알려주세요. 친구는 "참가하기"에서 코드를 입력합니다.`, '#8fd3ff', -1, 1);
    try { navigator.clipboard.writeText(NET.code).catch(() => {}); } catch (e) { /* ignore */ }
  } catch (e) {
    G = null; NET.role = 'solo';
    V.titleMsg = '방 만들기 실패: ' + (e.message || e.type || e);
  }
}
async function startJoin() {
  const code = prompt('친구의 방 코드 (5자리)를 입력하세요');
  if (!code) return;
  V.titleMsg = '연결 중…';
  netClose();
  try {
    NET.role = 'client';
    await joinRoom(code);
    startGame();
    V.titleMsg = '';
    say('참가 완료! 자원·건물은 호스트와 공유됩니다.', '#7dff9a', -1, 1);
  } catch (e) {
    G = null; netClose();
    V.titleMsg = '참가 실패: ' + (e.message || e);
  }
}
function quitToTitle() { netClose(); G = null; V.paused = false; V.panel = null; V.mapOpen = false; V.help = false; }

let acc = 0, last = 0;
function frame(ts) {
  const now = ts / 1000, dt = Math.min(0.1, now - (last || now)); last = now;
  acc += dt;
  let n = 0;
  while (acc >= DT && n < 6) { step(); acc -= DT; n++; }
  if (n >= 6) acc = 0;
  sfxBudget = 0;
  if (G && !G.core) { ctx.setTransform(RS, 0, 0, RS, 0, 0); ctx.fillStyle = '#0d0e11'; ctx.fillRect(0, 0, VIEW_W, VIEW_H); txt(ctx, '월드 동기화 중…', VIEW_W / 2, VIEW_H / 2, '#ccc', 16, 'center'); }
  else draw(dt);
  requestAnimationFrame(frame);
}

// Background tabs stop rAF; a worker timer keeps the host simulating so the guest isn't frozen.
let bgLast = 0;
function startBgTicker() {
  try {
    const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 40)'], { type: 'text/javascript' })));
    w.onmessage = () => {
      if (!document.hidden || NET.role !== 'host' || !G) { bgLast = 0; return; }
      const now = performance.now() / 1000;
      if (!bgLast) bgLast = now;
      let n = Math.min(25, Math.floor((now - bgLast) / DT));
      bgLast += n * DT;
      while (n-- > 0) step();
    };
  } catch (e) { /* workers unavailable */ }
}

function isMobile() { return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || innerWidth < 760; }
function resize() {
  const mobile = isMobile() || I.touch;
  document.body.classList.toggle('mobile', mobile);
  let cssW, cssH;
  if (mobile) {
    cssW = innerWidth; cssH = innerHeight;
    const k = 600 / Math.min(cssW, cssH);
    VIEW_W = Math.round(cssW * k); VIEW_H = Math.round(cssH * k);
  } else {
    cssW = innerWidth; cssH = innerHeight;
    VIEW_W = Math.round(clamp(cssW, 800, 1600)); VIEW_H = Math.round(VIEW_W * cssH / cssW);
    if (VIEW_H < 560) { VIEW_H = 560; VIEW_W = Math.round(560 * cssW / cssH); }
  }
  const dpr = window.devicePixelRatio || 1;
  RS = clamp(Math.min(cssW / VIEW_W, cssH / VIEW_H) * dpr, 0.75, 3);
  canvas.width = Math.round(VIEW_W * RS); canvas.height = Math.round(VIEW_H * RS);
}
function goFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !document.body.classList.contains('mobile')) return;
  try { const r = (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' }); if (r && r.catch) r.catch(() => {}); } catch (e) { /* iOS */ }
}
function boot() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');
  I.touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  resize();
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 200));
  bindInput();
  startBgTicker();
  requestAnimationFrame(frame);
}
if (typeof window !== 'undefined' && !window.__HEADLESS__) window.addEventListener('load', boot);
