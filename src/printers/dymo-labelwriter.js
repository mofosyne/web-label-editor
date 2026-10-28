// SPDX-License-Identifier: GPL-3.0-or-later
// DYMO LabelWriter 400/450 raster protocol.
// Command set follows DYMO's LabelWriter technical reference and the
// official dymo-cups-drivers (src/lw/LabelWriterDriver.cpp), ported from
// that driver: DYMO LabelWriter Drivers, Copyright (C) 2008 Sanford L.P.,
// GPL-2.0-or-later (https://github.com/matthiasbock/dymo-cups-drivers).
// Modified: re-implemented in JavaScript for web-label-editor, 2026-10 (see git log for later changes).
//
// The bitmap passed in is a "strip": width = length along the feed,
// height = dots across the print head. Each strip column becomes one raster
// line. Head dot 0 (MSB of the first byte) gets the bottom row of the strip,
// which makes the printed label read like the on-screen strip.
import { ByteWriter } from './bytes.js';

const ESC = 0x1b;
const SYN = 0x16;

const DENSITY = { light: 0x63, medium: 0x64, normal: 0x65, dark: 0x67 };

export function encodeLabelWriter(bitmap, opts = {}) {
  const headDots = opts.headDots ?? 672;
  const continuous = opts.continuous ?? true;
  const density = DENSITY[opts.density ?? 'normal'];
  const offset = opts.offsetDots ?? 0;
  // The LabelWriter SE450 takes the 450's raster commands except ESC G (and
  // ESC q); its ESC h sets print speed rather than text quality, so it gets
  // neither (DYMO's LabelWriter SE450 Technical Reference).
  const se450 = !!opts.se450;

  const across = Math.min(bitmap.height + offset, headDots);
  const bytesPerLine = Math.ceil(across / 8);

  const w = new ByteWriter();
  // Resync: enough ESC bytes to flush any half-received command.
  w.fill(ESC, 156);
  w.push(ESC, 0x51, 0, 0); // ESC Q: line tab 0
  w.push(ESC, 0x42, 0); // ESC B: dot tab 0
  if (!se450) w.push(ESC, 0x68); // ESC h: text quality, 300x300
  w.push(ESC, density); // ESC c/d/e/g: print density
  // ESC q: roll select on the Twin Turbo ('0' auto, '1' left, '2' right).
  if (opts.roll) w.push(ESC, 0x71, { auto: 0x30, left: 0x31, right: 0x32 }[opts.roll] ?? 0x30);

  const labelLength = continuous ? 0xffff : bitmap.width;
  w.push(ESC, 0x4c, (labelLength >> 8) & 0xff, labelLength & 0xff); // ESC L
  w.push(ESC, 0x44, bytesPerLine); // ESC D: bytes per line

  const { width, height, data } = bitmap;
  for (let x = 0; x < width; x++) {
    const line = new Uint8Array(bytesPerLine + 1);
    line[0] = SYN;
    for (let y = 0; y < height; y++) {
      if (!data[y * width + x]) continue;
      const dot = offset + (height - 1 - y);
      if (dot >= across) continue;
      line[1 + (dot >> 3)] |= 0x80 >> (dot & 7);
    }
    w.add(line);
  }

  if (!se450) w.push(ESC, 0x47); // ESC G: short form feed (end of label)
  w.push(ESC, 0x45); // ESC E: form feed to tear-off position
  return w.toUint8Array();
}
