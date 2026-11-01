/**
 * Backend integration tests.
 *
 * A real HTTP server is started on port 0 (a port chosen by the system) with a temporary data
 * directory. Every request goes through fetch, so routing, validation, error mapping, memory
 * on disk and image processing are exercised the way a client will use them.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp } from 'jimp';

import { loadConfig } from '../backend/config.js';
import { createServer } from '../backend/server.js';
import { loadStandards } from '../backend/standards-loader.js';
import { createInteractionService } from '../backend/services/interaction-service.js';
import { createComposeService } from '../backend/services/compose-service.js';
import { createCutoutService } from '../backend/services/cutout-service.js';
import { inferDesignType } from '../backend/services/flyer-service.js';
import { createLlmClassifier, LlmError } from '../backend/llm-classifier.js';
import { loadEnvFile, parseEnvFile } from '../backend/env-file.js';
import { MemoryStore, createVolatileAdapter } from '../modules/memory/memory-store.js';
import { PALETTE } from '../modules/color_engine/palette.js';
import { createMeaningIndex } from '../modules/meaning/colour-meanings.js';
import { createDefaultStanding } from '../modules/policy/standing-engine.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MEANINGS_DIRECTORY = path.join(REPOSITORY_ROOT, 'standards');

let server;
let base;
let dataDir;
let config;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatmt-backend-'));
  config = loadConfig({
    CHATMT_DATA_DIR: dataDir,
    CHATMT_IMAGE_CACHE_DIR: path.join(dataDir, 'background-cache'),
    PORT: '0',
    CHATMT_LLM_API_BASE: '',
    CHATMT_LLM_API_KEY: '',
    OPENROUTER_API_KEY: ''
  });
  server = createServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function api(pathname, { method = 'GET', body, rawBody } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text === '' ? null : JSON.parse(text)
  };
}

async function imageDataUrl(format = 'png', width = 20, height = 10) {
  const image = new Jimp({ width, height, color: 0xff0000ff });
  const buffer = await image.getBuffer(`image/${format}`);
  return `data:image/${format};base64,${buffer.toString('base64')}`;
}

test('health, standards, palette and meanings are exposed', async () => {
  const health = await api('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.equal(health.body.standards.usage.id, 'usage-of-colours');
  assert.equal(health.body.standards.meanings.id, 'colour-meanings');
  assert.equal(health.body.llm.configured, false);
  assert.equal(health.body.imageGeneration.configured, false);
  assert.equal(health.body.storage.type, 'json-file');

  const meanings = await api('/api/meanings');
  assert.equal(meanings.status, 200);
  assert.deepEqual(
    meanings.body.encouraged.map((entry) => entry.colour_name),
    ['green', 'blue', 'orange', 'indigo', 'violet']
  );
  assert.deepEqual(meanings.body.questioned.map((entry) => entry.colour_name), ['red', 'yellow']);
  assert.match(meanings.body.biasExplanation, /danger or royalty/);
  assert.match(meanings.body.biasExplanation, /anger or determination/);
  assert.ok(meanings.body.noMeaningRecorded.some((entry) => entry.name === 'lime'));
  assert.equal(meanings.body.noMeaningRecorded.some((entry) => entry.name === 'magenta'), false);
  assert.ok(meanings.body.policies.length >= 8);
  assert.equal(meanings.body.assistance.reduced.delay_ms, 900);
  assert.equal(meanings.body.assistance.reduced.suggestion_limit, 2);
  assert.deepEqual(
    meanings.body.equivalent.map((entry) => `${entry.colour_name}:${entry.same_as}`),
    ['magenta:indigo', 'purple:violet']
  );
  assert.equal(meanings.body.backgrounds.choice, 'user');

  const palette = await api('/api/palette');
  assert.equal(palette.status, 200);
  assert.equal(palette.body.colours.length, 15);
  const green = palette.body.colours.find((entry) => entry.name === 'green');
  assert.equal(green.encouraged, true);
  assert.deepEqual(green.meanings, ['prosperity and peace']);
  const magenta = palette.body.colours.find((entry) => entry.name === 'magenta');
  assert.deepEqual(magenta.meanings, ['victory']);
  assert.equal(magenta.encouraged, true);
  assert.equal(magenta.equivalent, true);
  assert.equal(magenta.same_as, 'indigo');

  const types = await api('/api/design/types');
  assert.equal(types.status, 200);
  assert.deepEqual(
    types.body.types.map((entry) => entry.id),
    ['flyer', 'poster', 'social_post', 'banner', 'background']
  );
});

test('choosing green gives a friendly profile with five five-colour suggestions', async () => {
  const response = await api('/api/interactions', {
    method: 'POST',
    body: {
      userId: 'green-user',
      colour: { name: 'green' },
      consent: true,
      design: { type: 'flyer', subject: 'Community market' }
    }
  });

  assert.equal(response.status, 200);
  assert.match(response.body.answer.headline, /colour-green/);
  assert.equal(response.body.profile.level, 'friendly');
  assert.equal(response.body.profile.suggestion_limit, 5);
  assert.equal(response.body.profile.display_delay_ms, 0);
  assert.equal(response.body.profile.decision.verdict, 'encouraged');
  assert.equal(typeof response.body.stored.standingRecordId, 'string');
  assert.equal(response.body.designSuggestions.suggestions.length, 5);
  assert.equal(response.body.designSuggestions.assistance.withheld.length, 1);
  assert.equal(typeof response.body.stored.preferenceId, 'string');
  assert.match(response.body.answer.policyNotice, /prosperity and peace/);
  assert.match(response.body.answer.policyNotice, /friendly/);

  for (const suggestion of response.body.designSuggestions.suggestions) {
    for (const entry of suggestion.palette) {
      assert.ok(['green', 'blue', 'orange', 'indigo', 'violet'].includes(entry.colour_name));
    }
  }

  const memory = await api('/api/users/green-user/memory');
  assert.equal(memory.body.count, 2);
  const preference = memory.body.records.find((record) => record.category === 'preference');
  assert.equal(preference.content.reason, null);
  assert.ok(memory.body.records.some((record) => record.category === 'interaction'));
  assert.equal(memory.body.profile.level, 'friendly');
});

test('red without a reason asks the question, stores the profile as not friendly and not the preference', async () => {
  const response = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'question-user', colour: { name: 'red' }, consent: true }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.answer.question, 'Why did you choose Red?');
  assert.equal(response.body.answer.needsClarification, true);
  assert.equal(response.body.answer.storage.permitted, false);
  assert.equal(response.body.answer.storage.stored, false);
  assert.equal(response.body.answer.storage.requiresQuestionAnswer, true);
  assert.equal(response.body.reasonAssessment.verdict, 'personal');
  assert.equal(response.body.reasonAssessment.reason_present, false);
  assert.equal(response.body.stored.preferenceId, null);
  assert.equal(typeof response.body.stored.standingRecordId, 'string');
  assert.equal(response.body.profile.level, 'not_friendly');
  assert.equal(response.body.profile.decision.verdict, 'absent');
  assert.equal(response.body.profile.display_delay_ms, 900);
  assert.equal(response.body.display.delay_ms, 900);
  assert.equal(response.body.designSuggestions.suggestions.length, 2);
  assert.match(response.body.answer.policyNotice, /absent reason is personal/);

  const memory = await api('/api/users/question-user/memory');
  assert.equal(memory.body.count, 2, 'the profile and the assessment, not the preference');
  assert.equal(memory.body.records.some((record) => record.category === 'preference'), false);
  const standing = await api('/api/users/question-user/standing');
  assert.equal(standing.body.hasStoredProfile, true);
  assert.equal(standing.body.profile.level, 'not_friendly');
  assert.equal(standing.body.pendingMessages.length, 2);
});

test('a personal reason stores a not friendly profile, then displeasure and the explanation arrive once', async () => {
  const first = await api('/api/interactions', {
    method: 'POST',
    body: {
      userId: 'personal-user',
      colour: { name: 'red' },
      reason: 'I just like it, it is my favourite colour',
      consent: true,
      design: { type: 'flyer' }
    }
  });

  assert.equal(first.status, 200);
  assert.equal(first.body.reasonAssessment.verdict, 'personal');
  assert.equal(first.body.reasonAssessment.method, 'rules');
  assert.equal(first.body.profile.level, 'not_friendly');
  assert.equal(first.body.profile.suggestion_limit, 2);
  assert.equal(first.body.designSuggestions.suggestions.length, 2);
  assert.equal(first.body.standingMessages.length, 0, 'the displeasure is due at the next interaction');
  assert.equal(typeof first.body.stored.preferenceId, 'string');
  assert.equal(typeof first.body.stored.standingRecordId, 'string');
  assert.equal(typeof first.body.stored.assessmentRecordId, 'string');
  assert.match(first.body.answer.policyNotice, /not friendly/);

  const memory = await api('/api/users/personal-user/memory');
  assert.equal(memory.body.count, 3);
  assert.deepEqual(
    new Set(memory.body.records.map((record) => record.category)),
    new Set(['preference', 'interaction', 'knowledge'])
  );
  const preference = memory.body.records.find((record) => record.category === 'preference');
  assert.equal(preference.content.reason, 'I just like it, it is my favourite colour');

  const preview = await api('/api/users/personal-user/standing');
  assert.equal(preview.body.profile.level, 'not_friendly');
  assert.equal(preview.body.pendingMessages.length, 2);
  assert.equal(preview.body.pendingMessages[0].code, 'personal-reason-displeasure');

  const second = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'personal-user', colour: { name: 'blue' }, consent: false }
  });

  assert.equal(second.status, 200);
  assert.equal(second.body.standingMessages.length, 2);
  assert.equal(second.body.standingMessages[0].code, 'personal-reason-displeasure');
  assert.equal(second.body.standingMessages[1].code, 'reduced-assistance-explanation');
  assert.match(second.body.standingMessages[0].text, /not pleased/);
  assert.match(second.body.standingMessages[1].text, /previous interaction/);
  assert.equal(second.body.profile.level, 'not_friendly');
  assert.equal(second.body.designSuggestions.suggestions.length, 2);
  assert.equal(second.body.stored.preferenceId, null, 'consent was not given');
  assert.equal(second.body.stored.standingRecordId, null);

  const third = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'personal-user', colour: { name: 'blue' }, consent: false }
  });
  assert.equal(third.body.standingMessages.length, 0, 'the messages must not repeat');

  const afterDelivery = await api('/api/users/personal-user/standing');
  assert.equal(afterDelivery.body.pendingMessages.length, 0);
  assert.equal(afterDelivery.body.profile.level, 'not_friendly');
});

test('the profile survives a new server instance on the same data directory', async () => {
  const secondServer = createServer(config);
  await new Promise((resolve) => secondServer.listen(0, '127.0.0.1', resolve));
  const secondBase = `http://127.0.0.1:${secondServer.address().port}`;
  try {
    const response = await fetch(`${secondBase}/api/users/personal-user/standing`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.hasStoredProfile, true);
    assert.equal(body.profile.level, 'not_friendly');
    assert.equal(body.profile.last_decision.verdict, 'personal');
  } finally {
    await new Promise((resolve) => secondServer.close(resolve));
  }
});

test('a cogent reason keeps the friendly tone and unlocks a red accent', async () => {
  const response = await api('/api/interactions', {
    method: 'POST',
    body: {
      userId: 'cogent-user',
      colour: { name: 'red' },
      reason: 'Red is our brand identity and it signals danger on the warning label',
      consent: true,
      design: { type: 'flyer' }
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.reasonAssessment.verdict, 'cogent');
  assert.equal(response.body.profile.level, 'friendly');
  assert.equal(response.body.profile.allow_questioned_colours, true);
  assert.equal(response.body.profile.suggestion_limit, 5);
  assert.equal(response.body.designSuggestions.suggestions.length, 5);
  assert.equal(response.body.designSuggestions.assistance.withheld.length, 0);
  assert.match(response.body.designSuggestions.assistance.note, /accent is allowed/);
  assert.match(response.body.answer.policyNotice, /friendly tone/);

  const last = response.body.designSuggestions.suggestions.at(-1);
  const accent = last.palette.find((entry) => entry.role === 'accent');
  assert.ok(accent);
  assert.ok(['red', 'yellow'].includes(accent.colour_name));
});

test('an ambiguous reason is stored nowhere and no profile is invented', async () => {
  const response = await api('/api/interactions', {
    method: 'POST',
    body: {
      userId: 'ambiguous-user',
      colour: { name: 'yellow' },
      reason: 'It is a strong colour',
      consent: true
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.reasonAssessment.verdict, 'needs_review');
  assert.equal(response.body.reasonAssessment.llm.status, 'not_configured');
  assert.equal(response.body.answer.storage.permitted, false);
  assert.equal(response.body.stored.preferenceId, null);
  assert.equal(response.body.profile.level, 'friendly');
  assert.match(response.body.answer.policyNotice, /undecided/);

  const memory = await api('/api/users/ambiguous-user/memory');
  assert.equal(memory.body.count, 0);
});

test('the LLM is used only for an ambiguous reason that the rules cannot decide', async () => {
  const standards = loadStandards({ directory: MEANINGS_DIRECTORY });
  let calls = 0;
  const llm = {
    configured: true,
    async classify({ colourName }) {
      calls += 1;
      return {
        colour_name: colourName,
        reason_present: true,
        verdict: 'personal',
        confidence: 0.81,
        method: 'llm',
        scores: null,
        matched: [],
        explanation: ['The rules could not decide; the model classified it as personal.']
      };
    }
  };
  const service = createInteractionService({
    standards: standards.usage,
    meaningStandard: standards.meanings,
    palette: PALETTE,
    storeFactory: (userId) => new MemoryStore({ adapter: createVolatileAdapter(), userId }),
    llm
  });

  const result = await service.interact({
    userId: 'hybrid-user',
    colour: { name: 'red' },
    reason: 'It is a strong colour',
    consent: true
  });
  assert.equal(calls, 1);
  assert.equal(result.reasonAssessment.method, 'llm');
  assert.equal(result.reasonAssessment.verdict, 'personal');
  assert.equal(result.profile.level, 'not_friendly');
  assert.equal(result.profile.decision.applied, true);
});

test('a failing LLM leaves the reason undecided instead of guessing', async () => {
  const standards = loadStandards({ directory: MEANINGS_DIRECTORY });
  const service = createInteractionService({
    standards: standards.usage,
    meaningStandard: standards.meanings,
    palette: PALETTE,
    storeFactory: (userId) => new MemoryStore({ adapter: createVolatileAdapter(), userId }),
    llm: {
      configured: true,
      async classify() {
        throw new LlmError('llm_timeout', 'timed out');
      }
    }
  });

  const result = await service.interact({
    userId: 'llm-failure-user',
    colour: { name: 'red' },
    reason: 'It is a strong colour',
    consent: true
  });
  assert.equal(result.reasonAssessment.verdict, 'needs_review');
  assert.equal(result.reasonAssessment.llm.status, 'failed');
  assert.equal(result.reasonAssessment.llm.code, 'llm_timeout');
  assert.equal(result.stored.preferenceId, null);
});

test('a low-confidence LLM verdict is left undecided', async () => {
  const standards = loadStandards({ directory: MEANINGS_DIRECTORY });
  const service = createInteractionService({
    standards: standards.usage,
    meaningStandard: standards.meanings,
    palette: PALETTE,
    storeFactory: (userId) => new MemoryStore({ adapter: createVolatileAdapter(), userId }),
    llm: {
      configured: true,
      async classify({ colourName }) {
        return {
          colour_name: colourName,
          reason_present: true,
          verdict: 'personal',
          confidence: 0.2,
          method: 'llm',
          scores: null,
          matched: [],
          explanation: []
        };
      }
    }
  });

  const result = await service.interact({
    userId: 'low-confidence-user',
    colour: { name: 'yellow' },
    reason: 'It is a strong colour',
    consent: true
  });
  assert.equal(result.reasonAssessment.verdict, 'needs_review');
  assert.equal(result.reasonAssessment.llm.status, 'low_confidence');
  assert.equal(result.stored.preferenceId, null);
  assert.equal(result.profile.level, 'friendly');
});

test('design suggestions are fewer for the not friendly profile and five for the cogent one', async () => {
  const reduced = await api('/api/design/suggestions', {
    method: 'POST',
    body: { userId: 'personal-user', colour: { name: 'green' }, design: { type: 'flyer' } }
  });
  assert.equal(reduced.status, 200);
  assert.equal(reduced.body.profile.level, 'not_friendly');
  assert.equal(reduced.body.designSuggestions.suggestions.length, 2);
  assert.match(reduced.body.designSuggestions.assistance.note, /Reduced assistance/);

  const extended = await api('/api/design/suggestions', {
    method: 'POST',
    body: { userId: 'cogent-user', colour: { name: 'green' }, design: { type: 'poster' } }
  });
  assert.equal(extended.status, 200);
  assert.equal(extended.body.profile.level, 'friendly');
  assert.equal(extended.body.designSuggestions.suggestions.length, 5);

  const invalid = await api('/api/design/suggestions', {
    method: 'POST',
    body: { userId: 'cogent-user', colour: { name: 'green' }, design: { type: 't-shirt' } }
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'invalid_request');
});

test('crop, resize, rotate and format conversion work on a real image', async () => {
  const image = await imageDataUrl('png', 20, 10);

  const cropped = await api('/api/design/transform', {
    method: 'POST',
    body: { image, operations: [{ type: 'crop', x: 1, y: 1, width: 4, height: 6 }] }
  });
  assert.equal(cropped.status, 200);
  assert.equal(cropped.body.width, 4);
  assert.equal(cropped.body.height, 6);
  assert.equal(cropped.body.format, 'png');
  assert.equal(cropped.body.mime, 'image/png');
  assert.equal(cropped.body.source.format, 'png');
  const croppedImage = await Jimp.read(Buffer.from(cropped.body.image.split(',')[1], 'base64'));
  assert.equal(croppedImage.bitmap.width, 4);
  assert.equal(croppedImage.bitmap.height, 6);

  const resized = await api('/api/design/transform', {
    method: 'POST',
    body: { image, operations: [{ type: 'resize', width: 10 }] }
  });
  assert.equal(resized.status, 200);
  assert.equal(resized.body.width, 10);
  assert.equal(resized.body.height, 5, 'the aspect ratio is preserved');

  const rotated = await api('/api/design/transform', {
    method: 'POST',
    body: { image, operations: [{ type: 'rotate', degrees: 90 }] }
  });
  assert.equal(rotated.status, 200);
  assert.equal(rotated.body.width, 10);
  assert.equal(rotated.body.height, 20);

  const converted = await api('/api/design/transform', {
    method: 'POST',
    body: { image, format: 'jpeg' }
  });
  assert.equal(converted.status, 200);
  assert.equal(converted.body.format, 'jpeg');
  assert.equal(converted.body.mime, 'image/jpeg');
  assert.match(converted.body.image, /^data:image\/jpeg;base64,/);

  const fromJpeg = await api('/api/design/transform', {
    method: 'POST',
    body: { image: await imageDataUrl('jpeg'), operations: [{ type: 'rotate', degrees: 180 }] }
  });
  assert.equal(fromJpeg.status, 200);
  assert.equal(fromJpeg.body.source.format, 'jpeg');
  assert.equal(fromJpeg.body.width, 20);
  assert.equal(fromJpeg.body.height, 10);

  const toBmp = await api('/api/design/transform', {
    method: 'POST',
    body: { image, format: 'bmp' }
  });
  assert.equal(toBmp.status, 200);
  assert.equal(toBmp.body.format, 'bmp');
  assert.equal(toBmp.body.mime, 'image/bmp');
  const bmpImage = await Jimp.read(Buffer.from(toBmp.body.image.split(',')[1], 'base64'));
  assert.equal(bmpImage.bitmap.width, 20);
  assert.equal(bmpImage.bitmap.height, 10);
});

test('invalid image requests are refused with specific errors', async () => {
  const image = await imageDataUrl('png', 20, 10);

  const outOfBounds = await api('/api/design/transform', {
    method: 'POST',
    body: { image, operations: [{ type: 'crop', x: 18, y: 0, width: 4, height: 4 }] }
  });
  assert.equal(outOfBounds.status, 400);
  assert.equal(outOfBounds.body.error.code, 'crop_out_of_bounds');

  const undecodable = await api('/api/design/transform', {
    method: 'POST',
    body: { image: Buffer.from('not an image').toString('base64'), format: 'png' }
  });
  assert.equal(undecodable.status, 400);
  assert.equal(undecodable.body.error.code, 'invalid_image');

  const gifHeader = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)]);
  const gif = await api('/api/design/transform', {
    method: 'POST',
    body: { image: gifHeader.toString('base64'), format: 'png' }
  });
  assert.equal(gif.status, 400);
  assert.equal(gif.body.error.code, 'invalid_image');

  const nothing = await api('/api/design/transform', { method: 'POST', body: { image } });
  assert.equal(nothing.status, 400);
  assert.equal(nothing.body.error.code, 'invalid_request');

  const badFormat = await api('/api/design/transform', {
    method: 'POST',
    body: { image, format: 'webp' }
  });
  assert.equal(badFormat.status, 400);
  assert.equal(badFormat.body.error.code, 'invalid_format');

  const unknownOperation = await api('/api/design/transform', {
    method: 'POST',
    body: { image, operations: [{ type: 'blur', radius: 3 }] }
  });
  assert.equal(unknownOperation.status, 400);
  assert.equal(unknownOperation.body.error.code, 'invalid_operation');

  const tooMany = await api('/api/design/transform', {
    method: 'POST',
    body: {
      image,
      operations: Array.from({ length: 11 }, () => ({ type: 'rotate', degrees: 90 }))
    }
  });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.body.error.code, 'too_many_operations');
});

test('memory can be written, read, corrected and deleted, and consent is enforced', async () => {
  const withoutConsent = await api('/api/users/crud-user/preferences', {
    method: 'POST',
    body: { colour: { name: 'blue' }, consent: false }
  });
  assert.equal(withoutConsent.status, 403);
  assert.equal(withoutConsent.body.error.code, 'consent_required');

  const missingConsent = await api('/api/users/crud-user/preferences', {
    method: 'POST',
    body: { colour: { name: 'blue' } }
  });
  assert.equal(missingConsent.status, 403);

  const preference = await api('/api/users/crud-user/preferences', {
    method: 'POST',
    body: { colour: { name: 'blue' }, consent: true }
  });
  assert.equal(preference.status, 200);
  assert.equal(preference.body.preference.category, 'preference');
  assert.equal(preference.body.preference.content.hex, '#0000FF');

  const correction = await api('/api/users/crud-user/corrections', {
    method: 'POST',
    body: { hex: '#0000FF', proposedOutcome: 'question', note: 'blue should be questioned', consent: true }
  });
  assert.equal(correction.status, 200);
  assert.equal(correction.body.correction.category, 'correction');

  const memory = await api('/api/users/crud-user/memory');
  // preference + the friendly profile written by savePreference + correction
  assert.equal(memory.body.count, 3);

  const recordId = preference.body.preference.id;
  const deleted = await api(`/api/users/crud-user/memory/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, true);

  const missing = await api('/api/users/crud-user/memory/does-not-exist', { method: 'DELETE' });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'record_not_found');

  const cleared = await api('/api/users/crud-user/memory', { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.deletedCount, 2);

  const empty = await api('/api/users/crud-user/memory');
  assert.equal(empty.body.count, 0);
  assert.equal(empty.body.profile.level, 'friendly');
});

test('request validation and routing errors are explicit', async () => {
  const unknownRoute = await api('/api/nope');
  assert.equal(unknownRoute.status, 404);
  assert.equal(unknownRoute.body.error.code, 'not_found');

  const wrongMethod = await api('/api/users/someone/standing', { method: 'POST', body: {} });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.error.code, 'method_not_allowed');
  assert.match(wrongMethod.headers.get('allow'), /GET/);

  const badUserId = await api('/api/users/bad%2Fid/standing');
  assert.equal(badUserId.status, 400);
  assert.equal(badUserId.body.error.code, 'invalid_user_id');

  const unknownColour = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'error-user', colour: { name: 'chartreuse' } }
  });
  assert.equal(unknownColour.status, 400);
  assert.equal(unknownColour.body.error.code, 'unknown_colour');

  const notInPalette = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'error-user', colour: { hex: '#123456' } }
  });
  assert.equal(notInPalette.status, 400);
  assert.equal(notInPalette.body.error.code, 'unknown_colour');

  const missingUser = await api('/api/interactions', {
    method: 'POST',
    body: { colour: { name: 'green' } }
  });
  assert.equal(missingUser.status, 400);
  assert.equal(missingUser.body.error.code, 'invalid_user_id');

  const invalidJson = await api('/api/interactions', { method: 'POST', rawBody: '{not json' });
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJson.body.error.code, 'invalid_json');

  const longReason = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'error-user', colour: { name: 'red' }, reason: 'x'.repeat(1001) }
  });
  assert.equal(longReason.status, 400);
  assert.equal(longReason.body.error.code, 'reason_too_long');
});

test('two users never share a profile or a preference', async () => {
  const alice = await api('/api/users/separated-alice/memory');
  const bob = await api('/api/users/separated-bob/memory');
  assert.equal(alice.body.count, 0);
  assert.equal(bob.body.count, 0);

  await api('/api/interactions', {
    method: 'POST',
    body: {
      userId: 'separated-alice',
      colour: { name: 'red' },
      reason: 'I just like it',
      consent: true
    }
  });

  const aliceAgain = await api('/api/users/separated-alice/standing');
  const bobAgain = await api('/api/users/separated-bob/standing');
  assert.equal(aliceAgain.body.profile.level, 'not_friendly');
  assert.equal(bobAgain.body.profile.level, 'friendly');
  assert.equal(bobAgain.body.hasStoredProfile, false);
});

test('choosing one of the encouraged colours restores a not friendly profile', async () => {
  const personal = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'restore-user', colour: { name: 'red' }, reason: 'I just like it', consent: true }
  });
  assert.equal(personal.body.profile.level, 'not_friendly');
  assert.equal(personal.body.profile.display_delay_ms, 900);

  const restored = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'restore-user', colour: { name: 'magenta' }, consent: true }
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.profile.level, 'friendly');
  assert.equal(restored.body.profile.display_delay_ms, 0);
  assert.equal(restored.body.profile.decision.verdict, 'encouraged');
  assert.equal(restored.body.designSuggestions.suggestions.length, 5);
  assert.match(restored.body.answer.policyNotice, /same meaning as indigo/);
  assert.equal(restored.body.standingMessages.length, 2, 'the displeasure scheduled before is still due');
});

test('the displeasure recurs after another personal choice of red or yellow', async () => {
  await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'recurring-user', colour: { name: 'red' }, reason: 'It is my favourite colour', consent: true }
  });

  const delivered = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'recurring-user', colour: { name: 'blue' }, consent: false }
  });
  assert.equal(delivered.body.standingMessages.length, 2);
  assert.equal(delivered.body.profile.level, 'not_friendly', 'without consent the friendly choice is not stored');

  const quiet = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'recurring-user', colour: { name: 'blue' }, consent: false }
  });
  assert.equal(quiet.body.standingMessages.length, 0);

  const again = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'recurring-user', colour: { name: 'yellow' }, reason: 'Just because', consent: true }
  });
  assert.equal(again.body.profile.level, 'not_friendly');
  assert.equal(again.body.standingMessages.length, 0, 'the new displeasure is due at the next interaction');

  const repeated = await api('/api/interactions', {
    method: 'POST',
    body: { userId: 'recurring-user', colour: { name: 'blue' }, consent: false }
  });
  assert.equal(repeated.body.standingMessages.length, 2);
  assert.equal(repeated.body.standingMessages[0].code, 'personal-reason-displeasure');
});

test('a requested red background asks why, and only a cogent reason produces it', async () => {
  const asked = await api('/api/design/backgrounds', {
    method: 'POST',
    body: { userId: 'background-user', colour: { name: 'red' }, consent: true, design: { type: 'flyer' } }
  });
  assert.equal(asked.status, 200);
  assert.equal(asked.body.requiresReason, true);
  assert.equal(asked.body.accepted, false);
  assert.equal(asked.body.designSuggestions, null);
  assert.match(asked.body.question, /Why do you want a red or yellow background\?/);
  assert.match(asked.body.notice, /asks immediately/);

  const personal = await api('/api/design/backgrounds', {
    method: 'POST',
    body: {
      userId: 'background-user',
      colour: { name: 'red' },
      reason: 'I just like it',
      consent: true,
      design: { type: 'flyer' }
    }
  });
  assert.equal(personal.body.accepted, false);
  assert.equal(personal.body.profile.level, 'not_friendly');
  assert.equal(personal.body.profile.display_delay_ms, 900);
  assert.equal(personal.body.designSuggestions.suggestions.length, 2);
  assert.match(personal.body.notice, /unfriendly mood/);
  assert.equal(personal.body.reasonAssessment.verdict, 'personal');
  for (const suggestion of personal.body.designSuggestions.suggestions) {
    assert.equal(suggestion.palette.some((entry) => entry.colour_name === 'red'), false);
  }

  const cogent = await api('/api/design/backgrounds', {
    method: 'POST',
    body: {
      userId: 'background-cogent-user',
      colour: { name: 'yellow' },
      reason: 'It signals attention on the warning sign and the audience needs that',
      consent: true,
      design: { type: 'poster' }
    }
  });
  assert.equal(cogent.body.accepted, true);
  assert.equal(cogent.body.profile.level, 'friendly');
  assert.equal(cogent.body.profile.allow_questioned_colours, true);
  assert.equal(cogent.body.designSuggestions.suggestions.length, 3);
  assert.equal(cogent.body.designSuggestions.choice.by, 'user');
  assert.equal(cogent.body.designSuggestions.choice.applied, false);
  for (const suggestion of cogent.body.designSuggestions.suggestions) {
    const requested = suggestion.palette.find((entry) => entry.role === 'requested');
    assert.equal(requested.colour_name, 'yellow');
  }
  assert.match(cogent.body.notice, /stays with you/);

  const wrongColour = await api('/api/design/backgrounds', {
    method: 'POST',
    body: { userId: 'background-user', colour: { name: 'green' }, consent: true }
  });
  assert.equal(wrongColour.status, 400);
  assert.equal(wrongColour.body.error.code, 'background_not_questioned');
});

test('the interface is served by the same server, and only from the frontend directory', async () => {
  const root = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/frontend/');

  const page = await fetch(`${base}/frontend/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const html = await page.text();
  assert.match(html, /ChatMT/);
  assert.match(html, /id="flyer-text"/);
  assert.match(html, /id="create-flyer"/);

  const studio = await fetch(`${base}/frontend/studio.html`);
  assert.equal(studio.status, 200);
  assert.match(await studio.text(), /id="background-ask"/);

  const script = await fetch(`${base}/frontend/js/create.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  const source = await script.text();
  assert.match(source, /no innerHTML/i);

  const css = await fetch(`${base}/frontend/css/create.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);

  const font = await fetch(`${base}/frontend/fonts/Gloock-Regular.ttf`);
  assert.equal(font.status, 200);
  assert.match(font.headers.get('content-type'), /^font\/ttf/);
  assert.equal(font.headers.get('x-content-type-options'), 'nosniff');
  assert.ok((await font.arrayBuffer()).byteLength > 0);

  for (const escaping of ['/frontend/../package.json', '/frontend/%2e%2e/package.json', '/package.json', '/modules/color_engine/palette.js']) {
    const response = await fetch(`${base}${escaping}`);
    assert.equal(response.status, 404, escaping);
  }
});

test('the default standing is friendly and the meaning index is the same one the API uses', () => {
  assert.equal(createDefaultStanding().level, 'friendly');
  const standards = loadStandards({ directory: MEANINGS_DIRECTORY });
  const meanings = createMeaningIndex(standards.meanings, { palette: PALETTE });
  assert.equal(meanings.encouraged.length, 5);
  assert.equal(meanings.questioned.length, 2);
});

test('the LLM classifier sends a strict JSON request and validates the answer', async () => {
  const requests = [];
  const classifier = createLlmClassifier({
    apiBase: 'https://llm.example/v1',
    apiKey: 'test-key',
    model: 'test-model',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"verdict":"cogent","confidence":0.92}' } }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
  });

  assert.equal(classifier.configured, true);
  const result = await classifier.classify({ colourName: 'red', reason: 'Because it represents danger' });
  assert.equal(result.verdict, 'cogent');
  assert.equal(result.confidence, 0.92);
  assert.equal(result.method, 'llm');
  assert.equal(requests[0].url, 'https://llm.example/v1/chat/completions');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-key');
  const sent = JSON.parse(requests[0].options.body);
  assert.equal(sent.model, 'test-model');
  assert.equal(sent.temperature, 0);
  assert.match(sent.messages[0].content, /Return only a compact JSON object/);
  assert.match(sent.messages[1].content, /Because it represents danger/);
});

test('the .env file is read and an exported variable still wins', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chatmt-env-'));
  const file = path.join(directory, '.env');
  fs.writeFileSync(
    file,
    [
      '# a comment',
      'DEEPSEEK_API_KEY=from-file',
      'export CHATMT_LLM_MODEL="deepseek-flash"',
      "CHATMT_LLM_THINKING='enabled'",
      'CHATMT_LLM_REASONING_EFFORT=high # declared',
      'NOT A PAIR',
      'CHATMT_LLM_TIMEOUT_MS='
    ].join('\n')
  );

  const parsed = parseEnvFile(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.DEEPSEEK_API_KEY, 'from-file');
  assert.equal(parsed.CHATMT_LLM_MODEL, 'deepseek-flash');
  assert.equal(parsed.CHATMT_LLM_THINKING, 'enabled');
  assert.equal(parsed.CHATMT_LLM_REASONING_EFFORT, 'high');
  assert.equal(parsed.CHATMT_LLM_TIMEOUT_MS, '');
  assert.equal('NOT' in parsed, false);

  const env = { CHATMT_LLM_MODEL: 'exported-model' };
  const result = loadEnvFile({ path: file, env });
  assert.equal(result.found, true);
  assert.equal(env.CHATMT_LLM_MODEL, 'exported-model');
  assert.equal(env.DEEPSEEK_API_KEY, 'from-file');
  assert.equal(result.loaded.includes('CHATMT_LLM_MODEL'), false);

  const missing = loadEnvFile({ path: path.join(directory, 'absent.env'), env: {} });
  assert.equal(missing.found, false);
  assert.deepEqual(missing.loaded, []);

  fs.rmSync(directory, { recursive: true, force: true });
});

test('DeepSeek is the declared default and the request asks for thinking mode', async () => {
  const defaults = loadConfig({});
  assert.equal(defaults.llm.apiBase, 'https://api.deepseek.com');
  assert.equal(defaults.llm.model, 'deepseek-flash');
  assert.equal(defaults.llm.thinking, 'enabled');
  assert.equal(defaults.llm.reasoningEffort, 'high');
  assert.equal(defaults.llm.timeoutMs, 20000);
  assert.equal(defaults.llm.configured, false);
  assert.equal(loadConfig({ DEEPSEEK_API_KEY: 'key' }).llm.configured, true);
  assert.throws(() => loadConfig({ CHATMT_LLM_THINKING: 'maybe' }), /CHATMT_LLM_THINKING/);

  const bodies = [];
  const reply = () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"verdict":"personal","confidence":0.8}' } }] }), {
      status: 200
    });
  const thinking = createLlmClassifier({
    apiBase: 'https://api.deepseek.com',
    apiKey: 'key',
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return reply();
    }
  });
  await thinking.classify({ colourName: 'red', reason: 'I just like it' });
  assert.deepEqual(bodies[0].thinking, { type: 'enabled' });
  assert.equal(bodies[0].reasoning_effort, 'high');

  const quiet = createLlmClassifier({
    apiBase: 'https://api.deepseek.com',
    apiKey: 'key',
    thinking: 'disabled',
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return reply();
    }
  });
  await quiet.classify({ colourName: 'red', reason: 'I just like it' });
  assert.equal('thinking' in bodies[1], false);
  assert.equal('reasoning_effort' in bodies[1], false);
});

test('the LLM classifier refuses malformed, failing and unconfigured requests', async () => {
  const malformed = createLlmClassifier({
    apiBase: 'https://llm.example/v1',
    apiKey: 'key',
    fetchImpl: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'not json at all' } }] }), { status: 200 })
  });
  await assert.rejects(() => malformed.classify({ colourName: 'red', reason: 'x' }), (error) => {
    assert.equal(error.code, 'llm_invalid_response');
    return true;
  });

  const failing = createLlmClassifier({
    apiBase: 'https://llm.example/v1',
    apiKey: 'key',
    fetchImpl: async () => new Response('{}', { status: 500 })
  });
  await assert.rejects(() => failing.classify({ colourName: 'red', reason: 'x' }), (error) => {
    assert.equal(error.code, 'llm_request_failed');
    return true;
  });

  const unconfigured = createLlmClassifier({});
  assert.equal(unconfigured.configured, false);
  await assert.rejects(() => unconfigured.classify({ colourName: 'red', reason: 'x' }), (error) => {
    assert.equal(error.code, 'llm_not_configured');
    return true;
  });

  const unclear = createLlmClassifier({
    apiBase: 'https://llm.example/v1',
    apiKey: 'key',
    fetchImpl: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"verdict":"unclear"}' } }] }), { status: 200 })
  });
  const result = await unclear.classify({ colourName: 'yellow', reason: 'hmm' });
  assert.equal(result.verdict, 'needs_review');
});

test('the app composes a design from the chosen colour, the photo and the flyer setup', async () => {
  const image = await imageDataUrl('png', 40, 30);
  const composed = await api('/api/design/compose', {
    method: 'POST',
    body: {
      userId: 'compose-user',
      colour: { name: 'blue' },
      design: { type: 'banner', subject: 'Jazz night', audience: 'Students' },
      image
    }
  });
  assert.equal(composed.status, 200);
  const result = composed.body;
  assert.equal(result.layout.id, 'band-right');
  assert.equal(result.copy.headline, 'Jazz night');
  assert.match(result.svg, /^<svg xmlns/);
  assert.match(result.svg, /data:image\/jpeg;base64,/);
  assert.equal(result.photo.treatment, 'cover-fit, centred, automatic: no manual crop');
  assert.equal(result.choice.by, 'user');
  assert.equal(result.stored, null);
  assert.ok(result.svg_bytes > 1000);

  const withoutPhoto = await api('/api/design/compose', {
    method: 'POST',
    body: { userId: 'compose-user', colour: { name: 'green' }, design: { type: 'social_post' } }
  });
  assert.equal(withoutPhoto.status, 200);
  assert.equal(withoutPhoto.body.photo, null);
  assert.match(withoutPhoto.body.svg, /data-field/);

  const questioned = await api('/api/design/compose', {
    method: 'POST',
    body: { userId: 'compose-user', colour: { name: 'red' }, design: { type: 'flyer' } }
  });
  assert.equal(questioned.status, 200);
  assert.equal(questioned.body.colour.colour_name, 'red');
  assert.ok(questioned.body.warnings.some((line) => /not friendly/.test(line)));

  const unknown = await api('/api/design/compose', {
    method: 'POST',
    body: { userId: 'compose-user', colour: { name: 'brown' }, design: { type: 'flyer' } }
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error.code, 'unknown_colour');

  const notAnImage = await api('/api/design/compose', {
    method: 'POST',
    body: { userId: 'compose-user', colour: { name: 'green' }, design: { type: 'flyer' }, image: 'data:image/png;base64,bm90IGFuIGltYWdl' }
  });
  assert.equal(notAnImage.status, 400);
  assert.equal(notAnImage.body.error.code, 'invalid_image');
});

test('the one-press flyer infers the colour and composes red/yellow without refusing it', async () => {
  const green = await api('/api/design/flyer', {
    method: 'POST',
    body: { userId: 'flyer-user', text: 'A green flyer for a spring market', consent: true }
  });
  assert.equal(green.status, 200);
  assert.equal(green.body.input.colourName, 'green');
  assert.equal(green.body.tone, 'friendly');
  assert.equal(green.body.backgrounds.images.length, 5);
  assert.equal(green.body.backgrounds.configured, false);
  assert.ok(green.body.backgrounds.notes.some((line) => /OPENROUTER_API_KEY/.test(line)));
  assert.equal(green.body.composition.layout.id, 'showcase');
  assert.match(green.body.composition.svg, /spring market/i);

  const yellow = await api('/api/design/flyer', {
    method: 'POST',
    body: { userId: 'flyer-user-yellow', text: 'A yellow flyer', consent: true }
  });
  assert.equal(yellow.status, 200);
  assert.equal(yellow.body.input.colourName, 'yellow');
  assert.equal(yellow.body.tone, 'not_friendly');
  assert.equal(yellow.body.display.delay_ms, 900);
  assert.equal(yellow.body.backgrounds.images.length, 2);
  assert.equal(yellow.body.composition.colour.colour_name, 'yellow');
  assert.ok(yellow.body.composition.warnings.some((line) => /not friendly/.test(line)));

  const next = await api('/api/design/flyer', {
    method: 'POST',
    body: { userId: 'flyer-user-yellow', text: 'A blue flyer for the same market', consent: true }
  });
  assert.equal(next.status, 200);
  assert.ok(
    next.body.standingMessages.some((message) => message.code === 'personal-reason-displeasure'),
    'the next interaction carries the displeasure'
  );
});

test('the cut-out removes the original background and keeps the subject opaque', async () => {
  const service = createCutoutService();
  const result = await service.removeBackground({ image: await portraitPhotoDataUrl() });
  assert.equal(result.ok, true);
  assert.equal(result.method, 'grabcut');
  assert.ok(result.width >= 40 && result.height >= 40, 'the cut-out is cropped to the subject');
  assert.ok(result.width >= 300, 'the bounding box is scaled back to the prepared photo');
  assert.ok(result.foreground_ratio > 0.05 && result.foreground_ratio < 0.95);

  const cut = await Jimp.read(Buffer.from(result.image.split(',')[1], 'base64'));
  let transparent = 0;
  let opaque = 0;
  for (let index = 3; index < cut.bitmap.data.length; index += 4) {
    if (cut.bitmap.data[index] === 0) transparent++;
    else if (cut.bitmap.data[index] > 240) opaque++;
  }
  const total = cut.bitmap.width * cut.bitmap.height;
  assert.ok(transparent > total * 0.1, 'the original background became transparent');
  assert.ok(opaque > total * 0.1, 'the subject kept its own pixels');
});

test('a cut-out subject is baked into the generated background without a framed inset', async () => {
  const meanings = loadStandards({ directory: MEANINGS_DIRECTORY }).meanings;
  const background = new Jimp({ width: 300, height: 400, color: 0x2f5d50ff });
  const backgroundUrl = `data:image/jpeg;base64,${(await background.getBuffer('image/jpeg', { quality: 86 })).toString('base64')}`;
  const subject = await subjectPngDataUrl();
  const prepared = {
    image: await portraitPhotoDataUrl(),
    width: 120,
    height: 160,
    source: 'image/png',
    resized: false,
    bytes: 1,
    cutout: { ok: true, image: subject, width: 120, height: 160, method: 'grabcut', foreground_ratio: 0.3 }
  };

  const compose = createComposeService({
    meaningStandard: meanings,
    palette: PALETTE,
    standingFor: () => ({ allow_questioned_colours: false }),
    images: { prepare: async () => prepared },
    cutouts: null
  });

  const result = await compose.compose({
    userId: 'composite-user',
    colour: { name: 'green' },
    design: { type: 'flyer' },
    photo: prepared,
    background: { id: 'test-background', label: 'botanical garden', fallback: false, image: backgroundUrl }
  });

  assert.equal(result.subject.composited, true);
  assert.equal(result.subject.method, 'grabcut');
  assert.equal(result.photo.treatment, 'background removed, subject composited into the generated background');
  assert.equal(result.background.image, null, 'the composite is not sent twice');
  assert.equal((result.svg.match(/data:image\//g) ?? []).length, 1, 'the SVG holds one picture, not a cut-out layer');
  assert.equal(result.svg.includes('photo-inset'), false, 'no framed photo rectangle is drawn');
  assert.equal(result.svg.includes('photo-bg'), true);
  assert.ok(result.actions.some((line) => /no frame/.test(line)));
  assert.ok(result.svg_bytes > 1000);
});

test('only red and yellow produce a question; every other colour stays question-free', async () => {
  for (const entry of PALETTE) {
    const response = await api('/api/interactions', {
      method: 'POST',
      body: { userId: `question-guard-${entry.name}`, colour: { name: entry.name }, consent: false }
    });
    assert.equal(response.status, 200);
    const questioned = entry.name === 'red' || entry.name === 'yellow';
    assert.equal(
      response.body.answer.needsClarification,
      questioned,
      `${entry.name}: needsClarification should be ${questioned}`
    );
    assert.equal(
      response.body.answer.question === null,
      !questioned,
      `${entry.name}: question should be ${questioned ? 'present' : 'absent'}`
    );
    assert.equal(
      response.body.reasonAssessment === null,
      !questioned,
      `${entry.name}: reasonAssessment should be ${questioned ? 'present' : 'absent'}`
    );
  }
});

test('a place called Square does not turn a flyer into a social post', () => {
  assert.equal(inferDesignType('Community market in Town Hall Square'), 'flyer');
  assert.equal(inferDesignType('Saturday at the square'), 'flyer');
  assert.equal(inferDesignType('A square post for Instagram'), 'social_post');
  assert.equal(inferDesignType('A poster for the market'), 'poster');
  assert.equal(inferDesignType('A banner for the road'), 'banner');
});

test('the composition comes back as a phone-ready JPEG as well as an SVG', async () => {
  const composed = await api('/api/design/compose', {
    method: 'POST',
    body: {
      userId: 'raster-user',
      colour: { name: 'blue' },
      design: { type: 'flyer', subject: 'Jazz night' }
    }
  });
  assert.equal(composed.status, 200);
  assert.match(composed.body.image, /^data:image\/jpeg;base64,/);
  assert.equal(composed.body.image_mime, 'image/jpeg');
  assert.equal(composed.body.image_width, 1080);
  assert.equal(composed.body.image_height, 1350);
  assert.ok(composed.body.image_bytes > 10000);
  assert.equal(composed.body.image_error, null);
  assert.doesNotMatch(composed.body.svg, /<text /, 'the SVG carries glyph outlines, not live text');
  assert.match(composed.body.svg, /<path d="/);
  assert.match(composed.body.svg, /<desc>/);
});

test('a long flyer keeps the text above the footer and the export is still complete', async () => {
  const longBody =
    'Saturday 14 November, 10:00-18:00, Town Hall Square. Local farmers, artisans, hot food, live music, children workshop, raffle at 17:00. Free entry. Bring your family and friends; all proceeds support the neighbourhood library. The event is organised by the Friends of the Library together with the town council. Stalls include bread, cheese, honey, preserves, ceramics, knitted goods, second-hand books, plants and seasonal flowers. Live music from the town band at 11:00 and 15:00, a storytelling corner for children at 12:00, and a cooking demonstration at 14:00. Raffle tickets are available at the information desk; the draw takes place at 17:00. All proceeds support the neighbourhood library and its reading programmes for children and older residents.';
  const text = `Community Autumn Market and Neighbourhood Festival\n${longBody}`.slice(0, 800);
  const response = await api('/api/design/flyer', {
    method: 'POST',
    body: { userId: 'long-layout-user', text, consent: true }
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.design.type, 'flyer');
  const layout = response.body.composition.layout;
  assert.equal(layout.text_overflow, false);
  assert.equal(layout.text_trimmed, false);
  assert.ok(layout.text_bottom < layout.rule_y);
  assert.match(response.body.composition.image, /^data:image\/jpeg;base64,/);
  assert.equal(response.body.composition.image_width, 1080);
  assert.equal(response.body.composition.image_height, 1350);
});

async function portraitPhotoDataUrl() {
  const width = 640;
  const height = 840;
  const image = new Jimp({ width, height, color: 0xdde7f0ff });
  for (let y = 180; y < 360; y++) {
    for (let x = 240; x < 400; x++) {
      const dx = x - 320;
      const dy = y - 270;
      if (dx * dx + dy * dy < 76 * 76) image.setPixelColor(0x3a2b22ff, x, y);
    }
  }
  for (let y = 360; y < 720; y++) {
    const half = 160 + ((y - 360) / 360) * 60;
    for (let x = 160; x < 480; x++) {
      if (Math.abs(x - 320) < half) image.setPixelColor(0x3a2b22ff, x, y);
    }
  }
  const buffer = await image.getBuffer('image/jpeg', { quality: 90 });
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

async function subjectPngDataUrl() {
  const image = new Jimp({ width: 120, height: 160, color: 0x00000000 });
  for (let y = 20; y < 150; y++) {
    const half = 20 + ((y - 20) / 130) * 30;
    for (let x = 60 - half; x < 60 + half; x++) {
      image.setPixelColor(0x3a2b22ff, x, y);
    }
  }
  const buffer = await image.getBuffer('image/png');
  return `data:image/png;base64,${buffer.toString('base64')}`;
}
