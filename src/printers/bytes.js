// Small helper for building printer command streams.
export class ByteWriter {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  push(...bytes) {
    this.add(Uint8Array.from(bytes));
  }

  add(arr) {
    this.chunks.push(arr);
    this.length += arr.length;
  }

  fill(value, count) {
    this.add(new Uint8Array(count).fill(value));
  }

  toUint8Array() {
    const out = new Uint8Array(this.length);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}

// TIFF PackBits, as used by Brother raster commands.
export function packBits(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    let run = 1;
    while (i + run < src.length && run < 128 && src[i + run] === src[i]) run++;
    if (run >= 2) {
      out.push((257 - run) & 0xff, src[i]);
      i += run;
      continue;
    }
    // Literal: extend until a run of 2+ starts or 128 bytes reached.
    const start = i;
    i++;
    while (i < src.length && i - start < 128 && !(i + 1 < src.length && src[i] === src[i + 1])) i++;
    out.push(i - start - 1, ...src.subarray(start, i));
  }
  return Uint8Array.from(out);
}

export function unpackBits(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const n = src[i++];
    if (n < 128) {
      for (let k = 0; k <= n; k++) out.push(src[i++]);
    } else if (n > 128) {
      const v = src[i++];
      for (let k = 0; k < 257 - n; k++) out.push(v);
    }
  }
  return Uint8Array.from(out);
}
