import { MODELS, mediumMargins } from './printers/models.js';
import { renderDesign, bitmapToCanvas, itemError } from './render.js';
import { SYMBOLOGIES } from './codes/barcode.js';
import { UsbTransport, SerialTransport, support } from './transport.js';
import { openHelp } from './help.js';
import { openAbout } from './about.js';
import { labels, history, openLibrary } from './library.js';
import { printerReportUrl, labelRequestUrl } from './report.js';
import { loadCatalog } from './catalog.js';
import { testPatternDesign, shiftBitmap } from './calibration.js';
import { newRollId, rollCode, parseRollCode } from './rolls.js';

const STORAGE_KEY = 'web-label-editor:design';
const $ = (id) => document.getElementById(id);

const FONTS = ['sans-serif', 'serif', 'monospace', 'Arial', 'Helvetica', 'Verdana', 'Georgia', 'Courier New', 'Impact'];

function newDesign() {
  return {
    version: 1,
    // The tested printer, with a text box filling the printable area.
    printer: 'dymo-lw450',
    medium: '30252',
    options: {},
    length: { mode: 'auto', mm: 60, padMm: 2 },
    border: false,
    invert: false,
    items: [
      {
        id: uid(), type: 'text', text: 'Hello label', font: 'sans-serif', size: 7.5, bold: true, italic: false,
        align: 'center', fit: true, x: 6, y: 1.5, w: 80, h: 24,
      },
    ],
  };
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function loadDesign() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* storage unavailable */ }
  return newDesign();
}

function saveDesign() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
  } catch { /* storage unavailable or full */ }
}

// Labels and tapes come from catalog/media.rec; nothing works without them.
try {
  await loadCatalog(MODELS);
} catch (err) {
  const b = $('banner');
  b.textContent = `${err.message}. Reload the page; if it persists, the catalogue file is broken.`;
  b.hidden = false;
  throw err;
}

let design = loadDesign();
let selectedId = design.items[0]?.id ?? null;
let zoom = 6; // screen px per mm
let transport = null;
let last = null; // last render result
let loaded = null; // last tape status reported by the printer

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Preview in the loaded tape's colours when the printer told us what they are.
function previewColors() {
  if (loaded?.mediumId === design.medium && loaded.tapeColor.hex && loaded.textColor.hex) {
    return { ink: hexToRgb(loaded.textColor.hex), paper: hexToRgb(loaded.tapeColor.hex) };
  }
  return { ink: [17, 17, 17], paper: [255, 255, 255] };
}

function describeTape(s) {
  if (!s.tapeMm) return 'no tape detected';
  return `${s.tapeMm} mm ${s.mediaType.name.toLowerCase()}, ${s.textColor.name.toLowerCase()} on ${s.tapeColor.name.toLowerCase()}`;
}

const model = () => MODELS[design.printer] ?? MODELS['brother-pt-p710bt'];
const medium = () => model().media.find((m) => m.id === design.medium) ?? model().media[0];
const selected = () => design.items.find((i) => i.id === selectedId) ?? null;
const acrossMm = () => (medium().acrossDots * 25.4) / model().dpi;
// Position adjustment (mm), measured with the grid test print. It is kept
// per label type on each printer, since third-party label stock can sit
// differently from genuine labels:
//   { [printer]: { feedMm, acrossMm, media: { [mediumId]: { feedMm, acrossMm } } } }
// The printer-level values are the fallback for label types not yet
// calibrated (and hold settings saved before adjustments were per label).
// Positive feed moves the print towards the end that comes out last;
// positive across moves it down (towards the bottom of the preview).
const SETTINGS_KEY = 'web-label-editor:printers';
let printerSettings = (() => {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {};
  } catch {
    return {};
  }
})();
// Saved rolls ("My rolls", see rolls.js): [{ id, name, printer, medium, feedMm, acrossMm }].
const ROLLS_KEY = 'web-label-editor:rolls';
let rolls = (() => {
  try {
    return JSON.parse(localStorage.getItem(ROLLS_KEY)) ?? [];
  } catch {
    return [];
  }
})();
function saveRolls() {
  try {
    localStorage.setItem(ROLLS_KEY, JSON.stringify(rolls));
  } catch { /* storage unavailable */ }
}
// The roll the design is set to print on, if it still exists and matches.
const currentRoll = () => rolls.find((r) => r.id === design.roll
  && r.printer === design.printer && r.medium === medium().id) ?? null;

const adjust = () => {
  const roll = currentRoll();
  if (roll) return { feedMm: roll.feedMm, acrossMm: roll.acrossMm };
  const { feedMm = 0, acrossMm = 0, media = {} } = printerSettings[design.printer] ?? {};
  return { feedMm, acrossMm, ...media[medium().id] };
};
function setAdjust(key, value) {
  const roll = currentRoll();
  if (roll) {
    roll[key] = value;
    saveRolls();
    return;
  }
  const forPrinter = printerSettings[design.printer] ?? {};
  const media = { ...forPrinter.media, [medium().id]: { ...adjust(), [key]: value } };
  printerSettings = { ...printerSettings, [design.printer]: { ...forPrinter, media } };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(printerSettings));
  } catch { /* storage unavailable */ }
}

// Where the printer can actually put ink on the label. A position
// adjustment shifts what is sent, which makes the edge it shifts away from
// unreachable: e.g. Feed -6 (printer starts 6 mm late) means nothing can
// print in the first 6 mm. The catalogue margins apply as well.
const margins = () => {
  const mg = mediumMargins(medium());
  const a = adjust();
  return {
    left: Math.max(mg.left, -a.feedMm),
    right: Math.max(mg.right, a.feedMm),
    top: Math.max(mg.top, -a.acrossMm),
    bottom: Math.max(mg.bottom, a.acrossMm),
  };
};
// The printable band across the strip, in mm.
const bandTop = () => margins().top;
const usableMm = () => acrossMm() - margins().top - margins().bottom;
const round1 = (v) => Math.round(v * 10) / 10;

// Items that show a corner handle for resizing, and how a drag sets the size.
const RESIZERS = {
  box: (it, w, h) => { it.w = w; it.h = h; },
  image: (it, w) => { it.w = w; },
  qr: (it, w, h) => { it.size = Math.max(w, h); },
  text: (it, w, h) => { it.w = w; it.h = h; },
};
const resizable = (it) => RESIZERS[it.type] && (it.type !== 'text' || it.fit);

function option(id) {
  const def = model().options.find((o) => o.id === id);
  return design.options[id] ?? def?.default;
}

// ---------- rendering ----------

let pending = false;
function refresh({ props = false, setup = false } = {}) {
  if (setup) buildSetup();
  if (props) buildProps();
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    draw();
    saveDesign();
  });
}

function draw() {
  const m = model();
  const med = medium();
  last = renderDesign(design, m, med, () => refresh());
  const { bitmap, dpmm } = last;

  const canvas = $('canvas');
  const scale = zoom / dpmm; // screen px per dot
  const cssW = bitmap.width * scale;
  const cssH = bitmap.height * scale;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const colors = previewColors();
  ctx.drawImage(bitmapToCanvas(bitmap, colors.ink, colors.paper), 0, 0, cssW, cssH);
  canvas.style.borderRadius = med.cornerMm ? `${med.cornerMm * zoom}px` : '0';

  // Shade the border the printer cannot print on.
  const mg = margins();
  const lenMm = bitmap.width / dpmm;
  const area = {
    x0: mg.left * zoom, y0: mg.top * zoom,
    x1: (lenMm - mg.right) * zoom, y1: (acrossMm() - mg.bottom) * zoom,
  };
  if (mg.left || mg.right || mg.top || mg.bottom) {
    ctx.fillStyle = marginPattern(ctx);
    ctx.fillRect(0, 0, cssW, area.y0);
    ctx.fillRect(0, area.y1, cssW, cssH - area.y1);
    ctx.fillRect(0, area.y0, area.x0, area.y1 - area.y0);
    ctx.fillRect(area.x1, area.y0, cssW - area.x1, area.y1 - area.y0);
    ctx.strokeStyle = 'rgba(120, 120, 120, .6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(area.x0, area.y0, area.x1 - area.x0, area.y1 - area.y0);
    ctx.setLineDash([]);
  }

  const sel = design.items.findIndex((i) => i.id === selectedId);
  if (sel >= 0) {
    const b = last.bounds[sel];
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2463eb';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(b.x * scale - 2, b.y * scale - 2, b.w * scale + 4, b.h * scale + 4);
    ctx.setLineDash([]);
    if (resizable(design.items[sel])) {
      const h = handleRect(b, scale);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(h.x, h.y, h.size, h.size);
    }
  }

  const tape = med.tapeMm ? `${med.tapeMm} mm tape, ${acrossMm().toFixed(1)} mm printable` : `${acrossMm().toFixed(1)} mm wide`;
  if (med.margins) $('dims').title = 'Hatched border: the printer cannot print there (from DYMO\'s driver).';
  // Font boxes include some blank space, so allow a little slack.
  const slack = 0.3 * zoom;
  const offLabel = last.bounds.some((b) => b.x * scale < area.x0 - slack || b.y * scale < area.y0 - slack
    || (b.y + b.h) * scale > area.y1 + slack || (b.x + b.w) * scale > area.x1 + slack);
  const dims = $('dims');
  dims.textContent = `${tape} × ${lenMm.toFixed(1)} mm long  ·  ${bitmap.width} × ${bitmap.height} dots @ ${m.dpi} dpi`
    + (offLabel ? '  ·  ⚠ Something is outside the printable area and will be cut off' : '');
  dims.classList.toggle('warn', offLabel);
  $('zoom-label').textContent = `${Math.round((zoom / 6) * 100)}%`;
  updateCodeInfo();
  updateFitInfo();
  if (editing) positionEditor();
}

let hatch = null;
function marginPattern(ctx) {
  if (!hatch) {
    hatch = document.createElement('canvas');
    hatch.width = hatch.height = 8;
    const h = hatch.getContext('2d');
    h.fillStyle = 'rgba(150, 150, 150, .18)';
    h.fillRect(0, 0, 8, 8);
    h.strokeStyle = 'rgba(120, 120, 120, .45)';
    h.beginPath();
    h.moveTo(0, 8);
    h.lineTo(8, 0);
    h.stroke();
  }
  return ctx.createPattern(hatch, 'repeat');
}

// Corner handle of a selected item, in screen px relative to the canvas.
function handleRect(b, scale) {
  const size = 8;
  return { x: (b.x + b.w) * scale + 2 - size / 2, y: (b.y + b.h) * scale + 2 - size / 2, size };
}

// ---------- setup panel ----------

function buildSetup() {
  const m = model();
  const printerSel = $('printer');
  const brands = new Map();
  for (const [id, mm] of Object.entries(MODELS)) {
    if (!brands.has(mm.brand)) {
      const g = document.createElement('optgroup');
      g.label = mm.brand;
      brands.set(mm.brand, g);
    }
    const label = mm.status === 'tested' ? mm.name : `${mm.name} (experimental)`;
    brands.get(mm.brand).append(new Option(label, id, false, id === design.printer));
  }
  printerSel.replaceChildren(...brands.values());

  const mediumSel = $('medium');
  const roll = currentRoll();
  const types = document.createElement('optgroup');
  types.label = 'Label types';
  types.append(...m.media.map((md) => new Option(md.name, md.id, false, !roll && md.id === medium().id)));
  mediumSel.replaceChildren(types);
  const mine = rolls.filter((r) => r.printer === design.printer && m.media.some((md) => md.id === r.medium));
  if (mine.length) {
    const group = document.createElement('optgroup');
    group.label = 'My rolls';
    group.append(...mine.map((r) => new Option(`${r.name} (${r.id})`, `roll:${r.id}`, false, roll?.id === r.id)));
    mediumSel.append(group);
  }

  const fixedLength = !!medium().lengthDots;
  $('length-controls').hidden = fixedLength;
  $('length-fixed-note').hidden = !fixedLength;
  document.querySelectorAll('input[name="lenmode"]').forEach((r) => { r.checked = r.value === design.length.mode; });
  $('len-mm').value = design.length.mm;
  // Only the setting that applies: a length when fixed, padding when it fits the content.
  $('len-mm').closest('label').hidden = design.length.mode !== 'fixed';
  $('pad-mm').value = design.length.padMm;
  $('pad-mm').closest('label').hidden = design.length.mode !== 'auto';
  $('border').checked = !!design.border;
  $('invert').checked = !!design.invert;

  const opts = $('model-options');
  opts.replaceChildren(...m.options.map((o) => {
    const label = document.createElement('label');
    if (o.type === 'checkbox') {
      label.className = 'inline';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!option(o.id);
      input.onchange = () => { design.options[o.id] = input.checked; saveDesign(); };
      label.append(input, ` ${o.label}`);
    } else {
      label.textContent = o.label;
      const sel = document.createElement('select');
      o.choices.forEach((c) => sel.add(new Option(c, c, false, c === option(o.id))));
      sel.onchange = () => { design.options[o.id] = sel.value; saveDesign(); };
      label.append(sel);
    }
    return label;
  }));
  $('model-note').textContent = m.note ?? '';
  updateReportLinks();
  const linked = design.labelId ? labels.get(design.labelId) : null;
  if (design.labelId && !linked) delete design.labelId;
  $('lib-current').hidden = !linked;
  $('lib-current').textContent = linked ? `Editing "${linked.name}" from My labels.` : '';
  $('btn-lib-save').textContent = linked ? 'Save' : 'Save to My labels';
  buildAdjust();

  const btns = $('connect-buttons');
  const connectLabels = { usb: 'Connect USB', serial: 'Connect Bluetooth / serial' };
  btns.replaceChildren(...m.transports.map((t) => {
    const b = document.createElement('button');
    b.textContent = transport ? 'Disconnect' : connectLabels[t];
    b.disabled = !transport && !support[t];
    b.title = support[t] ? '' : 'Not supported in this browser';
    b.onclick = () => (transport ? disconnect() : connect(t));
    return b;
  }).slice(0, transport ? 1 : undefined));
  $('btn-detect').hidden = !(m.queryStatus && transport);
  $('btn-print').disabled = !transport;
}

function buildAdjust() {
  const box = $('adjust');
  const a = adjust();
  const input = (label, key) => {
    const l = document.createElement('label');
    l.textContent = label;
    const i = document.createElement('input');
    i.type = 'number';
    i.step = '0.1';
    i.value = a[key];
    i.oninput = () => { setAdjust(key, parseFloat(i.value) || 0); updateAdjustState(); refresh(); };
    l.append(i);
    return l;
  };
  const grid = document.createElement('div');
  grid.className = 'grid2';
  grid.append(input('Feed (mm)', 'feedMm'), input('Across (mm)', 'acrossMm'));
  const note = document.createElement('p');
  note.className = 'note';
  const roll = currentRoll();
  note.textContent = roll
    ? `For your roll "${roll.name}" (${roll.id}), a ${medium().name}. Saved in this browser.`
    : `Default for ${medium().name} on this printer, saved in this browser. Third-party rolls can be saved as their own roll below. Use the test prints to measure it.`;

  const tests = document.createElement('div');
  tests.className = 'tests';
  const summary = document.createElement('h3');
  summary.textContent = 'Test prints (hardware check)';
  const row = document.createElement('div');
  row.className = 'row';
  for (const [pattern, label] of [['grid', 'Grid'], ['black', 'Full black']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.disabled = !transport;
    b.title = transport ? '' : 'Connect the printer first';
    b.onclick = () => printTestPattern(pattern);
    row.append(b);
  }
  const how = document.createElement('p');
  how.className = 'note';
  how.textContent = 'Grid: each numbered line should be that many mm from the label\'s starting edge (the end that comes out first). '
    + 'Measure one: if line n is at n + d mm, set Feed to −d; at n − d mm, set +d. Do the same from the top edge for Across. '
    + 'Lines in the hatched border may be missing; that is expected. Full black shows everything the printer can reach.';
  tests.append(summary, row, how);
  box.replaceChildren(grid, note, rollPanel(roll), tests);
  updateAdjustState();
}

// The collapsed "Position adjust" heading still says when something is active.
function updateAdjustState() {
  const a = adjust();
  const roll = currentRoll();
  const fmt = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`;
  const parts = [];
  if (a.feedMm) parts.push(`Feed ${fmt(a.feedMm)}`);
  if (a.acrossMm) parts.push(`Across ${fmt(a.acrossMm)}`);
  if (roll) parts.push(`roll ${roll.id}`);
  $('adjust-state').textContent = parts.length ? `· ${parts.join(' · ')}` : '';
}

// Chooses a catalogue label type, or one of "My rolls" ("roll:ID").
function selectMedium(value) {
  if (value.startsWith('roll:')) {
    const roll = rolls.find((r) => r.id === value.slice(5));
    if (!roll) return;
    design.medium = roll.medium;
    design.roll = roll.id;
  } else {
    design.medium = value;
    delete design.roll;
  }
}

function rollPanel(roll) {
  const wrap = document.createElement('div');
  const btn = (text, fn) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.onclick = fn;
    return b;
  };
  const row = document.createElement('div');
  row.className = 'row';
  if (roll) {
    const code = rollCode(roll);
    const p = document.createElement('p');
    p.className = 'roll-code';
    p.innerHTML = 'Write on the roll: <strong></strong><br>Calibration code: <code></code>';
    p.querySelector('strong').textContent = roll.id;
    p.querySelector('code').textContent = code;
    const copy = btn('Copy code', async () => {
      try {
        await navigator.clipboard.writeText(code);
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Select the code to copy';
      }
    });
    row.append(
      copy,
      btn('Rename…', () => {
        const name = prompt('Name for this roll', roll.name);
        if (name?.trim()) { roll.name = name.trim(); saveRolls(); refresh({ setup: true }); }
      }),
      btn('Forget roll', () => {
        if (!confirm(`Forget roll "${roll.name}" (${roll.id})? Its calibration will be lost unless you kept the code.`)) return;
        rolls = rolls.filter((r) => r !== roll);
        saveRolls();
        delete design.roll;
        refresh({ setup: true });
      }),
    );
    wrap.append(p);
  } else {
    row.append(btn('Save as roll…', () => {
      const name = prompt(`Name this roll of ${medium().name} (e.g. brand or batch)`, `${medium().name.split(' ')[0]} roll`);
      if (!name?.trim()) return;
      const a = adjust();
      const created = {
        id: newRollId(rolls.map((r) => r.id)), name: name.trim(), printer: design.printer, medium: medium().id,
        feedMm: a.feedMm, acrossMm: a.acrossMm,
      };
      rolls.push(created);
      saveRolls();
      design.roll = created.id;
      refresh({ setup: true });
    }));
  }
  row.append(btn('Add roll from code…', addRollFromCode));
  wrap.append(row);
  return wrap;
}

function addRollFromCode() {
  const code = prompt('Calibration code from the roll (e.g. K7QX/30252/F5.0/A0.0)');
  if (!code?.trim()) return;
  const all = Object.entries(MODELS).flatMap(([printer, m]) => m.media.map((md) => ({ printer, id: md.id })));
  try {
    const parsed = parseRollCode(code, all.map((x) => x.id));
    const printer = all.find((x) => x.id === parsed.medium).printer;
    let roll = rolls.find((r) => r.id === parsed.id);
    if (roll && !confirm(`Roll ${parsed.id} ("${roll.name}") is already saved. Replace its calibration with this code?`)) return;
    if (roll) {
      Object.assign(roll, { printer, medium: parsed.medium, feedMm: parsed.feedMm, acrossMm: parsed.acrossMm });
    } else {
      const name = prompt('Name for this roll', `Roll ${parsed.id}`) || `Roll ${parsed.id}`;
      roll = { ...parsed, printer, name: name.trim() };
      rolls.push(roll);
    }
    saveRolls();
    if (design.printer !== printer) {
      design.printer = printer;
      disconnect();
    }
    design.medium = roll.medium;
    design.roll = roll.id;
    showBanner(`Roll ${roll.id} ready: ${roll.name}.`);
    refresh({ setup: true });
  } catch (err) {
    showBanner(`Could not read that code: ${err.message}`);
  }
}

// Pre-filled GitHub issue links for this printer and label.
function reportUrl() {
  return printerReportUrl({ printer: model().name, label: medium().name, connection: transport?.label });
}
function updateReportLinks() {
  const r = $('report-printer');
  r.href = reportUrl();
  r.textContent = model().status === 'tested'
    ? 'Something not right with this printer? Report it'
    : 'Experimental printer: tried it? Report how it went';
  $('request-label').href = labelRequestUrl({ printer: model().name });
}

function setStatus(text, ok = false) {
  const pill = $('conn-status');
  pill.textContent = text;
  pill.classList.toggle('ok', ok);
}

// Shows a message, optionally with one action button (e.g. "How to fix…").
function showBanner(text, action) {
  const b = $('banner');
  b.textContent = text;
  if (text && action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.onclick = action.onClick;
    b.append(' ', btn);
  }
  b.hidden = !text;
}

function showUsbProblem(err) {
  showBanner(err.message, { label: 'How to fix…', onClick: () => showUsbHelp(err.usbProblem) });
}

function showUsbHelp(problem = {}) {
  openHelp($('help-dialog'), { ...problem, onRetry: problem.stage ? () => connect('usb') : null });
}

// ---------- printer connection ----------

async function connect(kind) {
  try {
    transport = kind === 'usb'
      ? await UsbTransport.request(model().usbFilters)
      : await SerialTransport.request();
    setStatus(`Connected: ${transport.label}`, true);
    showBanner('');
    refresh({ setup: true });
    if (model().queryStatus) await detect();
  } catch (err) {
    transport = null;
    loaded = null;
    if (err.usbProblem) {
      showUsbProblem(err);
    } else if (err.name !== 'NotFoundError') {
      showBanner(err.message);
    }
    refresh({ setup: true });
  }
}

async function disconnect() {
  try { await transport?.close(); } catch { /* ignore */ }
  transport = null;
  loaded = null;
  setStatus('Not connected');
  refresh({ setup: true });
}

// Reads the loaded tape and switches the layout to it. Returns the status,
// or null if the printer could not be read.
async function detect({ keep = false } = {}) {
  try {
    const status = await model().queryStatus(transport);
    if (!keep) await transport.release();
    loaded = status;
    if (status.mediumId && status.mediumId !== design.medium) {
      design.medium = status.mediumId;
      delete design.roll;
    }
    setStatus(`Connected: ${transport.label} · ${describeTape(status)}`, true);
    const notes = [...status.errors, ...status.warnings];
    showBanner(notes.length ? `Printer reports: ${notes.join('; ')}` : '');
    refresh({ setup: true });
    return status;
  } catch (err) {
    if (!keep) await transport?.release();
    if (err.usbProblem) showUsbProblem(err);
    else showBanner(`Could not read printer status: ${err.message}`);
    return null;
  }
}

// Before printing, make sure the loaded tape matches the layout so a wrong
// tape doesn't waste a label. Printing goes ahead if status can't be read.
async function checkTapeBeforePrint() {
  if (!model().queryStatus) return true;
  const before = design.medium;
  const status = await detect({ keep: true });
  if (!status) return true;
  if (status.errors.length) return false;
  if (design.medium !== before) {
    showBanner(`The loaded tape is ${describeTape(status)}. The layout was switched to match: check the preview, then print again.`);
    return false;
  }
  return true;
}

async function print() {
  if (!transport) return;
  const btn = $('btn-print');
  btn.disabled = true;
  btn.textContent = 'Printing…';
  try {
    const broken = design.items.find((it) => itemError(it));
    if (broken) {
      showBanner(`Can't print: ${itemError(broken)} (${broken.type === 'qr' ? 'QR code' : 'barcode'} "${broken.data}").`);
      return;
    }
    if (!(await checkTapeBeforePrint())) return;
    const { bitmap } = renderDesign(design, model(), medium());
    const copies = Math.max(1, Math.min(99, parseInt($('copies').value, 10) || 1));
    await sendBitmap(bitmap, copies);
    recordPrint(copies);
    if (model().status !== 'tested') {
      showBanner(`Sent to the ${model().name}, which nobody has reported on yet. Did it print correctly?`,
        { label: 'Report how it went', onClick: () => window.open(reportUrl(), '_blank', 'noopener') });
    } else {
      showBanner(loaded?.warnings.join('; ') ?? '');
    }
  } catch (err) {
    if (err.usbProblem) showUsbProblem(err);
    else showBanner(`Print failed: ${err.message}`);
  } finally {
    await transport?.release();
    btn.textContent = 'Print';
    btn.disabled = !transport;
  }
}

// Applies the position adjustment, encodes and sends.
async function sendBitmap(bitmap, copies = 1) {
  const dpmm = model().dpi / 25.4;
  const a = adjust();
  let dx = Math.round(a.feedMm * dpmm);
  if (model().skipLeadingMargin) dx -= Math.round(mediumMargins(medium()).left * dpmm);
  const shifted = shiftBitmap(bitmap, dx, Math.round(a.acrossMm * dpmm), {
    grow: !medium().lengthDots,
  });
  const opts = Object.fromEntries(model().options.map((o) => [o.id, option(o.id)]));
  const job = model().encode(shifted, medium(), opts);
  for (let i = 0; i < copies; i++) await transport.write(job);
}

// Prints a hardware test pattern over the whole label (margins ignored).
async function printTestPattern(pattern) {
  if (!transport) return;
  const med = medium();
  const dpmm = model().dpi / 25.4;
  const lengthMm = med.lengthDots ? med.lengthDots / dpmm : 60;
  const test = testPatternDesign(pattern, lengthMm, acrossMm(), dpmm, { printer: design.printer, medium: med.id });
  try {
    const { bitmap } = renderDesign(test, model(), med);
    await sendBitmap(bitmap);
    showBanner(pattern === 'grid'
      ? 'Grid sent. Measure a numbered line from the label\'s starting edge: if line n is at n + d mm, set Feed to −d (at n − d mm, +d). Same from the top edge for Across.'
      : 'Full black sent. The black area is everything the printer can reach on this label.');
  } catch (err) {
    if (err.usbProblem) showUsbProblem(err);
    else showBanner(`Print failed: ${err.message}`);
  } finally {
    await transport?.release();
  }
}

function downloadPng() {
  const { bitmap } = renderDesign(design, model(), medium());
  bitmapToCanvas(bitmap).toBlob((blob) => download(blob, 'label.png'));
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- items ----------

function addItem(item) {
  design.items.push({ id: uid(), ...item });
  selectedId = design.items.at(-1).id;
  refresh({ props: true });
}

// X position (mm) just after the rightmost existing item.
function nextX() {
  const right = last ? Math.max(0, ...last.bounds.map((b) => (b.x + b.w) / last.dpmm)) : 0;
  return round1(right ? right + 3 : Math.max(2, margins().left + 1));
}

function addText() {
  const size = Math.max(1.5, round1(usableMm() * 0.6));
  addItem({
    type: 'text', text: 'Text', font: 'sans-serif', size, bold: false, italic: false, align: 'left',
    x: nextX(), y: round1(bandTop() + (usableMm() - size * 1.15) / 2),
  });
}

function addImage(file) {
  const reader = new FileReader();
  reader.onload = () => {
    addItem({ type: 'image', src: reader.result, x: nextX(), y: bandTop(), w: round1(usableMm()), threshold: 128, dither: false, invert: false });
  };
  reader.readAsDataURL(file);
}

function addBox() {
  addItem({ type: 'box', x: nextX(), y: round1(bandTop() + 0.5), w: 20, h: Math.max(2, round1(usableMm() - 1)), stroke: 0.4, fill: false });
}

function addQr() {
  const size = round1(Math.min(25, usableMm() * 0.9));
  addItem({ type: 'qr', data: 'https://example.com', ecc: 'M', size, x: nextX(), y: round1(bandTop() + (usableMm() - size) / 2) });
}

function addBarcode() {
  const textSize = Math.min(3, round1(usableMm() * 0.22));
  const height = Math.max(3, round1(Math.min(15, usableMm() - textSize - 1.2)));
  const total = height + 0.4 + textSize;
  addItem({
    type: 'barcode', symbology: 'code128', data: 'ABC-12345', module: 0.3, height,
    showText: true, textSize, x: nextX(), y: round1(bandTop() + Math.max(0, (usableMm() - total) / 2)),
  });
}

function describe(item) {
  const warn = itemError(item) ? '⚠ ' : '';
  if (item.type === 'text') return item.text.split('\n')[0] || '(empty)';
  if (item.type === 'image') return `${item.w} mm wide`;
  if (item.type === 'qr') return `${warn}${item.data.split('\n')[0] || '(empty)'}`;
  if (item.type === 'barcode') return `${warn}${SYMBOLOGIES[item.symbology].name}: ${item.data}`;
  return `${item.w} × ${item.h} mm`;
}

function buildProps() {
  const list = $('item-list');
  list.replaceChildren(...design.items.map((item) => {
    const li = document.createElement('li');
    li.className = item.id === selectedId ? 'selected' : '';
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = item.type;
    li.append(kind, describe(item));
    li.onclick = () => { selectedId = item.id; refresh({ props: true }); };
    return li;
  }));
  if (!design.items.length) {
    const li = document.createElement('li');
    li.textContent = 'No items yet. Add text, an image or a box.';
    li.style.cursor = 'default';
    list.append(li);
  }

  const panel = $('item-props');
  const item = selected();
  panel.replaceChildren();
  if (!item) return;

  const h2 = document.createElement('h2');
  h2.textContent = `${item.type} properties`;
  panel.append(h2);

  const field = (label, key, attrs = {}) => {
    const l = document.createElement('label');
    l.textContent = label;
    let input;
    if (attrs.type === 'textarea') {
      input = document.createElement('textarea');
    } else if (attrs.type === 'select') {
      input = document.createElement('select');
      attrs.choices.forEach(([v, t]) => input.add(new Option(t, v, false, v === item[key])));
    } else {
      input = document.createElement('input');
      Object.assign(input, attrs);
    }
    if (attrs.type === 'checkbox') {
      l.className = 'inline';
      l.textContent = '';
      input.checked = !!item[key];
      l.append(input, ` ${label}`);
    } else {
      if (attrs.type !== 'select') input.value = item[key] ?? '';
      l.append(input);
    }
    input.addEventListener('input', () => {
      if (attrs.type === 'checkbox') item[key] = input.checked;
      else if (attrs.type === 'number' || attrs.type === 'range') item[key] = parseFloat(input.value) || 0;
      else item[key] = input.value;
      refresh();
      if (['text', 'w', 'h', 'data', 'symbology', 'ecc'].includes(key)) updateListLabel();
      if (['data', 'symbology', 'ecc', 'size', 'module'].includes(key)) updateCodeInfo();
    });
    return l;
  };
  const num = (label, key, step = 0.1, min) => field(label, key, { type: 'number', step, ...(min != null ? { min } : {}) });
  const pair = (a, b) => {
    const d = document.createElement('div');
    d.className = 'grid2';
    d.append(a, b);
    return d;
  };

  if (item.type === 'text') {
    panel.append(
      field('Text', 'text', { type: 'textarea' }),
      field('Font', 'font', { type: 'select', choices: FONTS.map((f) => [f, f]) }),
      fitToggle(item),
      ...(item.fit
        ? [pair(num('Box width (mm)', 'w', 0.5, 1), num('Box height (mm)', 'h', 0.5, 1)), fitInfo()]
        : [num('Size (mm)', 'size', 0.1, 0.5)]),
      field('Align', 'align', { type: 'select', choices: [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] }),
      field('Bold', 'bold', { type: 'checkbox' }),
      field('Italic', 'italic', { type: 'checkbox' }),
    );
  } else if (item.type === 'image') {
    panel.append(
      num('Width (mm)', 'w', 0.5, 1),
      field('Threshold', 'threshold', { type: 'range', min: 1, max: 254, step: 1 }),
      field('Dither (for photos)', 'dither', { type: 'checkbox' }),
      field('Invert', 'invert', { type: 'checkbox' }),
    );
  } else if (item.type === 'qr') {
    panel.append(
      field('Content (text or URL)', 'data', { type: 'textarea' }),
      pair(
        num('Size (mm)', 'size', 0.5, 1),
        field('Error correction', 'ecc', { type: 'select', choices: [['L', 'L (7%)'], ['M', 'M (15%)'], ['Q', 'Q (25%)'], ['H', 'H (30%)']] }),
      ),
      codeInfo(),
    );
  } else if (item.type === 'barcode') {
    panel.append(
      field('Type', 'symbology', { type: 'select', choices: Object.entries(SYMBOLOGIES).map(([id, s]) => [id, s.name]) }),
      field('Content', 'data', { type: 'text' }),
      pair(num('Bar width (mm)', 'module', 0.05, 0.1), num('Height (mm)', 'height', 0.5, 1)),
      field('Show digits/text', 'showText', { type: 'checkbox' }),
      num('Text size (mm)', 'textSize', 0.1, 0.5),
      codeInfo(),
    );
  } else if (item.type === 'box') {
    panel.append(
      pair(num('Width (mm)', 'w', 0.5, 0.5), num('Height (mm)', 'h', 0.5, 0.5)),
      num('Line (mm)', 'stroke', 0.1, 0.1),
      field('Filled', 'fill', { type: 'checkbox' }),
    );
  }
  panel.append(pair(num('X (mm)', 'x'), num('Y (mm)', 'y')));

  const row = document.createElement('div');
  row.className = 'row';
  const btn = (text, fn) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.onclick = fn;
    return b;
  };
  row.append(
    btn('Centre across', () => {
      const i = design.items.indexOf(item);
      const h = last.bounds[i].h / last.dpmm;
      item.y = +(bandTop() + (usableMm() - h) / 2).toFixed(2);
      refresh({ props: true });
    }),
  );
  if (item.type === 'text' && item.fit) {
    row.append(btn('Fill printable area', () => {
      const mg = margins();
      item.y = bandTop();
      item.h = round1(usableMm());
      if (medium().lengthDots) {
        item.x = mg.left;
        item.w = round1(medium().lengthDots / last.dpmm - mg.left - mg.right);
      }
      refresh({ props: true });
    }));
  } else if (item.type === 'text') {
    row.append(btn('Fill height', () => {
      const i = design.items.indexOf(item);
      const ratio = last.bounds[i].h / last.dpmm / item.size;
      item.size = +((usableMm() * 0.95) / ratio).toFixed(2);
      item.y = +(bandTop() + usableMm() * 0.025).toFixed(2);
      refresh({ props: true });
    }));
  }
  row.append(
    btn('Duplicate', duplicateSelected),
    btn('Forward', () => moveItem(item, 1)),
    btn('Back', () => moveItem(item, -1)),
    btn('Delete', () => deleteItem(item)),
  );
  panel.append(row);
}

// "Fit text in box": switching on keeps the text where it is by starting
// from its current bounds.
function fitToggle(item) {
  const l = document.createElement('label');
  l.className = 'inline';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!item.fit;
  input.onchange = () => {
    if (input.checked) {
      const b = last.bounds[design.items.indexOf(item)];
      item.w = item.w ?? round1(b.w / last.dpmm);
      item.h = item.h ?? round1(b.h / last.dpmm);
    }
    item.fit = input.checked;
    refresh({ props: true });
  };
  l.append(input, ' Fit text in a fixed box (size is automatic)');
  return l;
}

function fitInfo() {
  const p = document.createElement('p');
  p.id = 'fit-info';
  p.className = 'note';
  return p;
}

function updateFitInfo() {
  const p = $('fit-info');
  const i = design.items.findIndex((it) => it.id === selectedId);
  const l = last?.textLayouts[i];
  if (p && l) p.textContent = `Text size ${l.sizeMm.toFixed(1)} mm. Drag the box's corner handle to resize it.`;
}

// Live encoding details or the error for the selected QR/barcode item.
function codeInfo() {
  const p = document.createElement('p');
  p.id = 'code-info';
  p.className = 'note';
  queueMicrotask(updateCodeInfo);
  return p;
}

function updateCodeInfo() {
  const p = $('code-info');
  const item = selected();
  if (!p || !item) return;
  const err = itemError(item);
  p.classList.toggle('error', !!err);
  if (err) {
    p.textContent = err;
    return;
  }
  const dpmm = model().dpi / 25.4;
  if (item.type === 'qr') {
    const i = design.items.indexOf(item);
    const b = last?.bounds[i];
    p.textContent = b ? `Prints ${(b.w / dpmm).toFixed(1)} mm square. Leave a few mm clear around it for scanning.` : '';
  } else {
    const dots = Math.max(1, Math.round(item.module * dpmm));
    p.textContent = `Bars snap to ${dots} dot${dots > 1 ? 's' : ''} (${(dots / dpmm).toFixed(2)} mm). Quiet zones are included in the item width.`;
  }
}

function updateListLabel() {
  const i = design.items.findIndex((it) => it.id === selectedId);
  const li = $('item-list').children[i];
  if (li) li.lastChild.textContent = describe(design.items[i]);
}

function moveItem(item, dir) {
  const i = design.items.indexOf(item);
  const j = i + dir;
  if (j < 0 || j >= design.items.length) return;
  [design.items[i], design.items[j]] = [design.items[j], design.items[i]];
  refresh({ props: true });
}

function deleteItem(item) {
  design.items = design.items.filter((i) => i !== item);
  selectedId = design.items.at(-1)?.id ?? null;
  refresh({ props: true });
}

// ---------- canvas interaction ----------

function canvasPointToMm(e) {
  const r = $('canvas').getBoundingClientRect();
  return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
}

function hitTest(pt) {
  if (!last) return null;
  for (let i = design.items.length - 1; i >= 0; i--) {
    const b = last.bounds[i];
    const x = pt.x * last.dpmm;
    const y = pt.y * last.dpmm;
    if (x >= b.x - 2 && x <= b.x + b.w + 2 && y >= b.y - 2 && y <= b.y + b.h + 2) return design.items[i];
  }
  return null;
}

function onHandle(e) {
  const item = selected();
  if (!item || !last || !resizable(item)) return null;
  const r = $('canvas').getBoundingClientRect();
  const h = handleRect(last.bounds[design.items.indexOf(item)], zoom / last.dpmm);
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const pad = 4;
  return x >= h.x - pad && x <= h.x + h.size + pad && y >= h.y - pad && y <= h.y + h.size + pad ? item : null;
}

let drag = null;
function onPointerDown(e) {
  const pt = canvasPointToMm(e);
  const handled = onHandle(e);
  if (handled) {
    drag = { item: handled, resize: true };
    $('canvas').setPointerCapture(e.pointerId);
    return;
  }
  const item = hitTest(pt);
  selectedId = item?.id ?? null;
  if (item) {
    drag = { item, dx: pt.x - item.x, dy: pt.y - item.y };
    $('canvas').setPointerCapture(e.pointerId);
  }
  refresh({ props: true });
}

function onPointerMove(e) {
  const canvas = $('canvas');
  if (!drag) {
    canvas.style.cursor = onHandle(e) ? 'nwse-resize' : hitTest(canvasPointToMm(e)) ? 'move' : 'default';
    return;
  }
  const pt = canvasPointToMm(e);
  if (drag.resize) {
    const it = drag.item;
    RESIZERS[it.type](it, Math.max(1, round1(pt.x - it.x)), Math.max(1, round1(pt.y - it.y)));
    refresh();
    return;
  }
  drag.item.x = Math.round((pt.x - drag.dx) * 10) / 10;
  drag.item.y = Math.round((pt.y - drag.dy) * 10) / 10;
  refresh();
}

function onPointerUp() {
  if (drag) {
    drag = null;
    refresh({ props: true });
  }
}

// ---------- in-place text editing ----------

let editing = null;

function startEdit(item) {
  if (!last?.textLayouts[design.items.indexOf(item)]) return;
  const ta = document.createElement('textarea');
  ta.className = 'inplace';
  ta.value = item.text;
  ta.spellcheck = false;
  ta.setAttribute('aria-label', 'Edit label text');
  $('canvas-wrap').append(ta);
  editing = { item, ta, original: item.text };
  positionEditor();

  ta.addEventListener('input', () => {
    item.text = ta.value;
    refresh();
    updateListLabel();
  });
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      item.text = editing.original;
      stopEdit();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      stopEdit();
    }
  });
  ta.addEventListener('blur', () => stopEdit());
  ta.focus();
  ta.select();
}

// Lays the editor over the text exactly where the renderer put it.
function positionEditor() {
  const { item, ta } = editing;
  const l = last?.textLayouts[design.items.indexOf(item)];
  if (!l) return;
  const scale = zoom / last.dpmm;
  const canvas = $('canvas');
  Object.assign(ta.style, {
    left: `${canvas.offsetLeft + l.blockX * scale - 2}px`,
    top: `${canvas.offsetTop + l.blockY * scale}px`,
    minWidth: `${Math.max(16, l.w * scale)}px`,
    font: `${item.italic ? 'italic ' : ''}${item.bold ? 'bold ' : ''}${l.px * scale}px ${item.font || 'sans-serif'}`,
    lineHeight: `${l.lineH * scale}px`,
    textAlign: item.align || 'left',
  });
}

// Commits the edit; an emptied text item is removed.
function stopEdit() {
  if (!editing) return;
  const { item, ta } = editing;
  editing = null;
  ta.remove();
  if (!String(item.text).trim()) deleteItem(item);
  else refresh({ props: true });
  $('canvas').focus({ preventScroll: true });
}

function onDoubleClick(e) {
  const pt = canvasPointToMm(e);
  const item = hitTest(pt);
  drag = null;
  if (item?.type === 'text') {
    selectedId = item.id;
    startEdit(item);
  } else if (item?.type === 'qr' || item?.type === 'barcode') {
    selectedId = item.id;
    refresh({ props: true });
    const input = $('item-props').querySelector(item.type === 'qr' ? 'textarea' : 'input[type="text"]');
    input?.focus();
    input?.select();
  } else if (!item) {
    // Double-clicking empty label space adds a text item there.
    const size = Math.max(1.5, round1(usableMm() * 0.6));
    design.items.push({
      id: uid(), type: 'text', text: 'Text', font: 'sans-serif', size, bold: false, italic: false, align: 'left',
      x: +Math.max(0, pt.x).toFixed(1), y: +Math.max(0, pt.y - size * 0.6).toFixed(1),
    });
    const created = design.items.at(-1);
    selectedId = created.id;
    buildProps();
    draw();
    startEdit(created);
  }
}

// ---------- copy and paste ----------

const CLIP_TYPE = 'application/x-web-label-items';
let clipboard = null; // { text, items } as last copied here

// Copy/paste act on label items unless the user is typing in a field.
const typingInField = () => {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

function itemPlainText(item) {
  if (item.type === 'text') return item.text;
  if (item.type === 'qr' || item.type === 'barcode') return item.data;
  return '';
}

function pasteItems(items, offset = 2) {
  if (!items.length) return;
  const copies = items.map((it) => ({ ...structuredClone(it), id: uid(), x: round1(it.x + offset), y: round1(it.y + offset) }));
  design.items.push(...copies);
  selectedId = copies.at(-1).id;
  refresh({ props: true });
}

function duplicateSelected() {
  const item = selected();
  if (item) pasteItems([item]);
}

function onCopy(e, cut = false) {
  const item = selected();
  if (typingInField() || editing || !item) return;
  e.preventDefault();
  const text = itemPlainText(item);
  clipboard = { text, items: [structuredClone(item)] };
  e.clipboardData.setData('text/plain', text);
  e.clipboardData.setData(CLIP_TYPE, JSON.stringify(clipboard.items));
  if (cut) deleteItem(item);
}

function onPaste(e) {
  if (typingInField() || editing) return;
  const data = e.clipboardData;
  e.preventDefault();
  // Our own items (copied in this or another tab of the editor).
  const raw = data.getData(CLIP_TYPE);
  if (raw) {
    try {
      pasteItems(JSON.parse(raw).filter((it) => it && typeof it.type === 'string'));
      return;
    } catch { /* fall through to plain text */ }
  }
  const text = data.getData('text/plain');
  if (clipboard && text === clipboard.text && !data.files.length) {
    pasteItems(clipboard.items);
    return;
  }
  const image = [...data.files].find((f) => f.type.startsWith('image/'));
  if (image) {
    addImage(image);
    return;
  }
  if (text.trim()) {
    const size = Math.max(1.5, round1(usableMm() * 0.6));
    addItem({
      type: 'text', text: text.replace(/\s+$/, ''), font: 'sans-serif', size, bold: false, italic: false, align: 'left',
      x: nextX(), y: round1(bandTop() + (usableMm() - size * 1.15) / 2),
    });
  }
}

function onKey(e) {
  const item = selected();
  if (!item) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    duplicateSelected();
    return;
  }
  const step = e.shiftKey ? 1 : 0.1;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (moves[e.key]) {
    item.x = Math.round((item.x + moves[e.key][0]) * 10) / 10;
    item.y = Math.round((item.y + moves[e.key][1]) * 10) / 10;
    e.preventDefault();
    refresh({ props: true });
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteItem(item);
  }
}

// ---------- wiring ----------

function wire() {
  $('printer').onchange = (e) => {
    design.printer = e.target.value;
    delete design.roll;
    loaded = null;
    design.medium = model().media[0].id;
    disconnect();
  };
  $('medium').onchange = (e) => { selectMedium(e.target.value); refresh({ setup: true }); };
  document.querySelectorAll('input[name="lenmode"]').forEach((r) => {
    r.onchange = () => { design.length.mode = r.value; refresh({ setup: true }); };
  });
  $('len-mm').oninput = (e) => { design.length.mm = parseFloat(e.target.value) || 5; refresh(); };
  $('pad-mm').oninput = (e) => { design.length.padMm = parseFloat(e.target.value) || 0; refresh(); };
  $('border').onchange = (e) => { design.border = e.target.checked; refresh(); };
  $('invert').onchange = (e) => { design.invert = e.target.checked; refresh(); };
  $('btn-detect').onclick = detect;
  $('btn-usb-help').onclick = () => showUsbHelp();
  $('btn-help').onclick = () => showAbout();
  $('btn-print').onclick = print;
  $('btn-png').onclick = downloadPng;

  $('add-text').onclick = addText;
  $('add-image').onclick = () => $('image-file').click();
  $('image-file').onchange = (e) => {
    if (e.target.files[0]) addImage(e.target.files[0]);
    e.target.value = '';
  };
  $('add-box').onclick = addBox;
  $('add-qr').onclick = addQr;
  $('add-barcode').onclick = addBarcode;
  $('zoom-in').onclick = () => { stopEdit(); zoom = Math.min(30, zoom * 1.25); refresh(); };
  $('zoom-out').onclick = () => { stopEdit(); zoom = Math.max(1, zoom / 1.25); refresh(); };

  $('btn-export').onclick = () => {
    const { labelId, ...plain } = design;
    download(new Blob([JSON.stringify(plain, null, 2)], { type: 'application/json' }), 'label.json');
  };
  $('btn-labels').onclick = () => showLibrary();
  $('btn-lib-open').onclick = () => showLibrary();
  $('btn-lib-save').onclick = () => saveToLibrary(false);
  $('btn-lib-saveas').onclick = () => saveToLibrary(true);
  $('btn-import').onclick = () => $('import-file').click();
  $('import-file').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!Array.isArray(d.items)) throw new Error('not a label design');
      design = { ...newDesign(), ...d };
      selectedId = design.items[0]?.id ?? null;
      refresh({ setup: true, props: true });
    } catch (err) {
      showBanner(`Could not open design: ${err.message}`);
    }
  };
  $('btn-new').onclick = () => {
    if (!confirm('Start a new design? The current one will be replaced.')) return;
    design = newDesign();
    selectedId = design.items[0].id;
    refresh({ setup: true, props: true });
  };

  const canvas = $('canvas');
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('dblclick', onDoubleClick);
  document.addEventListener('copy', (e) => onCopy(e));
  document.addEventListener('cut', (e) => onCopy(e, true));
  document.addEventListener('paste', onPaste);

  if (support.usb) {
    navigator.usb.addEventListener('disconnect', (e) => {
      if (transport?.device === e.device) disconnect();
    });
  }
}

if (!support.usb && !support.serial) {
  showBanner('This browser cannot talk to printers directly (WebUSB / Web Serial need Chrome, Edge or another Chromium browser). You can still design labels and download them as PNG.');
}
// ---------- My labels and print history ----------

// A small preview image of a design, for the library and history.
function thumbnail(d) {
  try {
    const m = MODELS[d.printer] ?? model();
    const med = m.media.find((x) => x.id === d.medium) ?? m.media[0];
    const { bitmap } = renderDesign(d, m, med);
    const full = bitmapToCanvas(bitmap);
    const scale = Math.min(1, 240 / full.width, 80 / full.height);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(full.width * scale));
    c.height = Math.max(1, Math.round(full.height * scale));
    const ctx = c.getContext('2d');
    ctx.drawImage(full, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}

function describeDesign(d) {
  const m = MODELS[d.printer];
  const med = m?.media.find((x) => x.id === d.medium);
  return [m?.name ?? d.printer, med?.name ?? d.medium].join(' · ');
}

function plainDesign() {
  const { labelId, ...plain } = design;
  return plain;
}

function saveToLibrary(asNew) {
  const existing = !asNew && design.labelId ? labels.get(design.labelId) : null;
  let name = existing?.name;
  if (!existing) {
    const first = design.items.find((it) => it.type === 'text')?.text.split('\n')[0];
    name = prompt('Name for this label', first || 'Label')?.trim();
    if (!name) return;
  }
  try {
    const entry = labels.save({ id: existing?.id, name, design: plainDesign(), thumb: thumbnail(design) });
    design.labelId = entry.id;
    showBanner(existing ? `Saved "${entry.name}".` : `Saved "${entry.name}" to My labels.`);
    refresh({ setup: true });
  } catch (err) {
    showBanner(err.message);
  }
}

function recordPrint(copies) {
  try {
    history.add({ design: plainDesign(), thumb: thumbnail(design), printer: model().name, medium: medium().name, copies });
  } catch { /* history is best effort; the print already went out */ }
}

function showLibrary(tab) {
  openLibrary($('library-dialog'), {
    tab,
    currentLabelId: design.labelId,
    describe: describeDesign,
    onOpen(d, labelId) {
      design = { ...newDesign(), ...JSON.parse(JSON.stringify(d)) };
      if (labelId) design.labelId = labelId;
      else delete design.labelId;
      selectedId = design.items[0]?.id ?? null;
      const entry = labelId ? labels.get(labelId) : null;
      showBanner(entry ? `Opened "${entry.name}".` : '');
      refresh({ setup: true, props: true });
    },
    onChanged() {
      if (design.labelId && !labels.get(design.labelId)) delete design.labelId;
      refresh({ setup: true });
    },
  });
}

function showAbout(tab) {
  openAbout($('about-dialog'), { models: MODELS, tab, onConnectHelp: () => showUsbHelp() });
}

// Welcome page on the first visit.
const WELCOMED_KEY = 'web-label-editor:welcomed';
function welcomeOnce() {
  try {
    if (localStorage.getItem(WELCOMED_KEY)) return;
    localStorage.setItem(WELCOMED_KEY, '1');
  } catch {
    return; // storage unavailable: don't nag on every load
  }
  showAbout('welcome');
}

wire();
refresh({ setup: true, props: true });
welcomeOnce();
