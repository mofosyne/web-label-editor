// Renders a design into a 1-bit "strip" bitmap at the printer's resolution.
// Strip coordinates: x runs along the label length, y across the tape/head.
// Design units are millimetres; (0,0) is the top-left of the printable area.

const imageCache = new Map();

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

function textMetrics(ctx, item, dpmm) {
  const px = Math.max(1, item.size * dpmm);
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

// Item bounds in dots, relative to the printable strip.
export function itemBounds(ctx, item, dpmm) {
  const x = item.x * dpmm;
  const y = item.y * dpmm;
  if (item.type === 'text') {
    const m = textMetrics(ctx, item, dpmm);
    return { x, y, w: m.w, h: m.h };
  }
  if (item.type === 'image') {
    const img = loadImage(item.src);
    const w = item.w * dpmm;
    const aspect = img ? img.naturalHeight / img.naturalWidth : 1;
    return { x, y, w, h: w * aspect };
  }
  if (item.type === 'box') {
    return { x, y, w: item.w * dpmm, h: item.h * dpmm };
  }
  return { x, y, w: 0, h: 0 };
}

function drawText(ctx, item, dpmm) {
  const m = textMetrics(ctx, item, dpmm);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  m.lines.forEach((line, i) => {
    let dx = 0;
    if (item.align === 'center') dx = (m.w - m.widths[i]) / 2;
    else if (item.align === 'right') dx = m.w - m.widths[i];
    ctx.fillText(line, item.x * dpmm + dx, item.y * dpmm + i * m.lineH + m.ascent);
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

function drawBox(ctx, item, dpmm) {
  const x = item.x * dpmm;
  const y = item.y * dpmm;
  const w = item.w * dpmm;
  const h = item.h * dpmm;
  ctx.fillStyle = '#000';
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
export function stripLength(design, medium, dpi, ctx) {
  const dpmm = dpi / 25.4;
  if (medium.lengthDots) return medium.lengthDots;
  if (design.length.mode === 'fixed') return Math.max(1, Math.round(design.length.mm * dpmm));
  let right = 0;
  for (const item of design.items) {
    const b = itemBounds(ctx, item, dpmm);
    right = Math.max(right, b.x + b.w);
  }
  return Math.max(Math.round(5 * dpmm), Math.round(right + design.length.padMm * dpmm));
}

export function renderDesign(design, model, medium, onAssetLoad) {
  const dpi = model.dpi;
  const dpmm = dpi / 25.4;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const width = stripLength(design, medium, dpi, ctx);
  const height = medium.acrossDots;
  canvas.width = width;
  canvas.height = height;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  for (const item of design.items) {
    if (item.type === 'text') drawText(ctx, item, dpmm);
    else if (item.type === 'image') drawImage(ctx, item, dpmm, onAssetLoad);
    else if (item.type === 'box') drawBox(ctx, item, dpmm);
  }
  if (design.border) drawBox(ctx, { x: 0, y: 0, w: width / dpmm, h: height / dpmm, stroke: 0.4 }, dpmm);

  const id = ctx.getImageData(0, 0, width, height);
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    const p = i * 4;
    const l = 0.299 * id.data[p] + 0.587 * id.data[p + 1] + 0.114 * id.data[p + 2];
    data[i] = l < 128 ? 1 : 0;
  }
  if (design.invert) for (let i = 0; i < data.length; i++) data[i] ^= 1;

  const bounds = design.items.map((item) => itemBounds(ctx, item, dpmm));
  return { bitmap: { width, height, data }, bounds, dpmm };
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
