/**
 * Tests of the red/yellow reason policy: declared wording rules, colour meanings and the
 * friendliness standing. No HTTP and no browser are involved.
 *
 * Two tests that used to pin the opposite decision were changed on 2026-10-29, because the
 * project creator changed the rule: an absent reason is now personal in nature, and magenta and
 * purple now carry the meanings of indigo and violet.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { assessReasonWithRules, VERDICTS, METHODS } from '../modules/reflection/reason-assessment.js';
import { createMeaningIndex } from '../modules/meaning/colour-meanings.js';
import {
  DECISION_VERDICTS,
  EFFORT_LEVELS,
  STANDING_LEVELS,
  applyAssessment,
  applyDecision,
  collectEngagementMessages,
  createDefaultStanding,
  normaliseStanding,
  summaryOf
} from '../modules/policy/standing-engine.js';
import { PALETTE } from '../modules/color_engine/palette.js';

const meaningStandard = JSON.parse(
  fs.readFileSync(new URL('../standards/colour-meanings.json', import.meta.url), 'utf8')
);
const meanings = createMeaningIndex(meaningStandard, { palette: PALETTE });

function assess(reason, colourName = 'red') {
  return assessReasonWithRules({ colourName, reason });
}

function personal(colourName = 'red') {
  return applyAssessment(createDefaultStanding(), {
    assessment: assess('I just like it', colourName),
    at: '2026-10-28T10:00:00.000Z'
  }).standing;
}

test('the meaning standard keeps the five encouraged colours and the two questioned ones', () => {
  assert.equal(meanings.encouraged.length, 5);
  assert.deepEqual(
    meanings.encouraged.map((entry) => entry.colour_name),
    ['green', 'blue', 'orange', 'indigo', 'violet']
  );
  assert.deepEqual(
    meanings.questioned.map((entry) => entry.colour_name),
    ['red', 'yellow']
  );
  assert.deepEqual(meanings.representationFor('red').meanings, ['danger', 'royalty']);
  assert.deepEqual(meanings.representationFor('yellow').meanings, ['anger', 'determination']);
  assert.equal(meanings.isEncouraged('green'), true);
  assert.equal(meanings.isQuestioned('green'), false);
  assert.equal(meanings.assistance.extensive.suggestion_limit, 5);
  assert.equal(meanings.assistance.reduced.suggestion_limit, 2);
});

test('magenta shares the meaning of indigo and purple the meaning of violet', () => {
  assert.deepEqual(
    meanings.equivalent.map((entry) => `${entry.colour_name}:${entry.same_as}`),
    ['magenta:indigo', 'purple:violet']
  );
  assert.deepEqual(meanings.representationFor('magenta').meanings, ['victory']);
  assert.deepEqual(meanings.representationFor('purple').meanings, ['safety']);
  assert.equal(meanings.isEncouraged('magenta'), true);
  assert.equal(meanings.isEncouraged('purple'), true);
  assert.equal(meanings.isEquivalent('magenta'), true);
  assert.match(meanings.colourMeaningSentence('magenta'), /same meaning as indigo/);
});

test('a colour without a recorded meaning is still reported, never invented', () => {
  const names = meanings.coloursWithoutMeaning().map((entry) => entry.name);
  assert.ok(names.includes('lime'));
  assert.ok(names.includes('grey'));
  assert.equal(names.includes('magenta'), false, 'magenta now has the meaning of indigo');
  assert.equal(meanings.representationFor('lime'), null);
  assert.match(meanings.colourMeaningSentence('lime'), /No meaning is recorded/);
});

test('the bias explanation displays the recorded representations and the new rules', () => {
  const text = meanings.buildBiasExplanation();
  assert.match(text, /danger or royalty/);
  assert.match(text, /anger or determination/);
  assert.match(text, /not friendly/);
  assert.match(text, /green/);
  assert.match(text, /magenta/);
  assert.match(text, /absent reason counts as\s+personal|absent reason counts as personal/);
  assert.match(text, /900 ms/);
});

test('a purely personal reason is classified as personal', () => {
  for (const reason of [
    'I just like it',
    'It is my favourite colour',
    'No reason, it looks nice',
    'I just prefer it, just because',
    'My personal taste, nothing else'
  ]) {
    const result = assess(reason);
    assert.equal(result.verdict, VERDICTS.PERSONAL, `reason: ${reason}`);
    assert.equal(result.method, METHODS.RULES);
    assert.ok(result.confidence >= 0.5);
    assert.equal(result.reason_present, true);
    assert.equal(result.absent_reason, false);
  }
});

test('a reason about meaning, purpose or design is classified as cogent', () => {
  for (const reason of [
    'It represents danger on the warning label',
    'Our brand identity is red and the audience expects it',
    'Yellow is used for road signs because it signals attention and caution',
    'Because it means royalty and the event is a heritage festival',
    'I need it for the flyer background, it matches the poster layout'
  ]) {
    const result = assess(reason, reason.toLowerCase().includes('yellow') ? 'yellow' : 'red');
    assert.equal(result.verdict, VERDICTS.COGENT, `reason: ${reason}`);
    assert.ok(result.confidence >= 0.5);
  }
});

test('a purpose stated after "I like it" still wins when the purpose is explicit', () => {
  const result = assess('I like red because it represents danger and my brand needs that warning');
  assert.equal(result.verdict, VERDICTS.COGENT);
});

test('a negated personal phrase does not count as personal', () => {
  const result = assess("I don't just like it because it is my favourite; I need it for the warning sign");
  assert.equal(result.verdict, VERDICTS.COGENT);
});

test('an ambiguous reason is left undecided instead of being forced into a category', () => {
  const result = assess('It is a strong colour');
  assert.equal(result.verdict, VERDICTS.NEEDS_REVIEW);
  assert.equal(result.confidence, 0.2);
  assert.match(result.explanation.join(' '), /do not decide/);
});

test('an absent reason is personal in nature', () => {
  for (const empty of ['', '   ', null, undefined]) {
    const result = assess(empty);
    assert.equal(result.verdict, VERDICTS.PERSONAL, `reason: ${JSON.stringify(empty)}`);
    assert.equal(result.reason_present, false);
    assert.equal(result.absent_reason, true);
    assert.equal(result.method, METHODS.NONE);
    assert.equal(result.confidence, 0.6);
    assert.match(result.explanation.join(' '), /No reason was given/);
  }
});

test('the assessment reports which declared wording matched', () => {
  const result = assess('I just like it');
  assert.ok(result.matched.length > 0);
  for (const match of result.matched) {
    assert.ok(['personal', 'cogent'].includes(match.side));
    assert.ok(typeof match.evidence === 'string' && match.evidence.length > 0);
    assert.ok(typeof match.label === 'string');
  }
});

test('the standing starts friendly and is not changed by an undecided reason', () => {
  const start = createDefaultStanding();
  assert.equal(start.level, STANDING_LEVELS.FRIENDLY);
  assert.equal(start.effort, EFFORT_LEVELS.EXTENSIVE);
  assert.equal(summaryOf(start, { meanings }).suggestion_limit, 5);
  assert.equal(summaryOf(start, { meanings }).display_delay_ms, 0);

  const assessment = assess('It is a strong colour');
  const decision = applyAssessment(start, { assessment, at: '2026-10-28T10:00:00.000Z' });
  assert.equal(decision.changed, false);
  assert.equal(decision.standing.level, STANDING_LEVELS.FRIENDLY);
});

test('a personal reason makes the profile not friendly, arms both messages and declares the delay', () => {
  const decision = applyAssessment(createDefaultStanding(), {
    assessment: assess('I just like it'),
    at: '2026-10-28T10:00:00.000Z'
  });
  assert.equal(decision.changed, true);
  assert.equal(decision.standing.level, STANDING_LEVELS.NOT_FRIENDLY);
  assert.equal(decision.standing.effort, EFFORT_LEVELS.REDUCED);
  assert.deepEqual(decision.standing.pending, { displeasure: true, effort_explanation: true });

  const summary = summaryOf(decision.standing, { meanings });
  assert.equal(summary.suggestion_limit, 2);
  assert.equal(summary.detail, 'brief');
  assert.equal(summary.display_delay_ms, 900);
  assert.match(summary.why, /not friendly/);

  const firstNext = collectEngagementMessages(decision.standing, {
    meanings,
    at: '2026-10-29T10:00:00.000Z'
  });
  assert.equal(firstNext.delivered, true);
  assert.equal(firstNext.messages.length, 2);
  assert.equal(firstNext.messages[0].code, 'personal-reason-displeasure');
  assert.equal(firstNext.messages[1].code, 'reduced-assistance-explanation');
  assert.match(firstNext.messages[0].text, /not pleased/);
  assert.match(firstNext.messages[1].text, /900 ms/);
  assert.match(firstNext.messages[1].text, /previous interaction/);

  const secondNext = collectEngagementMessages(firstNext.standing, { meanings });
  assert.equal(secondNext.delivered, false);
  assert.equal(secondNext.messages.length, 0);
});

test('an absent reason is stored as not friendly too, with its own wording', () => {
  const decision = applyAssessment(createDefaultStanding(), {
    assessment: assess(''),
    at: '2026-10-29T10:00:00.000Z'
  });
  assert.equal(decision.standing.level, STANDING_LEVELS.NOT_FRIENDLY);
  assert.equal(decision.standing.last_decision.verdict, DECISION_VERDICTS.ABSENT);
  assert.equal(decision.standing.pending.displeasure, true);

  const delivered = collectEngagementMessages(decision.standing, { meanings });
  assert.match(delivered.messages[0].text, /without giving a reason/);
  assert.match(delivered.messages[0].text, /Absent reason|absent reason/);
});

test('the displeasure can recur at every new personal or absent choice', () => {
  let standing = personal();
  const first = collectEngagementMessages(standing, { meanings, at: '2026-10-29T10:00:00.000Z' });
  assert.equal(first.messages.length, 2);
  standing = first.standing;

  const quiet = collectEngagementMessages(standing, { meanings });
  assert.equal(quiet.delivered, false);

  const again = applyAssessment(standing, {
    assessment: assess('Still no reason that helps'),
    at: '2026-10-30T10:00:00.000Z'
  });
  assert.equal(again.standing.pending.displeasure, true);
  const repeated = collectEngagementMessages(again.standing, { meanings });
  assert.equal(repeated.delivered, true);
  assert.equal(repeated.messages[0].code, 'personal-reason-displeasure');
});

test('choosing one of the encouraged colours makes a not friendly profile friendly again', () => {
  const notFriendly = personal();
  for (const colourName of ['green', 'blue', 'orange', 'indigo', 'violet', 'magenta', 'purple']) {
    const decision = applyDecision(notFriendly, {
      verdict: DECISION_VERDICTS.ENCOURAGED,
      colourName,
      at: '2026-10-30T10:00:00.000Z'
    });
    assert.equal(decision.standing.level, STANDING_LEVELS.FRIENDLY, colourName);
    assert.equal(decision.standing.effort, EFFORT_LEVELS.EXTENSIVE, colourName);
    assert.equal(summaryOf(decision.standing, { meanings }).display_delay_ms, 0, colourName);
    assert.equal(summaryOf(decision.standing, { meanings }).suggestion_limit, 5, colourName);
  }
});

test('an encouraged colour does not unlock red or yellow backgrounds by itself', () => {
  const unlocked = applyAssessment(personal(), {
    assessment: assess('Because it means royalty and the event is a heritage festival'),
    at: '2026-10-29T10:00:00.000Z'
  }).standing;
  assert.equal(unlocked.allow_questioned_colours, true);

  const afterGreen = applyDecision(unlocked, { verdict: DECISION_VERDICTS.ENCOURAGED, colourName: 'green' });
  assert.equal(afterGreen.standing.allow_questioned_colours, true, 'an unlock earned by a cogent reason is kept');

  const fromNothing = applyDecision(createDefaultStanding(), {
    verdict: DECISION_VERDICTS.ENCOURAGED,
    colourName: 'blue'
  });
  assert.equal(fromNothing.standing.allow_questioned_colours, false);
});

test('a cogent reason restores the friendly profile and unlocks red/yellow backgrounds', () => {
  const cogent = applyAssessment(personal(), {
    assessment: assess('Because it means royalty and the event is a heritage festival'),
    at: '2026-10-29T10:00:00.000Z'
  }).standing;

  assert.equal(cogent.level, STANDING_LEVELS.FRIENDLY);
  assert.equal(cogent.effort, EFFORT_LEVELS.EXTENSIVE);
  assert.equal(cogent.allow_questioned_colours, true);
  assert.deepEqual(cogent.pending, { displeasure: false, effort_explanation: false });
  assert.equal(summaryOf(cogent, { meanings }).suggestion_limit, 5);
  assert.equal(summaryOf(cogent, { meanings }).display_delay_ms, 0);
});

test('a damaged standing cannot silently unlock red/yellow accents', () => {
  const damaged = normaliseStanding({ level: 'not_friendly', allow_questioned_colours: true });
  assert.equal(damaged.allow_questioned_colours, false);
  assert.equal(damaged.effort, EFFORT_LEVELS.REDUCED);
});
