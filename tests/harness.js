'use strict';
// Headless test harness: loads the game scripts listed in index.html into a VM sandbox with a
// fake canvas, so the real simulation and renderer run without a browser.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SCRIPTS = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<script src="(game\/sv\/[^"]+)"/g)].map(m => m[1]);

function makeGame() {
  const grad = { addColorStop() {} };
  const ctx2d = new Proxy({}, { get: (t, k) => t[k] !== undefined ? t[k] : (k === 'measureText' ? () => ({ width: 10 }) : (k === 'createRadialGradient' || k === 'createLinearGradient' || k === 'createPattern') ? () => grad : k === 'createImageData' ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : k === 'getImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : () => {}), set: (t, k, v) => (t[k] = v, true) });
  const mkCanvas = () => ({ width: 960, height: 640, style: {}, getContext: () => ctx2d, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 640 }) });
  const canvasEl = mkCanvas(), store = {};
  const sb = {
    window: { __HEADLESS__: true, addEventListener() {} },
    document: { createElement: () => mkCanvas(), getElementById: () => canvasEl, addEventListener() {}, head: { appendChild() {} }, body: { classList: { toggle() {}, contains() { return false; } } } },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    addEventListener() {}, requestAnimationFrame() {}, performance: { now: () => Date.now() }, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, navigator: {},
    console, Math, Date, JSON, Map, Set, Array, Object, Number, String, Uint8Array, Int16Array, Int32Array, Float32Array, Uint8ClampedArray, Infinity, isFinite, parseInt, Proxy, Promise,
    setTimeout: (fn) => { sb.__timers.push(fn); return 0; }, __timers: [],
  };
  vm.createContext(sb);
  const src = SCRIPTS.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
  vm.runInContext(src + '\n;canvas=__c; ctx=canvas.getContext("2d");', Object.assign(sb, { __c: canvasEl }));
  const ev = s => vm.runInContext(s, sb);
  const flushTimers = () => { const t = sb.__timers.splice(0); for (const f of t) f(); };
  return { sb, ev, store, flushTimers };
}
// run `n` ticks, drawing every `drawEvery` ticks; returns thrown errors
function run(game, n, drawEvery = 10, before) {
  const errs = [];
  for (let i = 0; i < n; i++) {
    try { if (before) before(i); game.ev(`step(); if (G.tick % ${drawEvery} === 0) draw(0.02)`); game.flushTimers(); }
    catch (e) { errs.push(e.stack.split('\n').slice(0, 3).join(' | ')); if (errs.length > 5) break; }
  }
  return errs;
}
module.exports = { makeGame, run, SCRIPTS };
