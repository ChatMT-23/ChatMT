/**
 * Photo cut-out.
 *
 * The creator asked (31 October 2026) that the uploaded photo lose its original background
 * completely and that only the subject remain. The image provider is not used for this step:
 * the segmentation runs locally with OpenCV's GrabCut, so the subject is never redrawn or
 * altered by a model, and the operation does not consume image-generation credits.
 *
 * GrabCut is run on a small copy of the photo (400 px wide) because its cost grows with the
 * pixel count; the resulting mask is then scaled back to the prepared photo and feathered. On
 * a portrait the whole step takes roughly two seconds. The result is cached by the SHA-256 of
 * the prepared JPEG, so recomposing the flyer with another background does not segment again.
 *
 * A photo with no separable subject (for example a close-up that fills the frame with one
 * texture) is reported as `{ ok: false, reason }`. The caller then keeps the old framed
 * treatment instead of producing a broken cut-out.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Jimp } from 'jimp';

const ALGORITHM = 'grabcut-v3';
const WORK_WIDTH = 400;
const MAX_INPUT_WIDTH = 1200;
const MAX_INPUT_HEIGHT = 1600;
const MAX_CUTOUT_HEIGHT = 1100;
const MIN_FOREGROUND_RATIO = 0.01;
const MAX_FOREGROUND_RATIO = 0.97;
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

/** Binary erosion with a square kernel: thin bridges between the subject and background go away. */
function erodeMask(foreground, width, height, radius) {
  const horizontal = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let keep = 1;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width || foreground[y * width + nx] === 0) {
          keep = 0;
          break;
        }
      }
      horizontal[y * width + x] = keep;
    }
  }

  const result = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let keep = 1;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height || horizontal[ny * width + x] === 0) {
          keep = 0;
          break;
        }
      }
      result[y * width + x] = keep;
    }
  }
  return result;
}

/** Binary dilation with the same kernel, used to restore the subject edge after the erosion. */
function dilateMask(foreground, width, height, radius) {
  const horizontal = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        if (foreground[y * width + nx] === 1) {
          value = 1;
          break;
        }
      }
      horizontal[y * width + x] = value;
    }
  }

  const result = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        if (horizontal[ny * width + x] === 1) {
          value = 1;
          break;
        }
      }
      result[y * width + x] = value;
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
  const components = [];
  let best = null;

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
    const component = { members, area: members.length };
    components.push(component);
    if (best === null || component.area > best.area) best = component;
  }

  let removed = 0;
  for (const component of components) {
    if (component === best) continue;
    for (const index of component.members) foreground[index] = 0;
    removed += component.area;
  }
  return removed;
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

/**
 * The alpha edge is blurred, so a few pixels are partly transparent while their RGB still
 * contains the old background. Fill that fringe with the nearest opaque subject colour: when
 * the subject is composited on the new ground, no old colour is left around the outline.
 */
function decontaminateEdges(pixels, width, height, maxDistance) {
  const filled = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  for (let index = 0; index < width * height; index++) {
    if (pixels[index * 4 + 3] >= 250) {
      filled[index] = 1;
      queue[tail++] = index;
    }
  }

  let distance = 0;
  while (head < tail && distance < maxDistance) {
    const levelEnd = tail;
    while (head < levelEnd) {
      const index = queue[head++];
      const x = index % width;
      const y = (index / width) | 0;
      const source = index * 4;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const neighbour = ny * width + nx;
          if (filled[neighbour]) continue;
          const offset = neighbour * 4;
          if (pixels[offset + 3] === 0) continue;
          pixels[offset] = pixels[source];
          pixels[offset + 1] = pixels[source + 1];
          pixels[offset + 2] = pixels[source + 2];
          filled[neighbour] = 1;
          queue[tail++] = neighbour;
        }
      }
    }
    distance++;
  }
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
  if (!Number.isInteger(workWidth) || workWidth < 120 || workWidth > 900) {
    throw new TypeError('workWidth must be an integer between 120 and 900.');
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
    const mask = new cv.Mat();
    const bgdModel = new cv.Mat();
    const fgdModel = new cv.Mat();
    const inset = Math.max(2, Math.round(Math.min(width, height) * 0.025));
    const rect = new cv.Rect(inset, inset, width - inset * 2, height - inset);

    try {
      cv.grabCut(rgb, mask, rect, bgdModel, fgdModel, 8, cv.GC_INIT_WITH_RECT);
    } finally {
      rgba.delete();
      rgb.delete();
      bgdModel.delete();
      fgdModel.delete();
    }

    const foreground = new Uint8Array(width * height);
    for (let index = 0; index < width * height; index++) {
      const value = mask.data[index];
      foreground[index] = value === 1 || value === 3 ? 1 : 0;
    }
    mask.delete();

    // Erode first, so a thin background bridge cannot keep a lamp or a chair attached to the
    // subject. The largest eroded component is then dilated back to restore the real edge.
    const eroded = erodeMask(foreground, width, height, 2);
    const erodedHasSubject = eroded.some((value) => value === 1);
    const detached = erodedHasSubject ? keepLargestComponent(eroded, width, height) : 0;
    if (erodedHasSubject) {
      foreground.set(dilateMask(eroded, width, height, 2));
    }
    const filled = fillHoles(foreground, width, height);
    const removed = removeSpecks(foreground, width, height);
    const box = boundingBox(foreground, width, height);
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

    const sourceWidth = source.bitmap.width;
    const sourceHeight = source.bitmap.height;
    const alpha = new Jimp({ width, height });
    for (let index = 0; index < width * height; index++) {
      const offset = index * 4;
      alpha.bitmap.data[offset] = 0;
      alpha.bitmap.data[offset + 1] = 0;
      alpha.bitmap.data[offset + 2] = 0;
      alpha.bitmap.data[offset + 3] = foreground[index] ? 255 : 0;
    }
    alpha.resize({ w: sourceWidth, h: sourceHeight });
    alpha.blur(1);

    const pixels = Buffer.alloc(sourceWidth * sourceHeight * 4);
    for (let index = 0; index < sourceWidth * sourceHeight; index++) {
      const offset = index * 4;
      pixels[offset] = source.bitmap.data[offset];
      pixels[offset + 1] = source.bitmap.data[offset + 1];
      pixels[offset + 2] = source.bitmap.data[offset + 2];
      pixels[offset + 3] = alpha.bitmap.data[offset + 3];
    }
    decontaminateEdges(pixels, sourceWidth, sourceHeight, 3);

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
      removed_specks: removed
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
