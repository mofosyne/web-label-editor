// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UndoHistory } from '../src/undo.js';

test('undo and redo step through recorded states', () => {
  let t = 0;
  const h = new UndoHistory('a', { now: () => t });
  t = 1000; h.record('b');
  t = 2000; h.record('c');
  assert.equal(h.undo(), 'b');
  assert.equal(h.undo(), 'a');
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), 'b');
  t = 3000; h.record('d'); // a new change drops the redo steps
  assert.equal(h.canRedo, false);
  assert.equal(h.undo(), 'b');
});

test('quick or merged changes form one step; unchanged states are ignored', () => {
  let t = 0;
  const h = new UndoHistory('a', { now: () => t });
  t = 1000; h.record('ab');
  t = 1200; h.record('abc');
  t = 5000; h.record('abcd', { merge: true });
  assert.equal(h.record('abcd'), false);
  assert.equal(h.undo(), 'a');
  h.redo();
  h.checkpoint();
  h.record('x');
  assert.equal(h.undo(), 'abcd');
});

test('history is capped', () => {
  let t = 0;
  const h = new UndoHistory('0', { limit: 3, now: () => t });
  for (let i = 1; i <= 5; i++) { t += 1000; h.record(String(i)); }
  assert.deepEqual([h.undo(), h.undo(), h.undo(), h.undo()], ['4', '3', '2', null]);
});
