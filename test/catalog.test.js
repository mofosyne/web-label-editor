// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRec, formatRecords } from '../src/recfile.js';
import { applyCatalog } from '../src/catalog.js';
import { MODELS } from '../src/printers/models.js';

const CATALOG = new URL('../catalog/media.rec', import.meta.url);
const catalogText = readFileSync(CATALOG, 'utf8');

const hasRecutils = (() => {
  try {
    execFileSync('recsel', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const freshModels = () => Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, { ...m, media: [] }]));

test('recfile parser handles comments, descriptors, continuations and blanks', () => {
  const { records, descriptors } = parseRec([
    '# comment',
    '%rec: Thing',
    '%key: Id',
    '',
    'Id: a',
    'Note: first',
    '+ second',
    '+',
    'Joined: ab\\',
    'cd',
    'C:  two spaces',
    'E:\ttab',
    '',
    '',
    'Id: b',
  ].join('\n'));
  assert.equal(descriptors.Thing.fields[1][1], 'Id');
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].fields, [
    ['Id', 'a'], ['Note', 'first\nsecond\n'], ['Joined', 'abcd'], ['C', ' two spaces'], ['E', 'tab'],
  ]);
  assert.equal(records[1].type, 'Thing');
  assert.throws(() => parseRec('not a field'), /expected "Name: value"/);
});

test('catalogue builds the expected media', () => {
  const models = applyCatalog(catalogText, freshModels());
  const dymo = Object.fromEntries(models['dymo-lw450'].media.map((m) => [m.id, m]));
  assert.deepEqual(models['dymo-lw450'].media.map((m) => m.id), ['cont-54', '30252', '99012', '11354', '11355', '30333', '30253', '30277', '30256', '99019']);
  assert.equal(dymo['30252'].acrossDots, 329);
  assert.equal(dymo['30252'].lengthDots, 1050);
  assert.deepEqual(dymo['30252'].margins, { left: 5.84, right: 1.52, top: 1.02, bottom: 1.52 });
  assert.equal(dymo['cont-54'].acrossDots, 638);
  const twoUp = models['dymo-lw450'].media.find((m) => m.id === '30333');
  assert.deepEqual([twoUp.acrossDots, twoUp.lanes], [150, { count: 2, pitchDots: 150, pageDots: 300 }], '30333: two 150-dot labels per row');
  const address2 = models['dymo-lw450'].media.find((m) => m.id === '30253');
  assert.deepEqual(address2.lanes, { count: 2, pitchDots: 346, pageDots: 693 }, '30253 keeps its real row width');
  assert.equal(dymo['cont-54'].lengthDots, undefined);
  assert.equal(dymo['11354'].acrossDots, 672, 'clipped to the 672-dot head');

  const tapes = models['brother-pt-p710bt'].media;
  // The whole tape across, with the printable band (ptouch-print's dots) centred in it.
  assert.deepEqual(tapes.map((t) => [t.id, t.acrossDots, t.band.y, t.band.h, t.statusMm]), [
    ['tze-3.5', 25, 0, 24, 4], ['tze-6', 43, 5, 32, 6], ['tze-9', 64, 6, 52, 9], ['tze-12', 85, 4, 76, 12],
    ['tze-18', 128, 4, 120, 18], ['tze-24', 170, 21, 128, 24],
  ]);
  assert.equal(tapes[3].tapeMm, 12);

  const ids = (model) => models[model].media.map((m) => m.id);
  assert.ok(!ids('dymo-lw450').includes('1744907'), '4 × 6 in is too wide for the 450');
  assert.ok(ids('dymo-lw4xl').includes('1744907') && ids('dymo-lw4xl').includes('30252'), '4XL takes wide and normal labels');
  assert.equal(models['dymo-lw4xl'].media.find((m) => m.id === '1744907').acrossDots, 1233);
  assert.ok(!ids('brother-pt-e310bt').includes('tze-24'), 'PT-E310BT takes up to 18 mm');
  assert.ok(ids('brother-pt-e310bt').includes('tze-18'));
  assert.ok(!ids('brother-ql-800').includes('ql-102'), '102 mm rolls need a QL-1100');
  assert.ok(ids('brother-ql-1100').includes('ql-102') && ids('brother-ql-1100').includes('ql-62'));
  const dk = models['brother-ql-800'].media.find((m) => m.id === 'ql-29x90');
  assert.deepEqual([dk.acrossDots, dk.lengthDots, dk.offsetRightDots, dk.widthMm, dk.lengthMm], [343, 1063, 6, 29, 90]);
  assert.deepEqual(dk.band, { y: 18, h: 306, x: 36, w: 991 }, 'printable 306 × 991 dots, centred on the label');
});

test('catalogue loader rejects broken records', () => {
  const base = '%rec: Medium\n\nId: x\nFamily: dymo-lw\nName: X\nKind: continuous\nWidthMm: 10\nSource: test\n';
  const others = '\nId: t\nFamily: brother-pt\nName: T\nKind: continuous\nWidthMm: 12\nPrintableDots: 76\nSource: test\n'
    + '\nId: q\nFamily: brother-ql\nName: Q\nKind: continuous\nWidthMm: 62\nPrintableDots: 696\nSource: test\n';
  assert.doesNotThrow(() => applyCatalog(`${base}${others}`, freshModels()));
  assert.throws(() => applyCatalog(base, freshModels()), /no media for brother-pt/);
  assert.throws(() => applyCatalog(base.replace('dymo-lw', 'nope'), freshModels()), /unknown family/);
  assert.throws(() => applyCatalog(base.replace('WidthMm: 10', 'WidthMm: wide'), freshModels()), /not a number/);
  assert.throws(() => applyCatalog(base.replace('Kind: continuous', 'Kind: roll'), freshModels()), /Kind must be/);
  assert.throws(() => applyCatalog(base.replace('Kind: continuous', 'Kind: diecut'), freshModels()), /missing LengthMm/);
  assert.throws(() => applyCatalog(`${base}\n${base.split('\n\n')[1]}`, freshModels()), /duplicate Id/);
});

test('parser agrees with GNU recsel on the catalogue', { skip: !hasRecutils && 'recutils not installed' }, () => {
  const ours = formatRecords(parseRec(catalogText).records.filter((r) => r.type === 'Medium'));
  const theirs = execFileSync('recsel', ['-t', 'Medium', CATALOG.pathname], { encoding: 'utf8' }).trimEnd();
  assert.equal(ours, theirs);
});

test('recfix accepts the catalogue and rejects a bad one', { skip: !hasRecutils && 'recutils not installed' }, () => {
  execFileSync('recfix', [CATALOG.pathname]);
  const dir = mkdtempSync(join(tmpdir(), 'rec-'));
  const bad = join(dir, 'bad.rec');
  writeFileSync(bad, catalogText.replace('WidthMm: 27.86', 'WidthMm: wide'));
  assert.throws(() => execFileSync('recfix', [bad], { stdio: 'pipe' }));
  writeFileSync(bad, `${catalogText}\nId: 30252\nFamily: dymo-lw\nName: dup\nKind: continuous\nWidthMm: 1\nSource: x\n`);
  assert.throws(() => execFileSync('recfix', [bad], { stdio: 'pipe' }), undefined, 'duplicate Id');
});
