// SPDX-License-Identifier: GPL-3.0-or-later
// Printer compatibility, generated from the models so the README table and
// the in-app help never disagree with the code. Supported devices and their
// status come from MODELS (each model's `devices`); devices not supported yet
// are listed here.
//
// Update the README table with:  npm run docs

import { REPO_URL } from './report.js';

export const PRINTER_REPORT_URL = `${REPO_URL}/issues/new?template=printer-report.yml`;
export const LABEL_REQUEST_URL = `${REPO_URL}/issues/new?template=label-request.yml`;

export const UNIMPLEMENTED = [
  { brand: 'DYMO', name: 'DYMO LabelManager PnP / 280 / 420P / 500TS (D1 tape label makers)', protocol: 'DYMO LabelManager', why: 'DYMO\'s tape label makers, like P-touch. Different protocol, and some first appear as a USB drive; Labelle supports them.' },
  { brand: 'Brother P-touch', name: 'Brother PT-P900 / P900W / P950NW', protocol: 'Brother P-touch raster', why: '360 dpi with a 560-dot head; needs its own tape table.' },
  { brand: 'Brother P-touch', name: 'Brother PT-P300BT', protocol: 'Brother PT-P300BT (BLE)', why: 'Bluetooth Low Energy only.' },
];

// Printers deliberately left out.
export const NOT_PLANNED = [
  { name: 'DYMO LabelWriter 550 / 550 Turbo / 5XL', why: 'Only print on DYMO labels with an authentication chip.' },
];

export const STATUS_LABEL = {
  tested: '✅ Tested',
  experimental: '🧪 Experimental',
  unimplemented: '⬜ Unimplemented',
};

const FAMILY_MEDIA = {
  'dymo-lw': 'LabelWriter labels',
  'brother-pt': 'TZe tape',
  'brother-ql': 'DK rolls and labels',
  generic: 'Any size you enter',
};

function mediaSummary(model) {
  const widths = model.media.map((m) => m.widthMm).filter(Number.isFinite);
  if (!widths.length || model.custom) return FAMILY_MEDIA[model.family] ?? '';
  const max = Math.max(...widths);
  return `${FAMILY_MEDIA[model.family]}, up to ${Math.round(max)} mm`;
}

function connection(model) {
  return model.transports.includes('serial') ? 'USB, Bluetooth' : 'USB';
}

// Rows in display order: brands as they appear in MODELS, supported devices
// first, then unimplemented ones.
export function compatRows(models) {
  const rows = [];
  const brands = [...new Set(Object.values(models).map((m) => m.brand))];
  for (const brand of brands) {
    for (const model of Object.values(models).filter((m) => m.brand === brand)) {
      for (const d of model.devices) {
        rows.push({
          brand, name: d.name, status: d.status, protocol: model.protocol ?? '', connection: d.connection ?? connection(model), media: mediaSummary(model),
        });
      }
    }
    for (const u of UNIMPLEMENTED.filter((x) => x.brand === brand)) {
      rows.push({ brand, name: u.name, status: 'unimplemented', protocol: u.protocol ?? '', connection: '', media: u.why });
    }
  }
  return rows;
}

export function compatMarkdown(models) {
  const lines = [
    '| Printer | Status | Protocol | Connection | Labels / notes |',
    '|---|---|---|---|---|',
    ...compatRows(models).map((r) => `| ${r.name} | ${STATUS_LABEL[r.status]} | ${r.protocol} | ${r.connection} | ${r.media} |`),
  ];
  const notPlanned = NOT_PLANNED.map((n) => `- **${n.name}**: not planned. ${n.why}`);
  return [
    ...lines,
    '',
    `**Tried a printer?** [Report how it went](${PRINTER_REPORT_URL}), whether it worked or not: reports are how`,
    `printers move from 🧪 to ✅. **Missing a label or tape size?** [Request it](${LABEL_REQUEST_URL}).`,
    'The app links to these forms pre-filled with your printer, label, OS and browser.',
    '',
    '✅ **Tested**: printed on real hardware. 🧪 **Experimental**: uses a protocol path checked against a',
    'reference implementation, but nobody has printed on that model with this app yet.',
    '⬜ **Unimplemented**: not supported yet.',
    '',
    ...notPlanned,
  ].join('\n');
}
