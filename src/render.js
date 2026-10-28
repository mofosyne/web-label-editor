// SPDX-License-Identifier: GPL-3.0-or-later
// Renders a design into a 1-bit "strip" bitmap at the printer's resolution.
// Strip coordinates: x runs along the label length, y across the tape/head.
// Design units are millimetres; (0,0) is the top-left of the printable area.

import { ICONS } from './icons.js';
import { encodeQr } from './codes/qr.js';
import { SYMBOLOGIES } from './codes/barcode.js';
import { pageToStrip } from './layout.js';

const imageCache = new Map();
const codeCache = new Map();

// Encodes a QR or barcode item, caching by content. Returns { code } or { error }.
export function encodeItem(item) {
  const key = item.type === 'qr'
    ? `qr|${item.ecc}|${item.data}`
    : `bc|${item.symbology}|${item.data}`;
  if (!codeCache.has(key)) {
    try {
      if (!String(item.data ?? '').trim()) throw new Error(`The ${item.type === 'qr' ? 'QR code' : 'barcode'} is empty`);
      const code = item.type === 'qr'
        ? encodeQr(item.data ?? '', item.ecc ?? 'M')
        : SYMBOLOGIES[item.symbology].encode(item.data ?? '');
      codeCache.set(key, { code });
    } catch (err) {
      codeCache.set(key, { error: err.message });
    }
    if (codeCache.size > 200) codeCache.delete(codeCache.keys().next().value);
  }
  return codeCache.get(key);
}

export function itemError(item) {
  if (item.type !== 'qr' && item.type !== 'barcode') return null;
  return encodeItem(item).error ?? null;
}

// Geometry of a QR/barcode item in whole dots, so every module is crisp.
//
// sx: dots per page x unit when page x is printed at a finer resolution
// than y (2 for 300 x 600 dpi along a landscape label): barcode bars, which
// are measured along x, are then sized in those finer dots.
function codeLayout(ctx, item, dpmm, sx = 1) {
  const { code, error } = encodeItem(item);
  const bars = item.type === 'barcode' ? sx : 1;
  const x = Math.round(item.x * dpmm * bars) / bars;
  const y = Math.round(item.y * dpmm);
  if (error) return { x, y, w: Math.round(5 * dpmm), h: Math.round(5 * dpmm), error };
  if (item.type === 'qr') {
    const m = Math.max(1, Math.floor((item.size * dpmm) / code.size));
    return { x, y, w: code.size * m, h: code.size * m, m, code };
  }
  const m = Math.max(1, Math.round(item.module * dpmm * bars)) / bars;
  const barH = Math.max(1, Math.round(item.height * dpmm));
  const w = (code.quietLeft + code.modules.length + code.quietRight) * m;
  let textPx = 0;
  if (item.showText) {
    textPx = Math.max(1, item.textSize * dpmm);
    ctx.font = `bold ${textPx}px ${item.font || 'monospace'}`;
  }
  const gap = item.showText ? Math.round(0.4 * dpmm) : 0;
  return { x, y, w, h: barH + gap + Math.ceil(textPx), m, barH, gap, textPx, code };
}

export function loadImage(src, onLoad) {
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.onload = onLoad;
    img.src = src;
    imageCache.set(src, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

function fontString(item, px) {
  return `${item.italic ? 'italic ' : ''}${item.bold ? 'bold ' : ''}${px}px ${item.font || 'sans-serif'}`;
}

function textMetrics(ctx, item, dpmm, sizeMm = item.size) {
  const px = Math.max(1, sizeMm * dpmm);
  ctx.font = fontString(item, px);
  const m = ctx.measureText('Hg');
  const ascent = m.fontBoundingBoxAscent ?? px * 0.8;
  const descent = m.fontBoundingBoxDescent ?? px * 0.2;
  const lineH = (ascent + descent) * (item.lineHeight ?? 1);
  const lines = String(item.text ?? '').split('\n');
  const widths = lines.map((l) => ctx.measureText(l).width);
  return {
    px, ascent, lineH, lines, widths,
    w: Math.max(1, ...widths),
    h: lineH * lines.length,
  };
}

// Quarter turns clockwise (0-3) of an item's `rotate` (degrees, multiples of 90).
export function quarterTurns(item) {
  return ((Math.round((item.rotate ?? 0) / 90) % 4) + 4) % 4;
}

// Where a text item's lines go, in dots. Normal text is sized by item.size
// and its box hugs the text. With item.fit the box is fixed (item.w × item.h
// mm) and the largest size that fits is used, centred vertically and aligned
// horizontally in the box.
//
// Rotated text (item.rotate: 90, 180 or 270, clockwise) turns about the
// centre of its box: `box` is where it lands on the label, and the lines are
// laid out unrotated at blockX/blockY, to be turned by `rotate` degrees about
// `pivot` (relative to blockX/blockY). A fitted box keeps its shape on the
// label, so text turned 90° fits its height to the box's width.
export function textLayout(ctx, item, dpmm) {
  const x = item.x * dpmm;
  const y = item.y * dpmm;
  const q = quarterTurns(item);
  const sideways = q % 2 === 1;
  let m;
  let sizeMm;
  let box;
  let frameW;
  let frameH;
  if (!item.fit) {
    m = textMetrics(ctx, item, dpmm);
    sizeMm = item.size;
    frameW = m.w;
    frameH = m.h;
    box = { x, y, w: sideways ? m.h : m.w, h: sideways ? m.w : m.h };
  } else {
    box = { x, y, w: Math.max(1, item.w * dpmm), h: Math.max(1, item.h * dpmm) };
    frameW = sideways ? box.h : box.w;
    frameH = sideways ? box.w : box.h;
    const ref = textMetrics(ctx, item, dpmm, 10);
    sizeMm = Math.max(0.3, 10 * Math.min(frameW / ref.w, frameH / ref.h) * 0.99);
    m = textMetrics(ctx, item, dpmm, sizeMm);
  }
  // The unrotated frame, centred on the box.
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const fx = cx - frameW / 2;
  const fy = cy - frameH / 2;
  let blockX = fx;
  if (item.fit && item.align === 'center') blockX = fx + (frameW - m.w) / 2;
  else if (item.fit && item.align === 'right') blockX = fx + frameW - m.w;
  const blockY = item.fit ? fy + (frameH - m.h) / 2 : fy;
  return { ...m, sizeMm, box, blockX, blockY, rotate: q * 90, pivot: { x: cx - blockX, y: cy - blockY } };
}

// Brand icons (see icons.js) as Path2D, made once each.
const iconPaths = new Map();
function iconPath(name) {
  if (!iconPaths.has(name)) iconPaths.set(name, ICONS[name] ? new Path2D(ICONS[name].path) : null);
  return iconPaths.get(name);
}

// Item bounds in dots, relative to the printable strip.
export function itemBounds(ctx, item, dpmm) {
  const x = item.x * dpmm;
  const y = item.y * dpmm;
  if (item.type === 'text') return textLayout(ctx, item, dpmm).box;
  if (item.type === 'image') {
    const img = loadImage(item.src);
    const w = item.w * dpmm;
    const aspect = img ? img.naturalHeight / img.naturalWidth : 1;
    return { x, y, w, h: w * aspect };
  }
  if (item.type === 'box') {
    return { x, y, w: item.w * dpmm, h: item.h * dpmm };
  }
  if (item.type === 'icon') {
    return { x, y, w: item.size * dpmm, h: item.size * dpmm };
  }
  if (item.type === 'qr' || item.type === 'barcode') {
    const l = codeLayout(ctx, item, dpmm);
    return { x: l.x, y: l.y, w: l.w, h: l.h };
  }
  return { x, y, w: 0, h: 0 };
}

// Where an item puts ink, in dots: for text, the glyphs' own extent, since
// fonts leave room above capitals and below the baseline that is never
// inked; other items fill their bounds. null for text with nothing to ink.
export function itemInk(ctx, item, dpmm) {
  if (item.type !== 'text') return itemBounds(ctx, item, dpmm);
  const m = textLayout(ctx, item, dpmm);
  ctx.font = fontString(item, m.px);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  m.lines.forEach((line, i) => {
    if (!line.trim()) return;
    const t = ctx.measureText(line);
    let dx = 0;
    if (item.align === 'center') dx = (m.w - m.widths[i]) / 2;
    else if (item.align === 'right') dx = m.w - m.widths[i];
    const x = m.blockX + dx;
    const base = m.blockY + i * m.lineH + m.ascent;
    x0 = Math.min(x0, x - (t.actualBoundingBoxLeft ?? 0));
    x1 = Math.max(x1, x + (t.actualBoundingBoxRight ?? m.widths[i]));
    y0 = Math.min(y0, base - (t.actualBoundingBoxAscent ?? m.ascent));
    y1 = Math.max(y1, base + (t.actualBoundingBoxDescent ?? 0));
  });
  if (x0 === Infinity) return null;
  if (!m.rotate) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  // Turned text: the ink's corners turned about the box's centre.
  const px = m.blockX + m.pivot.x;
  const py = m.blockY + m.pivot.y;
  const a = (m.rotate * Math.PI) / 180;
  const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [
    px + (x - px) * Math.cos(a) - (y - py) * Math.sin(a),
    py + (x - px) * Math.sin(a) + (y - py) * Math.cos(a),
  ]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function drawText(ctx, item, dpmm) {
  const m = textLayout(ctx, item, dpmm);
  ctx.save();
  if (m.rotate) {
    const px = m.blockX + m.pivot.x;
    const py = m.blockY + m.pivot.y;
    ctx.translate(px, py);
    ctx.rotate((m.rotate * Math.PI) / 180);
    ctx.translate(-px, -py);
  }
  ctx.font = fontString(item, m.px);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  m.lines.forEach((line, i) => {
    let dx = 0;
    if (item.align === 'center') dx = (m.w - m.widths[i]) / 2;
    else if (item.align === 'right') dx = m.w - m.widths[i];
    ctx.fillText(line, m.blockX + dx, m.blockY + i * m.lineH + m.ascent);
  });
  ctx.restore();
}

// Draw the image already reduced to pure black/white so the global
// threshold does not alter it.
function drawImage(ctx, item, dpmm, onLoad) {
  const img = loadImage(item.src, onLoad);
  if (!img) return;
  const b = itemBounds(ctx, item, dpmm);
  const w = Math.max(1, Math.round(b.w));
  const h = Math.max(1, Math.round(b.h));
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const t = tmp.getContext('2d', { willReadFrequently: true });
  t.fillStyle = '#fff';
  t.fillRect(0, 0, w, h);
  t.drawImage(img, 0, 0, w, h);
  const id = t.getImageData(0, 0, w, h);
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const a = id.data[p + 3] / 255;
    const l = 0.299 * id.data[p] + 0.587 * id.data[p + 1] + 0.114 * id.data[p + 2];
    lum[i] = l * a + 255 * (1 - a);
    if (item.invert) lum[i] = 255 - lum[i];
  }
  const threshold = item.threshold ?? 128;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const i = yy * w + xx;
      const black = lum[i] < threshold;
      if (item.dither) {
        const err = lum[i] - (black ? 0 : 255);
        if (xx + 1 < w) lum[i + 1] += (err * 7) / 16;
        if (yy + 1 < h) {
          if (xx > 0) lum[i + w - 1] += (err * 3) / 16;
          lum[i + w] += (err * 5) / 16;
          if (xx + 1 < w) lum[i + w + 1] += err / 16;
        }
      }
      const v = black ? 0 : 255;
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
      id.data[i * 4 + 3] = 255;
    }
  }
  t.putImageData(id, 0, 0);
  ctx.drawImage(tmp, Math.round(b.x), Math.round(b.y));
}

function drawCode(ctx, item, dpmm, sx = 1) {
  const l = codeLayout(ctx, item, dpmm, sx);
  if (l.error) return;
  ctx.fillStyle = '#000';
  if (item.type === 'qr') {
    l.code.modules.forEach((row, my) => row.forEach((dark, mx) => {
      if (dark) ctx.fillRect(l.x + mx * l.m, l.y + my * l.m, l.m, l.m);
    }));
    return;
  }
  const left = l.x + l.code.quietLeft * l.m;
  l.code.modules.forEach((bar, i) => {
    if (bar) ctx.fillRect(left + i * l.m, l.y, l.m, l.barH);
  });
  if (item.showText) {
    ctx.font = `bold ${l.textPx}px ${item.font || 'monospace'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(l.code.text, l.x + l.w / 2, l.y + l.barH + l.gap);
    ctx.textAlign = 'start';
  }
}

// A brand icon, drawn from its 24-unit path at item.size mm square.
function drawIcon(ctx, item, dpmm) {
  const path = iconPath(item.icon);
  if (!path) return;
  const s = (item.size * dpmm) / 24;
  ctx.save();
  ctx.translate(item.x * dpmm, item.y * dpmm);
  ctx.scale(s, s);
  ctx.fillStyle = '#000';
  ctx.fill(path);
  ctx.restore();
}

// Shapes: a rectangle (the default), a rounded rectangle, an ellipse in the
// box, or a line along the box's longer side; outlined with item.stroke, or
// filled.
function drawBox(ctx, item, dpmm) {
  const x = item.x * dpmm;
  const y = item.y * dpmm;
  const w = item.w * dpmm;
  const h = item.h * dpmm;
  const shape = item.shape ?? 'rect';
  ctx.fillStyle = item.white ? '#fff' : '#000';
  ctx.strokeStyle = ctx.fillStyle;
  const t = Math.max(1, (item.stroke ?? 0.3) * dpmm);
  if (shape === 'line') {
    if (w >= h) ctx.fillRect(x, y + (h - t) / 2, w, t);
    else ctx.fillRect(x + (w - t) / 2, y, t, h);
    return;
  }
  if (shape === 'rounded' || shape === 'ellipse') {
    const r = Math.min(w, h) / 2;
    const radius = shape === 'rounded' ? Math.min(r, (item.radius ?? 2) * dpmm) : 0;
    const path = (inset) => {
      ctx.beginPath();
      if (shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, Math.max(0, w / 2 - inset), Math.max(0, h / 2 - inset), 0, 0, 2 * Math.PI);
      else ctx.roundRect(x + inset, y + inset, Math.max(0, w - 2 * inset), Math.max(0, h - 2 * inset), Math.max(0, radius - inset));
    };
    if (item.fill) {
      path(0);
      ctx.fill();
    } else {
      ctx.lineWidth = t;
      path(t / 2);
      ctx.stroke();
    }
    return;
  }
  if (item.fill) {
    ctx.fillRect(x, y, w, h);
    return;
  }
  ctx.fillRect(x, y, w, t);
  ctx.fillRect(x, y + h - t, w, t);
  ctx.fillRect(x, y, t, h);
  ctx.fillRect(x + w - t, y, t, h);
}

// Length of the strip in dots: fixed for die-cut media, otherwise either the
// user's fixed length or the furthest item edge plus padding.
// The label's length along the feed, in dots: fixed, or (fit to content)
// up to the furthest item: its right edge, or its bottom edge in portrait.
export function stripLength(design, medium, dpi, ctx, items = design.items, portrait = false) {
  const dpmm = dpi / 25.4;
  if (medium.lengthDots) return medium.lengthDots;
  if (design.length.mode === 'fixed') return Math.max(1, Math.round(design.length.mm * dpmm));
  let right = 0;
  for (const item of items) {
    const b = itemBounds(ctx, item, dpmm);
    right = Math.max(right, portrait ? b.y + b.h : b.x + b.w);
  }
  return Math.max(Math.round(5 * dpmm), Math.round(right + design.length.padMm * dpmm));
}

// Renders one label. opts.items: the items to draw (default all);
// opts.length: the strip length in dots (default from stripLength);
// opts.ext: { top, bottom, right } dots of overprint border past the label
// edge, rendered too (the bitmap grows by them; the label starts at
// (0, ext.top)). Bounds and text layouts are relative to the label.
//
// opts.portrait: the items are laid out on the label standing upright
// (across the head is the page's width, the feed its height), and the
// bitmap is turned into strip orientation for printing; bounds and text
// layouts stay in page coordinates.
//
// opts.stretch: dots per dot along the feed in the bitmap (2 for a printer's
// 300 x 600 dpi mode). Everything is laid out as usual, then drawn that many
// times finer along the feed; the bitmap is that much longer, while length,
// bounds and text layouts stay in ordinary dots.
export function renderDesign(design, model, medium, onAssetLoad, opts = {}) {
  const dpi = model.dpi;
  const dpmm = dpi / 25.4;
  const items = opts.items ?? design.items;
  const ext = { top: 0, bottom: 0, right: 0, ...opts.ext };
  const portrait = !!opts.portrait;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const length = opts.length ?? stripLength(design, medium, dpi, ctx, items, portrait);
  const across = medium.acrossDots;
  // The surface drawn on: the strip, or the upright page with the
  // overprint border turned with it (strip top = page left, strip bottom =
  // page right, strip end = page top; see pageToStrip).
  const offX = portrait ? ext.top : 0;
  const offY = portrait ? ext.right : ext.top;
  const width = portrait ? ext.top + across + ext.bottom : length + ext.right;
  const height = portrait ? ext.right + length : ext.top + across + ext.bottom;
  // Along the feed is page x on a landscape label, page y upright.
  const stretch = opts.stretch ?? 1;
  const sx = portrait ? 1 : stretch;
  const sy = portrait ? stretch : 1;
  const W = width * sx;
  const H = height * sy;
  canvas.width = W;
  canvas.height = H;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.translate(offX, offY);
  for (const item of items) {
    if (item.type === 'text') drawText(ctx, item, dpmm);
    else if (item.type === 'image') drawImage(ctx, item, dpmm, onAssetLoad);
    else if (item.type === 'box') drawBox(ctx, item, dpmm);
    else if (item.type === 'icon') drawIcon(ctx, item, dpmm);
    else if (item.type === 'qr' || item.type === 'barcode') drawCode(ctx, item, dpmm, sx);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const id = ctx.getImageData(0, 0, W, H);
  const data = new Uint8Array(W * H);
  for (let i = 0; i < data.length; i++) {
    const p = i * 4;
    const l = 0.299 * id.data[p] + 0.587 * id.data[p + 1] + 0.114 * id.data[p + 2];
    data[i] = l < 128 ? 1 : 0;
  }
  // Inverting covers the overprint border too: black right to the edge.
  if (design.invert) for (let i = 0; i < data.length; i++) data[i] ^= 1;

  const bounds = items.map((item) => itemBounds(ctx, item, dpmm));
  const inks = items.map((item) => itemInk(ctx, item, dpmm));
  const textLayouts = items.map((item) => (item.type === 'text' ? textLayout(ctx, item, dpmm) : null));
  const surface = { width: W, height: H, data };
  return { bitmap: portrait ? pageToStrip(surface) : surface, length, bounds, inks, textLayouts, dpmm };
}

// Turn a 1-bit bitmap into a canvas, e.g. for preview or PNG export.
export function bitmapToCanvas(bitmap, ink = [0, 0, 0], paper = [255, 255, 255]) {
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(bitmap.width, bitmap.height);
  for (let i = 0; i < bitmap.data.length; i++) {
    const col = bitmap.data[i] ? ink : paper;
    id.data[i * 4] = col[0];
    id.data[i * 4 + 1] = col[1];
    id.data[i * 4 + 2] = col[2];
    id.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}
