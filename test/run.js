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
