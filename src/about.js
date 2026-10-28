// Welcome / help pages shown in a dialog: what this is, how to start, the
// printer compatibility table (generated from the models, like the README)
// and tips. Shown once on the first visit and from the Help button.
import { compatRows, NOT_PLANNED, STATUS_LABEL } from './compat.js';
import { REPO_URL, printerReportUrl, labelRequestUrl } from './report.js';
import { OTHER_TOOLS, OTHER_TOOLS_INTRO, AIMS, LOOK_ELSEWHERE } from './others.js';

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
  const othersLink = el('button', { type: 'button', className: 'linklike', textContent: 'Other tools' });
  othersLink.onclick = () => go('others');
  return [
    p('Design labels and print them ', b('straight from your browser'), ' to DYMO LabelWriter and Brother P-touch / QL '
      + 'label printers, with no drivers or software to install. Continuous rolls are first class: a label is as long as '
      + 'its content, or any length you choose.'),
    p(b('Why:'), ' the makers\' own label editors don\'t run on Linux, and the Linux tools that exist don\'t handle '
      + 'continuous rolls or auto-sizing text well. Linux users shouldn\'t be second-class citizens with label printers; a '
      + 'web page that talks to the printer directly works the same everywhere.'),
    el('h3', { textContent: 'Philosophy' }),
    p(b('Ease of use over features.'), ' Making a label should be quick and obvious: click the text and type, it fits '
      + 'its box, the preview is what prints, and the printer just works. A feature earns its place only if it doesn\'t '
      + 'make that harder.'),
    p(b('Reuse what commercial label software learned the hard way:'), ' editing text on the label, text that shrinks '
      + 'to fit, a canvas at the real label size with the unprintable edges shown, labels picked from a list, quick '
      + 'reprints and undo. Where they got it right, copy it.'),
    el('ul', {},
      li(b('Modelled on the original DYMO Label software'), ' (not DYMO Connect): editing text right on the label, a '
        + 'preview that shows exactly what will print, copy and paste between labels, and above all ',
      b('text that sizes itself to fit'), '. Too many label editors leave you guessing, and text gets cut off.'),
      li(b('Continuous rolls are the normal case.'), ' A label is as long as its content unless you say otherwise.'),
      li(b('What you see is what prints.'), ' The preview is the exact dots the printer will burn. Hatched: the printer '
        + 'cannot reach. Dashed: the safe area; going past it, even onto the liner, is allowed. You decide.'),
      li(b('Print directly.'), ' The page talks to the printer over USB or Bluetooth itself, the same on Linux, Windows, '
        + 'macOS and ChromeOS.'),
      li(b('Measure, don\'t guess.'), ' Test prints and per-roll calibration correct for your printer and your label '
        + 'stock, including third-party rolls.'),
      li(b('Never lose work.'), ' Undo and redo cover every change, and switching how a row is filled hides a label\'s '
        + 'design rather than deleting it.'),
      li(b('Nothing leaves your computer.'), ' It is a static page: designs stay in your browser unless you save them '
        + 'to a file.'),
      li(b('Say when another tool fits better.'), ' See ', othersLink, '.')),
    el('h3', { textContent: 'Getting started' }),
    el('ol', {},
      li('Pick your printer and label in the ', b('Printer'), ' panel. See ', start, ' for what is supported.'),
      li('Add text, QR codes, barcodes, images or boxes. Drag to move; click text again to edit it on the label. Tick ',
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
      li(b('Hatched border'), ': where the printer cannot put ink at all. Anything there is cut off and flagged.'),
      li(b('Dashed line'), ': the safe area. Items past it still print (overprinting towards the label edge), but the '
        + 'die cut may trim them.'),
      li(b('Portrait'), ' (Orientation, die-cut labels) lets you design the label standing upright; it is turned for '
        + 'printing.'),
      li(b('Rotate'), ' turns text in quarter turns, for cable flags and vertical text; a fitted box turns with it '
        + 'and its text refits.'),
      li(b('Fit text in a fixed box'), ' picks the largest size that fits; ', b('Fill safe area'), ' makes the box '
        + 'cover the safe area, ', b('Fill to edge'), ' the whole label. Drag the corner handle to resize.'),
      li(b('Overprint past the label edge'), ' (DYMO die-cut labels): the tinted border around the label is the liner; '
        + 'ink there makes a black background or border reach the edge even if the label sits a little off.'),
      li(b('Two labels per row'), ' (e.g. DYMO 30333): the preview shows the whole row. Choose the same design on '
        + 'all, a different design on each (click a label to add to it, drag items between them), or one at a time. '
        + 'The 🔓 Edit separately button on the dimmed copy unlinks it, starting from a copy of label 1.'),
      li(b('Rulers'), ' measure from the label\'s starting edge and from each label\'s top, and mark the selected item.')),
    el('h3', { textContent: 'Cable flags' }),
    el('ol', {},
      li('Set ', b('Length'), ' to ', b('Fixed'), ': twice the flag length plus once around the cable (e.g. 30 mm flags on '
        + 'a 6 mm cable: 2 × 30 + 3.14 × 6 ≈ 79 mm).'),
      li('Add text, tick ', b('Fit text in a fixed box'), ', click ', b('Fill safe area'), ', then set the box width to '
        + 'the flag length so it covers the first flag.'),
      li(b('Ctrl+D'), ' duplicates it; move the copy to the far end, leaving the wrap in the middle blank.'),
      li('Print one and wrap it round the cable. If the far side reads upside down, set the copy\'s ', b('Rotate'),
        ' to 180°. Flexible ID tape holds best.')),
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
      li(b('Ctrl+Z'), ': undo. ', b('Ctrl+Shift+Z'), ' or ', b('Ctrl+Y'), ': redo (also the ↶ ↷ buttons).'),
      li(b('Click'), ' selected text, double-click it, or press ', b('Enter'), ' / ', b('F2'), ' to edit it on the label; '
        + 'double-click empty space to add text.')),
    el('h3', { textContent: 'Your designs' }),
    p('The ', b('Labels'), ' button keeps your saved labels (open one, or use it as a template for a new label) and the '
      + 'history of what you printed, so you can reprint it. They and the current design are kept in this browser; use ',
    b('Save file…'), ' / ', b('Open file…'), ' for copies you can back up or share. Source code, issues and the full '
      + 'guide: ', link(REPO_URL, 'GitHub'), '.'),
  ];
}

// Text with **bold** runs, as in the shared README wording.
function rich(text) {
  return text.split('**').map((part, i) => (i % 2 ? b(part) : part));
}

function others() {
  return [
    el('h3', { textContent: 'Who this editor is for' }),
    el('ul', {}, ...AIMS.map((a) => li(...rich(a)))),
    p('Another tool may suit you better if:'),
    el('ul', {}, ...LOOK_ELSEWHERE.map(([need, name, url]) => li(`${need}: try `, link(url, name), '.'))),
    el('h3', { textContent: 'Other tools' }),
    p(OTHER_TOOLS_INTRO),
    ...OTHER_TOOLS.flatMap(({ group, tools }) => [
      el('h3', { textContent: group }),
      el('ul', {}, ...tools.map(([name, href, what]) => li(href ? link(href, name) : b(name), `: ${what}`))),
    ]),
  ];
}

const TABS = [['welcome', 'Welcome'], ['printers', 'Printers'], ['tips', 'Tips'], ['others', 'Other tools'], ['connect', 'Connecting']];

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
    const body = { welcome: () => welcome(go), printers: () => printers(ctx.models), tips, others }[tab]();
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
