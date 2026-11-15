'use strict';
const { makeGame, run } = require('./harness'), { ok, noErrors } = require('./assert');
const godMode = g => g.ev('(()=>{const p=G.players[0]; p.hp=p.maxHp=1e9; p.hunger=100;})()');
module.exports = {
  'world generates with every story site'() {
    const g = makeGame(); g.ev('startSolo()');
    const keys = JSON.parse(g.ev('JSON.stringify(W.pois.filter(p=>p.story).map(p=>p.key))'));
    for (const k of ['hospital', 'lab', 'military', 'tower', 'church', 'prison', 'station', 'farm', 'school', 'helipad', 'rebelbase', 'warzone']) ok(keys.includes(k), 'missing landmark ' + k);
    ok(g.ev('W.villages.length') === 8 && g.ev('W.camps.length') === 10 && g.ev('W.towns.length') >= 5, 'villages/camps/towns');
  },
  'a full day and night runs clean'() {
    const g = makeGame(); g.ev('startSolo()');
    const errs = run(g, 50 * 60 * 9, 25, i => { if (i % 50 === 0) godMode(g); });
    noErrors(errs);
    ok(!g.ev('G.ents.some(e => !isFinite(e.x) || !isFinite(e.y))'), 'NaN positions');
    ok(g.ev('G.day') >= 2 || g.ev('G.phase') !== 'day', 'clock advanced into the night');
  },
  'ambient spawning and chunk activation stay bounded'() {
    const g = makeGame(); g.ev('startSolo()'); godMode(g);
    noErrors(run(g, 3000, 50));
    ok(g.ev('G.ents.length') < 400, 'too many active entities: ' + g.ev('G.ents.length'));
    ok(g.ev('G.frozen.length') > 100, 'far entities should be frozen');
  },
};
