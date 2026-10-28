// SPDX-License-Identifier: GPL-3.0-or-later
import { MODELS, mediumMargins } from './printers/models.js';
import { renderDesign, bitmapToCanvas, itemError, quarterTurns } from './render.js';
import { SYMBOLOGIES } from './codes/barcode.js';
import { UsbTransport, SerialTransport, support } from './transport.js';
import { openHelp } from './help.js';
import { openAbout } from './about.js';
import { labels, history, openLibrary } from './library.js';
import { printerReportUrl, labelRequestUrl } from './report.js';
import { loadCatalog } from './catalog.js';
import { testPatternDesign } from './calibration.js';
import {
  viewGeometry, jobBitmap, rowMode, itemLane, itemVisible, canOverprint, blit, blankBitmap, MAX_BLEED_MM,
  stripToPage, stripRectToPage,
} from './layout.js';
import { newRollId, rollCode, parseRollCode } from './rolls.js';
import { UndoHistory } from './undo.js';
import { actualPxPerMm, openScreenCalibration } from './screen.js';

const STORAGE_KEY = 'web-label-editor:design';
const $ = (id) => document.getElementById(id);

const FONTS = ['sans-serif', 'serif', 'monospace', 'Arial', 'Helvetica', 'Verdana', 'Georgia', 'Courier New', 'Impact'];

function newDesign() {
  return {
    version: 2,
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

// Designs from before version 2 placed items on Brother media relative to
// the printable band; they are now relative to the whole tape or label, so
// such items move by the band's offset to stay where they print.
function migrateDesign(d) {
  if ((d.version ?? 1) >= 2) return d;
  const m = MODELS[d.printer];
  const med = m?.media.find((x) => x.id === d.medium);
  if (med?.band) {
    const dpmm = m.dpi / 25.4;
    for (const it of d.items ?? []) {
      it.y = Math.round((it.y + med.band.y / dpmm) * 10) / 10;
      if (med.band.x) it.x = Math.round((it.x + med.band.x / dpmm) * 10) / 10;
    }
  }
  d.version = 2;
  return d;
}

function loadDesign() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrateDesign(JSON.parse(raw));
  } catch { /* storage unavailable */ }
  return newDesign();
}

function saveDesign() {
  const json = JSON.stringify(design);
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch { /* storage unavailable or full */ }
  // A drag is one undo step however long it takes.
  if (undo.record(json, { merge: !!drag })) updateUndoButtons();
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
const undo = new UndoHistory(JSON.stringify(design));
let selectedId = design.items[0]?.id ?? null;
let zoom = 6; // screen px per mm of the editing view
let editZoom = 6; // the zoom chosen with − / +
// Showing the label at its real size (the screen calibration): in a panel
// under the editor when it fits across the window, otherwise the editor
// itself switches to real size.
let actualSize = false;
let actualPanel = false;
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

// Two kinds of margin, in mm from the label's edges. Hard: where the
// printer cannot put ink at all. A position adjustment shifts what is sent,
// which makes the edge it shifts away from unreachable: e.g. Feed -6
// (printer starts 6 mm late) means nothing can print in the first 6 mm; the
// LabelWriter also never prints its leading margin (see skipLeadingMargin).
// A negative hard margin is reachable space past the label edge, which an
// overprint border can use. Safe: the catalogue margins (DYMO's driver),
// where the head can print but the die-cut edge or a slightly misplaced
// label may trim it off. Printing past the safe area is allowed: that is
// how to overprint (bleed) to the edge.
const dpmmNow = () => model().dpi / 25.4;
// The Feed X adjustment in strip dots. Feed X is measured from the end that
// comes out first, so on printers that feed the strip's far end first
// (Brother QL) it shifts the other way along the strip.
const feedDots = (feedMm, m, dpmm) => Math.round((m.leadingEnd === 'end' ? -1 : 1) * feedMm * dpmm);
const bleedMm = () => (canOverprint(model(), medium()) ? Math.min(MAX_BLEED_MM, design.bleedMm ?? 0) : 0);
function geometry(length = 0, adj = adjust()) {
  const dpmm = dpmmNow();
  return viewGeometry(model(), medium(), {
    length,
    bleed: Math.round(bleedMm() * dpmm),
    feed: feedDots(adj.feedMm, model(), dpmm),
    across: Math.round(adj.acrossMm * dpmm),
  });
}
// The row's labels: which one new items go on ('separate' mode).
let activeLane = 0;
const mode = () => rowMode(design, medium());
const laneCount = () => medium().lanes?.count ?? 1;
const laneOf = (item) => itemLane(item, mode(), laneCount());
const currentLane = () => Math.min(mode() === 'separate' ? activeLane : 0, laneCount() - 1);

// Reach past each edge of a label, in mm: { left, right, top, bottom } with
// the hard margin as a positive number and reachable space past the edge
// as a negative one.
function reachMm(lane = currentLane()) {
  const g = geometry();
  const s = g.slots[lane];
  const dpmm = dpmmNow();
  return {
    left: g.reach.x0 / dpmm,
    right: (g.length - g.reach.x1) / dpmm,
    top: (g.reach.y0 - s.y) / dpmm,
    bottom: (s.y + g.labelDots - g.reach.y1) / dpmm,
  };
}
const hardMargins = (lane) => {
  const r = reachMm(lane);
  return { left: Math.max(0, r.left), right: Math.max(0, r.right), top: Math.max(0, r.top), bottom: Math.max(0, r.bottom) };
};
const margins = (lane) => {
  const mg = mediumMargins(medium());
  const hard = hardMargins(lane);
  return {
    left: Math.max(mg.left, hard.left),
    right: Math.max(mg.right, hard.right),
    top: Math.max(mg.top, hard.top),
    bottom: Math.max(mg.bottom, hard.bottom),
  };
};
// The whole area an item can cover, overprint border included (mm, label
// coordinates): the label plus its overprint border, within reach.
function edgeArea(lane = currentLane()) {
  const g = geometry();
  const s = g.slots[lane];
  const r = reachMm(lane);
  const dpmm = dpmmNow();
  return {
    left: Math.max(0, r.left),
    right: Math.max(-s.ext.right / dpmm, r.right),
    top: Math.max(-s.ext.top / dpmm, r.top),
    bottom: Math.max(-s.ext.bottom / dpmm, r.bottom),
  };
}

// Portrait: labels designed standing upright (as in DYMO Label) and turned
// for printing. Items then live on the upright page; on a continuous roll
// the page grows downwards.
const isPortrait = (d) => d.orientation === 'portrait';
const portrait = () => isPortrait(design);
// Strip-oriented insets turned onto the upright page: the page's bottom is
// the label's leading edge and its left is the strip's top.
const toPage = (m) => (portrait() ? { left: m.top, right: m.bottom, top: m.right, bottom: m.left } : m);
// Margins and edge area as the items see them.
const itemMargins = (lane) => toPage(margins(lane));
const itemEdge = (lane) => toPage(edgeArea(lane));
// The label's size as the items see it, mm. On a continuous roll the
// length is the current one (it follows the content), and `wFixed` /
// `hFixed` say which sides are fixed by the label.
function pageSize() {
  const fixed = !!medium().lengthDots;
  const len = fixed ? medium().lengthDots / dpmmNow() : (last?.geo.length ?? 30 * dpmmNow()) / dpmmNow();
  return portrait()
    ? { w: acrossMm(), h: len, wFixed: true, hFixed: fixed }
    : { w: len, h: acrossMm(), wFixed: fixed, hFixed: true };
}

// Renders a design as the editor shows it: every label of the row (with
// copies of the design on the others, unless each has its own) and the
// overprint border. Bounds and text layouts are per design item, in view
// dots (null for an item not shown). `filled` leaves later labels of the row
// blank, for printing one label at a time.
function renderView(d = design, m = model(), med = medium(), { filled, adj, onAssetLoad } = {}) {
  const dpmm = m.dpi / 25.4;
  const a = adj ?? { feedMm: 0, acrossMm: 0 };
  const md = rowMode(d, med);
  const count = med.lanes?.count ?? 1;
  const upright = isPortrait(d);
  const opts = {
    bleed: canOverprint(m, med) ? Math.round(Math.min(MAX_BLEED_MM, d.bleedMm ?? 0) * dpmm) : 0,
    feed: feedDots(a.feedMm, m, dpmm),
    across: Math.round(a.acrossMm * dpmm),
  };
  const shown = d.items.filter((it) => itemVisible(it, md, count));
  let length;
  const slots = viewGeometry(m, med, { ...opts, length: 0 }).slots.map((s) => {
    const items = md === 'separate' ? shown.filter((it) => itemLane(it, md, count) === s.lane) : shown;
    const r = renderDesign(d, m, med, onAssetLoad, { items, ext: s.ext, length, portrait: upright });
    length = r.length;
    return { ...s, items, r, copy: md !== 'separate' && s.lane > 0 };
  });
  const geo = viewGeometry(m, med, { ...opts, length });
  const bitmap = blankBitmap(geo.width, geo.height);
  slots.forEach((s, k) => { if (filled == null || k < filled) blit(bitmap, s.r.bitmap, 0, s.y - s.ext.top); });

  // What the editor shows: the strip, or in portrait the strip turned
  // upright. Rectangles in strip dots map onto it with toDisplay; each
  // label's top-left on it is (ox, oy).
  const toDisplay = (r) => (upright ? stripRectToPage(r, geo.width) : r);
  for (const s of slots) {
    s.label = toDisplay({ x: 0, y: s.y, w: geo.length, h: geo.labelDots });
    s.outer = toDisplay({ x: 0, y: s.y - s.ext.top, w: geo.length + s.ext.right, h: geo.labelDots + s.ext.top + s.ext.bottom });
    s.ox = s.label.x;
    s.oy = s.label.y;
  }

  const bounds = d.items.map(() => null);
  const textLayouts = d.items.map(() => null);
  const lanes = d.items.map(() => null);
  for (const s of slots) {
    if (s.copy) continue;
    s.items.forEach((it, j) => {
      const i = d.items.indexOf(it);
      const b = s.r.bounds[j];
      bounds[i] = { ...b, x: b.x + s.ox, y: b.y + s.oy };
      lanes[i] = s.lane;
      const l = s.r.textLayouts[j];
      if (l) {
        textLayouts[i] = {
          ...l, blockX: l.blockX + s.ox, blockY: l.blockY + s.oy, box: { ...l.box, x: l.box.x + s.ox, y: l.box.y + s.oy },
        };
      }
    });
  }
  const hidden = d.items.length - shown.length;
  return {
    bitmap, display: upright ? stripToPage(bitmap) : bitmap, toDisplay, portrait: upright,
    geo, slots, bounds, textLayouts, lanes, hidden, dpmm, mode: md,
  };
}

// Portrait on a continuous roll: the page is the tape's width and grows
// downwards with the content.
const growsDown = () => portrait() && !medium().lengthDots;
// The printable band down the page (across the strip in landscape), in mm;
// when the page grows downwards, the band across it instead, which is what
// sizes new items.
const bandTop = () => itemMargins().top;
const usableMm = () => (growsDown()
  ? pageSize().w - itemMargins().left - itemMargins().right
  : pageSize().h - itemMargins().top - itemMargins().bottom);
// Text size for a new text item.
const newTextSize = () => Math.max(1.5, round1(usableMm() * (growsDown() ? 0.3 : 0.6)));
// Where a new item of height h (mm) goes: after the last item along the
// label, centred in the band; or, on a page growing downwards, below the
// lowest item at the left margin.
function placeNew(h) {
  if (!growsDown()) return { x: nextX(), y: round1(bandTop() + Math.max(0, (usableMm() - h) / 2)) };
  const lane = currentLane();
  const oy = last?.slots[lane]?.oy ?? 0;
  const mine = last ? last.bounds.filter((b, i) => b && last.lanes[i] === lane) : [];
  const bottom = Math.max(0, ...mine.map((b) => (b.y - oy + b.h) / last.dpmm));
  return { x: round1(itemMargins().left + 0.5), y: round1(bottom ? bottom + 3 : bandTop() + 1) };
}
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
  last = renderView(design, m, med, { adj: adjust(), onAssetLoad: () => refresh() });
  const { display, dpmm, geo, slots, toDisplay } = last;

  const canvas = $('canvas');
  const real = actualSize ? actualPxPerMm() : null;
  actualPanel = !!real && (display.width / dpmm) * real <= $('canvas-wrap').clientWidth - 64;
  zoom = real && !actualPanel ? real : editZoom;
  drawActualPanel(actualPanel ? real : null);
  const scale = zoom / dpmm; // screen px per dot
  const cssW = display.width * scale;
  const cssH = display.height * scale;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const colors = previewColors();
  ctx.drawImage(bitmapToCanvas(display, colors.ink, colors.paper), 0, 0, cssW, cssH);
  const px = (r) => ({ x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale });

  // Label outlines: the canvas itself when it is just one label; otherwise
  // each label is outlined and the liner around them tinted.
  const radius = (med.cornerMm ?? 0) * zoom;
  const plain = slots.length === 1 && !geo.top && !geo.bottom && !geo.right;
  canvas.style.borderRadius = plain && radius ? `${radius}px` : '0';
  if (!plain) {
    const shapes = new Path2D();
    for (const s of slots) {
      const l = px(s.label);
      shapes.roundRect(l.x, l.y, l.w, l.h, radius);
    }
    const liner = new Path2D();
    liner.rect(0, 0, cssW, cssH);
    liner.addPath(shapes);
    ctx.fillStyle = 'rgba(230, 190, 110, .45)';
    ctx.fill(liner, 'evenodd');
    // A light halo keeps the outline visible over black (inverted) labels.
    ctx.strokeStyle = 'rgba(255, 255, 255, .8)';
    ctx.lineWidth = 3;
    ctx.stroke(shapes);
    ctx.strokeStyle = 'rgba(70, 70, 70, .9)';
    ctx.lineWidth = 1;
    ctx.stroke(shapes);
  }
  // Labels that repeat the design: dimmed and not editable.
  for (const s of slots.filter((x) => x.copy)) {
    const l = px(s.label);
    ctx.fillStyle = 'rgba(255, 255, 255, .45)';
    ctx.fillRect(l.x, l.y, l.w, l.h);
    ctx.fillStyle = 'rgba(90, 90, 90, .9)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(last.mode === 'each' ? 'next label' : 'copy', l.x + 4, l.y + 12);
  }

  // Hatch where the printer cannot print; a dashed line marks each label's
  // safe area (printing past it overprints towards and past the edge).
  const r = geo.reach;
  const reach = px(toDisplay({ x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 }));
  const hard = { x0: reach.x, y0: reach.y, x1: reach.x + reach.w, y1: reach.y + reach.h };
  ctx.fillStyle = marginPattern(ctx);
  ctx.fillRect(0, 0, cssW, hard.y0);
  ctx.fillRect(0, hard.y1, cssW, cssH - hard.y1);
  ctx.fillRect(0, hard.y0, hard.x0, hard.y1 - hard.y0);
  ctx.fillRect(hard.x1, hard.y0, cssW - hard.x1, hard.y1 - hard.y0);
  const safe = slots.map((s) => {
    const mg = margins(s.lane);
    const a = px(toDisplay({
      x: mg.left * dpmm, y: s.y + mg.top * dpmm,
      w: geo.length - (mg.left + mg.right) * dpmm, h: geo.labelDots - (mg.top + mg.bottom) * dpmm,
    }));
    return { x0: a.x, y0: a.y, x1: a.x + a.w, y1: a.y + a.h };
  });
  ctx.strokeStyle = 'rgba(120, 120, 120, .6)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  slots.forEach((s, k) => {
    const a = safe[k];
    const l = px(s.label);
    if (a.x0 > l.x || a.y0 > l.y || a.x1 < l.x + l.w || a.y1 < l.y + l.h) ctx.strokeRect(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0);
  });
  ctx.setLineDash([]);

  const sel = design.items.findIndex((i) => i.id === selectedId);
  const selBounds = sel >= 0 ? last.bounds[sel] : null;
  if (selBounds) {
    const b = selBounds;
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
  // Which way the label comes out, where it is cut, and where it grows.
  const along = (x) => (last.portrait ? geo.width - x : x); // strip x → display, along the feed
  const leadX = model().leadingEnd === 'end' ? geo.width : 0;
  const cuts = model().options.some((o) => o.id === 'autoCut') && option('autoCut') !== false;
  const grows = !med.lengthDots && design.length.mode !== 'fixed';
  const feed = { lead: along(leadX), trail: along(geo.width - leadX), cuts, grows };
  drawRulers(selBounds, feed);
  placeLaneButtons(scale);

  const lenMm = geo.length / dpmm;
  const lanes = med.lanes;
  const stock = m.family === 'brother-pt' ? 'tape' : med.continuous ? 'roll' : 'label';
  let tape = med.band ? `${med.tapeMm} mm ${stock}, ${(med.band.h / dpmm).toFixed(1)} mm printable` : `${acrossMm().toFixed(1)} mm wide`;
  if (lanes) tape = `${lanes.count} labels per row, each ${tape}`;
  $('dims').title = 'Hatched: the printer cannot print there. Dashed line: the safe area (from the label maker\'s driver); '
    + 'items past it still print, overprinting towards the label edge, but the die cut may trim them.'
    + (geo.top || geo.bottom || geo.right ? ' Tinted: the liner around the label, which an overprint border prints on.' : '');
  // Font boxes include some blank space, so allow a little slack.
  const slack = 0.3 * zoom;
  const outside = (b, a) => b.x * scale < a.x0 - slack || b.y * scale < a.y0 - slack
    || (b.y + b.h) * scale > a.y1 + slack || (b.x + b.w) * scale > a.x1 + slack;
  const shownBounds = last.bounds.map((b, i) => (b ? { b, lane: last.lanes[i] } : null)).filter(Boolean);
  const offLabel = shownBounds.some(({ b }) => outside(b, hard));
  const overprint = !offLabel && shownBounds.some(({ b, lane }) => outside(b, safe[lane]));
  const dims = $('dims');
  // In words: the ends as seen in the preview.
  const end = (p) => (last.portrait ? (p ? 'bottom' : 'top') : (p ? 'right' : 'left'));
  const feedNote = `Comes out ${end(feed.lead)} end first`
    + (feed.cuts ? `, cut at the ${end(feed.trail)}` : '')
    + (feed.grows ? `; grows ${last.portrait ? 'downwards' : 'to the right'} as you add content` : '');
  dims.textContent = `${tape} × ${lenMm.toFixed(1)} mm long${last.portrait ? ', portrait' : ''}  ·  ${geo.width} × ${geo.height} dots @ ${m.dpi} dpi`
    + (offLabel ? '  ·  ⚠ Something is where the printer cannot print and will be cut off' : '')
    + (overprint ? '  ·  Overprinting past the safe area (the die cut may trim it)' : '')
    + (last.hidden ? `  ·  ${last.hidden} item${last.hidden > 1 ? 's' : ''} on the other label${lanes?.count > 2 ? 's' : ''} hidden (choose "A different design on each")` : '')
    + `  ·  ${feedNote}`;
  dims.classList.toggle('warn', offLabel);
  $('zoom-label').textContent = actualSize && !actualPanel ? '1:1' : `${Math.round((zoom / 6) * 100)}%`;
  updateActualButton();
  updateCodeInfo();
  updateFitInfo();
  if (editing) positionEditor();
}

// On a 2-up row: a button on each dimmed copy to design that label
// separately, and on the other labels of a separate design to link them
// back to label 1. Rebuilt only when the layout changes, so a click isn't
// lost to a redraw.
let laneButtonsKey = '';
function placeLaneButtons(scale) {
  const box = $('lane-buttons');
  const slots = last.slots.filter((s) => s.lane > 0);
  const key = `${last.mode}|${slots.map((s) => s.lane).join()}`;
  if (key !== laneButtonsKey) {
    laneButtonsKey = key;
    box.replaceChildren(...slots.map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lane-button';
      b.dataset.lane = s.lane;
      if (last.mode === 'separate') {
        b.textContent = '🔗 Same as label 1';
        b.title = 'Print label 1\'s design on every label of the row again (this label\'s items are kept, hidden)';
        b.onclick = () => setRowMode('same');
      } else {
        b.textContent = '🔓 Edit separately';
        b.title = 'Give this label its own design, starting from a copy of label 1';
        b.onclick = () => unlinkLanes();
      }
      return b;
    }));
  }
  const canvas = $('canvas');
  for (const b of box.children) {
    const s = last.slots[Number(b.dataset.lane)];
    b.style.left = `${canvas.offsetLeft + (s.label.x + s.label.w) * scale - 4}px`;
    b.style.top = `${canvas.offsetTop + s.label.y * scale + 4}px`;
  }
}

// Landscape or portrait. Items keep their place relative
// to each label's safe area, scaled to the turned page; fitted boxes resize
// with it, so one that filled the safe area still does.
function setOrientation(value) {
  if (value === (portrait() ? 'portrait' : 'landscape')) return;
  if (!medium().lengthDots) {
    // A continuous roll has no fixed length to scale against: turn the
    // layout instead. Across the tape stays across (landscape y = portrait
    // x, both from the same edge) and along stays along.
    design.orientation = value;
    for (const it of design.items) {
      [it.x, it.y] = [it.y, it.x];
      if (it.type === 'text' && it.fit) [it.w, it.h] = [it.h, it.w];
      if (it.type === 'box') [it.w, it.h] = [it.h, it.w];
    }
    refresh({ setup: true, props: true });
    return;
  }
  const area = (lane) => {
    const page = pageSize();
    const mg = itemMargins(lane);
    return { x: mg.left, y: mg.top, w: page.w - mg.left - mg.right, h: page.h - mg.top - mg.bottom };
  };
  const lanes = [...Array(laneCount()).keys()];
  const before = lanes.map(area);
  design.orientation = value;
  const after = lanes.map(area);
  if (before[0].w > 0 && after[0].w > 0) {
    for (const it of design.items) {
      const lane = laneOf(it);
      const [a, z] = [before[lane], after[lane]];
      const sx = z.w / a.w;
      const sy = z.h / a.h;
      const b = last?.bounds[design.items.indexOf(it)];
      const w = b ? b.w / last.dpmm : 0;
      const h = b ? b.h / last.dpmm : 0;
      if (it.type === 'text' && it.fit) {
        it.x = round1(z.x + (it.x - a.x) * sx);
        it.y = round1(z.y + (it.y - a.y) * sy);
        it.w = round1(it.w * sx);
        it.h = round1(it.h * sy);
      } else {
        // Keep the item's centre at the same relative place.
        it.x = round1(z.x + (it.x + w / 2 - a.x) * sx - w / 2);
        it.y = round1(z.y + (it.y + h / 2 - a.y) * sy - h / 2);
      }
    }
  }
  refresh({ setup: true, props: true });
}

function setRowMode(value) {
  design.options.rowMode = value;
  delete design.options.fillRow;
  refresh({ setup: true, props: true });
}

// Switches a row to a design per label. Labels that have no items of their
// own yet start as a copy of label 1.
function unlinkLanes() {
  const count = laneCount();
  const first = design.items.filter((it) => !(it.lane > 0));
  for (let lane = 1; lane < count; lane++) {
    if (design.items.some((it) => it.lane === lane)) continue;
    design.items.push(...first.map((it) => ({ ...structuredClone(it), id: uid(), lane })));
  }
  setRowMode('separate');
}

// Rulers along the top (mm from the label's starting edge) and the side
// (mm from each label's top edge), with the selected item's extent marked.
function drawRulers(sel, feed) {
  const { geo, slots, dpmm } = last;
  const scale = zoom / dpmm;
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--muted').trim() || '#777';
  const accent = css.getPropertyValue('--accent').trim() || '#2463eb';
  const dpr = window.devicePixelRatio || 1;
  const setup = (id, w, h) => {
    const c = $(id);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    return ctx;
  };
  const T = 18; // ruler thickness, px
  const step = zoom >= 4 ? 1 : 5; // mm between ticks
  const every = zoom >= 2.5 ? 10 : 20; // mm between numbers

  // Each label starts its own scale: along the top in portrait (labels side
  // by side), down the side in landscape (labels stacked).
  const scaleAt = (ctx, starts, extent, labelLen, horizontal) => {
    for (const s0 of starts) {
      const p0 = s0 * scale;
      for (let mm = 0; mm <= labelLen / dpmm + 0.001; mm += step) {
        const p = Math.round(p0 + mm * zoom) + 0.5;
        if (p > extent) break;
        const len = mm % every === 0 ? T : mm % 5 === 0 ? T * 0.55 : T * 0.3;
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(p, T);
          ctx.lineTo(p, T - len);
        } else {
          ctx.moveTo(T, p);
          ctx.lineTo(T - len, p);
        }
        ctx.stroke();
        if (mm % every === 0 && (horizontal || mm > 0)) {
          if (horizontal) ctx.fillText(String(mm), p + 2, 9);
          else {
            ctx.save();
            ctx.translate(9, p - 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(String(mm), 0, 0);
            ctx.restore();
          }
        }
      }
      if (starts.length > 1) {
        ctx.fillStyle = accent;
        if (horizontal) ctx.fillRect(p0, 0, 1.5, T);
        else ctx.fillRect(0, p0, T, 1.5);
        ctx.fillStyle = ink;
      }
    }
  };
  const uniq = (v) => [...new Set(v)];
  const { display } = last;
  const labelW = slots[0].label.w;
  const labelH = slots[0].label.h;

  const top = setup('ruler-top', display.width * scale, T);
  if (sel) {
    top.fillStyle = `${accent}33`;
    top.fillRect(sel.x * scale, 0, sel.w * scale, T);
    top.fillStyle = ink;
  }
  // A continuous roll's scale runs on past the label to the end of the view.
  scaleAt(top, uniq(slots.map((s) => s.ox)), display.width * scale, last.portrait ? labelW : display.width, true);

  const side = setup('ruler-left', T, display.height * scale);
  if (sel) {
    side.fillStyle = `${accent}33`;
    side.fillRect(0, sel.y * scale, T, sel.h * scale);
    side.fillStyle = ink;
  }
  scaleAt(side, uniq(slots.map((s) => s.oy)), display.height * scale, last.portrait ? display.height : labelH, false);

  // Feed marks on the ruler along the feed (top in landscape, side in
  // portrait): an arrow at the end that comes out first, ✂ where it is cut,
  // » where a continuous label grows.
  if (!feed) return;
  const ctx = last.portrait ? side : top;
  const extent = (last.portrait ? display.height : display.width) * scale;
  const at = (p) => Math.min(extent, Math.max(0, p * scale));
  // A glyph on a light chip, inside the ruler against the end it marks;
  // `shift` px further in (to sit beside another mark on the same end).
  const mark = (p, text, shift = 0) => {
    const q = at(p);
    const atStart = q < extent / 2;
    ctx.save();
    ctx.font = 'bold 11px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 4;
    const start = atStart ? q + 1 + shift : q - 1 - shift - w;
    if (last.portrait) {
      ctx.fillStyle = 'rgba(255, 255, 255, .9)';
      ctx.fillRect(1, start, T - 2, w);
      ctx.translate(T / 2 + 4, start + w - 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = accent;
      ctx.fillText(text, 0, 0);
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, .9)';
      ctx.fillRect(start, 1, w, T - 2);
      ctx.fillStyle = accent;
      ctx.fillText(text, start + 2, T - 5);
    }
    ctx.restore();
    return w;
  };
  // The arrow points the way the label moves: out past the end that leads.
  // Portrait glyphs are drawn turned a quarter anticlockwise, so ▶ shows as
  // pointing up and ◀ as pointing down.
  const leadsAtStart = at(feed.lead) < extent / 2;
  const arrow = leadsAtStart === !last.portrait ? '◀' : '▶';
  const leadW = mark(feed.lead, arrow);
  if (feed.cuts) mark(feed.trail, '✂');
  if (feed.grows) {
    const far = (last.portrait ? display.height : display.width);
    const sameEnd = Math.abs(at(far) - at(feed.lead)) < 2;
    const cutHere = feed.cuts && Math.abs(at(far) - at(feed.trail)) < 2;
    // Grows right (landscape) or down (portrait: « turned shows as pointing down).
    mark(far, last.portrait ? '«' : '»', sameEnd ? leadW + 2 : cutHere ? 18 : 0);
  }
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
  const lanes = medium().lanes;
  $('lanes-box').hidden = !lanes;
  if (lanes) {
    const n = lanes.count;
    const sel = $('row-mode');
    sel.replaceChildren(
      new Option(`Same design on all ${n}`, 'same'),
      new Option(`A different design on each`, 'separate'),
      new Option('Same design, one label at a time', 'each'),
    );
    sel.value = mode();
    $('lanes-note').textContent = {
      same: `${n} labels per row: the design prints on each of them. Copies counts rows. 🔓 Edit separately on the dimmed copy gives it its own design.`,
      separate: `${n} labels per row, each with its own design: click a label to add items to it, or drag items between them. Copies counts rows. 🔗 Same as label 1 on a label links it back.`,
      each: `${n} labels per row: Copies counts labels, filling each row from the top.`,
    }[mode()];
  }
  $('orientation').value = portrait() ? 'portrait' : 'landscape';
  for (const b of document.querySelectorAll('[data-orient]')) b.setAttribute('aria-pressed', String(b.dataset.orient === $('orientation').value));
  const overprintable = canOverprint(m, medium());
  $('bleed-box').hidden = !overprintable;
  if (overprintable) $('bleed').value = String(design.bleedMm ?? 0);
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
  grid.append(input('Feed X (mm)', 'feedMm'), input('Across Y (mm)', 'acrossMm'));
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
  how.textContent = 'Grid: X (along the feed) is numbered from the end that comes out first, Y (across) from the top edge. '
    + 'Each numbered line should be that many mm from its edge. Measure one: if X line n is at n + d mm, set Feed X to −d; '
    + 'at n − d mm, set +d. Do the same with a Y line for Across Y. '
    + 'Lines in the hatched border may be missing; that is expected. Full black shows everything the printer can reach.';
  const needs = document.createElement('p');
  needs.className = 'note';
  needs.textContent = 'Connect the printer to print a test.';
  needs.hidden = !!transport;
  tests.append(summary, row, needs, how);
  box.replaceChildren(grid, note, rollPanel(roll), tests);
  updateAdjustState();
}

// The collapsed "Test prints & position" heading still says when an adjustment is active.
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

// Reconnects quietly to a printer this site may already use (after a
// reload, a plug-in, or picking its model), so you don't have to click
// Connect again.
let reconnecting = false;
async function autoConnect() {
  if (transport || reconnecting || !support.usb || !model().usbFilters) return;
  reconnecting = true;
  try {
    const t = await UsbTransport.reconnect(model().usbFilters);
    if (!t || transport) return;
    transport = t;
    setStatus(`Connected: ${transport.label}`, true);
    refresh({ setup: true });
    if (model().queryStatus) await detect();
  } catch { /* stay disconnected */ } finally {
    reconnecting = false;
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
    const copies = Math.max(1, Math.min(99, parseInt($('copies').value, 10) || 1));
    await sendRows(rowsFor(copies));
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

// The rows to print for `copies`, as view bitmaps. On a multi-up label
// ("2 up") each row fills every label, except 'each' mode, where copies
// counts labels and the last row may be partly blank.
function rowsFor(copies) {
  const adj = adjust();
  const count = laneCount();
  if (mode() !== 'each' || count === 1) {
    const { bitmap, geo } = renderView(design, model(), medium(), { adj });
    return Array(copies).fill({ bitmap, geo });
  }
  const rows = [];
  const byFill = new Map();
  for (let left = copies; left > 0; left -= count) {
    const filled = Math.min(left, count);
    if (!byFill.has(filled)) byFill.set(filled, renderView(design, model(), medium(), { adj, filled }));
    rows.push(byFill.get(filled));
  }
  return rows;
}

// Applies the position adjustment, encodes and sends each row.
async function sendRows(rows, med = medium()) {
  const dpmm = model().dpi / 25.4;
  const a = adjust();
  const shift = { feed: feedDots(a.feedMm, model(), dpmm), across: Math.round(a.acrossMm * dpmm), grow: !med.lengthDots };
  const opts = Object.fromEntries(model().options.map((o) => [o.id, option(o.id)]));
  // Printers that take several pages per job get all the copies at once.
  if (model().encodePages) {
    const bitmaps = new Map(rows.map((row) => [row, jobBitmap(row.bitmap, row.geo, model(), shift)]));
    await transport.write(model().encodePages(rows.map((row) => bitmaps.get(row)), med, opts));
    return;
  }
  const jobs = new Map(); // identical rows share one encoded job
  for (const row of rows) {
    if (!jobs.has(row)) jobs.set(row, model().encode(jobBitmap(row.bitmap, row.geo, model(), shift), med, opts));
    await transport.write(jobs.get(row));
  }
}

// Prints a hardware test pattern over the whole label (margins ignored).
async function printTestPattern(pattern) {
  if (!transport) return;
  const med = medium();
  const dpmm = model().dpi / 25.4;
  const lengthMm = med.lengthDots ? med.lengthDots / dpmm : 60;
  // Test prints cover the whole row of a multi-up label.
  const rowMedium = med.lanes ? { ...med, acrossDots: med.lanes.pageDots, lanes: undefined } : med;
  const test = testPatternDesign(pattern, lengthMm, rowMedium.acrossDots / dpmm, dpmm,
    { printer: design.printer, medium: med.id, leadingAtEnd: model().leadingEnd === 'end' });
  try {
    const { bitmap, length } = renderDesign(test, model(), rowMedium);
    const a = adjust();
    const geo = viewGeometry(model(), rowMedium, { length, feed: feedDots(a.feedMm, model(), dpmm), across: Math.round(a.acrossMm * dpmm) });
    await sendRows([{ bitmap, geo }], rowMedium);
    showBanner(pattern === 'grid'
      ? 'Grid sent. X is numbered from the end that came out first, Y from the top edge. If X line n is at n + d mm, set Feed X to −d (at n − d mm, +d); a Y line gives Across Y the same way.'
      : 'Full black sent. The black area is everything the printer can reach on this label.');
  } catch (err) {
    if (err.usbProblem) showUsbProblem(err);
    else showBanner(`Print failed: ${err.message}`);
  } finally {
    await transport?.release();
  }
}

function downloadPng() {
  const { display } = renderView();
  bitmapToCanvas(display).toBlob((blob) => download(blob, 'label.png'));
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
  design.items.push({ id: uid(), ...item, ...(mode() === 'separate' ? { lane: currentLane() } : {}) });
  selectedId = design.items.at(-1).id;
  refresh({ props: true });
}

// X position (mm) just after the rightmost existing item.
function nextX() {
  const lane = currentLane();
  const mine = last ? last.bounds.filter((b, i) => b && last.lanes[i] === lane) : [];
  const ox = last?.slots[lane]?.ox ?? 0;
  const right = Math.max(0, ...mine.map((b) => (b.x - ox + b.w) / last.dpmm));
  const start = Math.max(2, itemMargins().left + 1);
  // On a label narrower than that (e.g. portrait), start at the left again.
  const page = pageSize();
  if (right && page.wFixed && right + 3 + 5 > page.w - itemMargins().right) return round1(start);
  return round1(right ? right + 3 : start);
}

function addText() {
  const size = newTextSize();
  addItem({
    type: 'text', text: 'Text', font: 'sans-serif', size, bold: false, italic: false, align: 'left',
    ...placeNew(size * 1.15),
  });
}

function addImage(file) {
  const reader = new FileReader();
  reader.onload = () => {
    addItem({ type: 'image', src: reader.result, ...placeNew(usableMm()), w: round1(usableMm()), threshold: 128, dither: false, invert: false });
  };
  reader.readAsDataURL(file);
}

function addBox() {
  const across = Math.max(2, round1(usableMm() - 1));
  const box = growsDown() ? { w: across, h: 20 } : { w: 20, h: across };
  addItem({ type: 'box', ...placeNew(box.h), ...box, stroke: 0.4, fill: false });
}

function addQr() {
  const size = round1(Math.min(25, usableMm() * 0.9));
  addItem({ type: 'qr', data: 'https://example.com', ecc: 'M', size, ...placeNew(size) });
}

function addBarcode() {
  const textSize = Math.min(3, round1(usableMm() * 0.22));
  const height = Math.max(3, round1(Math.min(15, usableMm() - textSize - 1.2)));
  const total = height + 0.4 + textSize;
  addItem({
    type: 'barcode', symbology: 'code128', data: 'ABC-12345', module: 0.3, height,
    showText: true, textSize, ...placeNew(total),
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
    const where = mode() === 'separate' && laneCount() > 1 ? `L${laneOf(item) + 1} ` : '';
    li.append(kind, where + describe(item));
    if (!itemVisible(item, mode(), laneCount())) li.classList.add('hidden-item');
    li.onclick = () => { selectedId = item.id; activeLane = laneOf(item); refresh({ props: true }); };
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
      rotateField(item),
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
      const b = last.bounds[design.items.indexOf(item)];
      if (!b) return;
      // Across the tape/head: horizontal on a portrait page.
      const mg = itemMargins(laneOf(item));
      if (portrait()) {
        const room = pageSize().w - mg.left - mg.right;
        item.x = +(mg.left + (room - b.w / last.dpmm) / 2).toFixed(2);
      } else {
        item.y = +(bandTop() + (usableMm() - b.h / last.dpmm) / 2).toFixed(2);
      }
      refresh({ props: true });
    }),
  );
  if (item.type === 'text' && item.fit) {
    // Size the box to an area given as insets from the label's edges; along
    // a continuous roll only when the label has a set length.
    const fill = (mg) => {
      const page = pageSize();
      if (page.hFixed) {
        item.y = round1(mg.top);
        item.h = round1(page.h - mg.top - mg.bottom);
      }
      if (page.wFixed) {
        item.x = round1(mg.left);
        item.w = round1(page.w - mg.left - mg.right);
      }
      refresh({ props: true });
    };
    row.append(btn('Fill safe area', () => fill(itemMargins(laneOf(item)))));
    // Overprint: the whole label the printer can reach, ignoring the safe area.
    row.append(btn('Fill to edge', () => fill(itemEdge(laneOf(item)))));
  } else if (item.type === 'text') {
    // Size the text to fill the label across the tape/head (its width on a
    // portrait page).
    row.append(btn(portrait() ? 'Fill width' : 'Fill height', () => {
      const b = last.bounds[design.items.indexOf(item)];
      if (!b) return;
      const mg = itemMargins(laneOf(item));
      if (portrait()) {
        const room = pageSize().w - mg.left - mg.right;
        item.size = +((room * 0.95) / (b.w / last.dpmm / item.size)).toFixed(2);
        item.x = +(mg.left + room * 0.025).toFixed(2);
      } else {
        item.size = +((usableMm() * 0.95) / (b.h / last.dpmm / item.size)).toFixed(2);
        item.y = +(bandTop() + usableMm() * 0.025).toFixed(2);
      }
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

// Quarter-turn rotation (e.g. for cable flags). The item turns about its
// centre; a fitted box turns with it, so the text keeps its size.
const ROTATIONS = [[0, 'None'], [90, '90° clockwise'], [180, '180°'], [270, '90° anticlockwise']];
function rotateField(item) {
  const l = document.createElement('label');
  l.textContent = 'Rotate';
  const sel = document.createElement('select');
  const now = quarterTurns(item) * 90;
  ROTATIONS.forEach(([v, t]) => sel.add(new Option(t, String(v), false, v === now)));
  sel.onchange = () => setRotation(item, Number(sel.value));
  l.append(sel);
  return l;
}

function setRotation(item, degrees) {
  const b = last?.bounds[design.items.indexOf(item)];
  const turned = (quarterTurns(item) - degrees / 90) % 2 !== 0;
  item.rotate = degrees;
  if (turned && b) {
    const w = b.w / last.dpmm;
    const h = b.h / last.dpmm;
    const cx = item.x + w / 2;
    const cy = item.y + h / 2;
    if (item.fit) [item.w, item.h] = [item.h, item.w];
    // Turned about its centre, then kept on the label: inside the printable
    // band across, or centred on it when it is longer than the band.
    const mg = itemMargins(laneOf(item));
    const page = pageSize();
    // Down a continuous roll (portrait) there is no bottom to keep inside.
    const room = page.hFixed ? page.h - mg.top - mg.bottom : Infinity;
    const y = cy - w / 2;
    if (item.fit && w > room) {
      // A fitted box shrinks to the band; the text refits.
      item.h = round1(room);
      item.y = round1(mg.top);
    } else {
      item.y = round1(w <= room ? Math.min(Math.max(y, mg.top), mg.top + room - w) : mg.top + (room - w) / 2);
    }
    item.x = round1(Math.max(mg.left, cx - h / 2));
  }
  refresh({ props: true });
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
      const b = last.bounds[design.items.indexOf(item)] ?? { w: 20 * last.dpmm, h: 5 * last.dpmm };
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
    if (!b) continue;
    const x = pt.x * last.dpmm;
    const y = pt.y * last.dpmm;
    if (x >= b.x - 2 && x <= b.x + b.w + 2 && y >= b.y - 2 && y <= b.y + b.h + 2) return design.items[i];
  }
  return null;
}

function onHandle(e) {
  const item = selected();
  const b = last?.bounds[design.items.indexOf(item)];
  if (!b || !resizable(item)) return null;
  const r = $('canvas').getBoundingClientRect();
  const h = handleRect(b, zoom / last.dpmm);
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const pad = 4;
  return x >= h.x - pad && x <= h.x + h.size + pad && y >= h.y - pad && y <= h.y + h.size + pad ? item : null;
}

// The label of the row under a point (view mm), overprint border
// included, or null outside them.
function slotAt(pt) {
  if (!last) return null;
  const x = pt.x * last.dpmm;
  const y = pt.y * last.dpmm;
  return last.slots.find(({ outer: o }) => x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h) ?? null;
}
// Where an item's label starts in the view, mm.
function labelOrigin(item) {
  const s = last?.slots[laneOf(item)];
  return s ? { x: s.ox / last.dpmm, y: s.oy / last.dpmm } : { x: 0, y: 0 };
}

let drag = null;
function onPointerDown(e) {
  const pt = canvasPointToMm(e);
  const handled = onHandle(e);
  if (handled) {
    undo.checkpoint();
    drag = { item: handled, resize: true };
    $('canvas').setPointerCapture(e.pointerId);
    return;
  }
  const item = hitTest(pt);
  const wasSelected = !!item && item.id === selectedId;
  selectedId = item?.id ?? null;
  if (item) {
    undo.checkpoint();
    activeLane = laneOf(item);
    drag = { item, dx: pt.x - item.x, dy: pt.y - item.y, wasSelected, from: pt, moved: false };
    $('canvas').setPointerCapture(e.pointerId);
  } else if (mode() === 'separate') {
    activeLane = slotAt(pt)?.lane ?? activeLane;
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
  const it = drag.item;
  if (drag.resize) {
    const o = labelOrigin(it);
    RESIZERS[it.type](it, Math.max(1, round1(pt.x - o.x - it.x)), Math.max(1, round1(pt.y - o.y - it.y)));
    refresh();
    return;
  }
  // A small wobble during a click isn't a drag.
  if (!drag.moved && Math.hypot(pt.x - drag.from.x, pt.y - drag.from.y) * zoom < 3) return;
  drag.moved = true;
  it.x = Math.round((pt.x - drag.dx) * 10) / 10;
  it.y = Math.round((pt.y - drag.dy) * 10) / 10;
  // With a design per label, dragging an item onto another label moves it there.
  const b = last.bounds[design.items.indexOf(it)];
  if (mode() === 'separate' && b) {
    const o = labelOrigin(it);
    const centre = { x: o.x + it.x + b.w / last.dpmm / 2, y: o.y + it.y + b.h / last.dpmm / 2 };
    const to = slotAt(centre);
    if (to && to.lane !== laneOf(it)) {
      const from = last.slots[laneOf(it)];
      const sx = (from.ox - to.ox) / last.dpmm;
      const sy = (from.oy - to.oy) / last.dpmm;
      it.x = round1(it.x + sx);
      it.y = round1(it.y + sy);
      drag.dx -= sx;
      drag.dy -= sy;
      it.lane = to.lane;
      activeLane = to.lane;
    }
  }
  refresh();
}

// Clicking text that is already selected (without dragging it) edits it in
// place, as in DYMO Label; the first click selects it.
function onPointerUp() {
  if (!drag) return;
  const { item, wasSelected, moved, resize } = drag;
  drag = null;
  refresh({ props: true });
  if (item.type === 'text' && wasSelected && !moved && !resize) startEdit(item, { selectAll: false });
}

// ---------- in-place text editing ----------

let editing = null;

// selectAll: select the whole text (double-click, Enter) rather than put the
// cursor at the end (a click on selected text).
function startEdit(item, { selectAll = true } = {}) {
  if (editing?.item === item) {
    if (selectAll) editing.ta.select();
    return;
  }
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
  if (selectAll) ta.select();
  else ta.setSelectionRange(ta.value.length, ta.value.length);
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
    // Rotated text is edited rotated, turning about the same point.
    transformOrigin: `${l.pivot.x * scale + 2}px ${l.pivot.y * scale}px`,
    transform: l.rotate ? `rotate(${l.rotate}deg)` : '',
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
    const slot = slotAt(pt);
    if (!slot || slot.copy) return;
    if (mode() === 'separate') activeLane = slot.lane;
    const size = newTextSize();
    const x = pt.x - slot.ox / last.dpmm;
    const y = pt.y - slot.oy / last.dpmm;
    design.items.push({
      id: uid(), type: 'text', text: 'Text', font: 'sans-serif', size, bold: false, italic: false, align: 'left',
      x: +Math.max(0, x).toFixed(1), y: +Math.max(0, y - size * 0.6).toFixed(1),
      ...(mode() === 'separate' ? { lane: slot.lane } : {}),
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
  const lane = mode() === 'separate' ? { lane: currentLane() } : {};
  const copies = items.map((it) => ({ ...structuredClone(it), id: uid(), x: round1(it.x + offset), y: round1(it.y + offset), ...lane }));
  design.items.push(...copies);
  selectedId = copies.at(-1).id;
  refresh({ props: true });
}

function duplicateSelected() {
  const item = selected();
  if (item) pasteItems([item]);
}

// The page's own text (a help dialog, or text selected on the page) gets
// the browser's normal copy and paste, not the label's.
const dialogOpen = () => !!document.querySelector('dialog[open]');
const pageTextSelected = () => (window.getSelection()?.toString() ?? '') !== '';

function onCopy(e, cut = false) {
  const item = selected();
  if (typingInField() || editing || !item || dialogOpen() || pageTextSelected()) return;
  e.preventDefault();
  const text = itemPlainText(item);
  clipboard = { text, items: [structuredClone(item)] };
  e.clipboardData.setData('text/plain', text);
  e.clipboardData.setData(CLIP_TYPE, JSON.stringify(clipboard.items));
  if (cut) deleteItem(item);
}

function onPaste(e) {
  if (typingInField() || editing || dialogOpen()) return;
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
    const size = newTextSize();
    addItem({
      type: 'text', text: text.replace(/\s+$/, ''), font: 'sans-serif', size, bold: false, italic: false, align: 'left',
      ...placeNew(size * 1.15),
    });
  }
}

// The label at its real size in the panel under the editor (real: CSS px
// per mm), or the panel hidden.
function drawActualPanel(real) {
  const wrap = $('actual-wrap');
  wrap.hidden = !real;
  if (!real) return;
  const { display, dpmm } = last;
  const c = $('actual-canvas');
  const scale = real / dpmm;
  const dpr = window.devicePixelRatio || 1;
  const w = display.width * scale;
  const h = display.height * scale;
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const colors = previewColors();
  ctx.drawImage(bitmapToCanvas(display, colors.ink, colors.paper), 0, 0, w, h);
  const plain = last.slots.length === 1 && !last.geo.top && !last.geo.bottom && !last.geo.right;
  c.style.borderRadius = plain && medium().cornerMm ? `${medium().cornerMm * real}px` : '0';
}

// The 1:1 button: dimmed until the screen is calibrated, pressed while on.
function updateActualButton() {
  const b = $('zoom-actual');
  const ready = !!actualPxPerMm();
  b.classList.toggle('unset', !ready);
  b.setAttribute('aria-pressed', String(actualSize));
  b.title = ready
    ? 'Actual size: the label at its real size on this screen (right-click to recalibrate)'
    : 'Actual size: calibrate this screen first (a bank card or a ruler against the screen)';
}

// ---------- undo ----------

function updateUndoButtons() {
  $('undo').disabled = !undo.canUndo;
  $('redo').disabled = !undo.canRedo;
}

function applyUndo(state) {
  if (state == null) return;
  stopEdit();
  drag = null;
  design = JSON.parse(state);
  if (!design.items.some((i) => i.id === selectedId)) selectedId = null;
  updateUndoButtons();
  refresh({ setup: true, props: true });
}
const doUndo = () => applyUndo(undo.undo());
const doRedo = () => applyUndo(undo.redo());

// Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y anywhere but in a text field, where the
// browser's own undo applies.
function onUndoKey(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || typingInField() || editing || dialogOpen()) return;
  const key = e.key.toLowerCase();
  if (key === 'z') {
    e.preventDefault();
    if (e.shiftKey) doRedo();
    else doUndo();
  } else if (key === 'y') {
    e.preventDefault();
    doRedo();
  }
}

function onKey(e) {
  const item = selected();
  if (!item) return;
  if (item.type === 'text' && (e.key === 'Enter' || e.key === 'F2') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    startEdit(item);
    return;
  }
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
    disconnect().then(autoConnect);
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
  // Zooming the editor leaves the actual-size panel open; when the editor
  // itself was at real size, zooming leaves real size.
  const zoomBy = (f) => {
    stopEdit();
    if (actualSize && !actualPanel) actualSize = false;
    editZoom = Math.min(30, Math.max(1, editZoom * f));
    refresh();
  };
  $('zoom-in').onclick = () => zoomBy(1.25);
  $('zoom-out').onclick = () => zoomBy(1 / 1.25);
  // Actual size needs the screen calibrated first; until then the button
  // opens the calibration.
  const calibrate = () => openScreenCalibration($('screen-dialog'), {
    onDone: (ok) => { actualSize = ok; refresh(); },
  });
  $('zoom-actual').onclick = () => {
    stopEdit();
    if (!actualPxPerMm()) calibrate();
    else { actualSize = !actualSize; refresh(); }
  };
  $('zoom-actual').oncontextmenu = (e) => { e.preventDefault(); calibrate(); };
  $('btn-recalibrate').onclick = calibrate;
  // Browser zoom or a move to another screen changes devicePixelRatio.
  window.addEventListener('resize', () => { if (actualSize) refresh(); });

  $('btn-export').onclick = () => {
    const { labelId, ...plain } = design;
    download(new Blob([JSON.stringify(plain, null, 2)], { type: 'application/json' }), 'label.json');
  };
  $('btn-labels').onclick = () => showLibrary();
  $('row-mode').onchange = (e) => {
    if (e.target.value === 'separate') unlinkLanes();
    else setRowMode(e.target.value);
  };
  $('orientation').onchange = (e) => setOrientation(e.target.value);
  for (const b of document.querySelectorAll('[data-orient]')) b.onclick = () => setOrientation(b.dataset.orient);
  $('bleed').onchange = (e) => { design.bleedMm = Number(e.target.value) || 0; refresh({ setup: true }); };
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
      design = { ...newDesign(), ...migrateDesign(d) };
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
  document.addEventListener('keydown', onUndoKey);
  // Clicks and menu/checkbox changes are separate actions: each starts its
  // own undo step, while typing, nudging and dragging merge.
  document.addEventListener('click', () => undo.checkpoint(), true);
  document.addEventListener('change', () => undo.checkpoint(), true);
  $('undo').onclick = doUndo;
  $('redo').onclick = doRedo;
  updateUndoButtons();
  canvas.addEventListener('dblclick', onDoubleClick);
  document.addEventListener('copy', (e) => onCopy(e));
  document.addEventListener('cut', (e) => onCopy(e, true));
  document.addEventListener('paste', onPaste);

  if (support.usb) {
    navigator.usb.addEventListener('disconnect', (e) => {
      if (transport?.device === e.device) disconnect();
    });
    navigator.usb.addEventListener('connect', () => autoConnect());
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
    const { display } = renderView(migrateDesign(JSON.parse(JSON.stringify(d))), m, med);
    const full = bitmapToCanvas(display);
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
      design = { ...newDesign(), ...migrateDesign(JSON.parse(JSON.stringify(d))) };
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
autoConnect();
