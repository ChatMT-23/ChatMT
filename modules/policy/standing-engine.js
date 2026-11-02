/**
 * Friendliness standing.
 *
 * The project creator decided that the profile of a user is either friendly or not friendly,
 * and that the difference is visible in the assistance given:
 *
 *   friendly      -> extensive assistance, 5 background suggestions, no delay;
 *   not friendly  -> reduced assistance, 2 background suggestions, and a small delay of
 *                    `assistance.reduced.delay_ms` before the outputs are displayed.
 *
 * The rules, as declared on 2026-10-29:
 *   - choosing one of the five encouraged colours makes the profile friendly, and magenta and
 *     purple do the same because they carry the same meanings as indigo and violet;
 *   - a cogent reason for red or yellow makes the profile friendly and unlocks red or yellow
 *     backgrounds;
 *   - a personal reason for red or yellow makes the profile not friendly;
 *   - an absent reason for red or yellow is personal in nature, so it makes the profile not
 *     friendly as well;
 *   - the displeasure can recur: every new personal or absent choice of red or yellow arms it
 *     again, and it is expressed at the next interaction.
 *
 * The state is data, so the API can show why the profile is what it is. Delivery consumes the
 * pending flags: the same displeasure is not repeated by the interaction that already showed
 * it, but a new one is armed only by a new decision.
 */

export const STANDING_LEVELS = Object.freeze({
  FRIENDLY: 'friendly',
  NOT_FRIENDLY: 'not_friendly'
});

export const EFFORT_LEVELS = Object.freeze({
  EXTENSIVE: 'extensive',
  REDUCED: 'reduced'
});

export const STANDING_KIND = 'friendliness_standing';

/** What changed the profile. `needs_review` deliberately changes nothing. */
export const DECISION_VERDICTS = Object.freeze({
  ENCOURAGED: 'encouraged',
  COGENT: 'cogent',
  PERSONAL: 'personal',
  ABSENT: 'absent',
  NEEDS_REVIEW: 'needs_review'
});

/** A fresh profile is friendly: no personal reason has been recorded yet. */
export function createDefaultStanding({ at = null } = {}) {
  return {
    kind: STANDING_KIND,
    level: STANDING_LEVELS.FRIENDLY,
    effort: EFFORT_LEVELS.EXTENSIVE,
    allow_questioned_colours: false,
    last_decision: null,
    pending: { displeasure: false, effort_explanation: false },
    updated_at: at
  };
}

/** Reads a stored standing defensively: a damaged shape must not become a friendly profile silently. */
export function normaliseStanding(value) {
  if (!value || typeof value !== 'object') return createDefaultStanding();
  const level = value.level === STANDING_LEVELS.NOT_FRIENDLY ? STANDING_LEVELS.NOT_FRIENDLY : STANDING_LEVELS.FRIENDLY;
  return {
    kind: STANDING_KIND,
    level,
    effort: level === STANDING_LEVELS.NOT_FRIENDLY ? EFFORT_LEVELS.REDUCED : EFFORT_LEVELS.EXTENSIVE,
    allow_questioned_colours: level === STANDING_LEVELS.FRIENDLY && value.allow_questioned_colours === true,
    last_decision:
      value.last_decision && typeof value.last_decision === 'object'
        ? {
            colour_name: value.last_decision.colour_name ?? null,
            verdict: value.last_decision.verdict ?? null,
            confidence: value.last_decision.confidence ?? null,
            method: value.last_decision.method ?? null,
            at: value.last_decision.at ?? null
          }
        : null,
    pending: {
      displeasure: value.pending?.displeasure === true,
      effort_explanation: value.pending?.effort_explanation === true
    },
    updated_at: value.updated_at ?? null
  };
}

function decisionRecord({ colourName, verdict, confidence, method, at }) {
  return {
    colour_name: colourName ?? null,
    verdict,
    confidence: confidence ?? null,
    method: method ?? null,
    at
  };
}

/**
 * Apply one decision to the profile.
 *
 * `encouraged` and `cogent` both give the extensive assistance; they differ in whether red or
 * yellow backgrounds are unlocked. `personal` and `absent` both give the reduced assistance
 * and arm the two pending messages. `needs_review` changes nothing: an undecided reason must
 * not be treated as a personal one.
 *
 * @param {object} standing
 * @param {{verdict: string, colourName?: string|null, confidence?: number|null, method?: string|null, at?: string|null}} input
 * @returns {{standing: object, changed: boolean}}
 */
export function applyDecision(standing, { verdict, colourName = null, confidence = null, method = null, at = null } = {}) {
  const current = normaliseStanding(standing);
  const lastDecision = decisionRecord({ colourName, verdict, confidence, method, at });

  if (verdict === DECISION_VERDICTS.ENCOURAGED) {
    return {
      changed: current.level !== STANDING_LEVELS.FRIENDLY,
      standing: {
        kind: STANDING_KIND,
        level: STANDING_LEVELS.FRIENDLY,
        effort: EFFORT_LEVELS.EXTENSIVE,
        // A friendly choice does not revoke an unlock earned by a cogent reason; it cannot
        // create one either, because a non friendly profile has none to carry over.
        allow_questioned_colours: current.allow_questioned_colours,
        last_decision: lastDecision,
        pending: { displeasure: false, effort_explanation: false },
        updated_at: at
      }
    };
  }

  if (verdict === DECISION_VERDICTS.COGENT) {
    return {
      changed: true,
      standing: {
        kind: STANDING_KIND,
        level: STANDING_LEVELS.FRIENDLY,
        effort: EFFORT_LEVELS.EXTENSIVE,
        allow_questioned_colours: true,
        last_decision: lastDecision,
        pending: { displeasure: false, effort_explanation: false },
        updated_at: at
      }
    };
  }

  if (verdict === DECISION_VERDICTS.PERSONAL || verdict === DECISION_VERDICTS.ABSENT) {
    return {
      changed: true,
      standing: {
        kind: STANDING_KIND,
        level: STANDING_LEVELS.NOT_FRIENDLY,
        effort: EFFORT_LEVELS.REDUCED,
        allow_questioned_colours: false,
        last_decision: lastDecision,
        // The displeasure can recur, so every personal or absent choice arms it again.
        pending: { displeasure: true, effort_explanation: true },
        updated_at: at
      }
    };
  }

  return { standing: current, changed: false };
}

/**
 * Apply a reason assessment produced by modules/reflection/reason-assessment.js.
 * Kept as its own name because it is the common path for red and yellow.
 *
 * @param {object} standing
 * @param {{assessment: object, at?: string|null}} input
 */
export function applyAssessment(standing, { assessment, at = null } = {}) {
  if (!assessment || typeof assessment.verdict !== 'string') {
    throw new TypeError('applyAssessment needs a reason assessment with a verdict.');
  }
  let verdict = assessment.verdict;
  if (verdict === 'personal' && assessment.reason_present === false) verdict = DECISION_VERDICTS.ABSENT;
  return applyDecision(standing, {
    verdict,
    colourName: assessment.colour_name ?? null,
    confidence: assessment.confidence ?? null,
    method: assessment.method ?? null,
    at
  });
}

function displeasureMessage(standing, meanings) {
  const colour = standing.last_decision?.colour_name ?? 'red or yellow';
  if (standing.last_decision?.verdict === DECISION_VERDICTS.ABSENT) {
    return (
      `I am not pleased that you chose ${colour} without giving a reason. ` +
      `${meanings.colourMeaningSentence(colour)} ` +
      'An absent reason is personal in nature: the profile is recorded as not friendly for colour choices, ' +
      'and it stays so until a cogent reason for red or yellow is given.'
    );
  }
  return (
    `I am not pleased with the personal reason stored for choosing ${colour}. ` +
    `${meanings.colourMeaningSentence(colour)} ` +
    'A personal preference is not a reason this system can act on, so this profile is recorded as not friendly for colour choices. ' +
    'The displeasure can recur at any interaction in which red or yellow is still chosen without a cogent reason.'
  );
}

function reducedEffortMessage(standing, meanings) {
  const colour = standing.last_decision?.colour_name ?? 'red or yellow';
  const reduced = meanings.assistance.reduced;
  const extensive = meanings.assistance.extensive;
  return (
    `Lesser effort means a small delay and fewer suggestions. In the previous interaction I answered after ` +
    `${reduced.delay_ms} ms and gave you ${reduced.suggestion_limit} background suggestions instead of the ` +
    `${extensive.suggestion_limit} reserved for the extensive assistance, with less developed descriptions. ` +
    `The reason is the reason stored for ${colour}. Extensive assistance is given for ${meanings.encouragedPhrase}, ` +
    `and for a cogent reason for ${meanings.questionedPhrase}; a cogent reason for red or yellow restores the friendly tone.`
  );
}

/**
 * Messages due at this interaction, and the same standing with those messages marked as
 * delivered. Calling it twice does not repeat them; a new decision arms them again.
 *
 * @param {object} standing
 * @param {{meanings: object, at?: string|null}} input
 */
export function collectEngagementMessages(standing, { meanings, at = null } = {}) {
  const current = normaliseStanding(standing);
  const messages = [];

  if (current.pending.displeasure) {
    messages.push({ code: 'personal-reason-displeasure', text: displeasureMessage(current, meanings) });
  }
  if (current.pending.effort_explanation) {
    messages.push({ code: 'reduced-assistance-explanation', text: reducedEffortMessage(current, meanings) });
  }

  if (messages.length === 0) {
    return { messages, standing: current, delivered: false };
  }

  return {
    delivered: true,
    messages,
    standing: {
      ...current,
      pending: { displeasure: false, effort_explanation: false },
      updated_at: at
    }
  };
}

/** The number of suggestions, the depth of detail and the delay the profile is entitled to. */
export function assistanceFor(standing, meanings) {
  const current = normaliseStanding(standing);
  const entitlement = meanings.assistance[current.effort] ?? meanings.assistance.extensive;
  return {
    effort: current.effort,
    limit: entitlement.suggestion_limit,
    detail: entitlement.detail,
    delay_ms: entitlement.delay_ms,
    extended: current.effort === EFFORT_LEVELS.EXTENSIVE
  };
}

/** A readable state, safe to return from the API. */
export function summaryOf(standing, { meanings } = {}) {
  const current = normaliseStanding(standing);
  const assistance = meanings
    ? assistanceFor(current, meanings)
    : {
        effort: current.effort,
        limit: null,
        detail: current.effort === EFFORT_LEVELS.EXTENSIVE ? 'full' : 'brief',
        delay_ms: null
      };

  const colour = current.last_decision?.colour_name ?? 'red or yellow';
  const absent = current.last_decision?.verdict === DECISION_VERDICTS.ABSENT;
  const why =
    current.level === STANDING_LEVELS.NOT_FRIENDLY
      ? `${absent ? 'A choice of' : 'A personal reason for choosing'} ${colour} was recorded. ` +
        `The profile is not friendly, so it receives the reduced assistance: ${assistance.limit} suggestions instead of ` +
        `${meanings?.assistance?.extensive?.suggestion_limit ?? 'more'} and a delay of ${assistance.delay_ms} ms before ` +
        'the outputs are displayed, until a cogent reason for red or yellow is recorded.'
      : current.allow_questioned_colours
        ? 'The profile is friendly because a cogent reason for red or yellow was recorded. Red or yellow backgrounds are unlocked and are suggested only when you ask for them.'
        : 'The profile is friendly. Red or yellow backgrounds stay locked until you ask for one and give a cogent reason for it.';

  return {
    level: current.level,
    effort: assistance.effort,
    suggestion_limit: assistance.limit,
    detail: assistance.detail,
    display_delay_ms: assistance.delay_ms,
    allow_questioned_colours: current.allow_questioned_colours,
    last_decision: current.last_decision,
    pending: { displeasure: current.pending.displeasure, effort_explanation: current.pending.effort_explanation },
    why
  };
}
