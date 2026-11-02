/**
 * Tests of the graphic assistance rules: five encouraged colours, fewer suggestions for a
 * not friendly profile, red/yellow accents only after a cogent reason, and the validation of
 * image transform operations.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createMeaningIndex } from '../modules/meaning/colour-meanings.js';
import {
  buildDesignSuggestions,
  buildRequestedBackgroundSuggestions,
  normaliseDesignContext,
  DESIGN_TYPES
} from '../modules/policy/design-suggestions.js';
import {
  applyAssessment,
  createDefaultStanding
} from '../modules/policy/standing-engine.js';
import { assessReasonWithRules } from '../modules/reflection/reason-assessment.js';
import { PALETTE } from '../modules/color_engine/palette.js';
import {
  IMAGE_LIMITS,
  ImageOperationError,
  assertCropFits,
  normaliseFormat,
  parseOperations,
  resolveResize
} from '../modules/design/image-operations.js';

const meaningStandard = JSON.parse(
  fs.readFileSync(new URL('../standards/colour-meanings.json', import.meta.url), 'utf8')
);
const meanings = createMeaningIndex(meaningStandard, { palette: PALETTE });
const FIVE = ['green', 'blue', 'orange', 'indigo', 'violet'];

function friendly() {
  return createDefaultStanding();
}

function notFriendly() {
  return applyAssessment(friendly(), {
    assessment: assessReasonWithRules({ colourName: 'red', reason: 'I just like it' }),
    at: '2026-10-28T10:00:00.000Z'
  }).standing;
}

function cogentFor(standing, colourName) {
  return applyAssessment(standing, {
    assessment: assessReasonWithRules({
      colourName,
      reason: 'It represents my brand and the audience expects this warning'
    }),
    at: '2026-10-28T11:00:00.000Z'
  }).standing;
}

test('a friendly profile receives five suggestions, all tending towards the five colours', () => {
  const result = buildDesignSuggestions({
    meanings,
    standing: friendly(),
    colourName: 'green',
    design: { type: 'flyer', subject: 'Jazz night' }
  });

  assert.equal(result.assistance.effort, 'extensive');
  assert.equal(result.assistance.limit, 5);
  assert.equal(result.assistance.detail, 'full');
  assert.equal(result.suggestions.length, 5);
  assert.equal(result.assistance.withheld.length, 1);
  assert.equal(result.assistance.withheld[0].code, 'questioned-colours-restricted');

  for (const suggestion of result.suggestions) {
    assert.match(suggestion.id, /^flyer-/);
    assert.match(suggestion.background.svg, /^<svg /);
    assert.match(suggestion.background.css, /gradient/);
    assert.equal(suggestion.background.width, 1080);
    assert.equal(suggestion.background.height, 1350);
    assert.equal(suggestion.detail, 'full');
    assert.match(suggestion.layout, /Jazz night/);
    for (const entry of suggestion.palette) {
      assert.ok(FIVE.includes(entry.colour_name), `${entry.colour_name} must be one of the five`);
      assert.equal(entry.role === 'accent', false);
    }
  }

  const first = result.suggestions[0];
  assert.equal(first.palette[0].colour_name, 'green');
  assert.match(first.why, /prosperity and peace/);
});

test('the same input produces exactly the same suggestions (no randomness)', () => {
  const options = { meanings, standing: friendly(), colourName: 'orange', design: { type: 'banner' } };
  assert.deepEqual(
    buildDesignSuggestions(options),
    buildDesignSuggestions(options)
  );
});

test('a not friendly profile receives two brief suggestions and no red/yellow accent', () => {
  const result = buildDesignSuggestions({
    meanings,
    standing: notFriendly(),
    colourName: 'blue',
    design: { type: 'poster' }
  });

  assert.equal(result.assistance.effort, 'reduced');
  assert.equal(result.assistance.limit, 2);
  assert.equal(result.assistance.detail, 'brief');
  assert.equal(result.suggestions.length, 2);
  assert.match(result.assistance.note, /Reduced assistance/);
  assert.match(result.assistance.note, /not friendly/);
  assert.equal(result.assistance.withheld.length, 1);

  for (const suggestion of result.suggestions) {
    assert.equal(suggestion.detail, 'brief');
    for (const entry of suggestion.palette) {
      assert.ok(FIVE.includes(entry.colour_name));
    }
  }
});

test('a cogent reason unlocks one red or yellow accent while staying on the five colours', () => {
  const result = buildDesignSuggestions({
    meanings,
    standing: cogentFor(friendly(), 'red'),
    colourName: 'red',
    design: { type: 'flyer' }
  });

  assert.equal(result.assistance.limit, 5);
  assert.equal(result.assistance.withheld.length, 0);
  assert.match(result.assistance.note, /accent is allowed/);

  const last = result.suggestions[result.suggestions.length - 1];
  const accent = last.palette.find((entry) => entry.role === 'accent');
  assert.ok(accent !== undefined);
  assert.equal(accent.colour_name, 'red');
  assert.equal(last.palette.filter((entry) => FIVE.includes(entry.colour_name)).length >= 2, true);

  for (const suggestion of result.suggestions.slice(0, -1)) {
    for (const entry of suggestion.palette) {
      assert.ok(FIVE.includes(entry.colour_name));
    }
  }
});

test('the accent follows the colour of the cogent reason, not the colour being designed', () => {
  const standing = cogentFor(friendly(), 'yellow');
  const result = buildDesignSuggestions({ meanings, standing, colourName: 'green', design: { type: 'banner' } });
  const accent = result.suggestions.at(-1).palette.find((entry) => entry.role === 'accent');
  assert.equal(accent.colour_name, 'yellow');
});

test('the reduced assistance declares the delay and the suggestions are only suggestions', () => {
  const friendlyResult = buildDesignSuggestions({ meanings, standing: friendly(), colourName: 'blue', design: {} });
  assert.equal(friendlyResult.assistance.delay_ms, 0);
  assert.equal(friendlyResult.choice.by, 'user');
  assert.equal(friendlyResult.choice.applied, false);

  const reducedResult = buildDesignSuggestions({
    meanings,
    standing: notFriendly(),
    colourName: 'blue',
    design: {}
  });
  assert.equal(reducedResult.assistance.delay_ms, 900);
  assert.match(reducedResult.assistance.note, /waits 900 ms/);
  assert.equal(reducedResult.choice.applied, false);
});

test('a red or yellow background needs the request and a cogent reason before it is suggested', () => {
  assert.throws(
    () => buildRequestedBackgroundSuggestions({ meanings, standing: friendly(), colourName: 'red', design: {} }),
    RangeError
  );
  assert.throws(
    () => buildRequestedBackgroundSuggestions({
      meanings,
      standing: cogentFor(friendly(), 'red'),
      colourName: 'green',
      design: {}
    }),
    RangeError
  );
});

test('with a cogent reason the requested background is suggested, tending towards the five colours', () => {
  const result = buildRequestedBackgroundSuggestions({
    meanings,
    standing: cogentFor(friendly(), 'yellow'),
    colourName: 'yellow',
    design: { type: 'poster', subject: 'Safety week' },
    reason: 'It signals attention on a safety poster'
  });

  assert.equal(result.requested.colour_name, 'yellow');
  assert.equal(result.choice.by, 'user');
  assert.equal(result.choice.applied, false);
  assert.equal(result.assistance.delay_ms, 0);
  assert.equal(result.suggestions.length, meanings.backgrounds.suggestion_limit);

  for (const suggestion of result.suggestions) {
    const requested = suggestion.palette.find((entry) => entry.role === 'requested');
    assert.equal(requested.colour_name, 'yellow');
    const support = suggestion.palette.filter((entry) => FIVE.includes(entry.colour_name));
    assert.equal(support.length, 2);
    assert.match(suggestion.background.svg, /^<svg /);
    assert.match(suggestion.title, /yellow/);
  }
  assert.deepEqual(
    buildRequestedBackgroundSuggestions({
      meanings,
      standing: cogentFor(friendly(), 'yellow'),
      colourName: 'yellow',
      design: { type: 'poster', subject: 'Safety week' },
      reason: 'It signals attention on a safety poster'
    }),
    result
  );
});

test('every design type is accepted and keeps its own size', () => {
  for (const type of Object.keys(DESIGN_TYPES)) {
    const result = buildDesignSuggestions({ meanings, standing: friendly(), colourName: 'violet', design: { type } });
    assert.equal(result.suggestions.length, 5);
    assert.equal(result.suggestions[0].background.width, DESIGN_TYPES[type].width);
    assert.equal(result.suggestions[0].background.height, DESIGN_TYPES[type].height);
  }
});

test('an unknown design type or an over-long subject is refused', () => {
  assert.throws(() => normaliseDesignContext({ type: 't-shirt' }), RangeError);
  assert.throws(() => normaliseDesignContext({ type: 'flyer', subject: 'x'.repeat(201) }), RangeError);
  assert.throws(() => normaliseDesignContext({ type: 'flyer', subject: 42 }), TypeError);
});

test('image operations: a valid crop and resize are accepted', () => {
  const operations = parseOperations([
    { type: 'crop', x: 1, y: 2, width: 4, height: 5 },
    { type: 'resize', width: 8 },
    { type: 'rotate', degrees: 90 }
  ]);
  assert.deepEqual(operations, [
    { type: 'crop', x: 1, y: 2, width: 4, height: 5 },
    { type: 'resize', width: 8, height: null },
    { type: 'rotate', degrees: 90 }
  ]);
  assert.deepEqual(resolveResize({ width: 8, height: null }, { width: 16, height: 10 }), { width: 8, height: 5 });
  assert.deepEqual(resolveResize({ width: null, height: 20 }, { width: 10, height: 10 }), { width: 20, height: 20 });
  assert.deepEqual(resolveResize({ width: 20, height: 10 }, { width: 5, height: 5 }), { width: 20, height: 10 });
});

test('image operations: invalid shapes are refused with explicit errors', () => {
  const invalid = [
    [{ type: 'blur', radius: 4 }],
    [{ type: 'crop', x: -1, y: 0, width: 4, height: 4 }],
    [{ type: 'crop', x: 0, y: 0, width: 0, height: 4 }],
    [{ type: 'resize' }],
    [{ type: 'resize', width: 0 }],
    [{ type: 'rotate', degrees: 45 }],
    [{ type: 'crop', x: 0, y: 0, width: 4.5, height: 4 }]
  ];
  for (const operations of invalid) {
    assert.throws(() => parseOperations(operations), ImageOperationError, JSON.stringify(operations));
  }
  assert.throws(() => parseOperations(Array.from({ length: IMAGE_LIMITS.max_operations + 1 }, () => ({ type: 'rotate', degrees: 90 }))), ImageOperationError);
  assert.throws(() => parseOperations('crop'), ImageOperationError);
});

test('image operations: crop bounds are checked against the current image', () => {
  assert.throws(
    () => assertCropFits({ x: 8, y: 0, width: 4, height: 4 }, { width: 10, height: 10 }),
    ImageOperationError
  );
  assert.doesNotThrow(() => assertCropFits({ x: 6, y: 6, width: 4, height: 4 }, { width: 10, height: 10 }));
});

test('image operations: only png, jpeg and bmp are accepted as output', () => {
  for (const format of ['png', 'jpeg', 'bmp', 'PNG']) {
    assert.equal(normaliseFormat(format), format.toLowerCase());
  }
  for (const format of ['gif', 'webp', 'pdf', 42, null]) {
    assert.throws(() => normaliseFormat(format), ImageOperationError);
  }
});

// ---------------------------------------------------------------------------------------
// Automatic composition (30 October 2026): the app does the graphic work
// ---------------------------------------------------------------------------------------

import { composeDesign } from '../modules/design/composer.js';

const PHOTO = { image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', width: 1200, height: 800 };

test('the app composes a portrait flyer and writes the copy itself', () => {
  const result = composeDesign({
    meanings,
    colourName: 'blue',
    design: { type: 'flyer', subject: 'Jazz night', audience: 'Students' }
  });
  assert.equal(result.layout.id, 'stack');
  assert.equal(result.copy.headline, 'Jazz night');
  assert.equal(result.copy.subhead, 'For Students');
  assert.match(result.copy.body, /Blue carries abundance/);
  assert.equal(result.copy.footer, 'blue · #0000FF · 1080×1350');
  assert.equal(result.photo, null);
  assert.ok(result.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"'));
  assert.match(result.svg, /#0000FF/);
  assert.match(result.svg, /Jazz night/);
  assert.ok(result.actions.some((line) => /No photo sent/.test(line)));
  assert.equal(result.choice.by, 'user');
  assert.ok(result.svg_bytes >= result.svg.length);
});

test('a wide format places the photo in the right band and fits it automatically', () => {
  const result = composeDesign({ meanings, colourName: 'green', design: { type: 'banner' }, photo: PHOTO });
  assert.equal(result.layout.id, 'band-right');
  assert.deepEqual(result.photo, { width: 1200, height: 800, treatment: 'cover-fit, centred, automatic' });
  assert.match(result.svg, /preserveAspectRatio="xMidYMid slice"/);
  assert.match(result.svg, /<image href="data:image\/jpeg;base64,/);
  assert.ok(result.actions.some((line) => /cover-fit/.test(line)));
  assert.equal(result.warnings.length, 0);
});

test('a square format uses the full-bleed layout with a scrim under the text', () => {
  const result = composeDesign({ meanings, colourName: 'orange', design: { type: 'social_post' }, photo: PHOTO });
  assert.equal(result.layout.id, 'cover');
  assert.match(result.svg, /width="1080" height="1080"/);
  assert.match(result.svg, /<image href="[^"]+" x="0" y="0" width="1080" height="1080"/);
  assert.match(result.svg, /linearGradient/);
  assert.ok(result.actions.some((line) => /scrim/.test(line)));
});

test('the text of the flyer setup is escaped, never injected as markup', () => {
  const result = composeDesign({
    meanings,
    colourName: 'violet',
    design: { type: 'poster', subject: 'Tom & Jerry <script>' }
  });
  assert.match(result.copy.headline, /Tom & Jerry <script>/);
  assert.match(result.svg, /Tom &amp; Jerry &lt;script&gt;/);
  assert.doesNotMatch(result.svg, /<script>/);
});

test('the composition is deterministic and never chooses the colour', () => {
  const input = { meanings, colourName: 'indigo', design: { type: 'flyer', subject: 'Fair' }, photo: PHOTO };
  const first = composeDesign(input);
  const second = composeDesign(input);
  assert.equal(first.svg, second.svg);
  assert.equal(first.choice.by, 'user');
  assert.equal(first.choice.applied, true);
});

test('the user text becomes the flyer copy, with the first line as the headline', () => {
  const result = composeDesign({
    meanings,
    colourName: 'blue',
    design: { type: 'flyer', text: 'Jazz night\nDoors 8pm · Town Hall' }
  });
  assert.equal(result.copy.headline, 'Jazz night');
  assert.equal(result.copy.body, 'Doors 8pm · Town Hall');
  assert.match(result.svg, /Jazz night/);
  assert.match(result.svg, /Doors 8pm/);
});

test('a generated background is placed full-bleed in the showcase layout', () => {
  const backgroundImage = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const result = composeDesign({
    meanings,
    colourName: 'green',
    design: { type: 'flyer', text: 'Spring fair' },
    backgroundImage
  });
  assert.equal(result.layout.id, 'showcase');
  assert.match(result.svg, /data:image\/jpeg;base64/);
  assert.match(result.svg, /Spring fair/);
});

test('the optional lines above and below sit at the two edges without touching the copy', () => {
  const backgroundImage = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const result = composeDesign({
    meanings,
    colourName: 'blue',
    design: {
      type: 'flyer',
      text: 'Jazz night\nDoors 8pm · Town Hall',
      topText: 'Save the date',
      bottomText: 'Tickets at the door'
    },
    backgroundImage
  });

  assert.equal(result.layout.id, 'showcase');
  assert.equal(result.copy.topText, 'Save the date');
  assert.equal(result.copy.bottomText, 'Tickets at the door');
  assert.equal(result.copy.headline, 'Jazz night');
  assert.equal(result.copy.body, 'Doors 8pm · Town Hall');
  assert.ok(result.layout.top_note_top >= 0);
  assert.ok(result.layout.bottom_note_top > result.layout.text_bottom);
  assert.ok(result.layout.bottom_note_top < result.layout.rule_y);
  assert.match(result.svg, /<desc>Save the date/);
  assert.match(result.svg, /Tickets at the door/);
  assert.ok(result.actions.some((line) => /top edge/.test(line)));
  assert.ok(result.actions.some((line) => /above the footer/.test(line)));
});

test('the optional lines fit the stacked layout above the footer rule', () => {
  const result = composeDesign({
    meanings,
    colourName: 'green',
    design: {
      type: 'flyer',
      text: 'Spring fair\nSaturday 10:00-18:00',
      topText: 'Save the date',
      bottomText: 'Town Hall Square'
    }
  });

  assert.equal(result.layout.id, 'stack');
  assert.ok(result.layout.top_note_top >= 0);
  assert.ok(result.layout.text_bottom < result.layout.bottom_note_top);
  assert.ok(result.layout.bottom_note_top < result.layout.rule_y);
  assert.equal(result.layout.text_overflow, false);
  assert.match(result.svg, /Town Hall Square/);
});

test('the optional lines fit the square layout above the bottom edge', () => {
  const result = composeDesign({
    meanings,
    colourName: 'orange',
    design: {
      type: 'social_post',
      text: 'Launch night',
      topText: 'New season',
      bottomText: 'Doors 8pm'
    },
    photo: PHOTO
  });

  assert.equal(result.layout.id, 'cover');
  assert.ok(result.layout.text_bottom < result.layout.bottom_note_top);
  assert.match(result.svg, /New season/);
  assert.match(result.svg, /Doors 8pm/);
});

test('red and yellow compose without a recorded cogent reason, with the reduced assistance', () => {
  const result = composeDesign({ meanings, colourName: 'red', design: { type: 'flyer' } });
  assert.equal(result.colour.colour_name, 'red');
  assert.ok(result.warnings.some((line) => /not friendly/.test(line)));

  const unlocked = composeDesign({
    meanings,
    standing: { ...friendly(), allow_questioned_colours: true },
    colourName: 'red',
    design: { type: 'flyer' }
  });
  assert.equal(unlocked.colour.colour_name, 'red');
  assert.ok(unlocked.warnings.some((line) => /cogent reason/.test(line)));
});
