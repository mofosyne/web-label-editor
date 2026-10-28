// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr, numDataCodewords } from '../src/codes/qr.js';
import {
  CODE128_PATTERNS, code128Values, encodeCode128, encodeEan13, encodeUpcA, eanCheckDigit,
} from '../src/codes/barcode.js';

// These encoders were verified by decoding every QR version 1–40 at each
// error-correction level (full capacity), plus Code 128 / EAN-13 / UPC-A
// samples, with the zxing-cpp reader. The tests below pin that behaviour.

test('QR data capacities match ISO/IEC 18004 table 7', () => {
  const known = {
    L: [19, 34, 55, 80, 108, 136, 156, 194, 232, 274],
    M: [16, 28, 44, 64, 86, 108, 124, 154, 182, 216],
    Q: [13, 22, 34, 48, 62, 76, 88, 110, 132, 154],
    H: [9, 16, 26, 36, 46, 60, 66, 86, 100, 122],
  };
  const v40 = { L: 2956, M: 2334, Q: 1666, H: 1276 };
  for (const ecc of 'LMQH') {
    known[ecc].forEach((k, i) => assert.equal(numDataCodewords(i + 1, ecc), k, `v${i + 1}-${ecc}`));
    assert.equal(numDataCodewords(40, ecc), v40[ecc]);
    for (let v = 2; v <= 40; v++) assert.ok(numDataCodewords(v, ecc) > numDataCodewords(v - 1, ecc));
  }
});

test('QR picks the smallest version and draws function patterns', () => {
  const q = encodeQr('https://example.com', 'M');
  assert.equal(q.version, 2);
  assert.equal(q.size, 25);
  const finder = (x0, y0) => {
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        assert.equal(q.modules[y0 + dy][x0 + dx], ring !== 2, `finder at ${x0},${y0}`);
      }
    }
  };
  finder(0, 0);
  finder(q.size - 7, 0);
  finder(0, q.size - 7);
  assert.equal(q.modules[q.size - 8][8], true, 'dark module');
  for (let i = 8; i < q.size - 8; i++) assert.equal(q.modules[6][i], i % 2 === 0, 'timing');
});

test('QR format information is written identically in both copies', () => {
  const q = encodeQr('label', 'H');
  const a = [];
  const b = [];
  for (let i = 0; i <= 5; i++) a.push(q.modules[i][8]);
  a.push(q.modules[7][8], q.modules[8][8], q.modules[8][7]);
  for (let i = 9; i < 15; i++) a.push(q.modules[8][14 - i]);
  for (let i = 0; i < 8; i++) b.push(q.modules[8][q.size - 1 - i]);
  for (let i = 8; i < 15; i++) b.push(q.modules[q.size - 15 + i][8]);
  assert.deepEqual(a, b);
});

test('QR rejects oversized data', () => {
  assert.throws(() => encodeQr('x'.repeat(3000), 'L'), /Too much data/);
});

test('Code 128 pattern table is well formed', () => {
  assert.equal(CODE128_PATTERNS.length, 107);
  CODE128_PATTERNS.forEach((p, i) => {
    const sum = [...p].reduce((s, d) => s + Number(d), 0);
    assert.equal(sum, i === 106 ? 13 : 11, `pattern ${i}`);
  });
  assert.equal(new Set(CODE128_PATTERNS).size, 107);
});

test('Code 128 switches to set C for digit runs', () => {
  assert.deepEqual(code128Values('ABC-12345'), [104, 33, 34, 35, 13, 99, 12, 34, 100, 21, 96, 106]);
  assert.deepEqual(code128Values('1234'), [105, 12, 34, 82, 106]);
  const odd = code128Values('12345');
  assert.deepEqual(odd.slice(0, 5), [104, 17, 99, 23, 45]);
  assert.throws(() => code128Values('tab\there'), /printable ASCII/);
  const c = encodeCode128('Hi');
  assert.equal(c.modules.length, 11 * 4 + 13); // start, H, i, checksum, stop
});

test('EAN-13 and UPC-A', () => {
  assert.equal(eanCheckDigit('590123412345'), 7);
  assert.equal(eanCheckDigit('400638133393'), 1);
  const e = encodeEan13('590123412345');
  assert.equal(e.text, '5901234123457');
  assert.equal(e.modules.length, 95);
  assert.throws(() => encodeEan13('5901234123450'), /check digit/);
  assert.throws(() => encodeEan13('ABC'), /12 digits/);
  const u = encodeUpcA('03600029145');
  assert.equal(u.text, '036000291452');
  assert.equal(u.modules.length, 95);
});
