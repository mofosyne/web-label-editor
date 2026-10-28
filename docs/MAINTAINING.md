# Maintaining: adding printers and labels

Support grows from reports. The app links to pre-filled GitHub issue forms,
so most additions are a matter of turning an issue into a record or a line
of code, checking it, and regenerating the docs. This page says which route
fits which report, and the checks to run before merging.

| The report or request | Where it goes | Section |
|---|---|---|
| "Other printer" worked (ZPL, TSPL, ESC/POS) | a record in `catalog/printers.rec` | [1](#1-a-printer-set-up-through-other-printer) |
| A listed 🧪 printer printed correctly | `status` in `src/printers/models.js` | [2](#2-an-experimental-printer-printed-correctly) |
| A listed printer was off (position, cut, feed) | depends: see the section | [3](#3-a-listed-printer-was-off) |
| A label or tape size is missing | a record in `catalog/media.rec` | [4](#4-a-label-or-tape-size) |
| A DYMO or Brother model speaking a protocol we have | an entry in `MODELS` | [5](#5-a-model-for-a-protocol-we-already-speak) |
| A printer speaking something new | a new encoder | [6](#6-a-new-protocol) |

Every change ends with the [checks](#checks-before-merging).

## 1. A printer set up through "Other printer"

People with an unlisted printer pick **Other printer (ZPL, TSPL or ESC/POS)**,
describe it (language, resolution, head width, label size), print the Grid
test and adjust it, then click **Generate report → Open a GitHub issue with
these**. The issue (labelled `printer report`) has a **Printer settings**
box with the settings as JSON and a ready record:

```
Id: zebra-gk420d
Name: Zebra GK420d
Brand: Zebra
Language: zpl
Dpi: 203
HeadMm: 104
Rotate: no
DefaultWidthMm: 101.6
DefaultLengthMm: 152.4
Status: experimental
Source: (link to this issue)
```

1. **Read the report.** "Did it print?" should be *Yes*, and the Grid test
   answer or a photo should show it lined up. If it was *Partly*, ask what
   was off before adding it: a record should hold settings that work.
2. **Copy the record** into [`catalog/printers.rec`](../catalog/printers.rec),
   after the last record, with a blank line before it.
   - `Id`: lower case, words joined by `-`. It is saved in people's designs,
     so it must never change or be reused once released.
   - `Name` as printed on the printer; `Brand` is the menu group.
   - `Source`: the issue's URL.
   - `Status`: `tested` when the report says it printed correctly with these
     settings (it did, on that model, with this app); otherwise keep
     `experimental`.
   - `FeedMm` / `AcrossMm` only when the reporter needed a position
     adjustment that will apply to every unit of that model. A small offset
     is more likely their unit: leave it out and say so.
   - Several models of one series that share the settings: one record each,
     or one record named for the series ("Zebra GK420d / GK420t").
3. **Check it:** `recfix catalog/printers.rec`, then the
   [checks](#checks-before-merging). The printer appears in the menu under
   its brand, and in the README's printer table with its protocol.
4. **Reply and close** the issue with the commit, and thank the reporter:
   "Added as its own entry in <commit>; it will show in the printer menu
   once deployed."

A later report against that entry (the report link then says "via its
entry") moves it to `tested`, or corrects a field.

## 2. An experimental printer printed correctly

In [`src/printers/models.js`](../src/printers/models.js), find the model and
set the device's `status` (in `devices`, or the model's own) to `'tested'`,
with a short comment saying what was printed ("Printed and cut on a real
QL-570"). One entry can cover several devices: only the one reported moves.

## 3. A listed printer was off

Ask for the Grid test (the issue form explains it): X runs along the feed
from the end that comes out first, Y across from the top edge, and each
numbered line should be that many mm from its edge.

- **Off by the same amount on every label stock**: a fixed offset for the
  model (for example `skipLeadingMargin` for the LabelWriter, the QL's
  `offsetRightDots` per medium). Change it in code with a test.
- **Off only on one roll**, often third-party labels: that is what per-roll
  calibration is for (Test prints & position → Save as roll…). Point the
  reporter to it.
- **Cut, feed or length wrong**: compare our encoder's output with the
  reference implementation it was ported from (named at the top of each
  file in `src/printers/`) for the same label.

## 4. A label or tape size

Add a record to [`catalog/media.rec`](../catalog/media.rec); the comment at
the top of that file explains each field, and the README section "Adding a
label or tape size" walks through measuring one. `Id`s are saved in designs:
never rename or reuse one. Run `recfix catalog/media.rec`. Label requests
come in labelled `label request`.

## 5. A model for a protocol we already speak

A DYMO LabelWriter, Brother P-touch or Brother QL model not listed yet: add
an entry to `MODELS` in [`src/printers/models.js`](../src/printers/models.js)
with its USB product ID, head width and quirks, taken from the reference
implementation (ptouch-print's device table, brother_ql's `models.py`,
DYMO's PPDs). Model ids are saved in designs: never rename one. New entries
start `experimental`.

## 6. A new protocol

Add an encoder (strip bitmap → bytes) in `src/printers/`, next to the
others:

- Port it from a reference implementation, and say so at the top of the
  file with its licence, as the others do. Keep the SPDX line compatible
  (GPL-3.0-only code stays in its own file; see the README's License
  section) and add the source to [`src/credits.js`](../src/credits.js).
- Write tests that compare its output with the reference's for the same
  input (see `test/brother-ql.test.js` for a step-by-step reference
  pipeline).
- Add the model entries, with a `protocol` name for the printer table.

If the printer speaks ZPL, TSPL or ESC/POS raster, it needs no new encoder:
it can go in `catalog/printers.rec` (section 1), or in `generic.js` if the
language needs a variant.

## Checks before merging

```sh
recfix catalog/media.rec && recfix catalog/printers.rec   # GNU recutils
npm run docs        # regenerates the README's printer table and lists
npm test            # includes "README matches the code"
npm run screenshots # only if the editor's look changed
```

CI runs the same (recfix, the tests, and a browser smoke test that opens
the app and fails on any page error).
