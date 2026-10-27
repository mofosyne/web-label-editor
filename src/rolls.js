// "My rolls": named label rolls with their own calibration, for label stock
// that doesn't sit like the catalogue's genuine labels (e.g. third-party
// rolls). Each roll has a short ID to write on the roll, and a calibration
// code that carries everything needed to set the roll up on another
// computer:
//
//   K7QX/30252/F5.0/A-0.5
//   ID   label  Feed  Across (mm)
//
// '/' separates fields because catalogue Ids may contain '-'.

// Crockford base32: no I, L, O or U, so IDs are easy to read off a roll.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newRollId(taken = [], random = Math.random) {
  for (;;) {
    let id = '';
    for (let i = 0; i < 4; i++) id += ALPHABET[Math.floor(random() * ALPHABET.length)];
    if (!taken.includes(id)) return id;
  }
}

const mm = (v) => (Math.round(v * 10) / 10).toFixed(1);

export function rollCode(roll) {
  return `${roll.id}/${roll.medium}/F${mm(roll.feedMm)}/A${mm(roll.acrossMm)}`;
}

// Reads a calibration code; forgiving about case, spaces and the letters
// people confuse with digits. Returns { id, medium, feedMm, acrossMm }.
export function parseRollCode(code, mediumIds) {
  const parts = String(code).trim().split(/\s*\/\s*/);
  if (parts.length !== 4) throw new Error('A calibration code looks like K7QX/30252/F5.0/A0.0');
  const id = parts[0].toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0');
  if (!/^[0-9A-HJKMNP-TV-Z]{4}$/.test(id)) throw new Error(`"${parts[0]}" is not a roll ID (4 letters or digits)`);
  const medium = mediumIds.find((m) => m.toLowerCase() === parts[1].toLowerCase());
  if (!medium) throw new Error(`Unknown label type "${parts[1]}"`);
  const num = (part, letter) => {
    const m = new RegExp(`^${letter}([+-]?\\d+(?:\\.\\d+)?)$`, 'i').exec(part);
    if (!m) throw new Error(`Expected ${letter} followed by millimetres, got "${part}"`);
    return Number(m[1]);
  };
  return { id, medium, feedMm: num(parts[2], 'F'), acrossMm: num(parts[3], 'A') };
}
