// Printer compatibility, generated from the models so the README table and
// the in-app help never disagree with the code. Supported devices and their
// status come from MODELS (each model's `devices`); devices not supported yet
// are listed here.
//
// Update the README table with:  npm run docs

export const UNIMPLEMENTED = [
  { brand: 'DYMO', name: 'DYMO LabelWriter SE450', why: 'Same protocol with a narrower 448-dot head; not wired up yet.' },
  { brand: 'DYMO', name: 'DYMO LabelManager (D1 tape)', why: 'Different protocol, and it first appears as a USB drive.' },
  { brand: 'Brother P-touch', name: 'Brother PT-P900 / P900W / P950NW', why: '360 dpi with a 560-dot head; needs its own tape table.' },
  { brand: 'Brother P-touch', name: 'Brother PT-P300BT', why: 'Bluetooth Low Energy only.' },
  { brand: 'Brother QL', name: 'Brother QL-500 / 550 / 560 / 570 / 580N / 650TD / 1050 / 1060N', why: 'Older models; same protocol family, not added yet.' },
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
};

function mediaSummary(model) {
  const widths = model.media.map((m) => m.widthMm).filter(Number.isFinite);
  if (!widths.length) return FAMILY_MEDIA[model.family] ?? '';
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
        rows.push({ brand, name: d.name, status: d.status, connection: connection(model), media: mediaSummary(model) });
      }
    }
    for (const u of UNIMPLEMENTED.filter((x) => x.brand === brand)) {
      rows.push({ brand, name: u.name, status: 'unimplemented', connection: '', media: u.why });
    }
  }
  return rows;
}

export function compatMarkdown(models) {
  const lines = [
    '| Printer | Status | Connection | Labels / notes |',
    '|---|---|---|---|',
    ...compatRows(models).map((r) => `| ${r.name} | ${STATUS_LABEL[r.status]} | ${r.connection} | ${r.media} |`),
  ];
  const notPlanned = NOT_PLANNED.map((n) => `- **${n.name}**: not planned. ${n.why}`);
  return [
    ...lines,
    '',
    '✅ **Tested**: printed on real hardware. 🧪 **Experimental**: uses a protocol path checked against a',
    'reference implementation, but nobody has printed on that model with this app yet; reports welcome.',
    '⬜ **Unimplemented**: not supported yet.',
    '',
    ...notPlanned,
  ].join('\n');
}
