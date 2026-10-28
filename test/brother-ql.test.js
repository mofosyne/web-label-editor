// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQL, qlParams, qlRows, parseQLStatus } from '../src/printers/brother-ql.js';

function bitmap(width, height, fn) {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = fn(x, y) ? 1 : 0;
  return { width, height, data };
}

// brother_ql's pipeline for a landscape image, step by step: rotate 90°
// counter-clockwise (PIL rotate(90, expand=True)), paste into a row as wide
// as the head at x = head - width - right margin, flip left-right, then pack
// each row MSB first.
function referenceRows(bmp, medium, params) {
  const W = bmp.height; // rotated width (across)
  const H = bmp.width; // rotated height (along the feed)
  const rotated = (x, y) => bmp.data[x * bmp.width + (bmp.width - 1 - y)];
  const head = params.bytesPerRow * 8;
  const x0 = head - W - (medium.offsetRightDots + params.additionalOffsetR);
  const rows = [];
  for (let y = 0; y < H; y++) {
    const pasted = new Uint8Array(head);
    for (let x = 0; x < W; x++) pasted[x0 + x] = rotated(x, y);
    const flipped = pasted.map((_, i) => pasted[head - 1 - i]);
    const row = new Uint8Array(params.bytesPerRow);
    flipped.forEach((v, i) => { if (v) row[i >> 3] |= 0x80 >> (i & 7); });
    rows.push(row);
  }
  return rows;
}

const pattern = (x, y) => (x * 7 + y * 3) % 11 === 0 || x === 0 || y === 2;

test('QL raster rows match brother_ql\'s rotate/paste/flip pipeline', () => {
  const cases = [
    ['QL-800', { offsetRightDots: 12, continuous: true }, 696],
    ['QL-700', { offsetRightDots: 6, continuous: false }, 306],
    ['QL-1100', { offsetRightDots: 12, continuous: true }, 1164],
  ];
  for (const [model, medium, across] of cases) {
    const params = qlParams(model);
    const bmp = bitmap(23, across, pattern);
    assert.deepEqual(qlRows(bmp, medium, params), referenceRows(bmp, medium, params), model);
  }
});

test('QL command sequence (brother_ql convert, cut, no compression)', () => {
  const params = qlParams('QL-810W');
  const medium = { continuous: false, widthMm: 29, lengthMm: 90, offsetRightDots: 6 };
  const out = encodeQL(bitmap(2, 306, () => false), medium, params, { cut: true });
  let i = 0;
  const take = (n) => [...out.subarray(i, (i += n))];
  assert.deepEqual(take(4), [0x1b, 0x69, 0x61, 0x01], 'switch to raster mode');
  assert.ok(take(400).every((b) => b === 0), 'QL-8xx invalidate is 400 bytes');
  assert.deepEqual(take(2), [0x1b, 0x40]);
  assert.deepEqual(take(4), [0x1b, 0x69, 0x61, 0x01]);
  assert.deepEqual(take(3), [0x1b, 0x69, 0x53]);
  assert.deepEqual(take(13), [0x1b, 0x69, 0x7a, 0xce, 0x0b, 29, 90, 2, 0, 0, 0, 0, 0], 'media: die-cut 29 × 90, 2 lines');
  assert.deepEqual(take(8), [0x1b, 0x69, 0x4d, 0x40, 0x1b, 0x69, 0x41, 0x01], 'auto cut, every label');
  assert.deepEqual(take(4), [0x1b, 0x69, 0x4b, 0x08], 'cut at end');
  assert.deepEqual(take(5), [0x1b, 0x69, 0x64, 0, 0], 'no feed margin on die-cut');
  for (let r = 0; r < 2; r++) {
    assert.deepEqual(take(3), [0x67, 0x00, 90]);
    i += 90;
  }
  assert.deepEqual(take(1), [0x1a]);
  assert.equal(i, out.length);
});

test('QL-700 has no mode switch; continuous rolls send feed margin and no length', () => {
  const out = encodeQL(bitmap(1, 696, () => false), { continuous: true, widthMm: 62, offsetRightDots: 12, feedMarginDots: 35 },
    qlParams('QL-700'), { cut: false });
  assert.ok(out.subarray(0, 200).every((b) => b === 0));
  assert.deepEqual([...out.subarray(200, 202)], [0x1b, 0x40]);
  const z = out.indexOf(0x7a) - 2;
  // One line of content, padded to the model's 150-line minimum.
  assert.deepEqual([...out.subarray(z, z + 13)], [0x1b, 0x69, 0x7a, 0xce, 0x0a, 62, 0, 150, 0, 0, 0, 0, 0]);
  const after = [...out.subarray(z + 13, z + 22)];
  assert.deepEqual(after, [0x1b, 0x69, 0x4b, 0x00, 0x1b, 0x69, 0x64, 35, 0], 'no cut commands; feed margin 35');
});

test('QL-500: no mode switch, cutter or expanded mode; longer minimum length', () => {
  const params = qlParams('QL-500');
  const out = encodeQL(bitmap(10, 696, () => true), { continuous: true, widthMm: 62, offsetRightDots: 12, feedMarginDots: 35 },
    params, { cut: true });
  const z = out.indexOf(0x7a) - 2;
  assert.deepEqual([...out.subarray(z, z + 13)], [0x1b, 0x69, 0x7a, 0xce, 0x0a, 62, 0, 295 & 0xff, 295 >> 8, 0, 0, 0, 0]);
  assert.deepEqual([...out.subarray(z + 13, z + 18)], [0x1b, 0x69, 0x64, 35, 0], 'only the feed margin follows');
  assert.ok(![...out.subarray(0, z)].some((b, k, a) => b === 0x1b && a[k + 1] === 0x69 && a[k + 2] === 0x61), 'no ESC i a');
  const rows = out.length - (z + 18) - 1;
  assert.equal(rows, 295 * (3 + 90));
  // Die-cut labels are never padded.
  const die = encodeQL(bitmap(10, 306, () => false), { continuous: false, widthMm: 29, lengthMm: 90, offsetRightDots: 6 }, params);
  const dz = die.indexOf(0x7a) - 2;
  assert.equal(die[dz + 7], 10);
});

test('QL status reply', () => {
  const buf = new Uint8Array(32);
  buf[0] = 0x80;
  buf[1] = 0x20;
  buf[10] = 62;
  buf[11] = 0x0a;
  buf[9] = 0x10;
  const s = parseQLStatus(buf);
  assert.equal(s.tapeMm, 62);
  assert.equal(s.continuous, true);
  assert.deepEqual(s.errors, ['Cover open']);
  assert.equal(parseQLStatus(new Uint8Array(4)), null);
});
