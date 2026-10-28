// SPDX-License-Identifier: GPL-3.0-or-later
// Printer models: how to reach and drive each printer. The labels and tapes
// each one takes (`media`) come from catalog/media.rec, loaded by catalog.js:
// a model gets every record of its `family` that fits its head.
// A medium describes the label or tape: `acrossDots` dots across the head,
// and either a fixed `lengthDots` (die-cut labels) or continuous media whose
// length comes from the design. Brother media also have a `band`, the part
// the printer can print on ({ y, h } across, and { x, w } along a die-cut
// label); the job sent to the printer is that band (see layout.js).
//
// `status` is shown in the printer menu; `devices` lists the printers a model
// entry drives, each with its own status, for the README compatibility table:
//   tested        printed on real hardware
//   experimental  uses a protocol path checked against a reference
//                 implementation, but not yet printed on this device
import { encodeLabelWriter } from './dymo-labelwriter.js';
import {
  encodePTouch, initCommand, STATUS_REQUEST, parseStatus, HEAD_DOTS,
} from './brother-ptouch.js';
import { encodeQL, qlParams, parseQLStatus } from './brother-ql.js';
import { genericPrinter } from './generic.js';

// Print quality, on printers with a 300 x 600 dpi mode: twice the raster
// lines along the feed, for barcode bars sized to 1/600 inch and smoother
// text (slower). Auto uses it when a barcode's bars run along the feed.
const QUALITY = {
  id: 'quality', label: 'Print quality', type: 'select', default: 'auto',
  choices: [['auto', 'Auto (600 dpi for barcodes)'], ['standard', 'Standard (300 dpi)'], ['high', 'High (300 × 600 dpi, slower)']],
};

// ---- DYMO LabelWriter 400 / 450 / 4XL ----

const DYMO_NOTE = 'The LabelWriter cannot report which labels are loaded, so pick the media yourself.';

function labelWriter({ name, status, devices, dpi = 300, headDots = 672, productIds, rollSelect = false, se450 = false, note = DYMO_NOTE }) {
  const options = [
    { id: 'density', label: 'Darkness', type: 'select', default: 'normal', choices: ['light', 'medium', 'normal', 'dark'] },
  ];
  if (rollSelect) {
    options.push({ id: 'roll', label: 'Roll', type: 'select', default: 'auto', choices: ['auto', 'left', 'right'] });
  }
  if (!se450) options.push(QUALITY);
  return {
    brand: 'DYMO',
    name,
    status,
    devices: devices ?? [{ name, status }],
    family: 'dymo-lw',
    protocol: se450 ? 'DYMO LabelWriter raster (SE450 subset)' : 'DYMO LabelWriter raster',
    dpi,
    highRes: !se450,
    headDots,
    transports: ['usb'],
    // 0x0922 is DYMO; class 7 is USB Printer.
    usbFilters: productIds
      ? productIds.map((productId) => ({ vendorId: 0x0922, productId }))
      : [{ vendorId: 0x0922, classCode: 7 }],
    // The LabelWriter starts printing about 5.8 mm after the label's leading
    // edge (the gap sensor sits ahead of the head), which is the leading
    // margin in DYMO's PPD. Leave that part of the label out of the job so
    // the rest lands where the preview shows it and the job ends at the
    // label's end. Measured on a real LW450: 6 mm.
    skipLeadingMargin: true,
    // Die-cut labels sit on a liner wider than the label, and the head is
    // wider than most labels: an overprint border past the label edge
    // prints on the liner (see layout.js).
    overprint: true,
    media: [],
    note,
    options,
    encode(bitmap, medium, opts) {
      return encodeLabelWriter(bitmap, {
        continuous: !!medium.continuous,
        density: opts.density,
        headDots,
        roll: rollSelect ? opts.roll : undefined,
        se450,
        highRes: opts.highRes,
      });
    },
  };
}

// ---- Brother P-touch (TZe tape, 180 dpi, 128-dot head) ----
// Per-model quirks and USB product IDs from ptouch-print's device table
// (Copyright (C) 2013-2026 Dominic Radermacher, GPL-3.0).

const PT_NOTE = 'P-touch printers leave a little blank tape before and after the print (on a PT-P710BT: about 4.5 mm before, 2 mm after).';
const PLITE = 'Turn off its P-Lite (Editor Lite) mode: in that mode it appears as a USB drive, not a printer.';

// A PT-P710BT leaves off the last ~2.8 mm of the raster data (a 60 mm grid
// printed only to 57.2 mm), so jobs end with that much blank tape. Assumed
// for the other P-touch models, which share the mechanism.
const PT_TAIL_MM = 2.8;

function pTouch({ name, status, devices, productId, maxTapeMm = 24, quirks = {}, bluetooth = false, note = PT_NOTE }) {
  return {
    brand: 'Brother P-touch',
    name,
    status,
    devices: devices ?? [{ name, status }],
    family: 'brother-pt',
    protocol: 'Brother P-touch raster',
    dpi: 180,
    headDots: HEAD_DOTS,
    maxWidthMm: maxTapeMm,
    transports: bluetooth ? ['usb', 'serial'] : ['usb'],
    usbFilters: [{ vendorId: 0x04f9, productId }],
    media: [],
    options: [
      ...(quirks.precut === false && !quirks.halfCut ? [] : [{ id: 'autoCut', label: 'Cut after label', type: 'checkbox', default: true }]),
      ...(quirks.halfCut ? [{ id: 'halfCut', label: 'Half cut between copies (easy peel strip)', type: 'checkbox', default: false }] : []),
      ...(quirks.halfCut || quirks.advanced ? [{
        id: 'chain', type: 'checkbox', default: false,
        label: 'Chain printing: save tape (the last label stays in the printer until the next print)',
      }] : []),
    ],
    note,
    encode(bitmap, medium, opts) {
      return this.encodePages([bitmap], medium, opts);
    },
    // Copies go in one job, a page each: less blank tape, and on models with
    // a half cutter they can stay on one strip.
    encodePages(bitmaps, medium, opts) {
      return encodePTouch(bitmaps, {
        autoCut: opts.autoCut, halfCut: opts.halfCut, chain: opts.chain, quirks, tapeMm: medium.statusMm, tailDots: Math.round((PT_TAIL_MM * 180) / 25.4),
      });
    },
    async queryStatus(transport) {
      await transport.write(initCommand());
      await transport.write(STATUS_REQUEST);
      const buf = await transport.read(32, 3000);
      const parsed = parseStatus(buf);
      if (!parsed) throw new Error('Printer did not return a valid status reply.');
      const medium = this.media.find((m) => m.statusMm === parsed.tapeMm) ?? null;
      return { ...parsed, mediumId: medium?.id ?? null };
    },
  };
}

// ---- Brother QL (DK rolls, 300 dpi) ----
// Model parameters from brother_ql; see brother-ql.js.

const QL_NOTE = 'Brother QL: print 62 mm and narrower DK rolls; the QL-1050, QL-1060N and QL-1100 series also take 102 mm rolls. Measured on a QL-570: on 62 mm stock it prints to about 1.5 mm from each long edge of the label (the backing extends a little further), and on continuous rolls it leaves about 3 mm of blank tape before and after the print.';
const EDITOR_LITE = 'Turn off Editor Lite (hold its button until the light goes out): in that mode the printer appears as a USB drive, not a printer.';

function brotherQL(name, { editorLite = false, status = 'experimental' } = {}) {
  const params = qlParams(name);
  return {
    brand: 'Brother QL',
    name: `Brother ${name}`,
    status,
    // What has been tried on hardware, beyond the plain print (see compat.js).
    devices: [{
      name: `Brother ${name}`,
      status,
      note: status === 'tested' && params.highRes ? 'printing and cutting tested; 300 × 600 dpi and batches not yet' : undefined,
    }],
    family: 'brother-ql',
    protocol: 'Brother QL raster',
    // The strip's right end prints first (see brother-ql.js).
    leadingEnd: 'end',
    dpi: 300,
    highRes: params.highRes && params.expandedMode,
    headDots: params.bytesPerRow * 8,
    transports: ['usb'],
    usbFilters: [{ vendorId: 0x04f9, classCode: 7 }],
    media: [],
    // The QL-500 has no automatic cutter.
    options: [
      ...(params.cutting ? [{ id: 'autoCut', label: 'Cut after label', type: 'checkbox', default: true }] : []),
      ...(params.highRes && params.expandedMode ? [QUALITY] : []),
    ],
    note: editorLite ? `${QL_NOTE} ${EDITOR_LITE}` : QL_NOTE,
    encode(bitmap, medium, opts) {
      return encodeQL(bitmap, medium, params, { cut: params.cutting && (opts.autoCut ?? true), highRes: opts.highRes });
    },
    async queryStatus(transport) {
      const init = new Uint8Array(params.invalidateBytes + 5);
      init.set([0x1b, 0x40, 0x1b, 0x69, 0x53], params.invalidateBytes); // invalidate, ESC @, ESC i S
      await transport.write(init);
      const parsed = parseQLStatus(await transport.read(32, 3000));
      if (!parsed) throw new Error('Printer did not return a valid status reply.');
      const medium = this.media.find((m) => Math.round(m.widthMm) === parsed.tapeMm
        && m.continuous === parsed.continuous
        && (m.continuous || Math.round(m.lengthMm) === parsed.lengthMm)) ?? null;
      return { ...parsed, mediumId: medium?.id ?? null };
    },
  };
}

// Model ids are kept stable: saved designs refer to them.
export const MODELS = {
  'dymo-lw450': labelWriter({
    name: 'DYMO LabelWriter 450 / 450 Turbo / 400',
    status: 'tested',
    devices: [
      { name: 'DYMO LabelWriter 450', status: 'tested', note: '300 × 600 dpi tested' },
      { name: 'DYMO LabelWriter 450 Turbo', status: 'experimental' },
      { name: 'DYMO LabelWriter 400 / 400 Turbo', status: 'experimental' },
      { name: 'DYMO LabelWriter 450 Duo (label side)', status: 'experimental' },
    ],
  }),
  'dymo-lw450tt': labelWriter({ name: 'DYMO LabelWriter 450 Twin Turbo', status: 'experimental', productIds: [0x0022], rollSelect: true }),
  'dymo-lw4xl': labelWriter({ name: 'DYMO LabelWriter 4XL', status: 'experimental', headDots: 1248, productIds: [0x0025] }),
  // 203 dpi, 448-dot head, the 450's raster commands without ESC G (DYMO's
  // LabelWriter SE450 Technical Reference). USB only here, not its serial port.
  'dymo-lwse450': labelWriter({
    name: 'DYMO LabelWriter SE450', status: 'experimental', dpi: 203, headDots: 448, productIds: [0x0400], se450: true,
    note: `${DYMO_NOTE} The SE450 prints at 203 dpi; it is driven over USB here (its serial port and ASCII commands are not used).`,
  }),

  'brother-pt-p710bt': pTouch({
    name: 'Brother PT-P710BT',
    status: 'tested',
    devices: [
      { name: 'Brother PT-P710BT (USB)', status: 'tested', connection: 'USB' },
      { name: 'Brother PT-P710BT (Bluetooth)', status: 'experimental', connection: 'Bluetooth' },
    ],
    productId: 0x20af,
    bluetooth: true,
    // Chain printing (ESC i K), per Brother's raster reference; no half cutter.
    quirks: { advanced: true },
  }),
  'brother-pt-p700': pTouch({ name: 'Brother PT-P700', status: 'experimental', productId: 0x2061, quirks: { p700Init: true }, note: `${PT_NOTE} ${PLITE}` }),
  // Has a half cutter (Brother's raster reference for the E550W/P750W/P710BT).
  'brother-pt-p750w': pTouch({ name: 'Brother PT-P750W', status: 'experimental', productId: 0x2062, quirks: { p700Init: true, precut: false, halfCut: true }, note: `${PT_NOTE} ${PLITE}` }),
  'brother-pt-h500': pTouch({ name: 'Brother PT-H500', status: 'experimental', productId: 0x205e }),
  'brother-pt-e500': pTouch({ name: 'Brother PT-E500', status: 'experimental', productId: 0x205f, quirks: { precut: false } }),
  'brother-pt-d600': pTouch({ name: 'Brother PT-D600', status: 'experimental', productId: 0x2074, quirks: { precut: false } }),
  'brother-pt-d410': pTouch({ name: 'Brother PT-D410', status: 'experimental', productId: 0x20df, maxTapeMm: 18, quirks: { packbits: false, infoCmd: true, magic: true } }),
  'brother-pt-d460bt': pTouch({ name: 'Brother PT-D460BT', status: 'experimental', productId: 0x20e0, maxTapeMm: 18, bluetooth: true, quirks: { packbits: false, p700Init: true, infoCmd: true, magic: true } }),
  'brother-pt-d610bt': pTouch({ name: 'Brother PT-D610BT', status: 'experimental', productId: 0x20e1, bluetooth: true, quirks: { packbits: false, p700Init: true, infoCmd: true, magic: true } }),
  'brother-pt-e310bt': pTouch({ name: 'Brother PT-E310BT', status: 'experimental', productId: 0x2201, maxTapeMm: 18, bluetooth: true, quirks: { packbits: false, p700Init: true, infoCmd: true, precut: false, magic: true } }),
  'brother-pt-e560bt': pTouch({ name: 'Brother PT-E560BT', status: 'experimental', productId: 0x2203, bluetooth: true, quirks: { packbits: false, p700Init: true, infoCmd: true, precut: false, magic: true } }),

  'brother-ql-500': brotherQL('QL-500'),
  'brother-ql-550': brotherQL('QL-550'),
  'brother-ql-560': brotherQL('QL-560'),
  // Printed and cut on a real QL-570.
  'brother-ql-570': brotherQL('QL-570', { status: 'tested' }),
  'brother-ql-580n': brotherQL('QL-580N'),
  'brother-ql-650td': brotherQL('QL-650TD'),
  'brother-ql-700': brotherQL('QL-700', { editorLite: true }),
  'brother-ql-710w': brotherQL('QL-710W'),
  'brother-ql-720nw': brotherQL('QL-720NW'),
  'brother-ql-800': brotherQL('QL-800', { editorLite: true }),
  'brother-ql-810w': brotherQL('QL-810W', { editorLite: true }),
  'brother-ql-820nwb': brotherQL('QL-820NWB', { editorLite: true }),
  'brother-ql-1050': brotherQL('QL-1050'),
  'brother-ql-1060n': brotherQL('QL-1060N'),
  'brother-ql-1100': brotherQL('QL-1100'),
  'brother-ql-1110nwb': brotherQL('QL-1110NWB'),
  'brother-ql-1115nwb': brotherQL('QL-1115NWB'),

  // Anything else, described by the user (see generic.js).
  generic: genericPrinter(),

};

const NO_MARGINS = { left: 0, right: 0, top: 0, bottom: 0 };

export function mediumMargins(medium) {
  return medium.margins ?? NO_MARGINS;
}
