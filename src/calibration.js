// SPDX-License-Identifier: GPL-3.0-or-later
// Hardware test prints, used to see where a printer actually puts ink on a
// label and to measure the position adjustment.
//
// Grid: lines every 1 mm (heavier every 5 mm), numbered in mm from where
// the label should start. X runs along the feed from the end that comes out
// of the printer first (the strip's right end on printers with leadingEnd
// 'end', e.g. Brother QL); Y runs across from the top edge. "X→" and "Y↓"
// on the print name the axes, as the Feed X / Across Y settings do. Each numbered line should sit that many mm from
// the label's starting edge (the end that comes out first): if line n is at
// n + d mm the print is late and Feed should be -d; at n - d, +d. The top
// edge gives Across the same way. Lines in the unprintable margin are
// missing by design.
//
// Full black: every dot on. Shows exactly what part of the label the
// printer can reach.

const NUM_MM = 1.6; // number height, mm

function rect(x, y, w, h) {
  return { type: 'box', x, y, w, h, fill: true };
}

// Text on a white patch so grid lines don't run through it; `x` is its left
// edge, or with `right` its right edge.
function tag(text, x, y, { right = false, h = NUM_MM } = {}) {
  // Arrows are wider than digits.
  const w = ([...String(text)].reduce((sum, ch) => sum + (/[←→↓↑]/.test(ch) ? 1.8 : 1.1), 0) + 0.4) * (h / NUM_MM);
  const left = right ? x - w : x;
  return [
    { type: 'box', x: left - 0.2, y: y - 0.2, w: w + 0.4, h: h + 0.4, fill: true, white: true },
    {
      type: 'text', text: String(text), font: 'sans-serif', bold: true, italic: false, align: 'left',
      fit: true, x: left, y, w, h,
    },
  ];
}

// A lengthMm × widthMm design for the given pattern ('grid' or 'black').
// dpmm sets line widths in whole dots.
export function testPatternDesign(pattern, lengthMm, widthMm, dpmm, { printer, medium, leadingAtEnd = false } = {}) {
  const items = [];
  if (pattern === 'black') {
    items.push(rect(0, 0, lengthMm, widthMm));
  } else {
    const thin = 1 / dpmm;
    const thick = 3 / dpmm;
    // Strip position of X = v mm, counted from the leading end.
    const xAt = (v) => (leadingAtEnd ? lengthMm - v : v);
    for (let x = 0; x <= lengthMm; x++) items.push(rect(xAt(x), 0, x % 5 ? thin : thick, widthMm));
    for (let y = 0; y <= widthMm; y++) items.push(rect(0, y, lengthMm, y % 5 ? thin : thick));
    // X numbers along the top row, on the far side of each line from the
    // leading end; Y numbers down a middle column.
    for (let x = 0; x + 3 < lengthMm; x += 5) items.push(...tag(x, xAt(x) + (leadingAtEnd ? -0.5 : 0.5), 1.5, { right: leadingAtEnd }));
    const col = Math.max(0, Math.floor(lengthMm / 10) * 5) + 2.5;
    for (let y = 5; y + NUM_MM < widthMm; y += 5) items.push(...tag(y, col, y + 0.5));
    // Axis names, where there is room: X by the leading end (its arrow
    // pointing the way X grows), Y beside the first Y number.
    // Larger than the numbers, so the arrows' thin strokes survive printing.
    const AXIS_MM = 2.4;
    if (widthMm >= 9) items.push(...tag(leadingAtEnd ? '←X' : 'X→', xAt(0.5), 1.5 + NUM_MM + 1, { right: leadingAtEnd, h: AXIS_MM }));
    if (widthMm >= 9 && col + 10 < lengthMm) items.push(...tag('Y↓', col + 3.5, 5.1, { h: AXIS_MM }));
  }
  items.forEach((it, n) => { it.id = `test${n}`; });
  return {
    version: 1,
    printer,
    medium,
    options: {},
    length: { mode: 'fixed', mm: lengthMm, padMm: 0 },
    invert: false,
    items,
  };
}

// Position shifts live with the rest of the print layout.
export { placeBitmap as shiftBitmap } from './layout.js';
