/**
 * Photo cut-out.
 *
 * The creator asked (31 October 2026) that the uploaded photo lose its original background
 * completely and that only the subject remain. The image provider is not used for this step:
 * the segmentation runs locally with OpenCV's GrabCut, so the subject is never redrawn or
 * altered by a model, and the operation does not consume image-generation credits.
 *
 * GrabCut is run on a small copy of the photo because its cost grows with the pixel count. One
 * pass with a rectangle is enough to find the subject but not to follow its outline: the mask
 * comes back coarse and a few pixels of the old background cling to the border. The first mask
 * is therefore used as the seed of a second pass (definite subject, definite background, a thin
 * unknown band in between), and the edge is finished with a guided filter and a colour
 * decontamination pass. On a portrait the whole step takes a few seconds. The result is cached
 * by the SHA-256 of the prepared JPEG, so recomposing the flyer with another background does not
 * segment again.
 *
 * A photo with no separable subject (for example a close-up that fills the frame with one
 * texture) is reported as `{ ok: false, reason }`. The caller then keeps the old framed
 * treatment instead of producing a broken cut-out.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Jimp } from 'jimp';

const ALGORITHM = 'grabcut-v4';
const WORK_WIDTH = 560;
const MAX_INPUT_WIDTH = 1200;
const MAX_INPUT_HEIGHT = 1600;
const MAX_CUTOUT_HEIGHT = 1100;
const MIN_FOREGROUND_RATIO = 0.01;
const MAX_FOREGROUND_RATIO = 0.97;
const MATTE_RADIUS = 4;
const MATTE_EPSILON = 0.0001;
const DATA_URL = /^data:[a-zA-Z0-9.+/-]+;base64,(.*)$/s;

export class CutoutError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CutoutError';
    this.code = code;
  }
}

function bufferFromDataUrl(value) {
  const match = DATA_URL.exec(String(value));
  return match === null ? null : Buffer.from(match[1], 'base64');
}

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Pixel offsets of a disk, so erosion and dilation keep round edges instead of squares. */
function diskOffsets(radius) {
  const offsets = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) offsets.push([dx, dy]);
    }
  }
  return offsets;
}

const DISK_1 = diskOffsets(1);
const DISK_2 = diskOffsets(2);
const DISK_3 = diskOffsets(3);

/** Background pixels that are not reachable from the border are holes inside the subject. */
function fillHoles(foreground, width, height) {
  const outside = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const push = (index) => {
    if (outside[index] || foreground[index]) return;
    outside[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = (index / width) | 0;
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }

  let filled = 0;
  for (let index = 0; index < width * height; index++) {
    if (!foreground[index] && !outside[index]) {
      foreground[index] = 1;
      filled++;
    }
  }
  return filled;
}

function erodeMask(foreground, width, height, offsets) {
  const result = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!foreground[y * width + x]) continue;
      let keep = 1;
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || !foreground[ny * width + nx]) {
          keep = 0;
          break;
        }
      }
      result[y * width + x] = keep;
    }
  }
  return result;
}

function dilateMask(foreground, width, height, offsets) {
  const result = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!foreground[y * width + x]) continue;
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        result[ny * width + nx] = 1;
      }
    }
  }
  return result;
}

/**
 * Only the main subject survives. GrabCut can classify a window, a lamp or a piece of furniture
 * as foreground because it only receives a coarse rectangle; those objects are separate
 * connected components, so keeping the largest component removes them completely. Eight
 * neighbours are used so that a diagonal edge of the subject is not split in two.
 */
function keepLargestComponent(foreground, width, height) {
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let bestArea = 0;
  let bestStart = -1;

  for (let start = 0; start < width * height; start++) {
    if (!foreground[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let area = 0;
    while (top > 0) {
      const index = stack[--top];
      area++;
      const x = index % width;
      const y = (index / width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const neighbour = ny * width + nx;
          if (!foreground[neighbour] || seen[neighbour]) continue;
          seen[neighbour] = 1;
          stack[top++] = neighbour;
        }
      }
    }
    if (area > bestArea) {
      bestArea = area;
      bestStart = start;
    }
  }

  if (bestStart === -1) return { removed: 0, kept: 0 };

  const keep = new Uint8Array(width * height);
  let top = 0;
  stack[top++] = bestStart;
  keep[bestStart] = 1;
  while (top > 0) {
    const index = stack[--top];
    const x = index % width;
    const y = (index / width) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        const neighbour = ny * width + nx;
        if (!foreground[neighbour] || keep[neighbour]) continue;
        keep[neighbour] = 1;
        stack[top++] = neighbour;
      }
    }
  }

  let removed = 0;
  for (let index = 0; index < width * height; index++) {
    if (foreground[index] && !keep[index]) {
      foreground[index] = 0;
      removed++;
    }
  }
  return { removed, kept: bestArea };
}

/** Tiny isolated specks are not part of the subject and are removed. */
function removeSpecks(foreground, width, height) {
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  const minArea = Math.max(24, Math.round(width * height * 0.0008));
  let removed = 0;

  for (let start = 0; start < width * height; start++) {
    if (!foreground[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    const members = [];
    while (top > 0) {
      const index = stack[--top];
      members.push(index);
      const x = index % width;
      const y = (index / width) | 0;
      if (x > 0 && foreground[index - 1] && !seen[index - 1]) {
        seen[index - 1] = 1;
        stack[top++] = index - 1;
      }
      if (x < width - 1 && foreground[index + 1] && !seen[index + 1]) {
        seen[index + 1] = 1;
        stack[top++] = index + 1;
      }
      if (y > 0 && foreground[index - width] && !seen[index - width]) {
        seen[index - width] = 1;
        stack[top++] = index - width;
      }
      if (y < height - 1 && foreground[index + width] && !seen[index + width]) {
        seen[index + width] = 1;
        stack[top++] = index + width;
      }
    }
    if (members.length < minArea) {
      for (const index of members) foreground[index] = 0;
      removed += members.length;
    }
  }
  return removed;
}

/** Mean of a square window in O(1) per pixel, through an integral image. */
function boxMean(source, width, height, radius) {
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const row = y * width;
    const previous = y * stride;
    const next = (y + 1) * stride;
    for (let x = 0; x < width; x++) {
      rowSum += source[row + x];
      integral[next + x + 1] = integral[previous + x + 1] + rowSum;
    }
  }

  const result = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    const top = y0 * stride;
    const bottom = (y1 + 1) * stride;
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const sum = integral[bottom + x1] - integral[top + x1] - integral[bottom + x0] + integral[top + x0];
      result[y * width + x] = sum / ((x1 - x0) * (y1 - y0 + 1));
    }
  }
  return result;
}

/**
 * Guided filter: the binary mask is refined with the photo itself as a guide, so the alpha
 * follows the real outline instead of a blurred copy of a 560-px mask. This is the difference
 * between a hard staircase edge and an edge that sits on the subject's own pixels.
 */
function refineAlpha(binary, guide, width, height, radius, epsilon) {
  const count = width * height;
  const meanGuide = boxMean(guide, width, height, radius);
  const meanMask = boxMean(binary, width, height, radius);
  const squared = new Float32Array(count);
  const product = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    squared[index] = guide[index] * guide[index];
    product[index] = guide[index] * binary[index];
  }
  const meanSquared = boxMean(squared, width, height, radius);
  const meanProduct = boxMean(product, width, height, radius);

  const slope = new Float32Array(count);
  const offset = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const variance = meanSquared[index] - meanGuide[index] * meanGuide[index];
    const covariance = meanProduct[index] - meanGuide[index] * meanMask[index];
    const a = covariance / (variance + epsilon);
    slope[index] = a;
    offset[index] = meanMask[index] - a * meanGuide[index];
  }

  const meanSlope = boxMean(slope, width, height, radius);
  const meanOffset = boxMean(offset, width, height, radius);
  const alpha = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    alpha[index] = clamp01(meanSlope[index] * guide[index] + meanOffset[index]);
  }
  return alpha;
}

/**
 * Multi-source breadth-first fill. Every band pixel receives the colour of the nearest pixel
 * that is certainly subject (or certainly background). Those two colours are what the matting
 * equation needs: no guesswork, no global average.
 */
function nearestColours(pixels, width, height, seed, mask, out) {
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let index = 0; index < width * height; index++) {
    if (!seed[index]) continue;
    const offset = index * 4;
    out[index * 3] = pixels[offset];
    out[index * 3 + 1] = pixels[offset + 1];
    out[index * 3 + 2] = pixels[offset + 2];
    queue[tail++] = index;
  }
  const filled = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index++) filled[index] = seed[index] ? 1 : 0;

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = (index / width) | 0;
    const sourceOffset = index * 3;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        const neighbour = ny * width + nx;
        if (filled[neighbour] || !mask[neighbour]) continue;
        out[neighbour * 3] = out[sourceOffset];
        out[neighbour * 3 + 1] = out[sourceOffset + 1];
        out[neighbour * 3 + 2] = out[sourceOffset + 2];
        filled[neighbour] = 1;
        queue[tail++] = neighbour;
      }
    }
  }
  return tail;
}

function boundingBox(foreground, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!foreground[y * width + x]) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, count };
}

/**
 * @param {{cacheDir?: string|null, workWidth?: number}} [options]
 */
export function createCutoutService({ cacheDir = null, workWidth = WORK_WIDTH } = {}) {
  if (!Number.isInteger(workWidth) || workWidth < 160 || workWidth > 900) {
    throw new TypeError('workWidth must be an integer between 160 and 900.');
  }

  let cvPromise = null;
  function loadCv() {
    cvPromise ??= import('@techstark/opencv-js').then((module) => module.default);
    return cvPromise;
  }

  async function readCache(id) {
    if (cacheDir === null) return null;
    try {
      const text = await fs.readFile(path.join(cacheDir, `${id}.json`), 'utf8');
      const parsed = JSON.parse(text);
      if (typeof parsed?.ok === 'boolean') return parsed;
    } catch {
      // A missing or unreadable cache entry is a miss, not an error.
    }
    return null;
  }

  async function writeCache(record) {
    if (cacheDir === null) return;
    try {
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(path.join(cacheDir, `${record.id}.json`), JSON.stringify(record), 'utf8');
    } catch {
      // The cache is best effort: a read-only or full disk must not break the flyer.
    }
  }

  async function compute(source) {
    const cv = await loadCv();
    const work = source.clone();
    if (work.bitmap.width > workWidth) work.resize({ w: workWidth });
    const { width, height, data } = work.bitmap;

    const rgba = cv.matFromImageData({ data: new Uint8ClampedArray(data), width, height });
    const rgb = new cv.Mat();
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    rgba.delete();

    const mask = new cv.Mat();
    const bgdModel = new cv.Mat();
    const fgdModel = new cv.Mat();
    const inset = Math.max(2, Math.round(Math.min(width, height) * 0.025));
    const rect = new cv.Rect(inset, inset, width - inset * 2, height - inset);

    try {
      cv.grabCut(rgb, mask, rect, bgdModel, fgdModel, 5, cv.GC_INIT_WITH_RECT);
    } finally {
      bgdModel.delete();
      fgdModel.delete();
    }

    // First mask: subject where GrabCut is sure or almost sure.
    const coarse = new Uint8Array(width * height);
    for (let index = 0; index < width * height; index++) {
      const value = mask.data[index];
      coarse[index] = value === 1 || value === 3 ? 1 : 0;
    }
    mask.delete();

    // Second pass: the eroded first mask is definite subject, the dilated first mask is the
    // unknown band, everything else is definite background. GrabCut can now move the outline
    // instead of only cutting a rectangle, which is what removes the leftover background.
    const definiteForeground = erodeMask(coarse, width, height, DISK_2);
    const unknown = dilateMask(coarse, width, height, DISK_3);
    let bandPixels = 0;
    const seeded = new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(0));
    for (let index = 0; index < width * height; index++) {
      if (definiteForeground[index]) seeded.data[index] = cv.GC_FGD;
      else if (unknown[index]) {
        seeded.data[index] = cv.GC_PR_FGD;
        bandPixels++;
      } else seeded.data[index] = cv.GC_BGD;
    }
    const seededBgd = new cv.Mat();
    const seededFgd = new cv.Mat();
    const ignored = new cv.Rect(0, 0, 1, 1);
    try {
      cv.grabCut(rgb, seeded, ignored, seededBgd, seededFgd, 3, cv.GC_INIT_WITH_MASK);
    } catch {
      // A second pass that cannot run leaves the first mask in place; the edge work below is
      // still valid, the outline is just less precise.
    } finally {
      seededBgd.delete();
      seededFgd.delete();
    }

    const refined = new Uint8Array(width * height);
    for (let index = 0; index < width * height; index++) {
      const value = seeded.data[index];
      refined[index] = value === 1 || value === 3 ? 1 : 0;
    }
    seeded.delete();
    rgb.delete();

    // Erode first, so a thin background bridge cannot keep a lamp or a chair attached to the
    // subject. The largest eroded component is then dilated back to restore the real edge.
    const eroded = erodeMask(refined, width, height, DISK_1);
    const hasSubject = eroded.some((value) => value === 1);
    let detached = 0;
    const solid = new Uint8Array(width * height);
    if (hasSubject) {
      detached = keepLargestComponent(eroded, width, height).removed;
      solid.set(dilateMask(eroded, width, height, DISK_1));
    } else {
      solid.set(refined);
    }
    const filled = fillHoles(solid, width, height);
    const removed = removeSpecks(solid, width, height);
    const box = boundingBox(solid, width, height);
    const foregroundRatio = box.count / (width * height);
    const boxWidth = box.maxX - box.minX + 1;
    const boxHeight = box.maxY - box.minY + 1;

    if (box.count === 0 || foregroundRatio < MIN_FOREGROUND_RATIO) {
      return { ok: false, reason: 'no_subject', foreground_ratio: Number(foregroundRatio.toFixed(3)) };
    }
    if (foregroundRatio > MAX_FOREGROUND_RATIO) {
      return { ok: false, reason: 'no_background', foreground_ratio: Number(foregroundRatio.toFixed(3)) };
    }
    if (boxWidth < width * 0.05 || boxHeight < height * 0.05) {
      return { ok: false, reason: 'no_subject', foreground_ratio: Number(foregroundRatio.toFixed(3)) };
    }
    if (boxWidth > width * 0.995 && boxHeight > height * 0.995) {
      return { ok: false, reason: 'no_background', foreground_ratio: Number(foregroundRatio.toFixed(3)) };
    }

    // Matte at work resolution, then enlarged: the guided filter needs the photo, not the
    // 560-px copy alone, but running it on the full photo would cost more than it returns.
    const guide = new Float32Array(width * height);
    for (let index = 0; index < width * height; index++) {
      const offset = index * 4;
      guide[index] = (data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114) / 255;
    }
    const binary = new Float32Array(width * height);
    for (let index = 0; index < width * height; index++) binary[index] = solid[index];
    const soft = refineAlpha(binary, guide, width, height, MATTE_RADIUS, MATTE_EPSILON);

    // Keep the silhouette where the mask is unambiguous, and let the filter shape the band.
    // The inner edge is eroded by one work pixel: a mask that ran a pixel wide then paints the
    // old background on the outline, and a hair's width of subject costs less than a halo.
    const inner = erodeMask(solid, width, height, DISK_1);
    const outer = solid;
    const matte = new Float32Array(width * height);
    for (let index = 0; index < width * height; index++) {
      if (inner[index]) matte[index] = 1;
      else if (!outer[index]) matte[index] = 0;
      else matte[index] = soft[index];
    }

    const sourceWidth = source.bitmap.width;
    const sourceHeight = source.bitmap.height;

    // Alpha is resized as a grey image: Jimp interpolates it smoothly, so the edge does not
    // become a staircase when the mask is smaller than the photo.
    const alphaWork = new Jimp({ width, height });
    for (let index = 0; index < width * height; index++) {
      const offset = index * 4;
      const value = Math.round(matte[index] * 255);
      alphaWork.bitmap.data[offset] = value;
      alphaWork.bitmap.data[offset + 1] = value;
      alphaWork.bitmap.data[offset + 2] = value;
      alphaWork.bitmap.data[offset + 3] = 255;
    }
    alphaWork.resize({ w: sourceWidth, h: sourceHeight });
    // One pixel of blur turns the resized mask into an antialiased edge instead of a
    // staircase. It runs before the colour pass, so every partly transparent pixel is still
    // decontaminated afterwards and no old background is left in the fringe.
    alphaWork.blur(1);

    const pixels = Buffer.alloc(sourceWidth * sourceHeight * 4);
    for (let index = 0; index < sourceWidth * sourceHeight; index++) {
      const offset = index * 4;
      pixels[offset] = source.bitmap.data[offset];
      pixels[offset + 1] = source.bitmap.data[offset + 1];
      pixels[offset + 2] = source.bitmap.data[offset + 2];
      pixels[offset + 3] = alphaWork.bitmap.data[offset];
    }

    // Colour decontamination. A pixel on the edge is a mix of the subject and the old
    // background: its RGB still carries the old colour, which is the pale halo left by a plain
    // cut-out. The nearest certain background colour and the nearest certain subject colour are
    // used to solve `observed = alpha * subject + (1 - alpha) * background` for the subject
    // colour, so the fringe becomes subject colour at the right opacity.
    const count = sourceWidth * sourceHeight;
    const sureForeground = new Uint8Array(count);
    const sureBackground = new Uint8Array(count);
    const band = new Uint8Array(count);
    let bandCount = 0;
    for (let index = 0; index < count; index++) {
      const alpha = pixels[index * 4 + 3];
      if (alpha <= 5) {
        // A background pixel that touches the fringe is itself a blend of the two colours;
        // only background pixels with clean neighbours are used as the background sample.
        const x = index % sourceWidth;
        const y = (index / sourceWidth) | 0;
        let clean = 1;
        for (let dy = -1; dy <= 1 && clean; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= sourceHeight) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= sourceWidth) continue;
            if (pixels[(ny * sourceWidth + nx) * 4 + 3] > 5) {
              clean = 0;
              break;
            }
          }
        }
        if (clean) {
          sureBackground[index] = 1;
          continue;
        }
      }
      if (alpha >= 250) continue;
      band[index] = 1;
      bandCount++;
    }

    // Nearest background colour for every pixel, used twice: to solve the matte and to decide
    // whether a pixel inside the mask really carries subject colour, or is a pale leftover of a
    // mask that ran a few pixels wide.
    const background = new Float32Array(count * 3);
    const everything = new Uint8Array(count).fill(1);
    nearestColours(pixels, sourceWidth, sourceHeight, sureBackground, everything, background);

    const deep = erodeMask(solid, width, height, DISK_3);
    const deepWork = new Jimp({ width, height });
    let deepCount = 0;
    for (let index = 0; index < width * height; index++) {
      const offset = index * 4;
      const value = deep[index] ? 255 : 0;
      if (value === 255) deepCount++;
      deepWork.bitmap.data[offset] = value;
      deepWork.bitmap.data[offset + 1] = value;
      deepWork.bitmap.data[offset + 2] = value;
      deepWork.bitmap.data[offset + 3] = 255;
    }
    deepWork.resize({ w: sourceWidth, h: sourceHeight });
    const useDeep = deepCount > 40;
    let backgroundSeeds = 0;
    for (let index = 0; index < count; index++) if (sureBackground[index]) backgroundSeeds++;

    for (let index = 0; index < count; index++) {
      if (pixels[index * 4 + 3] < 250) continue;
      if (useDeep && deepWork.bitmap.data[index * 4] < 200) continue;
      if (backgroundSeeds > 0) {
        const offset = index * 4;
        const distance =
          Math.abs(pixels[offset] - background[index * 3]) +
          Math.abs(pixels[offset + 1] - background[index * 3 + 1]) +
          Math.abs(pixels[offset + 2] - background[index * 3 + 2]);
        // The pixel looks like the background it sits next to, so it cannot stand for the
        // subject colour: the fringe would then be "corrected" with the very colour it must
        // lose. It stays an ordinary opaque pixel and is simply not used as a sample.
        if (distance < 40) continue;
      }
      sureForeground[index] = 1;
    }

    if (bandCount > 0) {
      // The mask can run wide over a flat background: a pale cap above a head, a strip along a
      // shoulder. Those pixels are opaque and carry the background colour, so the fringe pass
      // never sees them. They are found by growth from the frame along pixels that are either
      // transparent or background-coloured; the growth is limited to a few pixels so it can
      // never repaint the subject.
      const suspect = new Uint8Array(count);
      if (backgroundSeeds > 0) {
        const passable = new Uint8Array(count);
        for (let index = 0; index < count; index++) {
          const offset = index * 4;
          const alpha = pixels[offset + 3];
          if (alpha <= 250) {
            passable[index] = 1;
            continue;
          }
          const distance =
            Math.abs(pixels[offset] - background[index * 3]) +
            Math.abs(pixels[offset + 1] - background[index * 3 + 1]) +
            Math.abs(pixels[offset + 2] - background[index * 3 + 2]);
          if (distance >= 40) continue;
          // Background-coloured and reachable from the frame: it is part of the same surface
          // the mask overran, not a detail of the subject.
          passable[index] = 1;
        }

        const queue = new Int32Array(count);
        const depth = new Int16Array(count).fill(-1);
        let head = 0;
        let tail = 0;
        const push = (index, level) => {
          if (depth[index] >= 0 || !passable[index] || level > 5) return;
          depth[index] = level;
          queue[tail++] = index;
        };
        // Growth starts only from background that is truly transparent at the frame, never
        // from the subject's own cut edge, and stops after a few pixels: it is there to remove
        // the extra rows a mask adds around an outline, not to repaint the subject.
        for (let x = 0; x < sourceWidth; x++) {
          if (pixels[x * 4 + 3] <= 5) push(x, 0);
          const bottom = (sourceHeight - 1) * sourceWidth + x;
          if (pixels[bottom * 4 + 3] <= 5) push(bottom, 0);
        }
        for (let y = 0; y < sourceHeight; y++) {
          if (pixels[y * sourceWidth * 4 + 3] <= 5) push(y * sourceWidth, 0);
          const right = y * sourceWidth + sourceWidth - 1;
          if (pixels[right * 4 + 3] <= 5) push(right, 0);
        }
        while (head < tail) {
          const index = queue[head++];
          const level = depth[index];
          const x = index % sourceWidth;
          const y = (index / sourceWidth) | 0;
          const visit = (neighbour) => {
            if (depth[neighbour] >= 0 || !passable[neighbour]) return;
            const next = level + (pixels[neighbour * 4 + 3] > 250 ? 1 : 0);
            if (next > 5) return;
            depth[neighbour] = next;
            queue[tail++] = neighbour;
          };
          if (x > 0) visit(index - 1);
          if (x < sourceWidth - 1) visit(index + 1);
          if (y > 0) visit(index - sourceWidth);
          if (y < sourceHeight - 1) visit(index + sourceWidth);
        }
        for (let index = 0; index < count; index++) {
          if (depth[index] >= 0 && pixels[index * 4 + 3] > 250) suspect[index] = 1;
        }
      }

      const foreground = new Float32Array(count * 3);
      const reachable = new Uint8Array(count);
      for (let index = 0; index < count; index++) {
        if (band[index] || suspect[index]) reachable[index] = 1;
      }
      nearestColours(pixels, sourceWidth, sourceHeight, sureForeground, reachable, foreground);

      const projection = new Float32Array(count).fill(-1);
      for (let index = 0; index < count; index++) {
        if (!reachable[index]) continue;
        const offset = index * 4;
        const br = background[index * 3];
        const bg = background[index * 3 + 1];
        const bb = background[index * 3 + 2];
        const fr = foreground[index * 3];
        const fg = foreground[index * 3 + 1];
        const fb = foreground[index * 3 + 2];
        const dr = fr - br;
        const dg = fg - bg;
        const db = fb - bb;
        const denominator = dr * dr + dg * dg + db * db;
        if (denominator <= 1600) continue;
        // Projection on the colour line: a local estimate of how much subject is in the mix.
        projection[index] = clamp01(
          ((pixels[offset] - br) * dr + (pixels[offset + 1] - bg) * dg + (pixels[offset + 2] - bb) * db) /
            denominator
        );
      }

      // A single pixel whose colour matches the wall proves nothing: on a textured background
      // the hat or the skin can legitimately resemble it. A *group* of such pixels is the mask
      // running wide. The projection is therefore median-filtered before it is allowed to
      // change an alpha, so only coherent evidence counts.
      const coherent = new Float32Array(count).fill(-1);
      const window = [];
      for (let index = 0; index < count; index++) {
        if (!reachable[index]) continue;
        const x = index % sourceWidth;
        const y = (index / sourceWidth) | 0;
        window.length = 0;
        for (let dy = -2; dy <= 2; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= sourceHeight) continue;
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= sourceWidth) continue;
            const value = projection[ny * sourceWidth + nx];
            if (value >= 0) window.push(value);
          }
        }
        if (window.length === 0) continue;
        window.sort((a, b) => a - b);
        coherent[index] = window[window.length >> 1];
      }

      for (let index = 0; index < count; index++) {
        if (!band[index] && !suspect[index]) continue;
        const offset = index * 4;
        let alpha = pixels[offset + 3] / 255;
        const br = background[index * 3];
        const bg = background[index * 3 + 1];
        const bb = background[index * 3 + 2];
        const fr = foreground[index * 3];
        const fg = foreground[index * 3 + 1];
        const fb = foreground[index * 3 + 2];
        const value = coherent[index];

        if (suspect[index]) {
          // Only a coherent background-looking area on the outline is removed; an isolated
          // opaque pixel is kept, because it is more likely a real detail of the subject.
          if (value < 0 || value >= 0.35) continue;
          alpha = Math.min(alpha, value * 0.15);
        } else if (value >= 0) {
          // It may lower the geometric alpha freely (that is the background being removed) but
          // may only raise it a little: letting colour alone inflate the subject would eat the
          // soft edge of hair and fabric.
          alpha = clamp01(Math.min(alpha + 0.1, Math.max(alpha - 0.5, value)));
          // A coherent region with no trace of subject colour is background the mask kept.
          if (value < 0.06) alpha = Math.min(alpha, 0.05);
        }

        if (alpha > 0.06) {
          const inverse = 1 / alpha;
          pixels[offset] = Math.max(
            0,
            Math.min(255, Math.round(br + (pixels[offset] - br) * inverse))
          );
          pixels[offset + 1] = Math.max(
            0,
            Math.min(255, Math.round(bg + (pixels[offset + 1] - bg) * inverse))
          );
          pixels[offset + 2] = Math.max(
            0,
            Math.min(255, Math.round(bb + (pixels[offset + 2] - bb) * inverse))
          );
        } else {
          pixels[offset] = Math.round(fr);
          pixels[offset + 1] = Math.round(fg);
          pixels[offset + 2] = Math.round(fb);
          alpha = Math.min(alpha, 0.06);
        }
        pixels[offset + 3] = Math.round(alpha * 255);
      }
    }

    // Last pass on the outline. One opaque pixel that still carries the background colour is
    // the last row of the old background that survived the mask; removing it costs a pixel of
    // subject and takes the pale rim away. Two rounds cover a rim that is two pixels wide.
    for (let round = 0; round < 2; round++) {
      let removedRim = 0;
      for (let index = 0; index < count; index++) {
        const offset = index * 4;
        if (pixels[offset + 3] <= 250) continue;
        const x = index % sourceWidth;
        const y = (index / sourceWidth) | 0;
        let outline = 0;
        for (let dy = -1; dy <= 1 && !outline; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= sourceHeight) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= sourceWidth) continue;
            if (pixels[(ny * sourceWidth + nx) * 4 + 3] <= 40) {
              outline = 1;
              break;
            }
          }
        }
        if (!outline) continue;
        const distance =
          Math.abs(pixels[offset] - background[index * 3]) +
          Math.abs(pixels[offset + 1] - background[index * 3 + 1]) +
          Math.abs(pixels[offset + 2] - background[index * 3 + 2]);
        if (distance >= 40) continue;
        pixels[offset + 3] = 0;
        removedRim++;
      }
      if (removedRim === 0) break;
    }

    // GrabCut ran on the reduced copy, so the bounding box is in work coordinates. Scale it
    // back to the prepared photo before cropping: using it directly would cut a slice of the
    // subject and leave the rest of the original background in place.
    const scaleX = sourceWidth / width;
    const scaleY = sourceHeight / height;
    const pad = 2;
    const cropX = Math.max(0, Math.round(box.minX * scaleX) - pad);
    const cropY = Math.max(0, Math.round(box.minY * scaleY) - pad);
    const cropWidth = Math.min(sourceWidth, Math.round((box.maxX + 1) * scaleX) + pad) - cropX;
    const cropHeight = Math.min(sourceHeight, Math.round((box.maxY + 1) * scaleY) + pad) - cropY;
    const cut = new Jimp({ width: cropWidth, height: cropHeight });
    for (let y = 0; y < cropHeight; y++) {
      for (let x = 0; x < cropWidth; x++) {
        const sourceOffset = ((y + cropY) * sourceWidth + (x + cropX)) * 4;
        const targetOffset = (y * cropWidth + x) * 4;
        cut.bitmap.data[targetOffset] = pixels[sourceOffset];
        cut.bitmap.data[targetOffset + 1] = pixels[sourceOffset + 1];
        cut.bitmap.data[targetOffset + 2] = pixels[sourceOffset + 2];
        cut.bitmap.data[targetOffset + 3] = pixels[sourceOffset + 3];
      }
    }
    if (cut.bitmap.height > MAX_CUTOUT_HEIGHT) cut.resize({ h: MAX_CUTOUT_HEIGHT });

    const png = await cut.getBuffer('image/png');
    return {
      ok: true,
      image: `data:image/png;base64,${png.toString('base64')}`,
      width: cut.bitmap.width,
      height: cut.bitmap.height,
      bbox: { x: cropX, y: cropY, width: cropWidth, height: cropHeight },
      method: 'grabcut',
      foreground_ratio: Number(foregroundRatio.toFixed(3)),
      removed_detached: detached,
      filled_holes: filled,
      removed_specks: removed,
      refined_band: bandCount,
      matte: 'guided-filter'
    };
  }

  async function removeBackground({ image } = {}) {
    const buffer = bufferFromDataUrl(image);
    if (buffer === null) {
      throw new CutoutError('cutout_invalid_image', 'The photo is not a base64 image data URL.');
    }

    const id = crypto.createHash('sha256').update(ALGORITHM).update(buffer).digest('hex');
    const cached = await readCache(id);
    if (cached !== null) return cached;

    const source = await Jimp.read(buffer);
    if (source.bitmap.width > MAX_INPUT_WIDTH) source.resize({ w: MAX_INPUT_WIDTH });
    if (source.bitmap.height > MAX_INPUT_HEIGHT) source.resize({ h: MAX_INPUT_HEIGHT });

    const result = await compute(source);
    await writeCache({ id, ...result, created_at: new Date().toISOString() });
    return result;
  }

  return Object.freeze({ removeBackground, algorithm: ALGORITHM, workWidth });
}
