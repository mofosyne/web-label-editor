// What the editor shows and prints, in dots: a "view" holding a row of one
// or more label slots (two for 2-up rolls), each with an optional overprint
// border past the label edge onto the liner, and the part of the view the
// printer can actually reach. Pure geometry, so it can be tested in Node.
//
// View coordinates: x along the feed from the label's starting edge, y
// across from the top of the view (the top overprint border, if any, then
// the row of labels). A slot's label starts at (0, slot.y).

import { mediumMargins } from './printers/models.js';

// How the labels of a 2-up row are filled:
//   same      one design, printed on every label of the row (Copies = rows)
//   separate  a design per label (Copies = rows)
//   each      one design, one label at a time (Copies = labels)
export const ROW_MODES = ['same', 'separate', 'each'];

export function rowMode(design, medium) {
  if (!medium.lanes) return 'same';
  const mode = design.options?.rowMode ?? (design.options?.fillRow === false ? 'each' : 'same');
  return ROW_MODES.includes(mode) ? mode : 'same';
}

export const MAX_BLEED_MM = 2;
// Past the end of a die-cut label is the gap before the next one; going
// further would print on the next label.
export const MAX_TRAILING_BLEED_MM = 1.5;

// Overprinting needs a liner around the label to print on, and a head wider
// than the label: DYMO LabelWriter die-cut labels.
export function canOverprint(model, medium) {
  return !!model.overprint && !!medium.lengthDots;
}

// Which slot an item belongs to.
export function itemLane(item, mode, count) {
  if (mode !== 'separate') return 0;
  return Math.min(Math.max(0, item.lane ?? 0), count - 1);
}

// Is the item shown and printed? Items placed on other labels of a 2-up
// row in 'separate' mode are kept but hidden while another mode is chosen;
// on media with one label per row everything shows.
export function itemVisible(item, mode, count = 2) {
  return mode === 'separate' || count === 1 || !(item.lane > 0);
}

// opts: { length (label length, dots), bleed (dots), feed, across (position
// adjustment, dots) }
export function viewGeometry(model, medium, { length, bleed = 0, feed = 0, across = 0 }) {
  const dpmm = model.dpi / 25.4;
  const W = medium.acrossDots;
  const lanes = medium.lanes ?? { count: 1, pitchDots: W, pageDots: W };
  const { count, pitchDots: pitch, pageDots: P } = lanes;
  const skip = model.skipLeadingMargin ? Math.round(mediumMargins(medium).left * dpmm) : 0;
  const b = canOverprint(model, medium) ? Math.max(0, Math.min(bleed, Math.round(MAX_BLEED_MM * dpmm))) : 0;

  // Where the head reaches across the row, in row coordinates (0 = top of
  // the row). A LabelWriter puts the row's bottom edge at head dot 0, so with
  // a head wider than the row the space above the row is reachable too;
  // other printers only print the row itself.
  const reachTop = model.overprint ? P - across - model.headDots : -across;
  const reachBottom = P - across;

  const top = Math.min(b, Math.max(0, -reachTop));
  const bottom = Math.min(b, Math.max(0, reachBottom - P));
  const right = Math.min(b, Math.round(MAX_TRAILING_BLEED_MM * dpmm));
  const width = length + right;
  const height = top + P + bottom;

  const slots = [];
  for (let lane = 0; lane < count; lane++) {
    slots.push({
      lane,
      y: top + lane * pitch,
      // Overprint border drawn around this label: only on the row's outer
      // edges (between 2-up labels is the neighbouring label).
      ext: { top: lane === 0 ? top : 0, bottom: lane === count - 1 ? bottom : 0, right },
    });
  }
  // The part of the view the printer can put ink on. Along the feed the job
  // starts `skip - feed` dots into the label (the LabelWriter never prints
  // its leading margin) and a positive net shift pushes the end out.
  const reach = {
    x0: Math.max(0, skip - feed),
    x1: width - Math.max(0, feed - skip),
    y0: Math.max(0, top + reachTop),
    y1: Math.min(height, top + reachBottom),
  };
  return { width, height, length, labelDots: W, rowDots: P, top, bottom, right, skip, slots, reach, bleed: b };
}

// The job to encode from a rendered view: applies the position adjustment
// and drops what the printer can't reach. For a LabelWriter the job is made
// tall enough for an overprint border above the row (or a negative Across)
// to land past the label's far edge, up to the head width.
export function jobBitmap(view, geo, model, { feed = 0, across = 0, grow = false }) {
  const dx = feed - geo.skip;
  if (!model.overprint) return placeBitmap(view, dx, across, { grow });
  const height = Math.max(1, Math.min(model.headDots, geo.rowDots + geo.top - across));
  const dy = height - geo.rowDots - geo.top + across;
  return placeBitmap(view, dx, dy, { grow, height });
}

// Moves a bitmap's content by (dx, dy) dots into a bitmap `height` rows tall.
//
// Along the feed, a negative dx means the printer starts late, so the print
// is trimmed by |dx| lines: the content moves earlier and the job also ends
// |dx| lines sooner, instead of running past the end of a die-cut label into
// the next one. A positive dx keeps the length (content pushed past the end
// is lost), or with `grow` (continuous media) adds blank lines at the start.
export function placeBitmap(bitmap, dx, dy, { grow = false, height = bitmap.height } = {}) {
  if (!dx && !dy && height === bitmap.height) return bitmap;
  let width = bitmap.width;
  if (dx < 0) width = Math.max(1, bitmap.width + dx);
  else if (grow) width = bitmap.width + dx;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < bitmap.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= height) continue;
    for (let x = 0; x < bitmap.width; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= width) continue;
      data[ty * width + tx] = bitmap.data[y * bitmap.width + x];
    }
  }
  return { width, height, data };
}

// ORs `src` into `dst` with its top-left at (x, y).
export function blit(dst, src, x, y) {
  for (let sy = 0; sy < src.height; sy++) {
    const ty = y + sy;
    if (ty < 0 || ty >= dst.height) continue;
    for (let sx = 0; sx < src.width; sx++) {
      const tx = x + sx;
      if (tx < 0 || tx >= dst.width || !src.data[sy * src.width + sx]) continue;
      dst.data[ty * dst.width + tx] = 1;
    }
  }
  return dst;
}

export function blankBitmap(width, height) {
  return { width, height, data: new Uint8Array(width * height) };
}
