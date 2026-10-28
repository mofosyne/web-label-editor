// Brother P-touch raster protocol (PT-P700 family, incl. PT-P710BT).
// Follows Brother's "Raster Command Reference" and the command sequence used
// by ptouch-print (libptouch.c), which is known to work on the PT-P710BT.
// The command sequence, per-model quirks, status tables and tape table are
// ported from ptouch-print: https://git.familie-radermacher.ch/linux/ptouch-print.git,
// Copyright (C) 2013-2026 Dominic Radermacher, GPL-3.0.
//
// The bitmap passed in is a "strip": width = tape length, height = printable
// dots across the tape. Each column becomes one raster line; the strip is
// centred on the 128-dot head with its top row nearest the first data bit.
import { ByteWriter, packBits } from './bytes.js';

const ESC = 0x1b;
export const HEAD_DOTS = 128;

export function initCommand() {
  const w = new ByteWriter();
  w.fill(0, 100); // invalidate
  w.push(ESC, 0x40); // ESC @: initialise
  return w.toUint8Array();
}

export const STATUS_REQUEST = Uint8Array.of(ESC, 0x69, 0x53); // ESC i S

// Status reply tables, from Brother's raster reference via ptouch-print.
export const MEDIA_TYPES = {
  0x00: 'No media',
  0x01: 'Laminated tape',
  0x03: 'Non-laminated tape',
  0x04: 'Fabric tape',
  0x11: 'Heat-shrink tube',
  0x13: 'Flexi tape',
  0x14: 'Flexible ID tape',
  0x15: 'Satin tape',
  0x17: 'Heat-shrink tube',
  0xff: 'Incompatible tape',
};

// [name, preview colour]
export const TAPE_COLORS = {
  0x01: ['White', '#ffffff'],
  0x02: ['Other', '#ffffff'],
  0x03: ['Clear', '#e9eef0'],
  0x04: ['Red', '#d8352f'],
  0x05: ['Blue', '#2468c9'],
  0x06: ['Yellow', '#f6d32b'],
  0x07: ['Green', '#2f9e55'],
  0x08: ['Black', '#151515'],
  0x09: ['Clear', '#e9eef0'],
  0x20: ['Matte white', '#f3f3ef'],
  0x21: ['Matte clear', '#e6ebec'],
  0x22: ['Matte silver', '#c3c6ca'],
  0x23: ['Satin gold', '#c9a54b'],
  0x24: ['Satin silver', '#b9bdc2'],
  0x30: ['Blue', '#2468c9'],
  0x31: ['Red', '#d8352f'],
  0x40: ['Fluorescent orange', '#ff7b22'],
  0x41: ['Fluorescent yellow', '#e9fb3a'],
  0x50: ['Berry pink', '#d5478f'],
  0x51: ['Light grey', '#bcbcbc'],
  0x52: ['Lime green', '#9ccf3c'],
  0x60: ['Yellow', '#f6d32b'],
  0x61: ['Pink', '#f29abf'],
  0x62: ['Blue', '#4b8fd8'],
  0x70: ['Heat-shrink tube', '#f2f2f2'],
  0x71: ['Heat-shrink tube, white', '#ffffff'],
  0x90: ['White (Flex ID)', '#ffffff'],
  0x91: ['Yellow (Flex ID)', '#f6d32b'],
  0xf0: ['Cleaning', '#ffffff'],
  0xf1: ['Stencil', '#ffffff'],
  0xff: ['Incompatible', '#ffffff'],
};

export const TEXT_COLORS = {
  0x01: ['White', '#ffffff'],
  0x02: ['Other', '#111111'],
  0x04: ['Red', '#d8352f'],
  0x05: ['Blue', '#2468c9'],
  0x08: ['Black', '#111111'],
  0x0a: ['Gold', '#c9a54b'],
  0x62: ['Blue', '#2468c9'],
  0xf0: ['Cleaning', '#111111'],
  0xf1: ['Stencil', '#111111'],
  0xff: ['Incompatible', '#111111'],
};

const lookup = (table, code) => {
  const [name, hex] = table[code] ?? ['Unknown', null];
  return { code, name, hex };
};

export function parseStatus(buf) {
  if (!buf || buf.length < 32 || buf[0] !== 0x80 || buf[1] !== 0x20) return null;
  const errors = [];
  const e1 = buf[8];
  const e2 = buf[9];
  if (e1 & 0x01) errors.push('No tape');
  if (e1 & 0x02) errors.push('End of tape');
  if (e1 & 0x04) errors.push('Cutter jam');
  if (e1 & 0x08) errors.push('Weak batteries');
  if (e1 & 0x40) errors.push('High-voltage adapter');
  if (e2 & 0x01) errors.push('Wrong tape');
  if (e2 & 0x10) errors.push('Cover open');
  if (e2 & 0x20) errors.push('Overheating');

  const mediaType = { code: buf[11], name: MEDIA_TYPES[buf[11]] ?? 'Unknown media' };
  const tapeColor = lookup(TAPE_COLORS, buf[24]);
  const textColor = lookup(TEXT_COLORS, buf[25]);
  if (mediaType.code === 0xff || tapeColor.code === 0xff) errors.push('Incompatible tape');
  if (tapeColor.code === 0xf0) errors.push('Cleaning tape loaded');

  const warnings = [];
  if (mediaType.code === 0x11 || mediaType.code === 0x17) {
    warnings.push('Heat-shrink tube: the printable area is not verified, check a test print');
  }
  if (tapeColor.code === 0xf1) warnings.push('Stencil tape loaded');

  return {
    tapeMm: buf[10],
    mediaType,
    tapeColor,
    textColor,
    errors,
    warnings,
  };
}

// Per-model differences, as in ptouch-print's device table:
//   packbits  compress raster lines (otherwise send them raw)
//   p700Init  enter raster mode with ESC i a 01 instead of ESC i R 01
//   infoCmd   send the print information command (ESC i z)
//   precut    supports ESC i M auto-cut
//   magic     PT-D410/D460BT/E310BT family: extra ESC i d command, and
//             the info command asks for a final feed
export const PT_DEFAULT_QUIRKS = { packbits: true, p700Init: false, infoCmd: false, precut: true, magic: false };

export function encodePTouch(bitmap, opts = {}) {
  const autoCut = opts.autoCut ?? true;
  const q = { ...PT_DEFAULT_QUIRKS, ...opts.quirks };
  const bytesPerLine = HEAD_DOTS / 8;
  const top = Math.floor((HEAD_DOTS - bitmap.height) / 2);
  const { width, height, data } = bitmap;

  const w = new ByteWriter();
  w.add(initCommand());
  if (q.packbits) w.push(0x4d, 0x02); // M 02: PackBits compression
  if (q.p700Init) w.push(ESC, 0x69, 0x61, 0x01); // ESC i a 01: raster mode
  else w.push(ESC, 0x69, 0x52, 0x01); // ESC i R 01: raster mode
  if (q.infoCmd) {
    // ESC i z: media width (mm) and number of raster lines
    w.push(ESC, 0x69, 0x7a, 0, 0, opts.tapeMm ?? 0, 0,
      width & 0xff, (width >> 8) & 0xff, (width >> 16) & 0xff, (width >>> 24) & 0xff,
      q.magic ? 0x02 : 0x00, 0);
  }
  if (q.magic) w.push(ESC, 0x69, 0x64, 0x01, 0x00, 0x4d, 0x00); // ESC i d: margin
  if (q.precut) w.push(ESC, 0x69, 0x4d, autoCut ? 0x40 : 0x00); // ESC i M: auto cut

  const line = new Uint8Array(bytesPerLine);
  for (let x = 0; x < width; x++) {
    line.fill(0);
    for (let y = 0; y < height; y++) {
      if (!data[y * width + x]) continue;
      const dot = top + y;
      if (dot < 0 || dot >= HEAD_DOTS) continue;
      line[dot >> 3] |= 0x80 >> (dot & 7);
    }
    const out = q.packbits ? packBits(line) : line.slice(); // `line` is reused
    w.push(0x47, out.length & 0xff, out.length >> 8); // G n1 n2
    w.add(out);
  }
  // Blank lines after the content: the printer leaves off the end of the
  // raster data, so these are what it drops instead.
  const blank = q.packbits ? packBits(new Uint8Array(bytesPerLine)) : new Uint8Array(bytesPerLine);
  for (let i = 0; i < (opts.tailDots ?? 0); i++) {
    w.push(0x47, blank.length & 0xff, blank.length >> 8);
    w.add(blank);
  }

  w.push(0x1a); // print with feed (and cut)
  return w.toUint8Array();
}
