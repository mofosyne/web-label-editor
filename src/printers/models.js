// Printer models and media. A medium describes the printable strip:
// `acrossDots` dots across the head, and either a fixed `lengthDots`
// (die-cut labels) or continuous media whose length comes from the design.
import { encodeLabelWriter } from './dymo-labelwriter.js';
import {
  encodePTouch, initCommand, STATUS_REQUEST, parseStatus, TAPES,
} from './brother-ptouch.js';

const mmToDots = (mm, dpi) => Math.round((mm * dpi) / 25.4);
const ptToDots = (pt, dpi) => Math.round((pt * dpi) / 72);

export const MODELS = {
  'dymo-lw450': {
    name: 'DYMO LabelWriter 450',
    dpi: 300,
    transports: ['usb'],
    // 0x0922 is DYMO; class 7 is USB Printer. Covers 450 / Turbo / Twin / 4XL.
    usbFilters: [{ vendorId: 0x0922, classCode: 7 }],
    // Sizes from DYMO's lw450.ppd (PaperDimension, in points).
    media: [
      { id: 'cont-54', name: 'Continuous 54 mm (paper roll)', acrossDots: ptToDots(153.12, 300), continuous: true },
      { id: '30252', name: '30252 Address 28 × 89 mm', acrossDots: ptToDots(78.96, 300), lengthDots: ptToDots(252, 300) },
      { id: '99012', name: '99012 Large Address 36 × 89 mm', acrossDots: ptToDots(101.28, 300), lengthDots: ptToDots(251.04, 300) },
      { id: '11354', name: '11354 Multi-purpose 57 × 32 mm', acrossDots: 672, lengthDots: ptToDots(90, 300) },
      { id: '11355', name: '11355 Multi-purpose 19 × 51 mm', acrossDots: ptToDots(54, 300), lengthDots: ptToDots(144, 300) },
    ],
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
    media: TAPES.map((t) => ({
      id: `tze-${t.mm}`,
      name: `TZe ${t.mm} mm tape`,
      tapeMm: t.mm,
      statusMm: t.statusMm,
      acrossDots: t.dots,
      continuous: true,
    })),
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

export function mediumLengthMm(medium, dpi) {
  return medium.lengthDots ? (medium.lengthDots * 25.4) / dpi : null;
}

export { mmToDots };
