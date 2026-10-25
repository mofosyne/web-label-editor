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
  return {
    tapeMm: buf[10],
    mediaType: buf[11],
    errors,
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
