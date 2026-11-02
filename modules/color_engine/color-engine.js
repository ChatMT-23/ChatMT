/**
 * Colour description and comparison.
 *
 * This module turns a HEX string into a structured representation and produces the
 * *measurement* part of an answer: how far apart two colours are, described in words.
 * It does not decide what is true, allowed, or liked: that belongs to the reflection and
 * response engines, which receive the numbers produced here.
 */

import { hexToRgb, hexToLab, rgbToHex, isValidHex, normaliseHex, InvalidColourError, deltaE2000 } from './color-space.js';

export { InvalidColourError };

/**
 * Description bands for a CIEDE2000 distance.
 *
 * These bands are a **project convention**, not a measurement: they are chosen by this
 * project to turn one number into a sentence. The only anchor taken from the literature is
 * that a CIEDE2000 difference of about 1.0 is commonly quoted as the just-noticeable
 * difference for adjacent patches under reference viewing conditions. The bands are
 * declared here, in one place, so they can be reviewed and changed without touching the code.
 */
export const DISTANCE_BANDS = Object.freeze([
  { max: 0, id: 'identical', label: 'the same colour' },
  { max: 1, id: 'imperceptible', label: 'practically indistinguishable' },
  { max: 2, id: 'barely-perceptible', label: 'barely perceptible' },
  { max: 10, id: 'perceptible', label: 'clearly perceptible' },
  { max: 50, id: 'clearly-different', label: 'clearly different' },
  { max: Number.POSITIVE_INFINITY, id: 'very-different', label: 'very different' }
]);

/**
 * @param {number} deltaE a CIEDE2000 distance
 * @returns {{id: string, label: string, max: number}}
 */
export function describeDistance(deltaE) {
  if (!Number.isFinite(deltaE) || deltaE < 0) {
    throw new RangeError(`Not a valid colour distance: ${deltaE}`);
  }
  return DISTANCE_BANDS.find((band) => deltaE <= band.max);
}

/**
 * Structured representation of one colour.
 *
 * @param {string} hex any accepted HEX form, e.g. "#00f" or "#0000FF"
 * @param {string|null} [name] the palette name, when the colour came from the palette
 * @returns {{hex: string, rgb: {r: number, g: number, b: number}, lab: {l: number, a: number, b: number}, name: string|null}}
 */
export function createColour(hex, name = null) {
  if (!isValidHex(hex)) throw new InvalidColourError(hex);
  const normalised = normaliseHex(hex);
  return {
    hex: normalised,
    rgb: hexToRgb(normalised),
    lab: hexToLab(normalised),
    name: name ?? null
  };
}

/**
 * Measurement of a single colour pair. Contains no judgement about preference.
 *
 * @param {{hex: string}} colourA
 * @param {{hex: string}} colourB
 * @returns {{deltaE: number, band: {id: string, label: string}, hexA: string, hexB: string}}
 */
export function compareColours(colourA, colourB) {
  const labA = hexToLab(normaliseHex(colourA.hex));
  const labB = hexToLab(normaliseHex(colourB.hex));
  const deltaE = deltaE2000(labA, labB);
  return {
    deltaE,
    band: describeDistance(deltaE),
    hexA: normaliseHex(colourA.hex),
    hexB: normaliseHex(colourB.hex)
  };
}

/**
 * One-sentence, human-readable description of a distance. Still a measurement only.
 *
 * @param {number} deltaE
 * @returns {string}
 */
export function describeMeasurement(deltaE) {
  const band = describeDistance(deltaE);
  const rounded = Math.round(deltaE * 100) / 100;
  return `The perceptual distance between the two colours is ${rounded} (CIEDE2000), which is ${band.label}.`;
}

/** @param {{r: number, g: number, b: number}} rgb */
export function rgbToCss({ r, g, b }) {
  return `rgb(${r}, ${g}, ${b})`;
}

export { rgbToHex };
