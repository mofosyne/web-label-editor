// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv, parseData, usedFields, fieldValues, fillItems, fillText, labelRuns, counterText, chosenRows,
} from '../src/fields.js';

test('CSV: quotes, doubled quotes, line breaks in quotes, CRLF, blank lines', () => {
  const { columns, rows } = parseCsv('﻿Name,Note\r\n"Doe, Jane","say ""hi""\nthere"\r\n\r\nBob,\n');
  assert.deepEqual(columns, ['Name', 'Note']);
  assert.deepEqual(rows, [['Doe, Jane', 'say "hi"\nthere'], ['Bob', '']]);
});

test('CSV: semicolons and tabs are detected; short rows are padded', () => {
  assert.deepEqual(parseCsv('a;b;c\n1;2').rows, [['1', '2', '']]);
  assert.deepEqual(parseCsv('a\tb\nx\ty').rows, [['x', 'y']]);
  assert.deepEqual(parseCsv('').columns, []);
});

test('fields: columns (any case) and built-ins fill; unknown braces stay', () => {
  const design = {
    data: { columns: ['Name', 'Part No'], rows: [['Ann', 'P-1'], ['Bo', 'P-2']] },
    counter: { start: 7, digits: 3 },
    items: [
      { type: 'text', text: 'To {name} #{n} {other}' },
      { type: 'barcode', data: '{Part No}' },
      { type: 'box' },
    ],
  };
  assert.deepEqual([...usedFields(design)].sort(), ['n', 'name', 'part no']);
  const v = fieldValues(design, 1, 2);
  const [t, bc, box] = fillItems(design.items, v);
  assert.equal(t.text, 'To Bo #009 {other}');
  assert.equal(bc.data, 'P-2');
  assert.equal(box, design.items[2]);
  assert.equal(fillText('{date}', fieldValues(design, 0, 0, new Date(2026, 0, 2))), new Date(2026, 0, 2).toLocaleDateString());
});

test('counter: start, step, zero padding, negatives', () => {
  assert.equal(counterText(undefined, 0), '1');
  assert.equal(counterText({ start: 10, step: 5, digits: 4 }, 2), '0020');
  assert.equal(counterText({ start: -1, digits: 2 }, 0), '-01');
});

test('runs: each chosen row times copies, or copies alone without data fields', () => {
  const design = { data: { columns: ['A'], rows: [['x'], ['y'], ['z']], skip: [1] }, items: [{ type: 'text', text: '{A}' }] };
  assert.deepEqual(chosenRows(design), [0, 2]);
  assert.deepEqual(labelRuns(design, 2).map((r) => [r.row, r.k]), [[0, 0], [0, 1], [2, 2], [2, 3]]);
  const plain = { ...design, items: [{ type: 'text', text: 'Box {n}' }] };
  assert.deepEqual(labelRuns(plain, 3).map((r) => [r.row, r.k]), [[null, 0], [null, 1], [null, 2]]);
});

test('data: JSON objects, arrays and wrapped lists', () => {
  assert.deepEqual(parseData('[{"Name":"Ann","Qty":2},{"Name":"Bo","Note":null,"Qty":{"a":1}}]', 'x.json'),
    { columns: ['Name', 'Qty', 'Note'], rows: [['Ann', '2', ''], ['Bo', '{"a":1}', '']] });
  assert.deepEqual(parseData('[["A","B"],[1,2]]').rows, [['1', '2']]);
  assert.deepEqual(parseData('{"items":[{"A":"x"}]}').rows, [['x']]);
});

test('data: the first Markdown table, with escaped bars and alignment', () => {
  const md = '# Parts\n\n| Part | Bin |\n|:-----|----:|\n| M3 \\| 10 mm | A1 |\n| Nut | |\n\nAfter.';
  assert.deepEqual(parseData(md, 'parts.md'), { columns: ['Part', 'Bin'], rows: [['M3 | 10 mm', 'A1'], ['Nut', '']] });
  assert.deepEqual(parseData('Name | Bin\n--- | ---\nAnn | 3').rows, [['Ann', '3']]);
});

test('data: recfiles, first record type, repeated fields joined', () => {
  const rec = '# parts\n%rec: Part\n\nName: Bolt\nBin: A1\n\nName: Nut\nTag: x\nTag: y\n\n%rec: Other\n\nZ: 1\n';
  assert.deepEqual(parseData(rec, 'p.rec'), { columns: ['Name', 'Bin', 'Tag'], rows: [['Bolt', 'A1', ''], ['Nut', '', 'x\ny']] });
  assert.deepEqual(parseData('Name: Ann\n\nName: Bo\n').rows, [['Ann'], ['Bo']]);
  assert.deepEqual(parseData('Name,Bin\nAnn,1').rows, [['Ann', '1']]);
});
