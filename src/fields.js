// SPDX-License-Identifier: GPL-3.0-or-later
// Fields in labels: {{Name}} in a text, QR code or barcode is filled in
// from a column of the data (CSV, a Markdown table, JSON or a recfile), one
// label per row; {{n}} is a counter, {{date}} and {{time}} the date and
// time of printing. Double braces, as in Mustache and most mail merges, so
// a single {brace} in a label stays text; and braces around anything that
// isn't a field are left as typed too. Pure functions, tested in Node.

import { parseRec } from './recfile.js';

export const COUNTER = 'n';
export const BUILT_IN = [COUNTER, 'date', 'time'];

// Items whose content can hold fields, and which property holds it.
const FIELD_PROPS = { text: 'text', qr: 'data', barcode: 'data' };

// Parses CSV text (RFC 4180: quoted fields, doubled quotes, line breaks
// inside quotes). The separator is a comma, semicolon or tab, whichever the
// first line has most of (spreadsheets in many locales use semicolons).
// The first row is the column names. Returns { columns, rows } with each
// row an array of strings as long as `columns`; blank lines are skipped.
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0];
  const sep = [',', ';', '\t'].map((c) => [c, firstLine.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const records = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      records.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); records.push(row); }
  const filled = records.filter((r) => r.some((v) => v.trim() !== ''));
  if (!filled.length) return { columns: [], rows: [] };
  const columns = filled[0].map((c, i) => c.trim() || `Column ${i + 1}`);
  const rows = filled.slice(1).map((r) => columns.map((_, i) => r[i] ?? ''));
  return { columns, rows };
}

// Rows from records keyed by name (JSON objects, recfile records): the
// columns are every name in first-seen order.
function fromRecords(list) {
  const columns = [];
  for (const r of list) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
  const text = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return { columns, rows: list.map((r) => columns.map((c) => text(r[c]))) };
}

// JSON: an array of objects (one per label), an array of arrays with the
// column names first, or an object holding such an array.
export function parseJsonData(text) {
  let v = JSON.parse(text);
  if (!Array.isArray(v) && v && typeof v === 'object') v = Object.values(v).find(Array.isArray) ?? [v];
  if (!Array.isArray(v)) throw new Error('Expected a list of records');
  if (v.every(Array.isArray)) {
    const [head = [], ...rest] = v;
    const columns = head.map((c, i) => String(c ?? '').trim() || `Column ${i + 1}`);
    return { columns, rows: rest.map((r) => columns.map((_, i) => (r[i] == null ? '' : String(r[i])))) };
  }
  return fromRecords(v.filter((r) => r && typeof r === 'object'));
}

// The first Markdown (GitHub) table in the text: a header row, the ---
// separator row, then rows until the table ends. \| is a literal bar.
export function parseMarkdownTable(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const cells = (line) => {
    const t = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
    return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  };
  const isSep = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
  const at = lines.findIndex((l, i) => l.includes('|') && isSep(lines[i + 1] ?? ''));
  if (at < 0) throw new Error('No Markdown table found');
  const columns = cells(lines[at]).map((c, i) => c || `Column ${i + 1}`);
  const rows = [];
  for (let i = at + 2; i < lines.length && lines[i].includes('|'); i++) {
    const r = cells(lines[i]);
    rows.push(columns.map((_, j) => r[j] ?? ''));
  }
  return { columns, rows };
}

// A GNU recfile: one label per record, of the first record type in it.
export function parseRecData(text) {
  const { records } = parseRec(text);
  const type = records[0]?.type;
  return fromRecords(records.filter((r) => r.type === type).map((r) => {
    const o = {};
    for (const [n, v] of r.fields) o[n] = n in o ? `${o[n]}\n${v}` : v;
    return o;
  }));
}

// Data as tab-separated text, the way spreadsheets copy cells: to show in
// the paste box for editing. Values with tabs, line breaks or quotes are
// quoted, which parseCsv reads back.
// Without `header`, just the rows (data that had no column names).
export function toTsv({ columns, rows }, header = true) {
  const cell = (v) => (/[\t\n\r"]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [...(header ? [columns] : []), ...rows].map((r) => r.map(cell).join('\t')).join('\n');
}

// The same data written out in each format the app reads, to show in the
// paste box: so an example can be seen as CSV, JSON and so on.
const objects = ({ columns, rows }) => rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ''])));
const WRITERS = {
  tsv: toTsv,
  csv: ({ columns, rows }) => [columns, ...rows]
    .map((r) => r.map((v) => (/[,"\n\r]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\n'),
  markdown: ({ columns, rows }) => {
    const cell = (v) => String(v).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
    const line = (r) => `| ${r.map(cell).join(' | ')} |`;
    return [line(columns), line(columns.map(() => '---')), ...rows.map(line)].join('\n');
  },
  json: (data) => JSON.stringify(objects(data), null, 2),
  rec: ({ columns, rows }) => {
    const names = columns.map((c) => c.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^([^A-Za-z])/, 'F$1'));
    return rows.map((r) => names.map((n, i) => `${n}: ${String(r[i] ?? '').replace(/\n/g, '\n+ ')}`).join('\n')).join('\n\n');
  },
  // A plain list: the first column, one per line, no name.
  list: ({ rows }) => rows.map((r) => r[0] ?? '').join('\n'),
};
export const DATA_FORMATS = {
  tsv: 'Spreadsheet cells', csv: 'CSV', markdown: 'Markdown table', json: 'JSON', rec: 'recfile', list: 'Plain list',
};
export function formatData(data, format) {
  return WRITERS[format](data);
}

// Examples to try a batch with, each with a label that shows its fields
// (put on the label when it has none yet). A list of serial numbers is only
// written as a plain list, with no column names.
export const EXAMPLES = [
  {
    name: 'Example: parts bins',
    columns: ['Part', 'Size', 'Bin'],
    rows: [
      ['Hex bolt', 'M3 × 10', 'A1'],
      ['Hex bolt', 'M4 × 12', 'A2'],
      ['Nyloc nut', 'M3', 'B1'],
      ['Nyloc nut', 'M4', 'B2'],
      ['Washer', 'M3', 'C1'],
      ['Washer', 'M4', 'C2'],
    ],
    formats: ['csv', 'tsv', 'markdown', 'json', 'rec'],
    label: '{{Part}} {{Size}}\nBin {{Bin}}',
  },
  {
    name: 'Example: serial numbers',
    columns: ['A'],
    rows: Array.from({ length: 8 }, (_, i) => [`SN-${String(i + 1).padStart(4, '0')}`]),
    formats: ['list'],
    label: '{{A}}',
  },
];

// Which kind of data a file's text is, by its name's extension or, failing
// that, by what the text looks like: 'json', 'markdown', 'rec' or 'csv'.
export function dataFormat(text, name = '') {
  const ext = name.toLowerCase().match(/\.([a-z]+)$/)?.[1];
  const t = text.replace(/^\uFEFF/, '');
  if (ext === 'json' || (!ext && /^\s*[[{]/.test(t))) return 'json';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'rec') return 'rec';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (/^\s*[[{]/.test(t)) return 'json';
  if (/^\s*\|?.*\|.*\n\s*\|?\s*:?-{3,}/m.test(t)) return 'markdown';
  if (/^(%rec:|[A-Za-z][A-Za-z0-9_]*: )/m.test(t.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '')) {
    try { parseRecData(t); return 'rec'; } catch { /* not a recfile after all */ }
  }
  return 'csv';
}

// Reads data from a file's text (see dataFormat). Returns { columns, rows }.
export function parseData(text, name = '') {
  const t = text.replace(/^\uFEFF/, '');
  return { json: parseJsonData, markdown: parseMarkdownTable, rec: parseRecData, csv: parseCsv }[dataFormat(t, name)](t);
}

// Spreadsheet column names: A, B, … Z, AA, AB, …
export function columnLetters(n) {
  return Array.from({ length: n }, (_, i) => {
    let s = '';
    for (let k = i + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
    return s;
  });
}

// CSV without column names: the first row is data, and the columns are
// named A, B, C… as in a spreadsheet. withHeader undoes it.
export function withoutHeader({ columns, rows, ...rest }) {
  return { ...rest, header: false, columns: columnLetters(columns.length), rows: [columns, ...rows] };
}
export function withHeader({ columns, rows, ...rest }) {
  const [first = [], ...data] = rows;
  return { ...rest, header: true, columns: columns.map((_, i) => String(first[i] ?? '').trim() || `Column ${i + 1}`), rows: data };
}

// A guess at whether CSV's first row is data rather than column names:
// names are not numbers and not repeated, and they don't look like the
// values under them (a list of serial numbers, SN-0001, SN-0002…, is all
// data: same letters and digits in the same places).
const shape = (v) => String(v).trim().replace(/\d/g, '9').replace(/[A-Za-z]/g, 'a');
export function looksHeaderless({ columns, rows }) {
  const named = columns.filter((c) => !/^Column \d+$/.test(c));
  if (named.some((c) => /^[-+]?\d+([.,]\d+)?$/.test(c.trim()))) return true;
  if (new Set(named.map((c) => c.trim().toLowerCase())).size < named.length) return true;
  if (!rows.length) return false;
  // Every column's first value shaped like most of the values below it.
  return columns.every((c, i) => {
    const below = rows.map((r) => shape(r[i] ?? ''));
    return below.filter((v) => v === shape(c)).length > below.length / 2;
  });
}

const FIELD = /\{\{([^{}\n]+)\}\}/g;
const key = (name) => name.trim().toLowerCase();

// The field as it is typed in a label.
export const fieldTag = (name) => `{{${name}}}`;

// The field names a design uses that something can fill: built-ins, and
// the data's columns. Lower case.
export function usedFields(design) {
  const known = new Set([...BUILT_IN, ...(design.data?.columns ?? []).map(key)]);
  const found = new Set();
  for (const it of design.items ?? []) {
    const prop = FIELD_PROPS[it.type];
    for (const m of String((prop && it[prop]) ?? '').matchAll(FIELD)) {
      if (known.has(key(m[1]))) found.add(key(m[1]));
    }
  }
  return found;
}

// Does printing this design make more than one kind of label?
export const hasFields = (design) => usedFields(design).size > 0;

// Does the design use a column of its data (so it prints one label per row)?
export function usesData(design) {
  const used = usedFields(design);
  return !!design.data?.rows?.length && (design.data.columns ?? []).some((c) => used.has(key(c)));
}

// The rows of the data that print (all but the ones unticked), as indices.
export function chosenRows(design) {
  const skip = new Set(design.data?.skip ?? []);
  return (design.data?.rows ?? []).map((_, i) => i).filter((i) => !skip.has(i));
}

// The counter's value for the k-th label printed (from 0), as text.
export function counterText(counter, k) {
  const { start = 1, step = 1, digits = 0 } = counter ?? {};
  const n = start + step * k;
  const s = String(Math.abs(n)).padStart(digits, '0');
  return n < 0 ? `-${s}` : s;
}

// Values for one label: the k-th label printed, from data row `row` (an
// index into design.data.rows, or null without data), at time `now`.
export function fieldValues(design, row, k, now = new Date()) {
  const values = new Map([
    [COUNTER, counterText(design.counter, k)],
    ['date', now.toLocaleDateString()],
    ['time', now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })],
  ]);
  const { columns = [], rows = [] } = design.data ?? {};
  const r = row == null ? null : rows[row];
  // Columns win over built-ins of the same name.
  columns.forEach((c, i) => values.set(key(c), r ? r[i] ?? '' : ''));
  return values;
}

// The text with each known {field} replaced.
export const fillText = (text, values) => String(text).replace(FIELD, (all, name) => (values.has(key(name)) ? values.get(key(name)) : all));

// A copy of the items with their fields filled in. Items keep their order
// and ids, so the editor's per-item bounds still line up.
export function fillItems(items, values) {
  return items.map((it) => {
    const prop = FIELD_PROPS[it.type];
    return prop && it[prop] != null ? { ...it, [prop]: fillText(it[prop], values) } : it;
  });
}

// The labels a print makes, in order: { row, k } per label, where row is a
// data row (or null) and k counts labels for the counter. With data, each
// chosen row prints `copies` times; without, `copies` labels.
export function labelRuns(design, copies) {
  const rows = usesData(design) ? chosenRows(design) : [null];
  const runs = [];
  for (const row of rows) for (let c = 0; c < copies; c++) runs.push({ row, k: runs.length });
  return runs;
}
