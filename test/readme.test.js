// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderReadme } from '../scripts/update-readme.mjs';

test('README compatibility table matches the code (run `npm run docs` to update)', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.equal(readme, renderReadme(readme));
});
