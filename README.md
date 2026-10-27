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

## Direct USB instead of a printer driver

This editor does not go through the operating system's print system (CUPS on
Linux and macOS, the spooler on Windows). The browser opens the printer's USB
or Bluetooth connection itself and sends the printer's own raster commands.

Why:

- **Works the same everywhere.** No driver to install, and nothing
  Linux-specific: the same page works on Linux, Windows, macOS and ChromeOS.
  DYMO's Linux driver is old, and Brother's are closed x86-only binaries.
- **Continuous rolls without page-size gymnastics.** Print drivers think in
  fixed paper sizes, so continuous tape means defining custom page sizes, and
  some drivers cap the length. Here the label is simply as long as the design.
- **Exact dots.** The page renders at the printer's resolution and sends those
  dots unchanged. No driver scaling, margins or halftoning, so barcodes and QR
  codes stay sharp.
- **Two-way.** The printer can be asked what tape is loaded and whether
  anything is wrong. A print queue is one-way.

The trade-offs:

- **The browser needs permission on the USB device.** Apps like glabels print
  through CUPS, whose USB backend runs as a system user, so they never needed
  it. Here the browser runs as you, so on Linux you add one udev rule (below).
  That is the "Access denied" error.
- **One user of the printer at a time.** A USB printer interface has one
  owner at a time, so programs take turns. The editor claims the printer only
  while it prints or reads status and then lets go, as CUPS does, so glabels
  and the editor can both use it, just not at the same moment. The exception
  is the `usblp` kernel driver, which holds the printer for as long as it's
  plugged in (see Linux setup below).
- **Chromium-based browsers only** (Chrome, Edge, Brave, Opera), since WebUSB
  and Web Serial exist only there.
- **No print queue or network sharing.** For those, use **Download PNG** and
  print the image through your normal printer driver.

## Per-OS setup

The browser opens the printer's USB device itself (see above). If you see
**"Failed to execute 'open' on 'USBDevice': Access denied"**, the operating
system is keeping the browser out. The fix depends on the OS.

### Linux

Give your desktop user access to the printers with a udev rule:

```sh
sudo tee /etc/udev/rules.d/60-label-printers.rules <<'RULES'
# DYMO LabelWriter
SUBSYSTEM=="usb", ATTRS{idVendor}=="0922", TAG+="uaccess"
# Brother PT-P710BT
SUBSYSTEM=="usb", ATTRS{idVendor}=="04f9", ATTRS{idProduct}=="20af", TAG+="uaccess"
RULES
sudo udevadm control --reload-rules && sudo udevadm trigger
```

Then unplug and replug the printer. (`uaccess` grants the logged-in desktop
user access. On a system without it, use `MODE="0666"` instead of
`TAG+="uaccess"`.)

- **Chromium from a snap:** also run `sudo snap connect chromium:raw-usb`.
- **"Unable to claim interface"** (only then): something else has the
  printer. `lsusb -t` shows the printer's `Driver=`: `usblp` is the kernel
  printer driver (below); `usbfs` means a program has it, usually CUPS mid-job,
  so close it or `sudo systemctl stop cups` while printing from here. If
  `modprobe -r usblp` reports the module is in use, stop CUPS first.
  - Try it out, nothing saved: `sudo modprobe -r usblp`. It comes back on the
    next plug-in or reboot.
  - Keep it off: `echo 'blacklist usblp' | sudo tee /etc/modprobe.d/no-usblp.conf`.
    This applies to every USB printer. Check `lpstat -v` first: a `usb://`
    address means CUPS uses its own libusb backend and does not need `usblp`;
    a `/dev/usb/lp0` address means it does, so use the temporary option.
  - Undo: `sudo rm /etc/modprobe.d/no-usblp.conf && sudo modprobe usblp`.
- **Undo the permission rule:** `sudo rm /etc/udev/rules.d/60-label-printer.rules`,
  then replug.

### Windows

Windows' own printer driver (`usbprint`) owns the device. Either
- use **Bluetooth** (Brother PT-P710BT only; pair it in Windows Settings
  first, then pick it in the browser's port list), or
- switch the printer to **WinUSB** with [Zadig](https://zadig.akeo.ie/):
  *Options → List All Devices*, pick the printer, choose **WinUSB**, *Replace
  Driver*. DYMO Connect / P-touch Editor won't see the printer until you
  reinstall their driver (Device Manager → Update driver).

### macOS

Usually works. If access is denied, another program has the printer: quit
DYMO Connect, the DYMO Web Service (menu bar) or P-touch Editor, then unplug
and replug.

### ChromeOS, Android

Usually works. On ChromeOS, remove the printer from *Settings → Printers* if
it was added there.

## Using it

- **Length:** for continuous media pick *Fit to content* (length follows the
  rightmost item plus padding) or *Fixed*. Die-cut labels always use their own
  length.
- **Items:** text (multi-line, any installed font), images (threshold or
  dithering), boxes, **QR codes** and **barcodes** (Code 128, EAN-13, UPC-A).
  Drag to move; arrow keys nudge.
- **Printable area:** the hatched border in the preview is where the printer
  can't print, taken from DYMO's own driver (about 5.8 mm at the end that
  feeds out first, 1–1.5 mm elsewhere). Anything placed there is flagged.
- **Position adjust and test prints:** if prints land off position, open
  *Test prints* in the Printer panel. **Grid** prints a millimetre grid
  numbered from where the label should start: the number at the label's left
  edge is how far to adjust **Feed** (the top edge gives **Across**).
  **Full black** shows everything the printer can reach. The adjustment is
  saved per printer in the browser and moves the hatched border with it.
- **Fit text in a box:** tick it on a text item to give it a fixed box; the
  font size is chosen automatically so the text fills it. *Fill printable
  area* makes the box cover the whole usable label. Drag the corner handle to
  resize boxes, images, QR codes and fitted text.
- **QR codes and barcodes** are drawn on whole printer dots, so bar and module
  edges stay sharp. Bar width snaps to whole dots (the panel shows the actual
  size), and barcode quiet zones are part of the item width. Leave a few mm of
  blank space around QR codes.
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

## Bluetooth

The **PT-P710BT** prints over Bluetooth Classic (Serial Port Profile), which
browsers reach through **Web Serial**. It is not Web Bluetooth, which only
covers Bluetooth Low Energy.

1. Pair the printer in your OS Bluetooth settings (hold the Bluetooth button
   until its light blinks).
2. Click **Connect Bluetooth / serial** and pick the printer. On Windows and
   macOS it may also be listed as a serial/COM port created by the pairing.

This needs Chrome or Edge 117 or later on the desktop. Android support for
Bluetooth serial is not confirmed. On Windows this is the easiest route
because it needs no driver swap. Printing over Bluetooth is slower than USB,
so long labels take a few seconds to send.

The **LabelWriter 450** has no Bluetooth; it is USB only.

## Adding a label or tape size

Label and tape sizes live in [`catalog/media.rec`](catalog/media.rec), a
[GNU recutils](https://www.gnu.org/software/recutils/) file: one record per
label, one field per line, with comments. To add one, copy a similar record,
give it a new `Id`, and fill in the sizes in millimetres. The comments at the
top of the file describe every field.

```
Id: 30252
Printer: dymo-lw450
Name: 30252 Address 28 × 89 mm
Kind: diecut
WidthMm: 27.86
LengthMm: 88.9
MarginLeftMm: 5.84
MarginRightMm: 1.52
MarginTopMm: 1.02
MarginBottomMm: 1.52
CornerMm: 3
Source: lw450.ppd 30252: 78.96 x 252 pt, imageable 4.32 4.32 76.08 235.44
```

- Never rename or reuse an `Id`: saved designs refer to labels by it.
- Say where the numbers came from in `Source` (a driver file, a datasheet,
  or "measured").
- Check the file with `recfix catalog/media.rec` (from the `recutils`
  package). CI runs that too, and checks that the app's parser reads the file
  exactly as `recsel` does.

Why recutils: the catalogue is flat, hand-edited data where every number
needs a comment saying where it came from. One field per line keeps diffs and
merges clean, and `recfix` validates types, required fields and unique ids.
Designs stay JSON because they are nested and written by the app.

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
- `catalog/media.rec`, `src/recfile.js`, `src/catalog.js`: the label catalogue,
  a small recutils reader, and the code that turns records into media.
- `src/codes/qr.js`, `src/codes/barcode.js`: QR (byte mode, versions 1–40,
  levels L/M/Q/H), Code 128 (sets B/C), EAN-13 and UPC-A encoders. Verified by
  decoding all 160 QR version/level combinations at full capacity, plus the
  linear codes, with the zxing-cpp reader.

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

- More models (LabelWriter 4XL, Brother QL, more P-touch)
- Desktop build (e.g. Tauri) with native USB and raw network printing, so
  Windows needs no driver swap and Wi-Fi models work

## License

GPL-3.0. See [LICENSE](LICENSE).
