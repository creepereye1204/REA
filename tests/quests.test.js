'use strict';
const { makeGame } = require('./harness'), { ok } = require('./assert');
module.exports = {
  'rebel quest line starts on day 2 and points somewhere'() {
    const g = makeGame(); g.ev('startSolo(); G.day=2; questOnDay();');
    ok(g.ev('G.Q.lines.rebel') === 'r1', 'rebel line not started');
    ok(g.ev('!!questTarget("r1")'), 'no target');
  },
  'killing the rebel commander finishes the line'() {
    const g = makeGame(); g.ev('startSolo(); G.day=2; questOnDay(); var p=G.players[0]; G.Q.prog.r1=15; questTick();');
    g.ev('var b=everyone().find(e=>e.tag==="rebel_boss"); kill(b, p); questTick();');
    ok(g.ev('G.Q.done.includes("r2")'), 'r2 not completed: ' + g.ev('JSON.stringify(G.Q.lines)'));
  },
};
