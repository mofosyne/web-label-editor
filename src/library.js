// SPDX-License-Identifier: GPL-3.0-or-later
// "My labels" (named saved designs, also used as templates) and the print
// history, kept in this browser. Each entry stores the design and a small
// thumbnail.

const LABELS_KEY = 'web-label-editor:labels';
const HISTORY_KEY = 'web-label-editor:history';
export const HISTORY_LIMIT = 50;

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? [];
  } catch {
    return [];
  }
}

// Saves a list; if the browser's storage is full, drops the oldest entries
// (end of the list) until it fits, when `trim` is allowed.
function store(key, list, { trim = false } = {}) {
  let items = list;
  for (;;) {
    try {
      localStorage.setItem(key, JSON.stringify(items));
      return items;
    } catch (err) {
      if (!trim || items.length <= 1) throw new Error('Browser storage is full; delete some saved labels or history.');
      items = items.slice(0, Math.ceil(items.length / 2));
    }
  }
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clone = (design) => JSON.parse(JSON.stringify(design));

export const labels = {
  list: () => load(LABELS_KEY),
  get: (id) => load(LABELS_KEY).find((l) => l.id === id) ?? null,
  // Creates or updates an entry; returns it.
  save({ id, name, design, thumb }) {
    const list = load(LABELS_KEY);
    const existing = id && list.find((l) => l.id === id);
    const entry = {
      id: existing ? id : newId(),
      name: name ?? existing?.name ?? 'Label',
      design: clone(design),
      thumb,
      updated: new Date().toISOString(),
    };
    const rest = list.filter((l) => l.id !== entry.id);
    store(LABELS_KEY, [entry, ...rest]);
    return entry;
  },
  rename(id, name) {
    store(LABELS_KEY, load(LABELS_KEY).map((l) => (l.id === id ? { ...l, name } : l)));
  },
  remove(id) {
    store(LABELS_KEY, load(LABELS_KEY).filter((l) => l.id !== id));
  },
};

export const history = {
  list: () => load(HISTORY_KEY),
  add({ design, thumb, printer, medium, copies }) {
    const entry = {
      id: newId(), design: clone(design), thumb, printer, medium, copies, printed: new Date().toISOString(),
    };
    store(HISTORY_KEY, [entry, ...load(HISTORY_KEY)].slice(0, HISTORY_LIMIT), { trim: true });
    return entry;
  },
  remove(id) {
    store(HISTORY_KEY, load(HISTORY_KEY).filter((h) => h.id !== id));
  },
  clear() {
    store(HISTORY_KEY, []);
  },
};

// ---------- dialog ----------

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, attrs);
  e.append(...children.filter((c) => c != null));
  return e;
}

function button(text, onClick, className = '') {
  const b = el('button', { type: 'button', textContent: text, className });
  b.onclick = onClick;
  return b;
}

const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function card({ thumb, title, lines, actions, current }) {
  return el('li', { className: current ? 'card current' : 'card' },
    el('div', { className: 'thumb' }, thumb ? el('img', { src: thumb, alt: '' }) : null),
    el('div', { className: 'meta' },
      el('strong', { textContent: title }),
      ...lines.map((t) => el('span', { textContent: t }))),
    el('div', { className: 'actions' }, ...actions));
}

// ctx: { tab, currentLabelId, describe(design) -> string, onOpen(design, labelId|null), onChanged() }
export function openLibrary(dialog, ctx) {
  let tab = ctx.tab ?? 'labels';
  const render = () => {
    const tabs = el('div', { className: 'tabs', role: 'tablist' }, ...[['labels', 'My labels'], ['history', 'History']].map(([id, name]) => {
      const t = button(name, () => { tab = id; render(); }, id === tab ? 'tab active' : 'tab');
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', String(id === tab));
      return t;
    }));
    const close = button('×', () => dialog.close(), 'close');
    close.ariaLabel = 'Close';

    let body;
    if (tab === 'labels') {
      const list = labels.list();
      body = list.length
        ? el('ul', { className: 'cards' }, ...list.map((l) => card({
          thumb: l.thumb,
          title: l.name,
          current: l.id === ctx.currentLabelId,
          lines: [ctx.describe(l.design), `Saved ${when(l.updated)}`],
          actions: [
            button('Open', () => { dialog.close(); ctx.onOpen(l.design, l.id); }, 'primary'),
            button('Use as template', () => { dialog.close(); ctx.onOpen(l.design, null); }),
            button('Rename…', () => {
              const name = prompt('Name', l.name);
              if (name?.trim()) { labels.rename(l.id, name.trim()); render(); }
            }),
            button('Delete', () => {
              if (confirm(`Delete "${l.name}" from My labels?`)) { labels.remove(l.id); ctx.onChanged(); render(); }
            }),
          ],
        })))
        : el('p', { className: 'empty', textContent: 'No saved labels yet. Use "Save to My labels" in the Design panel to keep the current label here; saved labels can be reopened or used as templates.' });
    } else {
      const list = history.list();
      body = list.length
        ? el('div', {},
          el('ul', { className: 'cards' }, ...list.map((h) => card({
            thumb: h.thumb,
            title: when(h.printed),
            lines: [`${h.printer} · ${h.medium}`, h.copies > 1 ? `${h.copies} copies` : '1 copy'],
            actions: [
              button('Open', () => { dialog.close(); ctx.onOpen(h.design, null); }, 'primary'),
              button('Remove', () => { history.remove(h.id); render(); }),
            ],
          }))),
          el('div', { className: 'row' }, button('Clear history', () => {
            if (confirm('Clear the whole print history?')) { history.clear(); render(); }
          })))
        : el('p', { className: 'empty', textContent: `Labels you print appear here (the last ${HISTORY_LIMIT}), so you can reprint or adjust them later.` });
    }

    dialog.replaceChildren(
      el('header', {}, el('h2', { textContent: 'Labels' }), close),
      tabs,
      el('div', { className: 'about-body' }, body),
      el('div', { className: 'row' }, button('Close', () => dialog.close())),
    );
  };
  render();
  if (!dialog.open) dialog.showModal();
}
