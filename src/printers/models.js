// Printer models: how to reach and drive each printer. The labels and tapes
// each one takes (`media`) come from catalog/media.rec, loaded by catalog.js:
// a model gets every record of its `family` that fits its head.
// A medium describes the printable strip: `acrossDots` dots across the head,
// and either a fixed `lengthDots` (die-cut labels) or continuous media whose
// length comes from the design.
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

// ---- DYMO LabelWriter 400 / 450 / 4XL ----

const DYMO_NOTE = 'The LabelWriter cannot report which labels are loaded, so pick the media yourself.';

function labelWriter({ name, status, devices, headDots = 672, productIds, rollSelect = false }) {
  const options = [
    { id: 'density', label: 'Darkness', type: 'select', default: 'normal', choices: ['light', 'medium', 'normal', 'dark'] },
  ];
  if (rollSelect) {
    options.push({ id: 'roll', label: 'Roll', type: 'select', default: 'auto', choices: ['auto', 'left', 'right'] });
  }
  return {
    brand: 'DYMO',
    name,
    status,
    devices: devices ?? [{ name, status }],
    family: 'dymo-lw',
    dpi: 300,
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
    note: DYMO_NOTE,
    options,
    encode(bitmap, medium, opts) {
      return encodeLabelWriter(bitmap, {
        continuous: !!medium.continuous,
        density: opts.density,
        headDots,
        roll: rollSelect ? opts.roll : undefined,
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
    dpi: 180,
    headDots: HEAD_DOTS,
    maxWidthMm: maxTapeMm,
    transports: bluetooth ? ['usb', 'serial'] : ['usb'],
    usbFilters: [{ vendorId: 0x04f9, productId }],
    media: [],
    options: quirks.precut === false ? [] : [
      { id: 'autoCut', label: 'Cut after label', type: 'checkbox', default: true },
    ],
    note,
    encode(bitmap, medium, opts) {
      return encodePTouch(bitmap, { autoCut: opts.autoCut, quirks, tapeMm: medium.statusMm, tailDots: Math.round((PT_TAIL_MM * 180) / 25.4) });
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

const QL_NOTE = 'Brother QL: print 62 mm and narrower DK rolls; the QL-1050, QL-1060N and QL-1100 series also take 102 mm rolls.';
const EDITOR_LITE = 'Turn off Editor Lite (hold its button until the light goes out): in that mode the printer appears as a USB drive, not a printer.';

function brotherQL(name, { editorLite = false } = {}) {
  const params = qlParams(name);
  return {
    brand: 'Brother QL',
    name: `Brother ${name}`,
    status: 'experimental',
    devices: [{ name: `Brother ${name}`, status: 'experimental' }],
    family: 'brother-ql',
    dpi: 300,
    headDots: params.bytesPerRow * 8,
    transports: ['usb'],
    usbFilters: [{ vendorId: 0x04f9, classCode: 7 }],
    media: [],
    // The QL-500 has no automatic cutter.
    options: params.cutting ? [{ id: 'autoCut', label: 'Cut after label', type: 'checkbox', default: true }] : [],
    note: editorLite ? `${QL_NOTE} ${EDITOR_LITE}` : QL_NOTE,
    encode(bitmap, medium, opts) {
      return encodeQL(bitmap, medium, params, { cut: params.cutting && (opts.autoCut ?? true) });
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
      { name: 'DYMO LabelWriter 450', status: 'tested' },
      { name: 'DYMO LabelWriter 450 Turbo', status: 'experimental' },
      { name: 'DYMO LabelWriter 400 / 400 Turbo', status: 'experimental' },
      { name: 'DYMO LabelWriter 450 Duo (label side)', status: 'experimental' },
    ],
  }),
  'dymo-lw450tt': labelWriter({ name: 'DYMO LabelWriter 450 Twin Turbo', status: 'experimental', productIds: [0x0022], rollSelect: true }),
  'dymo-lw4xl': labelWriter({ name: 'DYMO LabelWriter 4XL', status: 'experimental', headDots: 1248, productIds: [0x0025] }),

  'brother-pt-p710bt': pTouch({
    name: 'Brother PT-P710BT',
    status: 'tested',
    devices: [
      { name: 'Brother PT-P710BT (USB)', status: 'tested', connection: 'USB' },
      { name: 'Brother PT-P710BT (Bluetooth)', status: 'experimental', connection: 'Bluetooth' },
    ],
    productId: 0x20af,
    bluetooth: true,
  }),
  'brother-pt-p700': pTouch({ name: 'Brother PT-P700', status: 'experimental', productId: 0x2061, quirks: { p700Init: true }, note: `${PT_NOTE} ${PLITE}` }),
  'brother-pt-p750w': pTouch({ name: 'Brother PT-P750W', status: 'experimental', productId: 0x2062, quirks: { p700Init: true, precut: false }, note: `${PT_NOTE} ${PLITE}` }),
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
  'brother-ql-570': brotherQL('QL-570'),
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

};

const NO_MARGINS = { left: 0, right: 0, top: 0, bottom: 0 };

export function mediumMargins(medium) {
  return medium.margins ?? NO_MARGINS;
}
