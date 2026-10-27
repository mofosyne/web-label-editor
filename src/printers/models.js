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
// Per-model quirks and USB product IDs from ptouch-print's device table.

const PT_NOTE = 'P-touch printers feed roughly 25 mm of blank leader tape before each print; this is a hardware limit.';
const PLITE = 'Turn off its P-Lite (Editor Lite) mode: in that mode it appears as a USB drive, not a printer.';

function pTouch({ name, status, productId, maxTapeMm = 24, quirks = {}, bluetooth = false, note = PT_NOTE }) {
  return {
    brand: 'Brother P-touch',
    name,
    status,
    devices: [{ name, status }],
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
      return encodePTouch(bitmap, { autoCut: opts.autoCut, quirks, tapeMm: medium.statusMm });
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

  'brother-pt-p710bt': pTouch({ name: 'Brother PT-P710BT', status: 'experimental', productId: 0x20af, bluetooth: true }),
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
};

const NO_MARGINS = { left: 0, right: 0, top: 0, bottom: 0 };

export function mediumMargins(medium) {
  return medium.margins ?? NO_MARGINS;
}
