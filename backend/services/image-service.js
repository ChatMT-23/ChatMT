/**
 * Image transform service.
 *
 * Implements the four operations agreed with the project creator — crop, resize, rotate by a
 * quarter turn, and conversion to png/jpeg/bmp — on an image sent in the request body.
 *
 * The image arrives as a data URL or as raw base64 inside JSON: multipart parsing is not part
 * of Node.js, and adding it would have meant another dependency for no benefit at this stage.
 * The limit on bytes, dimensions and operations is checked before and after decoding.
 */

import { Jimp } from 'jimp';

import {
  ImageOperationError,
  OUTPUT_FORMATS,
  assertCropFits,
  normaliseFormat,
  parseOperations,
  resolveResize
} from '../../modules/design/image-operations.js';

const DATA_URL = /^data:([a-zA-Z0-9.+/-]+);base64,/;

/** The advertised input formats are checked from the bytes, not from the data URL label. */
function detectImageFormat(buffer) {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return 'bmp';
  return null;
}

function decodeBase64(image) {
  if (typeof image !== 'string' || image.trim() === '') {
    throw new ImageOperationError('invalid_image', 'Send the image as a base64 string or as a data URL.');
  }
  const withoutPrefix = image.trim().replace(DATA_URL, '');
  const compact = withoutPrefix.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new ImageOperationError('invalid_image', 'The image is not valid base64.');
  }
  return Buffer.from(compact, 'base64');
}

/**
 * @param {{maxBytes: number, maxDimension: number, maxPixels: number}} limits
 */
export function createImageService(limits) {
  if (!limits || !Number.isInteger(limits.maxBytes) || limits.maxBytes < 1) {
    throw new TypeError('createImageService needs maxBytes, maxDimension and maxPixels.');
  }

  /**
   * One place decodes and validates an uploaded image, so the transform route and the
   * composition route cannot drift apart on format, byte or size rules.
   */
  async function loadImage(image) {
    const buffer = decodeBase64(image);
    if (buffer.length > limits.maxBytes) {
      throw new ImageOperationError(
        'image_too_large',
        `The image is ${buffer.length} bytes; the limit is ${limits.maxBytes}.`
      );
    }
    const sourceFormat = detectImageFormat(buffer);
    if (sourceFormat === null) {
      throw new ImageOperationError(
        'invalid_image',
        'The image could not be decoded. Supported input formats are png, jpeg and bmp.'
      );
    }

    let decoded;
    try {
      decoded = await Jimp.read(buffer);
    } catch {
      throw new ImageOperationError(
        'invalid_image',
        'The image could not be decoded. Supported input formats are png, jpeg and bmp.'
      );
    }

    const source = { width: decoded.bitmap.width, height: decoded.bitmap.height, format: sourceFormat };
    if (
      source.width > limits.maxDimension ||
      source.height > limits.maxDimension ||
      source.width * source.height > limits.maxPixels
    ) {
      throw new ImageOperationError(
        'image_too_large',
        `The image is ${source.width}x${source.height}; the limit is ${limits.maxDimension} pixels per side and ${limits.maxPixels} pixels in total.`
      );
    }
    return { decoded, source };
  }

  /**
   * Prepares an uploaded photo for a composition: validates it, shrinks it to a bounded width and
   * re-encodes it as JPEG. The aspect ratio is never changed: the composer fits the photo with
   * cover semantics, so the crop stays a layout decision instead of a user task.
   */
  async function prepare({ image, maxWidth = 1600 } = {}) {
    if (!Number.isInteger(maxWidth) || maxWidth < 64 || maxWidth > limits.maxDimension) {
      throw new TypeError(`maxWidth must be an integer between 64 and ${limits.maxDimension}.`);
    }
    const { decoded, source } = await loadImage(image);
    const sized =
      source.width > maxWidth
        ? (() => {
            const height = Math.max(1, Math.round((source.height * maxWidth) / source.width));
            decoded.resize({ w: maxWidth, h: height });
            return { width: maxWidth, height };
          })()
        : { width: source.width, height: source.height };

    const output = await decoded.getBuffer('image/jpeg', { quality: 82 });
    return {
      mime: 'image/jpeg',
      format: 'jpeg',
      source,
      width: sized.width,
      height: sized.height,
      resized: source.width > maxWidth,
      bytes: output.length,
      image: `data:image/jpeg;base64,${output.toString('base64')}`
    };
  }

  /**
   * @param {{image: string, operations?: Array<object>, format?: string}} input
   */
  async function transform({ image, operations = [], format } = {}) {
    const parsedOperations = parseOperations(operations);
    if (parsedOperations.length === 0 && format === undefined) {
      throw new ImageOperationError('invalid_request', 'Give at least one operation or an output format.');
    }
    const outputFormat = format === undefined ? 'png' : normaliseFormat(format);

    const { decoded, source } = await loadImage(image);

    for (const operation of parsedOperations) {
      if (operation.type === 'crop') {
        assertCropFits(operation, { width: decoded.bitmap.width, height: decoded.bitmap.height });
        decoded.crop({ x: operation.x, y: operation.y, w: operation.width, h: operation.height });
      } else if (operation.type === 'resize') {
        const target = resolveResize(operation, {
          width: decoded.bitmap.width,
          height: decoded.bitmap.height
        });
        if (target.width > limits.maxDimension || target.height > limits.maxDimension) {
          throw new ImageOperationError(
            'image_too_large',
            `The resize target is ${target.width}x${target.height}; the limit is ${limits.maxDimension} pixels per side.`
          );
        }
        decoded.resize({ w: target.width, h: target.height });
      } else if (operation.type === 'rotate') {
        decoded.rotate(operation.degrees);
      }
    }

    const output = await decoded.getBuffer(OUTPUT_FORMATS[outputFormat]);
    return {
      format: outputFormat,
      mime: OUTPUT_FORMATS[outputFormat],
      source,
      width: decoded.bitmap.width,
      height: decoded.bitmap.height,
      bytes: output.length,
      operations: parsedOperations,
      image: `data:${OUTPUT_FORMATS[outputFormat]};base64,${output.toString('base64')}`
    };
  }

  return Object.freeze({
    transform,
    prepare,
    operations: ['crop', 'resize', 'rotate'],
    formats: Object.keys(OUTPUT_FORMATS)
  });
}
