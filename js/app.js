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
  picked: new Set(),         // Google contacts ticked for a bulk add
  calWeek: null,             // Monday of the week on screen (ISO date)
  calEvents: [],             // Google Calendar events for that week
  calState: 'idle',          // idle | loading | error
  calError: '',

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
      if (this.contactMode !== 'google') this.picked.clear();
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
    ['pipeline', 'contacts', 'calendar', 'dashboard', 'settings']
      .forEach(name => { $('#view-' + name).hidden = (name !== v); });
    if (v === 'calendar' && !this.calWeek) this.calWeek = weekStart(todayISO());
    this.render();
    // Entering the calendar always re-reads Google, so it reflects anything
    // scheduled from her phone or by someone else since she last looked.
    if (v === 'calendar') this.loadWeek();
  },

  render() {
    if (this.view === 'pipeline') this.renderBoard();
    else if (this.view === 'contacts') this.renderContacts();
    else if (this.view === 'calendar') this.renderCalendar();
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

    if (!People._cache) {
      $('#contact-list').innerHTML =
        '<div class="panel"><div class="muted">Reading your Google Contacts…</div></div>';
      return;
    }

    let list = People._cache.slice();
    if (q) list = list.filter(p =>
      [p.name, p.email, p.phone, p.address, p.org].join(' ').toLowerCase().includes(q));

    const addable = list.filter(p => !linked[p.id]);
    const picked = this.picked.size;

    const bar =
      '<div class="selbar">' +
        (picked
          ? '<span class="selcount"><b>' + picked + '</b> selected</span>'
          : '<span class="muted">Tick the people who belong in your pipeline</span>') +
        '<span class="grow"></span>' +
        (addable.length
          ? '<button class="btn btn-sm" data-sel-all>Select all ' + addable.length +
            (q ? ' matching' : '') + '</button>'
          : '') +
        (picked ? '<button class="btn btn-sm" data-sel-none>Clear</button>' : '') +
        (picked ? '<button class="btn btn-primary btn-sm" data-bulk-add>Add ' + picked +
            ' to CRM</button>' : '') +
      '</div>';

    const rows = list.length ? list.map(p => {
      const inCrm = linked[p.id];
      const sub = [p.phone, p.email, p.org].filter(Boolean).join(' · ');
      const on = this.picked.has(p.id);
      return '<div class="contact-row' + (on ? ' picked' : '') + '"' +
        (inCrm ? ' data-open-contact="' + esc(inCrm.ID) + '"' : '') + '>' +
        (inCrm
          ? '<span class="pick-spacer"></span>'
          : '<label class="pick"><input type="checkbox" data-pick="' + esc(p.id) + '"' +
            (on ? ' checked' : '') + '></label>') +
        '<div class="avatar">' + esc(initials(p.name)) + '</div>' +
        '<div class="contact-main">' +
          '<div class="contact-name">' + esc(p.name || '(no name)') + '</div>' +
          '<div class="contact-sub">' + esc(sub || '—') + '</div>' +
        '</div>' +
        '<div class="contact-right">' +
          (inCrm
            ? '<span class="pill ok">In CRM</span>'
            : '<button class="btn btn-sm" data-link-google="' + esc(p.id) + '">+ Add</button>') +
        '</div>' +
      '</div>';
    }).join('') : '<div class="panel"><div class="muted">' +
      (People._cache.length ? 'No Google contacts match that search.'
                            : 'No contacts found in your Google account.') + '</div></div>';

    $('#contact-list').innerHTML = bar + rows;
  },

  togglePick(id) {
    if (this.picked.has(id)) this.picked.delete(id);
    else this.picked.add(id);
    this.renderGoogleContacts();
  },

  selectAllShown() {
    const q = this.contactQuery;
    const linked = new Set(Store.contacts.map(c => c['Google ID']).filter(Boolean));
    (People._cache || [])
      .filter(p => !linked.has(p.id))
      .filter(p => !q || [p.name, p.email, p.phone, p.address, p.org]
        .join(' ').toLowerCase().includes(q))
      .forEach(p => this.picked.add(p.id));
    this.renderGoogleContacts();
  },

  clearPicks() { this.picked.clear(); this.renderGoogleContacts(); },

  /* Add every ticked Google contact at once, with one shared type/source. */
  async bulkAddGoogle() {
    const people = (People._cache || []).filter(p => this.picked.has(p.id));
    if (!people.length) return;

    const s = Store.settings;
    const data = await Modal.open({
      title: 'Add ' + people.length + ' contacts to your CRM',
      submitLabel: 'Add them',
      fields: [
        { name: 'Type', label: 'Type — applied to all of them', type: 'select',
          options: s.contactTypes, value: 'Past Client', allowBlank: true },
        { name: 'Source', label: 'Where they came from', type: 'select',
          options: s.sources, allowBlank: true },
        { name: 'Tags', label: 'Tags', placeholder: 'e.g. address book import' },
      ],
      onRender: (form) => {
        const p = document.createElement('p');
        p.className = 'muted';
        p.style.margin = '0';
        p.textContent = 'Their names, phones, emails and addresses keep coming from ' +
          'Google — this only adds the CRM layer on top. Nothing is written to your ' +
          'Google Contacts.';
        $('.modal-body', form).prepend(p);
      },
    });
    if (!data) return;

    try {
      showLoader('Adding ' + people.length + ' contacts…');
      const r = await Store.linkGoogleContacts(people, {
        Type: data.Type || '', Source: data.Source || '', Tags: data.Tags || '',
      });
      this.picked.clear();
      hideLoader();
      this.renderContactFilter();
      this.render();
      toast(r.added + ' added to your CRM' +
        (r.skipped ? ' · ' + r.skipped + ' were already in' : ''));
    } catch (e) { hideLoader(); toast(e.message, true); }
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

  /* ------------------------------ calendar ------------------------------
     A week of Laura's real Google Calendar with the CRM's own dates layered
     on top. The reminders are derived (see reminders.js), so this view is
     always current without her keeping a second list.
     ---------------------------------------------------------------------- */

  CAL_FILTERS: [
    { key: 'google',      label: 'Calendar events' },
    { key: 'task',        label: 'To-dos' },
    { key: 'deadline',    label: 'Deal dates' },
    { key: 'touchpoint',  label: 'Touch base' },
    { key: 'birthday',    label: 'Birthdays' },
    { key: 'anniversary', label: 'Anniversaries' },
  ],

  calShow() {
    const saved = Store.settings.calendarShow || {};
    const out = {};
    this.CAL_FILTERS.forEach(f => {
      out[f.key] = saved[f.key] === undefined ? true : !!saved[f.key];
    });
    return out;
  },

  async toggleCalFilter(key) {
    const show = this.calShow();
    show[key] = !show[key];
    Store.settings.calendarShow = show;
    this.renderCalendar();
    try { await Store.saveSettings(); } catch (e) { /* view still works */ }
  },

  calDays() {
    const start = this.calWeek || weekStart(todayISO());
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  },

  moveWeek(where) {
    const start = this.calWeek || weekStart(todayISO());
    this.calWeek = where === 'today' ? weekStart(todayISO())
                 : addDays(start, where === 'prev' ? -7 : 7);
    this.renderCalendar();
    this.loadWeek();
  },

  /* Google Calendar is fetched per week; a failure here must never blank the
     page, because the CRM half of this view works without it. */
  async loadWeek() {
    const days = this.calDays();
    const from = days[0], to = days[6];
    this.calState = 'loading';
    this.renderCalendar();
    try {
      const events = await CalendarApi.range(from, to);
      if (this.calDays()[0] !== from) return;      // she moved on while we waited
      this.calEvents = events;
      this.calState = 'idle';
      this.calError = '';
    } catch (e) {
      this.calEvents = [];
      this.calState = 'error';
      this.calError = e.message || 'Could not reach Google Calendar.';
    }
    if (this.view === 'calendar') this.renderCalendar();
  },

  renderCalendar() {
    const days = this.calDays();
    const from = days[0], to = days[6];
    const today = todayISO();
    const show = this.calShow();

    // Which calendar events did the CRM itself create?
    const byEventId = {};
    Store.activities.forEach(a => {
      if (a['Calendar Event ID']) byEventId[a['Calendar Event ID']] = a;
    });

    const reminders = Reminders.forRange(from, to)
      .filter(r => show[Reminders.GROUP[r.kind]]);
    this._calReminders = reminders;

    const events = show.google ? this.calEvents : [];

    const label = shortDate(from) + ' – ' +
      (parseISO(from).getMonth() === parseISO(to).getMonth()
        ? parseISO(to).getDate() : shortDate(to)) +
      ', ' + parseISO(to).getFullYear();

    const chips = this.CAL_FILTERS.map(f =>
      '<button class="chip' + (show[f.key] ? ' on' : '') + '" data-cal-filter="' +
        esc(f.key) + '">' + esc(f.label) + '</button>').join('');

    const dayCells = days.map(d => {
      const evs = events.filter(e => e.date === d);
      const rems = reminders.filter(r => r.date === d);
      return '<div class="cal-day' + (d === today ? ' today' : '') +
               (d < today ? ' past' : '') + '" data-day="' + d + '">' +
        '<div class="cal-day-head"><span class="cal-dow">' + dayName(d) + '</span>' +
          '<span class="cal-dnum">' + parseISO(d).getDate() + '</span></div>' +
        '<div class="cal-items">' +
          evs.map(e => this.calEventChip(e, byEventId[e.id])).join('') +
          rems.map(r => this.calReminderChip(r)).join('') +
          (!evs.length && !rems.length ? '<div class="cal-empty">—</div>' : '') +
        '</div></div>';
    }).join('');

    $('#calendar').innerHTML =
      '<div class="cal-bar">' +
        '<div class="cal-nav">' +
          '<button class="icon-btn" data-cal-nav="prev" title="Previous week">‹</button>' +
          '<button class="btn" data-cal-nav="today">Today</button>' +
          '<button class="icon-btn" data-cal-nav="next" title="Next week">›</button>' +
          '<span class="cal-range">' + esc(label) + '</span>' +
          (this.calState === 'loading' ? '<span class="muted"> · loading…</span>' : '') +
        '</div>' +
        '<div class="chips">' + chips + '</div>' +
      '</div>' +

      (this.calState === 'error'
        ? '<div class="cal-warn">Your CRM dates are below. Google Calendar did not load: ' +
          esc(this.calError) + '</div>' : '') +

      '<div class="cal-layout">' +
        '<div class="cal-week">' + dayCells + '</div>' +
        '<aside class="cal-side">' +
          this.weekPanel(reminders, events) +
          this.comingUpPanel(to) +
        '</aside>' +
      '</div>';
  },

  calEventChip(e, activity) {
    const linked = !!activity;
    const target = linked && activity['Deal ID']
      ? ' data-open-deal="' + esc(activity['Deal ID']) + '"'
      : (linked && activity['Contact ID']
          ? ' data-open-contact="' + esc(activity['Contact ID']) + '"' : '');
    return '<div class="cal-ev' + (linked ? ' crm' : '') + '"' + target +
      ' title="' + esc(e.title + (e.location ? ' · ' + e.location : '')) + '">' +
      (e.allDay ? '' : '<span class="cal-time">' + esc(e.time) + '</span>') +
      '<span class="cal-ev-t">' + esc(e.title) + '</span></div>';
  },

  calReminderChip(r) {
    const target = r.dealId ? ' data-open-deal="' + esc(r.dealId) + '"'
                 : (r.contactId ? ' data-open-contact="' + esc(r.contactId) + '"' : '');
    return '<div class="cal-rem f-' + esc(Reminders.FAMILY[r.kind]) +
      (r.overdue ? ' overdue' : '') + '"' + target +
      ' data-rem-kind="' + esc(r.kind) + '"' +
      ' title="' + esc(Reminders.LABEL[r.kind] + ' · ' + r.title +
                       (r.sub ? ' · ' + r.sub : '')) + '">' +
      '<span class="cal-ico">' + Reminders.ICON[r.kind] + '</span>' +
      '<span class="cal-rem-t">' + esc(r.title) + '</span></div>';
  },

  weekPanel(reminders, events) {
    const rows = reminders.map((r, i) =>
      '<div class="week-row">' +
        '<span class="cal-ico f-' + esc(Reminders.FAMILY[r.kind]) + '" title="' +
          esc(Reminders.LABEL[r.kind]) + '">' + Reminders.ICON[r.kind] + '</span>' +
        '<span class="grow' + (r.dealId || r.contactId ? ' link' : '') + '"' +
          (r.dealId ? ' data-open-deal="' + esc(r.dealId) + '"'
                    : (r.contactId ? ' data-open-contact="' + esc(r.contactId) + '"' : '')) + '>' +
          esc(r.title) +
          (r.sub ? '<span class="week-sub">' + esc(r.sub) + '</span>' : '') +
        '</span>' +
        '<span class="week-when">' + esc(dayName(r.date)) + '</span>' +
        (r.activityId
          ? '<button class="mini" data-rem-done="' + esc(r.activityId) + '" title="Mark done">✓</button>'
          : '') +
        '<button class="mini" data-rem-schedule="' + i + '" title="Put on my calendar">📅</button>' +
      '</div>').join('');

    return '<div class="panel">' +
      '<h3>This week <span class="hint">— ' + events.length + ' event' +
        (events.length === 1 ? '' : 's') + ', ' + reminders.length + ' reminder' +
        (reminders.length === 1 ? '' : 's') + '</span></h3>' +
      (reminders.length ? rows
        : '<div class="muted">Nothing the CRM wants from you this week.</div>') +
    '</div>';
  },

  /* Birthdays and sale anniversaries far enough out to actually plan a card
     or a drop-by — the past-client habit that keeps referrals coming. */
  comingUpPanel(afterISO) {
    const soon = Reminders.forRange(addDays(afterISO, 1), addDays(afterISO, 45))
      .filter(r => r.kind === 'birthday' || r.kind === 'anniversary')
      .slice(0, 10);

    return '<div class="panel">' +
      '<h3>Coming up <span class="hint">— next 45 days</span></h3>' +
      (soon.length ? soon.map(r =>
        '<div class="week-row">' +
          '<span class="cal-ico f-' + esc(Reminders.FAMILY[r.kind]) + '" title="' +
            esc(Reminders.LABEL[r.kind]) + '">' + Reminders.ICON[r.kind] + '</span>' +
          '<span class="grow link"' +
            (r.contactId ? ' data-open-contact="' + esc(r.contactId) + '"' : '') + '>' +
            esc(r.title) + '</span>' +
          '<span class="week-when">' + esc(shortDate(r.date)) + '</span>' +
        '</div>').join('')
        : '<div class="muted">Add birthdays to your contacts and they will show up here.</div>') +
    '</div>';
  },

  async markReminderDone(activityId) {
    try {
      showLoader('Saving…');
      await Store.setActivityDone(activityId);
      hideLoader();
      this.render();
      toast('Ticked off');
    } catch (e) { hideLoader(); toast(e.message, true); }
  },

  scheduleReminder(i) {
    const r = (this._calReminders || [])[Number(i)];
    if (!r) return;
    this.scheduleForm(r.dealId || null, {
      contactId: r.contactId,
      title: r.title,
      dateISO: r.date < todayISO() ? todayISO() : r.date,
      type: r.kind === 'touchpoint' ? 'Call' : 'Note',
      openAfter: false,
    });
  },

  /* ----------------------------- dashboard ----------------------------- */

  closedInYear(year) {
    const y = String(year);
    return Store.deals.filter(d => d.Stage === 'Closed' &&
      String(d['Closed Date'] || d['Stage Updated'] || '').startsWith(y));
  },

  renderDashboard() {
    const open = Store.deals.filter(d => !CLOSED_STAGES.includes(d.Stage));
    const stale = open.filter(d => Store.isStale(d));
    const pipeValue = open.reduce((t, d) => t + numeric(d.Value), 0);
    const pipeComm = open.reduce((t, d) => t + numeric(d.Commission), 0);

    const now = new Date();
    const year = (Store.settings.goals && Store.settings.goals.year) || now.getFullYear();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString().slice(0, 10);
    const closingSoon = open
      .filter(d => d['Expected Close'] && d['Expected Close'] <= monthEnd)
      .sort((a, b) => String(a['Expected Close']).localeCompare(String(b['Expected Close'])));

    const won = this.closedInYear(year);

    const noActivity = Store.contacts.filter(c => {
      const days = Store.daysSince(c['Last Contacted'] || c.Created);
      return days != null && days >= 30;
    }).sort((a, b) => String(a['Last Contacted'] || '').localeCompare(String(b['Last Contacted'] || '')));

    const byStage = {};
    open.forEach(d => {
      const k = d.Pipeline + ' · ' + d.Stage;
      (byStage[k] = byStage[k] || []).push(d);
    });
    const maxStage = Math.max(1, ...Object.values(byStage).map(v => v.length));

    $('#dashboard').innerHTML =
      this.goalsPanel() +

      '<div class="panel panel-wide">' +
        '<h3>At a glance <span class="hint">— click any figure to see the deals behind it</span></h3>' +
        '<div class="stat-grid">' +
          this.stat(open.length, 'Open deals', 'open') +
          this.stat(money(pipeValue) || '$0', 'Pipeline volume', 'open') +
          this.stat(money(pipeComm) || '$0', 'Commission in play', 'open') +
          this.stat(closingSoon.length, 'Closing this month', 'closing') +
          this.stat(stale.length, 'Need attention', 'stale') +
          this.stat(won.length, 'Closed in ' + year, 'won') +
        '</div>' +
      '</div>' +

      this.monthlyPanel(year, won) +
      this.sourcePanel(year, won) +
      this.topClientsPanel(year, won) +

      '<div class="panel">' +
        '<h3>Open deals by stage</h3>' +
        (Object.keys(byStage).length ? Object.entries(byStage)
          .sort((a, b) => b[1].length - a[1].length).map(([k, v]) =>
          '<div class="bar-row clickable" data-drill-stage="' + esc(k) + '" ' +
            'title="' + v.length + ' deal(s) — click to open">' +
            '<span class="bar-label">' + esc(k) + '</span>' +
            '<span class="bar-track"><span class="bar-fill" style="width:' +
              Math.round(v.length / maxStage * 100) + '%"></span></span>' +
            '<span class="bar-num">' + v.length + '</span>' +
          '</div>').join('') : '<div class="muted">No open deals.</div>') +
      '</div>' +

      '<div class="panel">' +
        '<h3>Closing this month</h3>' +
        (closingSoon.length ? '<div class="list-lite">' + closingSoon.map(d =>
          '<div class="list-lite-row" data-open-deal="' + esc(d.ID) + '">' +
            '<span class="grow">' + esc(d['Deal Name']) + '</span>' +
            '<span class="card-value">' + esc(money(d.Commission) || '—') + '</span>' +
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

  /* Commission earned per month. One measure, one hue — volume rides along as
     text rather than a second axis. */
  monthlyPanel(year, won) {
    const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const months = names.map(() => ({ comm: 0, vol: 0, deals: [] }));

    won.forEach(d => {
      const iso = String(d['Closed Date'] || d['Stage Updated'] || '');
      const m = Number(iso.slice(5, 7)) - 1;
      if (m < 0 || m > 11) return;
      months[m].comm += numeric(d.Commission);
      months[m].vol += numeric(d.Value);
      months[m].deals.push(d);
    });

    const peak = Math.max(1, ...months.map(m => m.comm));
    const best = months.reduce((a, b) => (b.comm > a.comm ? b : a), months[0]);

    return '<div class="panel panel-wide">' +
      '<h3>' + year + ' month by month <span class="hint">— commission earned</span></h3>' +
      months.map((m, i) =>
        '<div class="bar-row' + (m.deals.length ? ' clickable' : '') + '"' +
          (m.deals.length ? ' data-drill-month="' + i + '"' : '') +
          ' title="' + (m.deals.length
            ? m.deals.length + ' deal(s) · ' + money(m.vol) + ' volume'
            : 'nothing closed') + '">' +
          '<span class="bar-label">' + names[i] + '</span>' +
          '<span class="bar-track"><span class="bar-fill" style="width:' +
            Math.round(m.comm / peak * 100) + '%"></span></span>' +
          '<span class="bar-money">' + (m.comm ? esc(money(m.comm)) : '—') + '</span>' +
          '<span class="bar-num">' + (m.deals.length || '') + '</span>' +
        '</div>').join('') +
      (best.comm ? '<div class="goal-foot">Best month so far: <b>' +
        esc(names[months.indexOf(best)]) + '</b> at ' + esc(money(best.comm)) + '</div>' : '') +
    '</div>';
  },

  /* Where the closed business actually came from — the question her old
     Source Tracking tab was trying to answer. */
  sourcePanel(year, won) {
    const by = {};
    won.forEach(d => {
      const c = Store.contact(d['Contact ID']);
      const src = (c && c.Source) || 'Not recorded';
      (by[src] = by[src] || { comm: 0, deals: [] });
      by[src].comm += numeric(d.Commission);
      by[src].deals.push(d);
    });
    const rows = Object.entries(by).sort((a, b) => b[1].comm - a[1].comm);
    const peak = Math.max(1, ...rows.map(r => r[1].comm));
    const total = rows.reduce((t, r) => t + r[1].comm, 0);

    return '<div class="panel">' +
      '<h3>Where ' + year + ' business came from</h3>' +
      (rows.length ? rows.map(([src, v]) =>
        '<div class="bar-row clickable" data-drill-source="' + esc(src) + '" ' +
          'title="' + v.deals.length + ' deal(s)">' +
          '<span class="bar-label">' + esc(src) + '</span>' +
          '<span class="bar-track"><span class="bar-fill" style="width:' +
            Math.round(v.comm / peak * 100) + '%"></span></span>' +
          '<span class="bar-num">' + (total ? Math.round(v.comm / total * 100) + '%' : '') +
          '</span>' +
        '</div>').join('') : '<div class="muted">Nothing closed yet this year.</div>') +
    '</div>';
  },

  topClientsPanel(year, won) {
    const by = {};
    won.forEach(d => {
      const id = d['Contact ID'];
      if (!id) return;
      (by[id] = by[id] || { comm: 0, deals: [] });
      by[id].comm += numeric(d.Commission);
      by[id].deals.push(d);
    });
    const rows = Object.entries(by)
      .sort((a, b) => b[1].comm - a[1].comm)
      .slice(0, 8);

    return '<div class="panel">' +
      '<h3>Best clients in ' + year + '</h3>' +
      (rows.length ? '<div class="list-lite">' + rows.map(([id, v]) => {
        const c = Store.contact(id);
        return '<div class="list-lite-row" data-open-contact="' + esc(id) + '">' +
          '<span class="grow">' + esc(c ? c.Name : 'Unknown') +
            (v.deals.length > 1
              ? ' <span class="pill ok">' + v.deals.length + ' deals</span>' : '') +
          '</span>' +
          '<span class="card-value">' + esc(money(v.comm)) + '</span>' +
        '</div>';
      }).join('') + '</div>' : '<div class="muted">Nothing closed yet this year.</div>') +
    '</div>';
  },

  /* One drawer for every "show me the deals behind that number". */
  drillDeals(title, deals, note) {
    const vol = deals.reduce((t, d) => t + numeric(d.Value), 0);
    const comm = deals.reduce((t, d) => t + numeric(d.Commission), 0);

    openDrawer(
      '<div class="drawer-head">' +
        '<div><h2>' + esc(title) + '</h2>' +
          '<div class="sub">' + deals.length + ' deal' + (deals.length === 1 ? '' : 's') +
            (note ? ' · ' + esc(note) : '') + '</div></div>' +
        '<button class="icon-btn close-x" data-close>✕</button>' +
      '</div>' +
      '<div class="drawer-body">' +
        '<div class="sec"><div class="stat-grid">' +
          this.stat(deals.length, 'Deals') +
          this.stat(money(vol) || '$0', 'Volume') +
          this.stat(money(comm) || '$0', 'Commission') +
        '</div></div>' +
        '<div class="sec">' +
          (deals.length ? '<div class="list-lite">' + deals
            .sort((a, b) => String(b['Closed Date'] || b.Created || '')
              .localeCompare(String(a['Closed Date'] || a.Created || '')))
            .map(d => {
              const c = Store.contact(d['Contact ID']);
              return '<div class="list-lite-row" data-open-deal="' + esc(d.ID) + '">' +
                '<span class="pill' + (d.Pipeline === 'Buyer' ? ' info' : '') + '">' +
                  esc(d.Pipeline) + '</span>' +
                '<span class="grow">' + esc(d['Deal Name']) +
                  (c ? ' <span class="muted">· ' + esc(c.Name) + '</span>' : '') + '</span>' +
                '<span class="card-price">' + esc(money(d.Value) || '—') + '</span>' +
                '<span class="card-value">' + esc(money(d.Commission) || '—') + '</span>' +
              '</div>';
            }).join('') + '</div>'
            : '<div class="muted">No deals in here.</div>') +
        '</div>' +
      '</div>'
    );
  },

  stat(num, label, drill) {
    return '<div class="stat' + (drill ? ' clickable" data-stat-drill="' + esc(drill) : '') +
      '"><div class="stat-num">' + esc(num) +
      '</div><div class="stat-label">' + esc(label) + '</div></div>';
  },

  /* Every dashboard number is a door into the deals behind it. */
  openDrill(kind, value) {
    const open = Store.deals.filter(d => !CLOSED_STAGES.includes(d.Stage));
    const year = (Store.settings.goals && Store.settings.goals.year) ||
      new Date().getFullYear();
    const won = this.closedInYear(year);
    const names = ['January','February','March','April','May','June','July',
      'August','September','October','November','December'];

    if (kind === 'open') return this.drillDeals('Open deals', open, 'everything still in play');
    if (kind === 'won') return this.drillDeals('Closed in ' + year, won);
    if (kind === 'stale') return this.drillDeals('Need attention',
      open.filter(d => Store.isStale(d)), 'no movement in ' + CONFIG.STALE_DAYS + '+ days');
    if (kind === 'closing') {
      const now = new Date();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        .toISOString().slice(0, 10);
      return this.drillDeals('Closing this month',
        open.filter(d => d['Expected Close'] && d['Expected Close'] <= monthEnd));
    }
    if (kind === 'stage') return this.drillDeals(value,
      open.filter(d => (d.Pipeline + ' \u00b7 ' + d.Stage) === value));
    if (kind === 'month') {
      const i = Number(value);
      return this.drillDeals(names[i] + ' ' + year, won.filter(d => {
        const iso = String(d['Closed Date'] || d['Stage Updated'] || '');
        return Number(iso.slice(5, 7)) - 1 === i;
      }), 'closed');
    }
    if (kind === 'source') return this.drillDeals(value + ' \u2014 ' + year,
      won.filter(d => {
        const c = Store.contact(d['Contact ID']);
        return ((c && c.Source) || 'Not recorded') === value;
      }), 'closed business from this source');
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

  /* Everyone you could attach a deal to: the CRM first, then the rest of your
     Google address book. Picking a Google-only person links them in on save. */
  contactOptions() {
    const crm = Store.contacts
      .slice().sort((a, b) => String(a.Name || '').localeCompare(String(b.Name || '')))
      .map(c => ({
        value: c.ID,
        label: c.Name,
        sub: [c.Phone, c.Email].filter(Boolean).join(' · '),
        kind: 'crm',
      }));

    const linked = new Set(Store.contacts.map(c => c['Google ID']).filter(Boolean));
    const google = (People._cache || [])
      .filter(p => !linked.has(p.id))
      .map(p => ({
        value: 'google:' + p.id,
        label: p.name,
        sub: [p.phone, p.email, p.org].filter(Boolean).join(' · '),
        kind: 'google',
      }));

    return crm.concat(google);
  },

  /* A picked value may be an existing CRM id, a Google person we still need to
     pull in, or a brand new name typed straight into the box. */
  async resolveContactId(v) {
    if (!v) return '';
    if (v.indexOf('google:') === 0) {
      const p = People.byId(v.slice(7));
      if (!p) return '';
      const saved = await Store.linkGoogleContact(p);
      return saved.ID;
    }
    if (v.indexOf('new:') === 0) {
      const saved = await Store.saveContact({ Name: v.slice(4), Type: '' });
      return saved.ID;
    }
    return v;
  },

  async contactForm(id) {
    const c = id ? Store.contact(id) : {};
    if (id && !c) return;
    const s = Store.settings;

    const data = await Modal.open({
      title: id ? 'Edit contact' : 'New contact',
      submitLabel: id ? 'Save changes' : 'Add contact',
      fields: [
        { name: 'Name', label: 'Name', value: c.Name, required: true, half: true },
        { name: 'Type', label: 'Type', type: 'select', options: s.contactTypes,
          value: c.Type, half: true },
        { name: 'Phone', label: 'Phone', type: 'tel', value: c.Phone, half: true },
        { name: 'Email', label: 'Email', type: 'email', value: c.Email, half: true },
        { name: 'Address', label: 'Address', value: c.Address,
          placeholder: 'e.g. 123 Maple St NW, Edmonton' },
        { name: 'Source', label: 'Where did they come from?', type: 'select',
          options: s.sources, value: c.Source, allowBlank: true },
        { name: 'Birthday', label: 'Birthday', type: 'date', value: c.Birthday, half: true },
        { name: 'Touch Cadence', label: 'Keep in touch', type: 'select', half: true,
          options: Reminders.CADENCES, value: c['Touch Cadence'], allowBlank: true },
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

    const startId = d['Contact ID'] || presets['Contact ID'] || '';
    const startContact = Store.contact(startId);

    const data = await Modal.open({
      title: id ? 'Edit deal' : 'New deal',
      submitLabel: id ? 'Save changes' : 'Create deal',
      fields: [
        { name: 'Deal Name', label: 'Deal name', value: d['Deal Name'],
          required: true, placeholder: 'e.g. 123 Maple St — Purchase' },
        { name: 'Contact ID', label: 'Contact', type: 'combo', allowNew: true,
          value: startId, text: startContact ? startContact.Name : '',
          placeholder: 'Type a name — searches all your Google contacts',
          options: () => this.contactOptions() },
        { name: 'Pipeline', label: 'Pipeline', type: 'select', half: true,
          options: Store.pipelineNames(), value: pipeline },
        { name: 'Stage', label: 'Stage', type: 'select', options: stages, half: true,
          value: d.Stage || presets.Stage || stages[0] },
        { name: 'Value', label: 'Sale price', value: d.Value, placeholder: '450000', half: true },
        { name: 'Commission', label: 'Your commission', value: d.Commission,
          placeholder: '9400', half: true },
        { name: 'GST', label: 'GST', value: d.GST, half: true },
        { name: 'Property Address', label: 'Property address', value: d['Property Address'],
          half: true },
        { name: 'Expected Close', label: 'Expected close', type: 'date',
          value: d['Expected Close'], half: true },
        { name: 'Closed Date', label: 'Actual closing date', type: 'date',
          value: d['Closed Date'], half: true },
        { name: 'Conditions Due', label: 'Conditions due', type: 'date',
          value: d['Conditions Due'], half: true },
        { name: 'Possession Date', label: 'Possession', type: 'date',
          value: d['Possession Date'], half: true },
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
      data['Contact ID'] = await this.resolveContactId(data['Contact ID']);
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

  async scheduleForm(dealId, presets = {}) {
    const d = dealId ? Store.deal(dealId) : null;
    if (dealId && !d) return;
    const c = presets.contactId ? Store.contact(presets.contactId)
            : (d ? Store.contact(d['Contact ID']) : null);
    if (!d && !c) return;

    const now = new Date(Date.now() + 3600000);
    const defaultLocal = presets.dateISO
      ? presets.dateISO + 'T09:00'
      : new Date(now.getTime() - now.getTimezoneOffset() * 60000)
          .toISOString().slice(0, 16);

    const data = await Modal.open({
      title: 'Add to your Google Calendar',
      submitLabel: 'Create event',
      fields: [
        { name: 'Type', label: 'Type', type: 'select',
          options: Store.settings.activityTypes ||
            ['Showing', 'Call', 'Meeting', 'Listing Appointment', 'Closing'],
          value: presets.type || 'Showing' },
        { name: 'title', label: 'Title', required: true,
          value: presets.title ||
            ((d && d['Deal Name']) || '') + (c ? ' — ' + c.Name : '') },
        { name: 'start', label: 'Starts', type: 'datetime-local',
          value: defaultLocal, required: true, half: true },
        { name: 'minutes', label: 'Length (minutes)', type: 'number', value: '60',
          half: true },
        { name: 'location', label: 'Location',
          value: (d && d['Property Address']) || (c && c.Address) || '' },
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
        'Contact ID': (d && d['Contact ID']) || (c && c.ID) || '',
        'Deal ID': d ? d.ID : '',
        Type: data.Type, Date: String(data.start).slice(0, 10),
        Summary: data.title, 'Gmail Thread ID': '',
        'Calendar Event ID': ev.id || '', Done: '',
      });
      hideLoader();
      if (this.view === 'calendar') await this.loadWeek();
      this.render();
      if (presets.openAfter !== false) {
        if (d) this.openDeal(d.ID);
        else if (c) this.openContact(c.ID);
      }
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

    const calNav = hit('data-cal-nav');
    if (calNav) return this.moveWeek(calNav);

    const calFilter = hit('data-cal-filter');
    if (calFilter) return this.toggleCalFilter(calFilter);

    const remDone = hit('data-rem-done');
    if (remDone) { e.stopPropagation(); return this.markReminderDone(remDone); }

    const remSched = hit('data-rem-schedule');
    if (remSched) { e.stopPropagation(); return this.scheduleReminder(remSched); }

    const statDrill = hit('data-stat-drill');
    if (statDrill) return this.openDrill(statDrill);

    const drillStage = hit('data-drill-stage');
    if (drillStage) return this.openDrill('stage', drillStage);

    const drillMonth = hit('data-drill-month');
    if (drillMonth != null) return this.openDrill('month', drillMonth);

    const drillSource = hit('data-drill-source');
    if (drillSource) return this.openDrill('source', drillSource);

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

    const pick = t.closest('[data-pick]');
    if (pick) { e.stopPropagation(); return this.togglePick(pick.getAttribute('data-pick')); }
    if (t.closest('.pick')) { e.stopPropagation(); return; }

    if (t.closest('[data-sel-all]')) return this.selectAllShown();
    if (t.closest('[data-sel-none]')) return this.clearPicks();
    if (t.closest('[data-bulk-add]')) return this.bulkAddGoogle();

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
