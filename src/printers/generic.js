// SPDX-License-Identifier: GPL-3.0-or-later
// "Other printer": label printers this app has no entry for, driven through
// one of the common printer languages, with the printer described by the
// user (resolution, head and label size). Experimental by design: a working
// set of settings, sent in with the printer report, becomes a proper entry.
//
//   zpl     Zebra Programming Language: Zebra and the many printers that
//           emulate it. The label goes as one ^GF graphic field.
//   tspl    TSC's language, spoken by most budget 4 × 6 shipping printers
//           (BITMAP command).
//   escpos  ESC/POS raster (GS v 0), from receipt printers; many small
//           label and receipt printers accept it.
//
// The bitmap passed in is a strip (width = along the feed, height = across
// the head). Each language takes an image whose rows are raster lines, the
// first row printed first: the strip turned a quarter clockwise, so its left
// end comes out first and its bottom row is at the left of each line.
import { ByteWriter } from './bytes.js';

export const LANGUAGES = {
  zpl: 'ZPL (Zebra and compatibles)',
  tspl: 'TSPL (TSC, most 4 × 6 shipping printers)',
  escpos: 'ESC/POS raster (receipt-style printers)',
};

export const LANGUAGE_NAMES = { zpl: 'ZPL', tspl: 'TSPL', escpos: 'ESC/POS raster' };

// What a catalogued printer (catalog/printers.rec) fixes; the label stays
// the user's to set.
export const PRINTER_KEYS = ['language', 'dpi', 'headMm', 'rotate'];

export const GENERIC_DEFAULTS = {
  name: '',
  language: 'zpl',
  dpi: 203,
  headMm: 104,
  widthMm: 101.6,
  lengthMm: 152.4,
  gapMm: 3,
  marginMm: 1,
  shape: 'rect',
  cornerMm: 0,
  darkness: '',
  rotate: false,
};

// Raster lines, MSB first, `bytes` per line: the strip turned for printing
// (or turned the other way round with `rotate`, for a printer that feeds
// the other end first).
export function rasterLines(bitmap, bytes, rotate = false) {
  const { width, height, data } = bitmap;
  const lines = [];
  for (let r = 0; r < width; r++) {
    const x = rotate ? width - 1 - r : r;
    const line = new Uint8Array(bytes);
    for (let c = 0; c < Math.min(height, bytes * 8); c++) {
      const y = rotate ? c : height - 1 - c;
      if (data[y * width + x]) line[c >> 3] |= 0x80 >> (c & 7);
    }
    lines.push(line);
  }
  return lines;
}

const ascii = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');

// cfg: the user's settings; job: { continuous, dpmm }.
export function encodeZpl(bitmap, cfg, { continuous }) {
  const bytes = Math.ceil(bitmap.height / 8);
  const lines = rasterLines(bitmap, bytes, cfg.rotate);
  const total = bytes * lines.length;
  let s = '^XA\n';
  s += `^MN${continuous ? 'N' : 'Y'}\n`; // continuous media, or gap/notch sensing
  s += `^PW${bytes * 8}\n^LL${lines.length}\n^LH0,0\n`;
  if (cfg.darkness !== '' && cfg.darkness != null) s += `~SD${String(Math.round(Number(cfg.darkness))).padStart(2, '0')}\n`;
  s += `^FO0,0^GFA,${total},${total},${bytes},${lines.map(hex).join('')}^FS\n`;
  s += '^PQ1\n^XZ\n';
  return ascii(s);
}

export function encodeTspl(bitmap, cfg, { continuous, dpmm }) {
  const bytes = Math.ceil(bitmap.height / 8);
  const lines = rasterLines(bitmap, bytes, cfg.rotate);
  const mm = (dots) => (dots / dpmm).toFixed(1);
  const w = new ByteWriter();
  const cmd = (s) => w.add(ascii(`${s}\r\n`));
  cmd(`SIZE ${mm(bytes * 8)} mm,${mm(lines.length)} mm`);
  cmd(continuous ? 'GAP 0 mm,0 mm' : `GAP ${Number(cfg.gapMm || 0).toFixed(1)} mm,0 mm`);
  cmd('DIRECTION 0,0');
  if (cfg.darkness !== '' && cfg.darkness != null) cmd(`DENSITY ${Math.round(Number(cfg.darkness))}`);
  cmd('CLS');
  // In a TSPL bitmap a 0 bit is printed (black).
  w.add(ascii(`BITMAP 0,0,${bytes},${lines.length},0,`));
  for (const line of lines) w.add(line.map((b) => ~b & 0xff));
  w.add(ascii('\r\n'));
  cmd('PRINT 1,1');
  return w.toUint8Array();
}

export function encodeEscPos(bitmap, cfg, { continuous }) {
  const bytes = Math.ceil(bitmap.height / 8);
  const lines = rasterLines(bitmap, bytes, cfg.rotate);
  const w = new ByteWriter();
  w.push(0x1b, 0x40); // ESC @: initialise
  // GS v 0: raster bit image, in bands of up to 255 lines.
  for (let i = 0; i < lines.length; i += 255) {
    const band = lines.slice(i, i + 255);
    w.push(0x1d, 0x76, 0x30, 0, bytes & 0xff, bytes >> 8, band.length & 0xff, band.length >> 8);
    for (const line of band) w.add(line);
  }
  // Labels: GS FF feeds to the start of the next label; paper: a few lines.
  if (continuous) w.push(0x1b, 0x64, 4); // ESC d 4
  else w.push(0x1d, 0x0c);
  return w.toUint8Array();
}

const ENCODERS = { zpl: encodeZpl, tspl: encodeTspl, escpos: encodeEscPos };

// The label described by the settings, as a medium.
export function customMedium(cfg, dpi, headDots) {
  const dpmm = dpi / 25.4;
  const width = Number(cfg.widthMm) || 50;
  const length = Number(cfg.lengthMm) || 0;
  const margin = Number(cfg.marginMm) || 0;
  const medium = {
    id: 'custom',
    name: length ? `Your ${cfg.shape === 'round' ? 'round ' : ''}labels, ${width} × ${length} mm` : `Your roll, ${width} mm continuous`,
    acrossDots: Math.min(Math.round(width * dpmm), headDots),
    continuous: !length,
    widthMm: width,
    margins: { left: margin, right: margin, top: margin, bottom: margin },
  };
  if (length) {
    medium.lengthDots = Math.round(length * dpmm);
    medium.lengthMm = length;
    if (cfg.shape === 'round') medium.shape = 'round';
    else if (Number(cfg.cornerMm)) medium.cornerMm = Number(cfg.cornerMm);
  }
  return medium;
}

// The model entry. configure() applies the user's settings (resolution,
// head, label) and is called again whenever they change.
//
// preset: a printer from catalog/printers.rec ({ id, name, brand, status,
// source, printer: settings it fixes, defaults: label to start from,
// adjust }), or none for "Other printer", where the user sets everything.
export function genericPrinter(preset = null) {
  const fixed = preset ? Object.fromEntries(PRINTER_KEYS.map((k) => [k, preset.printer[k]])) : {};
  const model = {
    brand: preset?.brand ?? 'Other',
    name: preset ? `${preset.name} (${LANGUAGE_NAMES[fixed.language]})` : 'Other printer (ZPL, TSPL or ESC/POS)',
    status: preset?.status ?? 'experimental',
    devices: [preset
      ? { name: preset.name, status: preset.status }
      : { name: 'Other label printers speaking ZPL, TSPL or ESC/POS raster', status: 'experimental' }],
    family: 'generic',
    protocol: preset ? LANGUAGE_NAMES[fixed.language] : 'ZPL, TSPL or ESC/POS raster (you describe the printer)',
    custom: true,
    preset,
    defaultAdjust: preset?.adjust,
    transports: ['usb', 'serial'],
    // Any USB device: many of these printers use a vendor-specific class.
    usbFilters: [],
    options: [],
    note: preset
      ? `Set up from a printer report${preset.source ? ` (${preset.source})` : ''}: language, resolution and head are fixed; set your label size below.`
      : 'Experimental: describe your printer below, print the Grid test, then send a report with the settings '
        + 'that worked, so your printer can get its own entry.',
    config: { ...GENERIC_DEFAULTS },
    configure(cfg) {
      this.config = { ...GENERIC_DEFAULTS, ...preset?.defaults, ...cfg, ...fixed };
      if (preset) this.config.name = preset.name;
      this.dpi = Number(this.config.dpi) || 203;
      this.headDots = Math.max(8, Math.round(((Number(this.config.headMm) || 104) * this.dpi) / 25.4));
      this.media = [customMedium(this.config, this.dpi, this.headDots)];
      return this;
    },
    encode(bitmap, medium) {
      const encode = ENCODERS[this.config.language] ?? encodeZpl;
      return encode(bitmap, this.config, { continuous: !!medium.continuous, dpmm: this.dpi / 25.4 });
    },
  };
  return model.configure({});
}

// A catalog/printers.rec record for these settings, for a maintainer to add
// once a report says they work.
export function printerRecord(cfg, adjust = {}, source = '(link to this issue)') {
  const name = cfg.name || 'Make and model';
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'printer';
  const lines = [
    `Id: ${slug}`,
    `Name: ${name}`,
    `Brand: ${name.split(/\s+/)[0]}`,
    `Language: ${cfg.language}`,
    `Dpi: ${cfg.dpi}`,
    `HeadMm: ${cfg.headMm}`,
    `Rotate: ${cfg.rotate ? 'yes' : 'no'}`,
    `DefaultWidthMm: ${cfg.widthMm}`,
    `DefaultLengthMm: ${cfg.lengthMm || 0}`,
  ];
  if (cfg.language === 'tspl') lines.push(`GapMm: ${cfg.gapMm}`);
  if (adjust.feedMm) lines.push(`FeedMm: ${adjust.feedMm}`);
  if (adjust.acrossMm) lines.push(`AcrossMm: ${adjust.acrossMm}`);
  lines.push('Status: experimental', `Source: ${source}`);
  return lines.join('\n');
}
