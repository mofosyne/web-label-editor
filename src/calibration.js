// Hardware test prints, used to see where a printer actually puts ink on a
// label and to measure the position adjustment.
//
// Grid: lines every 1 mm (heavier every 5 mm), numbered in mm from where
// the label should start. Each numbered line should sit that many mm from
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

// A number on a white patch so grid lines don't run through it.
function number(n, x, y) {
  const w = String(n).length * 1.1 + 0.4;
  return [
    { type: 'box', x: x - 0.2, y: y - 0.2, w: w + 0.4, h: NUM_MM + 0.4, fill: true, white: true },
    {
      type: 'text', text: String(n), font: 'sans-serif', bold: true, italic: false, align: 'left',
      fit: true, x, y, w, h: NUM_MM,
    },
  ];
}

// A lengthMm × widthMm design for the given pattern ('grid' or 'black').
// dpmm sets line widths in whole dots.
export function testPatternDesign(pattern, lengthMm, widthMm, dpmm, { printer, medium } = {}) {
  const items = [];
  if (pattern === 'black') {
    items.push(rect(0, 0, lengthMm, widthMm));
  } else {
    const thin = 1 / dpmm;
    const thick = 3 / dpmm;
    for (let x = 0; x <= lengthMm; x++) items.push(rect(x, 0, x % 5 ? thin : thick, widthMm));
    for (let y = 0; y <= widthMm; y++) items.push(rect(0, y, lengthMm, y % 5 ? thin : thick));
    // Feed numbers along the top row; across numbers down a middle column.
    for (let x = 0; x + 3 < lengthMm; x += 5) items.push(...number(x, x + 0.5, 1.5));
    const col = Math.max(0, Math.floor(lengthMm / 10) * 5) + 2.5;
    for (let y = 5; y + NUM_MM < widthMm; y += 5) items.push(...number(y, col, y + 0.5));
  }
  items.forEach((it, n) => { it.id = `test${n}`; });
  return {
    version: 1,
    printer,
    medium,
    options: {},
    length: { mode: 'fixed', mm: lengthMm, padMm: 0 },
    border: false,
    invert: false,
    items,
  };
}

// Moves a bitmap's content by (dx, dy) dots for the position adjustment.
//
// Along the feed, a negative dx means the printer starts late, so the print
// is trimmed by |dx| lines: the content moves earlier and the job also ends
// |dx| lines sooner, instead of running past the end of a die-cut label into
// the next one. A positive dx keeps the length (content pushed past the end
// is lost), or with `grow` (continuous media) adds blank lines at the start.
// Across the head the size never changes.
export function shiftBitmap(bitmap, dx, dy, { grow = false } = {}) {
  if (!dx && !dy) return bitmap;
  let width = bitmap.width;
  if (dx < 0) width = Math.max(1, bitmap.width + dx);
  else if (grow) width = bitmap.width + dx;
  const { height } = bitmap;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
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
