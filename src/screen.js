// SPDX-License-Identifier: GPL-3.0-or-later
// Actual-size preview: browsers don't know a screen's physical size (CSS
// millimetres are nominal), so the user calibrates once by matching an
// outline to a bank card or a ruler held against the screen. Stored as
// device pixels per mm, so it survives browser zoom (devicePixelRatio
// changes); a different monitor needs its own calibration.

const KEY = 'web-label-editor:screen';

// ISO/IEC 7810 ID-1: bank cards, ID cards, many membership cards.
const CARD = { w: 85.6, h: 53.98 };

export function loadScreen() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s?.devicePxPerMm > 0 ? s : null;
  } catch {
    return null;
  }
}

function saveScreen(devicePxPerMm) {
  try {
    if (devicePxPerMm) localStorage.setItem(KEY, JSON.stringify({ devicePxPerMm }));
    else localStorage.removeItem(KEY);
  } catch { /* storage unavailable */ }
}

// The browser's nominal millimetre (CSS defines 96 px per inch): the best
// guess at real size before the screen is calibrated. Often off by a
// quarter or more, depending on the screen.
export const ESTIMATED_PX_PER_MM = 96 / 25.4;

// CSS px per real mm on this screen at the current browser zoom, or null.
export function actualPxPerMm() {
  const s = loadScreen();
  return s ? s.devicePxPerMm / (window.devicePixelRatio || 1) : null;
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, attrs);
  e.append(...children.filter((c) => c != null));
  return e;
}

// ctx: { onDone(calibrated) }
export function openScreenCalibration(dialog, ctx = {}) {
  const dpr = () => window.devicePixelRatio || 1;
  // Start from the saved value, or the nominal 96 CSS px per inch.
  let pxPerMm = actualPxPerMm() ?? 96 / 25.4;
  let mode = 'card';

  const outline = el('div', { className: 'cal-outline' });
  const label = el('p', { className: 'note' });
  const slider = el('input', { type: 'range', min: '2', max: '12', step: '0.005', ariaLabel: 'Size' });
  const draw = () => {
    if (mode === 'card') {
      outline.style.width = `${CARD.w * pxPerMm}px`;
      outline.style.height = `${CARD.h * pxPerMm}px`;
      outline.classList.add('card');
      label.textContent = 'Hold a bank card or ID card (85.6 × 54 mm) against the screen and resize the outline until the '
        + 'card just covers it.';
    } else {
      outline.style.width = `${100 * pxPerMm}px`;
      outline.style.height = '18px';
      outline.classList.remove('card');
      label.textContent = 'Hold a ruler against the screen and resize the bar until it is exactly 100 mm long.';
    }
    slider.value = String(pxPerMm);
  };
  slider.oninput = () => { pxPerMm = Number(slider.value); draw(); };
  const nudge = (f) => { pxPerMm *= f; draw(); };
  const btn = (text, onClick, className = '') => {
    const b = el('button', { type: 'button', textContent: text, className });
    b.onclick = onClick;
    return b;
  };
  const modes = el('div', { className: 'tabs', role: 'tablist' },
    ...[['card', 'Bank card'], ['ruler', 'Ruler']].map(([id, name]) => {
      const t = btn(name, () => {
        mode = id;
        for (const x of modes.children) x.className = x === t ? 'tab active' : 'tab';
        draw();
      }, id === mode ? 'tab active' : 'tab');
      return t;
    }));
  const close = btn('×', () => dialog.close(), 'close');
  close.ariaLabel = 'Close';
  const save = btn('Save', () => {
    saveScreen(pxPerMm * dpr());
    dialog.close();
    ctx.onDone?.(true);
  }, 'primary');
  const forget = loadScreen() ? btn('Forget calibration', () => {
    saveScreen(null);
    dialog.close();
    ctx.onDone?.(false);
  }) : null;

  dialog.replaceChildren(
    el('header', {}, el('h2', { textContent: 'Actual size: calibrate this screen' }), close),
    el('p', {}, 'Browsers can\'t tell how big your screen really is, so match something of known size once. '
      + 'After that, the 1:1 button shows labels at their real size. A different monitor needs its own calibration.'),
    modes,
    label,
    el('div', { className: 'cal-stage' }, outline),
    el('div', { className: 'row' }, btn('−', () => nudge(1 / 1.002), 'icon'), slider, btn('+', () => nudge(1.002), 'icon')),
    el('div', { className: 'row' }, save, forget, btn('Cancel', () => dialog.close())),
  );
  draw();
  if (!dialog.open) dialog.showModal();
}
