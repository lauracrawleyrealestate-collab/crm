/* ==========================================================================
   store.js — in-memory data + saving back to the Google Sheet.
   ========================================================================== */

const Store = {
  contacts: [],
  deals: [],
  activities: [],
  settings: {},
  docsFolderId: null,

  async loadAll() {
    const [contacts, deals, activities, settingRows] = await Promise.all([
      Sheets.read('Contacts'),
      Sheets.read('Deals'),
      Sheets.read('Activities'),
      Sheets.read('Settings'),
    ]);
    this.contacts = contacts;
    this.deals = deals;
    this.activities = activities;
    this.settings = this._parseSettings(settingRows);
  },

  _parseSettings(rows) {
    const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    rows.forEach(r => {
      if (!r.Key) return;
      try { s[r.Key] = JSON.parse(r.Value); }
      catch (e) { s[r.Key] = r.Value; }
    });
    return s;
  },

  async saveSettings() {
    const rows = Object.entries(this.settings)
      .map(([Key, v]) => ({ Key, Value: JSON.stringify(v) }));
    await Sheets.write('Settings', rows);
  },

  newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' +
           Math.random().toString(36).slice(2, 6);
  },

  today() { return new Date().toISOString().slice(0, 10); },

  /* ----------------------------- contacts ------------------------------- */

  contact(id) { return this.contacts.find(c => c.ID === id) || null; },

  /* Saving a contact also keeps Google Contacts in step:
       - a brand new contact is created in Google and linked back here
       - an edit to a linked contact is pushed to Google
     If Google refuses (no permission, offline) the CRM save still succeeds and
     the caller gets told via the returned `googleError`.                     */
  async saveContact(data, opts = {}) {
    const push = opts.pushToGoogle !== false;
    let googleError = null;
    const isNew = !data.ID;

    if (!isNew) {
      const i = this.contacts.findIndex(c => c.ID === data.ID);
      if (i < 0) return null;

      const before = this.contacts[i];
      const fieldsChanged = ['Name', 'Phone', 'Email', 'Address']
        .some(k => data[k] !== undefined && String(data[k] || '') !== String(before[k] || ''));

      this.contacts[i] = Object.assign(before, data);
      const rec = this.contacts[i];

      if (push && fieldsChanged && rec['Google ID']) {
        try { await People.update(rec['Google ID'], rec); }
        catch (e) { googleError = e.message; }
      }
      data = rec;
    } else {
      data.ID = this.newId('C');
      data.Created = this.today();

      if (push && !data['Google ID']) {
        try {
          const person = await People.create(data);
          data['Google ID'] = person.id;
        } catch (e) { googleError = e.message; }
      }
      this.contacts.push(data);
    }

    await Sheets.write('Contacts', this.contacts);
    data._googleError = googleError;
    return data;
  },

  /* Pull a batch of Google contacts into the CRM in one go.
     One sheet write for the whole batch, not one per person — 30 separate
     writes would be slow and burn quota for no reason. */
  async linkGoogleContacts(people, extra = {}) {
    const already = new Set(this.contacts.map(c => c['Google ID']).filter(Boolean));
    const added = [];

    people.forEach(p => {
      if (already.has(p.id)) return;
      already.add(p.id);
      added.push(Object.assign({
        ID: this.newId('C'),
        Name: p.name,
        Type: '',
        Phone: p.phone,
        Email: p.email,
        Address: p.address,
        Source: '',
        Tags: '',
        Notes: '',
        Created: this.today(),
        'Last Contacted': '',
        'Google ID': p.id,
      }, extra));
    });

    if (!added.length) return { added: 0, skipped: people.length };
    this.contacts = this.contacts.concat(added);
    await Sheets.write('Contacts', this.contacts);
    return { added: added.length, skipped: people.length - added.length };
  },

  /* Pull an existing Google contact into the CRM (no new Google record). */
  async linkGoogleContact(person, extra = {}) {
    const existing = this.contacts.find(c => c['Google ID'] === person.id);
    if (existing) return existing;

    return this.saveContact(Object.assign({
      Name: person.name,
      Phone: person.phone,
      Email: person.email,
      Address: person.address,
      Type: '',
      Source: '',
      Tags: '',
      Notes: '',
      'Google ID': person.id,
    }, extra), { pushToGoogle: false });
  },

  async deleteContact(id) {
    this.contacts = this.contacts.filter(c => c.ID !== id);
    this.deals = this.deals.filter(d => d['Contact ID'] !== id);
    this.activities = this.activities.filter(a => a['Contact ID'] !== id);
    await Sheets.write('Contacts', this.contacts);
    await Sheets.write('Deals', this.deals);
    await Sheets.write('Activities', this.activities);
  },

  async touchContact(id) {
    const c = this.contact(id);
    if (!c) return;
    c['Last Contacted'] = this.today();
    await Sheets.write('Contacts', this.contacts);
  },

  /* ------------------------------- deals -------------------------------- */

  deal(id) { return this.deals.find(d => d.ID === id) || null; },

  dealsFor(contactId) { return this.deals.filter(d => d['Contact ID'] === contactId); },

  async saveDeal(data) {
    if (data.ID) {
      const i = this.deals.findIndex(d => d.ID === data.ID);
      if (i >= 0) {
        if (data.Stage && data.Stage !== this.deals[i].Stage) {
          data['Stage Updated'] = this.today();
        }
        this.deals[i] = Object.assign(this.deals[i], data);
      }
    } else {
      data.ID = this.newId('D');
      data.Created = this.today();
      data['Stage Updated'] = this.today();
      this.deals.push(data);
    }
    await Sheets.write('Deals', this.deals);
    return data;
  },

  async moveDeal(id, stage) {
    const d = this.deal(id);
    if (!d || d.Stage === stage) return;
    d.Stage = stage;
    d['Stage Updated'] = this.today();
    await Sheets.write('Deals', this.deals);
  },

  async deleteDeal(id) {
    this.deals = this.deals.filter(d => d.ID !== id);
    this.activities = this.activities.filter(a => a['Deal ID'] !== id);
    await Sheets.write('Deals', this.deals);
    await Sheets.write('Activities', this.activities);
  },

  /* ----------------------------- activities ----------------------------- */

  activitiesFor({ contactId, dealId }) {
    return this.activities
      .filter(a => (dealId && a['Deal ID'] === dealId) ||
                   (contactId && a['Contact ID'] === contactId))
      .sort((a, b) => String(b.Date).localeCompare(String(a.Date)));
  },

  async addActivity(data) {
    data.ID = this.newId('A');
    if (!data.Date) data.Date = this.today();
    this.activities.push(data);
    await Sheets.write('Activities', this.activities);
    if (data['Contact ID']) await this.touchContact(data['Contact ID']);
    // Logging activity keeps a deal from looking stale.
    if (data['Deal ID']) {
      const d = this.deal(data['Deal ID']);
      if (d) { d['Stage Updated'] = this.today(); await Sheets.write('Deals', this.deals); }
    }
    return data;
  },

  async setActivityDone(id, done = true) {
    const a = this.activities.find(x => x.ID === id);
    if (!a) return null;
    a.Done = done ? 'yes' : '';
    await Sheets.write('Activities', this.activities);
    if (done && a['Contact ID']) await this.touchContact(a['Contact ID']);
    return a;
  },

  async deleteActivity(id) {
    this.activities = this.activities.filter(a => a.ID !== id);
    await Sheets.write('Activities', this.activities);
  },

  /* ------------------------------ helpers ------------------------------- */

  stagesFor(pipeline) {
    return (this.settings.pipelines && this.settings.pipelines[pipeline]) || [];
  },

  pipelineNames() { return Object.keys(this.settings.pipelines || {}); },

  daysSince(dateStr) {
    if (!dateStr) return null;
    const then = new Date(dateStr);
    if (isNaN(then)) return null;
    return Math.floor((Date.now() - then.getTime()) / 86400000);
  },

  isStale(deal) {
    if (CLOSED_STAGES.includes(deal.Stage)) return false;
    const d = this.daysSince(deal['Stage Updated'] || deal.Created);
    return d != null && d >= (CONFIG.STALE_DAYS || 14);
  },

  // Next upcoming activity for a deal (used on the card face).
  nextActivity(dealId) {
    const today = this.today();
    return this.activities
      .filter(a => a['Deal ID'] === dealId && a.Done !== 'yes' && a.Date >= today)
      .sort((a, b) => String(a.Date).localeCompare(String(b.Date)))[0] || null;
  },
};
