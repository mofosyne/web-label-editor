// Linear barcode encoders. Each returns { modules, text, quietLeft, quietRight }
// where modules is an array of booleans (true = bar), one per narrow module.

// Code 128 symbol patterns: bar/space widths, starting with a bar.
const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
export const CODE128_PATTERNS = CODE128;

const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

function widthsToModules(widths, out) {
  let bar = true;
  for (const w of widths) {
    for (let i = 0; i < Number(w); i++) out.push(bar);
    bar = !bar;
  }
}

// Picks code set B for text and C for long digit runs (two digits per symbol).
export function code128Values(text) {
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c < 32 || c > 126) throw new Error('Code 128 here supports printable ASCII only');
  }
  if (!text.length) throw new Error('Nothing to encode');

  const digitRun = (i) => {
    let j = i;
    while (j < text.length && text[j] >= '0' && text[j] <= '9') j++;
    return j - i;
  };

  const values = [];
  let set = null;
  let i = 0;
  while (i < text.length) {
    const run = digitRun(i);
    const atStart = i === 0;
    const atEnd = i + run === text.length;
    const worthC = run >= (atStart && atEnd ? 2 : atStart || atEnd ? 4 : 6);
    if (worthC) {
      // Odd run: the leftover digit is encoded in set B, before the C block at
      // the start of the symbol and after it everywhere else.
      let n = run - (run % 2);
      if (run % 2 && atStart && !atEnd) n = run - 1;
      if (run % 2 && atStart && atEnd) {
        if (set === null) { values.push(START_B); set = 'B'; }
        values.push(text.charCodeAt(i) - 32);
        i++;
      }
      if (set === null) values.push(START_C);
      else if (set !== 'C') values.push(CODE_C);
      set = 'C';
      for (let k = 0; k < n; k += 2) values.push(Number(text.slice(i + k, i + k + 2)));
      i += n;
    } else {
      if (set === null) values.push(START_B);
      else if (set !== 'B') values.push(CODE_B);
      set = 'B';
      const end = run ? i + run : i + 1;
      for (; i < end; i++) values.push(text.charCodeAt(i) - 32);
    }
  }

  const checksum = values.reduce((sum, v, idx) => sum + v * (idx || 1), 0) % 103;
  values.push(checksum, STOP);
  return values;
}

export function encodeCode128(text) {
  const modules = [];
  for (const v of code128Values(text)) widthsToModules(CODE128[v], modules);
  return { modules, text, quietLeft: 10, quietRight: 10 };
}

// ---- EAN-13 / UPC-A ----

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = EAN_L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''));
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function eanCheckDigit(digits12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits12[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

export function encodeEan13(input) {
  let digits = String(input).replace(/\s/g, '');
  if (!/^\d{12,13}$/.test(digits)) throw new Error('EAN-13 needs 12 digits (13 with check digit)');
  const check = eanCheckDigit(digits);
  if (digits.length === 13 && Number(digits[12]) !== check) {
    throw new Error(`Wrong check digit: expected ${check}`);
  }
  digits = digits.slice(0, 12) + check;

  let bits = '101';
  const parity = EAN_PARITY[Number(digits[0])];
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[Number(digits[i])];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += EAN_R[Number(digits[i])];
  bits += '101';
  return { modules: [...bits].map((b) => b === '1'), text: digits, quietLeft: 11, quietRight: 7 };
}

export function encodeUpcA(input) {
  const digits = String(input).replace(/\s/g, '');
  if (!/^\d{11,12}$/.test(digits)) throw new Error('UPC-A needs 11 digits (12 with check digit)');
  const r = encodeEan13(`0${digits}`);
  return { ...r, text: r.text.slice(1), quietLeft: 9, quietRight: 9 };
}

export const SYMBOLOGIES = {
  code128: { name: 'Code 128', encode: encodeCode128 },
  ean13: { name: 'EAN-13', encode: encodeEan13 },
  upca: { name: 'UPC-A', encode: encodeUpcA },
};
