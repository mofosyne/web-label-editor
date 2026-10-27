// Brother P-touch raster protocol (PT-P700 family, incl. PT-P710BT).
// Follows Brother's "Raster Command Reference" and the command sequence used
// by ptouch-print (libptouch.c), which is known to work on the PT-P710BT.
//
// The bitmap passed in is a "strip": width = tape length, height = printable
// dots across the tape. Each column becomes one raster line; the strip is
// centred on the 128-dot head with its top row nearest the first data bit.
import { ByteWriter, packBits } from './bytes.js';

const ESC = 0x1b;
export const HEAD_DOTS = 128;

// Printable dots across the head at 180 dpi, per tape width (mm).
export const TAPES = [
  { mm: 3.5, statusMm: 4, dots: 24 },
  { mm: 6, statusMm: 6, dots: 32 },
  { mm: 9, statusMm: 9, dots: 52 },
  { mm: 12, statusMm: 12, dots: 76 },
  { mm: 18, statusMm: 18, dots: 120 },
  { mm: 24, statusMm: 24, dots: 128 },
];

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
    tape: TAPES.find((t) => t.statusMm === buf[10]) ?? null,
  };
}

export function encodePTouch(bitmap, opts = {}) {
  const autoCut = opts.autoCut ?? true;
  const bytesPerLine = HEAD_DOTS / 8;
  const top = Math.floor((HEAD_DOTS - bitmap.height) / 2);

  const w = new ByteWriter();
  w.add(initCommand());
  w.push(0x4d, 0x02); // M 02: PackBits compression
  w.push(ESC, 0x69, 0x52, 0x01); // ESC i R 01: raster mode
  w.push(ESC, 0x69, 0x4d, autoCut ? 0x40 : 0x00); // ESC i M: auto cut

  const { width, height, data } = bitmap;
  const line = new Uint8Array(bytesPerLine);
  for (let x = 0; x < width; x++) {
    line.fill(0);
    for (let y = 0; y < height; y++) {
      if (!data[y * width + x]) continue;
      const dot = top + y;
      if (dot < 0 || dot >= HEAD_DOTS) continue;
      line[dot >> 3] |= 0x80 >> (dot & 7);
    }
    const packed = packBits(line);
    w.push(0x47, packed.length & 0xff, packed.length >> 8); // G n1 n2
    w.add(packed);
  }

  w.push(0x1a); // print with feed (and cut)
  return w.toUint8Array();
}
