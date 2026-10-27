// Printer models: how to reach and drive each printer. The labels and tapes
// each one takes (`media`) come from catalog/media.rec, loaded by catalog.js.
// A medium describes the printable strip: `acrossDots` dots across the head,
// and either a fixed `lengthDots` (die-cut labels) or continuous media whose
// length comes from the design.
import { encodeLabelWriter } from './dymo-labelwriter.js';
import {
  encodePTouch, initCommand, STATUS_REQUEST, parseStatus, HEAD_DOTS,
} from './brother-ptouch.js';

export const MODELS = {
  'dymo-lw450': {
    name: 'DYMO LabelWriter 450',
    dpi: 300,
    transports: ['usb'],
    // 0x0922 is DYMO; class 7 is USB Printer. Covers 450 / Turbo / Twin / 4XL.
    usbFilters: [{ vendorId: 0x0922, classCode: 7 }],
    headDots: 672,
    media: [],
    note: 'The LabelWriter 450 cannot report which labels are loaded, so pick the media yourself.',
    options: [
      { id: 'density', label: 'Darkness', type: 'select', default: 'normal', choices: ['light', 'medium', 'normal', 'dark'] },
    ],
    encode(bitmap, medium, opts) {
      return encodeLabelWriter(bitmap, { continuous: !!medium.continuous, density: opts.density });
    },
  },

  'brother-pt-p710bt': {
    name: 'Brother PT-P710BT',
    dpi: 180,
    transports: ['usb', 'serial'],
    usbFilters: [{ vendorId: 0x04f9, productId: 0x20af }],
    headDots: HEAD_DOTS,
    media: [],
    options: [
      { id: 'autoCut', label: 'Cut after label', type: 'checkbox', default: true },
    ],
    // Brother leaves a fixed unprintable leader before and after the print.
    note: 'The PT-P710BT feeds roughly 25 mm of blank leader tape before each print; this is a hardware limit.',
    encode(bitmap, medium, opts) {
      return encodePTouch(bitmap, { autoCut: opts.autoCut });
    },
    async queryStatus(transport) {
      await transport.write(initCommand());
      await transport.write(STATUS_REQUEST);
      const buf = await transport.read(32, 3000);
      const status = parseStatus(buf);
      if (!status) throw new Error('Printer did not return a valid status reply.');
      const medium = this.media.find((m) => m.statusMm === status.tapeMm) ?? null;
      return { ...status, mediumId: medium?.id ?? null };
    },
  },
};

const NO_MARGINS = { left: 0, right: 0, top: 0, bottom: 0 };

export function mediumMargins(medium) {
  return medium.margins ?? NO_MARGINS;
}

