// SPDX-License-Identifier: GPL-3.0-or-later
// Builds the site and the offline download:
//
//   npm run package
//
//   dist/site/                       the app as published (GitHub Pages),
//                                    with the offline download in it
//   dist/web-label-editor/           the offline download, unpacked:
//     start.sh                       serves it on localhost and opens it
//     install-udev-rules.sh          USB access for the printers (Linux)
//     print-server.py                share a printer on the network
//                                    (docs/PRINT-SERVER-API.md)
//     READ ME FIRST.txt
//   dist/site/web-label-editor.zip   the same, zipped (needs `zip`)
//
// Browsers only allow USB on secure pages, which localhost is: opening
// index.html straight from the disk would not work, so start.sh runs a
// small web server (Python's) on this computer only.
import { cpSync, mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { appFiles, ROOT } from './app-files.mjs';

const DIST = join(ROOT, 'dist');
const SITE = join(DIST, 'site');
const APP = join(DIST, 'web-label-editor');
const PORT = 8737;
// USB vendors whose printers the app drives: DYMO and Brother.
const VENDORS = [['0922', 'DYMO'], ['04f9', 'Brother']];

const START = `#!/bin/sh
# Starts Web Label Editor from this folder, without internet: a small web
# server on this computer only (localhost), and the editor in a
# Chromium-based browser. Keep this window open while you use it.
#
# Browsers only allow USB on secure pages, which localhost is; opening
# index.html directly as a file does not work. The port stays the same
# (${PORT}, or PORT=... ./start.sh) so saved labels are there next time.
PORT="\${PORT:-${PORT}}"
cd "$(dirname "$0")" || exit 1
URL="http://localhost:$PORT/"

if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python >/dev/null 2>&1; then PY=python
else
  echo "Needs Python 3 to serve the editor (install the python3 package)."
  exit 1
fi
"$PY" -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM
sleep 1
if ! kill -0 "$SERVER" 2>/dev/null; then
  echo "Could not start on port $PORT (in use?). Try: PORT=8738 $0"
  exit 1
fi

for b in chromium chromium-browser google-chrome google-chrome-stable microsoft-edge microsoft-edge-stable brave-browser; do
  if command -v "$b" >/dev/null 2>&1; then
    "$b" --app="$URL" >/dev/null 2>&1 &
    OPENED=1
    break
  fi
done
if [ -z "$OPENED" ]; then
  if [ "$(uname)" = Darwin ]; then open -a "Google Chrome" "$URL" 2>/dev/null || open "$URL"
  else xdg-open "$URL" >/dev/null 2>&1 || true
  fi
fi

echo "Web Label Editor is running at $URL"
echo "Printing needs Chromium, Chrome or Edge (Firefox can't reach printers)."
echo "Keep this window open while you use it; press Ctrl+C to stop."
wait "$SERVER"
`;

const UDEV = `#!/bin/sh
# Lets the browser use DYMO and Brother label printers over USB on Linux: a
# udev rule that gives the person logged in at the computer (uaccess) access
# to their USB devices.
#
#   sudo ./install-udev-rules.sh            install
#   sudo ./install-udev-rules.sh --remove   undo
#
# If the browser still can't open the printer, the kernel's printer driver
# (usblp) may hold it: the app's USB setup help explains that case.
RULES=/etc/udev/rules.d/60-label-printer.rules
if [ "$(id -u)" != 0 ]; then
  echo "Run it with sudo: sudo $0 $*"
  exit 1
fi
if [ "$1" = --remove ]; then
  rm -f "$RULES"
  udevadm control --reload-rules
  echo "Removed $RULES."
  exit 0
fi
cat > "$RULES" <<'RULES_END'
# Web Label Editor: USB access to label printers for the user at the desktop.
${VENDORS.map(([id, name]) => `# ${name}\nSUBSYSTEM=="usb", ATTRS{idVendor}=="${id}", TAG+="uaccess"`).join('\n')}
RULES_END
udevadm control --reload-rules && udevadm trigger
echo "Installed $RULES. Unplug the printer and plug it back in, then Connect in the editor."
`;

const README = `Web Label Editor, for use without internet
============================================

Design labels and print them to DYMO LabelWriter and Brother P-touch / QL
printers. This folder is the whole app; nothing needs installing except a
Chromium-based browser (Chromium, Chrome, Edge or Brave) and Python 3,
which most Linux systems have.

1. Linux, once: let the browser use the printer over USB
     sudo ./install-udev-rules.sh

2. Start it (keep the window it runs in open):
     ./start.sh
   It opens the editor in Chromium (or Chrome / Edge) at
   http://localhost:${PORT}/

Firefox and Safari can design labels but can't print: they have no WebUSB.

3. Or share a printer on the network (e.g. from a Raspberry Pi), so any
   browser on it can print, phones, Firefox and Safari included:
     python3 print-server.py --model dymo-lw450 --device /dev/usb/lp0
   then open http://<this computer>:8740/ on the other devices. --model is
   the editor's printer id; the list is in docs/PRINT-SERVER-API.md on
   GitHub. Anyone on the network can print, so use it on one you trust.

Your labels are kept in that browser for this address; use File → Save to a file
for copies. The latest version is at
https://mofosyne.github.io/web-label-editor/ (it also works offline once
opened, and can be installed from File → Install as an app).

Licence: GPL-3.0-or-later (one file GPL-3.0-only); see the README on GitHub:
https://github.com/mofosyne/web-label-editor
`;

rmSync(DIST, { recursive: true, force: true });
for (const dir of [SITE, APP]) {
  for (const f of appFiles()) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    cpSync(join(ROOT, f), join(dir, f));
  }
}
writeFileSync(join(APP, 'start.sh'), START);
writeFileSync(join(APP, 'install-udev-rules.sh'), UDEV);
writeFileSync(join(APP, 'READ ME FIRST.txt'), README);
cpSync(join(ROOT, 'scripts', 'print-server.py'), join(APP, 'print-server.py'));
chmodSync(join(APP, 'print-server.py'), 0o755);
chmodSync(join(APP, 'start.sh'), 0o755);
chmodSync(join(APP, 'install-udev-rules.sh'), 0o755);
try {
  execFileSync('zip', ['-qr', join(SITE, 'web-label-editor.zip'), 'web-label-editor'], { cwd: DIST });
  console.log('dist/site (with web-label-editor.zip) and dist/web-label-editor');
} catch {
  console.log('dist/site and dist/web-label-editor (no zip: the zip command is missing)');
}
