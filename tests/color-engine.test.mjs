/**
 * Tests of the colour engine.
 *
 * The CIEDE2000 references are not chosen by us: they are the supplementary test data
 * published with the formula, available in plain text at
 *   https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt
 * (page: https://www.ece.rochester.edu/~gsharma/ciede2000/)
 * Source: G. Sharma, W. Wu, E. N. Dalal, "The CIEDE2000 Color-Difference Formula:
 * Implementation Notes, Supplementary Test Data, and Mathematical Observations",
 * Color Research and Application, vol. 30, no. 1, pp. 21-30, February 2005.
 *
 * Each row below is: L1 a1 b1, L2 a2 b2, expected delta E 00.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deltaE2000,
  deltaE2000Hex,
  hexToLab,
  hexToRgb,
  isValidHex,
  normaliseHex,
  rgbToHex,
  rgbToLab,
  InvalidColourError
} from '../modules/color_engine/color-space.js';
import {
  DISTANCE_BANDS,
  compareColours,
  createColour,
  describeDistance,
  describeMeasurement
} from '../modules/color_engine/color-engine.js';

const SHARMA_TEST_PAIRS = [
  [[50.0, 2.6772, -79.7751], [50.0, 0.0, -82.7485], 2.0425],
  [[50.0, 3.1571, -77.2803], [50.0, 0.0, -82.7485], 2.8615],
  [[50.0, 2.8361, -74.02], [50.0, 0.0, -82.7485], 3.4412],
  [[50.0, -1.3802, -84.2814], [50.0, 0.0, -82.7485], 1.0],
  [[50.0, -1.1848, -84.8006], [50.0, 0.0, -82.7485], 1.0],
  [[50.0, -0.9009, -85.5211], [50.0, 0.0, -82.7485], 1.0],
  [[50.0, 0.0, 0.0], [50.0, -1.0, 2.0], 2.3669],
  [[50.0, -1.0, 2.0], [50.0, 0.0, 0.0], 2.3669],
  [[50.0, 2.49, -0.001], [50.0, -2.49, 0.0009], 7.1792],
  [[50.0, 2.49, -0.001], [50.0, -2.49, 0.001], 7.1792],
  [[50.0, 2.49, -0.001], [50.0, -2.49, 0.0011], 7.2195],
  [[50.0, 2.49, -0.001], [50.0, -2.49, 0.0012], 7.2195],
  [[50.0, -0.001, 2.49], [50.0, 0.0009, -2.49], 4.8045],
  [[50.0, -0.001, 2.49], [50.0, 0.001, -2.49], 4.8045],
  [[50.0, -0.001, 2.49], [50.0, 0.0011, -2.49], 4.7461],
  [[50.0, 2.5, 0.0], [50.0, 0.0, -2.5], 4.3065],
  [[50.0, 2.5, 0.0], [73.0, 25.0, -18.0], 27.1492],
  [[50.0, 2.5, 0.0], [61.0, -5.0, 29.0], 22.8977],
  [[50.0, 2.5, 0.0], [56.0, -27.0, -3.0], 31.903],
  [[50.0, 2.5, 0.0], [58.0, 24.0, 15.0], 19.4535],
  [[50.0, 2.5, 0.0], [50.0, 3.1736, 0.5854], 1.0],
  [[50.0, 2.5, 0.0], [50.0, 3.2972, 0.0], 1.0],
  [[50.0, 2.5, 0.0], [50.0, 1.8634, 0.5757], 1.0],
  [[50.0, 2.5, 0.0], [50.0, 3.2592, 0.335], 1.0],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
  [[61.2901, 3.7196, -5.3901], [61.4292, 2.248, -4.962], 1.8731],
  [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
  [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
  [[36.4612, 47.858, 18.3852], [36.2715, 50.5065, 21.2231], 1.4146],
  [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
  [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
  [[6.7747, -0.2908, -2.4247], [5.8714, -0.0985, -2.2286], 0.6377],
  [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082]
];

const lab = ([l, a, b]) => ({ l, a, b });

test('CIEDE2000 reproduces all 34 published reference pairs', () => {
  assert.equal(SHARMA_TEST_PAIRS.length, 34);
  for (const [index, [reference, sample, expected]] of SHARMA_TEST_PAIRS.entries()) {
    const actual = deltaE2000(lab(reference), lab(sample));
    assert.ok(
      Math.abs(actual - expected) < 1e-4,
      `pair ${index + 1}: expected ${expected}, got ${actual.toFixed(6)}`
    );
  }
});

test('CIEDE2000 is symmetric and returns 0 for equal colours', () => {
  for (const [reference, sample] of SHARMA_TEST_PAIRS) {
    const forward = deltaE2000(lab(reference), lab(sample));
    const backward = deltaE2000(lab(sample), lab(reference));
    assert.ok(Math.abs(forward - backward) < 1e-12, 'the formula must be symmetric');
  }
  assert.equal(deltaE2000({ l: 42, a: -3, b: 7 }, { l: 42, a: -3, b: 7 }), 0);
});

test('CIEDE2000 between white and black is the full lightness range', () => {
  assert.ok(Math.abs(deltaE2000({ l: 100, a: 0, b: 0 }, { l: 0, a: 0, b: 0 }) - 100) < 1e-9);
});

test('sRGB to CIELAB matches the D65 reference values', () => {
  // Tolerance 1e-4: the published sRGB matrix is rounded, so its Y row sums to 1.0000001
  // and white lands at L* = 100.0000039 instead of exactly 100. The error is inherent to
  // the published constants, not to the conversion formula.
  const white = hexToLab('#FFFFFF');
  assert.ok(Math.abs(white.l - 100) < 1e-4, `L* was ${white.l}`);
  assert.ok(Math.abs(white.a) < 1e-4, `a* was ${white.a}`);
  assert.ok(Math.abs(white.b) < 1e-4, `b* was ${white.b}`);

  const black = hexToLab('#000000');
  assert.deepEqual(black, { l: 0, a: 0, b: 0 });

  // sRGB red in CIELAB (D65, 2 degree): L* = 53.24, a* = 80.09, b* = 67.20
  const red = hexToLab('#FF0000');
  assert.ok(Math.abs(red.l - 53.24) < 0.05, `L* was ${red.l}`);
  assert.ok(Math.abs(red.a - 80.09) < 0.05, `a* was ${red.a}`);
  assert.ok(Math.abs(red.b - 67.2) < 0.05, `b* was ${red.b}`);

  // The b* axis separates blue (negative) from yellow (positive).
  assert.ok(hexToLab('#0000FF').b < 0);
  assert.ok(hexToLab('#FFFF00').b > 0);
});

test('HEX parsing accepts #RGB and #RRGGBB and rejects everything else', () => {
  assert.equal(normaliseHex('#00f'), '#0000FF');
  assert.equal(normaliseHex('00f'), '#0000FF');
  assert.equal(normaliseHex('#00ff00'), '#00FF00');
  assert.deepEqual(hexToRgb('#0000FF'), { r: 0, g: 0, b: 255 });
  assert.equal(rgbToHex({ r: 0, g: 255, b: 0 }), '#00FF00');

  for (const invalid of ['', '#GGGGGG', '#12345', 'rgb(0,0,0)', 'blue', '#1234567', null, 42, {}]) {
    assert.equal(isValidHex(invalid), false, `${JSON.stringify(invalid)} must be rejected`);
    assert.throws(() => normaliseHex(invalid), InvalidColourError);
  }
  assert.throws(() => rgbToHex({ r: -1, g: 0, b: 0 }), InvalidColourError);
  assert.throws(() => rgbToHex({ r: 300, g: 0, b: 0 }), InvalidColourError);
});

test('createColour returns HEX, RGB and CIELAB in a stable shape', () => {
  const colour = createColour('#00f', 'blue');
  assert.equal(colour.hex, '#0000FF');
  assert.deepEqual(colour.rgb, { r: 0, g: 0, b: 255 });
  assert.deepEqual(colour.lab, rgbToLab(colour.rgb));
  assert.equal(colour.name, 'blue');
  assert.throws(() => createColour('nope'), InvalidColourError);
});

test('identical colours have distance exactly 0 and the "identical" band', () => {
  const result = compareColours({ hex: '#008000' }, { hex: '#008000' });
  assert.equal(result.deltaE, 0);
  assert.equal(result.band.id, 'identical');
  assert.ok(Math.abs(deltaE2000Hex('#008000', '#008000')) === 0);
});

test('different colours have a positive distance and stay symmetric', () => {
  const result = compareColours({ hex: '#008000' }, { hex: '#800080' });
  assert.ok(result.deltaE > 0, 'green and purple must not be equal');
  const reversed = compareColours({ hex: '#800080' }, { hex: '#008000' });
  assert.ok(Math.abs(result.deltaE - reversed.deltaE) < 1e-12);
});

test('distance bands are ordered, cover every value and describe the result', () => {
  const limits = DISTANCE_BANDS.map((band) => band.max);
  assert.deepEqual(limits, [...limits].sort((a, b) => a - b));
  assert.equal(describeDistance(0).id, 'identical');
  assert.equal(describeDistance(0.5).id, 'imperceptible');
  assert.equal(describeDistance(1).id, 'imperceptible');
  assert.equal(describeDistance(1.5).id, 'barely-perceptible');
  assert.equal(describeDistance(5).id, 'perceptible');
  assert.equal(describeDistance(30).id, 'clearly-different');
  assert.equal(describeDistance(100).id, 'very-different');
  assert.throws(() => describeDistance(-1), RangeError);
  assert.throws(() => describeDistance(Number.NaN), RangeError);

  const sentence = describeMeasurement(4.3065);
  assert.match(sentence, /4\.31/);
  assert.match(sentence, /clearly perceptible/);
});
