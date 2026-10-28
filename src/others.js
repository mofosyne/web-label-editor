// SPDX-License-Identifier: GPL-3.0-or-later
// Other open-source label printer projects, shown in the help ("Other
// tools") and generated into the README by `npm run docs`, so people can
// find something that fits them and developers can build on existing work
// rather than redo it. Descriptions come from each project's own summary.
//
// Two levels: label editors (what this project is an alternative to) and the
// libraries, drivers and command-line tools underneath.

const gh = (path) => `https://github.com/${path}`;

// Where this editor aims to be the right tool, and where another one is.
export const AIMS = [
  'You have a **DYMO LabelWriter** (400 / 450 family) and/or a **Brother P-touch** (or QL) and want one editor for both, in the browser on Linux, Windows, macOS and ChromeOS (Windows needs a one-time driver switch for USB).',
  'You print on **continuous rolls or tape**, where the label is as long as its content.',
  'You want to **edit text right on the label** (click it and type) and have it **fit**: sized automatically to its box, never cut off, as in the original DYMO Label software.',
  'Position matters: the preview shows the **true printable area**, and test prints and **per-roll calibration** handle third-party label stock.',
  'You want to **see the label at its real size** on screen before printing: calibrate once with a bank card, then hold the label or the thing it goes on up to the screen.',
];

export const LOOK_ELSEWHERE = [
  ['You mostly print batches from a spreadsheet, or onto A4 / Letter sticker sheets', 'burnmark', 'https://burnmark.app'],
  ['You only use a Brother P-touch and want templates, CSV data or P-touch Editor files', 'labelpeel', gh('LookLeft/labelpeel')],
  ['You want a print server that phones or other computers print through', 'brother_ql_web', gh('pklaus/brother_ql_web')],
  ['You have a DYMO LabelManager or LetraTag tape printer', 'Labelle', gh('labelle-org/labelle')],
  ['You have a DYMO LabelWriter 550 / 5XL (not supported here; they need DYMO\'s chip-locked labels)', 'burnmark', 'https://burnmark.app'],
];

export function aimsMarkdown() {
  return [
    'This editor is for you if:',
    '',
    ...AIMS.map((a) => `- ${a}`),
    '',
    'Another tool may suit you better if:',
    '',
    ...LOOK_ELSEWHERE.map(([need, name, url]) => `- ${need}: try [${name}](${url}).`),
    '',
    'More in [Other tools](#other-tools).',
  ].join('\n');
}

export const OTHER_TOOLS_INTRO = 'Low-level libraries for these printers are plentiful; label editors are rarer, '
  + 'mostly cover one brand, and often print through CUPS or a small server. This one aims at DYMO LabelWriter and '
  + 'Brother printers together, continuous rolls, text edited in place that fits its box, and a true preview of the printable area, '
  + 'also at real size; if one of '
  + 'these fits you better, use it. Developers: the libraries are where most of the protocol knowledge lives.';

export const OTHER_TOOLS = [
  {
    group: 'Label editors in the browser, printing directly',
    tools: [
      ['label-maker (burnmark)', gh('burnmark-io/label-maker'), 'Vue label designer printing over WebUSB to Brother QL, DYMO LabelWriter and DYMO LabelManager printers.'],
      ['labelpeel', gh('LookLeft/labelpeel'), 'designer for Brother P-touch printers (experimental QL) over Bluetooth or USB, with auto-fit text, templates, CSV data and P-touch Editor file import; also Mac and Android apps. Formerly labelsmith.'],
      ['ql700-printer', gh('fipppi/ql700-printer'), 'designer for the Brother QL-700 over WebUSB.'],
      ['ptouch (fjanicki)', gh('fjanicki/ptouch'), 'Rust library and web studio for Brother P-touch Bluetooth printers (PT-P710BT); early development.'],
    ],
  },
  {
    group: 'Desktop label editors',
    tools: [
      ['gLabels', gh('j-evins/glabels-qt'), 'label and business card designer for Linux, built around label sheets and templates; prints through CUPS.'],
      ['Labelle', gh('labelle-org/labelle'), 'Python GUI and command line for DYMO LabelManager tape printers (the successor of dymoprint).'],
      ['TuxLabel', gh('Neklor/TuxLabel'), 'PyQt6 editor for Brother P-touch (TZe) printers on Linux with a WYSIWYG preview; prints through CUPS.'],
      ['ptlabel', gh('shaag7967/ptlabel'), 'Python editor (GUI and command line) for the Brother PT-P750W over Wi-Fi, and USB on Linux.'],
      ['pLabels', gh('Privatehive/pLabels'), 'Qt GUI for Brother P-touch printers, built on ptouch-print.'],
      ['ptouch-rs (mlloyd5)', gh('mlloyd5/ptouch-rs'), 'Rust driver, command line and GUI for Brother P-touch printers over USB on Linux.'],
      ['ptouch-rs-notstupid', gh('wakuwakumiwaku/ptouch-rs-notstupid'), 'Rust driver, GUI designer and command line for Brother P-touch printers (tested with the PT-D600).'],
      ['ptouch-770', gh('probonopd/ptouch-770'), 'Python GTK3 GUI for the Brother PT-P700 on Linux.'],
      ['PT-P710BT-Label-GUI', gh('danielrosehill/PT-P710BT-Label-GUI'), 'GUI for the Brother PT-P710BT on Ubuntu/KDE, wrapping ptouch-print.'],
      ['oh-brother', gh('curtisgalloway/oh-brother'), 'Rust command line and web UI for Brother P-touch printers, a cross-platform replacement for P-touch Editor.'],
      ['ptouch-editor-wine', gh('Robou/ptouch-editor-wine'), 'runs Brother\'s P-touch Editor 6 on Linux under Wine, printing to a PT-P700.'],
      ['P-Tux', 'https://p-tux.com/', 'label designer for Brother P-touch printers on Linux and macOS (announced).'],
      ['LT200B-gui', gh('sgilissen/LT200B-gui'), 'GUI for the DYMO LetraTag LT-200B Bluetooth label maker.'],
    ],
  },
  {
    group: 'Self-hosted web interfaces (a server, e.g. a Raspberry Pi, drives the printer)',
    tools: [
      ['brother_ql_web', gh('pklaus/brother_ql_web'), 'web service for Brother QL printers, built on brother_ql; maintained forks include FriedrichFroebel/brother_ql_web and DL6ER/brother_ql_web.'],
      ['brother_ql_app', gh('DeanCording/brother_ql_app'), 'web app and REST API for Brother QL printers: text, images, QR codes, PDFs, a print queue.'],
      ['label-designer (teknopartz)', gh('teknopartz/label-designer'), 'WYSIWYG drag-and-drop designer for a Brother QL-700.'],
      ['bql-label-printer', gh('splitbrain/bql-label-printer'), 'simple text label interface for Brother QL printers with HTML templates.'],
      ['labelle-web', gh('labelle-org/labelle-web'), 'browser designer for DYMO LabelManager printers through Labelle.'],
      ['ptouch-labelmaker', gh('danhoban/ptouch-labelmaker'), 'web app for designing and printing on a Brother P-touch from a Raspberry Pi.'],
      ['labeler', gh('PhilippMundhenk/labeler'), 'web interface for Brother P-touch printers around ptouch-print.'],
    ],
  },
  {
    group: 'Libraries, drivers and command-line tools',
    tools: [
      ['ptouch-print', 'https://git.familie-radermacher.ch/linux/ptouch-print.git', 'C command line printing to Brother P-touch printers over USB (libusb) on Linux; the reference for many of the projects here.'],
      ['brother_pt', gh('treideme/brother_pt'), 'Python package for the Brother PT raster protocol (PT-P710BT verified).'],
      ['labelprinterkit', gh('SunboX/labelprinterkit'), 'Python toolkit for Brother P-touch printers, with a JavaScript WebUSB/WebBluetooth port (labelprinterkit-web).'],
      ['tapen', gh('corvis/tapen'), 'Brother P-touch printing from HTML templates.'],
      ['ptouch-bt', gh('shyndman/ptouch-bt'), 'Brother P-touch printers over Bluetooth on Linux.'],
      ['PT-P300BT', gh('Ircama/PT-P300BT'), 'reverse-engineered protocol for the Brother PT-P300BT (Bluetooth LE).'],
      ['brother_ql', gh('pklaus/brother_ql'), 'Python implementation of the Brother QL raster protocol; continued in brother_ql2 (matmair/brother_ql2).'],
      ['brotherql-webusb', gh('tylercrumpton/brotherql-webusb'), 'printing to Brother QL printers from the browser over WebUSB.'],
      ['node-brother-label-printer', gh('driehle/node-brother-label-printer'), 'Node.js library for Brother label printers.'],
      ['thermal-label', 'https://thermal-label.github.io/', 'TypeScript drivers for DYMO LabelWriter, Brother and other label printers: Node.js, browser WebUSB and command line.'],
      ['node-dymo-printer', gh('kozmoz/node-dymo-printer'), 'Node.js driver for DYMO label printers.'],
      ['dymonite', gh('ab2525/dymonite'), 'Python text and QR labels for DYMO LabelWriters, printed through CUPS.'],
      ['dymo-linux-service', gh('qixeo/dymo-linux-service'), 'stand-in for DYMO Connect\'s local web service on Linux, so web apps built for it can print.'],
      ['dymo-bluetooth', gh('ysfchn/dymo-bluetooth'), 'Python library for the DYMO LetraTag LT-200B over Bluetooth.'],
      ['DYMO Linux drivers', gh('dymosoftware/Drivers'), 'DYMO\'s own open-source CUPS drivers for LabelWriter and LabelManager printers.'],
      ['LPrint', gh('michaelrsweet/lprint'), 'label printer application that shares Brother, DYMO, Zebra and other label printers via IPP Everywhere / AirPrint.'],
    ],
  },
  {
    group: 'More',
    tools: [
      ['Label-Printing-Resources', gh('danielrosehill/Label-Printing-Resources'), 'a larger index of label printer utilities, drivers and bridges (Brother, DYMO, Niimbot, Zebra and more).'],
      ['GitHub topics', gh('topics/brother-label-printer'), 'brother-label-printer, brother-ptouch, dymo-labelwriter and label-printer list many more.'],
      ['The makers\' own', null, 'DYMO Connect and Brother P-touch Editor (Windows and macOS), and their CUPS drivers for printing from any Linux app.'],
    ],
  },
];

export function othersMarkdown() {
  const lines = [OTHER_TOOLS_INTRO];
  for (const { group, tools } of OTHER_TOOLS) {
    lines.push('', `**${group}**`, '');
    for (const [name, url, what] of tools) {
      lines.push(`- ${url ? `[${name}](${url})` : name}: ${what}`);
    }
  }
  return lines.join('\n');
}
