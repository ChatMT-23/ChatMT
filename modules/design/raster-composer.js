/**
 * Raster composition of a cut-out subject into a generated background.
 *
 * The creator asked (31 October 2026) that the original background of the uploaded photo be
 * removed completely and the subject fixed into the main background, not shown inside a framed
 * rectangle. This module does that literally: it paints the subject onto the background image
 * and returns one JPEG. The SVG composer then writes the text over that single image, so the
 * subject and the background are one picture, not two layers that can drift apart.
 *
 * The subject keeps its own pixels and colours. Only the alpha channel is changed: the last
 * part of the cut-out fades into the lower gradient, which hides the edge left by the cut-out
 * and lets the text sit over it without a visible seam.
 */

import { Jimp } from 'jimp';

import { SUBJECT_BOX, subjectPlacement } from './subject-placement.js';

const RASTER_DATA_URL = /^data:image\/(?:png|jpe?g|webp);base64,/i;
const DATA_URL = /^data:[a-zA-Z0-9.+/-]+;base64,(.*)$/s;

function bufferFromDataUrl(value) {
  const match = DATA_URL.exec(String(value));
  return match === null ? null : Buffer.from(match[1], 'base64');
}

export function isRasterImageDataUrl(value) {
  return typeof value === 'string' && RASTER_DATA_URL.test(value);
}

function applyBottomFade(image, ratio) {
  const { width, height, data } = image.bitmap;
  const start = Math.max(0, Math.min(height - 1, Math.round(height * (1 - ratio))));
  const span = Math.max(1, height - start);
  for (let y = start; y < height; y++) {
    const factor = Math.max(0, 1 - (y - start) / span);
    for (let x = 0; x < width; x++) {
      const alpha = (y * width + x) * 4 + 3;
      data[alpha] = Math.round(data[alpha] * factor);
    }
  }
}

function shadowOf(subject, placement) {
  const shadow = subject.clone();
  const { data } = shadow.bitmap;
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 0;
    data[index + 1] = 0;
    data[index + 2] = 0;
    data[index + 3] = Math.round(data[index + 3] * 0.34);
  }
  const radius = Math.max(6, Math.round(placement.height * 0.022));
  shadow.blur(radius);
  return shadow;
}

/**
 * @param {object} input
 * @param {string} input.backgroundImage a raster data URL
 * @param {string} input.subjectImage a PNG data URL with transparency
 * @param {number} input.width the flyer width
 * @param {number} input.height the flyer height
 * @param {number} input.subjectWidth the cut-out width before placement
 * @param {number} input.subjectHeight the cut-out height before placement
 * @returns {Promise<{image: string, width: number, height: number, bytes: number, subject: object}>}
 */
export async function compositeSubject({
  backgroundImage,
  subjectImage,
  width,
  height,
  subjectWidth,
  subjectHeight
} = {}) {
  if (!isRasterImageDataUrl(backgroundImage)) {
    throw new TypeError('The background must be a raster image data URL.');
  }
  if (!isRasterImageDataUrl(subjectImage)) {
    throw new TypeError('The cut-out subject must be a raster image data URL.');
  }

  const backgroundBuffer = bufferFromDataUrl(backgroundImage);
  const subjectBuffer = bufferFromDataUrl(subjectImage);
  if (backgroundBuffer === null || subjectBuffer === null) {
    throw new TypeError('The image data URLs are not valid base64.');
  }

  const background = await Jimp.read(backgroundBuffer);
  background.cover({ w: width, h: height });

  const subject = await Jimp.read(subjectBuffer);
  const placement = subjectPlacement({
    width,
    height,
    subject: { width: subjectWidth, height: subjectHeight }
  });
  subject.resize({ w: placement.width, h: placement.height });
  applyBottomFade(subject, SUBJECT_BOX.fadeRatio);

  const shadow = shadowOf(subject, placement);
  const shadowOffset = Math.max(2, Math.round(placement.height * 0.012));
  background.composite(shadow, placement.x, placement.y + shadowOffset);
  background.composite(subject, placement.x, placement.y);

  const output = await background.getBuffer('image/jpeg', { quality: 86 });
  return {
    image: `data:image/jpeg;base64,${output.toString('base64')}`,
    width,
    height,
    bytes: output.length,
    subject: placement
  };
}
