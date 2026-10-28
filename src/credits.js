// Credits: the projects and documents this editor's printer support,
// barcodes and data come from, including the code ported from them. Shown
// in the help (Other tools & credits tab) and generated into the README by
// `npm run docs`.

const gh = (path) => `https://github.com/${path}`;

export const CREDITS_INTRO = 'This editor stands on work others did first. No third-party files are bundled, but '
  + 'parts of the code are ports of the projects below, kept under licences compatible with this project\'s GPL-3.0 '
  + 'and credited in each file; the tests check the ports against their sources\' behaviour.';

export const CREDITS = [
  {
    group: 'Printer protocols',
    items: [
      ['ptouch-print', 'https://git.familie-radermacher.ch/linux/ptouch-print.git', 'by Dominic Radermacher: the Brother P-touch raster protocol, per-model quirks, USB IDs and the tape table (printable dots per TZe width).'],
      ['brother_ql', gh('pklaus/brother_ql'), 'by Philipp Klaus: the Brother QL raster protocol, per-model parameters and the DK label table (sizes, printable dots, offsets).'],
      ['dymo-cups-drivers', gh('matthiasbock/dymo-cups-drivers'), 'DYMO\'s open-source CUPS drivers: the LabelWriter command set, and the PPD files (lw450.ppd, lw4xl.ppd) that give each DYMO label\'s size and printable area.'],
      ['Brother and DYMO technical references', null, 'the makers\' raster command references, as documented by the projects above.'],
    ],
  },
  {
    group: 'Ported code (which of our files comes from where)',
    items: [
      ['src/printers/brother-ptouch.js, the P-touch models and tape table', 'https://git.familie-radermacher.ch/linux/ptouch-print.git', 'ported from ptouch-print\'s libptouch.c and device table; Copyright (C) 2013-2026 Dominic Radermacher, GPL-3.0.'],
      ['src/printers/brother-ql.js, the QL models and DK label table', gh('pklaus/brother_ql'), 'ported from brother_ql\'s conversion.py, raster.py, models.py and labels.py; by Philipp Klaus, GPL-3.0.'],
      ['src/printers/dymo-labelwriter.js, the DYMO label sizes and margins', gh('matthiasbock/dymo-cups-drivers'), 'ported from DYMO\'s LabelWriterDriver.cpp and taken from its lw450.ppd and lw4xl.ppd; Copyright (C) 2008 Sanford L.P., GPL-2.0-or-later.'],
      ['src/codes/qr.js', 'https://www.nayuki.io/page/qr-code-generator-library', 'follows Project Nayuki\'s QR Code generator library (tables, Reed–Solomon, placement, masking); Copyright (c) Project Nayuki, MIT License, whose notice is in the file.'],
    ],
  },
  {
    group: 'Standards and tools',
    items: [
      ['ISO/IEC 18004 (QR Code), Code 128, EAN-13 and UPC-A', null, 'the specifications the barcode encoders follow.'],
      ['zxing-cpp', gh('zxing-cpp/zxing-cpp'), 'the barcode reader used to check that every QR version and level, and the linear codes, decode.'],
      ['GNU recutils', 'https://www.gnu.org/software/recutils/', 'the format of the label catalogue (catalog/media.rec); the tests check it with recsel and recfix.'],
    ],
  },
  {
    group: 'Measurements',
    items: [
      ['Hardware tests', null, 'the LabelWriter 450 leading margin, the PT-P710BT margins and print length, and the DYMO 30252 calibration were measured on real printers by the project\'s author. Your printer reports add to this.'],
    ],
  },
];

export function creditsMarkdown() {
  const lines = [CREDITS_INTRO];
  for (const { group, items } of CREDITS) {
    lines.push('', `**${group}**`, '');
    for (const [name, url, what] of items) lines.push(`- ${url ? `[${name}](${url})` : name}: ${what}`);
  }
  return lines.join('\n');
}
