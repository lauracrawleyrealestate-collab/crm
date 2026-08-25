/* ==========================================================================
   app.js — views, board, drawers, and all the actions.
   ========================================================================== */

const App = {
  view: 'pipeline',
  pipeline: null,
  boardQuery: '',
  showClosed: false,
  contactQuery: '',
  contactFilter: '',
  contactMode: 'crm',        // 'crm' = people in the CRM, 'google' = whole address book
  googleContactsLoaded: false,

  /* ------------------------------- boot -------------------------------- */

  async boot() {
    this.bindChrome();

    try {
      Auth.init();
    } catch (e) {
      if (e.message === 'NO_CLIENT_ID') return this.showSigninError(
        'This app has not been connected to your Google account yet.',
        'Open js/config.js and paste your Google OAuth Client ID into GOOGLE_CLIENT_ID. ' +
        'The SETUP guide walks you through getting one.'
      );
      return this.showSigninError('Could not start Google sign-in.', e.message);
    }

    // Already have a live token from earlier this session? Go straight in.
    if (Auth.isSignedIn()) {
      try { return await this.start(); }
      catch (e) { console.error(e); }
    }
    $('#signin').hidden = false;
  },

  bindChrome() {
    $('#btn-signin').addEventListener('click', async () => {
      $('#signin-error').hidden = true;
      try {
        showLoader('Connecting to Google…');
        await Auth.signIn();
        await this.start();
      } catch (e) {
        hideLoader();
        this.showSigninError('Sign-in did not complete.', e.message);
      }
    });

    $('#tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (b) this.setView(b.dataset.view);
    });

    $('#btn-refresh').addEventListener('click', () => this.reload());
    $('#btn-user').addEventListener('click', () => this.accountMenu());
    $('#scrim').addEventListener('click', () => { closeDrawer(); Modal.close(null); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeDrawer(); Modal.close(null); }
    });

    $('#btn-new-deal').addEventListener('click', () => this.dealForm(null));
    $('#btn-new-contact').addEventListener('click', () => this.contactForm(null));

    $('#board-search').addEventListener('input', (e) => {
      this.boardQuery = e.target.value.toLowerCase(); this.renderBoard();
    });
    $('#show-closed').addEventListener('change', (e) => {
      this.showClosed = e.target.checked; this.renderBoard();
    });
    $('#contact-search').addEventListener('input', (e) => {
      this.contactQuery = e.target.value.toLowerCase(); this.renderContacts();
    });
    $('#contact-filter').addEventListener('change', (e) => {
      this.contactFilter = e.target.value; this.renderContacts();
    });
    $('#contact-seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmode]');
      if (!b) return;
      this.contactMode = b.dataset.cmode;
      $$('#contact-seg button').forEach(x =>
        x.classList.toggle('active', x.dataset.cmode === this.contactMode));
      if (this.contactMode === 'google' && !this.googleContactsLoaded) this.syncContacts();
      else this.renderContacts();
    });
    $('#btn-sync-contacts').addEventListener('click', () => this.syncContacts(true));

    // Delegated clicks for everything rendered dynamically.
    document.addEventListener('click', (e) => this.onDelegatedClick(e));
  },

  showSigninError(msg, detail) {
    hideLoader();
    $('#signin').hidden = false;
    const box = $('#signin-error');
    box.innerHTML = esc(msg) + (detail ? '<code>' + esc(detail) + '</code>' : '');
    box.hidden = false;
  },

  async start() {
    showLoader('Opening your CRM…');
    try {
      if (!Auth.user) await Auth.loadProfile();
      await Sheets.connect();
      await Store.loadAll();

      $('#signin').hidden = true;
      $('#app').hidden = false;
      $('#user-initial').textContent = initials(
        (Auth.user && (Auth.user.name || Auth.user.email)) || '?');

      if (!this.pipeline) this.pipeline = Store.pipelineNames()[0] || 'Buyer';
      this.renderPipelineSeg();
      this.renderContactFilter();
      this.setView(this.view);
      hideLoader();
      this.syncContacts();          // live Google Contacts, in the background
    } catch (e) {
      hideLoader();
      console.error(e);
      this.showSigninError('Could not open your CRM data.', e.message);
      throw e;
    }
  },

  async reload() {
    try {
      showLoader('Refreshing…');
      await Store.loadAll();
      this.renderPipelineSeg();
      this.renderContactFilter();
      this.render();
      hideLoader();
      toast('Up to date');
    } catch (e) { hideLoader(); toast(e.message, true); }
  },

  /* ------------------------------- views ------------------------------- */

  setView(v) {
    this.view = v;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
    ['pipeline', 'contacts', 'dashboard', 'settings']
      .forEach(name => { $('#view-' + name).hidden = (name !== v); });
    this.render();
  },

  render() {
    if (this.view === 'pipeline') this.renderBoard();
    else if (this.view === 'contacts') this.renderContacts();
    else if (this.view === 'dashboard') this.renderDashboard();
    else if (this.view === 'settings') this.renderSettings();
  },

  renderPipelineSeg() {
    const names = Store.pipelineNames();
    if (!names.includes(this.pipeline)) this.pipeline = names[0];
    $('#pipeline-seg').innerHTML = names.map(n =>
      '<button data-pipeline="' + esc(n) + '"' +
      (n === this.pipeline ? ' class="active"' : '') + '>' + esc(n) + '</button>').join('');
  },

  renderContactFilter() {
    const types = (Store.settings.contactTypes || []);
    $('#contact-filter').innerHTML = '<option value="">All types</option>' +
      types.map(t => '<option value="' + esc(t) + '"' +
        (t === this.contactFilter ? ' selected' : '') + '>' + esc(t) + '</option>').join('');
  },

  /* ------------------------------- board ------------------------------- */

  visibleDeals() {
    const q = this.boardQuery;
    return Store.deals.filter(d => {
      if (d.Pipeline !== this.pipeline) return false;
      if (!this.showClosed && CLOSED_STAGES.includes(d.Stage)) return false;
      if (!q) return true;
      const c = Store.contact(d['Contact ID']);
      const hay = [d['Deal Name'], d['Property Address'], c && c.Name, c && c.Email,
                   c && c.Phone, d.Notes].join(' ').toLowerCase();
      return hay.includes(q);
    });
  },

  renderBoard() {
    const stages = Store.stagesFor(this.pipeline);
    const deals = this.visibleDeals();
    const shown = this.showClosed ? stages : stages.filter(s => !CLOSED_STAGES.includes(s));

    $('#board').innerHTML = shown.map(stage => {
      const inStage = deals.filter(d => d.Stage === stage);
      const sum = inStage.reduce((t, d) => t + numeric(d.Value), 0);
      const commSum = inStage.reduce((t, d) => t + numeric(d.Commission), 0);
      return '<section class="col" data-stage="' + esc(stage) + '">' +
        '<div class="col-head">' +
          '<span class="col-title">' + esc(stage) + '</span>' +
          '<span class="col-count">' + inStage.length + '</span>' +
          '<span class="col-sum">' +
            (sum ? esc(money(sum)) : '') +
            (commSum ? ' <b>' + esc(money(commSum)) + '</b>' : '') +
          '</span>' +
        '</div>' +
        '<div class="col-body">' +
          (inStage.length ? inStage.map(d => this.cardHtml(d)).join('')
                          : '<div class="empty-col">Nothing here yet</div>') +
          '<button class="col-add" data-add-stage="' + esc(stage) + '">+ Add deal</button>' +
        '</div>' +
      '</section>';
    }).join('');

    this.bindDrag();
  },

  cardHtml(d) {
    const c = Store.contact(d['Contact ID']);
    const stale = Store.isStale(d);
    const days = Store.daysSince(d['Stage Updated'] || d.Created);
    const next = Store.nextActivity(d.ID);
    const price = money(d.Value);
    const comm = money(d.Commission);

    return '<article class="card' + (stale ? ' stale' : '') + '" draggable="true" ' +
      'data-deal="' + esc(d.ID) + '">' +
      '<div class="card-title">' + esc(d['Deal Name'] || '(untitled)') + '</div>' +
      (c ? '<div class="card-person">' + esc(c.Name) + '</div>' : '') +
      '<div class="card-meta">' +
        (price ? '<span class="card-price">' + esc(price) + '</span>' : '') +
        (comm ? '<span class="card-value" title="Your commission">' +
            esc(comm) + '</span>' : '') +
        (days != null ? '<span class="pill' + (stale ? ' warn' : '') + '">' +
            esc(relDays(days)) + ' in stage</span>' : '') +
        (d['Expected Close'] ? '<span class="pill info">closes ' +
            esc(niceDate(d['Expected Close'])) + '</span>' : '') +
      '</div>' +
      (next ? '<div class="card-next">▸ ' + esc(next.Type) + ' · ' +
          esc(niceDate(next.Date)) + '</div>' : '') +
    '</article>';
  },

  bindDrag() {
    let draggedId = null;

    $$('#board .card').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        draggedId = card.dataset.deal;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', draggedId); } catch (err) {}
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        $$('#board .col').forEach(c => c.classList.remove('drag-over'));
      });
    });

    $$('#board .col').forEach(col => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', (e) => {
        if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
      });
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const id = draggedId || e.dataTransfer.getData('text/plain');
        const stage = col.dataset.stage;
        if (!id) return;
        const deal = Store.deal(id);
        if (!deal || deal.Stage === stage) return;

        const prev = deal.Stage;
        deal.Stage = stage;              // optimistic — board feels instant
        deal['Stage Updated'] = Store.today();
        this.renderBoard();
        try {
          await Sheets.write('Deals', Store.deals);
          toast('Moved to ' + stage);
        } catch (err) {
          deal.Stage = prev;             // put it back if the save failed
          this.renderBoard();
          toast('Could not save the move: ' + err.message, true);
        }
      });
    });
  },

  /* ---------------------------- deal drawer ---------------------------- */

  openDeal(id) {
    const d = Store.deal(id);
    if (!d) return;
    const c = Store.contact(d['Contact ID']);
    const stages = Store.stagesFor(d.Pipeline);
    const acts = Store.activitiesFor({ dealId: d.ID });

    openDrawer(
      '<div class="drawer-head">' +
        '<div>' +
          '<h2>' + esc(d['Deal Name'] || '(untitled)') + '</h2>' +
          '<div class="sub">' + esc(d.Pipeline) + ' pipeline' +
            (c ? ' · ' + esc(c.Name) : '') + '</div>' +
        '</div>' +
        '<button class="icon-btn close-x" data-close>✕</button>' +
      '</div>' +

      '<div class="drawer-body">' +

        '<div class="sec">' +
          '<div class="field"><label>Stage</label>' +
            '<select data-stage-select="' + esc(d.ID) + '">' +
              stages.map(s => '<option' + (s === d.Stage ? ' selected' : '') + '>' +
                esc(s) + '</option>').join('') +
            '</select></div>' +
          '<div class="row-actions" style="margin-top:12px">' +
            '<button class="btn btn-sm" data-log="' + esc(d.ID) + '">Log activity</button>' +
            '<button class="btn btn-sm" data-schedule="' + esc(d.ID) + '">Schedule</button>' +
            (c && c.Email ? '<button class="btn btn-sm" data-email="' + esc(c.ID) +
              '" data-deal-ref="' + esc(d.ID) + '">Email</button>' : '') +
            '<button class="btn btn-sm" data-edit-deal="' + esc(d.ID) + '">Edit</button>' +
          '</div>' +
        '</div>' +

        '<div class="sec">' +
          '<h4>Deal details</h4>' +
          '<dl class="kv">' +
            this.kv('Contact', c ? '<a href="#" data-open-contact="' + esc(c.ID) + '">' +
              esc(c.Name) + '</a>' : '<span class="muted">none linked</span>', true) +
            this.kv('Phone', c && c.Phone ? '<a href="tel:' + esc(c.Phone) + '">' +
              esc(c.Phone) + '</a>' : '—', true) +
            this.kv('Email', c && c.Email ? '<a href="mailto:' + esc(c.Email) + '">' +
              esc(c.Email) + '</a>' : '—', true) +
            this.kv('Property', d['Property Address'] || '—') +
            this.kv('Sale price', money(d.Value) || '—') +
            this.kv('Commission', money(d.Commission) || '—') +
            (d.GST ? this.kv('GST', money(d.GST)) : '') +
            this.kv('Expected close', niceDate(d['Expected Close']) || '—') +
            (d['Closed Date'] ? this.kv('Closed', niceDate(d['Closed Date'])) : '') +
            this.kv('Created', niceDate(d.Created) || '—') +
            this.kv('In stage', relDays(Store.daysSince(d['Stage Updated'] || d.Created))) +
            (d.Notes ? this.kv('Notes', d.Notes) : '') +
          '</dl>' +
        '</div>' +

        '<div class="sec">' +
          '<h4>Activity' +
            '<button class="btn btn-sm" data-log="' + esc(d.ID) + '">+ Add</button></h4>' +
          (acts.length
            ? '<div class="timeline">' + acts.map(a => this.activityHtml(a)).join('') + '</div>'
            : '<div class="muted">No activity logged yet.</div>') +
        '</div>' +

        '<div class="sec">' +
          '<h4>Email' + (c && c.Email
            ? '<button class="btn btn-sm" data-load-mail="' + esc(c.Email) + '">Load</button>'
            : '') + '</h4>' +
          '<div id="mail-slot">' + (c && c.Email
            ? '<div class="muted">Click Load to pull recent threads with ' + esc(c.Email) + '.</div>'
            : '<div class="muted">Add an email address to this contact to see threads.</div>') +
          '</div>' +
        '</div>' +

        '<div class="sec">' +
          '<h4>Documents' +
            '<button class="btn btn-sm" data-upload="' + esc(d.ID) + '">Upload</button></h4>' +
          '<div id="docs-slot"><div class="muted">Loading…</div></div>' +
        '</div>' +

        '<div class="sec">' +
          '<div class="row-actions">' +
            '<button class="btn btn-danger btn-sm" data-del-deal="' + esc(d.ID) + '">Delete deal</button>' +
          '</div>' +
        '</div>' +

      '</div>'
    );

    this.loadDocs(d);
  },

  kv(label, value, raw) {
    return '<dt>' + esc(label) + '</dt><dd>' + (raw ? value : esc(value)) + '</dd>';
  },

  activityHtml(a) {
    return '<div class="tl-item">' +
      '<span class="tl-dot"></span>' +
      '<div class="tl-main">' +
        '<div>' + esc(a.Summary || a.Type) + '</div>' +
        '<div class="tl-meta">' + esc(a.Type) + ' · ' + esc(niceDate(a.Date)) +
          (a['Calendar Event ID'] ? ' · on calendar' : '') + '</div>' +
      '</div>' +
      '<button class="icon-btn tl-del" data-del-act="' + esc(a.ID) + '" title="Delete">✕</button>' +
    '</div>';
  },

  /* --------------------------- contact drawer -------------------------- */

  openContact(id) {
    const c = Store.contact(id);
    if (!c) return;
    const deals = Store.dealsFor(id);
    const acts = Store.activitiesFor({ contactId: id });

    openDrawer(
      '<div class="drawer-head">' +
        '<div class="avatar">' + esc(initials(c.Name)) + '</div>' +
        '<div>' +
          '<h2>' + esc(c.Name) + '</h2>' +
          '<div class="sub">' + esc(c.Type || 'Contact') +
            (c.Source ? ' · from ' + esc(c.Source) : '') + '</div>' +
        '</div>' +
        '<button class="icon-btn close-x" data-close>✕</button>' +
      '</div>' +

      '<div class="drawer-body">' +

        '<div class="sec">' +
          '<div class="row-actions">' +
            (c.Phone ? '<a class="btn btn-sm" href="tel:' + esc(c.Phone) + '">Call</a>' : '') +
            (c.Email ? '<button class="btn btn-sm" data-email="' + esc(c.ID) + '">Email</button>' : '') +
            '<button class="btn btn-sm" data-log-contact="' + esc(c.ID) + '">Log activity</button>' +
            '<button class="btn btn-sm" data-new-deal-for="' + esc(c.ID) + '">New deal</button>' +
            '<button class="btn btn-sm" data-edit-contact="' + esc(c.ID) + '">Edit</button>' +
          '</div>' +
        '</div>' +

        '<div class="sec">' +
          '<h4>Contact details</h4>' +
          '<dl class="kv">' +
            this.kv('Phone', c.Phone ? '<a href="tel:' + esc(c.Phone) + '">' +
              esc(c.Phone) + '</a>' : '—', true) +
            this.kv('Email', c.Email ? '<a href="mailto:' + esc(c.Email) + '">' +
              esc(c.Email) + '</a>' : '—', true) +
            this.kv('Address', c.Address || '—') +
            this.kv('Tags', c.Tags || '—') +
            this.kv('Added', niceDate(c.Created) || '—') +
            this.kv('Last contacted', niceDate(c['Last Contacted']) || '—') +
            this.kv('Google Contacts', c['Google ID']
              ? (c._missingInGoogle
                  ? '<span class="pill warn">no longer in Google</span>'
                  : '<span class="pill ok">linked — edits sync both ways</span>')
              : '<span class="muted">not linked</span>', true) +
            (c.Notes ? this.kv('Notes', c.Notes) : '') +
          '</dl>' +
        '</div>' +

        '<div class="sec">' +
          '<h4>Deals</h4>' +
          (deals.length ? '<div class="list-lite">' + deals.map(d =>
            '<div class="list-lite-row" data-open-deal="' + esc(d.ID) + '">' +
              '<span class="grow">' + esc(d['Deal Name']) + '</span>' +
              '<span class="pill">' + esc(d.Stage) + '</span>' +
              (money(d.Value) ? '<span class="card-value">' + esc(money(d.Value)) + '</span>' : '') +
            '</div>').join('') + '</div>'
            : '<div class="muted">No deals yet.</div>') +
        '</div>' +

        '<div class="sec">' +
          '<h4>Activity' +
            '<button class="btn btn-sm" data-log-contact="' + esc(c.ID) + '">+ Add</button></h4>' +
          (acts.length
            ? '<div class="timeline">' + acts.map(a => this.activityHtml(a)).join('') + '</div>'
            : '<div class="muted">No activity logged yet.</div>') +
        '</div>' +

        '<div class="sec">' +
          '<h4>Email' + (c.Email
            ? '<button class="btn btn-sm" data-load-mail="' + esc(c.Email) + '">Load</button>'
            : '') + '</h4>' +
          '<div id="mail-slot">' + (c.Email
            ? '<div class="muted">Click Load to pull recent threads.</div>'
            : '<div class="muted">No email address on file.</div>') + '</div>' +
        '</div>' +

        '<div class="sec">' +
          '<div class="row-actions">' +
            '<button class="btn btn-danger btn-sm" data-del-contact="' + esc(c.ID) +
              '">Delete contact</button>' +
          '</div>' +
        '</div>' +

      '</div>'
    );
  },

  /* ----------------------------- contacts ------------------------------ */

  /* Pull the live Google address book and fold it into the CRM records. */
  async syncContacts(loud) {
    $('#contact-filter').disabled = false;
    try {
      if (loud) showLoader('Reading Google Contacts…');
      const r = await People.syncInto(Store);
      this.googleContactsLoaded = true;
      if (loud) hideLoader();
      this.render();
      if (loud) toast(r.total + ' Google contacts · ' +
        (r.changed ? r.changed + ' field(s) refreshed' : 'everything already current'));
    } catch (e) {
      if (loud) hideLoader();
      this.googleContactsLoaded = false;
      if (loud || this.contactMode === 'google') {
        toast(People.available
          ? 'Could not read Google Contacts: ' + e.message
          : 'Contacts permission not granted yet — sign out and back in to allow it.', true);
      }
      this.renderContacts();
    }
  },

  renderContacts() {
    if (this.contactMode === 'google') return this.renderGoogleContacts();

    const q = this.contactQuery;
    let list = Store.contacts.slice();

    if (this.contactFilter) list = list.filter(c => c.Type === this.contactFilter);
    if (q) list = list.filter(c =>
      [c.Name, c.Email, c.Phone, c.Address, c.Tags, c.Notes, c.Source]
        .join(' ').toLowerCase().includes(q));

    list.sort((a, b) => String(a.Name || '').localeCompare(String(b.Name || '')));

    $('#contact-list').innerHTML = list.length ? list.map(c => {
      const open = Store.dealsFor(c.ID).filter(d => !CLOSED_STAGES.includes(d.Stage)).length;
      const sub = [c.Phone, c.Email, c.Address].filter(Boolean).join(' · ');
      return '<div class="contact-row" data-open-contact="' + esc(c.ID) + '">' +
        '<div class="avatar">' + esc(initials(c.Name)) + '</div>' +
        '<div class="contact-main">' +
          '<div class="contact-name">' + esc(c.Name) +
            (c['Google ID'] ? ' <span class="gdot" title="Linked to Google Contacts">●</span>' : '') +
          '</div>' +
          '<div class="contact-sub">' + esc(sub || '—') + '</div>' +
        '</div>' +
        '<div class="contact-right">' +
          (c.Type ? '<span class="pill">' + esc(c.Type) + '</span>' : '') +
          (open ? '<span class="pill ok">' + open + ' open</span>' : '') +
        '</div>' +
      '</div>';
    }).join('') : '<div class="panel"><div class="muted">' +
      (Store.contacts.length ? 'No contacts match that search.'
                             : 'No contacts yet — add one, or switch to All Google Contacts ' +
                               'and pull people in from your address book.') + '</div></div>';
  },

  renderGoogleContacts() {
    const q = this.contactQuery;
    const linked = {};
    Store.contacts.forEach(c => { if (c['Google ID']) linked[c['Google ID']] = c; });

    let list = (People._cache || []).slice();
    if (q) list = list.filter(p =>
      [p.name, p.email, p.phone, p.address, p.org].join(' ').toLowerCase().includes(q));

    if (!People._cache) {
      $('#contact-list').innerHTML =
        '<div class="panel"><div class="muted">Reading your Google Contacts…</div></div>';
      return;
    }

    $('#contact-list').innerHTML = list.length ? list.map(p => {
      const inCrm = linked[p.id];
      const sub = [p.phone, p.email, p.org].filter(Boolean).join(' · ');
      return '<div class="contact-row"' +
        (inCrm ? ' data-open-contact="' + esc(inCrm.ID) + '"' : '') + '>' +
        '<div class="avatar">' + esc(initials(p.name)) + '</div>' +
        '<div class="contact-main">' +
          '<div class="contact-name">' + esc(p.name || '(no name)') + '</div>' +
          '<div class="contact-sub">' + esc(sub || '—') + '</div>' +
        '</div>' +
        '<div class="contact-right">' +
          (inCrm
            ? '<span class="pill ok">In CRM</span>'
            : '<button class="btn btn-sm" data-link-google="' + esc(p.id) + '">+ Add to CRM</button>') +
        '</div>' +
      '</div>';
    }).join('') : '<div class="panel"><div class="muted">' +
      (People._cache.length ? 'No Google contacts match that search.'
                            : 'No contacts found in your Google account.') + '</div></div>';
  },

  async linkGoogle(personId) {
    const p = People.byId(personId);
    if (!p) return;
    try {
      showLoader('Adding ' + (p.name || 'contact') + '…');
      const saved = await Store.linkGoogleContact(p);
      hideLoader();
      this.render();
      this.openContact(saved.ID);
      toast('Added to your CRM');
    } catch (e) { hideLoader(); toast(e.message, true); }
  },

  /* ----------------------------- dashboard ----------------------------- */

  renderDashboard() {
    const open = Store.deals.filter(d => !CLOSED_STAGES.includes(d.Stage));
    const stale = open.filter(d => Store.isStale(d));
    const pipeValue = open.reduce((t, d) => t + numeric(d.Value), 0);
    const pipeComm = open.reduce((t, d) => t + numeric(d.Commission), 0);

    const now = new Date();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString().slice(0, 10);
    const closingSoon = open
      .filter(d => d['Expected Close'] && d['Expected Close'] <= monthEnd)
      .sort((a, b) => String(a['Expected Close']).localeCompare(String(b['Expected Close'])));

    const wonThisYear = Store.deals.filter(d =>
      d.Stage === 'Closed' && String(d['Stage Updated'] || '').startsWith(String(now.getFullYear())));

    const noActivity = Store.contacts.filter(c => {
      const days = Store.daysSince(c['Last Contacted'] || c.Created);
      return days != null && days >= 30;
    }).sort((a, b) => String(a['Last Contacted'] || '').localeCompare(String(b['Last Contacted'] || '')));

    const byStage = {};
    open.forEach(d => { byStage[d.Pipeline + ' · ' + d.Stage] =
      (byStage[d.Pipeline + ' · ' + d.Stage] || 0) + 1; });
    const maxStage = Math.max(1, ...Object.values(byStage));

    $('#dashboard').innerHTML =
      this.goalsPanel() +
      '<div class="panel panel-wide">' +
        '<h3>At a glance</h3>' +
        '<div class="stat-grid">' +
          this.stat(open.length, 'Open deals') +
          this.stat(money(pipeValue) || '$0', 'Pipeline volume') +
          this.stat(money(pipeComm) || '$0', 'Commission in play') +
          this.stat(closingSoon.length, 'Closing this month') +
          this.stat(stale.length, 'Need attention') +
          this.stat(Store.contacts.length, 'Contacts') +
          this.stat(wonThisYear.length, 'Closed in ' + now.getFullYear()) +
        '</div>' +
      '</div>' +

      '<div class="panel">' +
        '<h3>Deals by stage</h3>' +
        (Object.keys(byStage).length ? Object.entries(byStage).map(([k, v]) =>
          '<div class="bar-row">' +
            '<span class="bar-label">' + esc(k) + '</span>' +
            '<span class="bar-track"><span class="bar-fill" style="width:' +
              Math.round(v / maxStage * 100) + '%"></span></span>' +
            '<span class="bar-num">' + v + '</span>' +
          '</div>').join('') : '<div class="muted">No open deals.</div>') +
      '</div>' +

      '<div class="panel">' +
        '<h3>Closing this month</h3>' +
        (closingSoon.length ? '<div class="list-lite">' + closingSoon.map(d =>
          '<div class="list-lite-row" data-open-deal="' + esc(d.ID) + '">' +
            '<span class="grow">' + esc(d['Deal Name']) + '</span>' +
            '<span class="pill info">' + esc(niceDate(d['Expected Close'])) + '</span>' +
          '</div>').join('') + '</div>' : '<div class="muted">Nothing scheduled to close.</div>') +
      '</div>' +

      '<div class="panel">' +
        '<h3>Stalled ' + CONFIG.STALE_DAYS + '+ days</h3>' +
        (stale.length ? '<div class="list-lite">' + stale.map(d =>
          '<div class="list-lite-row" data-open-deal="' + esc(d.ID) + '">' +
            '<span class="grow">' + esc(d['Deal Name']) + '</span>' +
            '<span class="pill warn">' +
              esc(relDays(Store.daysSince(d['Stage Updated'] || d.Created))) + '</span>' +
          '</div>').join('') + '</div>' : '<div class="muted">Nothing stalled. Nice.</div>') +
      '</div>' +

      '<div class="panel">' +
        '<h3>Not contacted in 30+ days</h3>' +
        (noActivity.length ? '<div class="list-lite">' + noActivity.slice(0, 12).map(c =>
          '<div class="list-lite-row" data-open-contact="' + esc(c.ID) + '">' +
            '<span class="grow">' + esc(c.Name) + '</span>' +
            '<span class="pill">' + esc(niceDate(c['Last Contacted']) || 'never') + '</span>' +
          '</div>').join('') + '</div>' : '<div class="muted">Everyone is current.</div>') +
      '</div>';
  },

  stat(num, label) {
    return '<div class="stat"><div class="stat-num">' + esc(num) +
      '</div><div class="stat-label">' + esc(label) + '</div></div>';
  },

  /* --------------------------------------------------------------------
     Goal vs actual for the year. A deal counts once it reaches Closed;
     the year comes from its closing date, falling back to when it was
     moved to Closed.
     -------------------------------------------------------------------- */
  goalsPanel() {
    const g = Store.settings.goals;
    if (!g) return '';
    const year = String(g.year || new Date().getFullYear());

    const inYear = (d) => String(d['Closed Date'] || d['Stage Updated'] || '')
      .startsWith(year);
    const closed = Store.deals.filter(d => d.Stage === 'Closed' && inYear(d));

    const income = closed.reduce((t, d) => t + numeric(d.Commission), 0);
    const volume = closed.reduce((t, d) => t + numeric(d.Value), 0);
    const listings = closed.filter(d => d.Pipeline === 'Seller').length;
    const buyers = closed.filter(d => d.Pipeline === 'Buyer').length;

    const apptsOf = (type) => Store.activities.filter(a =>
      a.Type === type && String(a.Date || '').startsWith(year)).length;
    const listingAppts = apptsOf('Listing Appointment');
    const buyerAppts = apptsOf('Buyer Appointment');

    const rows = [
      ['Income (commission)', income, g.income, money],
      ['Transactions', closed.length, g.transactions, String],
      ['Listing sales', listings, g.listingSales, String],
      ['Buyer sales', buyers, g.buyerSales, String],
      ['Listing appointments', listingAppts, g.listingAppts, String],
      ['Buyer appointments', buyerAppts, g.buyerAppts, String],
    ];

    return '<div class="panel panel-wide">' +
      '<h3>' + esc(year) + ' goals — where you actually are</h3>' +
      rows.map(([label, actual, goal, fmt]) => {
        const pct = goal ? Math.round(actual / goal * 100) : 0;
        const cls = pct >= 100 ? ' over' : (pct >= 60 ? ' near' : '');
        return '<div class="goal-row">' +
          '<span class="goal-label">' + esc(label) + '</span>' +
          '<span class="bar-track"><span class="bar-fill' + cls + '" style="width:' +
            Math.min(100, pct) + '%"></span></span>' +
          '<span class="goal-num">' + esc(fmt(actual)) +
            ' <span class="muted">/ ' + esc(fmt(goal)) + '</span></span>' +
          '<span class="goal-pct' + cls + '">' + pct + '%</span>' +
        '</div>';
      }).join('') +
      '<div class="goal-foot">Closed volume this year: <b>' +
        esc(money(volume) || '$0') + '</b></div>' +
    '</div>';
  },

  /* ------------------------------ settings ----------------------------- */

  renderSettings() {
    const pipes = Store.settings.pipelines || {};
    $('#settings').innerHTML =
      Object.entries(pipes).map(([name, stages]) =>
        '<div class="panel">' +
          '<h3>' + esc(name) + ' pipeline stages</h3>' +
          '<div class="stage-list" data-pipe="' + esc(name) + '">' +
            stages.map((s, i) =>
              '<div class="stage-item">' +
                '<span class="stage-handle">⋮⋮</span>' +
                '<input value="' + esc(s) + '" data-stage-input="' + i + '">' +
                '<button class="icon-btn" data-stage-up="' + i + '" title="Move up">↑</button>' +
                '<button class="icon-btn" data-stage-down="' + i + '" title="Move down">↓</button>' +
                '<button class="icon-btn" data-stage-del="' + i + '" title="Remove">✕</button>' +
              '</div>').join('') +
          '</div>' +
          '<div class="row-actions">' +
            '<button class="btn btn-sm" data-stage-add="' + esc(name) + '">+ Add stage</button>' +
            '<button class="btn btn-primary btn-sm" data-stage-save="' + esc(name) +
              '">Save stages</button>' +
          '</div>' +
        '</div>').join('') +

      '<div class="panel">' +
        '<h3>Your data</h3>' +
        '<p class="muted" style="margin-top:0">Everything lives in a Google Sheet in your ' +
          'own Drive. You can open it, edit it, or download it any time — this app is just ' +
          'a nicer way to look at it.</p>' +
        '<div class="row-actions">' +
          '<a class="btn btn-sm" target="_blank" rel="noopener" href="' + esc(Sheets.url()) +
            '">Open the spreadsheet</a>' +
          '<button class="btn btn-sm" data-export>Download CSV backup</button>' +
        '</div>' +
      '</div>' +

      '<div class="panel">' +
        '<h3>Import past business</h3>' +
        '<p class="muted" style="margin-top:0">Pull deals, clients and appointments ' +
          'out of a sales-tracker spreadsheet. Nothing is written until you have seen ' +
          'a preview and said yes.</p>' +
        '<div class="row-actions">' +
          '<button class="btn btn-sm" data-import>Import from a spreadsheet…</button>' +
        '</div>' +
      '</div>' +

      '<div class="panel">' +
        '<h3>Account</h3>' +
        '<dl class="kv">' + this.kv('Signed in as',
          (Auth.user && Auth.user.email) || '—') + '</dl>' +
        '<div class="row-actions" style="margin-top:12px">' +
          '<button class="btn btn-sm" data-signout>Sign out</button>' +
        '</div>' +
      '</div>';
  },

  /* ------------------------------- forms ------------------------------- */

  contactOptions() {
    return Store.contacts
      .slice().sort((a, b) => String(a.Name).localeCompare(String(b.Name)))
      .map(c => ({ value: c.ID, label: c.Name }));
  },

  async contactForm(id) {
    const c = id ? Store.contact(id) : {};
    if (id && !c) return;
    const s = Store.settings;

    const data = await Modal.open({
      title: id ? 'Edit contact' : 'New contact',
      submitLabel: id ? 'Save changes' : 'Add contact',
      fields: [
        { name: 'Name', label: 'Name', value: c.Name, required: true },
        { name: 'Type', label: 'Type', type: 'select', options: s.contactTypes, value: c.Type },
        { name: 'Phone', label: 'Phone', type: 'tel', value: c.Phone },
        { name: 'Email', label: 'Email', type: 'email', value: c.Email },
        { name: 'Address', label: 'Address', value: c.Address,
          placeholder: 'e.g. 123 Maple St NW, Edmonton' },
        { name: 'Source', label: 'Where did they come from?', type: 'select',
          options: s.sources, value: c.Source, allowBlank: true },
        { name: 'Tags', label: 'Tags', value: c.Tags, placeholder: 'first-time buyer, west end' },
        { name: 'Notes', label: 'Notes', type: 'textarea', value: c.Notes },
      ],
    });
    if (!data) return;

    try {
      showLoader('Saving…');
      const saved = await Store.saveContact(Object.assign({ ID: id || '' }, data));
      hideLoader();
      this.render();
      if (!$('#drawer').hidden) this.openContact(saved.ID);
      if (saved._googleError) {
        toast('Saved to your CRM, but Google Contacts did not update: ' +
              saved._googleError, true);
      } else {
        toast(id ? 'Contact updated in CRM and Google'
                 : 'Contact added to CRM and Google Contacts');
      }
    } catch (e) { hideLoader(); toast(e.message, true); }
  },

  async dealForm(id, presets = {}) {
    const d = id ? Store.deal(id) : {};
    if (id && !d) return;

    const pipeline = d.Pipeline || presets.Pipeline || this.pipeline;
    const stages = Store.stagesFor(pipeline);

    const data = await Modal.open({
      title: id ? 'Edit deal' : 'New deal',
      submitLabel: id ? 'Save changes' : 'Create deal',
      fields: [
        { name: 'Deal Name', label: 'Deal name', value: d['Deal Name'],
          required: true, placeholder: 'e.g. 123 Maple St — Purchase' },
        { name: 'Contact ID', label: 'Contact', type: 'select', allowBlank: true,
          options: this.contactOptions(), value: d['Contact ID'] || presets['Contact ID'] },
        { name: 'Pipeline', label: 'Pipeline', type: 'select',
          options: Store.pipelineNames(), value: pipeline },
        { name: 'Stage', label: 'Stage', type: 'select', options: stages,
          value: d.Stage || presets.Stage || stages[0] },
        { name: 'Value', label: 'Sale price', value: d.Value, placeholder: '450000' },
        { name: 'Commission', label: 'Your commission', value: d.Commission, placeholder: '9400' },
        { name: 'GST', label: 'GST', value: d.GST },
        { name: 'Property Address', label: 'Property address', value: d['Property Address'] },
        { name: 'Expected Close', label: 'Expected close date', type: 'date',
          value: d['Expected Close'] },
        { name: 'Closed Date', label: 'Actual closing date', type: 'date',
          value: d['Closed Date'] },
        { name: 'Notes', label: 'Notes', type: 'textarea', value: d.Notes },
      ],
      onRender: (form) => {
        // Swap the stage list when the pipeline changes.
        form.elements['Pipeline'].addEventListener('change', (e) => {
          const list = Store.stagesFor(e.target.value);
          form.elements['Stage'].innerHTML = list
            .map(s => '<option>' + esc(s) + '</option>').join('');
        });
      },
    });
    if (!data) return;

    try {
      showLoader('Saving…');
      const saved = await Store.saveDeal(Object.assign({ ID: id || '' }, data));
      hideLoader();
      if (saved.Pipeline) this.pipeline = saved.Pipeline;
      this.renderPipelineSeg();
      this.render();
      if (!$('#drawer').hidden) this.openDeal(saved.ID);
      toast(id ? 'Deal updated' : 'Deal created');
    } catch (e) { hideLoader(); toast(e.message, true); }
  },

  async logActivity({ dealId, contactId }) {
    const deal = dealId ? Store.deal(dealId) : null;
    if (deal && !contactId) contactId = deal['Contact ID'];

    const data = await Modal.open({
      title: 'Log activity',
      submitLabel: 'Save',
      fields: [
        { name: 'Type', label: 'Type', type: 'select',
          options: Store.settings.activityTypes, value: 'Call' },
        { name: 'Date', label: 'Date', type: 'date', value: Store.today(), required: true },
        { name: 'Summary', label: 'What happened?', type: 'textarea', required: true,
          placeholder: 'Left voicemail about the Tuesday showing…' },
      ],
    });
    if (!data) return;

    try {
      showLoader('Saving…');
      await Store.addActivity({
        'Contact ID': contactId || '', 'Deal ID': dealId || '',
        Type: data.Type, Date: data.Date, Summary: data.Summary,
        'Gmail Thread ID': '', 'Calendar Event ID': '', Done: 'yes',
      });
      hideLoader();
      this.render();
      if (dealId) this.openDeal(dealId); else if (contactId) this.openContact(contactId);
      toast('Activity logged');
    } catch (e) { hideLoader(); toast(e.message, true); }
  },

  async scheduleForm(dealId) {
    const d = Store.deal(dealId);
    if (!d) return;
    const c = Store.contact(d['Contact ID']);

    const now = new Date(Date.now() + 3600000);
    const defaultLocal = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 16);

    const data = await Modal.open({
      title: 'Add to your Google Calendar',
      submitLabel: 'Create event',
      fields: [
        { name: 'Type', label: 'Type', type: 'select',
          options: ['Showing', 'Call', 'Meeting', 'Listing Appointment', 'Closing'],
          value: 'Showing' },
        { name: 'title', label: 'Title', required: true,
          value: (d['Deal Name'] || '') + (c ? ' — ' + c.Name : '') },
        { name: 'start', label: 'Starts', type: 'datetime-local',
          value: defaultLocal, required: true },
        { name: 'minutes', label: 'Length (minutes)', type: 'number', value: '60' },
        { name: 'location', label: 'Location', value: d['Property Address'] || '' },
        { name: 'invite', label: 'Invite the contact by email?', type: 'select',
          options: ['No', 'Yes'], value: 'No' },
      ],
    });
    if (!data) return;

    try {
      showLoader('Creating calendar event…');
      const ev = await CalendarApi.create({
        title: data.title,
        description: 'Created from Crawley CRM',
        startISO: data.start,
        minutes: Number(data.minutes) || 60,
        location: data.location,
        attendeeEmail: (data.invite === 'Yes' && c && c.Email) ? c.Email : null,
      });
      await Store.addActivity({
        'Contact ID': d['Contact ID'] || '', 'Deal ID': d.ID,
        Type: data.Type, Date: String(data.start).slice(0, 10),
        Summary: data.title, 'Gmail Thread ID': '',
        'Calendar Event ID': ev.id || '', Done: '',
      });
      hideLoader();
      this.render();
      this.openDeal(d.ID);
      toast('Added to your calendar');
    } catch (e) { hideLoader(); toast(e.message, true); }
  },

  async emailForm(contactId, dealId) {
    const c = Store.contact(contactId);
    if (!c || !c.Email) return toast('No email address on file.', true);

    const data = await Modal.open({
      title: 'Email ' + c.Name,
      submitLabel: 'Send',
      fields: [
        { name: 'to', label: 'To', value: c.Email, required: true },
        { name: 'subject', label: 'Subject', required: true },
        { name: 'body', label: 'Message', type: 'textarea', required: true },
      ],
    });
    if (!data) return;

    try {
      showLoader('Sending…');
      await GmailApi.send(data);
      await Store.addActivity({
        'Contact ID': c.ID, 'Deal ID': dealId || '', Type: 'Email',
        Date: Store.today(), Summary: 'Sent: ' + data.subject,
        'Gmail Thread ID': '', 'Calendar Event ID': '', Done: 'yes',
      });
      hideLoader();
      this.render();
      if (dealId) this.openDeal(dealId); else this.openContact(c.ID);
      toast('Email sent — it is in your Gmail Sent folder');
    } catch (e) { hideLoader(); toast(e.message, true); }
  },

  /* --------------------------- gmail / drive --------------------------- */

  async loadMail(email) {
    const slot = $('#mail-slot');
    if (!slot) return;
    slot.innerHTML = '<div class="muted">Searching Gmail…</div>';
    try {
      const threads = await GmailApi.threadsWith(email);
      slot.innerHTML = threads.length ? threads.map(t =>
        '<a class="thread" href="' + esc(t.link) + '" target="_blank" rel="noopener">' +
          '<div class="thread-sub">' + esc(t.subject) +
            (t.count > 1 ? ' <span class="pill">' + t.count + '</span>' : '') + '</div>' +
          '<div class="thread-snip">' + esc(t.snippet) + '</div>' +
          '<div class="tl-meta">' + esc(t.date) + '</div>' +
        '</a>').join('') : '<div class="muted">No threads found with ' + esc(email) + '.</div>';
    } catch (e) {
      slot.innerHTML = '<div class="muted">Could not load Gmail: ' + esc(e.message) + '</div>';
    }
  },

  async dealFolderId(deal) {
    const root = await Drive.ensureFolder(CONFIG.DOCS_FOLDER_NAME);
    const tag = '[' + deal.ID + ']';
    const q = encodeURIComponent("name contains '" + tag + "' and trashed=false and " +
      "mimeType='application/vnd.google-apps.folder'");
    const r = await api('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name)');
    if (r.files && r.files.length) return r.files[0].id;
    const made = await Drive.createFolder(
      (deal['Deal Name'] || 'Deal') + ' ' + tag, root);
    return made.id;
  },

  async loadDocs(deal) {
    const slot = $('#docs-slot');
    if (!slot) return;
    try {
      const folderId = await this.dealFolderId(deal);
      const files = await Drive.listFolder(folderId);
      const cur = $('#docs-slot');
      if (!cur) return;
      cur.innerHTML = files.length ? files.map(f =>
        '<a class="thread" href="' + esc(f.webViewLink) + '" target="_blank" rel="noopener">' +
          '<div class="thread-sub">' + esc(f.name) + '</div>' +
          '<div class="tl-meta">' + esc(niceDate(f.modifiedTime)) + '</div>' +
        '</a>').join('') : '<div class="muted">No documents yet.</div>';
    } catch (e) {
      const cur = $('#docs-slot');
      if (cur) cur.innerHTML = '<div class="muted">Could not load documents: ' +
        esc(e.message) + '</div>';
    }
  },

  uploadDoc(dealId) {
    const deal = Store.deal(dealId);
    if (!deal) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.addEventListener('change', async () => {
      if (!input.files.length) return;
      try {
        showLoader('Uploading to Google Drive…');
        const folderId = await this.dealFolderId(deal);
        for (const f of Array.from(input.files)) await Drive.uploadFile(f, folderId);
        hideLoader();
        this.loadDocs(deal);
        toast(input.files.length + ' file(s) uploaded');
      } catch (e) { hideLoader(); toast(e.message, true); }
    });
    input.click();
  },

  /* ------------------------------- export ------------------------------ */

  exportCsv() {
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const block = (title, headers, rows) =>
      title + '\n' + headers.map(q).join(',') + '\n' +
      rows.map(r => headers.map(h => q(r[h])).join(',')).join('\n') + '\n\n';

    const csv =
      block('CONTACTS', TABS.Contacts, Store.contacts) +
      block('DEALS', TABS.Deals, Store.deals) +
      block('ACTIVITIES', TABS.Activities, Store.activities);

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'crm-backup-' + Store.today() + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },

  accountMenu() { this.setView('settings'); },

  /* ------------------------------ import ------------------------------ */

  async importForm() {
    const data = await Modal.open({
      title: 'Import from a spreadsheet',
      submitLabel: 'Read it',
      fields: [
        { name: 'url', label: 'Google Sheets link (or file ID)', required: true,
          value: this._lastImportUrl || '',
          placeholder: 'https://docs.google.com/spreadsheets/d/…' },
      ],
      onRender: (form) => {
        const p = document.createElement('p');
        p.className = 'muted';
        p.style.margin = '0';
        p.textContent = 'It looks for quarterly sales tabs (any tab with "Qtr" or ' +
          '"Quarter" in the name) and an appointment tab. You will see exactly what ' +
          'it plans to create before anything is saved.';
        $('.modal-body', form).prepend(p);
      },
    });
    if (!data) return;
    this._lastImportUrl = data.url;

    try {
      showLoader('Reading the spreadsheet…');
      const plan = await Importer.plan(data.url);
      this._importPlan = plan;
      hideLoader();
      this.showImportPreview(plan);
    } catch (e) {
      hideLoader();
      toast('Could not read that spreadsheet: ' + e.message, true);
    }
  },

  showImportPreview(plan) {
    const t = plan.totals;
    const merged = plan.contacts.filter(c => c.aliases.length);

    openDrawer(
      '<div class="drawer-head">' +
        '<div>' +
          '<h2>Import preview</h2>' +
          '<div class="sub">Nothing has been saved yet</div>' +
        '</div>' +
        '<button class="icon-btn close-x" data-close>✕</button>' +
      '</div>' +

      '<div class="drawer-body">' +

        '<div class="sec">' +
          '<div class="stat-grid">' +
            this.stat(t.deals, 'Deals to add') +
            this.stat(t.newContacts, 'New contacts') +
            this.stat(plan.appointments.length, 'Appointments') +
            this.stat(money(t.volume) || '$0', 'Volume') +
            this.stat(money(t.commission) || '$0', 'Commission') +
            (t.skipped ? this.stat(t.skipped, 'Already in CRM') : '') +
          '</div>' +
          '<div class="row-actions" style="margin-top:14px">' +
            '<button class="btn btn-primary" data-run-import>Import it</button>' +
            '<button class="btn" data-close>Cancel</button>' +
          '</div>' +
          '<div class="muted" style="margin-top:8px">Read from: ' +
            esc(plan.salesTabs.join(', ')) +
            (plan.apptTab ? ' · ' + esc(plan.apptTab) : '') + '</div>' +
        '</div>' +

        (merged.length ? '<div class="sec">' +
          '<h4>Repeat clients found</h4>' +
          '<p class="muted" style="margin-top:0">These rows are the same people ' +
            'spelled differently, so they become one contact with several deals. ' +
            'Check I have not merged two different people.</p>' +
          '<div class="list-lite">' + merged.map(c =>
            '<div class="list-lite-row">' +
              '<span class="grow"><b>' + esc(c.name) + '</b> ' +
                '<span class="muted">← ' + esc(c.aliases.join(' · ')) + '</span></span>' +
              '<span class="pill">' + c.dealCount + ' deals</span>' +
            '</div>').join('') + '</div>' +
        '</div>' : '') +

        '<div class="sec">' +
          '<h4>Sources — tidied up</h4>' +
          '<p class="muted" style="margin-top:0">The messy originals are kept on each ' +
            'contact\'s tags, so you do not lose who referred whom.</p>' +
          '<div class="list-lite">' + plan.sourceMapping.map(([clean, originals]) =>
            '<div class="list-lite-row">' +
              '<span class="pill ok">' + esc(clean) + '</span>' +
              '<span class="grow muted">' + esc(originals.join(' · ')) + '</span>' +
            '</div>').join('') + '</div>' +
        '</div>' +

        '<div class="sec">' +
          '<h4>Deals</h4>' +
          '<div class="list-lite">' + plan.deals.map(d =>
            '<div class="list-lite-row' + (d.duplicate ? ' dim' : '') + '">' +
              '<span class="pill' + (d.pipeline === 'Seller' ? '' : ' info') + '">' +
                esc(d.pipeline) + '</span>' +
              '<span class="grow">' + esc(d.name) +
                ' <span class="muted">· ' + esc(d.contact || 'no name') + '</span></span>' +
              '<span class="muted">' + esc(d.written || '?') + '</span>' +
              '<span class="card-price">' + esc(money(d.price) || '—') + '</span>' +
              '<span class="card-value">' + esc(money(d.commission) || '—') + '</span>' +
              (d.duplicate ? '<span class="pill">already in</span>' : '') +
            '</div>').join('') + '</div>' +
        '</div>' +

        (plan.warnings.length ? '<div class="sec">' +
          '<h4>Worth a look (' + plan.warnings.length + ')</h4>' +
          '<div class="list-lite">' + plan.warnings.map(w =>
            '<div class="list-lite-row"><span class="pill warn">check</span>' +
            '<span class="grow">' + esc(w) + '</span></div>').join('') + '</div>' +
        '</div>' : '') +

      '</div>'
    );
  },

  async runImport() {
    const plan = this._importPlan;
    if (!plan) return;
    try {
      showLoader('Importing…');
      const r = await Importer.apply(plan, (msg) => { $('#loader-text').textContent = msg; });
      await Store.loadAll();
      hideLoader();
      closeDrawer();
      this._importPlan = null;
      this.renderPipelineSeg();
      this.renderContactFilter();
      this.setView('dashboard');
      toast('Imported ' + r.deals + ' deals and ' + r.activities + ' appointments');
    } catch (e) {
      hideLoader();
      toast('Import failed partway: ' + e.message + ' — check the spreadsheet before retrying.', true);
    }
  },

  /* -------------------------- event delegation ------------------------- */

  onDelegatedClick(e) {
    const t = e.target;
    const hit = (attr) => { const n = t.closest('[' + attr + ']'); return n && n.getAttribute(attr); };

    if (t.closest('[data-close]')) return closeDrawer();

    const openDealId = hit('data-open-deal');
    if (openDealId) return this.openDeal(openDealId);

    const openContactId = hit('data-open-contact');
    if (openContactId) { e.preventDefault(); return this.openContact(openContactId); }

    const addStage = hit('data-add-stage');
    if (addStage) return this.dealForm(null, { Stage: addStage, Pipeline: this.pipeline });

    const cardId = t.closest('.card') && t.closest('.card').dataset.deal;
    if (cardId) return this.openDeal(cardId);

    const pipe = hit('data-pipeline');
    if (pipe) { this.pipeline = pipe; this.renderPipelineSeg(); return this.renderBoard(); }

    const logDeal = hit('data-log');
    if (logDeal) return this.logActivity({ dealId: logDeal });

    const logContact = hit('data-log-contact');
    if (logContact) return this.logActivity({ contactId: logContact });

    const sched = hit('data-schedule');
    if (sched) return this.scheduleForm(sched);

    const mailBtn = t.closest('[data-email]');
    if (mailBtn) return this.emailForm(mailBtn.getAttribute('data-email'),
                                       mailBtn.getAttribute('data-deal-ref'));

    const loadMail = hit('data-load-mail');
    if (loadMail) return this.loadMail(loadMail);

    const upload = hit('data-upload');
    if (upload) return this.uploadDoc(upload);

    const editDeal = hit('data-edit-deal');
    if (editDeal) return this.dealForm(editDeal);

    const editContact = hit('data-edit-contact');
    if (editContact) return this.contactForm(editContact);

    const linkG = hit('data-link-google');
    if (linkG) { e.stopPropagation(); return this.linkGoogle(linkG); }

    const newDealFor = hit('data-new-deal-for');
    if (newDealFor) return this.dealForm(null, { 'Contact ID': newDealFor });

    const delDeal = hit('data-del-deal');
    if (delDeal) return this.removeDeal(delDeal);

    const delContact = hit('data-del-contact');
    if (delContact) return this.removeContact(delContact);

    const delAct = hit('data-del-act');
    if (delAct) return this.removeActivity(delAct);

    if (t.closest('[data-export]')) return this.exportCsv();
    if (t.closest('[data-import]')) return this.importForm();
    if (t.closest('[data-run-import]')) return this.runImport();
    if (t.closest('[data-signout]')) return this.doSignOut();

    // ---- settings stage editing ----
    const panel = t.closest('.panel');
    const list = panel && $('.stage-list', panel);

    const up = hit('data-stage-up');
    if (up !== null && up !== false && list) return this.moveStage(list, Number(up), -1);
    const down = hit('data-stage-down');
    if (down !== null && down !== false && list) return this.moveStage(list, Number(down), 1);
    const del = hit('data-stage-del');
    if (del !== null && del !== false && list) return this.removeStage(list, Number(del));

    const addTo = hit('data-stage-add');
    if (addTo) return this.addStage(addTo);
    const saveTo = hit('data-stage-save');
    if (saveTo) return this.saveStages(saveTo, list);
  },

  onDelegatedChange(e) {
    const sel = e.target.closest('[data-stage-select]');
    if (!sel) return;
    const id = sel.getAttribute('data-stage-select');
    Store.moveDeal(id, sel.value)
      .then(() => { this.render(); toast('Moved to ' + sel.value); })
      .catch(err => toast(err.message, true));
  },

  /* ----------------------------- destructive --------------------------- */

  async removeDeal(id) {
    const d = Store.deal(id);
    if (!d) return;
    if (!await confirmBox('Delete "' + (d['Deal Name'] || 'this deal') +
      '" and its activity? Documents in Drive are kept.')) return;
    try {
      showLoader('Deleting…');
      await Store.deleteDeal(id);
      hideLoader(); closeDrawer(); this.render(); toast('Deal deleted');
    } catch (e) { hideLoader(); toast(e.message, true); }
  },

  async removeContact(id) {
    const c = Store.contact(id);
    if (!c) return;
    const n = Store.dealsFor(id).length;
    if (!await confirmBox('Delete ' + c.Name +
      (n ? ' and their ' + n + ' deal(s)' : '') + '? This cannot be undone.')) return;
    try {
      showLoader('Deleting…');
      await Store.deleteContact(id);
      hideLoader(); closeDrawer(); this.render(); toast('Contact deleted');
    } catch (e) { hideLoader(); toast(e.message, true); }
  },

  async removeActivity(id) {
    const a = Store.activities.find(x => x.ID === id);
    try {
      await Store.deleteActivity(id);
      if (a && a['Deal ID']) this.openDeal(a['Deal ID']);
      else if (a && a['Contact ID']) this.openContact(a['Contact ID']);
      this.render();
      toast('Activity removed');
    } catch (e) { toast(e.message, true); }
  },

  doSignOut() {
    Auth.signOut();
    location.reload();
  },

  /* --------------------------- stage settings -------------------------- */

  readStages(list) {
    return $$('[data-stage-input]', list).map(i => i.value.trim()).filter(Boolean);
  },

  moveStage(list, index, dir) {
    const stages = this.readStages(list);
    const to = index + dir;
    if (to < 0 || to >= stages.length) return;
    [stages[index], stages[to]] = [stages[to], stages[index]];
    this.paintStages(list, stages);
  },

  removeStage(list, index) {
    const stages = this.readStages(list);
    stages.splice(index, 1);
    this.paintStages(list, stages);
  },

  addStage(pipeName) {
    const list = $('.stage-list[data-pipe="' + pipeName + '"]');
    if (!list) return;
    const stages = this.readStages(list);
    stages.push('New stage');
    this.paintStages(list, stages);
    const inputs = $$('[data-stage-input]', list);
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  },

  paintStages(list, stages) {
    list.innerHTML = stages.map((s, i) =>
      '<div class="stage-item">' +
        '<span class="stage-handle">⋮⋮</span>' +
        '<input value="' + esc(s) + '" data-stage-input="' + i + '">' +
        '<button class="icon-btn" data-stage-up="' + i + '" title="Move up">↑</button>' +
        '<button class="icon-btn" data-stage-down="' + i + '" title="Move down">↓</button>' +
        '<button class="icon-btn" data-stage-del="' + i + '" title="Remove">✕</button>' +
      '</div>').join('');
  },

  async saveStages(pipeName, list) {
    if (!list) list = $('.stage-list[data-pipe="' + pipeName + '"]');
    const stages = this.readStages(list);
    if (!stages.length) return toast('A pipeline needs at least one stage.', true);

    // Any deal sitting in a stage that no longer exists moves to the first stage.
    const orphans = Store.deals.filter(d => d.Pipeline === pipeName && !stages.includes(d.Stage));
    if (orphans.length && !await confirmBox(
      orphans.length + ' deal(s) are in a stage you removed. Move them to "' +
      stages[0] + '"?')) return;

    try {
      showLoader('Saving stages…');
      Store.settings.pipelines[pipeName] = stages;
      await Store.saveSettings();
      if (orphans.length) {
        orphans.forEach(d => { d.Stage = stages[0]; d['Stage Updated'] = Store.today(); });
        await Sheets.write('Deals', Store.deals);
      }
      hideLoader();
      this.renderPipelineSeg();
      this.renderSettings();
      toast('Stages saved');
    } catch (e) { hideLoader(); toast(e.message, true); }
  },
};

/* --------------------------------- go ------------------------------------ */

document.addEventListener('change', (e) => App.onDelegatedChange(e));

window.addEventListener('load', () => {
  // Give the Google script a moment if it is still arriving.
  const tryBoot = (attempt = 0) => {
    if (window.google && google.accounts && google.accounts.oauth2) return App.boot();
    if (attempt > 40) return App.boot();   // will surface a clear error
    setTimeout(() => tryBoot(attempt + 1), 100);
  };
  tryBoot();
});
