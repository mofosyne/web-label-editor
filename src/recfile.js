// Minimal reader for GNU recutils files (https://www.gnu.org/software/recutils/).
//
// Supports what the catalogue uses: '#' comments, blank-line separated
// records, "Name: value" fields, '+' continuation lines (a newline in the
// value), trailing-backslash line joins, and '%rec' descriptors that set the
// type of the records that follow. Other '%' descriptor fields are kept on
// the descriptor but not enforced here; `recfix` does that in CI.
//
// Returns [{ type, fields: [[name, value], ...] }] in file order, without
// the descriptor records.

const FIELD = /^([a-zA-Z%][a-zA-Z0-9_]*):(.*)$/;

export function parseRec(text) {
  const records = [];
  const descriptors = {};
  let type = null;
  let current = null;

  const finish = () => {
    if (!current) return;
    const rec = current.fields.find(([n]) => n === '%rec');
    if (rec) {
      type = rec[1].trim().split(/\s+/)[0];
      descriptors[type] = current;
    } else {
      records.push({ type, fields: current.fields });
    }
    current = null;
  };

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // A trailing backslash joins the next physical line.
    while (line.endsWith('\\') && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i];

    if (line.startsWith('#')) continue;
    if (line.trim() === '') {
      finish();
      continue;
    }
    if (line.startsWith('+')) {
      if (!current?.fields.length) throw new Error(`Line ${i + 1}: continuation without a field`);
      const last = current.fields[current.fields.length - 1];
      last[1] += `\n${line.slice(1).replace(/^ /, '')}`;
      continue;
    }
    const m = FIELD.exec(line);
    if (!m) throw new Error(`Line ${i + 1}: expected "Name: value", got "${line}"`);
    current ??= { fields: [] };
    current.fields.push([m[1], m[2].replace(/^[ \t]/, '')]);
  }
  finish();
  return { records, descriptors };
}

// First value of a field, or undefined.
export function field(record, name) {
  return record.fields.find(([n]) => n === name)?.[1];
}

// Renders records the way `recsel` prints them (used to cross-check this
// parser against recutils in the tests).
export function formatRecords(records) {
  return records.map((r) => r.fields
    .map(([n, v]) => `${n}: ${v.split('\n').join('\n+ ')}`)
    .join('\n')).join('\n\n');
}
