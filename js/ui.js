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
