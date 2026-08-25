/* ==========================================================================
   import.js — one-time import of a sales-tracker spreadsheet.

   Built for Laura's "Goal Setting Simplified" workbook (exported from Apple
   Numbers), but tolerant enough for anything with the same shape: quarterly
   sales tabs with a "Date Deal Written" header row, and an appointment tab.

   Nothing is written until the preview is confirmed.
   ========================================================================== */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
                'july', 'august', 'september', 'october', 'november', 'december'];

/* Typos actually present in the source workbook. */
const DATE_TYPOS = { juky: 'july', janurary: 'january', feburary: 'february',
                     agust: 'august', setember: 'september' };

/* Messy source strings collapse to this tidy list. Order matters — the more
   specific patterns have to win before the generic "referral". */
const SOURCE_RULES = [
  [/past\s*client|referral:\s*client/i, 'Referral: Past Client'],
  [/agent|realtor/i,                    'Referral: Agent'],
  [/family|parents|mom|dad|sister|brother|jess/i, 'Referral: Family'],
  [/friend/i,                           'Referral: Friend'],
  [/sign\s*call|call\s*in/i,            'Sign Call / Call In'],
  [/facebook|instagram|social/i,        'Social Media'],
  [/open\s*house/i,                     'Open House'],
  [/farm/i,                             'Farming'],
  [/work|colleague/i,                   'Personal Network'],
  [/referral/i,                         'Referral: Other'],
];

const Importer = {

  /* ----------------------------- parsing ------------------------------ */

  iso(y, m, d) {
    if (!y || !m || !d) return '';
    const p = (n) => String(n).padStart(2, '0');
    return y + '-' + p(m) + '-' + p(d);
  },

  /* The date column in the source is a free-for-all: "12/5/2025",
     "Jan 8th, 2026", "Monday, March 2, 2026", "May 3rd" (no year),
     "Juky 31st, 2026" (typo). Parse what we can, return '' otherwise. */
  parseLooseDate(raw, fallbackYear) {
    if (raw == null) return '';
    let t = String(raw).trim().toLowerCase();
    if (!t) return '';

    const numeric = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (numeric) {
      let y = Number(numeric[3]);
      if (y < 100) y += 2000;
      return this.iso(y, Number(numeric[1]), Number(numeric[2]));
    }

    t = t.replace(/\b(mon|tue|tues|wed|wednes|thu|thur|thurs|fri|sat|satur|sun)(day)?\b/g, ' ');
    t = t.replace(/(\d+)(st|nd|rd|th)\b/g, '$1');
    Object.keys(DATE_TYPOS).forEach(bad => {
      t = t.replace(new RegExp('\\b' + bad, 'g'), DATE_TYPOS[bad]);
    });
    t = t.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

    let month = 0;
    for (let i = 0; i < MONTHS.length; i++) {
      if (new RegExp('\\b' + MONTHS[i].slice(0, 3)).test(t)) { month = i + 1; break; }
    }
    if (!month) return '';

    let year = null, day = null;
    (t.match(/\d+/g) || []).forEach(n => {
      if (n.length === 4) year = Number(n);
      else if (day === null) day = Number(n);
    });
    if (!day || day > 31) return '';
    return this.iso(year || fallbackYear, month, day);
  },

  num(raw) {
    if (raw == null) return '';
    const n = Number(String(raw).replace(/[^0-9.\-]/g, ''));
    return (!isFinite(n) || n === 0) ? '' : String(n);
  },

  normalizeSource(raw) {
    const t = String(raw || '').trim();
    if (!t) return { source: '', original: '' };
    for (const [re, clean] of SOURCE_RULES) {
      if (re.test(t)) return { source: clean, original: t };
    }
    return { source: 'Other', original: t };
  },

  /* --------------------- fuzzy name de-duplication -------------------- */
  /* The same clients appear with different spellings across quarters —
     "Roz and Mike Stewart" / "Mike and Roz Stewart" / "Roz and Mike", and
     genuine typos like "Hawtim" vs "Hawtin", "Melnyk" vs "Melynk".        */

  _dl(a, b) {                                    // Damerau-Levenshtein
    const m = a.length, n = b.length;
    const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) d[i][0] = i;
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[m][n];
  },

  tokensMatch(x, y) {
    return x === y || (x.length >= 5 && y.length >= 5 && this._dl(x, y) <= 1);
  },

  nameTokens(raw) {
    return String(raw || '').toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t && t !== 'and' && t !== 'the');
  },

  groupNames(names) {
    const groups = [];
    names.forEach(raw => {
      const toks = this.nameTokens(raw);
      if (!toks.length) return;
      let hit = null;
      for (const g of groups) {
        const inter = toks.filter(t => g.tokens.some(u => this.tokensMatch(t, u)));
        // Same people if they share two names and one is contained in the other.
        if (inter.length >= 2 &&
            (inter.length === toks.length || inter.length === g.tokens.length)) {
          hit = g; break;
        }
      }
      if (hit) {
        hit.members.push(raw);
        if (toks.length > hit.tokens.length) hit.tokens = toks;
      } else {
        groups.push({ canonical: raw, tokens: toks, members: [raw] });
      }
    });

    /* Name it whatever spelling she used most; longest wins a tie, so
       "Roz and Mike Stewart" beats "Roz and Mike". */
    groups.forEach(g => {
      const counts = {};
      g.members.forEach(m => {
        const k = String(m).trim();
        counts[k] = (counts[k] || 0) + 1;
      });
      g.canonical = Object.keys(counts).sort((a, b) =>
        (counts[b] - counts[a]) || (b.length - a.length))[0];
      g.members = g.members.map(m => String(m).trim());
    });
    return groups;
  },

  /* --------------------------- reading a sheet ------------------------ */

  idFromUrl(url) {
    const m = String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : String(url || '').trim();
  },

  async tabTitles(id) {
    const meta = await api('https://sheets.googleapis.com/v4/spreadsheets/' + id +
      '?fields=sheets.properties.title');
    return (meta.sheets || []).map(x => x.properties.title);
  },

  async readTab(id, title) {
    const range = encodeURIComponent("'" + title.replace(/'/g, "''") + "'!A1:Z600");
    const r = await api('https://sheets.googleapis.com/v4/spreadsheets/' + id +
      '/values/' + range);
    return r.values || [];
  },

  _headerMap(row) {
    const find = (re) => {
      for (let i = 0; i < row.length; i++) {
        if (re.test(String(row[i] || ''))) return i;
      }
      return -1;
    };
    return {
      date: find(/date deal written/i),
      address: find(/property address/i),
      price: find(/sale price/i),
      close: find(/closing date/i),
      name: find(/name/i),
      commission: find(/commission/i),
      gst: find(/^\s*gst\s*$/i),
      source: find(/source of business/i),
      side: find(/buyer or seller/i),
    };
  },

  /* Rows that are totals, headings or blank — not deals. */
  _isNoise(v) {
    return !v || /^(avg|total|gst|1st|2nd|3rd|4th|date deal)/i.test(String(v).trim());
  },

  parseSalesTab(rows, fallbackYear) {
    const out = [];
    let cols = null;
    rows.forEach((row, rowIndex) => {
      const joined = row.join('|').toLowerCase();
      if (joined.indexOf('date deal written') > -1) { cols = this._headerMap(row); return; }
      if (!cols || cols.date < 0) return;

      const rawDate = String(row[cols.date] || '').trim();
      const address = String(row[cols.address] || '').trim();
      if (this._isNoise(rawDate) || !address) return;

      const src = this.normalizeSource(row[cols.source]);
      out.push({
        rawDate,
        written: this.parseLooseDate(rawDate, fallbackYear),
        address,
        price: this.num(row[cols.price]),
        rawClose: String(row[cols.close] || '').trim(),
        closed: this.parseLooseDate(row[cols.close], fallbackYear),
        name: String(row[cols.name] || '').trim(),
        commission: this.num(row[cols.commission]),
        gst: cols.gst > -1 ? this.num(row[cols.gst]) : '',
        source: src.source,
        sourceOriginal: src.original,
        side: String(row[cols.side] || '').trim(),
        row: rowIndex + 1,
      });
    });
    return out;
  },

  parseAppointmentsTab(rows, fallbackYear) {
    const out = [];
    let cols = null;
    rows.forEach(row => {
      const joined = row.join('|').toLowerCase();
      if (joined.indexOf('new appointment type') > -1) {
        cols = {
          name: row.findIndex(c => /address\/notes/i.test(String(c || ''))),
          date: row.findIndex(c => /^date/i.test(String(c || '').trim())),
          type: row.findIndex(c => /new appointment type/i.test(String(c || ''))),
          source: row.findIndex(c => /source of business/i.test(String(c || ''))),
          taken: row.findIndex(c => /listing taken/i.test(String(c || ''))),
        };
        return;
      }
      if (!cols || cols.name < 0) return;
      const name = String(row[cols.name] || '').trim();
      const date = this.parseLooseDate(row[cols.date], fallbackYear);
      if (!name || !date) return;

      const rawType = String(row[cols.type] || '').trim().toLowerCase();
      out.push({
        name, date,
        type: rawType.indexOf('sell') > -1 || rawType.indexOf('list') > -1
          ? 'Listing Appointment' : 'Buyer Appointment',
        outcome: String(row[cols.taken] || '').trim(),
        source: this.normalizeSource(row[cols.source]).source,
      });
    });
    return out;
  },

  /* ------------------------------ planning ---------------------------- */

  async plan(urlOrId) {
    const id = this.idFromUrl(urlOrId);
    const titles = await this.tabTitles(id);

    const salesTabs = titles.filter(t => /qtr|quarter/i.test(t));
    const apptTab = titles.find(t => /appointment/i.test(t));
    if (!salesTabs.length) {
      throw new Error('No sales tabs found. Expected tab names containing "Qtr" or "Quarter".');
    }

    const warnings = [];
    const year = (Store.settings.goals && Store.settings.goals.year) ||
                 new Date().getFullYear();

    let raw = [];
    for (const t of salesTabs) {
      const rows = await this.readTab(id, t);
      raw = raw.concat(this.parseSalesTab(rows, year).map(d => (d.tab = t, d)));
    }

    let appts = [];
    if (apptTab) {
      appts = this.parseAppointmentsTab(await this.readTab(id, apptTab), year);
    }

    /* --- de-duplicate people across every row --- */
    const allNames = raw.map(d => d.name).concat(appts.map(a => a.name)).filter(Boolean);
    const groups = this.groupNames(allNames);
    const canonicalFor = (raw2) => {
      const toks = this.nameTokens(raw2);
      const g = groups.find(gr => gr.members.indexOf(raw2) > -1) ||
                groups.find(gr => toks.every(t => gr.tokens.some(u => this.tokensMatch(t, u))));
      return g ? g.canonical : raw2;
    };

    /* --- existing CRM records, so a re-run doesn't duplicate --- */
    const existingDeal = new Set(Store.deals.map(d =>
      (String(d['Property Address'] || '').toLowerCase().trim()) + '|' + (d.Created || '')));
    const existingContactByKey = {};
    Store.contacts.forEach(c => {
      existingContactByKey[this.nameTokens(c.Name).sort().join(' ')] = c;
    });

    /* --- build the contact plan --- */
    const contactPlan = groups.map(g => {
      const key = g.tokens.slice().sort().join(' ');
      const rows = raw.filter(d => canonicalFor(d.name) === g.canonical);
      const sources = [...new Set(rows.map(d => d.source).filter(Boolean))];
      const originals = [...new Set(rows.map(d => d.sourceOriginal).filter(Boolean))];
      return {
        name: g.canonical,
        aliases: [...new Set(g.members)].filter(n => n !== g.canonical),
        dealCount: rows.length,
        source: sources[0] || '',
        tags: originals.join(', '),
        existing: existingContactByKey[key] || null,
      };
    });

    /* --- build the deal plan --- */
    const dealPlan = [];
    raw.forEach(d => {
      const key = d.address.toLowerCase().trim() + '|' + d.written;
      const dup = existingDeal.has(key);

      if (!d.written) warnings.push('Row ' + d.row + ' (' + d.tab + '): could not read the date "' + d.rawDate + '"');
      if (!d.commission) warnings.push(d.address + ': no commission recorded');
      if (!d.side) warnings.push(d.address + ': buyer or seller not recorded — defaulting to Buyer');
      if (!d.name) warnings.push(d.address + ': no client name');

      dealPlan.push({
        name: d.address,
        contact: canonicalFor(d.name),
        pipeline: /sell/i.test(d.side) ? 'Seller' : 'Buyer',
        sideBlank: !d.side,
        price: d.price,
        commission: d.commission,
        gst: d.gst,
        written: d.written,
        closed: d.closed,
        rawClose: d.rawClose,
        source: d.source,
        duplicate: dup,
      });
    });

    const apptPlan = appts.map(a => ({
      contact: canonicalFor(a.name),
      type: a.type,
      date: a.date,
      summary: a.type + (a.outcome ? ' — ' + a.outcome : ''),
    }));

    const sourceMapping = {};
    raw.forEach(d => {
      if (!d.sourceOriginal) return;
      (sourceMapping[d.source] = sourceMapping[d.source] || new Set()).add(d.sourceOriginal);
    });

    return {
      id, salesTabs, apptTab,
      contacts: contactPlan,
      deals: dealPlan,
      appointments: apptPlan,
      warnings,
      sourceMapping: Object.entries(sourceMapping)
        .map(([k, v]) => [k, [...v]]).sort(),
      totals: {
        deals: dealPlan.filter(d => !d.duplicate).length,
        skipped: dealPlan.filter(d => d.duplicate).length,
        newContacts: contactPlan.filter(c => !c.existing).length,
        volume: dealPlan.filter(d => !d.duplicate)
          .reduce((t, d) => t + Number(d.price || 0), 0),
        commission: dealPlan.filter(d => !d.duplicate)
          .reduce((t, d) => t + Number(d.commission || 0), 0),
      },
    };
  },

  /* ------------------------------ applying ---------------------------- */

  async apply(plan, onProgress) {
    const say = onProgress || function () {};
    const byName = {};

    say('Creating contacts…');
    for (const c of plan.contacts) {
      if (c.existing) { byName[c.name] = c.existing; continue; }

      // Link to a Google contact if one obviously matches — but never create one.
      let googleId = '';
      const toks = this.nameTokens(c.name);
      const match = (People._cache || []).find(p => {
        const pt = this.nameTokens(p.name);
        const inter = toks.filter(t => pt.some(u => this.tokensMatch(t, u)));
        return inter.length >= 2 &&
               (inter.length === toks.length || inter.length === pt.length);
      });
      if (match) googleId = match.id;

      const saved = await Store.saveContact({
        Name: c.name,
        Type: 'Past Client',
        Source: c.source,
        Tags: c.tags,
        Notes: c.aliases.length ? 'Also recorded as: ' + c.aliases.join('; ') : '',
        'Google ID': googleId,
      }, { pushToGoogle: false });
      byName[c.name] = saved;
    }

    say('Creating deals…');
    const newDeals = [];
    plan.deals.filter(d => !d.duplicate).forEach(d => {
      const contact = byName[d.contact];
      newDeals.push({
        ID: Store.newId('D'),
        'Contact ID': contact ? contact.ID : '',
        'Deal Name': d.name,
        Pipeline: d.pipeline,
        Stage: 'Closed',
        Value: d.price,
        'Property Address': d.name,
        'Expected Close': d.closed,
        Created: d.written,
        'Stage Updated': d.closed || d.written,
        Notes: d.source ? 'Source: ' + d.source : '',
        Commission: d.commission,
        GST: d.gst,
        'Closed Date': d.closed,
      });
    });
    Store.deals = Store.deals.concat(newDeals);
    await Sheets.write('Deals', Store.deals);

    say('Logging appointments…');
    const newActs = [];
    plan.appointments.forEach(a => {
      const contact = byName[a.contact];
      newActs.push({
        ID: Store.newId('A'),
        'Contact ID': contact ? contact.ID : '',
        'Deal ID': '',
        Type: a.type,
        Date: a.date,
        Summary: a.summary,
        'Gmail Thread ID': '',
        'Calendar Event ID': '',
        Done: 'yes',
      });
    });
    if (newActs.length) {
      Store.activities = Store.activities.concat(newActs);
      await Sheets.write('Activities', Store.activities);
    }

    return { deals: newDeals.length, activities: newActs.length };
  },
};
