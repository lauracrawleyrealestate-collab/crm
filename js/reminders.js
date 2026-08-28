/* ==========================================================================
   reminders.js — the dates a real estate business runs on.

   Nothing here is stored. Every reminder is derived from data that already
   exists: a birthday on a contact, the closing date of a deal, how long it has
   been since someone was last contacted. That means the calendar is never out
   of step with the CRM, and there is no second list to keep tidy.
   ========================================================================== */

/* ---- small local-date helpers (strings, never UTC, so no midnight drift) --- */

function isoDate(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function addDays(iso, n) {
  const d = parseISO(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/* Monday of the week containing `iso`. */
function weekStart(iso) {
  const d = parseISO(iso) || new Date();
  const shift = (d.getDay() + 6) % 7;          // Sun=0 -> 6, Mon=1 -> 0
  d.setDate(d.getDate() - shift);
  return isoDate(d);
}

function todayISO() { return isoDate(new Date()); }

function dayName(iso) {
  const d = parseISO(iso);
  return d ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()] : '';
}

/* "Aug 25" — short, for day headers and chips. */
function shortDate(iso) {
  const d = parseISO(iso);
  if (!d) return '';
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] +
    ' ' + d.getDate();
}

const Reminders = {
  /* How often Laura wants to be in front of someone. */
  CADENCES: ['', 'Monthly', 'Quarterly', 'Twice a year', 'Yearly'],
  CADENCE_DAYS: { Monthly: 30, Quarterly: 91, 'Twice a year': 182, Yearly: 365 },

  /* Which filter chip each kind belongs to. */
  GROUP: {
    birthday: 'birthday', anniversary: 'anniversary', touchpoint: 'touchpoint',
    conditions: 'deadline', possession: 'deadline', close: 'deadline', task: 'task',
  },

  /* Colour carries only three families (validated for colour-blind separation);
     the icon and the words carry the specific kind. */
  FAMILY: {
    birthday: 'client', anniversary: 'client', touchpoint: 'do',
    conditions: 'deadline', possession: 'deadline', close: 'deadline', task: 'do',
  },

  ICON: {
    birthday: '🎂', anniversary: '🏡', touchpoint: '☎', conditions: '⏱',
    possession: '🔑', close: '🏁', task: '✓',
  },

  LABEL: {
    birthday: 'Birthday', anniversary: 'Sale anniversary', touchpoint: 'Touch base',
    conditions: 'Conditions due', possession: 'Possession', close: 'Expected close',
    task: 'To do',
  },

  /* The month/day of `iso`, landed in whichever year puts it inside the range.
     Returns null when that anniversary does not fall in the window. */
  _occurrence(iso, fromISO, toISO) {
    const src = parseISO(iso);
    if (!src) return null;
    const from = parseISO(fromISO), to = parseISO(toISO);
    for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
      const cand = new Date(y, src.getMonth(), src.getDate());
      const c = isoDate(cand);
      if (c >= fromISO && c <= toISO) return c;
    }
    return null;
  },

  /* Every reminder falling between two dates, inclusive, oldest first. */
  forRange(fromISO, toISO) {
    const out = [];
    const today = todayISO();
    const push = (o) => out.push(o);

    Store.contacts.forEach(c => {
      // Birthday
      if (c.Birthday) {
        const on = this._occurrence(c.Birthday, fromISO, toISO);
        if (on) {
          const born = parseISO(c.Birthday);
          const age = born && born.getFullYear() > 1900
            ? parseISO(on).getFullYear() - born.getFullYear() : null;
          push({ date: on, kind: 'birthday', contactId: c.ID, dealId: '',
                 title: c.Name + "'s birthday",
                 sub: age ? 'turns ' + age : '' });
        }
      }

      // Time to touch base
      const cadence = c['Touch Cadence'];
      const days = this.CADENCE_DAYS[cadence];
      if (days) {
        const last = c['Last Contacted'] || c.Created;
        const due = last ? addDays(last, days) : today;
        let on = null;
        if (due >= fromISO && due <= toISO) on = due;
        else if (due < fromISO && today >= fromISO && today <= toISO) on = today;
        if (on) {
          const over = Store.daysSince(due);
          push({ date: on, kind: 'touchpoint', contactId: c.ID, dealId: '',
                 title: 'Touch base with ' + c.Name,
                 sub: (cadence || '') + (over > 0 ? ' · ' + over + ' days overdue' : ''),
                 overdue: over > 0 });
        }
      }
    });

    Store.deals.forEach(d => {
      const c = Store.contact(d['Contact ID']);
      const who = c ? c.Name : '';
      const closed = CLOSED_STAGES.includes(d.Stage);

      // Sale anniversary — the single highest-value past-client touch there is.
      if (d.Stage === 'Closed' && d['Closed Date']) {
        const on = this._occurrence(d['Closed Date'], fromISO, toISO);
        const years = on
          ? parseISO(on).getFullYear() - parseISO(d['Closed Date']).getFullYear() : 0;
        if (on && years >= 1) {
          push({ date: on, kind: 'anniversary', contactId: d['Contact ID'], dealId: d.ID,
                 title: years + (years === 1 ? ' year' : ' years') + ' at ' +
                        (d['Property Address'] || d['Deal Name']),
                 sub: who });
        }
      }

      if (closed) return;

      const deadline = (field, kind) => {
        const v = d[field];
        if (v && v >= fromISO && v <= toISO) {
          push({ date: v, kind: kind, contactId: d['Contact ID'], dealId: d.ID,
                 title: this.LABEL[kind] + ' — ' + d['Deal Name'],
                 sub: who });
        }
      };
      deadline('Conditions Due', 'conditions');
      deadline('Possession Date', 'possession');
      deadline('Expected Close', 'close');
    });

    // Anything logged as an upcoming activity and not yet ticked off.
    Store.activities.forEach(a => {
      if (a.Done === 'yes') return;
      if (!a.Date || a.Date < fromISO || a.Date > toISO) return;
      if (a['Calendar Event ID']) return;         // already a real calendar event
      const c = Store.contact(a['Contact ID']);
      push({ date: a.Date, kind: 'task', contactId: a['Contact ID'] || '',
             dealId: a['Deal ID'] || '', activityId: a.ID,
             title: a.Summary || a.Type,
             sub: [a.Type, c && c.Name].filter(Boolean).join(' · ') });
    });

    return out.sort((a, b) =>
      a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  },
};
