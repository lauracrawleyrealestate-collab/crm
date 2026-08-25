/* Pure-logic tests for the importer, run against the exact messy strings
   that appear in Laura's real workbook. No browser, no network. */

const fs = require('fs');
const vm = require('vm');

const ctx = { console, Store: { settings: {} }, api: null, People: { _cache: [] } };
vm.createContext(ctx);
const src = fs.readFileSync(__dirname + '/../js/import.js', 'utf8');
const I = vm.runInContext(src + '\n;Importer;', ctx);

let fails = 0;
const eq = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) { fails++; console.log('  FAIL ' + label + ': got "' + got + '" want "' + want + '"'); }
  else console.log('  ok   ' + label + ' -> ' + got);
};

console.log('\n--- dates (real strings from the sheet) ---');
eq('12/5/2025',                    I.parseLooseDate('12/5/2025', 2026), '2025-12-05');
eq('1/30/2026',                    I.parseLooseDate('1/30/2026', 2026), '2026-01-30');
eq('Jan 8th, 2026',                I.parseLooseDate('Jan 8th, 2026', 2026), '2026-01-08');
eq('March 17th, 2026',             I.parseLooseDate('March 17th, 2026', 2026), '2026-03-17');
eq('Monday, March 2, 2026',        I.parseLooseDate('Monday, March 2, 2026', 2026), '2026-03-02');
eq('Sunday, May 31, 2026',         I.parseLooseDate('Sunday, May 31, 2026', 2026), '2026-05-31');
eq('April 17th, 2026',             I.parseLooseDate('April 17th, 2026', 2026), '2026-04-17');
eq('Wednesday, June 03, 2026',     I.parseLooseDate('Wednesday, June 03, 2026', 2026), '2026-06-03');
eq('Juky 31st, 2026 (typo)',       I.parseLooseDate('Juky 31st, 2026', 2026), '2026-07-31');
eq('Thursday, July 9th. (no yr)',  I.parseLooseDate('Thursday, July 9th. ', 2026), '2026-07-09');
eq('May 3rd (no year)',            I.parseLooseDate('May 3rd ', 2026), '2026-05-03');
eq('June 29th (no year)',          I.parseLooseDate('June 29th ', 2026), '2026-06-29');
eq('Monday, August 3rd',           I.parseLooseDate('Monday, August 3rd ', 2026), '2026-08-03');
eq('8/23/2026',                    I.parseLooseDate('8/23/2026', 2026), '2026-08-23');
eq('Aug 25, 2026',                 I.parseLooseDate('Aug 25, 2026', 2026), '2026-08-25');
eq('September 15th',               I.parseLooseDate('September 15th ', 2026), '2026-09-15');
eq('garbage',                      I.parseLooseDate('n/a', 2026), '');
eq('empty',                        I.parseLooseDate('', 2026), '');

console.log('\n--- money ---');
eq('$11863.45', I.num('$11863.45'), '11863.45');
eq('$7,968.70', I.num('$7,968.70'), '7968.7');
eq('$ 1,777,000.00', I.num(' $ 1,777,000.00 '), '1777000');
eq('blank', I.num(''), '');
eq('379.46', I.num('379.46'), '379.46');

console.log('\n--- sources ---');
const srcCases = [
  ['Referral:  Client ', 'Referral: Past Client'],
  ['Referral:  HS Friend', 'Referral: Friend'],
  ['Referral: family', 'Referral: Family'],
  ['Referral: Family', 'Referral: Family'],
  ['Referral:Family ', 'Referral: Family'],
  ['Referral: Parents ', 'Referral: Family'],
  ['Referral: Heal family', 'Referral: Family'],
  ["Family - Jess's boyfriend ", 'Referral: Family'],
  ['Referral:  Friend', 'Referral: Friend'],
  ['Friends', 'Referral: Friend'],
  ['Friend', 'Referral: Friend'],
  ['Sign Call/ Call in', 'Sign Call / Call In'],
  ['Referral  ', 'Referral: Other'],
  ['Referral: Kay', 'Referral: Other'],
  ['Referral: Sejal ', 'Referral: Other'],
  ['Referral - old acreage contact ', 'Referral: Other'],
  ["John's work ", 'Personal Network'],
  ['Facebook ', 'Social Media'],
];
srcCases.forEach(([raw, want]) => eq(JSON.stringify(raw), I.normalizeSource(raw).source, want));

console.log('\n--- repeat-client de-duplication ---');
const names = [
  'Nathan and Nicole Drader', 'Pam Maloney', 'Roz and Mike Stewart', 'Roz and Mike',
  'Sheila Kitz and Tim Mahdiuk', 'Allan Vanderwolf', 'Kass and Greg Squires ',
  'Kaylyn Stewart ', 'Jim and Kelli Stewart ', 'Jim and Kelli Stewart ',
  'Carmen Cadieux', 'Mike and Roz Stewart ', 'Mike and Roz Stewart ',
  'Stephanie and Steve ', 'Diana Melnyk', 'Brenda and Kevin Hart ',
  'Tracy and Marty Hawtim ', 'Diana Melynk', 'Ali and Farida Merali',
  'Tracy and Marty Hawtin ', 'Joshua Dicks ', 'Dawn and Brent Campbell',
  'Angela and Blair Walker ', 'Christie Bucholtz ', 'JoeyPetkau and Clarence Drader ',
];
const groups = I.groupNames(names);
groups.filter(g => g.members.length > 1).forEach(g => {
  console.log('  merged -> ' + g.canonical + '  [' +
    [...new Set(g.members)].join(' | ') + ']');
});
console.log('  ' + names.length + ' rows -> ' + groups.length + ' people');

const find = (n) => groups.find(g => g.members.some(m => m.trim() === n));
const same = (a, b) => find(a) === find(b);

eq('Roz/Mike variants merge', same('Roz and Mike Stewart', 'Mike and Roz Stewart'), 'true');
eq('"Roz and Mike" merges too', same('Roz and Mike', 'Roz and Mike Stewart'), 'true');
eq('Hawtim == Hawtin (typo)', same('Tracy and Marty Hawtim', 'Tracy and Marty Hawtin'), 'true');
eq('Melnyk == Melynk (typo)', same('Diana Melnyk', 'Diana Melynk'), 'true');
eq('Kaylyn Stewart stays separate', same('Kaylyn Stewart', 'Roz and Mike Stewart'), 'false');
eq('Jim&Kelli separate from Roz&Mike', same('Jim and Kelli Stewart', 'Roz and Mike Stewart'), 'false');
eq('Draders not merged', same('Nathan and Nicole Drader', 'JoeyPetkau and Clarence Drader'), 'false');

console.log('\n' + (fails ? fails + ' FAILURES' : 'all parse tests passed'));
process.exit(fails ? 1 : 0);
