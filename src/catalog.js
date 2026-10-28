// SPDX-License-Identifier: GPL-3.0-or-later
// Loads the label/tape catalogue (catalog/media.rec) into each printer
// model's `media` list. See the comments in that file for the fields.
import { parseRec, field } from './recfile.js';
import { genericPrinter } from './printers/generic.js';

export const CATALOG_URL = 'catalog/media.rec';
export const PRINTERS_URL = 'catalog/printers.rec';

function toMedium(rec, model) {
  const id = field(rec, 'Id');
  const where = `catalogue record ${id ?? '(no Id)'}`;
  const text = (name, required = false) => {
    const v = field(rec, name);
    if (required && (v == null || v === '')) throw new Error(`${where}: missing ${name}`);
    return v;
  };
  const num = (name, required = false) => {
    const v = text(name, required);
    if (v == null) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${where}: ${name} is not a number ("${v}")`);
    return n;
  };
  const toDots = (mm) => Math.round((mm * model.dpi) / 25.4);

  const kind = text('Kind', true);
  if (kind !== 'continuous' && kind !== 'diecut') throw new Error(`${where}: Kind must be continuous or diecut`);
  const widthMm = num('WidthMm', true);
  const printableDots = num('PrintableDots');
  const medium = {
    id: text('Id', true),
    name: text('Name', true),
    // Brother media: the whole tape or label, with the printable band in it
    // (below); others: the label, clipped to the head.
    acrossDots: printableDots != null ? toDots(widthMm) : Math.min(toDots(widthMm), model.headDots),
    continuous: kind === 'continuous',
    margins: {
      left: num('MarginLeftMm') ?? 0,
      right: num('MarginRightMm') ?? 0,
      top: num('MarginTopMm') ?? 0,
      bottom: num('MarginBottomMm') ?? 0,
    },
  };
  if (kind === 'diecut') medium.lengthDots = toDots(num('LengthMm', true));
  // Where the printer can print on Brother media (PrintableDots across,
  // PrintableLengthDots along a die-cut label), centred on the tape or
  // label: the preview hatches the rest and printing sends only this band.
  if (printableDots != null) {
    medium.band = { y: Math.floor((medium.acrossDots - printableDots) / 2), h: printableDots };
    const printableLength = num('PrintableLengthDots');
    if (kind === 'diecut' && printableLength != null) {
      medium.band.x = Math.floor((medium.lengthDots - printableLength) / 2);
      medium.band.w = printableLength;
    }
  }
  // "2 up" labels: the editor designs one label; printing places it into
  // each slot of the row (see composeRow).
  const across = num('LabelsAcross');
  if (across > 1) {
    // The real row width (not clipped to the head) so slots sit where the
    // labels are; anything past the head falls in the edge margin.
    const pageDots = toDots(widthMm);
    medium.acrossDots = Math.floor(pageDots / across);
    medium.lanes = { count: across, pitchDots: medium.acrossDots, pageDots };
  }
  medium.widthMm = widthMm;
  if (kind === 'diecut') medium.lengthMm = num('LengthMm', true);
  const offsetR = num('OffsetRightDots');
  if (offsetR != null) medium.offsetRightDots = offsetR;
  const feedMargin = num('FeedMarginDots');
  if (feedMargin != null) medium.feedMarginDots = feedMargin;
  if (printableDots != null) medium.tapeMm = widthMm;
  const corner = num('CornerMm');
  if (corner) medium.cornerMm = corner;
  const shape = text('Shape');
  if (shape && shape !== 'rect' && shape !== 'round') throw new Error(`${where}: Shape must be rect or round`);
  if (shape === 'round') medium.shape = 'round';
  const statusMm = num('StatusMm');
  if (statusMm != null) medium.statusMm = statusMm;
  return medium;
}

const FAMILIES = new Set(['dymo-lw', 'brother-pt', 'brother-ql']);

// A medium fits a model if its printable width (paper width minus the edge
// margins, or Brother's printable dots) fits the head, with 2% slack, and it
// is not wider than the model's widest supported tape.
function fits(rec, medium, model) {
  const printableMm = Number(field(rec, 'WidthMm')) - medium.margins.top - medium.margins.bottom;
  const widthDots = Math.round((printableMm * model.dpi) / 25.4);
  const across = medium.band ? medium.band.h : widthDots;
  if (across > model.headDots * 1.02) return false;
  return model.maxWidthMm == null || Number(field(rec, 'WidthMm')) <= model.maxWidthMm;
}

// Fills models[*].media from catalogue text, in file order: each model gets
// the records of its family that fit it.
export function applyCatalog(text, models) {
  // Printers described by the user (custom) bring their own label.
  const listed = Object.entries(models).filter(([, m]) => !m.custom);
  for (const [, m] of listed) m.media = [];
  const seen = new Set();
  for (const rec of parseRec(text).records) {
    if (rec.type !== 'Medium') continue;
    const id = field(rec, 'Id');
    const family = field(rec, 'Family');
    if (!FAMILIES.has(family)) throw new Error(`catalogue record ${id}: unknown family "${family}"`);
    if (seen.has(id)) throw new Error(`catalogue: duplicate Id ${id}`);
    seen.add(id);
    for (const [, model] of listed) {
      if (model.family !== family) continue;
      const medium = toMedium(rec, model);
      if (fits(rec, medium, model)) model.media.push(medium);
    }
  }
  for (const [id, m] of listed) {
    if (!m.media.length) throw new Error(`catalogue has no media for ${id}`);
  }
  return models;
}

// Adds a menu entry for each printer in catalog/printers.rec, ahead of
// "Other printer" (see generic.js).
export function applyPrinters(text, models) {
  const other = models.generic;
  delete models.generic;
  for (const rec of parseRec(text).records) {
    if (rec.type !== 'Printer') continue;
    const id = field(rec, 'Id');
    const num = (name, def) => {
      const v = field(rec, name);
      if (v == null || v === '') return def;
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`printer record ${id}: ${name} is not a number ("${v}")`);
      return n;
    };
    if (!id || models[id]) throw new Error(`printer record ${id ?? '(no Id)'}: missing or duplicate Id`);
    const language = field(rec, 'Language');
    if (!['zpl', 'tspl', 'escpos'].includes(language)) throw new Error(`printer record ${id}: unknown Language "${language}"`);
    models[id] = genericPrinter({
      id,
      name: field(rec, 'Name'),
      brand: field(rec, 'Brand') ?? 'Other',
      status: field(rec, 'Status') === 'tested' ? 'tested' : 'experimental',
      source: field(rec, 'Source'),
      printer: { language, dpi: num('Dpi', 203), headMm: num('HeadMm', 104), rotate: /^(yes|true|1)$/i.test(field(rec, 'Rotate') ?? '') },
      defaults: {
        kind: num('DefaultLengthMm', 152.4) ? 'diecut' : 'continuous',
        widthMm: num('DefaultWidthMm', 101.6),
        lengthMm: num('DefaultLengthMm', 152.4) || 152.4,
        gapMm: num('GapMm', 3),
      },
      adjust: { feedMm: num('FeedMm', 0), acrossMm: num('AcrossMm', 0) },
    });
  }
  if (other) models.generic = other;
  return models;
}

export async function loadPrinters(models, url = PRINTERS_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the printer list (${res.status})`);
  return applyPrinters(await res.text(), models);
}

// "Custom size…": a label size the user enters, on printers that print any
// size they are given (the LabelWriter feeds to the gap; a Brother QL checks
// the loaded roll against the size sent, P-touch tape comes in set widths).
// It is built as a catalogue record, so the preview and the record in a
// label request are the same thing.
export const CUSTOM_MEDIA = {
  'dymo-lw': {
    name: '', kind: 'diecut', widthMm: 25, lengthMm: 54, cornerMm: 2, shape: 'rect', marginMm: 1.5,
    // The LabelWriter starts printing this far into each label (see models.js).
    leadingMm: 5.84,
  },
};

export function customRecord(family, cfg, { source = '(link to this issue)' } = {}) {
  const c = { ...CUSTOM_MEDIA[family], ...cfg };
  const fmt = (v) => String(Math.round(Number(v) * 100) / 100);
  const size = c.kind === 'diecut' ? `${fmt(c.widthMm)} × ${fmt(c.lengthMm)} mm` : `${fmt(c.widthMm)} mm continuous`;
  const name = c.name ? `${c.name} ${size}` : `${c.shape === 'round' ? 'Round ' : ''}${size}`;
  const slug = (c.name || `custom-${size}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const lines = [
    `Id: ${slug}`,
    `Family: ${family}`,
    `Name: ${name}`,
    `Kind: ${c.kind}`,
    `WidthMm: ${fmt(c.widthMm)}`,
  ];
  if (c.kind === 'diecut') lines.push(`LengthMm: ${fmt(c.lengthMm)}`);
  lines.push(
    `MarginLeftMm: ${fmt(Math.max(c.leadingMm ?? 0, c.marginMm))}`,
    `MarginRightMm: ${fmt(c.marginMm)}`,
    `MarginTopMm: ${fmt(c.marginMm)}`,
    `MarginBottomMm: ${fmt(c.marginMm)}`,
  );
  if (c.kind === 'diecut' && Number(c.cornerMm) && c.shape !== 'round') lines.push(`CornerMm: ${fmt(c.cornerMm)}`);
  if (c.kind === 'diecut' && c.shape === 'round') lines.push('Shape: round');
  lines.push(`Source: ${source}`);
  return lines.join('\n');
}

// The medium a catalogue record describes, for `model`.
export function mediumFromRecord(text, model) {
  const rec = parseRec(text).records[0];
  if (!rec) throw new Error('no record');
  return toMedium(rec, model);
}

export async function loadCatalog(models, url = CATALOG_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the label catalogue (${res.status})`);
  return applyCatalog(await res.text(), models);
}
