/**
 * Tests of the Reflection Engine and of the Regenerative Response Engine.
 *
 * The standard set is read from standards/usage-of-colours.json, the same file the browser
 * loads: a test on a copy of the data would not prove anything about the real application.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  INPUT_TYPES,
  LABEL_VALUE_TOLERANCE,
  UNCERTAINTY,
  UnsupportedInputError,
  createReflectionEngine
} from '../modules/reflection/reflection-engine.js';
import { buildResponse } from '../modules/response/response-engine.js';
import { MemoryStore, createVolatileAdapter } from '../modules/memory/memory-store.js';
import { InvalidColourError } from '../modules/color_engine/color-space.js';

const standards = JSON.parse(
  readFileSync(new URL('../standards/usage-of-colours.json', import.meta.url), 'utf8')
);
const engine = createReflectionEngine({ standards });

const selection = (name, hex) => ({ type: INPUT_TYPES.PALETTE_SELECTION, name, hex });

function memoryFor(userId = 'user-a') {
  let counter = 0;
  return new MemoryStore({
    adapter: createVolatileAdapter(),
    userId,
    now: () => '2026-10-26T10:00:00.000Z',
    idFactory: () => `record-${++counter}`
  });
}

test('the standard set keeps the nine rules of the original file', () => {
  assert.equal(standards.rules.length, 9);
  assert.equal(standards.rules.filter((rule) => rule.outcome === 'accepted').length, 7);
  assert.equal(standards.rules.filter((rule) => rule.outcome === 'question').length, 2);
  assert.equal(standards.rules.find((rule) => rule.id === 'colour-magenta').colour_name, 'magenta');
  assert.equal(standards.rules.find((rule) => rule.id === 'colour-magenta').hex, '#FF00FF');
});

test('an input that matches a standard is reported with the rule that matched', () => {
  const result = engine.reflect(selection('blue', '#0000FF'));

  assert.equal(result.coverage, 'covered');
  assert.equal(result.rule.id, 'colour-blue');
  assert.equal(result.rule.outcome, 'accepted');
  assert.equal(result.rule.source_text, 'Every input of blue color is accepted');
  assert.equal(result.distanceToRule, 0);
  assert.equal(result.uncertainty.level, UNCERTAINTY.LOW);
  assert.deepEqual(result.contradictions, []);
  assert.equal(result.memory.used, false);
  assert.equal(result.memory.comparison, null);
});

test('an input that matches a "question" standard carries the question of the source file', () => {
  const red = engine.reflect(selection('red', '#FF0000'));
  assert.equal(red.rule.outcome, 'question');
  assert.equal(red.rule.question, 'Why did you choose Red?');

  const yellow = engine.reflect(selection('yellow', '#FFFF00'));
  assert.equal(yellow.rule.question, 'Why did you choose Yellow?');
});

test('an input with no standard is declared uncovered, not guessed', () => {
  const result = engine.reflect(selection('lime', '#00FF00'));

  assert.equal(result.coverage, 'uncovered');
  assert.equal(result.rule, null);
  assert.equal(result.distanceToRule, null);
  assert.equal(result.uncertainty.level, UNCERTAINTY.HIGH);
  // Measured, and not what intuition suggests: lime (#00FF00) is closer to yellow (23.40)
  // than to green (34.51), because the CSS value of green (#008000) is much darker while
  // the hue of lime and green is almost identical. The second-nearest rule is checked too,
  // so this measurement is documented instead of being lost.
  assert.equal(result.nearest.rule.colour_name, 'yellow');
  assert.ok(Math.abs(result.nearest.deltaE - 23.404) < 0.01, `nearest was ${result.nearest.deltaE}`);
  const second = engine.reflect(selection('green', '#00FF00'));
  assert.ok(Math.abs(second.distanceToRule - 34.505) < 0.01, `distance to green was ${second.distanceToRule}`);
  assert.ok(
    result.uncertainty.reasons.some((reason) => reason.includes('No standard code covers')),
    'the uncertainty must say why it is uncertain'
  );
});

test('input types that are not implemented raise an error instead of being interpreted', () => {
  for (const type of ['text', 'image', 'audio', 'preference', undefined]) {
    assert.throws(() => engine.reflect({ type, hex: '#0000FF' }), UnsupportedInputError);
  }
});

test('an invalid colour is refused before anything else happens', () => {
  assert.throws(() => engine.reflect({ type: INPUT_TYPES.PALETTE_SELECTION, hex: 'blue' }), InvalidColourError);
  assert.throws(() => engine.reflect({ type: INPUT_TYPES.PALETTE_SELECTION, hex: '#GGGGGG' }), InvalidColourError);
});

test('a label that disagrees with the measured value is reported as a contradiction', () => {
  const result = engine.reflect(selection('green', '#2ECC71'));

  assert.equal(result.rule.id, 'colour-green');
  assert.ok(result.distanceToRule > LABEL_VALUE_TOLERANCE);
  assert.equal(result.contradictions.length, 1);
  assert.equal(result.contradictions[0].code, 'label-value-mismatch');
  assert.equal(result.contradictions[0].severity, 'conflict');
  assert.equal(result.uncertainty.level, UNCERTAINTY.MEDIUM);
});

test('the memory is used to compare the new selection with the stored preference', () => {
  const memory = memoryFor();
  const stored = memory.addPreference({ hex: '#0000FF', name: 'blue', consent: true });

  const result = engine.reflect(selection('red', '#FF0000'), { memory });

  assert.equal(result.memory.used, true);
  assert.equal(result.memory.preference.id, stored.id);
  assert.ok(result.memory.comparison.deltaE > 0);
  assert.equal(result.memory.comparison.hexA, '#0000FF');
  assert.equal(result.memory.comparison.hexB, '#FF0000');
  assert.equal(result.memory.comparison.preferenceId, stored.id);
  assert.equal(
    memory.currentPreference().content.hex,
    '#0000FF',
    'a new selection must not silently overwrite the stored preference'
  );
});

test('a selection equal to the stored preference reports a distance of exactly zero', () => {
  const memory = memoryFor();
  memory.addPreference({ hex: '#008000', name: 'green', consent: true });

  const result = engine.reflect(selection('green', '#008000'), { memory });
  assert.equal(result.memory.comparison.deltaE, 0);
  assert.equal(result.memory.comparison.band.id, 'identical');
});

test('another user preference is never used as context', () => {
  const alice = memoryFor('alice');
  const bob = memoryFor('bob');
  alice.addPreference({ hex: '#0000FF', name: 'blue', consent: true });

  const result = engine.reflect(selection('red', '#FF0000'), { memory: bob });
  assert.equal(result.memory.comparison, null);
});

test('a correction recorded by the user contradicts the standard without changing it', () => {
  const memory = memoryFor();
  memory.addCorrection({ hex: '#008000', proposedOutcome: 'question', note: 'it depends', consent: true });

  const result = engine.reflect(selection('green', '#008000'), { memory });

  assert.equal(result.memory.correction.content.proposed_outcome, 'question');
  assert.ok(result.contradictions.some((item) => item.code === 'correction-against-standard'));
  assert.equal(result.uncertainty.level, UNCERTAINTY.MEDIUM);
  assert.equal(result.rule.outcome, 'accepted', 'the standard code itself must stay untouched');
});

test('an unconfirmed record is not treated as a settled preference', () => {
  const memory = memoryFor();
  memory.addPreference({ hex: '#0000FF', name: 'blue', consent: true, confirmation: 'unconfirmed' });

  const result = engine.reflect(selection('red', '#FF0000'), { memory });
  assert.ok(result.contradictions.some((item) => item.code === 'unconfirmed-preference-conflict'));
});

test('a memory object that does not implement the expected interface is refused', () => {
  assert.throws(() => engine.reflect(selection('blue', '#0000FF'), { memory: {} }), TypeError);
});

// ---------------------------------------------------------------------------------------
// Response engine
// ---------------------------------------------------------------------------------------

test('the answer for an accepted colour states the rule, the measurement and the limits', () => {
  const memory = memoryFor();
  memory.addPreference({ hex: '#0000FF', name: 'blue', consent: true });
  const reflection = engine.reflect(selection('green', '#008000'), { memory });
  const answer = buildResponse(reflection);

  assert.match(answer.headline, /colour-green/);
  assert.match(answer.headline, /accepts this colour/);
  assert.equal(answer.appliedRules.length, 1);
  assert.equal(answer.appliedRules[0].outcome, 'accepted');
  assert.equal(answer.measurement.deltaE, reflection.memory.comparison.deltaE);
  assert.equal(answer.measurement.comparedWith.hex, '#0000FF');
  assert.match(answer.judgement, /measurement, not a statement about you/);
  assert.equal(answer.question, null);
  assert.equal(answer.needsClarification, false);
  assert.equal(answer.storage.permitted, true);
  assert.equal(answer.storage.confirmation, 'confirmed');
  assert.match(answer.storage.explanation, /accepts this colour/);
  assert.ok(
    answer.paragraphs.some((paragraph) => paragraph.includes('stored preference')),
    'the stored preference must be part of the explanation'
  );
  assert.ok(answer.dataUsed.length >= 3);
});

test('the answer for a colour that must be questioned carries the question from the standard', () => {
  const answer = buildResponse(engine.reflect(selection('red', '#FF0000')));

  assert.match(answer.headline, /colour-red/);
  assert.match(answer.headline, /asks a question/);
  assert.equal(answer.question, 'Why did you choose Red?');
  assert.equal(answer.needsClarification, true);
  assert.equal(answer.storage.requiresQuestionAnswer, true);
  assert.equal(answer.storage.permitted, true);
  assert.match(answer.storage.explanation, /requires an answer to its question/);
});

test('the answer for an uncovered colour declares the uncertainty and refuses to store it as accepted', () => {
  const answer = buildResponse(engine.reflect(selection('lime', '#00FF00')));

  assert.match(answer.headline, /^No standard code covers/);
  assert.equal(answer.appliedRules.length, 0);
  assert.equal(answer.coverage, 'uncovered');
  assert.equal(answer.uncertainty.level, UNCERTAINTY.HIGH);
  assert.equal(answer.storage.permitted, false);
  assert.equal(answer.storage.confirmation, 'unconfirmed');
  assert.match(answer.storage.explanation, /unconfirmed observation/);
  assert.ok(answer.paragraphs.some((paragraph) => paragraph.includes('no stored information')));
});

test('with no stored preference the answer says so instead of inventing a comparison', () => {
  const memory = memoryFor();
  const answer = buildResponse(engine.reflect(selection('blue', '#0000FF'), { memory }));

  assert.equal(answer.measurement, null);
  assert.match(answer.judgement, /says nothing about what a person likes/);
  assert.ok(answer.paragraphs.some((paragraph) => paragraph.includes('nothing to compare with')));
});

test('the answer lists the data it used and never exposes a private reasoning chain', () => {
  const answer = buildResponse(engine.reflect(selection('violet', '#EE82EE')));
  const joined = answer.paragraphs.join(' ');

  assert.ok(answer.dataUsed.some((entry) => entry.startsWith('input:')));
  assert.ok(answer.dataUsed.some((entry) => entry.startsWith('features:')));
  assert.ok(answer.dataUsed.some((entry) => entry.startsWith('standards:')));
  assert.ok(!joined.includes('undefined'), 'no placeholder may leak into the answer');
  assert.ok(!joined.includes('NaN'));
});

test('every palette colour produces an answer without throwing', () => {
  const memory = memoryFor();
  memory.addPreference({ hex: '#0000FF', name: 'blue', consent: true });

  const palette = ['#008000', '#0000FF', '#FFA500', '#FF00FF', '#4B0082', '#800080', '#EE82EE', '#FF0000', '#FFFF00', '#00FF00', '#DC143C', '#FFD700', '#000080', '#DA70D6', '#808080'];
  for (const hex of palette) {
    const reflection = engine.reflect({ type: INPUT_TYPES.PALETTE_SELECTION, hex, name: null }, { memory });
    const answer = buildResponse(reflection);
    assert.ok(answer.headline.length > 0, `no headline for ${hex}`);
    assert.ok(answer.judgement.length > 0, `no judgement for ${hex}`);
    assert.ok(answer.dataUsed.length > 0, `no data used for ${hex}`);
  }
});
