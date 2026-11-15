'use strict';
const { makeGame } = require('./harness'), { ok } = require('./assert');
module.exports = {
  'every character kind draws in every pose without errors'() {
    const g = makeGame(); g.ev('startSolo(); var p=G.players[0];');
    const kinds = g.ev('Object.keys(MOBS).concat(Object.keys(HUMANS)).join()').split(',');
    for (const k of kinds) g.ev(`(()=>{ const e = MOBS["${k}"] ? spawnMob("${k}", p.x+2, p.y, false) : spawnHuman("${k}", p.x+2, p.y); for (let i=0;i<4;i++){ e.walk+=0.5; e.flash=i%2; e.atkAnim=i/4; e.angle=i; drawEnt(ctx, e); } e.dead=true; })()`);
    for (const w of g.ev('WEAPON_ORDER.join()').split(',')) g.ev(`p.wpn="${w}"; p.fireT=0.1; for (let i=0;i<3;i++){ p.angle=i; drawPlayer(ctx, p); }`);
    g.ev('applyFx({k:"gib",x:p.x,y:p.y,kind:"walker",id:3,a:1}); applyFx({k:"reload",x:p.x,y:p.y,a:0,pid:0,t:1,w:"shotgun"}); applyFx({k:"hit",x:p.x,y:p.y,d:30,pid:0,c:1,kill:1,a:0,big:1}); draw(0.02);');
    ok(true);
  },
  'night, weather and map screens draw'() {
    const g = makeGame(); g.ev('startSolo();');
    for (const w of ['rain', 'fog', 'storm']) g.ev(`G.weather={k:"${w}",i:1,to:1,t:999}; G.clock=23*60; G.phase="night"; draw(0.02);`);
    g.ev('V.mapOpen=true; draw(0.02); V.mapOpen=false; V.panel={k:"perks"}; draw(0.02); V.panel={k:"bench",tab:1}; p=G.players[0]; p.x=G.bench.x; p.y=G.bench.y+1; draw(0.02); V.panel=null;');
    ok(true);
  },
};
