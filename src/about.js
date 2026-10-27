// Welcome / help pages shown in a dialog: what this is, how to start, the
// printer compatibility table (generated from the models, like the README)
// and tips. Shown once on the first visit and from the Help button.
import { compatRows, NOT_PLANNED, STATUS_LABEL } from './compat.js';
import { REPO_URL, printerReportUrl, labelRequestUrl } from './report.js';

export { REPO_URL };

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, attrs);
  e.append(...children.filter((c) => c != null));
  return e;
}
const p = (...c) => el('p', {}, ...c);
const b = (text) => el('strong', { textContent: text });
const li = (...c) => el('li', {}, ...c);
const link = (href, text) => el('a', { href, textContent: text, target: '_blank', rel: 'noopener' });

function welcome(go) {
  const start = el('button', { type: 'button', className: 'linklike', textContent: 'Printers' });
  start.onclick = () => go('printers');
  return [
    p('Design labels and print them ', b('straight from your browser'), ' to DYMO LabelWriter and Brother P-touch / QL '
      + 'label printers, with no drivers or software to install. Continuous rolls are first class: a label is as long as '
      + 'its content, or any length you choose.'),
    p(b('Why:'), ' the makers\' own label editors don\'t run on Linux, and the Linux tools that exist don\'t handle '
      + 'continuous rolls or auto-sizing text well. Linux users shouldn\'t be second-class citizens with label printers; a '
      + 'web page that talks to the printer directly works the same everywhere.'),
    el('h3', { textContent: 'Philosophy' }),
    el('ul', {},
      li(b('Modelled on the original DYMO Label software'), ' (not DYMO Connect): a preview that shows exactly what will '
        + 'print, copy and paste between labels, and above all ', b('text that sizes itself to fit'), '. Too many label '
        + 'editors leave you guessing, and text gets cut off.'),
      li(b('What you see is what prints.'), ' The preview is the exact dots the printer will burn, including the edges '
        + 'it cannot reach (hatched).'),
      li(b('Print directly.'), ' The page talks to the printer over USB or Bluetooth itself, the same on Linux, Windows, '
        + 'macOS and ChromeOS.'),
      li(b('Measure, don\'t guess.'), ' Test prints and per-roll calibration correct for your printer and your label '
        + 'stock, including third-party rolls.'),
      li(b('Nothing leaves your computer.'), ' It is a static page: designs stay in your browser unless you save them '
        + 'to a file.')),
    el('h3', { textContent: 'Getting started' }),
    el('ol', {},
      li('Pick your printer and label in the ', b('Printer'), ' panel. See ', start, ' for what is supported.'),
      li('Add text, QR codes, barcodes, images or boxes. Drag to move; double-click text to edit it. Tick ',
        b('Fit text in a fixed box'), ' to let the size follow the box.'),
      li('Click ', b('Connect USB'), ' (or Bluetooth), then ', b('Print'), '. If the browser is refused access, the app '
        + 'explains the one-time fix for your system.'),
      li('If prints land off position, open ', b('Test prints'), ' in the Printer panel and calibrate.')),
    p('Printing needs Chrome, Edge or another Chromium browser on desktop. In other browsers you can still design and ',
      b('Download PNG'), '.'),
  ];
}

function printers(models) {
  const rows = compatRows(models);
  const table = el('table', { className: 'compat' },
    el('thead', {}, el('tr', {}, ...['Printer', 'Status', 'Connection', 'Labels / notes'].map((h) => el('th', { textContent: h })))),
    el('tbody', {}, ...rows.map((r) => el('tr', { className: r.status },
      el('td', { textContent: r.name }),
      el('td', { textContent: STATUS_LABEL[r.status] }),
      el('td', { textContent: r.connection }),
      el('td', { textContent: r.media }),
    ))));
  return [
    el('div', { className: 'table-scroll' }, table),
    p(b('Tried a printer?'), ' ', link(printerReportUrl({ printer: '' }), 'Report how it went'), ', whether it worked or not: '
      + 'reports are how printers move from 🧪 to ✅. ', b('Missing a label or tape size?'), ' ',
    link(labelRequestUrl({ printer: '' }), 'Request it'), '.'),
    p(b('✅ Tested'), ': printed on real hardware. ', b('🧪 Experimental'), ': the protocol is checked against a reference '
      + 'implementation, but nobody has printed on that model with this app yet. ', b('⬜ Unimplemented'), ': not supported yet.'),
    ...NOT_PLANNED.map((n) => p(b(n.name), `: not planned. ${n.why}`)),
  ];
}

function tips() {
  return [
    el('h3', { textContent: 'Layout' }),
    el('ul', {},
      li(b('Hatched border'), ': where the printer cannot put ink. Anything there is flagged under the preview.'),
      li(b('Fit text in a fixed box'), ' picks the largest size that fits; ', b('Fill printable area'), ' makes the box '
        + 'cover the usable label. Drag the corner handle to resize.'),
      li(b('Continuous rolls'), ': choose ', b('Fit to content'), ' to make the label as long as what is on it, or ',
        b('Fixed'), ' for a set length.'),
      li(b('QR codes and barcodes'), ' snap to whole printer dots so they scan reliably; leave a little blank space '
        + 'around them.')),
    el('h3', { textContent: 'Calibration and rolls' }),
    el('ul', {},
      li('Print the ', b('Grid'), ' test: each numbered line should sit that many mm from the label\'s starting edge. If '
        + 'line n is at n + d mm, set ', b('Feed'), ' to −d; the top edge gives ', b('Across'), '.'),
      li(b('Save as roll…'), ' stores a calibration for one roll (handy for third-party labels) with a short ID to write '
        + 'on it. Its calibration code sets the roll up on another computer.')),
    el('h3', { textContent: 'Keyboard' }),
    el('ul', {},
      li(b('Ctrl+C / Ctrl+X / Ctrl+V'), ': copy, cut, paste items. Paste text or images from other apps too.'),
      li(b('Ctrl+D'), ': duplicate. ', b('Delete'), ': remove. ', b('Arrows'), ': nudge 0.1 mm (Shift: 1 mm).'),
      li(b('Double-click'), ' text to edit it on the label; double-click empty space to add text.')),
    el('h3', { textContent: 'Your designs' }),
    p('The ', b('Labels'), ' button keeps your saved labels (open one, or use it as a template for a new label) and the '
      + 'history of what you printed, so you can reprint it. They and the current design are kept in this browser; use ',
    b('Save file…'), ' / ', b('Open file…'), ' for copies you can back up or share. Source code, issues and the full '
      + 'guide: ', link(REPO_URL, 'GitHub'), '.'),
  ];
}

const TABS = [['welcome', 'Welcome'], ['printers', 'Printers'], ['tips', 'Tips'], ['connect', 'Connecting']];

// ctx: { models, tab, onConnectHelp }
export function openAbout(dialog, ctx) {
  let tab = ctx.tab ?? 'welcome';
  const render = () => {
    const go = (t) => {
      if (t === 'connect') {
        dialog.close();
        ctx.onConnectHelp();
        return;
      }
      tab = t;
      render();
    };
    const tabs = el('div', { className: 'tabs', role: 'tablist' }, ...TABS.map(([id, name]) => {
      const t = el('button', { type: 'button', textContent: name, className: id === tab ? 'tab active' : 'tab' });
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', String(id === tab));
      t.onclick = () => go(id);
      return t;
    }));
    const close = el('button', { type: 'button', className: 'close', textContent: '×', ariaLabel: 'Close' });
    close.onclick = () => dialog.close();
    const done = el('button', { type: 'button', className: 'primary', textContent: tab === 'welcome' ? 'Start designing' : 'Close' });
    done.onclick = () => dialog.close();
    const body = { welcome: () => welcome(go), printers: () => printers(ctx.models), tips }[tab]();
    dialog.replaceChildren(
      el('header', {}, el('h2', { textContent: 'Web Label Editor' }), close),
      tabs,
      el('div', { className: 'about-body' }, ...body),
      el('div', { className: 'row' }, done),
    );
  };
  render();
  if (!dialog.open) dialog.showModal();
}
