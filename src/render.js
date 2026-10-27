// Renders a design into a 1-bit "strip" bitmap at the printer's resolution.
// Strip coordinates: x runs along the label length, y across the tape/head.
// Design units are millimetres; (0,0) is the top-left of the printable area.

import { encodeQr } from './codes/qr.js';
import { SYMBOLOGIES } from './codes/barcode.js';

const imageCache = new Map();
const codeCache = new Map();

// Encodes a QR or barcode item, caching by content. Returns { code } or { error }.
export function encodeItem(item) {
  const key = item.type === 'qr'
    ? `qr|${item.ecc}|${item.data}`
    : `bc|${item.symbology}|${item.data}`;
  if (!codeCache.has(key)) {
    try {
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
function codeLayout(ctx, item, dpmm) {
  const { code, error } = encodeItem(item);
  const x = Math.round(item.x * dpmm);
  const y = Math.round(item.y * dpmm);
  if (error) return { x, y, w: Math.round(5 * dpmm), h: Math.round(5 * dpmm), error };
  if (item.type === 'qr') {
    const m = Math.max(1, Math.floor((item.size * dpmm) / code.size));
    return { x, y, w: code.size * m, h: code.size * m, m, code };
  }
  const m = Math.max(1, Math.round(item.module * dpmm));
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

// Where a text item's lines go, in dots. Normal text is sized by item.size
// and its box hugs the text. With item.fit the box is fixed (item.w × item.h
// mm) and the largest size that fits is used, centred vertically and aligned
// horizontally in the box.
export function textLayout(ctx, item, dpmm) {
  const x = item.x * dpmm;
  const y = item.y * dpmm;
  if (!item.fit) {
    const m = textMetrics(ctx, item, dpmm);
    return { ...m, sizeMm: item.size, box: { x, y, w: m.w, h: m.h }, blockX: x, blockY: y };
  }
  const boxW = Math.max(1, item.w * dpmm);
  const boxH = Math.max(1, item.h * dpmm);
  const ref = textMetrics(ctx, item, dpmm, 10);
  const sizeMm = Math.max(0.3, 10 * Math.min(boxW / ref.w, boxH / ref.h) * 0.99);
  const m = textMetrics(ctx, item, dpmm, sizeMm);
  let blockX = x;
  if (item.align === 'center') blockX = x + (boxW - m.w) / 2;
  else if (item.align === 'right') blockX = x + boxW - m.w;
  return { ...m, sizeMm, box: { x, y, w: boxW, h: boxH }, blockX, blockY: y + (boxH - m.h) / 2 };
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
  if (item.type === 'qr' || item.type === 'barcode') {
    const l = codeLayout(ctx, item, dpmm);
    return { x: l.x, y: l.y, w: l.w, h: l.h };
  }
  return { x, y, w: 0, h: 0 };
}

function drawText(ctx, item, dpmm) {
  const m = textLayout(ctx, item, dpmm);
  ctx.font = fontString(item, m.px);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  m.lines.forEach((line, i) => {
    let dx = 0;
    if (item.align === 'center') dx = (m.w - m.widths[i]) / 2;
    else if (item.align === 'right') dx = m.w - m.widths[i];
    ctx.fillText(line, m.blockX + dx, m.blockY + i * m.lineH + m.ascent);
  });
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

function drawCode(ctx, item, dpmm) {
  const l = codeLayout(ctx, item, dpmm);
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

function drawBox(ctx, item, dpmm) {
  const x = item.x * dpmm;
  const y = item.y * dpmm;
  const w = item.w * dpmm;
  const h = item.h * dpmm;
  ctx.fillStyle = item.white ? '#fff' : '#000';
  if (item.fill) {
    ctx.fillRect(x, y, w, h);
    return;
  }
  const t = Math.max(1, (item.stroke ?? 0.3) * dpmm);
  ctx.fillRect(x, y, w, t);
  ctx.fillRect(x, y + h - t, w, t);
  ctx.fillRect(x, y, t, h);
  ctx.fillRect(x + w - t, y, t, h);
}

// Length of the strip in dots: fixed for die-cut media, otherwise either the
// user's fixed length or the furthest item edge plus padding.
export function stripLength(design, medium, dpi, ctx, items = design.items) {
  const dpmm = dpi / 25.4;
  if (medium.lengthDots) return medium.lengthDots;
  if (design.length.mode === 'fixed') return Math.max(1, Math.round(design.length.mm * dpmm));
  let right = 0;
  for (const item of items) {
    const b = itemBounds(ctx, item, dpmm);
    right = Math.max(right, b.x + b.w);
  }
  return Math.max(Math.round(5 * dpmm), Math.round(right + design.length.padMm * dpmm));
}

// Renders one label. opts.items: the items to draw (default all);
// opts.length: the strip length in dots (default from stripLength);
// opts.ext: { top, bottom, right } dots of overprint border past the label
// edge, rendered too (the bitmap grows by them; the label starts at
// (0, ext.top)). Bounds and text layouts are relative to the label.
export function renderDesign(design, model, medium, onAssetLoad, opts = {}) {
  const dpi = model.dpi;
  const dpmm = dpi / 25.4;
  const items = opts.items ?? design.items;
  const ext = { top: 0, bottom: 0, right: 0, ...opts.ext };
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const length = opts.length ?? stripLength(design, medium, dpi, ctx, items);
  const across = medium.acrossDots;
  const width = length + ext.right;
  const height = ext.top + across + ext.bottom;
  canvas.width = width;
  canvas.height = height;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.translate(0, ext.top);
  for (const item of items) {
    if (item.type === 'text') drawText(ctx, item, dpmm);
    else if (item.type === 'image') drawImage(ctx, item, dpmm, onAssetLoad);
    else if (item.type === 'box') drawBox(ctx, item, dpmm);
    else if (item.type === 'qr' || item.type === 'barcode') drawCode(ctx, item, dpmm);
  }
  if (design.border) drawBox(ctx, { x: 0, y: 0, w: length / dpmm, h: across / dpmm, stroke: 0.4 }, dpmm);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const id = ctx.getImageData(0, 0, width, height);
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    const p = i * 4;
    const l = 0.299 * id.data[p] + 0.587 * id.data[p + 1] + 0.114 * id.data[p + 2];
    data[i] = l < 128 ? 1 : 0;
  }
  // Inverting covers the overprint border too: black right to the edge.
  if (design.invert) for (let i = 0; i < data.length; i++) data[i] ^= 1;

  const bounds = items.map((item) => itemBounds(ctx, item, dpmm));
  const textLayouts = items.map((item) => (item.type === 'text' ? textLayout(ctx, item, dpmm) : null));
  return { bitmap: { width, height, data }, length, bounds, textLayouts, dpmm };
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
