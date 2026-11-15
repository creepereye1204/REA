'use strict';
const { makeGame, run } = require('./harness'), { ok, eq, noErrors } = require('./assert');
module.exports = {
  'save and continue restores the world'() {
    const g = makeGame(); g.ev('startSolo()');
    run(g, 1500, 50);
    g.ev('var p=G.players[0]; p.x+=30; G.stash.cash=777; p.lvl=3; p.perks={vit:2}; sendCmd({c:"build",t:"campfire",cell:idx(Math.floor(p.x)+2,Math.floor(p.y))}); W.conts[5].looted=true;');
    const before = g.ev('JSON.stringify({cash:G.stash.cash, x:G.players[0].x.toFixed(1), cf:G.structs.filter(s=>s.type==="campfire").length, lvl:G.players[0].lvl, looted:W.conts[5].looted})');
    ok(g.ev('saveGame(true)'), 'save failed');
    g.ev('quitToTitle(); G=null; continueSolo();');
    const after = g.ev('JSON.stringify({cash:G.stash.cash, x:G.players[0].x.toFixed(1), cf:G.structs.filter(s=>s.type==="campfire").length, lvl:G.players[0].lvl, looted:W.conts[5].looted})');
    eq(after, before, 'state after load');
    noErrors(run(g, 1000, 25));
  },
};
