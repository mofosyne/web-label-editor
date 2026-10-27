import { MODELS } from './printers/models.js';
import { renderDesign, bitmapToCanvas, itemError } from './render.js';
import { SYMBOLOGIES } from './codes/barcode.js';
import { UsbTransport, SerialTransport, support } from './transport.js';

const STORAGE_KEY = 'web-label-editor:design';
const $ = (id) => document.getElementById(id);

const FONTS = ['sans-serif', 'serif', 'monospace', 'Arial', 'Helvetica', 'Verdana', 'Georgia', 'Courier New', 'Impact'];

function newDesign() {
  return {
    version: 1,
    printer: 'brother-pt-p710bt',
    medium: 'tze-12',
    options: {},
    length: { mode: 'auto', mm: 60, padMm: 2 },
    border: false,
    invert: false,
    items: [
      { id: uid(), type: 'text', x: 2, y: 1.5, text: 'Hello label', font: 'sans-serif', size: 7.5, bold: true, italic: false, align: 'left' },
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

  const sel = design.items.findIndex((i) => i.id === selectedId);
  if (sel >= 0) {
    const b = last.bounds[sel];
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2463eb';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(b.x * scale - 2, b.y * scale - 2, b.w * scale + 4, b.h * scale + 4);
  }

  const lenMm = bitmap.width / dpmm;
  const tape = med.tapeMm ? `${med.tapeMm} mm tape, ${acrossMm().toFixed(1)} mm printable` : `${acrossMm().toFixed(1)} mm wide`;
  // Font boxes include some blank space, so allow half a millimetre of slack.
  const slack = dpmm * 0.5;
  const offLabel = last.bounds.some((b) => b.x < -slack || b.y < -slack
    || b.y + b.h > bitmap.height + slack || b.x + b.w > bitmap.width + slack);
  const dims = $('dims');
  dims.textContent = `${tape} × ${lenMm.toFixed(1)} mm long  ·  ${bitmap.width} × ${bitmap.height} dots @ ${m.dpi} dpi`
    + (offLabel ? '  ·  ⚠ Something runs off the printable area and will be cut off' : '');
  dims.classList.toggle('warn', offLabel);
  $('zoom-label').textContent = `${Math.round((zoom / 6) * 100)}%`;
  updateCodeInfo();
}

// ---------- setup panel ----------

function buildSetup() {
  const m = model();
  const printerSel = $('printer');
  printerSel.replaceChildren(...Object.entries(MODELS).map(([id, mm]) => new Option(mm.name, id, false, id === design.printer)));

  const mediumSel = $('medium');
  mediumSel.replaceChildren(...m.media.map((md) => new Option(md.name, md.id, false, md.id === medium().id)));

  const fixedLength = !!medium().lengthDots;
  $('length-controls').hidden = fixedLength;
  $('length-fixed-note').hidden = !fixedLength;
  document.querySelectorAll('input[name="lenmode"]').forEach((r) => { r.checked = r.value === design.length.mode; });
  $('len-mm').value = design.length.mm;
  $('len-mm').disabled = design.length.mode !== 'fixed';
  $('pad-mm').value = design.length.padMm;
  $('pad-mm').disabled = design.length.mode !== 'auto';
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

  const btns = $('connect-buttons');
  const labels = { usb: 'Connect USB', serial: 'Connect Bluetooth / serial' };
  btns.replaceChildren(...m.transports.map((t) => {
    const b = document.createElement('button');
    b.textContent = transport ? 'Disconnect' : labels[t];
    b.disabled = !transport && !support[t];
    b.title = support[t] ? '' : 'Not supported in this browser';
    b.onclick = () => (transport ? disconnect() : connect(t));
    return b;
  }).slice(0, transport ? 1 : undefined));
  $('btn-detect').hidden = !(m.queryStatus && transport);
  $('btn-print').disabled = !transport;
}

function setStatus(text, ok = false) {
  const pill = $('conn-status');
  pill.textContent = text;
  pill.classList.toggle('ok', ok);
}

function showBanner(text) {
  const b = $('banner');
  b.textContent = text;
  b.hidden = !text;
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
    if (err.name !== 'NotFoundError') showBanner(err.message);
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
async function detect() {
  try {
    const status = await model().queryStatus(transport);
    loaded = status;
    if (status.mediumId) design.medium = status.mediumId;
    setStatus(`Connected: ${transport.label} · ${describeTape(status)}`, true);
    const notes = [...status.errors, ...status.warnings];
    showBanner(notes.length ? `Printer reports: ${notes.join('; ')}` : '');
    refresh({ setup: true });
    return status;
  } catch (err) {
    showBanner(`Could not read printer status: ${err.message}`);
    return null;
  }
}

// Before printing, make sure the loaded tape matches the layout so a wrong
// tape doesn't waste a label. Printing goes ahead if status can't be read.
async function checkTapeBeforePrint() {
  if (!model().queryStatus) return true;
  const before = design.medium;
  const status = await detect();
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
    const opts = Object.fromEntries(model().options.map((o) => [o.id, option(o.id)]));
    const job = model().encode(bitmap, medium(), opts);
    const copies = Math.max(1, Math.min(99, parseInt($('copies').value, 10) || 1));
    for (let i = 0; i < copies; i++) await transport.write(job);
    showBanner(loaded?.warnings.join('; ') ?? '');
  } catch (err) {
    showBanner(`Print failed: ${err.message}`);
  } finally {
    btn.textContent = 'Print';
    btn.disabled = !transport;
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
  return +(right + (right ? 3 : 2)).toFixed(1);
}

function addText() {
  const size = Math.max(1.5, +(acrossMm() * 0.6).toFixed(1));
  addItem({
    type: 'text', text: 'Text', font: 'sans-serif', size, bold: false, italic: false, align: 'left',
    x: nextX(), y: +((acrossMm() - size * 1.15) / 2).toFixed(1),
  });
}

function addImage(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const h = acrossMm();
    addItem({ type: 'image', src: reader.result, x: 2, y: 0, w: h, threshold: 128, dither: false, invert: false });
  };
  reader.readAsDataURL(file);
}

function addBox() {
  const h = acrossMm();
  addItem({ type: 'box', x: 1, y: 1, w: 20, h: Math.max(2, +(h - 2).toFixed(1)), stroke: 0.4, fill: false });
}

function addQr() {
  const size = +Math.min(25, acrossMm() * 0.9).toFixed(1);
  addItem({ type: 'qr', data: 'https://example.com', ecc: 'M', size, x: nextX(), y: +((acrossMm() - size) / 2).toFixed(1) });
}

function addBarcode() {
  const textSize = Math.min(3, +(acrossMm() * 0.22).toFixed(1));
  const height = Math.max(3, +Math.min(15, acrossMm() - textSize - 1.2).toFixed(1));
  const total = height + 0.4 + textSize;
  addItem({
    type: 'barcode', symbology: 'code128', data: 'ABC-12345', module: 0.3, height,
    showText: true, textSize, x: nextX(), y: +Math.max(0, (acrossMm() - total) / 2).toFixed(1),
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
      pair(num('Size (mm)', 'size', 0.1, 0.5), field('Align', 'align', { type: 'select', choices: [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] })),
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
      const b = last.bounds[i];
      item.y = +(((medium().acrossDots - b.h) / 2) / last.dpmm).toFixed(2);
      refresh({ props: true });
    }),
  );
  if (item.type === 'text') {
    row.append(btn('Fill height', () => {
      const i = design.items.indexOf(item);
      const ratio = last.bounds[i].h / last.dpmm / item.size;
      item.size = +((acrossMm() * 0.95) / ratio).toFixed(2);
      item.y = +((acrossMm() * 0.025)).toFixed(2);
      refresh({ props: true });
    }));
  }
  row.append(
    btn('Forward', () => moveItem(item, 1)),
    btn('Back', () => moveItem(item, -1)),
    btn('Delete', () => deleteItem(item)),
  );
  panel.append(row);
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

let drag = null;
function onPointerDown(e) {
  const pt = canvasPointToMm(e);
  const item = hitTest(pt);
  selectedId = item?.id ?? null;
  if (item) {
    drag = { item, dx: pt.x - item.x, dy: pt.y - item.y };
    $('canvas').setPointerCapture(e.pointerId);
  }
  refresh({ props: true });
}

function onPointerMove(e) {
  if (!drag) return;
  const pt = canvasPointToMm(e);
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
  const i = design.items.indexOf(item);
  const b = last?.bounds[i];
  if (!b) return;
  const scale = zoom / last.dpmm;
  const canvas = $('canvas');
  const lines = Math.max(1, String(item.text).split('\n').length);
  const ta = document.createElement('textarea');
  ta.className = 'inplace';
  ta.value = item.text;
  ta.spellcheck = false;
  ta.setAttribute('aria-label', 'Edit label text');
  Object.assign(ta.style, {
    left: `${canvas.offsetLeft + b.x * scale - 2}px`,
    top: `${canvas.offsetTop + b.y * scale}px`,
    minWidth: `${Math.max(16, b.w * scale)}px`,
    font: `${item.italic ? 'italic ' : ''}${item.bold ? 'bold ' : ''}${item.size * zoom}px ${item.font || 'sans-serif'}`,
    lineHeight: `${(b.h * scale) / lines}px`,
    textAlign: item.align || 'left',
  });
  $('canvas-wrap').append(ta);
  editing = { item, ta, original: item.text };

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
    const size = Math.max(1.5, +(acrossMm() * 0.6).toFixed(1));
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

function onKey(e) {
  const item = selected();
  if (!item) return;
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
    loaded = null;
    design.medium = model().media[0].id;
    disconnect();
  };
  $('medium').onchange = (e) => { design.medium = e.target.value; refresh({ setup: true }); };
  document.querySelectorAll('input[name="lenmode"]').forEach((r) => {
    r.onchange = () => { design.length.mode = r.value; refresh({ setup: true }); };
  });
  $('len-mm').oninput = (e) => { design.length.mm = parseFloat(e.target.value) || 5; refresh(); };
  $('pad-mm').oninput = (e) => { design.length.padMm = parseFloat(e.target.value) || 0; refresh(); };
  $('border').onchange = (e) => { design.border = e.target.checked; refresh(); };
  $('invert').onchange = (e) => { design.invert = e.target.checked; refresh(); };
  $('btn-detect').onclick = detect;
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

  $('btn-export').onclick = () => download(new Blob([JSON.stringify(design, null, 2)], { type: 'application/json' }), 'label.json');
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

  if (support.usb) {
    navigator.usb.addEventListener('disconnect', (e) => {
      if (transport?.device === e.device) disconnect();
    });
  }
}

if (!support.usb && !support.serial) {
  showBanner('This browser cannot talk to printers directly (WebUSB / Web Serial need Chrome, Edge or another Chromium browser). You can still design labels and download them as PNG.');
}
wire();
refresh({ setup: true, props: true });
