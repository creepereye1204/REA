'use strict';
const ok = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg || 'not equal'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const noErrors = errs => { if (errs.length) throw new Error('runtime errors:\n' + errs.join('\n')); };
module.exports = { ok, eq, noErrors };
