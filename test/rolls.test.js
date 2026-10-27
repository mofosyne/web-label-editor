import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRollId, rollCode, parseRollCode } from '../src/rolls.js';

const MEDIA = ['cont-54', '30252', '99012', 'tze-12'];

test('roll IDs are 4 unambiguous characters and avoid taken ones', () => {
  for (let i = 0; i < 200; i++) assert.match(newRollId(), /^[0-9A-HJKMNP-TV-Z]{4}$/);
  let n = 0;
  const seq = () => [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5][n++ % 8];
  assert.equal(newRollId(['0000'], seq), 'GGGG');
});

test('calibration codes round-trip', () => {
  const roll = { id: 'K7QX', medium: '30252', feedMm: 5, acrossMm: -0.46 };
  const code = rollCode(roll);
  assert.equal(code, 'K7QX/30252/F5.0/A-0.5');
  assert.deepEqual(parseRollCode(code, MEDIA), { id: 'K7QX', medium: '30252', feedMm: 5, acrossMm: -0.5 });
  assert.equal(rollCode({ id: 'AB12', medium: 'cont-54', feedMm: 0, acrossMm: 0 }), 'AB12/cont-54/F0.0/A0.0');
});

test('calibration codes are forgiving about how they were copied off a roll', () => {
  assert.deepEqual(parseRollCode(' k7qx / 30252 / f+5 / a0.0 ', MEDIA), { id: 'K7QX', medium: '30252', feedMm: 5, acrossMm: 0 });
  assert.equal(parseRollCode('LO1I/TZE-12/F1/A0', MEDIA).id, '1011');
  assert.equal(parseRollCode('LO1I/TZE-12/F1/A0', MEDIA).medium, 'tze-12');
});

test('bad calibration codes explain what is wrong', () => {
  assert.throws(() => parseRollCode('K7QX-30252', MEDIA), /looks like/);
  assert.throws(() => parseRollCode('K7/30252/F1/A0', MEDIA), /not a roll ID/);
  assert.throws(() => parseRollCode('K7QX/99999/F1/A0', MEDIA), /Unknown label type/);
  assert.throws(() => parseRollCode('K7QX/30252/5/A0', MEDIA), /Expected F/);
});
