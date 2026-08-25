/* ==========================================================================
   google.js — everything that talks to Google.
   Auth, Sheets (the database), Gmail, Calendar, Drive.
   ========================================================================== */

/* ------------------------------ AUTH ------------------------------------ */

const Auth = {
  token: null,
  expiresAt: 0,
  user: null,
  _client: null,
  _pending: null,

  init() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      throw new Error('Google sign-in library did not load. Check your internet connection.');
    }
    if (!CONFIG.GOOGLE_CLIENT_ID || CONFIG.GOOGLE_CLIENT_ID.startsWith('PASTE_')) {
      throw new Error('NO_CLIENT_ID');
    }
    this._client = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: (resp) => {
        if (this._pending) {
          if (resp && resp.access_token) {
            this.token = resp.access_token;
            this.expiresAt = Date.now() + ((resp.expires_in || 3600) - 120) * 1000;
            this._save();
            this._pending.resolve(resp.access_token);
          } else {
            this._pending.reject(new Error('Sign-in was cancelled or failed.'));
          }
          this._pending = null;
        }
      },
      error_callback: (err) => {
        if (this._pending) {
          this._pending.reject(new Error(
            (err && err.type === 'popup_closed')
              ? 'Sign-in window was closed before finishing.'
              : 'Sign-in failed. ' + ((err && err.message) || '')
          ));
          this._pending = null;
        }
      },
    });
    this._restore();
  },

  // Ask Google for a token. prompt:'' tries silently (no popup) when possible.
  request(interactive) {
    return new Promise((resolve, reject) => {
      this._pending = { resolve, reject };
      try {
        this._client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
      } catch (e) {
        this._pending = null;
        reject(e);
      }
    });
  },

  async ensureToken() {
    if (this.token && Date.now() < this.expiresAt) return this.token;
    try {
      return await this.request(false);      // silent, no popup
    } catch (e) {
      return this.request(true);             // session lapsed — ask properly
    }
  },

  async signIn() {
    await this.request(true);
    await this.loadProfile();
    return this.user;
  },

  async loadProfile() {
    try {
      const me = await api('https://www.googleapis.com/oauth2/v3/userinfo');
      this.user = { email: me.email, name: me.name, picture: me.picture };
      this._save();
    } catch (e) { /* non-fatal */ }
    return this.user;
  },

  signOut() {
    if (this.token) {
      try { google.accounts.oauth2.revoke(this.token, () => {}); } catch (e) {}
    }
    this.token = null; this.expiresAt = 0; this.user = null;
    try {
      sessionStorage.removeItem('crm_auth');
      localStorage.removeItem('crm_ids');
    } catch (e) {}
  },

  isSignedIn() { return !!(this.token && Date.now() < this.expiresAt); },

  _save() {
    try {
      sessionStorage.setItem('crm_auth', JSON.stringify({
        token: this.token, expiresAt: this.expiresAt, user: this.user,
      }));
    } catch (e) {}
  },

  _restore() {
    try {
      const raw = sessionStorage.getItem('crm_auth');
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d && d.expiresAt > Date.now()) {
        this.token = d.token; this.expiresAt = d.expiresAt; this.user = d.user;
      }
    } catch (e) {}
  },
};


/* ---------------------------- FETCH WRAPPER ------------------------------ */

async function api(url, options = {}) {
  const token = await Auth.ensureToken();
  const opts = Object.assign({}, options);
  opts.headers = Object.assign({ Authorization: 'Bearer ' + token }, options.headers || {});

  let res = await fetch(url, opts);

  // Token went stale mid-session — get a fresh one and retry once.
  if (res.status === 401) {
    Auth.token = null;
    const fresh = await Auth.ensureToken();
    opts.headers.Authorization = 'Bearer ' + fresh;
    res = await fetch(url, opts);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const err = await res.json();
      detail = (err.error && (err.error.message || err.error.status)) || '';
    } catch (e) { detail = res.statusText; }
    const e = new Error('Google API error (' + res.status + '): ' + detail);
    e.status = res.status;
    throw e;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const jsonPost = (url, body, method = 'POST') => api(url, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});


/* -------------------------------- DRIVE ---------------------------------- */

const Drive = {
  async findFile(name, mimeType) {
    const q = encodeURIComponent(
      "name='" + name.replace(/'/g, "\\'") + "' and trashed=false" +
      (mimeType ? " and mimeType='" + mimeType + "'" : '')
    );
    const r = await api('https://www.googleapis.com/drive/v3/files?q=' + q +
                        '&fields=files(id,name)&pageSize=10');
    return (r.files && r.files[0]) || null;
  },

  async createFolder(name, parentId) {
    const body = { name, mimeType: 'application/vnd.google-apps.folder' };
    if (parentId) body.parents = [parentId];
    return jsonPost('https://www.googleapis.com/drive/v3/files?fields=id,name', body);
  },

  async ensureFolder(name, parentId) {
    const found = await this.findFile(name, 'application/vnd.google-apps.folder');
    if (found) return found.id;
    const made = await this.createFolder(name, parentId);
    return made.id;
  },

  async listFolder(folderId) {
    const q = encodeURIComponent("'" + folderId + "' in parents and trashed=false");
    const r = await api('https://www.googleapis.com/drive/v3/files?q=' + q +
      '&fields=files(id,name,mimeType,webViewLink,modifiedTime,size)&orderBy=modifiedTime desc');
    return r.files || [];
  },

  // Multipart upload of a File/Blob straight into a Drive folder.
  async uploadFile(file, folderId) {
    const boundary = 'crmboundary' + Date.now();
    const meta = { name: file.name, parents: [folderId] };
    const head =
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(meta) + '\r\n' +
      '--' + boundary + '\r\nContent-Type: ' + (file.type || 'application/octet-stream') +
      '\r\n\r\n';
    const tail = '\r\n--' + boundary + '--';
    const body = new Blob([head, file, tail], { type: 'multipart/related; boundary=' + boundary });

    return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,mimeType',
      { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
  },
};


/* -------------------------------- SHEETS --------------------------------- */
/* The spreadsheet IS the database. We read whole tabs into memory and write
   whole tabs back. For a single agent's book of business (hundreds of rows,
   not millions) this is far simpler and less bug-prone than tracking row
   indexes, and it keeps the sheet human-editable.                            */

const TABS = {
  Contacts: ['ID', 'Name', 'Type', 'Phone', 'Email', 'Address', 'Source',
             'Tags', 'Notes', 'Created', 'Last Contacted', 'Google ID'],
  Deals: ['ID', 'Contact ID', 'Deal Name', 'Pipeline', 'Stage', 'Value',
          'Property Address', 'Expected Close', 'Created', 'Stage Updated', 'Notes',
          'Commission', 'GST', 'Closed Date'],
  Activities: ['ID', 'Contact ID', 'Deal ID', 'Type', 'Date', 'Summary',
               'Gmail Thread ID', 'Calendar Event ID', 'Done'],
  Settings: ['Key', 'Value'],
};

const Sheets = {
  id: null,
  _queue: Promise.resolve(),

  async connect() {
    // Try the cached id first, then look it up in Drive, then create it.
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem('crm_ids') || '{}').sheetId; } catch (e) {}

    if (cached) {
      try {
        await api('https://sheets.googleapis.com/v4/spreadsheets/' + cached + '?fields=spreadsheetId');
        this.id = cached;
      } catch (e) { this.id = null; }
    }
    if (!this.id) {
      const found = await Drive.findFile(CONFIG.SPREADSHEET_NAME,
        'application/vnd.google-apps.spreadsheet');
      if (found) this.id = found.id;
    }
    if (!this.id) this.id = await this._create();

    await this._ensureTabs();
    this._cacheId();
    return this.id;
  },

  _cacheId() {
    try {
      const ids = JSON.parse(localStorage.getItem('crm_ids') || '{}');
      ids.sheetId = this.id;
      localStorage.setItem('crm_ids', JSON.stringify(ids));
    } catch (e) {}
  },

  async _create() {
    const sheet = await jsonPost('https://sheets.googleapis.com/v4/spreadsheets', {
      properties: { title: CONFIG.SPREADSHEET_NAME },
      sheets: Object.keys(TABS).map((name, i) => ({
        properties: { title: name, index: i, gridProperties: { frozenRowCount: 1 } },
      })),
    });
    const id = sheet.spreadsheetId;
    // Write header rows.
    for (const [name, headers] of Object.entries(TABS)) {
      await api('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' +
        encodeURIComponent(name + '!A1') + '?valueInputOption=RAW',
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [headers] }) });
    }
    return id;
  },

  // If the user (or an older version) left a tab missing, add it.
  async _ensureTabs() {
    const meta = await api('https://sheets.googleapis.com/v4/spreadsheets/' + this.id +
      '?fields=sheets.properties.title');
    const existing = (meta.sheets || []).map(s => s.properties.title);
    const missing = Object.keys(TABS).filter(t => !existing.includes(t));
    if (!missing.length) return;

    await jsonPost('https://sheets.googleapis.com/v4/spreadsheets/' + this.id + ':batchUpdate', {
      requests: missing.map(title => ({
        addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } },
      })),
    });
    for (const title of missing) {
      await api('https://sheets.googleapis.com/v4/spreadsheets/' + this.id + '/values/' +
        encodeURIComponent(title + '!A1') + '?valueInputOption=RAW',
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [TABS[title]] }) });
    }
  },

  // Read a tab into an array of plain objects keyed by header name.
  async read(tab) {
    const range = encodeURIComponent(tab + '!A1:Z50000');
    const r = await api('https://sheets.googleapis.com/v4/spreadsheets/' + this.id +
      '/values/' + range);
    const rows = r.values || [];
    if (rows.length < 2) return [];
    const headers = rows[0];
    return rows.slice(1)
      .filter(row => row.some(c => String(c || '').trim() !== ''))
      .map(row => {
        const o = {};
        headers.forEach((h, i) => { o[h] = row[i] != null ? row[i] : ''; });
        return o;
      });
  },

  // Replace a whole tab. Queued so two rapid saves can't interleave.
  write(tab, records) {
    this._queue = this._queue.then(() => this._write(tab, records))
      .catch(err => { console.error('Sheet write failed:', err); throw err; });
    return this._queue;
  },

  async _write(tab, records) {
    const headers = TABS[tab];
    const values = [headers].concat(
      records.map(rec => headers.map(h => {
        const v = rec[h];
        return v == null ? '' : String(v);
      }))
    );
    await jsonPost('https://sheets.googleapis.com/v4/spreadsheets/' + this.id +
      '/values/' + encodeURIComponent(tab + '!A1:Z50000') + ':clear', {});
    await api('https://sheets.googleapis.com/v4/spreadsheets/' + this.id + '/values/' +
      encodeURIComponent(tab + '!A1') + '?valueInputOption=RAW',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }) });
  },

  url() { return 'https://docs.google.com/spreadsheets/d/' + this.id; },
};


/* -------------------------------- GMAIL ---------------------------------- */

const GmailApi = {
  async threadsWith(email, max = 12) {
    if (!email) return [];
    const q = encodeURIComponent('from:' + email + ' OR to:' + email);
    const list = await api('https://gmail.googleapis.com/gmail/v1/users/me/threads?q=' +
      q + '&maxResults=' + max);
    if (!list.threads) return [];

    const out = [];
    for (const t of list.threads) {
      try {
        const full = await api('https://gmail.googleapis.com/gmail/v1/users/me/threads/' +
          t.id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From' +
          '&metadataHeaders=To&metadataHeaders=Date');
        const msgs = full.messages || [];
        const last = msgs[msgs.length - 1];
        const hdr = (name) => {
          const h = ((last.payload && last.payload.headers) || [])
            .find(x => x.name.toLowerCase() === name.toLowerCase());
          return h ? h.value : '';
        };
        out.push({
          id: t.id,
          subject: hdr('Subject') || '(no subject)',
          from: hdr('From'),
          date: hdr('Date'),
          snippet: last.snippet || full.snippet || '',
          count: msgs.length,
          link: 'https://mail.google.com/mail/u/0/#inbox/' + t.id,
        });
      } catch (e) { /* skip unreadable thread */ }
    }
    return out;
  },

  async send({ to, subject, body }) {
    const from = (Auth.user && Auth.user.email) || '';
    const lines = [
      'To: ' + to,
      'From: ' + from,
      'Subject: ' + subject,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      body,
    ].join('\r\n');

    // UTF-8 safe base64url
    const bytes = new TextEncoder().encode(lines);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    const raw = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    return jsonPost('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw });
  },
};


/* ------------------------------- CALENDAR -------------------------------- */

const CalendarApi = {
  async create({ title, description, startISO, minutes = 60, location, attendeeEmail }) {
    const start = new Date(startISO);
    const end = new Date(start.getTime() + minutes * 60000);
    const body = {
      summary: title,
      description: description || '',
      location: location || '',
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    };
    if (attendeeEmail) body.attendees = [{ email: attendeeEmail }];
    return jsonPost('https://www.googleapis.com/calendar/v3/calendars/primary/events', body);
  },

  async upcoming(maxResults = 10) {
    const now = new Date().toISOString();
    const r = await api('https://www.googleapis.com/calendar/v3/calendars/primary/events' +
      '?timeMin=' + encodeURIComponent(now) + '&maxResults=' + maxResults +
      '&singleEvents=true&orderBy=startTime');
    return r.items || [];
  },
};
