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
  assert.deepEqual(models['dymo-lw450'].media.map((m) => m.id), ['cont-54', '30252', '99012', '11354', '11355']);
  assert.equal(dymo['30252'].acrossDots, 329);
  assert.equal(dymo['30252'].lengthDots, 1050);
  assert.deepEqual(dymo['30252'].margins, { left: 5.84, right: 1.52, top: 1.02, bottom: 1.52 });
  assert.equal(dymo['cont-54'].acrossDots, 638);
  assert.equal(dymo['cont-54'].lengthDots, undefined);
  assert.equal(dymo['11354'].acrossDots, 672, 'clipped to the 672-dot head');

  const tapes = models['brother-pt-p710bt'].media;
  assert.deepEqual(tapes.map((t) => [t.id, t.acrossDots, t.statusMm]), [
    ['tze-3.5', 24, 4], ['tze-6', 32, 6], ['tze-9', 52, 9], ['tze-12', 76, 12], ['tze-18', 120, 18], ['tze-24', 128, 24],
  ]);
  assert.equal(tapes[3].tapeMm, 12);

  const ids = (model) => models[model].media.map((m) => m.id);
  assert.ok(!ids('dymo-lw450').includes('1744907'), '4 × 6 in is too wide for the 450');
  assert.ok(ids('dymo-lw4xl').includes('1744907') && ids('dymo-lw4xl').includes('30252'), '4XL takes wide and normal labels');
  assert.equal(models['dymo-lw4xl'].media.find((m) => m.id === '1744907').acrossDots, 1233);
  assert.ok(!ids('brother-pt-e310bt').includes('tze-24'), 'PT-E310BT takes up to 18 mm');
  assert.ok(ids('brother-pt-e310bt').includes('tze-18'));
});

test('catalogue loader rejects broken records', () => {
  const base = '%rec: Medium\n\nId: x\nFamily: dymo-lw\nName: X\nKind: continuous\nWidthMm: 10\nSource: test\n';
  assert.doesNotThrow(() => applyCatalog(`${base}\nId: t\nFamily: brother-pt\nName: T\nKind: continuous\nWidthMm: 12\nPrintableDots: 76\nSource: test\n`, freshModels()));
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
