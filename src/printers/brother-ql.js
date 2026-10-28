// SPDX-License-Identifier: GPL-3.0-or-later
// Brother QL raster protocol (DK rolls, 300 dpi).
// Ported from brother_ql (conversion.py, raster.py, models.py, labels.py),
// which documents Brother's "QL Series Raster Command Reference".
// brother_ql: https://github.com/pklaus/brother_ql, by Philipp Klaus,
// GPL-3.0-or-later.
//
// The bitmap passed in is a "strip": width = length along the feed, height =
// printable dots across the roll. As brother_ql does for a landscape image
// rotated by 90°, the strip's right end prints first. Each raster row is
// mirrored (brother_ql flips the image left-right) and the printable area
// sits `offsetRightDots` (+ the model's extra offset) from the row start.
import { ByteWriter } from './bytes.js';

const ESC = 0x1b;

// Model parameters from brother_ql's models.py. minLengthDots is the
// shortest print (brother_ql's min_max_length_dots); compression is never
// used here, so its flag is left out.
export const QL_MODELS = {
  'QL-500': { minLengthDots: 295, modeSetting: false, expandedMode: false, cutting: false },
  'QL-550': { minLengthDots: 295, modeSetting: false },
  'QL-560': { minLengthDots: 295, modeSetting: false },
  'QL-570': { modeSetting: false },
  'QL-580N': {},
  'QL-650TD': { minLengthDots: 295 },
  'QL-700': { bytesPerRow: 90, modeSetting: false },
  'QL-710W': { bytesPerRow: 90 },
  'QL-720NW': { bytesPerRow: 90 },
  'QL-800': { bytesPerRow: 90, invalidateBytes: 400 },
  'QL-810W': { bytesPerRow: 90, invalidateBytes: 400 },
  'QL-820NWB': { bytesPerRow: 90, invalidateBytes: 400 },
  'QL-1050': { bytesPerRow: 162, additionalOffsetR: 44, minLengthDots: 295 },
  'QL-1060N': { bytesPerRow: 162, additionalOffsetR: 44, minLengthDots: 295 },
  'QL-1100': { bytesPerRow: 162, additionalOffsetR: 44, minLengthDots: 301 },
  'QL-1110NWB': { bytesPerRow: 162, additionalOffsetR: 44, minLengthDots: 301 },
  'QL-1115NWB': { bytesPerRow: 162, additionalOffsetR: 44, minLengthDots: 301 },
};

const DEFAULTS = {
  bytesPerRow: 90, additionalOffsetR: 0, modeSetting: true, cutting: true, expandedMode: true, invalidateBytes: 200,
  minLengthDots: 150,
};

export function qlParams(name) {
  return { ...DEFAULTS, ...QL_MODELS[name] };
}

// One raster row per strip column, right end first.
export function qlRows(bitmap, medium, params) {
  const { width, height, data } = bitmap;
  const offset = (medium.offsetRightDots ?? 0) + params.additionalOffsetR;
  const rows = [];
  for (let r = 0; r < width; r++) {
    const x = width - 1 - r;
    const row = new Uint8Array(params.bytesPerRow);
    for (let y = 0; y < height; y++) {
      if (!data[y * width + x]) continue;
      const pos = offset + (height - 1 - y);
      if (pos >= 0 && pos < params.bytesPerRow * 8) row[pos >> 3] |= 0x80 >> (pos & 7);
    }
    rows.push(row);
  }
  return rows;
}

export function encodeQL(bitmap, medium, params, { cut = true } = {}) {
  const w = new ByteWriter();
  const switchMode = () => { if (params.modeSetting) w.push(ESC, 0x69, 0x61, 0x01); }; // ESC i a 01: raster mode
  switchMode();
  w.fill(0, params.invalidateBytes); // invalidate
  w.push(ESC, 0x40); // ESC @: initialise
  switchMode();
  w.push(ESC, 0x69, 0x53); // ESC i S: status request (as brother_ql sends it)

  // A continuous label shorter than the model's minimum is padded with
  // blank lines at its end.
  const lines = qlRows(bitmap, medium, params);
  if (medium.continuous) while (lines.length < params.minLengthDots) lines.push(new Uint8Array(params.bytesPerRow));

  // ESC i z: media type, width, length (mm), raster line count; all
  // fields valid plus high quality (0xCE).
  const rows = lines.length;
  w.push(ESC, 0x69, 0x7a, 0xce,
    medium.continuous ? 0x0a : 0x0b,
    Math.round(medium.widthMm) & 0xff,
    medium.continuous ? 0 : Math.round(medium.lengthMm) & 0xff,
    rows & 0xff, (rows >> 8) & 0xff, (rows >> 16) & 0xff, (rows >>> 24) & 0xff,
    0, 0);
  if (cut && params.cutting) {
    w.push(ESC, 0x69, 0x4d, 0x40); // ESC i M: auto cut
    w.push(ESC, 0x69, 0x41, 0x01); // ESC i A: cut every label
  }
  if (params.expandedMode) w.push(ESC, 0x69, 0x4b, cut ? 0x08 : 0x00); // ESC i K: cut at end
  const feed = medium.feedMarginDots ?? 0;
  w.push(ESC, 0x69, 0x64, feed & 0xff, feed >> 8); // ESC i d: feed margin

  for (const row of lines) {
    w.push(0x67, 0x00, params.bytesPerRow); // g 00 n: raster line
    w.add(row);
  }
  w.push(0x1a); // print, last page
  return w.toUint8Array();
}

// Status reply (32 bytes) to ESC i S.
export function parseQLStatus(buf) {
  if (!buf || buf.length < 32 || buf[0] !== 0x80 || buf[1] !== 0x20) return null;
  const errors = [];
  const e1 = buf[8];
  const e2 = buf[9];
  if (e1 & 0x01) errors.push('No media');
  if (e1 & 0x02) errors.push('End of media');
  if (e1 & 0x04) errors.push('Cutter jam');
  if (e1 & 0x10) errors.push('Printer in use');
  if (e2 & 0x01) errors.push('Replace media');
  if (e2 & 0x10) errors.push('Cover open');
  if (e2 & 0x40) errors.push('Media cannot be fed');
  if (e2 & 0x80) errors.push('System error');
  const type = buf[11];
  const continuous = type === 0x0a || type === 0x4a;
  const dieCut = type === 0x0b || type === 0x4b;
  return {
    tapeMm: buf[10],
    lengthMm: buf[17],
    continuous,
    dieCut,
    mediaType: { code: type, name: continuous ? 'Continuous roll' : dieCut ? 'Die-cut labels' : 'Unknown media' },
    tapeColor: { name: 'White', hex: null },
    textColor: { name: 'Black', hex: null },
    errors,
    warnings: [],
  };
}
