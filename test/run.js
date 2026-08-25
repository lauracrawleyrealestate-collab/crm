const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const path = require('path');

const errors = [];
const log = [];

(async () => {
  const browser = await chromium.launch({ channel: undefined });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

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

  // --- back to board, take a mobile shot ---
  await page.click('.tab[data-view="pipeline"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test/shot-board.png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test/shot-mobile.png' });

  await browser.close();

  console.log('--- LOG ---');
  log.forEach(l => console.log('  ' + l));
  console.log('--- ERRORS (' + errors.length + ') ---');
  errors.forEach(e => console.log('  ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
