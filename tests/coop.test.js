'use strict';
const { makeGame } = require('./harness'), { ok, noErrors } = require('./assert');
function pair() {
  const H = makeGame(), C = makeGame(), toC = [], toH = [];
  H.ev('startSolo(); NET.role="host";');
  H.sb.__push = m => toC.push(JSON.stringify(m)); C.sb.__push = m => toH.push(JSON.stringify(m));
  H.ev('NET.conn={open:true,send:m=>__push(m)}; NET.connected=true; addPlayer(1); G.players[1].x=G.players[0].x+1; G.players[1].y=G.players[0].y;');
  C.ev('NET.role="client"; NET.conn={open:true,send:m=>__push(m)}; NET.connected=true;');
  C.sb.__init = JSON.parse(H.ev('JSON.stringify({k:"init",seed:G.seed,pid:1,tiles:G.tileDiff,looted:[]})')); C.ev('clientInit(__init); startGame();');
  const errs = [];
  const tick = () => { try {
    H.ev('G.players[0].hp=1e9; step()'); H.flushTimers();
    for (const m of toC.splice(0)) { C.sb.__m = JSON.parse(m); if (C.sb.__m.k === 's') C.ev('clientSnap(__m)'); }
    C.ev('step(); if (G.tick % 10 === 0 && G.core) draw(0.02)'); C.flushTimers();
    for (const m of toH.splice(0)) { H.sb.__m = JSON.parse(m); H.ev('hostRecv(__m)'); }
  } catch (e) { errs.push(e.stack.split('\n').slice(0, 3).join(' | ')); } };
  return { H, C, tick, errs };
}
module.exports = {
  'guest stays in sync with the host'() {
    const { H, C, tick, errs } = pair();
    for (let i = 0; i < 1500; i++) tick();
    noErrors(errs);
    ok(Math.abs(H.ev('G.clock') - C.ev('G.clock')) < 2, 'clock drift');
    ok(C.ev('G.structs.length') === H.ev('G.structs.length'), 'structures differ');
    ok(C.ev('G.ents.length') > 0, 'guest sees no entities');
  },
  'passenger seat works across the network'() {
    const { H, C, tick, errs } = pair();
    H.ev('var c=W.conts.find(c=>c.kind==="car"&&c.drive); c.looted=true; c.fuel=90; enterCar(G.players[0],c); G.players[1].x=G.players[0].x+1.2; G.players[1].y=G.players[0].y+1.2;');
    for (let i = 0; i < 20; i++) tick();
    C.ev('meP().x=G.players[0].x+1.2; meP().y=G.players[0].y+1.2;'); for (let i = 0; i < 6; i++) tick();
    H.ev('interactTap(G.players[1])'); for (let i = 0; i < 10; i++) tick();
    ok(H.ev('G.players[1].ride') === 0 && C.ev('meP().ride') === 0, 'guest should be riding');
    noErrors(errs);
  },
  'a guest who disconnects is kept safe'() {
    const { H, tick, errs } = pair();
    for (let i = 0; i < 10; i++) tick();
    H.ev('(()=>{const q=G.players[1]; if (q.veh) exitCar(q,true); q.joined=false;})()');
    H.ev('for (let k=0;k<6;k++) spawnMob("walker", G.players[1].x+0.5, G.players[1].y, false);');
    for (let i = 0; i < 300; i++) tick();
    ok(!H.ev('G.players[1].dead') && !H.ev('G.players[1].down'), 'disconnected player was attacked');
    noErrors(errs);
  },
};
