const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const path = require('path');

const errors = [];
const log = [];

(async () => {
  const browser = await chromium.launch({ channel: undefined });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  // The sandbox has no route to fonts.googleapis.com; that is not an app fault.
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const txt = m.text();
    if (/net::ERR_|fonts\.googleapis|fonts\.gstatic/.test(txt)) return;
    errors.push('CONSOLE: ' + txt);
  });

  const url = 'file://' + path.resolve('test/harness.html');
  await page.goto(url);
  await page.waitForSelector('#app:not([hidden])', { timeout: 8000 });
  log.push('app loaded');

  // --- board renders ---
  await page.waitForSelector('#board .col');
  const cols = await page.$$eval('#board .col .col-title', ns => ns.map(n => n.textContent));
  const cards = await page.$$eval('#board .card .card-title', ns => ns.map(n => n.textContent));
  log.push('Buyer columns: ' + cols.join(' | '));
  log.push('Buyer cards: ' + cards.join(' | '));
  if (!cards.includes('Dave T — Purchase')) errors.push('Dave deal missing from board');
  if (cards.includes('Old file')) errors.push('Closed deal shown while "show closed" is off');

  // --- stale flag ---
  const stale = await page.$$eval('#board .card.stale', ns => ns.length);
  log.push('stale cards: ' + stale);
  if (stale < 1) errors.push('expected at least one stale card');

  // --- switch pipeline ---
  await page.click('#pipeline-seg button[data-pipeline="Seller"]');
  await page.waitForTimeout(200);
  const sellerCards = await page.$$eval('#board .card .card-title', ns => ns.map(n => n.textContent));
  log.push('Seller cards: ' + sellerCards.join(' | '));
  if (!sellerCards.includes('9910 108 St — Listing')) errors.push('seller deal missing');

  await page.click('#pipeline-seg button[data-pipeline="Buyer"]');
  await page.waitForTimeout(150);

  // --- search ---
  await page.fill('#board-search', 'terwillegar');
  await page.waitForTimeout(150);
  let n = await page.$$eval('#board .card', ns => ns.length);
  log.push('search "terwillegar" -> ' + n + ' cards (expected 0, notes only)');
  await page.fill('#board-search', 'maple');
  await page.waitForTimeout(150);
  await page.fill('#board-search', 'dave');
  await page.waitForTimeout(150);
  n = await page.$$eval('#board .card', ns => ns.length);
  log.push('search "dave" -> ' + n + ' cards');
  if (n !== 1) errors.push('search by contact name should match exactly 1 open deal, got ' + n);
  await page.fill('#board-search', '');
  await page.waitForTimeout(150);

  // --- open deal drawer (target Dave's deal specifically: it has an email) ---
  await page.click('#board .card[data-deal="D-1"]');
  await page.waitForSelector('#drawer:not([hidden])');
  const h2 = await page.textContent('#drawer h2');
  log.push('drawer title: ' + h2);
  const secs = await page.$$eval('#drawer .sec h4', ns => ns.map(n => n.childNodes[0].textContent.trim()));
  log.push('drawer sections: ' + secs.join(' | '));

  // --- gmail load ---
  await page.click('#drawer [data-load-mail]');
  await page.waitForSelector('#mail-slot .thread', { timeout: 4000 });
  log.push('gmail thread rendered: ' + await page.textContent('#mail-slot .thread-sub'));

  // --- stage change via dropdown (the mobile path) ---
  await page.selectOption('#drawer [data-stage-select]', 'Offer Written');
  await page.waitForTimeout(400);
  const moved = await page.evaluate(() => Store.deal('D-1').Stage);
  log.push('stage after dropdown move: ' + moved);
  if (moved !== 'Offer Written') errors.push('dropdown stage move did not persist');

  // --- edit deal via modal ---
  await page.click('#drawer [data-edit-deal]');
  await page.waitForSelector('#modal:not([hidden])');
  await page.fill('#modal input[name="Value"]', '505000');
  await page.click('#modal button[type="submit"]');
  await page.waitForTimeout(500);
  const val = await page.evaluate(() => Store.deal('D-1').Value);
  log.push('value after edit: ' + val);
  if (val !== '505000') errors.push('deal edit did not save');

  // --- log activity ---
  await page.click('#drawer [data-log]');
  await page.waitForSelector('#modal:not([hidden])');
  await page.fill('#modal textarea[name="Summary"]', 'Test call logged');
  await page.click('#modal button[type="submit"]');
  await page.waitForTimeout(500);
  const actCount = await page.evaluate(() => Store.activitiesFor({ dealId: 'D-1' }).length);
  log.push('activities on D-1: ' + actCount);
  if (actCount < 3) errors.push('activity was not added');

  await page.screenshot({ path: 'test/shot-deal.png' });
  await page.click('#drawer [data-close]');
  await page.waitForTimeout(200);

  // --- contacts view ---
  await page.click('.tab[data-view="contacts"]');
  await page.waitForSelector('#contact-list .contact-row');
  const rows = await page.$$eval('#contact-list .contact-name', ns => ns.map(n => n.textContent));
  log.push('contacts: ' + rows.join(' | '));
  await page.fill('#contact-search', 'priya');
  await page.waitForTimeout(150);
  n = await page.$$eval('#contact-list .contact-row', ns => ns.length);
  if (n !== 1) errors.push('contact search failed, got ' + n);
  await page.fill('#contact-search', '');
  await page.waitForTimeout(150);

  // --- new contact ---
  await page.click('#btn-new-contact');
  await page.waitForSelector('#modal:not([hidden])');
  await page.fill('#modal input[name="Name"]', 'Test Person');
  await page.fill('#modal input[name="Email"]', 'test@example.com');
  await page.click('#modal button[type="submit"]');
  await page.waitForTimeout(500);
  const cCount = await page.evaluate(() => Store.contacts.length);
  log.push('contacts after add: ' + cCount);
  if (cCount !== 4) errors.push('new contact not added');

  // --- dashboard ---
  await page.click('.tab[data-view="dashboard"]');
  await page.waitForSelector('#dashboard .panel');
  const stats = await page.$$eval('#dashboard .stat',
    ns => ns.map(n => n.querySelector('.stat-num').textContent + ' ' + n.querySelector('.stat-label').textContent));
  log.push('stats: ' + stats.join(' | '));
  await page.screenshot({ path: 'test/shot-dash.png' });

  // --- settings ---
  await page.click('.tab[data-view="settings"]');
  await page.waitForSelector('#settings .stage-list');
  const pipes = await page.$$eval('#settings .stage-list', ns => ns.length);
  log.push('stage editors: ' + pipes);
  await page.click('[data-stage-add="Buyer"]');
  await page.waitForTimeout(150);
  const after = await page.$$eval('.stage-list[data-pipe="Buyer"] [data-stage-input]', ns => ns.length);
  log.push('buyer stages after add: ' + after);
  if (after !== 9) errors.push('add stage failed, got ' + after);

  // ===================== GOOGLE CONTACTS =====================

  await page.click('.tab[data-view="contacts"]');
  await page.waitForTimeout(400);

  // The background sync should have pulled Dave's newer phone number from Google.
  const davePhone = await page.evaluate(() => Store.contact('C-1').Phone);
  log.push('Dave phone after Google sync: ' + davePhone);
  if (davePhone !== '780-555-9999') errors.push('live Google phone did not overwrite the CRM copy, got ' + davePhone);

  // Linked contacts get a marker dot in the CRM list.
  const dots = await page.$$eval('#contact-list .gdot', ns => ns.length);
  log.push('linked-to-Google markers: ' + dots);
  if (dots < 2) errors.push('expected 2 linked contacts, got ' + dots);

  // Switch to the whole Google address book.
  await page.click('#contact-seg [data-cmode="google"]');
  await page.waitForTimeout(600);
  const gRows = await page.$$eval('#contact-list .contact-name', ns => ns.map(n => n.textContent));
  log.push('google contacts: ' + gRows.join(' | '));
  if (gRows.length !== 4) errors.push('expected 4 Google contacts, got ' + gRows.length);

  const inCrmBadges = await page.$$eval('#contact-list .pill.ok', ns => ns.length);
  const addButtons = await page.$$eval('#contact-list [data-link-google]', ns => ns.length);
  log.push('already-in-CRM: ' + inCrmBadges + ' | addable: ' + addButtons);
  if (inCrmBadges !== 2 || addButtons !== 2) {
    errors.push('link state wrong: ' + inCrmBadges + ' in CRM, ' + addButtons + ' addable');
  }

  // Pull one Google contact into the CRM.
  const gBefore = await page.evaluate(async () => (await People.list(true)).length);
  await page.click('#contact-list [data-link-google="people/c9"]');
  await page.waitForTimeout(700);
  const sam = await page.evaluate(() =>
    Store.contacts.find(c => c['Google ID'] === 'people/c9'));
  log.push('linked Sam: ' + (sam ? sam.Name + ' / ' + sam.Phone : 'MISSING'));
  if (!sam || sam.Name !== 'Sam Okafor') errors.push('linking a Google contact failed');

  await page.click('#drawer [data-close]');   // linking opens the new contact
  await page.waitForTimeout(300);

  // Linking an existing person must NOT create a second Google record.
  const gTotal = await page.evaluate(async () => (await People.list(true)).length);
  log.push('google contacts before/after link: ' + gBefore + ' -> ' + gTotal);
  if (gTotal !== gBefore) {
    errors.push('linking duplicated a Google contact: ' + gBefore + ' -> ' + gTotal);
  }

  // A brand new CRM contact SHOULD be pushed to Google.
  await page.click('#contact-seg [data-cmode="crm"]');
  await page.waitForTimeout(300);
  await page.click('#btn-new-contact');
  await page.waitForSelector('#modal:not([hidden])');
  await page.fill('#modal input[name="Name"]', 'Nadia Brooks');
  await page.fill('#modal input[name="Phone"]', '780-555-0456');
  await page.fill('#modal input[name="Email"]', 'nadia@example.com');
  await page.click('#modal button[type="submit"]');
  await page.waitForTimeout(900);
  const pushed = await page.evaluate(async () => {
    const all = await People.list(true);
    const p = all.find(x => x.name.indexOf('Nadia') > -1);
    const crm = Store.contacts.find(c => c.Name === 'Nadia Brooks');
    return { inGoogle: !!p, linked: !!(crm && crm['Google ID']), phone: p && p.phone };
  });
  log.push('new CRM contact pushed to Google: ' + JSON.stringify(pushed));
  if (!pushed.inGoogle) errors.push('new CRM contact was not created in Google Contacts');
  if (!pushed.linked) errors.push('new CRM contact was not linked back to its Google record');

  // Editing a linked contact should push the change to Google.
  await page.evaluate(async () => {
    const c = Store.contact('C-1');
    await Store.saveContact({ ID: c.ID, Phone: '780-555-1234' });
  });
  await page.waitForTimeout(700);
  const edited = await page.evaluate(async () => {
    const all = await People.list(true);
    const p = all.find(x => x.id === 'people/c1');
    return p && p.phone;
  });
  log.push('google phone after CRM edit: ' + edited);
  if (edited !== '780-555-1234') errors.push('CRM edit did not reach Google Contacts, got ' + edited);

  await page.click('.tab[data-view="contacts"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/shot-contacts.png' });

  // ---- bulk multi-select in the Google address book ----
  await page.click('.tab[data-view="contacts"]');
  await page.waitForTimeout(300);
  await page.click('#contact-seg [data-cmode="google"]');
  await page.waitForTimeout(600);

  // Only people not already in the CRM get a tick-box.
  const counts = await page.evaluate(() => {
    const linked = new Set(Store.contacts.map(c => c['Google ID']).filter(Boolean));
    return {
      boxes: document.querySelectorAll('#contact-list [data-pick]').length,
      spacers: document.querySelectorAll('#contact-list .pick-spacer').length,
      addable: (People._cache || []).filter(p => !linked.has(p.id)).length,
      total: (People._cache || []).length,
    };
  });
  log.push('google list: ' + JSON.stringify(counts));
  if (counts.boxes !== counts.addable) {
    errors.push('tick-boxes (' + counts.boxes + ') do not match addable (' + counts.addable + ')');
  }
  if (counts.boxes + counts.spacers !== counts.total) {
    errors.push('every row should have a box or a spacer');
  }
  if (!counts.addable) errors.push('no addable google contacts left to exercise bulk add');

  // Tick one, and make sure that does NOT open the drawer.
  const firstId = await page.$eval('#contact-list [data-pick]', n => n.getAttribute('data-pick'));
  await page.click('#contact-list [data-pick="' + firstId + '"]');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => App.picked.size) !== 1) errors.push('ticking did not register');
  if (await page.evaluate(() => !document.getElementById('drawer').hidden)) {
    errors.push('ticking a checkbox wrongly opened the drawer');
  }
  log.push('ticked one: ' + firstId + ' (drawer stayed shut)');

  // Select-all must respect the search box.
  const target = await page.evaluate((id) => {
    const p = People._cache.find(x => x.id === id);
    return p.name.split(' ').pop().toLowerCase();
  }, firstId);
  await page.click('[data-sel-none]');
  await page.fill('#contact-search', target);
  await page.waitForTimeout(300);
  await page.click('[data-sel-all]');
  await page.waitForTimeout(300);
  const filtered = await page.evaluate(() => [...App.picked]);
  log.push('search "' + target + '" + select all -> ' + filtered.length + ' picked');
  if (!filtered.includes(firstId)) errors.push('select-all missed the filtered match');
  if (filtered.length >= counts.addable && counts.addable > 1) {
    errors.push('select-all ignored the search filter');
  }

  await page.fill('#contact-search', '');
  await page.waitForTimeout(300);
  await page.click('[data-sel-none]');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => App.picked.size) !== 0) errors.push('Clear did not empty the selection');

  // Select everything addable, then bulk add.
  await page.click('[data-sel-all]');
  await page.waitForTimeout(300);
  const beforeContacts = await page.evaluate(() => Store.contacts.length);
  const writesBefore = await page.evaluate(() => Sheets.writes.filter(w => w === 'Contacts').length);
  const gBeforeBulk = await page.evaluate(async () => (await People.list(true)).length);
  await page.screenshot({ path: 'test/shot-selected.png' });

  await page.click('[data-bulk-add]');
  await page.waitForSelector('#modal:not([hidden])');
  await page.fill('#modal input[name="Tags"]', 'address book');
  await page.click('#modal button[type="submit"]');
  await page.waitForTimeout(1500);

  const bulk = await page.evaluate(() => ({
    contacts: Store.contacts.length,
    tagged: Store.contacts.filter(c => c.Tags === 'address book').length,
    typed: Store.contacts.filter(c => c.Tags === 'address book' && c.Type === 'Past Client').length,
    linked: Store.contacts.filter(c => c.Tags === 'address book' && c['Google ID']).length,
    picked: App.picked.size,
  }));
  const writes = await page.evaluate(() => Sheets.writes.filter(w => w === 'Contacts').length) - writesBefore;
  log.push('bulk add: ' + JSON.stringify(bulk) + ' | sheet writes used: ' + writes);

  if (bulk.contacts !== beforeContacts + counts.addable) {
    errors.push('bulk add created ' + (bulk.contacts - beforeContacts) + ', expected ' + counts.addable);
  }
  if (bulk.tagged !== counts.addable) errors.push('shared tag not applied across the batch');
  if (bulk.typed !== counts.addable) errors.push('shared type not applied across the batch');
  if (bulk.linked !== counts.addable) errors.push('bulk-added contacts were not linked to Google');
  if (bulk.picked !== 0) errors.push('selection was not cleared after adding');
  if (writes !== 1) errors.push('bulk add used ' + writes + ' sheet writes, should be exactly 1');

  // It must not create anything in Google.
  const gAfterBulk = await page.evaluate(async () => (await People.list(true)).length);
  log.push('google contacts around bulk add: ' + gBeforeBulk + ' -> ' + gAfterBulk);
  if (gAfterBulk !== gBeforeBulk) errors.push('bulk add wrongly wrote to Google Contacts');

  // Everyone is in the CRM now, so no tick-boxes should remain.
  await page.waitForTimeout(300);
  const leftover = await page.$$eval('#contact-list [data-pick]', ns => ns.length);
  log.push('tickable rows remaining: ' + leftover);
  if (leftover !== 0) errors.push('rows still tickable after being added');

  await page.screenshot({ path: 'test/shot-bulk.png' });
  await page.click('#contact-seg [data-cmode="crm"]');
  await page.waitForTimeout(300);

  // ===================== IMPORTER =====================

  await page.click('.tab[data-view="settings"]');
  await page.waitForTimeout(300);
  await page.click('[data-import]');
  await page.waitForSelector('#modal:not([hidden])');
  await page.fill('#modal input[name="url"]',
    'https://docs.google.com/spreadsheets/d/srcbook123/edit');
  await page.click('#modal button[type="submit"]');
  await page.waitForSelector('#drawer:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(600);

  const preview = await page.evaluate(() => {
    const p = App._importPlan;
    return {
      deals: p.totals.deals,
      contacts: p.totals.newContacts,
      appts: p.appointments.length,
      volume: p.totals.volume,
      commission: p.totals.commission,
      warnings: p.warnings.length,
      merged: p.contacts.filter(c => c.aliases.length).map(c => c.name + '<-' + c.aliases.join('/')),
      sources: p.sourceMapping.map(x => x[0]),
      sides: p.deals.map(d => d.pipeline).join(','),
    };
  });
  log.push('preview deals: ' + preview.deals + ' contacts: ' + preview.contacts +
           ' appts: ' + preview.appts);
  log.push('preview volume: ' + preview.volume + ' commission: ' + preview.commission);
  log.push('preview merges: ' + preview.merged.join(' ; '));
  log.push('preview sources: ' + preview.sources.join(' | '));
  log.push('preview warnings: ' + preview.warnings);

  if (preview.deals !== 8) errors.push('expected 8 deals in preview, got ' + preview.deals);
  if (preview.appts !== 3) errors.push('expected 3 appointments, got ' + preview.appts);
  if (!preview.merged.length) errors.push('repeat clients were not merged in the preview');
  if (preview.warnings < 2) errors.push('expected warnings for the blank commission/side rows');

  // Nothing may be written before confirming.
  const beforeDeals = await page.evaluate(() => Store.deals.length);
  log.push('deals before confirm: ' + beforeDeals);

  await page.screenshot({ path: 'test/shot-import.png', fullPage: true });

  await page.click('[data-run-import]');
  await page.waitForTimeout(2500);

  const post = await page.evaluate(() => ({
    deals: Store.deals.length,
    contacts: Store.contacts.length,
    acts: Store.activities.length,
    closed: Store.deals.filter(d => d.Stage === 'Closed').length,
    withComm: Store.deals.filter(d => d.Commission).length,
    roz: Store.contacts.filter(c => /roz/i.test(c.Name)).length,
    rozDeals: (() => {
      const c = Store.contacts.find(x => /roz/i.test(x.Name));
      return c ? Store.dealsFor(c.ID).length : 0;
    })(),
  }));
  log.push('after import: ' + JSON.stringify(post));

  if (post.deals !== beforeDeals + 8) errors.push('expected 8 new deals, got ' + (post.deals - beforeDeals));
  if (post.roz !== 1) errors.push('Roz/Mike should be ONE contact, got ' + post.roz);
  if (post.rozDeals !== 3) errors.push('Roz/Mike should own 3 deals, got ' + post.rozDeals);
  if (post.withComm < 7) errors.push('commission did not import on most deals');

  // Re-running must not duplicate.
  await page.click('.tab[data-view="settings"]');
  await page.waitForTimeout(300);
  await page.click('[data-import]');
  await page.waitForSelector('#modal:not([hidden])');
  await page.fill('#modal input[name="url"]',
    'https://docs.google.com/spreadsheets/d/srcbook123/edit');
  await page.click('#modal button[type="submit"]');
  await page.waitForSelector('#drawer:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(600);
  const second = await page.evaluate(() => ({
    add: App._importPlan.totals.deals,
    skip: App._importPlan.totals.skipped,
  }));
  log.push('second run: ' + second.add + ' to add, ' + second.skip + ' already in');
  if (second.add !== 0) errors.push('re-import would duplicate ' + second.add + ' deals');
  await page.click('#drawer [data-close]');
  await page.waitForTimeout(300);

  // --- dashboard goals scoreboard ---
  await page.click('.tab[data-view="dashboard"]');
  await page.waitForTimeout(500);
  const goals = await page.$$eval('#dashboard .goal-row', ns => ns.map(n =>
    n.querySelector('.goal-label').textContent + ' ' +
    n.querySelector('.goal-num').textContent.replace(/\s+/g, ' ').trim() + ' ' +
    n.querySelector('.goal-pct').textContent));
  log.push('goals:');
  goals.forEach(g => log.push('   ' + g));
  if (goals.length !== 6) errors.push('expected 6 goal rows, got ' + goals.length);
  await page.screenshot({ path: 'test/shot-goals.png' });

  // ===================== DASHBOARD DRILL-DOWNS =====================

  const drillCounts = await page.evaluate(() => ({
    stats: document.querySelectorAll('#dashboard .stat.clickable').length,
    stages: document.querySelectorAll('#dashboard [data-drill-stage]').length,
    months: document.querySelectorAll('#dashboard [data-drill-month]').length,
    sources: document.querySelectorAll('#dashboard [data-drill-source]').length,
    panels: document.querySelectorAll('#dashboard .panel h3').length,
  }));
  // Bars must actually paint — a <span> with no display:block renders 0x0.
  const fillWidths = await page.evaluate(() => [...document.querySelectorAll('#dashboard .bar-fill')]
    .map(n => Math.round(n.getBoundingClientRect().width)));
  log.push('widest bar fill: ' + Math.max(0, ...fillWidths) + 'px across ' + fillWidths.length + ' bars');
  if (Math.max(0, ...fillWidths) < 10) errors.push('bar fills are not rendering');

  log.push('dashboard drill affordances: ' + JSON.stringify(drillCounts));
  if (drillCounts.stats !== 6) errors.push('expected 6 clickable stats, got ' + drillCounts.stats);
  if (!drillCounts.stages) errors.push('no clickable stage rows on the dashboard');
  if (!drillCounts.months) errors.push('no clickable month rows on the dashboard');
  if (!drillCounts.sources) errors.push('no clickable source rows on the dashboard');

  // Closed-in-year stat opens a drawer listing exactly the deals behind it.
  const wonExpected = await page.evaluate(() => App.closedInYear(
    (Store.settings.goals && Store.settings.goals.year) || new Date().getFullYear()).length);
  await page.click('#dashboard .stat.clickable[data-stat-drill="won"]');
  await page.waitForSelector('#drawer:not([hidden])');
  await page.waitForTimeout(250);
  const wonDrill = await page.$$eval('#drawer .list-lite-row', ns => ns.length);
  log.push('closed-in-year drill: ' + wonDrill + ' rows (expected ' + wonExpected + ')');
  if (wonDrill !== wonExpected) errors.push('won drill listed ' + wonDrill + ', expected ' + wonExpected);
  await page.screenshot({ path: 'test/shot-drill.png' });

  // A row in that drawer opens the actual deal.
  await page.click('#drawer .list-lite-row');
  await page.waitForTimeout(300);
  const drilledTitle = await page.textContent('#drawer h2');
  log.push('drill -> deal: ' + drilledTitle);
  if (!(await page.$('#drawer [data-edit-deal]'))) errors.push('drill row did not open a deal drawer');
  await page.click('#drawer [data-close]');
  await page.waitForTimeout(250);

  // Month drill: the drawer count must match the bar's own deal count.
  const monthProbe = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#dashboard [data-drill-month]')];
    const r = rows.find(n => Number(n.querySelector('.bar-num').textContent) > 0);
    return r ? { i: r.getAttribute('data-drill-month'),
                 n: Number(r.querySelector('.bar-num').textContent) } : null;
  });
  if (!monthProbe) {
    errors.push('no month with closed deals to drill into');
  } else {
    await page.click('#dashboard [data-drill-month="' + monthProbe.i + '"]');
    await page.waitForSelector('#drawer:not([hidden])');
    await page.waitForTimeout(250);
    const got = await page.$$eval('#drawer .list-lite-row', ns => ns.length);
    log.push('month drill ' + monthProbe.i + ': ' + got + ' rows (bar said ' + monthProbe.n + ')');
    if (got !== monthProbe.n) errors.push('month drill mismatch: ' + got + ' vs ' + monthProbe.n);
    await page.click('#drawer [data-close]');
    await page.waitForTimeout(250);
  }

  // Source drill.
  const srcName = await page.$eval('#dashboard [data-drill-source]',
    n => n.getAttribute('data-drill-source'));
  await page.click('#dashboard [data-drill-source="' + srcName.replace(/"/g, '\\"') + '"]');
  await page.waitForSelector('#drawer:not([hidden])');
  await page.waitForTimeout(250);
  const srcRows = await page.$$eval('#drawer .list-lite-row', ns => ns.length);
  log.push('source drill "' + srcName + '": ' + srcRows + ' rows');
  if (!srcRows) errors.push('source drill returned no deals');
  await page.click('#drawer [data-close]');
  await page.waitForTimeout(250);

  // Stage drill on open deals.
  const stageProbe = await page.evaluate(() => {
    const r = document.querySelector('#dashboard [data-drill-stage]');
    return { k: r.getAttribute('data-drill-stage'),
             n: Number(r.querySelector('.bar-num').textContent) };
  });
  await page.click('#dashboard [data-drill-stage="' + stageProbe.k.replace(/"/g, '\\"') + '"]');
  await page.waitForSelector('#drawer:not([hidden])');
  await page.waitForTimeout(250);
  const stageRows = await page.$$eval('#drawer .list-lite-row', ns => ns.length);
  log.push('stage drill "' + stageProbe.k + '": ' + stageRows + ' (bar said ' + stageProbe.n + ')');
  if (stageRows !== stageProbe.n) errors.push('stage drill mismatch: ' + stageRows + ' vs ' + stageProbe.n);
  await page.click('#drawer [data-close]');
  await page.waitForTimeout(250);

  await page.screenshot({ path: 'test/shot-dash-full.png', fullPage: true });

  // ===================== NEW-DEAL MODAL =====================

  // Someone who exists in Google but NOT in the CRM — the case the old picker missed.
  await page.evaluate(async () => {
    await People.create({ Name: 'Wendell Ashcroft', Phone: '780-555-3131',
                          Email: 'wendell@example.com' });
    await People.list(true);
  });

  await page.click('.tab[data-view="pipeline"]');
  await page.waitForTimeout(300);
  await page.click('#btn-new-deal');
  await page.waitForSelector('#modal:not([hidden])');
  await page.waitForTimeout(200);

  // Save/Cancel must be reachable without scrolling to the bottom of the fields.
  const foot = await page.evaluate(() => {
    const card = document.querySelector('.modal-card');
    const f = document.querySelector('.modal-foot');
    const body = document.querySelector('.modal-body');
    return {
      footBottom: Math.round(f.getBoundingClientRect().bottom),
      cardBottom: Math.round(card.getBoundingClientRect().bottom),
      viewport: window.innerHeight,
      bodyScrolls: body.scrollHeight > body.clientHeight + 1,
      halves: document.querySelectorAll('.modal-body .field.half').length,
      cols: getComputedStyle(body).gridTemplateColumns.split(' ').length,
    };
  });
  log.push('modal layout: ' + JSON.stringify(foot));
  if (foot.footBottom > foot.viewport) errors.push('modal footer sits below the viewport');
  if (Math.abs(foot.footBottom - foot.cardBottom) > 2) errors.push('footer is not pinned to the card');
  if (foot.cols !== 2) errors.push('modal fields are not on a two-column grid');
  if (foot.halves < 6) errors.push('expected paired fields, got ' + foot.halves + ' halves');

  await page.screenshot({ path: 'test/shot-modal.png' });

  // Type-ahead reaches the whole Google address book, not just CRM contacts.
  await page.fill('.combo-input', 'wend');
  await page.waitForTimeout(300);
  const opts = await page.$$eval('.combo-list .combo-item',
    ns => ns.map(n => n.getAttribute('data-value') + ' :: ' + n.querySelector('.combo-label').textContent));
  log.push('combo "wend" -> ' + opts.join(' | '));
  const gOpt = opts.find(o => o.indexOf('google:') === 0);
  if (!gOpt) errors.push('type-ahead did not surface the Google-only contact');

  await page.click('.combo-list .combo-item[data-value^="google:"]');
  await page.waitForTimeout(200);
  await page.fill('#modal input[name="Deal Name"]', 'Ashcroft — Purchase');
  await page.fill('#modal input[name="Value"]', '450000');
  await page.click('#modal button[type="submit"]');
  await page.waitForTimeout(900);

  const made = await page.evaluate(() => {
    const d = Store.deals.find(x => x['Deal Name'] === 'Ashcroft — Purchase');
    const c = d && Store.contact(d['Contact ID']);
    return { deal: !!d, contact: c && c.Name, googleId: c && c['Google ID'], phone: c && c.Phone };
  });
  log.push('deal from Google-only contact: ' + JSON.stringify(made));
  if (!made.deal) errors.push('new deal was not saved');
  if (made.contact !== 'Wendell Ashcroft') errors.push('picked Google contact was not linked to the deal');
  if (!made.googleId) errors.push('linked contact lost its Google ID');

  // "New: <name>" path still works for someone who exists nowhere.
  await page.click('#btn-new-deal');
  await page.waitForSelector('#modal:not([hidden])');
  await page.fill('.combo-input', 'Harriet Vane');
  await page.waitForTimeout(300);
  const newOpt = await page.$('.combo-list .combo-item[data-value^="new:"]');
  if (!newOpt) errors.push('combo did not offer to create an unknown contact');
  else {
    await newOpt.click();
    await page.waitForTimeout(150);
    await page.fill('#modal input[name="Deal Name"]', 'Vane — Listing');
    await page.click('#modal button[type="submit"]');
    await page.waitForTimeout(900);
    const vane = await page.evaluate(() => {
      const d = Store.deals.find(x => x['Deal Name'] === 'Vane — Listing');
      const c = d && Store.contact(d['Contact ID']);
      return c && c.Name;
    });
    log.push('created-on-the-fly contact: ' + vane);
    if (vane !== 'Harriet Vane') errors.push('inline contact creation failed, got ' + vane);
  }

  // ===================== CALENDAR =====================

  await page.click('.tab[data-view="calendar"]');
  await page.waitForSelector('#calendar .cal-week');
  await page.waitForTimeout(500);

  const week = await page.evaluate(() => ({
    days: document.querySelectorAll('.cal-day').length,
    heads: [...document.querySelectorAll('.cal-dow')].map(n => n.textContent),
    today: document.querySelectorAll('.cal-day.today').length,
    events: document.querySelectorAll('.cal-ev').length,
    crmEvents: document.querySelectorAll('.cal-ev.crm').length,
    reminders: document.querySelectorAll('.cal-rem').length,
    range: document.querySelector('.cal-range').textContent,
  }));
  log.push('calendar week: ' + JSON.stringify(week));
  if (week.days !== 7) errors.push('week view should have 7 days, got ' + week.days);
  if (week.heads[0] !== 'Mon' || week.heads[6] !== 'Sun') {
    errors.push('week should run Mon..Sun, got ' + week.heads.join(','));
  }
  if (week.today !== 1) errors.push('today is not highlighted exactly once');
  if (week.events !== 3) errors.push('expected 3 Google events this week, got ' + week.events);
  if (week.crmEvents !== 1) errors.push('the CRM-created event was not highlighted');
  if (week.reminders < 4) errors.push('expected several reminders, got ' + week.reminders);

  // The derived reminders must be the real ones, not placeholders.
  const kinds = await page.evaluate(() =>
    [...document.querySelectorAll('.cal-rem')].map(n => n.getAttribute('data-rem-kind')));
  log.push('reminder kinds on screen: ' + kinds.join(', '));
  ['birthday', 'touchpoint', 'conditions', 'possession', 'close', 'task'].forEach(k => {
    if (!kinds.includes(k)) errors.push('no ' + k + ' reminder rendered');
  });

  // An overdue monthly touchpoint should be flagged, not silently listed.
  const overdue = await page.$$eval('.cal-rem.overdue', ns => ns.length);
  log.push('overdue reminders flagged: ' + overdue);
  if (!overdue) errors.push('overdue touchpoint was not flagged');

  await page.screenshot({ path: 'test/shot-calendar.png', fullPage: true });

  // Filters hide a category and the choice is written back to Settings.
  const beforeFilter = await page.$$eval('.cal-rem', ns => ns.length);
  await page.click('.chip[data-cal-filter="birthday"]');
  await page.waitForTimeout(400);
  const afterFilter = await page.$$eval('.cal-rem', ns => ns.length);
  const savedPref = await page.evaluate(() => Store.settings.calendarShow.birthday);
  log.push('birthdays off: ' + beforeFilter + ' -> ' + afterFilter + ' reminders, saved=' + savedPref);
  if (afterFilter >= beforeFilter) errors.push('turning a filter off did not remove anything');
  if (savedPref !== false) errors.push('filter choice was not saved to Settings');
  await page.click('.chip[data-cal-filter="birthday"]');
  await page.waitForTimeout(400);
  if (await page.$$eval('.cal-rem', ns => ns.length) !== beforeFilter) {
    errors.push('turning the filter back on did not restore the reminders');
  }

  // Hiding Google events leaves the CRM half of the view working.
  await page.click('.chip[data-cal-filter="google"]');
  await page.waitForTimeout(400);
  const noGoogle = await page.$$eval('.cal-ev', ns => ns.length);
  log.push('google events hidden -> ' + noGoogle + ' event chips');
  if (noGoogle !== 0) errors.push('hiding calendar events did not work');
  await page.click('.chip[data-cal-filter="google"]');
  await page.waitForTimeout(400);

  // Week navigation.
  const thisRange = await page.textContent('.cal-range');
  await page.click('[data-cal-nav="next"]');
  await page.waitForTimeout(500);
  const nextRange = await page.textContent('.cal-range');
  const nextEvents = await page.$$eval('.cal-ev', ns => ns.length);
  log.push('next week: ' + nextRange + ' with ' + nextEvents + ' events');
  if (nextRange === thisRange) errors.push('next week did not advance the range');
  if (await page.$$eval('.cal-day.today', ns => ns.length)) {
    errors.push('"today" highlight leaked into another week');
  }
  await page.click('[data-cal-nav="today"]');
  await page.waitForTimeout(500);
  if (await page.textContent('.cal-range') !== thisRange) errors.push('Today did not come back');

  // A CRM-created calendar event opens the deal it belongs to.
  await page.click('.cal-ev.crm');
  await page.waitForSelector('#drawer:not([hidden])');
  await page.waitForTimeout(250);
  log.push('clicking the CRM event opened: ' + await page.textContent('#drawer h2'));
  if (!(await page.$('#drawer [data-edit-deal]'))) {
    errors.push('CRM calendar event did not open its deal');
  }
  await page.click('#drawer [data-close]');
  await page.waitForTimeout(250);

  // Ticking a to-do off removes it from the week.
  const beforeTask = await page.$$eval('.cal-rem[data-rem-kind="task"]', ns => ns.length);
  await page.click('.week-row [data-rem-done]');
  await page.waitForTimeout(900);
  const afterTask = await page.$$eval('.cal-rem[data-rem-kind="task"]', ns => ns.length);
  const doneFlag = await page.evaluate(() =>
    Store.activities.filter(a => a.Done === 'yes').length);
  log.push('to-dos ' + beforeTask + ' -> ' + afterTask + ', activities marked done: ' + doneFlag);
  if (afterTask >= beforeTask) errors.push('ticking a to-do did not clear it');

  // Scheduling straight off a reminder creates a real calendar event.
  const evBefore = await page.evaluate(async () =>
    (await CalendarApi.range('2000-01-01', '2099-01-01')).length);
  await page.click('.week-row [data-rem-schedule]');
  await page.waitForSelector('#modal:not([hidden])');
  const prefill = await page.inputValue('#modal input[name="title"]');
  log.push('schedule-from-reminder prefilled: ' + prefill);
  if (!prefill) errors.push('the schedule form did not prefill from the reminder');
  await page.click('#modal button[type="submit"]');
  await page.waitForTimeout(1200);
  const evAfter = await page.evaluate(async () =>
    (await CalendarApi.range('2000-01-01', '2099-01-01')).length);
  log.push('calendar events ' + evBefore + ' -> ' + evAfter);
  if (evAfter !== evBefore + 1) errors.push('scheduling from a reminder created no event');
  if (!(await page.$('#drawer[hidden]'))) {
    errors.push('scheduling from the calendar should not hijack the view with a drawer');
  }

  // "Coming up" catches the birthday that sits beyond this week.
  const coming = await page.$$eval('.cal-side .panel:last-child .week-row',
    ns => ns.map(n => n.textContent.trim()));
  log.push('coming up: ' + coming.join(' | '));
  if (!coming.length) errors.push('the Coming up panel is empty');

  // New date fields survive a round trip through the deal form.
  await page.click('.tab[data-view="pipeline"]');
  await page.waitForTimeout(300);
  await page.click('#board .card[data-deal="D-1"]');
  await page.waitForSelector('#drawer:not([hidden])');
  await page.click('#drawer [data-edit-deal]');
  await page.waitForSelector('#modal:not([hidden])');
  await page.fill('#modal input[name="Possession Date"]', '2026-12-15');
  await page.click('#modal button[type="submit"]');
  await page.waitForTimeout(700);
  const poss = await page.evaluate(() => Store.deal('D-1')['Possession Date']);
  log.push('possession date saved: ' + poss);
  if (poss !== '2026-12-15') errors.push('possession date did not save, got ' + poss);
  await page.click('#drawer [data-close]');
  await page.waitForTimeout(250);

  // Birthday + cadence survive a round trip through the contact form.
  await page.click('.tab[data-view="contacts"]');
  await page.waitForTimeout(300);
  await page.click('#contact-list .contact-row');
  await page.waitForSelector('#drawer:not([hidden])');
  await page.click('#drawer [data-edit-contact]');
  await page.waitForSelector('#modal:not([hidden])');
  await page.fill('#modal input[name="Birthday"]', '1984-04-02');
  await page.selectOption('#modal select[name="Touch Cadence"]', 'Quarterly');
  await page.click('#modal button[type="submit"]');
  await page.waitForTimeout(900);
  const bd = await page.evaluate(() => {
    const c = Store.contacts.find(x => x.Birthday === '1984-04-02');
    return c && { name: c.Name, cadence: c['Touch Cadence'] };
  });
  log.push('birthday saved: ' + JSON.stringify(bd));
  if (!bd || bd.cadence !== 'Quarterly') errors.push('birthday/cadence did not save');
  await page.click('#drawer [data-close]');
  await page.waitForTimeout(250);

  // --- back to board, take a mobile shot ---
  await page.click('.tab[data-view="pipeline"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test/shot-board.png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test/shot-mobile.png' });

  await page.click('.tab[data-view="calendar"]');
  await page.waitForSelector('#calendar .cal-week');
  await page.waitForTimeout(600);
  const mobileCols = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.cal-week')).gridTemplateColumns.split(' ').length);
  log.push('mobile calendar columns: ' + mobileCols);
  if (mobileCols !== 1) errors.push('calendar should stack to one column on a phone');
  await page.screenshot({ path: 'test/shot-calendar-mobile.png', fullPage: true });

  await browser.close();

  console.log('--- LOG ---');
  log.forEach(l => console.log('  ' + l));
  console.log('--- ERRORS (' + errors.length + ') ---');
  errors.forEach(e => console.log('  ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
