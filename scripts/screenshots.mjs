// SPDX-License-Identifier: GPL-3.0-or-later
// Regenerates the README screenshots in docs/screenshots from the app
// itself, with fixed example designs.
//
//   npm run screenshots
//
// Needs Playwright with Chromium (not a dependency of the app):
//   npm install --no-save playwright && npx playwright install chromium
// Re-run it whenever the editor's look changes, and commit the images.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'docs/screenshots');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.rec': 'text/plain', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
};

// Example designs, one per screenshot, as saved by the app.
const DESIGNS = {
  'editor-dymo': {
    version: 2, printer: 'dymo-lw450', medium: '30252', options: {}, length: { mode: 'auto', mm: 60, padMm: 2 }, invert: false,
    items: [
      { id: 'a', type: 'text', text: 'Jane Doe\n42 Label Street\nSpringfield 4000', font: 'sans-serif', bold: true, italic: false, align: 'left', fit: true, size: 5, x: 6.5, y: 2, w: 58, h: 23.5 },
      { id: 'b', type: 'qr', data: 'https://mofosyne.github.io/web-label-editor/', ecc: 'M', size: 21, x: 65.5, y: 3.3 },
    ],
  },
  'editor-tape': {
    version: 2, printer: 'brother-pt-p710bt', medium: 'tze-12', options: {}, length: { mode: 'auto', mm: 60, padMm: 2 }, invert: false,
    items: [
      { id: 'a', type: 'text', text: 'Rack A  Port 12', font: 'sans-serif', bold: true, italic: false, align: 'left', size: 6.5, x: 2, y: 2.6 },
      { id: 'b', type: 'barcode', symbology: 'code128', data: 'NET0012', module: 0.3, height: 6.8, showText: true, textSize: 2.6, x: 52, y: 1 },
    ],
  },
};

function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function loadPlaywright() {
  try {
    return createRequire(import.meta.url)('playwright');
  } catch {
    console.error('Playwright is not installed: npm install --no-save playwright && npx playwright install chromium');
    process.exit(1);
  }
}

const { chromium } = await loadPlaywright();
const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  // Storage is set from a plain file on the same origin, where the app is
  // not running: the app saves its own design shortly after it starts and
  // would overwrite one written while it is open.
  const setStorage = async (items) => {
    await page.goto(`${url}catalog/media.rec`);
    await page.evaluate((entries) => {
      localStorage.clear();
      for (const [k, v] of entries) localStorage.setItem(k, v);
    }, Object.entries(items));
  };
  for (const [name, design] of Object.entries(DESIGNS)) {
    await setStorage({ 'web-label-editor:welcomed': '1', 'web-label-editor:design': JSON.stringify(design) });
    await page.goto(url);
    await page.waitForTimeout(400);
    await page.locator('#item-list li').first().click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log(`docs/screenshots/${name}.png`);
  }
  // The welcome page, as on a first visit (over the tape design).
  await setStorage({ 'web-label-editor:design': JSON.stringify(DESIGNS['editor-tape']) });
  await page.goto(url);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'welcome.png') });
  console.log('docs/screenshots/welcome.png');
} finally {
  await browser.close();
  server.close();
}
if (errors.length) {
  console.error('Page errors:', errors);
  process.exit(1);
}
