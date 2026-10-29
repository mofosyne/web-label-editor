# Keeping it easy to use

Web Label Editor puts ease of use ahead of features (see the README's
[Philosophy](../README.md#philosophy)). That quality is easy to lose one
reasonable-looking change at a time. This page collects the rules this
project learned the hard way, each with the case that taught it, and ends
with a checklist to run before merging anything a user can see.

Ease of use is fuzzy. When a rule here and your judgement disagree, try the
change on someone who hasn't seen it before, and believe them.

## Principles

### Put things where people look for them

- **Common actions go in the bars above the label** (top bar, toolbar,
  format bar), as in DYMO Label. The side panels hold the less common
  settings.
  - *Learned from:* the Batch button first sat in the item toolbar next to
    Text and QR code. Users looking for "batch" read that row as "things to
    add", so they never saw it. It moved to the top bar, next to Copies.
- **One setting, one place.** If it appears twice, both copies must be the
  same control in effect, with the same name.
  - *Learned from:* label length lived both in the side panel (Fit to
    content / Fixed, plus an end padding box) and in the toolbar. The
    panel copy went.
- **Don't hide a control because it doesn't apply right now.** Show it
  disabled, with its value and a reason. A control that appears and
  disappears can't be found.
  - *Learned from:* the Length box was hidden on die-cut labels. The
    first user to look for it was on a die-cut label and concluded it
    didn't exist.

### Make the next step obvious

- **Don't disable the main action to say "do something first". Do the
  first step for the user.** Browsers show no tooltip on a disabled button,
  so a greyed-out button explains nothing.
  - *Learned from:* Print was disabled until a printer was connected. Now
    Print connects first (the browser asks which printer) and then prints.
- **An option has to be visible, not just typeable.** A suggestion list
  (`<datalist>`) is not a switch: Chrome filters it by what is already in
  the box, so its options vanish.
  - *Learned from:* Auto length existed only as a suggestion in the Length
    box. Users found no way to turn it on until it got its own button.
- **Every feature that starts from empty needs an example.** Offer *Try an
  example*, or a sensible default that shows the feature working.
  - *Learned from:* the Batch panel was confusing until it could load
    example data, put the fields on the label and show six labels.
- **Guess, then let the user correct the guess, visibly.**
  - *Learned from:* CSV may or may not have column names. The app guesses
    (a list of serial numbers has none) and shows a "First row has the
    column names" tick box to override.

### Say it in the user's words

- **Name things as the user sees them, not as the code stores them.**
  - *Learned from:* "Margin at ends / sides" meant along and across the
    tape. Users read "sides" as left and right. The boxes are now *Left &
    right* and *Top & bottom*, mapped to the right axis in portrait.
- **One word per idea, everywhere.** If Auto is the word, it is Auto in
  the size box, the chip, the side panel and the docs.
  - *Learned from:* "Fit text in a fixed box (size is automatic)",
    "Auto" and "Auto size" were the same setting.
- **Tooltips say when to use something, not only what it is.**
  - *Example:* the Length box says Auto saves tape when the text varies,
    and a set length is for labels that must match.
- **Warnings name the thing and say what will happen,** in increasing
  severity:
  - plain (inside your own margins: your choice);
  - amber (past the safe area: may be trimmed);
  - red (past the printer's reach: will be cut off).

  Don't warn about a user's deliberate choice as if it were an error.

### Automatic behaviour must never fight the user

- **The user's last action wins.** Doing by hand what an automatic mode
  does switches that mode off, visibly.
  - *Example:* dragging the corner of an Auto-size QR code turns Auto size
    off.
- **No snapping back, no pulling to the centre.** If something moves on
  its own after the user let go, it feels broken.
  - *Learned from:* Auto length first mirrored the space before the content
    to the end. Dragging text right then grew the label at both ends, and
    dragging it left pushed it off the label.
  - *Learned from:* an Auto-size version that kept items centred stopped
    them from being moved at all.
  - *What it does now:* the label ends one margin after the last item, the
    start margin is a wall, and the rest is where the user put it.
- **Nothing moves under the pointer.** Automatic layout waits until the
  drag ends.
- **Anything that adjusts itself must settle.** Measure, adjust within a
  tolerance, and stop.
  - *Learned from:* QR codes snap to whole dots per module, so "scale until
    it fits" flipped between two sizes forever and the page never stopped
    redrawing.
  - *Fix:* use the size the code will snap to, and add tolerance (shrink
    when too big, grow only when clearly short).

### Show what will happen

- **The preview is what prints.** It uses the same code as printing; the
  actual-size panel leaves off anything the printer won't print.
- **Show the physical thing:** backing paper, label colour, clear labels,
  the roll's next label, which end comes out first. Only show what is
  true, and mark what is preview-only. (Colours are preview-only: the
  printer prints the ink the roll has.)

### Never lose work, never trap the user

- Every change is undoable, and the current design survives a reload.
- Dialogs close with Escape and ×. Replacing something the user typed asks
  first.
- No migration traps: the project doesn't promise old designs load
  forever. But don't silently lose a user's current work in an update.

### Room for the label

- The label is the point. The side panels fold away (« ») for small
  screens, and the choice is remembered.
- Toolbar controls wrap as groups (zoom stays together; Length, Auto, box
  and mm stay together), never one button at a time.

## Before merging a change a user can see

Run the app (`npm run serve`) and go through this list. Tick what applies;
"n/a" is a fine answer.

**Finding it**
- [ ] Is the new control where someone doing this task would look first?
      Would they recognise it there?
- [ ] Is it the only place for this setting? If not, are both places the
      same control with the same name?
- [ ] Is it visible even when it doesn't apply (disabled, with a reason),
      rather than hidden?

**Using it**
- [ ] Can a first-time user do it with no instructions, or does it come
      with an example or a good default?
- [ ] If an option needs choosing, is it a visible button, list or tick
      box, not only something you can type?
- [ ] If an action needs a prerequisite (connecting, data, a selection),
      does the action do or explain that step, instead of being disabled?

**Words**
- [ ] Are the labels in the user's words, as they see the screen (left,
      right, top, bottom; label, tape, roll)?
- [ ] Is each idea named the same way everywhere: UI, tooltips, README,
      in-app Tips?
- [ ] Does any warning name the item and say what will happen?
- [ ] Does it sound like a warning only when it is a problem?

**Automatic behaviour**
- [ ] Does any automatic behaviour leave alone what the user just placed,
      sized or typed?
- [ ] Does doing it by hand switch the automatic mode off?
- [ ] Does nothing move during a drag?
- [ ] Does anything that adjusts itself settle? (Watch the page for a few
      seconds: no flicker, no creeping values.)

**Fit**
- [ ] Checked at 1440 px, 1024 px and phone width, with the side panels
      open and folded?
- [ ] Nothing overlaps; toolbar groups wrap whole?
- [ ] Does it work on a die-cut label, a continuous roll and P-touch tape,
      in landscape and portrait?

**Safety**
- [ ] Undo reverses it, and a reload keeps it.
- [ ] No error in the browser console.

**Docs**
- [ ] README features list, the in-app Tips (`src/about.js`) and the
      screenshots (`npm run screenshots`) updated if the look or wording
      changed.

When something here turned out to be wrong, or a new lesson comes up, add
it to this page with the case that taught it.
