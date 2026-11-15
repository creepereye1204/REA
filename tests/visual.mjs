// node tests/visual.mjs  — renders key scenes in headless Chrome and saves PNGs to tests/out/.
// Starts its own static server and browser (low priority) and shuts both down afterwards.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'tests', 'out'); fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png' };
const server = http.createServer((req, res) => { const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0])); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }).listen(0);
const port = server.address().port, dbg = 9400 + Math.floor(Math.random() * 300);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-chrome-'));
const chrome = spawn('nice', ['-n', '15', 'google-chrome', '--headless=new', `--remote-debugging-port=${dbg}`, '--no-sandbox', `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let list; for (let i = 0; i < 60 && !list; i++) { await sleep(250); try { list = await (await fetch(`http://127.0.0.1:${dbg}/json/new?about:blank`, { method: 'PUT' })).json(); } catch (e) { /* not up yet */ } }
const ws = new WebSocket(list.webSocketDebuggerUrl); let id = 0; const pend = {}; const errors = [];
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description); };
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(r => { pend[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result.result ? r.result.result.value : r; };
const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', clip ? { format: 'png', clip: { ...clip, scale: 2 } } : { format: 'png' }); fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); };
try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` }); await sleep(2000);
  await ev('startSolo(); var p=meP(); p.hp=p.maxHp=1e9; G.clock=12*60; for (const w of WEAPON_ORDER) G.stash.owned[w]=1; 1'); await sleep(1500);
  await shot('base');
  await ev('const ks=["walker","walker","runner","crawler","spitter","brute","bloater","screamer","hound","riot","toxic","stalker","goliath","fiend","x13","broodmother"]; for (const e of G.ents) e.dead=true; ks.forEach((k,i)=>{const e=spawnMob(k,p.x-8+(i%6)*3.2,p.y-5.5+Math.floor(i/6)*3,false); e.speed=0.0001; e.angle=Math.PI/2; e.walk=i;}); ["soldier","rebel","bandit_thug","villager","cultist","survivor"].forEach((k,i)=>{const h=spawnHuman(k,p.x-8+i*3.2,p.y+4.5); h.speed=0.0001; h.angle=Math.PI/2;}); 1');
  await sleep(400); await shot('cast'); await shot('cast-zoom', { x: 360, y: 200, width: 560, height: 420 });
  for (const w of ['rifle', 'katana', 'bazooka']) { await ev(`p.wpn="${w}"; 1`); await sleep(150); await shot('player-' + w, { x: 580, y: 330, width: 120, height: 100 }); }
  await ev('G.clock=23*60; G.phase="night"; 1'); await sleep(800); await shot('night');
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true }); await sleep(800); await shot('mobile');
} finally {
  ws.close(); chrome.kill('SIGTERM'); server.close(); setTimeout(() => fs.rmSync(prof, { recursive: true, force: true }), 500);
}
console.log(errors.length ? 'page errors:\n' + errors.join('\n') : 'no page errors', '— screenshots in tests/out/');
process.exit(errors.length ? 1 : 0);
