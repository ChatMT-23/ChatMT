/**
 * Colour space conversions and the CIEDE2000 colour-difference formula.
 *
 * Everything in this file is pure arithmetic: no DOM, no storage, no network. That is what
 * makes it testable from Node.js (see tests/color-engine.test.mjs).
 *
 * Pipeline used by ChatMT:
 *   HEX  ->  sRGB (0..255)  ->  linear RGB  ->  CIEXYZ (D65)  ->  CIELAB (D65, 2 degree)
 *   distance between two CIELAB colours  ->  CIEDE2000
 *
 * References:
 * - sRGB transfer function and D65 matrix: IEC 61966-2-1 / CSS Color Module Level 4.
 * - CIELAB: CIE 1976 L*a*b*, with the D65 white point used by sRGB.
 * - CIEDE2000: G. Sharma, W. Wu, E. N. Dalal, "The CIEDE2000 Color-Difference Formula:
 *   Implementation Notes, Supplementary Test Data, and Mathematical Observations",
 *   Color Research and Application, vol. 30, no. 1, pp. 21-30, February 2005.
 */

/** D65 white point, 2 degree observer, normalised to Y = 1. */
export const D65 = Object.freeze({ x: 0.95047, y: 1.0, z: 1.08883 });

const HEX_PATTERN = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Error thrown when a value cannot be interpreted as a colour. */
export class InvalidColourError extends Error {
  constructor(value) {
    super(`Not a valid colour: ${JSON.stringify(value)}. Expected #RGB or #RRGGBB.`);
    this.name = 'InvalidColourError';
    this.value = value;
  }
}

/**
 * @param {unknown} value
 * @returns {boolean} true when `value` is a HEX string accepted by this module
 */
export function isValidHex(value) {
  return typeof value === 'string' && HEX_PATTERN.test(value.trim());
}

/**
 * Expands #RGB to #RRGGBB and upper-cases the result.
 * @param {string} hex
 * @returns {string}
 */
export function normaliseHex(hex) {
  if (!isValidHex(hex)) throw new InvalidColourError(hex);
  const digits = hex.trim().replace('#', '').toUpperCase();
  if (digits.length === 3) {
    return `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`;
  }
  return `#${digits}`;
}

/**
 * @param {string} hex
 * @returns {{r: number, g: number, b: number}} channels in 0..255
 */
export function hexToRgb(hex) {
  const normalised = normaliseHex(hex);
  return {
    r: Number.parseInt(normalised.slice(1, 3), 16),
    g: Number.parseInt(normalised.slice(3, 5), 16),
    b: Number.parseInt(normalised.slice(5, 7), 16)
  };
}

/**
 * @param {{r: number, g: number, b: number}} rgb channels in 0..255
 * @returns {string} #RRGGBB
 */
export function rgbToHex(rgb) {
  const channel = (value) => {
    const n = Math.round(value);
    if (!Number.isFinite(n) || n < 0 || n > 255) {
      throw new InvalidColourError(String(value));
    }
    return n.toString(16).padStart(2, '0').toUpperCase();
  };
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

/** sRGB channel (0..1) -> linear-light channel (0..1). */
export function srgbToLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * @param {{r: number, g: number, b: number}} rgb channels in 0..255
 * @returns {{x: number, y: number, z: number}} CIEXYZ, D65
 */
export function rgbToXyz(rgb) {
  const r = srgbToLinear(rgb.r / 255);
  const g = srgbToLinear(rgb.g / 255);
  const b = srgbToLinear(rgb.b / 255);
  return {
    x: 0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    y: 0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    z: 0.0193339 * r + 0.119192 * g + 0.9503041 * b
  };
}

/** CIE standard helper, with the linear segment below the (6/29)^3 threshold. */
function labHelper(value) {
  const threshold = (6 / 29) ** 3;
  return value > threshold ? Math.cbrt(value) : value / (3 * (6 / 29) ** 2) + 4 / 29;
}

/**
 * @param {{x: number, y: number, z: number}} xyz
 * @returns {{l: number, a: number, b: number}} CIELAB
 */
export function xyzToLab(xyz) {
  const fx = labHelper(xyz.x / D65.x);
  const fy = labHelper(xyz.y / D65.y);
  const fz = labHelper(xyz.z / D65.z);
  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz)
  };
}

/**
 * @param {{r: number, g: number, b: number}} rgb channels in 0..255
 * @returns {{l: number, a: number, b: number}} CIELAB
 */
export function rgbToLab(rgb) {
  return xyzToLab(rgbToXyz(rgb));
}

/**
 * @param {string} hex
 * @returns {{l: number, a: number, b: number}} CIELAB
 */
export function hexToLab(hex) {
  return rgbToLab(hexToRgb(hex));
}

const toRadians = (degrees) => (degrees * Math.PI) / 180;
const toDegrees = (radians) => (radians * 180) / Math.PI;

/** Hue angle of a Lab colour in degrees, 0..360. */
function hueAngle(b, a) {
  if (a === 0 && b === 0) return 0;
  const angle = toDegrees(Math.atan2(b, a));
  return angle >= 0 ? angle : angle + 360;
}

/**
 * CIEDE2000 colour difference between two CIELAB colours (kL = kC = kH = 1).
 *
 * The branch structure follows the published implementation notes, including the
 * zero-chroma special cases, so that the supplementary test data of Sharma et al. is
 * reproduced within the stated tolerance (see tests/color-engine.test.mjs).
 *
 * @param {{l: number, a: number, b: number}} lab1 reference colour
 * @param {{l: number, a: number, b: number}} lab2 sample colour
 * @returns {number} delta E 00, 0 means the two colours are equal
 */
export function deltaE2000(lab1, lab2) {
  const { l: l1, a: a1, b: b1 } = lab1;
  const { l: l2, a: a2, b: b2 } = lab2;

  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const cBar7 = cBar ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));

  const a1Prime = (1 + g) * a1;
  const a2Prime = (1 + g) * a2;
  const c1Prime = Math.hypot(a1Prime, b1);
  const c2Prime = Math.hypot(a2Prime, b2);
  const h1Prime = hueAngle(b1, a1Prime);
  const h2Prime = hueAngle(b2, a2Prime);

  const deltaLPrime = l2 - l1;
  const deltaCPrime = c2Prime - c1Prime;

  const hueDifference = h2Prime - h1Prime;
  let deltaHuePrime;
  if (c1Prime * c2Prime === 0) {
    deltaHuePrime = 0;
  } else if (Math.abs(hueDifference) <= 180) {
    deltaHuePrime = hueDifference;
  } else if (hueDifference > 180) {
    deltaHuePrime = hueDifference - 360;
  } else {
    deltaHuePrime = hueDifference + 360;
  }
  const deltaHPrime = 2 * Math.sqrt(c1Prime * c2Prime) * Math.sin(toRadians(deltaHuePrime) / 2);

  const lBarPrime = (l1 + l2) / 2;
  const cBarPrime = (c1Prime + c2Prime) / 2;

  let hBarPrime;
  if (c1Prime * c2Prime === 0) {
    hBarPrime = h1Prime + h2Prime;
  } else if (Math.abs(h1Prime - h2Prime) <= 180) {
    hBarPrime = (h1Prime + h2Prime) / 2;
  } else if (Math.abs(h1Prime - h2Prime) > 180 && h1Prime + h2Prime < 360) {
    hBarPrime = (h1Prime + h2Prime + 360) / 2;
  } else {
    hBarPrime = (h1Prime + h2Prime - 360) / 2;
  }

  const t =
    1 -
    0.17 * Math.cos(toRadians(hBarPrime - 30)) +
    0.24 * Math.cos(toRadians(2 * hBarPrime)) +
    0.32 * Math.cos(toRadians(3 * hBarPrime + 6)) -
    0.2 * Math.cos(toRadians(4 * hBarPrime - 63));

  const deltaTheta = 30 * Math.exp(-(((hBarPrime - 275) / 25) ** 2));
  const cBarPrime7 = cBarPrime ** 7;
  const rC = 2 * Math.sqrt(cBarPrime7 / (cBarPrime7 + 25 ** 7));
  const sL = 1 + (0.015 * (lBarPrime - 50) ** 2) / Math.sqrt(20 + (lBarPrime - 50) ** 2);
  const sC = 1 + 0.045 * cBarPrime;
  const sH = 1 + 0.015 * cBarPrime * t;
  const rT = -Math.sin(toRadians(2 * deltaTheta)) * rC;

  const termL = deltaLPrime / sL;
  const termC = deltaCPrime / sC;
  const termH = deltaHPrime / sH;

  return Math.sqrt(termL ** 2 + termC ** 2 + termH ** 2 + rT * termC * termH);
}

/**
 * Convenience wrapper: CIEDE2000 between two HEX colours.
 * @param {string} hex1
 * @param {string} hex2
 * @returns {number}
 */
export function deltaE2000Hex(hex1, hex2) {
  return deltaE2000(hexToLab(hex1), hexToLab(hex2));
}
