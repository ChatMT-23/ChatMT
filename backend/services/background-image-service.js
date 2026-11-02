/**
 * Generated background suggestions.
 *
 * The image model produces one background per motif (botanical, village, chapel, meadow,
 * arches). The prompt uses only the chosen colour, two supporting colours and the motif: the
 * user's flyer text is never sent to the image provider.
 *
 * A generated image is cached by the SHA-256 of model + prompt under the data directory. The
 * cache is what makes "try another background" cheap: choosing a suggestion recomposes the
 * flyer with the same image instead of paying for a new generation.
 *
 * When the provider is not configured or fails, the service returns a deterministic gradient
 * fallback with `fallback: true`. The interface can say that the model is unavailable without
 * breaking the flyer flow.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Jimp } from 'jimp';

import { BACKGROUND_STYLES } from '../../modules/policy/design-suggestions.js';

export const BACKGROUND_MOTIFS = Object.freeze([
  {
    id: 'botanical',
    label: 'botanical garden',
    prompt:
      'a lush botanical garden with blooming flowers, layered leaves, soft sunlight and delicate shadows'
  },
  {
    id: 'village',
    label: 'Mediterranean village',
    prompt:
      'a charming hillside village with small houses, terracotta roofs, olive trees and warm late-afternoon light'
  },
  {
    id: 'chapel',
    label: 'chapel on a hill',
    prompt:
      'a small white chapel with a steeple on a green hill, cypress trees, a winding path and a soft sky'
  },
  {
    id: 'meadow',
    label: 'wildflower meadow',
    prompt:
      'a wildflower meadow with poppies, daisies, tall grass and butterflies under a pastel sky'
  },
  {
    id: 'arches',
    label: 'garden arches',
    prompt:
      'sunlit stone arches covered with climbing plants and hanging flowers in a quiet courtyard'
  }
]);

function round(value) {
  return Math.round(value);
}

function hexToRgb(hex) {
  const raw = String(hex).replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((character) => character + character).join('') : raw;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16)
  };
}

function mix(hex, target, ratio) {
  const from = hexToRgb(hex);
  const to = hexToRgb(target);
  const channel = (value) => Math.max(0, Math.min(255, round(value))).toString(16).padStart(2, '0');
  return `#${channel(from.r + (to.r - from.r) * ratio)}${channel(from.g + (to.g - from.g) * ratio)}${channel(from.b + (to.b - from.b) * ratio)}`;
}

/**
 * krea/k3-edit is an image-to-image model: it needs at least one reference image. The reference
 * is a deliberately plain, soft colour field with a light source and a horizon. The prompt asks
 * the model to replace it with the detailed scene; the reference is never shown to the user.
 */
function buildReference({ primary, support }) {
  const width = 512;
  const height = 640;
  const image = new Jimp({ width, height, color: 0xffffffff });
  const data = image.bitmap.data;
  const top = hexToRgb(mix(primary.hex, '#ffffff', 0.7));
  const bottom = hexToRgb(mix(support[0].hex, '#000000', 0.18));
  const glow = hexToRgb(mix(support[1].hex, '#ffffff', 0.55));
  const sunX = width * 0.72;
  const sunY = height * 0.24;
  const sunRadius = width * 0.24;
  const horizon = height * 0.62;

  for (let y = 0; y < height; y += 1) {
    const depth = y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      let r = top.r + (bottom.r - top.r) * depth;
      let g = top.g + (bottom.g - top.g) * depth;
      let b = top.b + (bottom.b - top.b) * depth;

      if (y > horizon) {
        const fold = (y - horizon) / (height - horizon);
        r += (bottom.r - r) * fold * 0.25;
        g += (bottom.g - g) * fold * 0.25;
        b += (bottom.b - b) * fold * 0.25;
      }

      const distance = Math.hypot(x - sunX, y - sunY);
      if (distance < sunRadius) {
        const light = (1 - distance / sunRadius) * 0.58;
        r += (glow.r - r) * light;
        g += (glow.g - g) * light;
        b += (glow.b - b) * light;
      }

      data[index] = Math.round(r);
      data[index + 1] = Math.round(g);
      data[index + 2] = Math.round(b);
      data[index + 3] = 255;
    }
  }

  return image.getBuffer('image/png').then((buffer) => `data:image/png;base64,${buffer.toString('base64')}`);
}

function orientationFor(width, height) {
  const ratio = width / height;
  if (ratio >= 1.6) return 'wide panoramic composition';
  if (ratio <= 0.95) return 'vertical portrait composition';
  return 'square composition';
}

function buildPrompt({ motif, colour, support, design }) {
  const palette = [colour, ...support]
    .map((entry) => `${entry.colour_name} (${entry.hex})`)
    .join(', ');
  return (
    `Edit the attached plain reference into a beautiful background for a ${design.label}. ` +
    `Replace the flat colour field with ${motif.prompt}. ` +
    `Use the colour palette ${palette}. ${orientationFor(design.width, design.height)}. ` +
    'Keep the lower third quiet for a headline and a short line of text. Rich detail, soft natural light, ' +
    'premium editorial art direction, no text, no letters, no logo, no watermark, no people, no border, no frame. ' +
    'Do not return the plain reference: make the scene detailed and finished.'
  );
}

function cacheKey(model, prompt, paletteKey) {
  return crypto
    .createHash('sha256')
    .update(`${model}\n${prompt}\n${paletteKey}`)
    .digest('hex')
    .slice(0, 32);
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

const THUMBNAIL_WIDTH = 360;

/**
 * The flyer response carries five suggestion thumbnails, not five full-size JPEGs: the full
 * images stay in the cache and are fetched by id when the user chooses one. This keeps the
 * JSON well below the serverless response limit.
 */
async function thumbnailFor(imageDataUrl) {
  if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) return null;
  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.*)$/s.exec(imageDataUrl);
  if (match === null) return null;
  try {
    const image = await Jimp.read(Buffer.from(match[1], 'base64'));
    if (image.bitmap.width > THUMBNAIL_WIDTH) image.resize({ w: THUMBNAIL_WIDTH });
    const jpeg = await image.getBuffer('image/jpeg', { quality: 80 });
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * @param {object} options
 * @param {object} options.generator the OpenRouter client
 * @param {object} options.images the image service (prepare)
 * @param {object} options.meanings the colour meaning index
 * @param {string} options.cacheDir
 */
export function createBackgroundImageService({ generator, images, meanings, cacheDir } = {}) {
  if (!generator || typeof generator.generate !== 'function') {
    throw new TypeError('The background service needs an image generator.');
  }
  if (!images || typeof images.prepare !== 'function') {
    throw new TypeError('The background service needs the image service.');
  }
  if (!meanings || typeof meanings.representationFor !== 'function') {
    throw new TypeError('The background service needs the colour meaning index.');
  }
  if (typeof cacheDir !== 'string' || cacheDir.trim() === '') {
    throw new TypeError('The background service needs a cache directory.');
  }

  const memory = new Map();
  const references = new Map();
  let ready = null;

  function referenceFor(palette) {
    const key = `${palette.primary.hex}|${palette.support[0].hex}|${palette.support[1].hex}`;
    if (!references.has(key)) references.set(key, buildReference(palette));
    return references.get(key);
  }

  function ensureDirectory() {
    ready ??= fs.mkdir(cacheDir, { recursive: true });
    return ready;
  }

  function fileFor(id) {
    return path.join(cacheDir, `${id}.json`);
  }

  async function readCache(id) {
    if (memory.has(id)) return memory.get(id);
    try {
      const raw = await fs.readFile(fileFor(id), 'utf8');
      const parsed = JSON.parse(raw);
      if (typeof parsed?.image === 'string' && parsed.image.startsWith('data:image/')) {
        memory.set(id, parsed);
        return parsed;
      }
    } catch {
      /* miss */
    }
    return null;
  }

  async function writeCache(record) {
    memory.set(record.id, record);
    await ensureDirectory();
    await fs.writeFile(fileFor(record.id), JSON.stringify(record), 'utf8');
  }

  function paletteFor(colourName, index) {
    const primary = meanings.representationFor(colourName);
    if (primary === null) throw new RangeError(`Unknown colour ${JSON.stringify(colourName)}.`);
    const five = meanings.encouraged;
    const chosenIndex = Math.max(0, five.findIndex((entry) => entry.colour_name === primary.colour_name));
    const supportA = five[(chosenIndex + 1 + index) % five.length];
    const supportB = five[(chosenIndex + 3 + index) % five.length];
    return { primary, support: [supportA, supportB] };
  }

  function fallbackFor({ motif, design, palette, index, error }) {
    const style = BACKGROUND_STYLES[index % BACKGROUND_STYLES.length];
    const key = `fallback-${motif.id}-${index}`;
    const built = style.build({
      width: design.width,
      height: design.height,
      colours: [palette.primary.hex, palette.support[0].hex, palette.support[1].hex],
      key
    });
    return {
      id: `fallback-${motif.id}-${index}`,
      label: motif.label,
      motif: motif.id,
      prompt: null,
      image: null,
      thumbnail: null,
      svg: built.svg,
      css: built.css,
      width: design.width,
      height: design.height,
      fallback: true,
      error: error ?? null
    };
  }

  /**
   * @param {{colourName: string, design: {label: string, width: number, height: number}, count?: number}} input
   */
  async function generate({ colourName, design, count = 5 } = {}) {
    if (!design || !Number.isInteger(design.width) || !Number.isInteger(design.height)) {
      throw new TypeError('The background service needs a design with width and height.');
    }
    const requested = Math.max(1, Math.min(BACKGROUND_MOTIFS.length, Number.isInteger(count) ? count : 5));
    const jobs = await Promise.all(
      Array.from({ length: requested }, async (_, index) => {
        const motif = BACKGROUND_MOTIFS[index % BACKGROUND_MOTIFS.length];
        const palette = paletteFor(colourName, index);
        const prompt = buildPrompt({ motif, colour: palette.primary, support: palette.support, design });
        const reference = await referenceFor(palette);
        const paletteKey = [palette.primary.hex, ...palette.support.map((entry) => entry.hex)].join('|');
        return { index, motif, palette, prompt, reference, id: cacheKey(generator.model, prompt, paletteKey) };
      })
    );

    const results = await mapLimit(jobs, 2, async (job) => {
      const cached = await readCache(job.id);
      if (cached !== null) {
        let thumbnail = cached.thumbnail ?? null;
        if (thumbnail === null && typeof cached.image === 'string') {
          thumbnail = await thumbnailFor(cached.image);
          if (thumbnail !== null) {
            await writeCache({ ...cached, thumbnail });
          }
        }
        return { ...cached, thumbnail, label: job.motif.label, motif: job.motif.id, fallback: false };
      }
      if (!generator.configured) {
        return fallbackFor({
          motif: job.motif,
          design,
          palette: job.palette,
          index: job.index,
          error: 'image_not_configured'
        });
      }
      try {
        const generated = await generator.generate({
          prompt: job.prompt,
          references: [{ type: 'image_url', image_url: { url: job.reference } }]
        });
        const prepared = await images.prepare({ image: generated.image, maxWidth: 1400 });
        const record = {
          id: job.id,
          label: job.motif.label,
          motif: job.motif.id,
          prompt: job.prompt,
          image: prepared.image,
          thumbnail: await thumbnailFor(prepared.image),
          width: prepared.width,
          height: prepared.height,
          bytes: prepared.bytes,
          created_at: new Date().toISOString()
        };
        await writeCache(record);
        return { ...record, fallback: false };
      } catch (error) {
        return fallbackFor({
          motif: job.motif,
          design,
          palette: job.palette,
          index: job.index,
          error: error?.code ?? 'image_failed'
        });
      }
    });

    const generated = results.filter((entry) => entry.fallback !== true).length;
    const notes = [];
    if (!generator.configured) {
      notes.push(
        'The image model is not configured: add OPENROUTER_API_KEY to the server environment to generate the backgrounds. The gradients below are the fallback.'
      );
    } else if (generated === 0) {
      notes.push('The image model did not return an image; the gradients below are the fallback.');
    } else if (generated < results.length) {
      notes.push(`${results.length - generated} background(s) fell back to a gradient because the image model failed.`);
    }

    return {
      provider: generator.provider ?? 'openrouter',
      model: generator.model ?? null,
      configured: generator.configured === true,
      generated,
      fallback: results.length - generated,
      images: results,
      notes
    };
  }

  async function get(id) {
    if (typeof id !== 'string' || id === '') return null;
    return readCache(id);
  }

  return Object.freeze({
    generate,
    get,
    motifs: BACKGROUND_MOTIFS,
    configured: generator.configured === true,
    model: generator.model ?? null,
    provider: generator.provider ?? 'openrouter'
  });
}
