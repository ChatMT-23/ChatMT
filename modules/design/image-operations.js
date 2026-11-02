/**
 * Image transform operations, validation part.
 *
 * The backend performs four operations, chosen with the project creator: crop, resize,
 * rotate by a quarter turn, and conversion to png, jpeg or bmp. Everything is validated before
 * any pixel is touched, so an invalid request cannot produce a half-transformed image.
 */

export const OUTPUT_FORMATS = Object.freeze({
  png: 'image/png',
  jpeg: 'image/jpeg',
  bmp: 'image/bmp'
});

export const IMAGE_LIMITS = Object.freeze({
  max_operations: 10,
  min_dimension: 1,
  max_dimension: 8000
});

export class ImageOperationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ImageOperationError';
    this.code = code;
  }
}

function integer(value, field, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ImageOperationError(
      'invalid_operation',
      `${field} must be an integer between ${minimum} and ${maximum}.`
    );
  }
  return value;
}

export function normaliseFormat(format) {
  if (typeof format !== 'string' || !Object.hasOwn(OUTPUT_FORMATS, format.toLowerCase())) {
    throw new ImageOperationError(
      'invalid_format',
      `Unsupported output format ${JSON.stringify(format)}. Allowed formats: ${Object.keys(OUTPUT_FORMATS).join(', ')}.`
    );
  }
  return format.toLowerCase();
}

/**
 * Validate the shape of every operation. Bounds that depend on the current image size are
 * checked later, while the operations are applied in order.
 *
 * @param {Array<object>} operations
 * @returns {Array<object>} normalised operations
 */
export function parseOperations(operations = []) {
  if (!Array.isArray(operations)) {
    throw new ImageOperationError('invalid_operation', 'operations must be an array.');
  }
  if (operations.length > IMAGE_LIMITS.max_operations) {
    throw new ImageOperationError(
      'too_many_operations',
      `At most ${IMAGE_LIMITS.max_operations} operations are accepted.`
    );
  }

  return operations.map((operation, index) => {
    if (operation === null || typeof operation !== 'object' || Array.isArray(operation)) {
      throw new ImageOperationError('invalid_operation', `operations[${index}] must be an object.`);
    }
    const type = String(operation.type ?? '').toLowerCase();

    if (type === 'crop') {
      return {
        type,
        x: integer(operation.x, `operations[${index}].x`, 0, IMAGE_LIMITS.max_dimension),
        y: integer(operation.y, `operations[${index}].y`, 0, IMAGE_LIMITS.max_dimension),
        width: integer(operation.width, `operations[${index}].width`, 1, IMAGE_LIMITS.max_dimension),
        height: integer(operation.height, `operations[${index}].height`, 1, IMAGE_LIMITS.max_dimension)
      };
    }

    if (type === 'resize') {
      const width =
        operation.width === undefined
          ? null
          : integer(operation.width, `operations[${index}].width`, 1, IMAGE_LIMITS.max_dimension);
      const height =
        operation.height === undefined
          ? null
          : integer(operation.height, `operations[${index}].height`, 1, IMAGE_LIMITS.max_dimension);
      if (width === null && height === null) {
        throw new ImageOperationError(
          'invalid_operation',
          `operations[${index}] must give width, height or both.`
        );
      }
      return { type, width, height };
    }

    if (type === 'rotate') {
      const degrees = operation.degrees;
      if (![90, 180, 270].includes(degrees)) {
        throw new ImageOperationError(
          'invalid_operation',
          `operations[${index}].degrees must be 90, 180 or 270.`
        );
      }
      return { type, degrees };
    }

    throw new ImageOperationError(
      'invalid_operation',
      `operations[${index}].type ${JSON.stringify(operation.type)} is not supported. Allowed types: crop, resize, rotate.`
    );
  });
}

/** Crop bounds must fit inside the image as it is at that point in the sequence. */
export function assertCropFits(operation, { width, height }) {
  if (operation.x + operation.width > width || operation.y + operation.height > height) {
    throw new ImageOperationError(
      'crop_out_of_bounds',
      `The crop (${operation.x},${operation.y} ${operation.width}x${operation.height}) does not fit inside the ${width}x${height} image at that step.`
    );
  }
}

/** Resolve the target size of a resize, preserving the aspect ratio when one side is omitted. */
export function resolveResize(operation, { width, height }) {
  if (operation.width !== null && operation.height !== null) {
    return { width: operation.width, height: operation.height };
  }
  if (operation.width !== null) {
    const targetHeight = Math.max(1, Math.round((height * operation.width) / width));
    return { width: operation.width, height: targetHeight };
  }
  const targetWidth = Math.max(1, Math.round((width * operation.height) / height));
  return { width: targetWidth, height: operation.height };
}
