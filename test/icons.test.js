// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UI_ICONS, CLIPART_GROUPS } from '../src/lucide.js';
import { ICONS } from '../src/icons.js';

// The points a path passes through (each command's end point; not curve
// control points), following relative commands from the current point.
// Path data as tokens; an arc's two flags are single digits, written with
// no space after them (Lucide writes "a1.5 1.5 0 00-2.474…").
function tokenize(d) {
  const tokens = [];
  const num = /^[\s,]*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/;
  let rest = d;
  let cmd = '';
  let argIndex = 0;
  while ((rest = rest.replace(/^[\s,]+/, ''))) {
    if (/^[a-zA-Z]/.test(rest)) {
      cmd = rest[0];
      tokens.push(cmd);
      argIndex = 0;
      rest = rest.slice(1);
      continue;
    }
    const k = argIndex % 7;
    if (cmd.toLowerCase() === 'a' && (k === 3 || k === 4)) {
      tokens.push(rest[0]);
      rest = rest.slice(1);
    } else {
      const m = rest.match(num);
      tokens.push(m[1]);
      rest = rest.slice(m[0].length);
    }
    argIndex++;
  }
  return tokens;
}

function pathPoints(d) {
  const tokens = tokenize(d);
  const sizes = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  const pts = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cmd = null;
  let i = 0;
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const lower = cmd.toLowerCase();
    const rel = cmd === lower;
    if (lower === 'z') { x = sx; y = sy; continue; }
    const args = tokens.slice(i, i + sizes[lower]).map(Number);
    i += sizes[lower];
    const pair = (ax, ay) => (rel ? [x + ax, y + ay] : [ax, ay]);
    if (lower === 'h') x = rel ? x + args[0] : args[0];
    else if (lower === 'v') y = rel ? y + args[0] : args[0];
    else if (lower === 'a') {
      // Radii, rotation and flags, then the end point.
      pts.push(pair(args[5], args[6]));
      [x, y] = pts[pts.length - 1];
    } else {
      // The point the command ends on (curve control points may lie outside).
      pts.push(pair(args[args.length - 2], args[args.length - 1]));
      [x, y] = pts[pts.length - 1];
    }
    pts.push([x, y]);
    if (lower === 'm') {
      [sx, sy] = [x, y];
      cmd = rel ? 'l' : 'L'; // pairs after a move are lines
    }
  }
  return pts;
}

test('every icon stays inside its 24 × 24 box (pieces joined with absolute starts)', () => {
  const all = [
    ...Object.entries(UI_ICONS),
    ...CLIPART_GROUPS.flatMap(([, list]) => list.map(([id, , d]) => [id, d])),
    ...Object.entries(ICONS).map(([id, ic]) => [id, ic.path]),
  ];
  for (const [id, d] of all) {
    for (const [px, py] of pathPoints(d)) {
      assert.ok(px >= -1.5 && px <= 25.5 && py >= -1.5 && py <= 25.5, `${id}: point ${px.toFixed(2)},${py.toFixed(2)} outside the box`);
    }
  }
});

test('the path walker catches a piece that moves relative to the previous one', () => {
  const broken = 'm14 12 4 4 4-4M18 16V7m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16';
  assert.ok(pathPoints(broken).some(([px]) => px > 24));
  assert.ok(pathPoints(UI_ICONS.smaller).every(([px]) => px <= 24));
});
