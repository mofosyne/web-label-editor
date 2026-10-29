// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderReadme, renderSw, renderApiDoc } from '../scripts/update-readme.mjs';

test('README compatibility table matches the code (run `npm run docs` to update)', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.equal(readme, renderReadme(readme));
});

test('sw.js caches every app file (run `npm run docs` to update)', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.equal(sw, renderSw(sw));
});

test('the print server spec lists every printer id (run `npm run docs` to update)', () => {
  const doc = readFileSync(new URL('../docs/PRINT-SERVER-API.md', import.meta.url), 'utf8');
  assert.equal(doc, renderApiDoc(doc));
});
