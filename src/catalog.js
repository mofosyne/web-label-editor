// Loads the label/tape catalogue (catalog/media.rec) into each printer
// model's `media` list. See the comments in that file for the fields.
import { parseRec, field } from './recfile.js';

export const CATALOG_URL = 'catalog/media.rec';

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
    acrossDots: printableDots ?? Math.min(toDots(widthMm), model.headDots),
    continuous: kind === 'continuous',
    margins: {
      left: num('MarginLeftMm') ?? 0,
      right: num('MarginRightMm') ?? 0,
      top: num('MarginTopMm') ?? 0,
      bottom: num('MarginBottomMm') ?? 0,
    },
  };
  if (kind === 'diecut') medium.lengthDots = num('PrintableLengthDots') ?? toDots(num('LengthMm', true));
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
  const across = field(rec, 'PrintableDots') != null ? medium.acrossDots : widthDots;
  if (across > model.headDots * 1.02) return false;
  return model.maxWidthMm == null || Number(field(rec, 'WidthMm')) <= model.maxWidthMm;
}

// Fills models[*].media from catalogue text, in file order: each model gets
// the records of its family that fit it.
export function applyCatalog(text, models) {
  for (const m of Object.values(models)) m.media = [];
  const seen = new Set();
  for (const rec of parseRec(text).records) {
    if (rec.type !== 'Medium') continue;
    const id = field(rec, 'Id');
    const family = field(rec, 'Family');
    if (!FAMILIES.has(family)) throw new Error(`catalogue record ${id}: unknown family "${family}"`);
    if (seen.has(id)) throw new Error(`catalogue: duplicate Id ${id}`);
    seen.add(id);
    for (const model of Object.values(models)) {
      if (model.family !== family) continue;
      const medium = toMedium(rec, model);
      if (fits(rec, medium, model)) model.media.push(medium);
    }
  }
  for (const [id, m] of Object.entries(models)) {
    if (!m.media.length) throw new Error(`catalogue has no media for ${id}`);
  }
  return models;
}

export async function loadCatalog(models, url = CATALOG_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the label catalogue (${res.status})`);
  return applyCatalog(await res.text(), models);
}
