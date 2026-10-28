// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rasterLines, encodeZpl, encodeTspl, encodeEscPos, customMedium, genericPrinter, GENERIC_DEFAULTS,
} from '../src/printers/generic.js';

// A strip 3 dots long, 10 across, with one dot at its left end, top row.
const strip = () => {
  const data = new Uint8Array(3 * 10);
  data[0] = 1; // x 0, y 0
  return { width: 3, height: 10, data };
};
const text = (bytes) => String.fromCharCode(...bytes);

test('raster lines: left end first, the strip\'s bottom row at the left; turned round with rotate', () => {
  const lines = rasterLines(strip(), 2);
  assert.equal(lines.length, 3);
  // Top row (y 0) is the last dot of the line: dot 9 = byte 1, bit 0x40.
  assert.deepEqual([...lines[0]], [0x00, 0x40]);
  assert.deepEqual([...lines[1]], [0, 0]);
  const turned = rasterLines(strip(), 2, true);
  assert.deepEqual([...turned[2]], [0x80, 0x00], 'last line, first dot');
});

test('ZPL: one ^GF field, gap sensing on labels, darkness when set', () => {
  const cfg = { ...GENERIC_DEFAULTS, darkness: 15 };
  const z = text(encodeZpl(strip(), cfg, { continuous: false }));
  assert.match(z, /^\^XA\n\^MNY\n\^PW16\n\^LL3\n\^LH0,0\n~SD15\n\^FO0,0\^GFA,6,6,2,004000000000\^FS\n\^PQ1\n\^XZ\n$/);
  assert.match(text(encodeZpl(strip(), GENERIC_DEFAULTS, { continuous: true })), /\^MNN/);
  assert.doesNotMatch(text(encodeZpl(strip(), GENERIC_DEFAULTS, { continuous: true })), /~SD/);
});

test('TSPL: size, gap, inverted bitmap (0 prints), print', () => {
  const out = encodeTspl(strip(), { ...GENERIC_DEFAULTS, gapMm: 3 }, { continuous: false, dpmm: 8 });
  const s = text(out);
  assert.ok(s.startsWith('SIZE 2.0 mm,0.4 mm\r\nGAP 3.0 mm,0 mm\r\nDIRECTION 0,0\r\nCLS\r\nBITMAP 0,0,2,3,0,'));
  const at = s.indexOf('BITMAP 0,0,2,3,0,') + 'BITMAP 0,0,2,3,0,'.length;
  assert.deepEqual([...out.subarray(at, at + 6)], [0xff, 0xbf, 0xff, 0xff, 0xff, 0xff]);
  assert.ok(s.endsWith('\r\nPRINT 1,1\r\n'));
  assert.match(text(encodeTspl(strip(), GENERIC_DEFAULTS, { continuous: true, dpmm: 8 })), /GAP 0 mm,0 mm/);
});

test('ESC/POS: GS v 0 in bands of 255 lines, then feed', () => {
  const long = { width: 300, height: 16, data: new Uint8Array(300 * 16) };
  const out = encodeEscPos(long, GENERIC_DEFAULTS, { continuous: true });
  assert.deepEqual([...out.subarray(0, 10)], [0x1b, 0x40, 0x1d, 0x76, 0x30, 0, 2, 0, 255, 0]);
  const second = 2 + 8 + 255 * 2;
  assert.deepEqual([...out.subarray(second, second + 8)], [0x1d, 0x76, 0x30, 0, 2, 0, 45, 0]);
  assert.deepEqual([...out.subarray(-3)], [0x1b, 0x64, 4]);
  assert.deepEqual([...encodeEscPos(strip(), GENERIC_DEFAULTS, { continuous: false }).subarray(-2)], [0x1d, 0x0c]);
});

test('the model follows its settings: resolution, head and the label as its one medium', () => {
  const m = genericPrinter();
  assert.equal(m.dpi, 203);
  m.configure({ dpi: 300, headMm: 48, widthMm: 58, lengthMm: 0 });
  assert.equal(m.headDots, 567);
  assert.deepEqual([m.media.length, m.media[0].acrossDots, m.media[0].continuous], [1, 567, true], 'clipped to the head');
  const die = customMedium({ widthMm: 50, lengthMm: 30, marginMm: 1 }, 203, 832);
  assert.deepEqual([die.acrossDots, die.lengthDots, die.margins.top], [400, 240, 1]);
});

test('a report\'s record goes into catalog/printers.rec and comes back as that printer', async () => {
  const { applyPrinters } = await import('../src/catalog.js');
  const { printerRecord } = await import('../src/printers/generic.js');
  const { readFileSync } = await import('node:fs');
  const cfg = { ...GENERIC_DEFAULTS, name: 'Zebra GK420d', language: 'zpl', dpi: 203, headMm: 104, rotate: true, widthMm: 57, lengthMm: 32 };
  const record = printerRecord(cfg, { feedMm: -1.5, acrossMm: 0 }, 'https://github.com/mofosyne/web-label-editor/issues/99');
  assert.match(record, /^Id: zebra-gk420d\nName: Zebra GK420d\nBrand: Zebra\nLanguage: zpl\n/);
  assert.match(record, /\nFeedMm: -1.5\n/);
  assert.doesNotMatch(record, /AcrossMm/);
  const header = readFileSync(new URL('../catalog/printers.rec', import.meta.url), 'utf8');
  const generic = genericPrinter();
  const models = applyPrinters(`${header}\n${record}\n`, { generic });
  assert.deepEqual(Object.keys(models), ['zebra-gk420d', 'generic'], 'catalogued printers come before Other printer');
  const m = models['zebra-gk420d'];
  assert.equal(m.name, 'Zebra GK420d (ZPL)');
  assert.equal(m.brand, 'Zebra');
  assert.deepEqual(m.defaultAdjust, { feedMm: -1.5, acrossMm: 0 });
  // The label is the user's; the printer's own settings stay as recorded.
  m.configure({ language: 'tspl', dpi: 300, widthMm: 50, lengthMm: 25 });
  assert.deepEqual([m.config.language, m.dpi, m.config.rotate, m.media[0].name], ['zpl', 203, true, 'Your labels, 50 × 25 mm']);
  assert.equal(genericPrinter().configure({}).config.widthMm, 101.6);
  assert.equal(models['zebra-gk420d'].configure({}).config.widthMm, 57, 'starts from the recorded label');
});
