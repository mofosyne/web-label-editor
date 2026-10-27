# Web Label Editor

A static web page for designing labels and printing them **directly** to
thermal label printers, with first-class support for **continuous rolls**:
the label is as long as its content, or any length you choose.

No drivers, no CUPS, no server. The page renders your design to the exact dots
the printer will burn, encodes them in the printer's own raster language, and
sends the bytes over **WebUSB** or **Web Serial** (Bluetooth).

## Supported printers

| Printer | Connection | Media |
|---|---|---|
| DYMO LabelWriter 450 (also 450 Turbo / Twin Turbo) | USB | Continuous 54 mm paper, die-cut 30252, 99012, 11354, 11355 |
| Brother PT-P710BT | USB, Bluetooth | TZe tape 3.5, 6, 9, 12, 18, 24 mm |

Adding a printer is a matter of an encoder (bitmap → bytes) plus an entry in
`src/printers/models.js`.

## Running it

It is plain HTML/JS with no build step. Serve the folder over HTTP(S):

```sh
npm run serve        # python3 -m http.server 8000
# open http://localhost:8000
```

WebUSB and Web Serial only work in Chromium-based browsers (Chrome, Edge,
Brave, Opera; Chrome on Android for USB) and only on `https://` or
`localhost`. GitHub Pages works as-is (see below). In other browsers you can still design
and **Download PNG** at the printer's exact resolution.

## Per-OS setup

The browser needs to own the printer's USB interface. Whether that works out
of the box depends on whether the OS has already bound a printer driver to it.

**macOS, ChromeOS, Android:** usually works out of the box.

**Windows:** Windows binds its USB printer driver (`usbprint`), so the
browser cannot claim the device. Either
- use **Bluetooth** for the PT-P710BT (pair it in Windows Settings first; it
  appears in the browser's serial-port picker), or
- replace the driver with **WinUSB** using [Zadig](https://zadig.akeo.ie/).
  This makes the printer unavailable to DYMO Connect / P-touch Editor until you
  reinstall their driver.

**Linux:** give your user access to the device and keep the `usblp` kernel
module off it. Example udev rule, `/etc/udev/rules.d/60-label-printers.rules`:

```
SUBSYSTEM=="usb", ATTRS{idVendor}=="0922", TAG+="uaccess"
SUBSYSTEM=="usb", ATTRS{idVendor}=="04f9", ATTRS{idProduct}=="20af", TAG+="uaccess"
```

If connecting reports that the interface cannot be claimed, `usblp` has it:
`sudo modprobe -r usblp` (or blacklist it). For Bluetooth, recent Chrome can
open the printer's serial profile directly from the port picker once paired.

## Using it

- **Length:** for continuous media pick *Fit to content* (length follows the
  rightmost item plus padding) or *Fixed*. Die-cut labels always use their own
  length.
- **Items:** text (multi-line, any installed font), images (threshold or
  dithering), and boxes. Drag to move; arrow keys nudge.
- **Tape detection** (P-touch): on connect and before every print the app
  reads the printer status: tape width, type (laminated, fabric, heat-shrink…)
  and tape/ink colours. It switches the layout to the loaded width, shows the
  preview in the real colours, and stops a print if the tape changed or the
  printer reports a problem (no tape, cover open, incompatible tape). The
  LabelWriter 450 has no media sensing, so pick its labels yourself.
- **Save / Open** stores the design as JSON. The current design also persists in
  the browser.
- The PT-P710BT always feeds about 25 mm of leader tape before printing; that is
  the hardware, not the app.

## How it works

```
design (mm) ──render──▶ 1-bit strip bitmap (printer dpi)
                         │  x = along the feed, y = across the head
                         ▼
               encoder (per printer family) ──▶ bytes ──▶ WebUSB / Web Serial
```

- `src/render.js`: design → bitmap, via an off-screen canvas.
- `src/printers/dymo-labelwriter.js`: LabelWriter 400/450 commands
  (`ESC L`, `ESC D`, `SYN` raster lines, `ESC G`/`ESC E`).
- `src/printers/brother-ptouch.js`: P-touch raster mode (`ESC i R`,
  PackBits `G` lines, `ESC i M` auto-cut, status `ESC i S`).
- `src/transport.js`: WebUSB and Web Serial.

Protocol references: DYMO's open-source
[dymo-cups-drivers](https://github.com/matthiasbock/dymo-cups-drivers),
[ptouch-print](https://git.familie-radermacher.ch/linux/ptouch-print.git) and
Brother's P-touch Raster Command Reference.

## Tests and CI

```sh
npm test
```

`.github/workflows/ci.yml` runs the tests on every push and pull request, and
deploys `main` to GitHub Pages. Enable that once under
**Settings → Pages → Source: GitHub Actions**.

Encoder tests check the command streams byte by byte and compare P-touch raster
lines against ptouch-print's pixel mapping.

## Roadmap

- QR codes and barcodes
- More models (LabelWriter 4XL, Brother QL, more P-touch)
- Desktop build (e.g. Tauri) with native USB and raw network printing, so
  Windows needs no driver swap and Wi-Fi models work

## License

GPL-3.0. See [LICENSE](LICENSE).
