import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewGeometry, jobBitmap, rowMode, itemLane, itemVisible } from '../src/layout.js';

// A LabelWriter 450 with a 28 mm die-cut label (330 dots), 6 mm leading
// margin (71 dots at 300 dpi), and a P-touch-like printer without overprint.
const lw = { dpi: 300, headDots: 672, skipLeadingMargin: true, overprint: true };
const label = { acrossDots: 330, lengthDots: 1050, margins: { left: 6, right: 1.5, top: 1, bottom: 1.5 } };
const twoUp = { acrossDots: 150, lengthDots: 300, lanes: { count: 2, pitchDots: 150, pageDots: 300 }, margins: { left: 2.37, right: 1.5, top: 1, bottom: 1.4 } };
const pt = { dpi: 180, headDots: 128 };
const tape = { acrossDots: 76 };

test('view without overprint is the label, reach starts after the leading margin', () => {
  const g = viewGeometry(lw, label, { length: 1050 });
  assert.equal(g.width, 1050);
  assert.equal(g.height, 330);
  assert.equal(g.skip, 71);
  assert.deepEqual(g.reach, { x0: 71, x1: 1050, y0: 0, y1: 330 });
  assert.deepEqual(g.slots, [{ lane: 0, y: 0, ext: { top: 0, bottom: 0, right: 0 } }]);
});

test('overprint border: past the far edge and the end, not the guide side', () => {
  const g = viewGeometry(lw, label, { length: 1050, bleed: 12 });
  assert.equal(g.top, 12);
  assert.equal(g.bottom, 0); // the label's bottom edge is at head dot 0
  assert.equal(g.right, 12);
  assert.equal(g.height, 342);
  assert.deepEqual(g.slots[0], { lane: 0, y: 12, ext: { top: 12, bottom: 0, right: 12 } });
  assert.deepEqual(g.reach, { x0: 71, x1: 1062, y0: 0, y1: 342 });
  // Shifted towards the guide by Across, the bottom edge gets room too.
  assert.equal(viewGeometry(lw, label, { length: 1050, bleed: 12, across: -5 }).bottom, 5);
  // Overprinting is capped (2 mm, trailing 1.5 mm).
  const big = viewGeometry(lw, label, { length: 1050, bleed: 500 });
  assert.equal(big.top, 24);
  assert.equal(big.right, 18);
});

test('2-up rows: overprint only on the outer edges', () => {
  const g = viewGeometry(lw, twoUp, { length: 300, bleed: 12 });
  assert.deepEqual(g.slots.map((s) => [s.y, s.ext.top, s.ext.bottom]), [[12, 12, 0], [162, 0, 0]]);
  assert.equal(g.height, 312);
});

test('printers without overprint keep the label and the old position limits', () => {
  const g = viewGeometry(pt, tape, { length: 400, bleed: 12, feed: -9, across: 3 });
  assert.equal(g.height, 76);
  assert.equal(g.width, 400);
  assert.deepEqual(g.reach, { x0: 9, x1: 400, y0: 0, y1: 73 });
});

const bmp = (w, h, f) => {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y) ? 1 : 0;
  return { width: w, height: h, data };
};

test('jobBitmap: trims the leading margin and keeps the label height', () => {
  const geo = viewGeometry(lw, label, { length: 1050 });
  const job = jobBitmap(bmp(1050, 330, (x, y) => x === 100 && y === 0), geo, lw, {});
  assert.equal(job.width, 1050 - 71);
  assert.equal(job.height, 330);
  assert.equal(job.data[29], 1);
});

test('jobBitmap: an overprint border above the row lands past the label', () => {
  const geo = viewGeometry(lw, label, { length: 1050, bleed: 12 });
  const view = bmp(1062, 342, (x, y) => x === 200 && (y === 0 || y === 12));
  const job = jobBitmap(view, geo, lw, {});
  assert.equal(job.height, 342);
  assert.equal(job.width, 1062 - 71);
  // Row 12 (the label's top edge) stays 330 rows above the bottom edge.
  assert.equal(job.data[12 * job.width + 129], 1);
  assert.equal(job.data[129], 1);
  // Across -5 moves everything 5 dots away from head dot 0: the job grows.
  const up = jobBitmap(bmp(1050, 330, (x, y) => x === 100 && y === 329), viewGeometry(lw, label, { length: 1050 }), lw, { across: -5 });
  assert.equal(up.height, 335);
  assert.equal(up.data[329 * up.width + 29], 1);
});

test('row modes and lanes', () => {
  assert.equal(rowMode({ options: {} }, label), 'same');
  assert.equal(rowMode({ options: { rowMode: 'separate' } }, label), 'same');
  assert.equal(rowMode({ options: { rowMode: 'separate' } }, twoUp), 'separate');
  assert.equal(rowMode({ options: { fillRow: false } }, twoUp), 'each');
  assert.equal(itemLane({ lane: 5 }, 'separate', 2), 1);
  assert.equal(itemLane({ lane: 1 }, 'same', 2), 0);
  assert.equal(itemVisible({ lane: 1 }, 'same'), false);
  assert.equal(itemVisible({}, 'same'), true);
  assert.equal(itemVisible({ lane: 1 }, 'same', 1), true);
});

test('portrait pages turn into strips and back', async () => {
  const { pageToStrip, stripToPage, stripRectToPage } = await import('../src/layout.js');
  // A 3 wide × 5 tall page with one dot at page (0, 1): left edge, near the top.
  const page = bmp(3, 5, (x, y) => x === 0 && y === 1);
  const strip = pageToStrip(page);
  assert.equal(strip.width, 5);
  assert.equal(strip.height, 3);
  // Page left = strip top row; page top = strip end (the leading edge,
  // strip x = 0, is the page's bottom).
  assert.equal(strip.data[0 * 5 + 3], 1);
  assert.deepEqual(stripToPage(strip), page);
  assert.deepEqual(stripRectToPage({ x: 3, y: 0, w: 1, h: 1 }, 5), { x: 0, y: 1, w: 1, h: 1 });
});

test('Brother media: hatched edges outside the printable band, and the job is the band', () => {
  const pt = { dpi: 180, headDots: 128 };
  const tape12 = { acrossDots: 85, band: { y: 4, h: 76 } };
  const g = viewGeometry(pt, tape12, { length: 100 });
  assert.deepEqual([g.reach.y0, g.reach.y1], [4, 80]);
  const job = jobBitmap(bmp(100, 85, (x, y) => x === 10 && (y === 4 || y === 2)), g, pt, {});
  assert.deepEqual([job.width, job.height], [100, 76]);
  assert.equal(job.data[0 * 100 + 10], 1, 'band row 0 = label row 4');
  assert.equal(job.data.reduce((a, b) => a + b, 0), 1, 'row 2 is outside the band and dropped');
  // Across +2 moves content 2 dots down: the reachable band moves up.
  assert.deepEqual([viewGeometry(pt, tape12, { length: 100, across: 2 }).reach.y0], [2]);

  const ql = { dpi: 300, headDots: 720 };
  const dk = { acrossDots: 343, lengthDots: 1063, band: { y: 18, h: 306, x: 36, w: 991 } };
  const gd = viewGeometry(ql, dk, { length: 1063 });
  assert.deepEqual(gd.reach, { x0: 36, x1: 1027, y0: 18, y1: 324 });
  const dj = jobBitmap(bmp(1063, 343, (x, y) => x === 36 && y === 18), gd, ql, {});
  assert.deepEqual([dj.width, dj.height, dj.data[0]], [991, 306, 1]);
});
