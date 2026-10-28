// Credits: the projects and documents this editor's printer support and
// data come from. Shown in the help (Other tools tab) and generated into
// the README by `npm run docs`. No third-party code is bundled: the
// protocols are re-implemented from these sources and checked against them
// in the tests.

const gh = (path) => `https://github.com/${path}`;

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
  const lines = ['This editor stands on work others did first. No third-party code is bundled: the protocols are re-implemented from these sources and checked against them in the tests.'];
  for (const { group, items } of CREDITS) {
    lines.push('', `**${group}**`, '');
    for (const [name, url, what] of items) lines.push(`- ${url ? `[${name}](${url})` : name}: ${what}`);
  }
  return lines.join('\n');
}
