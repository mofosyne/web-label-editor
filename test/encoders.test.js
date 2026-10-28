// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packBits, unpackBits } from '../src/printers/bytes.js';
import { encodeLabelWriter } from '../src/printers/dymo-labelwriter.js';
import { encodePTouch, parseStatus, HEAD_DOTS } from '../src/printers/brother-ptouch.js';

function bitmap(width, height, fn) {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = fn(x, y) ? 1 : 0;
  return { width, height, data };
}

test('packBits round-trips and compresses runs', () => {
  const cases = [
    [],
    [0],
    new Array(16).fill(0),
    [1, 2, 3, 4, 5],
    [1, 1, 2, 3, 3, 3, 4],
    Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff),
    new Array(300).fill(0xaa),
  ];
  for (const c of cases) {
    const src = Uint8Array.from(c);
    assert.deepEqual(unpackBits(packBits(src)), src);
  }
  assert.deepEqual(packBits(new Uint8Array(16)), Uint8Array.of(0xf1, 0x00));
});

test('LabelWriter: header, one raster line per column, trailer', () => {
  const bmp = bitmap(3, 16, (x, y) => x === 1 && y === 15);
  const out = encodeLabelWriter(bmp, { continuous: true });
  let i = 0;
  for (; i < 156; i++) assert.equal(out[i], 0x1b);
  const expectHeader = [
    0x1b, 0x51, 0, 0, // ESC Q
    0x1b, 0x42, 0, // ESC B
    0x1b, 0x68, // ESC h
    0x1b, 0x65, // ESC e (normal)
    0x1b, 0x4c, 0xff, 0xff, // ESC L continuous
    0x1b, 0x44, 2, // ESC D 2 bytes per line
  ];
  assert.deepEqual([...out.subarray(i, i + expectHeader.length)], expectHeader);
  i += expectHeader.length;
  assert.deepEqual([...out.subarray(i, i + 9)], [0x16, 0, 0, 0x16, 0x80, 0, 0x16, 0, 0]);
  i += 9;
  assert.deepEqual([...out.subarray(i)], [0x1b, 0x47, 0x1b, 0x45]);
});

test('LabelWriter: die-cut length and darkness', () => {
  const bmp = bitmap(300, 8, () => false);
  const out = encodeLabelWriter(bmp, { continuous: false, density: 'dark' });
  const at = 156 + 7;
  assert.deepEqual([...out.subarray(at, at + 8)], [0x1b, 0x68, 0x1b, 0x67, 0x1b, 0x4c, 0x01, 0x2c]);
});

test('LabelWriter: clips to the 672-dot head', () => {
  const bmp = bitmap(1, 700, () => true);
  const out = encodeLabelWriter(bmp);
  const dIdx = out.indexOf(0x44, 156) ;
  assert.equal(out[dIdx + 1], 84);
});

// Reference mapping from ptouch-print (print_img + rasterline_setpixel):
// offset = max/2 - SY/2; pixel = offset + i for image row SY-1-i;
// rasterline[(size-1) - pixel/8] |= 1 << (pixel % 8).
function ptouchReferenceLine(bmp, x) {
  const line = new Uint8Array(HEAD_DOTS / 8);
  const offset = HEAD_DOTS / 2 - Math.floor(bmp.height / 2);
  for (let i = 0; i < bmp.height; i++) {
    if (bmp.data[(bmp.height - 1 - i) * bmp.width + x]) {
      const p = offset + i;
      line[line.length - 1 - (p >> 3)] |= 1 << (p % 8);
    }
  }
  return line;
}

function decodePTouchLines(out) {
  const lines = [];
  let i = 102 + 2 + 4 + 4; // init, M 02, ESC i R, ESC i M
  while (out[i] === 0x47) {
    const n = out[i + 1] | (out[i + 2] << 8);
    lines.push(unpackBits(out.subarray(i + 3, i + 3 + n)));
    i += 3 + n;
  }
  return { lines, rest: [...out.subarray(i)] };
}

test('P-touch: command sequence', () => {
  const out = encodePTouch(bitmap(2, 76, () => false), { autoCut: true });
  assert.ok(out.subarray(0, 100).every((b) => b === 0));
  assert.deepEqual([...out.subarray(100, 112)], [0x1b, 0x40, 0x4d, 0x02, 0x1b, 0x69, 0x52, 0x01, 0x1b, 0x69, 0x4d, 0x40]);
  const { lines, rest } = decodePTouchLines(out);
  assert.equal(lines.length, 2);
  assert.deepEqual(rest, [0x1a]);
  assert.equal(encodePTouch(bitmap(1, 76, () => false), { autoCut: false })[111], 0x00);
});

test('P-touch: raster lines match ptouch-print pixel mapping', () => {
  for (const height of [24, 32, 52, 76, 120, 128]) {
    const bmp = bitmap(9, height, (x, y) => (x * 31 + y * 17) % 5 === 0 || y === 0 || x === y);
    const { lines } = decodePTouchLines(encodePTouch(bmp));
    for (let x = 0; x < bmp.width; x++) {
      assert.deepEqual(lines[x], ptouchReferenceLine(bmp, x), `height ${height}, column ${x}`);
    }
  }
});

test('P-touch: status parsing', () => {
  const buf = new Uint8Array(32);
  buf[0] = 0x80;
  buf[1] = 0x20;
  buf[10] = 12;
  buf[11] = 0x01;
  buf[9] = 0x10;
  const s = parseStatus(buf);
  assert.equal(s.tapeMm, 12);
  assert.deepEqual(s.errors, ['Cover open']);
  assert.equal(parseStatus(new Uint8Array(10)), null);
});

test('P-touch: status reports tape type and colours', () => {
  const buf = new Uint8Array(32);
  buf[0] = 0x80;
  buf[1] = 0x20;
  buf[10] = 12;
  buf[11] = 0x01;
  buf[24] = 0x06;
  buf[25] = 0x08;
  const s = parseStatus(buf);
  assert.equal(s.mediaType.name, 'Laminated tape');
  assert.deepEqual([s.tapeColor.name, s.tapeColor.hex], ['Yellow', '#f6d32b']);
  assert.equal(s.textColor.name, 'Black');
  assert.deepEqual(s.errors, []);

  buf[11] = 0x17;
  assert.equal(parseStatus(buf).warnings.length, 1);
  buf[24] = 0xf0;
  assert.deepEqual(parseStatus(buf).errors, ['Cleaning tape loaded']);
  buf[11] = 0xff;
  assert.ok(parseStatus(buf).errors.includes('Incompatible tape'));
});

test('shiftBitmap moves content and can grow continuous strips', async () => {
  const { shiftBitmap } = await import('../src/calibration.js');
  const src = bitmap(4, 3, (x, y) => x === 0 && y === 0);
  const right = shiftBitmap(src, 2, 1);
  assert.equal(right.width, 4);
  assert.equal(right.data[1 * 4 + 2], 1);
  assert.equal(right.data.reduce((a, b) => a + b), 1);
  const lost = shiftBitmap(src, -1, 0);
  assert.equal(lost.data.reduce((a, b) => a + b), 0, 'pushed past the start');
  assert.equal(lost.width, 3, 'a late-starting printer gets a shorter job, so it ends at the label end');
  const early = shiftBitmap(bitmap(4, 1, (x) => x === 2), -2, 0);
  assert.deepEqual([...early.data], [1, 0]);
  const grown = shiftBitmap(src, 3, 0, { grow: true });
  assert.equal(grown.width, 7);
  assert.equal(grown.data[3], 1);
  assert.equal(shiftBitmap(src, 0, 0), src);
});

test('test patterns: numbered grid and full black', async () => {
  const { testPatternDesign } = await import('../src/calibration.js');
  const dpmm = 300 / 25.4;
  const grid = testPatternDesign('grid', 88.9, 27.86, dpmm);
  assert.equal(grid.length.mm, 88.9);
  const lines = grid.items.filter((it) => it.type === 'box');
  assert.equal(lines.filter((it) => it.h === 27.86).length, 89, 'a line every mm along the feed');
  assert.equal(lines.filter((it) => it.w === 88.9).length, 28, 'a line every mm across');
  const numbers = grid.items.filter((it) => it.type === 'text').map((it) => it.text);
  assert.ok(numbers.includes('0') && numbers.includes('85') && numbers.includes('25'));
  assert.equal(new Set(grid.items.map((it) => it.id)).size, grid.items.length);
  const black = testPatternDesign('black', 60, 54, dpmm);
  assert.deepEqual(black.items.map((it) => [it.x, it.y, it.w, it.h, it.fill]), [[0, 0, 60, 54, true]]);
});

test('P-touch quirks: E310BT-style models (ptouch-print FLAG_P700_INIT|USE_INFO_CMD|D460BT_MAGIC)', () => {
  const bmp = bitmap(3, 76, (x, y) => x === 1 && y === 0);
  const out = encodePTouch(bmp, {
    tapeMm: 12, quirks: { packbits: false, p700Init: true, infoCmd: true, precut: false, magic: true },
  });
  let i = 102;
  const take = (n) => [...out.subarray(i, (i += n))];
  assert.deepEqual(take(4), [0x1b, 0x69, 0x61, 0x01], 'ESC i a 01 (no M 02)');
  assert.deepEqual(take(13), [0x1b, 0x69, 0x7a, 0, 0, 12, 0, 3, 0, 0, 0, 0x02, 0], 'ESC i z with width, lines, feed');
  assert.deepEqual(take(7), [0x1b, 0x69, 0x64, 0x01, 0x00, 0x4d, 0x00], 'ESC i d magic');
  // Raw raster lines: G 16 00 + 16 bytes, no ESC i M before them.
  assert.deepEqual(take(3), [0x47, 16, 0]);
  i += 16;
  assert.deepEqual(take(3), [0x47, 16, 0]);
  const line = take(16);
  assert.equal(line[(64 - 38) >> 3], 0x80 >> ((64 - 38) & 7), 'top row on dot 26');
  i += 19;
  assert.deepEqual(take(1), [0x1a]);
  assert.equal(i, out.length);
});

test('P-touch: blank tail lines after the content', () => {
  const { lines, rest } = decodePTouchLines(encodePTouch(bitmap(3, 76, () => true), { tailDots: 4 }));
  assert.equal(lines.length, 7);
  assert.ok(lines.slice(0, 3).every((l) => l.some((v) => v)));
  assert.ok(lines.slice(3).every((l) => l.length === 16 && l.every((v) => !v)));
  assert.deepEqual(rest, [0x1a]);
});

test('P-touch: copies as pages of one job; half cut on models with a half cutter', () => {
  const page = bitmap(2, 76, () => false);
  // PT-P710BT: FF between pages, Control-Z after the last, settings per page.
  const three = encodePTouch([page, page, page], { autoCut: true });
  // Each extra page: ESC i M (4), two blank lines (G n1 n2 + 2 PackBits bytes each), FF (1).
  assert.equal(three.length - encodePTouch(page, { autoCut: true }).length, 2 * (4 + 2 * (3 + 2) + 1));
  assert.deepEqual([...three].filter((b, i, a) => a[i - 1] !== 0x47 && a[i - 2] !== 0x47 && (b === 0x0c || b === 0x1a)), [0x0c, 0x0c, 0x1a]);
  // PT-P750W with half cut: ESC i M 40, ESC i A 01, ESC i K 0C on every page.
  const half = encodePTouch([page, page], { autoCut: true, halfCut: true, quirks: { p700Init: true, precut: false, halfCut: true } });
  const find = (out, seq) => {
    let n = 0;
    for (let i = 0; i < out.length; i++) if (seq.every((v, k) => out[i + k] === v)) n++;
    return n;
  };
  assert.equal(find(half, [0x1b, 0x69, 0x4d, 0x40]), 2);
  assert.equal(find(half, [0x1b, 0x69, 0x41, 0x01]), 2);
  assert.equal(find(half, [0x1b, 0x69, 0x4b, 0x0c]), 2);
  const full = encodePTouch([page], { autoCut: true, halfCut: false, quirks: { halfCut: true } });
  assert.equal(find(full, [0x1b, 0x69, 0x4b, 0x08]), 1, 'no half cut: just feed and cut after the last');
  // Without the advanced quirk no ESC i K is sent, and never ESC i A without a half cutter.
  assert.equal(find(three, [0x1b, 0x69, 0x4b]), 0);
  assert.equal(find(three, [0x1b, 0x69, 0x41]), 0);
  // PT-P710BT (advanced): ESC i K 08 normally, 00 with chain printing; still no ESC i A.
  const p710 = { advanced: true };
  assert.equal(find(encodePTouch([page], { quirks: p710 }), [0x1b, 0x69, 0x4b, 0x08]), 1);
  const chained = encodePTouch([page, page], { chain: true, quirks: p710 });
  assert.equal(find(chained, [0x1b, 0x69, 0x4b, 0x00]), 2);
  assert.equal(find(chained, [0x1b, 0x69, 0x41]), 0);
});

test('LabelWriter SE450: the 450 raster stream without ESC h or ESC G', async () => {
  const { encodeLabelWriter } = await import('../src/printers/dymo-labelwriter.js');
  const bmp = bitmap(3, 448, (x, y) => y === 0);
  const lw = encodeLabelWriter(bmp, { headDots: 672, continuous: false });
  const se = encodeLabelWriter(bmp, { headDots: 448, continuous: false, se450: true });
  const has = (out, a, b) => [...out].some((v, i) => v === a && out[i + 1] === b);
  assert.ok(has(lw, 0x1b, 0x68) && has(lw, 0x1b, 0x47));
  assert.ok(!has(se, 0x1b, 0x68) && !has(se, 0x1b, 0x47));
  assert.deepEqual([...se.subarray(-2)], [0x1b, 0x45], 'ends with ESC E form feed');
  // 448 dots = 56 bytes per line (ESC D 56).
  assert.ok([...se].some((v, i) => v === 0x1b && se[i + 1] === 0x44 && se[i + 2] === 56));
});

test('LabelWriter: ESC i (300 x 600 dpi) instead of ESC h when high resolution; never on the SE450', () => {
  const has = (out, a, b) => out.some((v, i) => v === a && out[i + 1] === b);
  const bmp = bitmap(4, 8, () => false);
  const hi = encodeLabelWriter(bmp, { highRes: true });
  assert.ok(has(hi, 0x1b, 0x69) && !has(hi, 0x1b, 0x68));
  const std = encodeLabelWriter(bmp, {});
  assert.ok(has(std, 0x1b, 0x68) && !has(std, 0x1b, 0x69));
  const se = encodeLabelWriter(bmp, { highRes: true, se450: true });
  assert.ok(!has(se, 0x1b, 0x69) && !has(se, 0x1b, 0x68));
});
