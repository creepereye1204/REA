'use strict';
const { makeGame, run } = require('./harness'), { ok, noErrors } = require('./assert');
const solo = () => { const g = makeGame(); g.ev('startSolo(); var p=G.players[0]; p.hp=p.maxHp=1e9;'); return g; };
const hold = (g, n = 120) => { for (let i = 0; i < n; i++) g.ev('(()=>{const it=findInteract(p,G); if(it){p.useT+=DT; if(p.useT>=it.time){completeInteract(p,it); p.useT=0;}}})()'); };
module.exports = {
  'cars: start, drive, ram, park'() {
    const g = solo();
    g.ev('var c=W.conts.find(c=>c.kind==="car"&&c.drive); c.looted=true; p.x=c.x+(c.horiz?0:1); p.y=c.y+(c.horiz?1:0); G.stash.fuel=2;');
    hold(g, 100); ok(g.ev('!!p.veh'), 'did not get in');
    for (let i = 0; i < 200; i++) g.ev('driveMove(p,{moving:true,mx:1,my:0,sprint:true}); simTick();');
    g.ev('p.veh.spd=0; p.in={use:true}; p.useLatch=false; updatePlayer(p);');
    ok(g.ev('!p.veh && W.contAt[c.cells[0]]===c'), 'car not parked back');
  },
  'every weapon fires or swings'() {
    const g = solo();
    g.ev('for (const w of WEAPON_ORDER) { G.stash.owned[w]=1; if(!WEAPONS[w].melee){ G.stash.mags[w]=[WEAPONS[w].mag]; } }');
    for (const w of g.ev('WEAPON_ORDER.join()').split(',')) {
      g.ev(`p.wpn="${w}"; p.mag["${w}"]=WEAPONS["${w}"].mag||0; p.fireT=0; p.reloadT=0; var z=spawnMob("walker",p.x+1.3,p.y,false); z.speed=0;`);
      const k0 = g.ev('G.kills');
      for (let i = 0; i < 160; i++) g.ev('p.in={fire:i%2===0,ax:1,ay:0,use:false,moving:false}; p.angle=0; simTick(); if(G.tick%8===0) draw(0.02);'.replace('i%2', String(i % 2)));
      ok(g.ev('G.kills') > k0 || g.ev('z.hp < z.maxHp'), w + ' did no damage');
    }
  },
  'job board: take and turn in'() {
    const g = solo();
    g.ev('var v=W.villages[0], bp=boardPos(v); p.x=bp.x; p.y=bp.y+1; var js=G.jobs.filter(j=>j.v===0); for (const j of js) sendCmd({c:"job",a:"take",id:j.id}); for (const j of js) { if (j.k==="fetch") G.stash[j.item]=99; else j.ready=true; sendCmd({c:"job",a:"turnin",id:j.id}); }');
    ok(g.ev('G.jobs.filter(j=>j.done).length') >= 1, 'no job completed');
  },
  'kidnapped villager becomes a farmer and harvests'() {
    const g = solo();
    g.ev('var v=W.villages[0]; p.x=v.x+v.w/2; p.y=v.y+v.h/2; activation(); var vil=G.ents.find(e=>e.kind==="villager"); completeInteract(p,{kind:"kidnap",e:vil,c:{village:vil.village},steal:true}); vil.x=G.core.x+3; vil.y=G.core.y+3; p.x=G.core.x+2; p.y=G.core.y+4; G.stash.wood=99; G.stash.food=10;');
    for (const [dx, dy] of [[5, 4], [6, 4], [7, 4]]) g.ev(`sendCmd({c:"build",t:"farm",cell:idx(Math.floor(G.core.x)+${dx},Math.floor(G.core.y)+${dy})})`);
    const f0 = g.ev('G.stash.food');
    for (let i = 0; i < 9000; i++) g.ev('simTick()');
    ok(g.ev('vil.mode') === 'farm', 'not a farmer'); ok(g.ev('G.stash.food') > f0, 'no harvest');
  },
  'levels and perks'() {
    const g = solo();
    g.ev('gainXp(p, 600); for (const k of ["vit","agi","str"]) sendCmd({c:"perk",s:k});');
    ok(g.ev('p.lvl') >= 4 && g.ev('p.perks.vit') === 1, 'level/perk');
  },
  'death respawns instead of game over; core falls and restarts'() {
    const g = solo();
    g.ev('p.hp=1; p.maxHp=100; damage(p, 50, null);');
    ok(g.ev('p.dead && !G.over'), 'should be dead but game continues');
    for (let i = 0; i < 400; i++) g.ev('simTick()'); g.flushTimers();
    ok(g.ev('!p.dead'), 'did not respawn');
    g.ev('damageStruct(G.core, 1e9, null);'); g.flushTimers();
    ok(g.ev('!G.over && G.core.hp > 0'), 'core should restart');
  },
  'rebels and government fight in the war zone'() {
    const g = solo();
    g.ev('var wz=poiOf("warzone"); p.x=wz.x+wz.w/2; p.y=wz.y-6; activation();');
    const n0 = g.ev('everyone().filter(e=>(e.team==="rebel"||e.team==="military")&&!e.dead).length');
    noErrors(run(g, 3000, 50));
    ok(g.ev('everyone().filter(e=>(e.team==="rebel"||e.team==="military")&&!e.dead).length') < n0, 'nobody died in the war zone');
  },
  'world events fire'() {
    const g = solo();
    g.ev('G.day=4; airDrop(p); hordeMigration(p); sosCall(p);');
    ok(g.ev('G.events.length') >= 2, 'events');
    noErrors(run(g, 1500, 50));
  },
};
