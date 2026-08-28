/* ==========================================================================
   ui.js — small helpers: escaping, formatting, toast, loader, modal, drawer.
   ========================================================================== */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Always escape anything that came from the sheet before putting it in HTML.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : ''))
    .toUpperCase();
}

function money(v) {
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  if (!n || isNaN(n)) return '';
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
}

function numeric(v) {
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function niceDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

function relDays(n) {
  if (n == null) return '';
  if (n === 0) return 'today';
  if (n === 1) return '1 day';
  return n + ' days';
}

/* -------------------------------- toast ---------------------------------- */

let toastTimer = null;
function toast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 2600);
}

/* -------------------------------- loader --------------------------------- */

function showLoader(text) {
  $('#loader-text').textContent = text || 'Working…';
  $('#loader').hidden = false;
}
function hideLoader() { $('#loader').hidden = true; }

/* -------------------------------- drawer --------------------------------- */

function openDrawer(html) {
  const d = $('#drawer');
  d.innerHTML = html;
  d.hidden = false;
  $('#scrim').hidden = false;
  d.scrollTop = 0;
}
function closeDrawer() {
  $('#drawer').hidden = true;
  if ($('#modal').hidden) $('#scrim').hidden = true;
}

/* -------------------------------- modal ---------------------------------- */
/* Modal.open returns a promise that resolves with the form values, or null
   if cancelled. Fields are described declaratively.                          */

const Modal = {
  _resolve: null,

  open({ title, fields, submitLabel = 'Save', onRender }) {
    return new Promise((resolve) => {
      this._resolve = resolve;
      const body = fields.map(f => this._field(f)).join('');
      $('#modal').innerHTML =
        '<div class="modal-card">' +
          '<div class="modal-head"><h3>' + esc(title) + '</h3></div>' +
          '<form id="modal-form"><div class="modal-body">' + body + '</div>' +
          '<div class="modal-foot">' +
            '<button type="button" class="btn" data-cancel>Cancel</button>' +
            '<button type="submit" class="btn btn-primary">' + esc(submitLabel) + '</button>' +
          '</div></form>' +
        '</div>';
      $('#modal').hidden = false;

      const form = $('#modal-form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = {};
        fields.forEach(f => {
          const node = form.elements[f.name];
          if (node) data[f.name] = (node.value || '').trim();
        });
        this.close(data);
      });
      $('[data-cancel]', form).addEventListener('click', () => this.close(null));
      if (onRender) onRender(form);

      fields.filter(f => f.type === 'combo').forEach(f => this._wireCombo(form, f));

      const first = form.querySelector('input:not([type=hidden]), select, textarea');
      if (first && window.matchMedia('(min-width: 761px)').matches) first.focus();
    });
  },

  _field(f) {
    const id = 'f_' + f.name;
    const label = '<label for="' + id + '">' + esc(f.label) + '</label>';
    let control;

    if (f.type === 'select') {
      control = '<select id="' + id + '" name="' + esc(f.name) + '"' +
        (f.required ? ' required' : '') + '>' +
        (f.allowBlank ? '<option value="">—</option>' : '') +
        (f.options || []).map(o => {
          const val = typeof o === 'string' ? o : o.value;
          const txt = typeof o === 'string' ? o : o.label;
          return '<option value="' + esc(val) + '"' +
            (String(f.value) === String(val) ? ' selected' : '') + '>' + esc(txt) + '</option>';
        }).join('') + '</select>';
    } else if (f.type === 'combo') {
      control =
        '<div class="combo">' +
          '<input class="combo-input" id="' + id + '" type="text" autocomplete="off" ' +
            'placeholder="' + esc(f.placeholder || 'Start typing a name…') + '" ' +
            'value="' + esc(f.text || '') + '">' +
          '<input type="hidden" name="' + esc(f.name) + '" value="' + esc(f.value || '') + '">' +
          '<button type="button" class="combo-clear" tabindex="-1" title="Clear">✕</button>' +
          '<div class="combo-list" hidden></div>' +
        '</div>';
    } else if (f.type === 'textarea') {
      control = '<textarea id="' + id + '" name="' + esc(f.name) + '" placeholder="' +
        esc(f.placeholder || '') + '">' + esc(f.value || '') + '</textarea>';
    } else {
      control = '<input id="' + id + '" name="' + esc(f.name) + '" type="' +
        esc(f.type || 'text') + '" value="' + esc(f.value || '') + '" placeholder="' +
        esc(f.placeholder || '') + '"' + (f.required ? ' required' : '') +
        (f.step ? ' step="' + esc(f.step) + '"' : '') + '>';
    }
    return '<div class="field' + (f.half ? ' half' : '') + '">' + label + control + '</div>';
  },

  /* Type-ahead picker. `f.options` is a function returning
     [{value, label, sub, kind}] so the list can be built fresh each keystroke. */
  _wireCombo(form, f) {
    const box = form.querySelector('.combo input[name="' + f.name + '"]').closest('.combo');
    const input = box.querySelector('.combo-input');
    const hidden = box.querySelector('input[type=hidden]');
    const list = box.querySelector('.combo-list');
    const clear = box.querySelector('.combo-clear');
    let items = [], cursor = -1;

    const render = () => {
      const q = input.value.trim().toLowerCase();
      const all = (typeof f.options === 'function' ? f.options() : f.options) || [];
      items = q
        ? all.filter(o => (o.label + ' ' + (o.sub || '')).toLowerCase().includes(q)).slice(0, 40)
        : all.slice(0, 40);

      if (f.allowNew && q && !items.some(o => o.label.toLowerCase() === q)) {
        items = items.concat([{ value: 'new:' + input.value.trim(),
                                label: 'Create “' + input.value.trim() + '”',
                                kind: 'new' }]);
      }
      if (!items.length) {
        list.innerHTML = '<div class="combo-empty">No one matches that</div>';
      } else {
        list.innerHTML = items.map((o, i) =>
          '<div class="combo-item' + (i === cursor ? ' on' : '') + '" data-i="' + i +
            '" data-value="' + esc(o.value) + '">' +
            '<span class="combo-label">' + esc(o.label) + '</span>' +
            (o.sub ? '<span class="combo-sub">' + esc(o.sub) + '</span>' : '') +
            (o.kind && o.kind !== 'crm'
              ? '<span class="pill ' + (o.kind === 'new' ? '' : 'info') + '">' +
                (o.kind === 'new' ? 'new' : 'Google') + '</span>'
              : '') +
          '</div>').join('');
      }
      list.hidden = false;
    };

    const choose = (i) => {
      const o = items[i];
      if (!o) return;
      hidden.value = o.value;
      input.value = o.kind === 'new' ? o.value.slice(4) : o.label;
      list.hidden = true;
      cursor = -1;
    };

    input.addEventListener('focus', render);
    input.addEventListener('input', () => { cursor = -1; hidden.value = ''; render(); });
    input.addEventListener('keydown', (e) => {
      if (list.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) return render();
      if (e.key === 'ArrowDown') { e.preventDefault(); cursor = Math.min(cursor + 1, items.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cursor = Math.max(cursor - 1, 0); render(); }
      else if (e.key === 'Enter' && !list.hidden && cursor >= 0) { e.preventDefault(); choose(cursor); }
      else if (e.key === 'Escape') { list.hidden = true; }
    });
    list.addEventListener('mousedown', (e) => {
      const row = e.target.closest('[data-i]');
      if (row) { e.preventDefault(); choose(Number(row.dataset.i)); }
    });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
    clear.addEventListener('click', () => {
      input.value = ''; hidden.value = ''; input.focus(); render();
    });
  },

  close(value) {
    $('#modal').hidden = true;
    $('#modal').innerHTML = '';
    if ($('#drawer').hidden) $('#scrim').hidden = true;
    if (this._resolve) { this._resolve(value); this._resolve = null; }
  },
};

function confirmBox(message) {
  return Modal.open({
    title: 'Are you sure?',
    fields: [],
    submitLabel: 'Yes, do it',
    onRender: (form) => {
      const p = document.createElement('p');
      p.style.margin = '0'; p.style.color = 'var(--text-2)';
      p.textContent = message;
      $('.modal-body', form).prepend(p);
    },
  }).then(r => r !== null);
}
