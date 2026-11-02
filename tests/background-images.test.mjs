/**
 * Background image service.
 *
 * The network is never used here: a mock generator returns a real, tiny PNG, so the test covers
 * the prompt, the JPEG preparation, the cache and the fallback without an API key.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Jimp } from 'jimp';

import { loadStandards } from '../backend/standards-loader.js';
import { createImageService } from '../backend/services/image-service.js';
import { createBackgroundImageService } from '../backend/services/background-image-service.js';
import { createMeaningIndex } from '../modules/meaning/colour-meanings.js';
import { PALETTE } from '../modules/color_engine/palette.js';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..');

function makeImageService() {
  return createImageService({ maxBytes: 8 * 1024 * 1024, maxDimension: 8000, maxPixels: 40_000_000 });
}

function makeMeanings() {
  const standards = loadStandards({ directory: path.join(REPOSITORY_ROOT, 'standards') });
  return createMeaningIndex(standards.meanings, { palette: PALETTE });
}

async function imageDataUrl() {
  const image = new Jimp({ width: 8, height: 8, color: 0x336699ff });
  const buffer = await image.getBuffer('image/png');
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function makeGenerator({ configured = true, fail = false } = {}) {
  let calls = 0;
  let lastReferences = null;
  return {
    configured,
    provider: 'openrouter',
    model: 'mock-model',
    calls: () => calls,
    references: () => lastReferences,
    async generate({ prompt, references = [] }) {
      calls += 1;
      lastReferences = references;
      if (fail) {
        const error = new Error('provider unavailable');
        error.code = 'image_provider_error';
        throw error;
      }
      return { image: await imageDataUrl(), model: 'mock-model', prompt };
    }
  };
}

test('the background service generates, prepares and caches one image per motif', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatmt-backgrounds-'));
  const generator = makeGenerator();
  const service = createBackgroundImageService({
    generator,
    images: makeImageService(),
    meanings: makeMeanings(),
    cacheDir
  });

  const first = await service.generate({
    colourName: 'green',
    design: { label: 'flyer', width: 1080, height: 1350 },
    count: 2
  });
  assert.equal(first.images.length, 2);
  assert.equal(first.generated, 2);
  assert.equal(first.fallback, 0);
  assert.equal(first.configured, true);
  assert.match(first.images[0].image, /^data:image\/jpeg;base64,/);
  assert.match(first.images[0].thumbnail, /^data:image\/jpeg;base64,/);
  assert.match(first.images[0].prompt, /green \(#008000\)/);
  assert.match(first.images[0].prompt, /no text/i);
  assert.equal(first.images[0].motif, 'botanical');
  assert.equal(first.images[1].motif, 'village');
  assert.equal(generator.references().length, 1);
  assert.match(generator.references()[0].image_url.url, /^data:image\/png;base64,/);

  const callsAfterFirst = generator.calls();
  const second = await service.generate({
    colourName: 'green',
    design: { label: 'flyer', width: 1080, height: 1350 },
    count: 2
  });
  assert.equal(generator.calls(), callsAfterFirst, 'the cache avoids a second generation');
  assert.equal(second.images[0].id, first.images[0].id);
  assert.equal(second.images[0].thumbnail, first.images[0].thumbnail);
  assert.match(second.images[0].thumbnail, /^data:image\/jpeg;base64,/);

  const cached = await service.get(first.images[0].id);
  assert.equal(cached.image, first.images[0].image);
  assert.equal(cached.thumbnail, first.images[0].thumbnail);

  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test('the background service falls back to a gradient when the model is not configured', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatmt-backgrounds-'));
  const service = createBackgroundImageService({
    generator: makeGenerator({ configured: false }),
    images: makeImageService(),
    meanings: makeMeanings(),
    cacheDir
  });

  const result = await service.generate({
    colourName: 'blue',
    design: { label: 'flyer', width: 1080, height: 1350 },
    count: 2
  });
  assert.equal(result.generated, 0);
  assert.equal(result.fallback, 2);
  assert.equal(result.images[0].image, null);
  assert.equal(result.images[0].fallback, true);
  assert.match(result.images[0].svg, /^<svg /);
  assert.ok(result.notes.some((line) => /OPENROUTER_API_KEY/.test(line)));

  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test('a provider failure is isolated to the affected background', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatmt-backgrounds-'));
  let calls = 0;
  const generator = {
    configured: true,
    provider: 'openrouter',
    model: 'mock-model',
    async generate({ prompt }) {
      calls += 1;
      if (calls === 1) {
        const error = new Error('temporary failure');
        error.code = 'image_provider_error';
        throw error;
      }
      return { image: await imageDataUrl(), model: 'mock-model', prompt };
    }
  };
  const service = createBackgroundImageService({
    generator,
    images: makeImageService(),
    meanings: makeMeanings(),
    cacheDir
  });

  const result = await service.generate({
    colourName: 'orange',
    design: { label: 'flyer', width: 1080, height: 1350 },
    count: 2
  });
  assert.equal(result.images.length, 2);
  assert.equal(result.generated, 1);
  assert.equal(result.fallback, 1);
  assert.equal(result.images.filter((image) => image.fallback === true).length, 1);
  assert.equal(result.images.filter((image) => image.fallback === false).length, 1);
  assert.ok(result.notes.some((line) => /fell back/.test(line)));

  fs.rmSync(cacheDir, { recursive: true, force: true });
});
