// Pins down the clock, month and roll-up arithmetic behind the machine
// work-status sheet, plus the unit-scoped permission matrix. All pure - no DB,
// no network - so it runs anywhere with `npm run check:work-status`.
//
// Worth having because these are the parts that fail quietly: a cross-midnight
// shift, a leap February, or a manager who can suddenly edit another unit.

const { __test: t } = require('../src/routes/machineWorkStatus.routes');
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
};

// toMinutes
eq('time 09:00', t.toMinutes('09:00'), 540);
eq('time 9:05', t.toMinutes('9:05'), 545);
eq('time 23:59', t.toMinutes('23:59'), 1439);
eq('time 00:00', t.toMinutes('00:00'), 0);
eq('empty -> null', t.toMinutes(''), null);
eq('null -> null', t.toMinutes(null), null);
eq('absent -> undefined', t.toMinutes(undefined), undefined);
eq('int passthrough', t.toMinutes(600), 600);
eq('bad hour rejected', Number.isNaN(t.toMinutes('24:00')), true);
eq('bad min rejected', Number.isNaN(t.toMinutes('09:60')), true);
eq('garbage rejected', Number.isNaN(t.toMinutes('9am')), true);
eq('int out of range rejected', Number.isNaN(t.toMinutes(1440)), true);

// deriveRunMinutes
eq('09:00-17:00 = 8h', t.deriveRunMinutes(540, 1020), 480);
eq('same time = 0', t.deriveRunMinutes(540, 540), 0);
eq('cross midnight 22:00-06:00 = 8h', t.deriveRunMinutes(1320, 360), 480);
eq('no off -> null', t.deriveRunMinutes(540, null), null);
eq('no on -> null', t.deriveRunMinutes(null, 540), null);

// monthRange
const oct = t.monthRange('2026-10');
eq('oct days', oct.days, 31);
eq('oct start', oct.start.toISOString().slice(0,10), '2026-10-01');
eq('oct end', oct.end.toISOString().slice(0,10), '2026-11-01');
const feb = t.monthRange('2024-02');
eq('leap feb days', feb.days, 29);
eq('feb2026 days', t.monthRange('2026-02').days, 28);
const dec = t.monthRange('2026-12');
eq('dec rolls year', dec.end.toISOString().slice(0,10), '2027-01-01');
eq('bad month', t.monthRange('2026-13'), null);
eq('bad format', t.monthRange('oct'), null);

// summarise
const rows = [
  { runMinutes: 480, onMinutes: 540, offMinutes: 1020 },
  { runMinutes: 240, onMinutes: 540, offMinutes: 780 },
  { runMinutes: null, onMinutes: 540, offMinutes: null },   // open
  { runMinutes: null, onMinutes: null, offMinutes: null },  // untouched
];
const s = t.summarise(rows);
eq('sum minutes', s.runMinutes, 720);
eq('hours', s.hours, 12);
eq('daysRun', s.daysRun, 2);
eq('openRows', s.openRows, 1);
eq('avg per run day', s.avgHoursPerRunDay, 6);
const empty = t.summarise([]);
eq('empty hours', empty.hours, 0);
eq('empty avg null', empty.avgHoursPerRunDay, null);

// hhmm round trip
eq('hhmm 540', t.hhmm(540), '09:00');
eq('hhmm 0', t.hhmm(0), '00:00');
eq('hhmm 1439', t.hhmm(1439), '23:59');
eq('hhmm null', t.hhmm(null), '');

// canEditMachine
const mach5 = { unitId: 'u5' }, machNone = { unitId: null };
eq('safety any', t.canEditMachine({ role: 'SAFETY', unitId: null }, mach5), true);
eq('admin any', t.canEditMachine({ role: 'ADMIN', unitId: null }, mach5), true);
eq('superadmin any', t.canEditMachine({ role: 'SUPERADMIN' }, mach5), true);
eq('own unit yes', t.canEditMachine({ role: 'MANAGER', unitId: 'u5' }, mach5), true);
eq('other unit no', t.canEditMachine({ role: 'MANAGER', unitId: 'u3' }, mach5), false);
eq('no unit user no', t.canEditMachine({ role: 'MANAGER', unitId: null }, mach5), false);
eq('unassigned machine: manager no', t.canEditMachine({ role: 'MANAGER', unitId: 'u5' }, machNone), false);
eq('unassigned machine: safety yes', t.canEditMachine({ role: 'SAFETY' }, machNone), true);
eq('no user', t.canEditMachine(null, mach5), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
