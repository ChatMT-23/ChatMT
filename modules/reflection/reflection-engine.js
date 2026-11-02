/**
 * Reflection Engine.
 *
 * Given one input, this engine answers the questions the brief asks for, in this order:
 *   1. what are the measurable features of the input?
 *   2. which standard codes are pertinent?
 *   3. how close is the input to each of them (a measurement)?
 *   4. does anything contradict anything else?
 *   5. how uncertain is the result, and why?
 *   6. what did we already know about this colour?
 *
 * It produces a structured result. It writes no prose and never decides on its own what a
 * contradiction means: the response engine turns this structure into sentences, and a human
 * decides whether a standard should change.
 *
 * Scope, decided with the project creator: the colour rules apply to a colour chosen from
 * the palette. Any other input type raises UnsupportedInputError instead of being
 * interpreted loosely.
 */

import { createColour, compareColours, InvalidColourError } from '../color_engine/color-engine.js';
import { deltaE2000, isValidHex } from '../color_engine/color-space.js';

export const INPUT_TYPES = Object.freeze({
  PALETTE_SELECTION: 'palette_selection'
});

export const UNCERTAINTY = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
});

/**
 * Distance below which a label and a measured colour are treated as "the same value".
 * 1.0 is the value commonly quoted as the just-noticeable difference for CIEDE2000, and is
 * also the tolerance used by the published test data of the formula.
 */
export const LABEL_VALUE_TOLERANCE = 1.0;

/** Thrown for input types this version does not implement. */
export class UnsupportedInputError extends Error {
  constructor(type) {
    super(
      `Input type ${JSON.stringify(type)} is not implemented. This version compares a colour chosen from the palette only.`
    );
    this.name = 'UnsupportedInputError';
    this.type = type;
  }
}

/** Rule without its internal Lab values, safe to show and to serialise. */
function publicRule(rule) {
  return {
    id: rule.id,
    colour_name: rule.colour_name,
    hex: rule.hex,
    outcome: rule.outcome,
    question: rule.question,
    source_text: rule.source_text
  };
}

function assertMemoryLike(memory) {
  if (memory === null || memory === undefined) return null;
  const hasApi = typeof memory.currentPreference === 'function' && typeof memory.correctionsFor === 'function';
  if (!hasApi) {
    throw new TypeError('memory must expose currentPreference() and correctionsFor(hex).');
  }
  return memory;
}

/**
 * @param {{rules: Array<object>, id: string, version: string}} standards a standard set
 */
export function createReflectionEngine({ standards }) {
  if (!standards || !Array.isArray(standards.rules) || standards.rules.length === 0) {
    throw new TypeError('createReflectionEngine needs a standard set with at least one rule.');
  }

  const rules = standards.rules.map((rule) => ({
    id: rule.id,
    colour_name: String(rule.colour_name).toLowerCase(),
    hex: rule.hex,
    outcome: rule.outcome,
    question: rule.question ?? null,
    source_text: rule.source_text ?? null,
    lab: createColour(rule.hex).lab
  }));

  const rulesByName = new Map(rules.map((rule) => [rule.colour_name, rule]));

  function nearestRule(lab) {
    let best = null;
    for (const rule of rules) {
      const deltaE = deltaE2000(lab, rule.lab);
      if (best === null || deltaE < best.deltaE) best = { rule, deltaE };
    }
    return best;
  }

  /**
   * @param {{type: string, hex: string, name?: string|null}} input
   * @param {{memory?: object}} [options]
   * @returns {object} a structured reflection result
   */
  function reflect(input, { memory = null } = {}) {
    const store = assertMemoryLike(memory);

    if (input?.type !== INPUT_TYPES.PALETTE_SELECTION) {
      throw new UnsupportedInputError(input?.type);
    }
    if (!isValidHex(input.hex)) {
      throw new InvalidColourError(input.hex);
    }

    const name = typeof input.name === 'string' && input.name.trim() !== '' ? input.name.trim().toLowerCase() : null;
    const features = createColour(input.hex, name);

    // 2. , 3. pertinent standard and measured distances
    const rule = name === null ? null : (rulesByName.get(name) ?? null);
    const nearest = nearestRule(features.lab);
    const distanceToRule = rule === null ? null : deltaE2000(features.lab, rule.lab);
    const coverage = rule === null ? 'uncovered' : 'covered';

    const contradictions = [];
    const uncertaintyReasons = [];

    // 4a. the label says one colour, the value says another
    if (rule !== null && distanceToRule > LABEL_VALUE_TOLERANCE) {
      contradictions.push({
        code: 'label-value-mismatch',
        severity: 'conflict',
        message: `The selection is labelled "${name}" but its value ${features.hex} is ${distanceToRule.toFixed(4)} away from the colour that code ${rule.id} defines (${rule.hex}).`
      });
    }

    // 6. what we already know
    let preference = null;
    let comparison = null;
    let corrections = [];

    if (store !== null) {
      preference = store.currentPreference();
      corrections = store.correctionsFor(features.hex);
      if (preference !== null) {
        comparison = {
          ...compareColours({ hex: preference.content.hex }, { hex: features.hex }),
          preferenceId: preference.id,
          preferenceName: preference.content.name ?? null
        };
      }
    }

    // 4b. a stored correction disagrees with the standard code
    const correction = corrections[0] ?? null;
    if (correction !== null) {
      const standardOutcome = rule === null ? null : rule.outcome;
      const agrees = correction.content.proposed_outcome === standardOutcome;
      if (!agrees) {
        contradictions.push({
          code: 'correction-against-standard',
          severity: 'conflict',
          message: `Your correction for ${features.hex} proposes "${correction.content.proposed_outcome}" while the standard code says ${standardOutcome === null ? 'that no rule applies' : `"${standardOutcome}"`}. The standard has not been changed automatically.`
        });
      }
    }

    // 4c. an old record that was never confirmed must not be treated as settled
    if (preference !== null && preference.confirmation === 'unconfirmed' && preference.content.hex !== features.hex) {
      contradictions.push({
        code: 'unconfirmed-preference-conflict',
        severity: 'warning',
        message: `A stored record for this user (${preference.content.hex}) was never confirmed, so it is not treated as a settled preference.`
      });
    }

    // 5. uncertainty
    let uncertaintyLevel = UNCERTAINTY.LOW;

    if (coverage === 'uncovered') {
      uncertaintyLevel = UNCERTAINTY.HIGH;
      uncertaintyReasons.push(
        `No standard code covers "${name ?? features.hex}". The system reports this instead of inventing an outcome.`
      );
      uncertaintyReasons.push(
        `The closest standard colour is ${nearest.rule.colour_name} (${nearest.rule.hex}) at a distance of ${nearest.deltaE.toFixed(4)}; being close to a colour that has a code is not the same as having one.`
      );
    }

    if (contradictions.some((item) => item.code === 'label-value-mismatch')) {
      uncertaintyLevel = UNCERTAINTY.MEDIUM;
      uncertaintyReasons.push('The label of the input and its measured value disagree, so the comparison may be meaningless.');
    }
    if (contradictions.some((item) => item.code === 'correction-against-standard')) {
      uncertaintyLevel = uncertaintyLevel === UNCERTAINTY.HIGH ? UNCERTAINTY.HIGH : UNCERTAINTY.MEDIUM;
      uncertaintyReasons.push('Two sources disagree about this colour: the standard code and a correction you recorded.');
    }
    if (comparison !== null && comparison.deltaE === 0) {
      uncertaintyReasons.push('The selection is exactly the same colour as the stored preference.');
    }

    return {
      input: { type: input.type, hex: features.hex, name },
      features,
      standards: { id: standards.id, version: standards.version, ruleCount: rules.length },
      coverage,
      rule: rule === null ? null : publicRule(rule),
      distanceToRule,
      nearest: { rule: publicRule(nearest.rule), deltaE: nearest.deltaE },
      contradictions,
      uncertainty: { level: uncertaintyLevel, reasons: uncertaintyReasons },
      memory: {
        used: store !== null,
        preference,
        comparison,
        corrections,
        correction
      }
    };
  }

  return { reflect, standards: { id: standards.id, version: standards.version, ruleCount: rules.length } };
}
