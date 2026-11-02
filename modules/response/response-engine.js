/**
 * Regenerative Response Engine.
 *
 * It turns one structured reflection result into an answer. The rules it follows:
 * - it never invents a missing piece: every sentence is derived from the reflection result;
 * - it separates three different things that are easy to confuse:
 *     measurement  (a CIEDE2000 distance),
 *     standard     (a rule that was written down in advance),
 *     judgement    (which belongs to the user, not to the system);
 * - it exposes why the answer looks the way it does: data used, rules applied, uncertainty;
 * - it asks a question when the standard requires one, and declares uncertainty when the
 *   standard says nothing, instead of guessing.
 *
 * The text is in English, as decided with the project creator.
 */

import { describeMeasurement, describeDistance } from '../color_engine/color-engine.js';
import { UNCERTAINTY } from '../reflection/reflection-engine.js';

/** @param {string|null} name @param {string} hex */
function labelOf(name, hex) {
  return name === null ? hex : `${name} (${hex})`;
}

/**
 * @param {object} reflection a result from the reflection engine
 * @returns {object} an answer ready to be displayed
 */
export function buildResponse(reflection) {
  const { features, rule, nearest, coverage, memory, contradictions, uncertainty, standards } = reflection;
  const label = labelOf(features.name, features.hex);
  const paragraphs = [];
  const dataUsed = [];

  // ---- headline -------------------------------------------------------------------------
  let headline;
  if (rule === null) {
    headline = `No standard code covers ${label}.`;
  } else if (rule.outcome === 'accepted') {
    headline = `${label} matches standard code ${rule.id}, which accepts this colour.`;
  } else {
    headline = `${label} matches standard code ${rule.id}, which asks a question instead of accepting it outright.`;
  }

  // ---- what was compared ----------------------------------------------------------------
  paragraphs.push(
    `I compared the selected colour with all ${standards.ruleCount} colours written in standard set "${standards.id}" version ${standards.version}.`
  );
  dataUsed.push(`input: palette selection ${features.hex}${features.name === null ? '' : ` named "${features.name}"`}`);
  dataUsed.push(
    `features: RGB(${features.rgb.r}, ${features.rgb.g}, ${features.rgb.b}), CIELAB(${features.lab.l.toFixed(4)}, ${features.lab.a.toFixed(4)}, ${features.lab.b.toFixed(4)})`
  );
  dataUsed.push(`standards: ${standards.id} v${standards.version}, ${standards.ruleCount} rules`);

  // ---- the rule that applies -------------------------------------------------------------
  if (rule !== null) {
    paragraphs.push(
      `Rule applied (${rule.id}): "${rule.source_text}" The colour defined by that code is ${rule.hex} and the distance from your selection is ${reflection.distanceToRule.toFixed(4)}.`
    );
  } else {
    const band = describeDistance(nearest.deltaE);
    paragraphs.push(
      `The closest standard colour is ${nearest.rule.colour_name} (${nearest.rule.hex}), at a distance of ${nearest.deltaE.toFixed(4)}, which is ${band.label}. Being close to a colour that has a code is not the same as having one, so I am not applying that rule.`
    );
  }

  // ---- comparison with the stored preference (the whole point of the memory) -------------
  let measurement = null;
  if (memory.comparison !== null) {
    const { deltaE, band, preferenceName } = memory.comparison;
    measurement = {
      deltaE,
      band,
      sentence: describeMeasurement(deltaE),
      comparedWith: { hex: memory.comparison.hexA, name: preferenceName }
    };
    if (deltaE === 0) {
      paragraphs.push(
        `Your stored preference is ${labelOf(preferenceName, memory.comparison.hexA)}: this selection is exactly the same colour.`
      );
    } else {
      paragraphs.push(
        `Your stored preference is ${labelOf(preferenceName, memory.comparison.hexA)}. The perceptual distance from this selection is ${deltaE.toFixed(4)} (CIEDE2000), which is ${band.label}.`
      );
    }
    dataUsed.push(`memory: stored preference ${memory.comparison.hexA} (record ${memory.comparison.preferenceId})`);
  } else if (memory.used) {
    paragraphs.push('No colour preference was stored for this user yet, so there is nothing to compare with.');
    dataUsed.push('memory: no stored preference');
  }

  // ---- contradictions -------------------------------------------------------------------
  for (const item of contradictions) {
    paragraphs.push(`${item.severity === 'conflict' ? 'Contradiction' : 'Note'}: ${item.message}`);
  }

  // ---- corrections the user recorded ----------------------------------------------------
  if (memory.correction !== null) {
    dataUsed.push(`memory: correction record ${memory.correction.id}`);
  }

  // ---- uncertainty ----------------------------------------------------------------------
  if (coverage === 'uncovered') {
    paragraphs.push(
      'I have no stored information that covers this colour, so I report the uncertainty rather than producing an answer that looks more confident than it is.'
    );
  }

  // ---- judgement: always separate from the measurement ----------------------------------
  const judgement =
    measurement === null
      ? 'A colour having a standard code says nothing about what a person likes: the code describes a rule, not your taste.'
      : 'This distance is a measurement, not a statement about you: two colours can be very close to each other without you liking both, and far apart while you like both.';

  // ---- what the standard allows us to store --------------------------------------------
  const storage = {
    permitted: rule !== null,
    confirmation: rule === null ? 'unconfirmed' : 'confirmed',
    requiresQuestionAnswer: rule?.outcome === 'question',
    explanation:
      rule === null
        ? 'No standard code covers this colour, so it can only be stored as an unconfirmed observation, not as an accepted preference.'
        : rule.outcome === 'question'
          ? `Standard code ${rule.id} requires an answer to its question before the preference is accepted.`
          : `Standard code ${rule.id} accepts this colour, so the preference can be stored once you consent.`
  };

  return {
    headline,
    paragraphs,
    judgement,
    measurement,
    appliedRules: rule === null ? [] : [{ id: rule.id, colour_name: rule.colour_name, outcome: rule.outcome, source_text: rule.source_text }],
    nearestStandard: { id: nearest.rule.id, colour_name: nearest.rule.colour_name, hex: nearest.rule.hex, deltaE: nearest.deltaE },
    dataUsed,
    contradictions,
    uncertainty,
    question: rule?.outcome === 'question' ? rule.question : null,
    needsClarification: rule?.outcome === 'question',
    storage,
    coverage
  };
}

export { UNCERTAINTY };
