# Print server API (web-label-print/1)

For servers that host Web Label Editor next to a label printer: a
Raspberry Pi, a NAS, an ESP32, or an existing project such as
brother_ql_web. The server serves the editor's files plus two small
endpoints. Anyone who opens the page in any browser (phones, Firefox and
Safari included) gets the editor with that printer already connected. They
design the label, press Print, and the server prints it.

The contract is deliberately small: one static JSON file and one POST
endpoint. A server that just passes bytes on to a USB or serial printer
needs no image handling and no printer driver, so a microcontroller can
implement it.

A working reference is
[`scripts/print-server.py`](../scripts/print-server.py): standard-library
Python, also included in the offline download.

## How it fits together

```
your-server/                  (any path; relative URLs throughout)
  index.html, src/, …         the editor's files, unchanged
  printer.json                GET: which printer is here
  print                       POST: a label to print
```

1. **Host the editor's files.** Use `dist/site` from `npm run package`, or
   unpack `web-label-editor.zip` from the
   [published site](https://mofosyne.github.io/web-label-editor/web-label-editor.zip).
   Serve them as they are, under any path.
2. **On load, the editor fetches `printer.json` beside the page.** If it
   answers with this API's `api` value:
   - the printer is selected and shown as connected;
   - the printer menu is fixed to it;
   - Print sends jobs to `print` beside the page.

   No setup, and no WebUSB needed in the browser.
3. **Serve both from the same server as the page.** Browsers block a page
   from one address talking to a plain-http server at another (mixed
   content, cross-origin rules). Served together, none of that applies and
   CORS is not needed.

## `GET printer.json`

```json
{
  "api": "web-label-print/1",
  "model": "dymo-lw450",
  "name": "Workshop LabelWriter",
  "medium": "30252",
  "accepts": "raw"
}
```

| Field | | Meaning |
|---|---|---|
| `api` | required | Exactly `web-label-print/1`. Anything else and the editor ignores the file. |
| `model` | required | The printer, as one of the editor's printer ids (table below). The editor uses that printer's resolution, head width, labels and command encoder. |
| `name` | optional | Shown in the editor ("Connected: Workshop LabelWriter (print server)"). |
| `medium` | optional | The label loaded, as a media id from the table below. The editor starts on it; the user can still pick another. |
| `accepts` | optional | `"raw"` (default) or `"pbm"`: what `print` takes (see below). |

Serve it with `Cache-Control: no-store` if it can change. Unknown fields
are ignored, so later versions can add fields without breaking older
editors or servers.

## `POST print`

The request body is one job. The response is:
- **`2xx`:** printed (or queued to print).
- **Anything else:** failed. The body should be a short plain-text
  message written for the person printing, such as "The printer is out of
  labels." The editor shows it as is.

The editor sends one request per job and waits for the reply before
sending the next, so a server can handle jobs one at a time.

### `accepts: "raw"`: the printer's own commands

- **Content type:** `application/octet-stream`.
- **What the body is:** exactly the bytes the editor would send over USB,
  ready for the printer, for the printer named by `model`. It is already
  laid out for that printer: margins, resolution (including 600 dpi
  modes), cutting and copies are all in the bytes.
- **What the server does:** write it to the printer unchanged, in one
  piece, without mixing it with another job. For example:
  - a USB printer's `/dev/usb/lp0` on Linux;
  - a serial or Bluetooth SPP port;
  - a raw CUPS queue (`lp -d NAME -o raw`).
- **Size:** a job is usually tens of kB, and up to a few MB for a long
  label at 600 dpi.

This is the minimal case: no image code and no driver. It suits an ESP32,
or a Pi that simply owns the printer.

### `accepts: "pbm"`: the label as a bitmap

For servers that already have their own driver (brother_ql, labelle,
ptouch-print, …) and want an image to feed it.

- **Content type:** `image/x-portable-bitmap`.
- **Format:** a binary PBM (`P4`), the simplest image format there is: a
  text header `P4\n<width> <height>\n`, then the rows, 1 bit per dot, most
  significant bit first, each row padded to a whole byte, 1 = black. It
  needs no decoding library, and Pillow opens it.
- **Size:** exactly the printer's dots. Do not scale it, or the preview
  stops being what prints.
  - *Width* is the dots across the print head's printable area for this
    label.
  - *Height* is the label's length in dots, at the printer's resolution.
- **Orientation:** as the label comes out, seen from the printed side,
  with the end that comes out first at the top. The first row is printed
  first.
- **Copies:** one request per label.
- **Status:** experimental. The orientation has not yet been checked on
  every driver; if yours comes out turned or mirrored, please open an
  issue.

## Not in version 1

Each of these can come later as an optional field or endpoint, without
breaking version 1:
- reading the printer's status or loaded tape;
- a job queue;
- authentication;
- several printers on one server.

**Security:** anyone who can reach the server can print. Run it on a
network you trust, or put it behind your own login (a reverse proxy, for
example). The editor sends the browser's cookies with its requests, so
that works without changes.

## Implementing it

### Python (reference)

```sh
python3 print-server.py --model dymo-lw450 --device /dev/usb/lp0
```

It serves the editor from its own folder, writes `printer.json` from its
options, and writes each job to the device. `--command "lp -d NAME -o raw"`
pipes each job into a command instead. On Linux, the user running it needs
write access to `/dev/usb/lp*`, which usually means being in the `lp`
group.

### Adding it to an existing server

Using Flask as an example:

```python
@app.get('/labels/printer.json')
def printer_json():
    return {'api': 'web-label-print/1', 'model': 'brother-ql-570', 'medium': 'ql-62', 'accepts': 'raw'}

@app.post('/labels/print')
def print_label():
    with open('/dev/usb/lp0', 'wb') as printer:
        printer.write(request.get_data())
    return 'Printed'
```

Serve the editor's files from `/labels/` beside these.

A server that wants images instead declares `"accepts": "pbm"`, opens the
body with Pillow (`Image.open(io.BytesIO(request.get_data()))`), and hands
it to its driver.

### ESP32 (sketch: untested)

The editor is about 160 kB gzipped, so it fits in an ESP32's flash
(LittleFS). The board serves it, and passes each job to a printer on a
serial port, or, on an ESP32 with Bluetooth Classic, an SPP printer.
USB printers need an ESP32-S3 running as a USB host, with a driver that
writes the job to the printer's bulk OUT endpoint: that part is real work
and isn't shown.

```cpp
#include <WiFi.h>
#include <WebServer.h>
#include <LittleFS.h>

WebServer server(80);

void setup() {
  Serial2.begin(9600);             // the printer's serial port
  LittleFS.begin();                // the editor's files and printer.json, uploaded to flash
  WiFi.begin("ssid", "password");
  server.on("/print", HTTP_POST,
    []() { server.send(200, "text/plain", "Printed"); },
    []() {                         // the job arrives in pieces: pass each one on
      HTTPRaw& raw = server.raw();
      if (raw.status == RAW_WRITE) Serial2.write(raw.buf, raw.currentSize);
    });
  server.serveStatic("/", LittleFS, "/");
  server.begin();
}

void loop() { server.handleClient(); }
```

with `printer.json` in LittleFS:

```json
{ "api": "web-label-print/1", "model": "brother-pt-p710bt", "accepts": "raw" }
```

## Printer and label ids

Use these for `model`, and for `medium` the label's id: the first few are
shown, and all of them are the `Id` fields in
[`catalog/media.rec`](../catalog/media.rec) for that printer's family.
Printers set up through "Other printer" (ZPL, TSPL, ESC/POS) take their
settings from the browser, so they can't be named here yet. The catalogued
ones from `catalog/printers.rec` can.

<!-- model-ids:start: generated by `npm run docs` from src/printers/models.js and catalog/; do not edit by hand -->
| `model` | Printer | Protocol | `medium` ids (catalog/media.rec) |
|---|---|---|---|
| `dymo-lw450` | DYMO LabelWriter 450 / 450 Turbo / 400 | DYMO LabelWriter raster | `cont-54`, `30252`, `99012`, `11354`, `11355`, `30333` … (45) |
| `dymo-lw450tt` | DYMO LabelWriter 450 Twin Turbo | DYMO LabelWriter raster | `cont-54`, `30252`, `99012`, `11354`, `11355`, `30333` … (45) |
| `dymo-lw4xl` | DYMO LabelWriter 4XL | DYMO LabelWriter raster | `cont-54`, `30252`, `99012`, `11354`, `11355`, `30333` … (46) |
| `dymo-lwse450` | DYMO LabelWriter SE450 | DYMO LabelWriter raster (SE450 subset) | `cont-54`, `30252`, `99012`, `11354`, `11355`, `30333` … (45) |
| `brother-pt-p710bt` | Brother PT-P710BT | Brother P-touch raster | `tze-3.5`, `tze-6`, `tze-9`, `tze-12`, `tze-18`, `tze-24` |
| `brother-pt-p700` | Brother PT-P700 | Brother P-touch raster | `tze-3.5`, `tze-6`, `tze-9`, `tze-12`, `tze-18`, `tze-24` |
| `brother-pt-p750w` | Brother PT-P750W | Brother P-touch raster | `tze-3.5`, `tze-6`, `tze-9`, `tze-12`, `tze-18`, `tze-24` |
| `brother-pt-h500` | Brother PT-H500 | Brother P-touch raster | `tze-3.5`, `tze-6`, `tze-9`, `tze-12`, `tze-18`, `tze-24` |
| `brother-pt-e500` | Brother PT-E500 | Brother P-touch raster | `tze-3.5`, `tze-6`, `tze-9`, `tze-12`, `tze-18`, `tze-24` |
| `brother-pt-d600` | Brother PT-D600 | Brother P-touch raster | `tze-3.5`, `tze-6`, `tze-9`, `tze-12`, `tze-18`, `tze-24` |
| `brother-pt-d410` | Brother PT-D410 | Brother P-touch raster | `tze-3.5`, `tze-6`, `tze-9`, `tze-12`, `tze-18` |
| `brother-pt-d460bt` | Brother PT-D460BT | Brother P-touch raster | `tze-3.5`, `tze-6`, `tze-9`, `tze-12`, `tze-18` |
| `brother-pt-d610bt` | Brother PT-D610BT | Brother P-touch raster | `tze-3.5`, `tze-6`, `tze-9`, `tze-12`, `tze-18`, `tze-24` |
| `brother-pt-e310bt` | Brother PT-E310BT | Brother P-touch raster | `tze-3.5`, `tze-6`, `tze-9`, `tze-12`, `tze-18` |
| `brother-pt-e560bt` | Brother PT-E560BT | Brother P-touch raster | `tze-3.5`, `tze-6`, `tze-9`, `tze-12`, `tze-18`, `tze-24` |
| `brother-ql-500` | Brother QL-500 | Brother QL raster | `ql-12`, `ql-29`, `ql-38`, `ql-50`, `ql-54`, `ql-62` … (24) |
| `brother-ql-550` | Brother QL-550 | Brother QL raster | `ql-12`, `ql-29`, `ql-38`, `ql-50`, `ql-54`, `ql-62` … (24) |
| `brother-ql-560` | Brother QL-560 | Brother QL raster | `ql-12`, `ql-29`, `ql-38`, `ql-50`, `ql-54`, `ql-62` … (24) |
| `brother-ql-570` | Brother QL-570 | Brother QL raster | `ql-12`, `ql-29`, `ql-38`, `ql-50`, `ql-54`, `ql-62` … (24) |
| `brother-ql-580n` | Brother QL-580N | Brother QL raster | `ql-12`, `ql-29`, `ql-38`, `ql-50`, `ql-54`, `ql-62` … (24) |
| `brother-ql-650td` | Brother QL-650TD | Brother QL raster | `ql-12`, `ql-29`, `ql-38`, `ql-50`, `ql-54`, `ql-62` … (24) |
| `brother-ql-700` | Brother QL-700 | Brother QL raster | `ql-12`, `ql-29`, `ql-38`, `ql-50`, `ql-54`, `ql-62` … (24) |
| `brother-ql-710w` | Brother QL-710W | Brother QL raster | `ql-12`, `ql-29`, `ql-38`, `ql-50`, `ql-54`, `ql-62` … (24) |
| `brother-ql-720nw` | Brother QL-720NW | Brother QL raster | `ql-12`, `ql-29`, `ql-38`, `ql-50`, `ql-54`, `ql-62` … (24) |
| `brother-ql-800` | Brother QL-800 | Brother QL raster | `ql-12`, `ql-29`, `ql-38`, `ql-50`, `ql-54`, `ql-62` … (24) |
| `brother-ql-810w` | Brother QL-810W | Brother QL raster | `ql-12`, `ql-29`, `ql-38`, `ql-50`, `ql-54`, `ql-62` … (24) |
| `brother-ql-820nwb` | Brother QL-820NWB | Brother QL raster | `ql-12`, `ql-29`, `ql-38`, `ql-50`, `ql-54`, `ql-62` … (24) |
| `brother-ql-1050` | Brother QL-1050 | Brother QL raster | `ql-12`, `ql-29`, `ql-38`, `ql-50`, `ql-54`, `ql-62` … (29) |
| `brother-ql-1060n` | Brother QL-1060N | Brother QL raster | `ql-12`, `ql-29`, `ql-38`, `ql-50`, `ql-54`, `ql-62` … (29) |
| `brother-ql-1100` | Brother QL-1100 | Brother QL raster | `ql-12`, `ql-29`, `ql-38`, `ql-50`, `ql-54`, `ql-62` … (29) |
| `brother-ql-1110nwb` | Brother QL-1110NWB | Brother QL raster | `ql-12`, `ql-29`, `ql-38`, `ql-50`, `ql-54`, `ql-62` … (29) |
| `brother-ql-1115nwb` | Brother QL-1115NWB | Brother QL raster | `ql-12`, `ql-29`, `ql-38`, `ql-50`, `ql-54`, `ql-62` … (29) |
| `zebra-gk420d` | Zebra GK420d / GK420t (ZPL) | ZPL | `custom` |
| `zebra-gc420d` | Zebra GC420d / GC420t (ZPL) | ZPL | `custom` |
| `zebra-gx420d` | Zebra GX420d / GX420t (ZPL) | ZPL | `custom` |
| `zebra-gx430t` | Zebra GX430t (300 dpi) (ZPL) | ZPL | `custom` |
| `zebra-lp2844z` | Zebra LP 2844-Z (ZPL) | ZPL | `custom` |
| `zebra-zd420` | Zebra ZD420 / ZD421 (203 dpi) (ZPL) | ZPL | `custom` |
| `zebra-zd410` | Zebra ZD410 / ZD411 (203 dpi) (ZPL) | ZPL | `custom` |
| `rollo-x1038` | Rollo X1038 (TSPL) | TSPL | `custom` |
| `rollo-wireless` | Rollo Wireless X1040 (by USB) (TSPL) | TSPL | `custom` |
<!-- model-ids:end -->

## Changes

A server or editor that sees a later `api` value it doesn't know treats it
as unknown. Additions within version 1 are new optional fields, which both
sides ignore if they don't understand them.
