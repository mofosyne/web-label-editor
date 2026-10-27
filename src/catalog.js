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
  if (kind === 'diecut') medium.lengthDots = toDots(num('LengthMm', true));
  if (printableDots != null) medium.tapeMm = widthMm;
  const corner = num('CornerMm');
  if (corner) medium.cornerMm = corner;
  const statusMm = num('StatusMm');
  if (statusMm != null) medium.statusMm = statusMm;
  return medium;
}

// Fills models[*].media from catalogue text, in file order.
export function applyCatalog(text, models) {
  for (const m of Object.values(models)) m.media = [];
  const seen = new Set();
  for (const rec of parseRec(text).records) {
    if (rec.type !== 'Medium') continue;
    const printer = field(rec, 'Printer');
    const model = models[printer];
    if (!model) throw new Error(`catalogue record ${field(rec, 'Id')}: unknown printer "${printer}"`);
    const medium = toMedium(rec, model);
    if (seen.has(medium.id)) throw new Error(`catalogue: duplicate Id ${medium.id}`);
    seen.add(medium.id);
    model.media.push(medium);
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
