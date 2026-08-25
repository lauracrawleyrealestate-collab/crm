/* ==========================================================================
   people.js — Google Contacts (People API).

   Google Contacts is the master address book. Name, phone, email and address
   for a person live there; the CRM sheet holds the CRM-only fields (type,
   source, tags, notes, last contacted) and a link back via "Google ID".
   ========================================================================== */

const PERSON_FIELDS = 'names,emailAddresses,phoneNumbers,addresses,organizations';

const People = {
  _cache: null,
  _cacheAt: 0,
  CACHE_MS: 60 * 1000,     // don't re-fetch more than once a minute
  available: true,          // flipped off if the scope was never granted

  /* Normalise a People API person into the flat shape the app uses. */
  _flatten(p) {
    const first = (arr, key) => (arr && arr.length ? (arr[0][key] || '') : '');
    const name = first(p.names, 'displayName') ||
                 [first(p.names, 'givenName'), first(p.names, 'familyName')]
                   .filter(Boolean).join(' ');
    return {
      id: p.resourceName,
      etag: p.etag,
      name: name,
      firstName: first(p.names, 'givenName'),
      lastName: first(p.names, 'familyName'),
      email: first(p.emailAddresses, 'value'),
      phone: first(p.phoneNumbers, 'value'),
      address: first(p.addresses, 'formattedValue'),
      org: first(p.organizations, 'name'),
    };
  },

  async list(force) {
    if (!force && this._cache && (Date.now() - this._cacheAt) < this.CACHE_MS) {
      return this._cache;
    }
    const out = [];
    let pageToken = '';
    try {
      do {
        const url = 'https://people.googleapis.com/v1/people/me/connections' +
          '?personFields=' + PERSON_FIELDS +
          '&pageSize=1000&sortOrder=FIRST_NAME_ASCENDING' +
          (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
        const r = await api(url);
        (r.connections || []).forEach(p => out.push(this._flatten(p)));
        pageToken = r.nextPageToken || '';
      } while (pageToken && out.length < 5000);
    } catch (e) {
      // 403 here almost always means the Contacts permission was not granted.
      if (e.status === 403) this.available = false;
      throw e;
    }

    this._cache = out.filter(p => p.name || p.email || p.phone);
    this._cacheAt = Date.now();
    return this._cache;
  },

  byId(id) { return (this._cache || []).find(p => p.id === id) || null; },

  _body(c) {
    const body = {};
    const nameParts = String(c.Name || '').trim().split(/\s+/);
    body.names = [{
      givenName: nameParts[0] || '',
      familyName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : '',
    }];
    body.emailAddresses = c.Email ? [{ value: c.Email }] : [];
    body.phoneNumbers = c.Phone ? [{ value: c.Phone }] : [];
    body.addresses = c.Address ? [{ formattedValue: c.Address }] : [];
    return body;
  },

  async create(c) {
    const made = await jsonPost(
      'https://people.googleapis.com/v1/people:createContact?personFields=' + PERSON_FIELDS,
      this._body(c));
    this._cacheAt = 0;                        // force a refresh next look
    return this._flatten(made);
  },

  async update(resourceName, c) {
    // A patch needs the current etag, so read the person back first.
    const cur = await api('https://people.googleapis.com/v1/' + resourceName +
      '?personFields=' + PERSON_FIELDS);
    const body = Object.assign({ etag: cur.etag }, this._body(c));
    const saved = await jsonPost(
      'https://people.googleapis.com/v1/' + resourceName + ':updateContact' +
      '?updatePersonFields=names,emailAddresses,phoneNumbers,addresses' +
      '&personFields=' + PERSON_FIELDS,
      body, 'PATCH');
    this._cacheAt = 0;
    return this._flatten(saved);
  },

  /* --------------------------------------------------------------------
     Pull the live Google values into the CRM records that are linked.
     Returns how many rows actually changed, so we only write the sheet
     when there is something to write.
     -------------------------------------------------------------------- */
  async syncInto(store) {
    const people = await this.list();
    const byId = {};
    people.forEach(p => { byId[p.id] = p; });

    let changed = 0;
    store.contacts.forEach(c => {
      const gid = c['Google ID'];
      if (!gid) return;
      const p = byId[gid];
      if (!p) { c._missingInGoogle = true; return; }
      c._missingInGoogle = false;

      const next = { Name: p.name, Phone: p.phone, Email: p.email, Address: p.address };
      Object.entries(next).forEach(([k, v]) => {
        if (v && String(c[k] || '') !== String(v)) { c[k] = v; changed++; }
      });
    });

    if (changed) await Sheets.write('Contacts', store.contacts);
    return { changed, total: people.length };
  },

  /* Google contacts that aren't linked to a CRM record yet. */
  unlinked(store) {
    const linked = new Set(store.contacts.map(c => c['Google ID']).filter(Boolean));
    return (this._cache || []).filter(p => !linked.has(p.id));
  },
};
