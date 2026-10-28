// SPDX-License-Identifier: GPL-3.0-or-later
// The files that make up the app as served: what the site deploys, the
// offline download contains and the service worker (sw.js) caches.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOP = ['index.html', 'style.css', 'icon.svg', 'manifest.webmanifest', 'sw.js'];
const DIRS = ['src', 'catalog'];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export function appFiles() {
  return [...TOP, ...DIRS.flatMap((d) => walk(join(ROOT, d)).map((p) => relative(ROOT, p)).sort())]
    .map((p) => p.split('\\').join('/'));
}
