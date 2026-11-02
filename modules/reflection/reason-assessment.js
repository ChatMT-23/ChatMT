/**
 * Reason assessment, rule part.
 *
 * The project creator decided that a reason for choosing red or yellow can be:
 *   - cogent   -> a reason about meaning, purpose, audience, brand, contrast, design context;
 *   - personal -> taste alone ("I just like it", "it is my favourite colour").
 *
 * On 2026-10-29 the creator added that an absent reason is personal in nature. It is
 * therefore classified as personal here, and marked with `absent_reason: true` so the
 * interface can say which of the two happened instead of collapsing them.
 *
 * This module is deterministic and explainable. It does not understand language: it matches
 * declared wording patterns, adds their weights, and reports which patterns matched. When the
 * patterns cannot decide, it says so instead of guessing; a second stage (a language model,
 * configured in the backend) may then be asked, and its answer is labelled as such.
 */

export const VERDICTS = Object.freeze({
  COGENT: 'cogent',
  PERSONAL: 'personal',
  NEEDS_REVIEW: 'needs_review'
});

export const METHODS = Object.freeze({
  RULES: 'rules',
  LLM: 'llm',
  NONE: 'none'
});

export const DECISION_THRESHOLDS = Object.freeze({
  /** A side must reach this score before it can win. */
  minimum_score: 2,
  /** The winning side must be ahead by at least this much. */
  minimum_gap: 1.5
});

/**
 * Wording that indicates a personal preference, with the weight it contributes.
 * The weights are a project convention: they are declared here so they can be reviewed,
 * not presented as a linguistic measurement.
 */
export const PERSONAL_MARKERS = Object.freeze([
  {
    id: 'personal-liking',
    label: 'personal liking',
    weight: 1.5,
    pattern: /\bi (?:just |really |simply )?(?:like|love|adore|enjoy) (?:it|this|that|the colou?r|choosing (?:it|this|red|yellow))\b/
  },
  {
    id: 'just-preference',
    label: 'just a preference',
    weight: 1.5,
    pattern: /\bjust (?:like|love|prefer|want)\b|\bi (?:just )?prefer (?:it|this|that|red|yellow)\b/
  },
  {
    id: 'favourite',
    label: 'favourite colour',
    weight: 2,
    pattern: /\b(?:my )?favou?rite(?: colou?r)?\b/
  },
  {
    id: 'no-reason',
    label: 'no stated reason',
    weight: 2,
    pattern: /\bjust because\b|\bno (?:real )?reason\b|\bfor no reason\b|\bdon'?t know why\b/
  },
  {
    id: 'looks-nice',
    label: 'it looks nice',
    weight: 1.5,
    pattern: /\b(?:looks?|is) (?:nice|pretty|cool|beautiful|good|great|attractive)\b/
  },
  {
    id: 'personal-taste',
    label: 'personal taste',
    weight: 2,
    pattern: /\bpersonal (?:taste|preference|choice|opinion)\b|\bmy taste\b/
  },
  {
    id: 'always-liked',
    label: 'always liked it',
    weight: 1.5,
    pattern: /\bi(?:'ve| have) always (?:liked|loved|wanted)\b/
  },
  {
    id: 'feels-good',
    label: 'it feels good',
    weight: 1,
    pattern: /\b(?:it|this) feels? (?:good|right|nice)\b/
  },
  {
    id: 'because-i-want',
    label: 'because I want to',
    weight: 1.5,
    pattern: /\bbecause i (?:want|like|said so|feel like it)\b/
  }
]);

/**
 * Wording that indicates a use for the colour: meaning, purpose, audience, brand or design.
 */
export const COGENT_MARKERS = Object.freeze([
  {
    id: 'because-it-means',
    label: 'the colour carries a meaning',
    weight: 3,
    pattern: /\bbecause (?:it|this|that|the colou?r|red|yellow) (?:means|represents|symboli[sz]es|conveys|communicates|expresses|stands for)\b/
  },
  {
    id: 'represents',
    label: 'symbolism',
    weight: 2,
    pattern: /\b(?:represents|symboli[sz]es|stands for|conveys|communicates|expresses)\b/
  },
  {
    id: 'brand',
    label: 'brand or business identity',
    weight: 2,
    pattern: /\b(?:brand|logo|company|business|product|packaging|identity|corporate)\b/
  },
  {
    id: 'audience',
    label: 'audience or market',
    weight: 2,
    pattern: /\b(?:audience|customers?|readers?|viewers?|target market|market|clients?|students?|attendees?|guests?|public|community)\b/
  },
  {
    id: 'meaning',
    label: 'meaning or association',
    weight: 2,
    pattern: /\b(?:meaning|symbolism|psychology|association|associations)\b/
  },
  {
    id: 'accessibility',
    label: 'contrast or readability',
    weight: 2,
    pattern: /\b(?:contrast|legib\w*|visib\w*|readab\w*|accessib\w*)\b/
  },
  {
    id: 'warning',
    label: 'warning or safety use',
    weight: 2,
    pattern: /\b(?:warning|danger|urgent|alert|safety|hazard)\b/
  },
  {
    id: 'royalty',
    label: 'royalty, heritage or culture',
    weight: 2,
    pattern: /\b(?:royal|royalty|heritage|tradition|culture|cultural)\b/
  },
  {
    id: 'emotion-purpose',
    label: 'energy or attention',
    weight: 2,
    pattern: /\b(?:anger|determination|attention|impact|energy|emotion)\b/
  },
  {
    id: 'positive-meaning',
    label: 'a recorded positive meaning',
    weight: 2,
    pattern: /\b(?:prosperity|peace|abundance|joy|happiness|victory)\b/
  },
  {
    id: 'purpose-connector',
    label: 'a stated purpose',
    weight: 1.5,
    pattern: /\b(?:in order to|so that|to (?:make|show|convey|communicate|signal|highlight|emphasi[sz]e|draw|create|stand out))\b/
  },
  {
    id: 'context',
    label: 'a use context',
    weight: 1.5,
    pattern: /\b(?:occasion|event|festival|season|holiday|wedding|funeral|road sign|warning sign|flag|industry|sector|context|environment|store|shop|restaurant|menu)\b/
  },
  {
    id: 'design',
    label: 'a design use',
    weight: 1,
    pattern: /\b(?:design|flyer|poster|banner|website|layout|background|theme|branding)\b/
  },
  {
    id: 'matches',
    label: 'it fits the design',
    weight: 1.5,
    pattern: /\b(?:matches|fits|suits|consistent with|complements|stands out against)\b/
  }
]);

const NEGATIONS = [
  /\b(?:not|never)\s+(?:just\s+|only\s+)?(?:because\s+)?(?:i\s+)?(?:just\s+)?(?:like|love|prefer)\b/g,
  /\b(?:i\s+)?(?:don'?t|do not)\s+(?:just\s+|only\s+)?(?:like|love|prefer)\b/g,
  /\b(?:it'?s|it is)\s+not\s+(?:just\s+)?(?:because|about)\b/g
];

function normaliseReason(reason) {
  return String(reason)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

function withoutNegatedPreferences(text) {
  let result = text;
  for (const pattern of NEGATIONS) {
    result = result.replace(pattern, ' ');
  }
  return result.replace(/\s+/g, ' ').trim();
}

function collectMatches(text, markers, side) {
  const matched = [];
  for (const marker of markers) {
    const found = marker.pattern.exec(text);
    if (found === null) continue;
    matched.push({
      side,
      id: marker.id,
      label: marker.label,
      weight: marker.weight,
      evidence: found[0].slice(0, 80)
    });
  }
  return matched;
}

function sum(matched) {
  return Math.round(matched.reduce((total, marker) => total + marker.weight, 0) * 100) / 100;
}

function labelsOf(matched) {
  return [...new Set(matched.map((marker) => marker.label))];
}

function unique(array) {
  return [...new Set(array)];
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Classify the reason using the declared rules only.
 *
 * @param {{colourName: string, reason: string|null|undefined}} input
 * @returns {object} a structured assessment; never throws for an odd reason, only for a
 *                   missing colour name
 */
export function assessReasonWithRules({ colourName, reason } = {}) {
  if (typeof colourName !== 'string' || colourName.trim() === '') {
    throw new TypeError('A reason assessment needs the colour name.');
  }
  const colour = colourName.trim().toLowerCase();
  const present = typeof reason === 'string' && reason.trim() !== '';
  const text = present ? withoutNegatedPreferences(normaliseReason(reason)) : '';

  if (!present) {
    return {
      colour_name: colour,
      reason_present: false,
      absent_reason: true,
      verdict: VERDICTS.PERSONAL,
      confidence: 0.6,
      method: METHODS.NONE,
      scores: { cogent: 0, personal: 0 },
      matched: [],
      explanation: [
        'No reason was given. An absent reason is personal in nature by the declared rule, so the profile is recorded as not friendly; the colour preference itself is not stored until the question is answered.'
      ]
    };
  }

  const personalMatches = collectMatches(text, PERSONAL_MARKERS, VERDICTS.PERSONAL);
  const cogentMatches = collectMatches(text, COGENT_MARKERS, VERDICTS.COGENT);
  const personalScore = sum(personalMatches);
  const cogentScore = sum(cogentMatches);
  const gap = Math.abs(cogentScore - personalScore);

  let verdict;
  if (cogentScore >= DECISION_THRESHOLDS.minimum_score && cogentScore - personalScore >= DECISION_THRESHOLDS.minimum_gap) {
    verdict = VERDICTS.COGENT;
  } else if (personalScore >= DECISION_THRESHOLDS.minimum_score && personalScore - cogentScore >= DECISION_THRESHOLDS.minimum_gap) {
    verdict = VERDICTS.PERSONAL;
  } else {
    verdict = VERDICTS.NEEDS_REVIEW;
  }

  const explanation = [];
  if (verdict === VERDICTS.PERSONAL) {
    explanation.push(
      `The reason expresses taste or preference (${unique(labelsOf(personalMatches)).join(', ')}) and no purpose, meaning or design use was found.`
    );
  } else if (verdict === VERDICTS.COGENT) {
    explanation.push(
      `The reason refers to meaning, purpose, audience or design context (${unique(labelsOf(cogentMatches)).join(', ')}).`
    );
    if (personalMatches.length > 0) {
      explanation.push(
        `It also contains personal wording (${unique(labelsOf(personalMatches)).join(', ')}), but the stated purpose is decisive in this version.`
      );
    }
  } else if (personalScore === 0 && cogentScore === 0) {
    explanation.push(
      'The rules found no declared personal or purpose-related wording, so they do not decide; the reason needs review.'
    );
  } else {
    explanation.push(
      `The rules found both personal wording (${unique(labelsOf(personalMatches)).join(', ') || 'none'}) and purpose-related wording (${unique(labelsOf(cogentMatches)).join(', ') || 'none'}), and the difference is below the declared threshold, so they do not decide.`
    );
  }

  const confidence =
    verdict === VERDICTS.NEEDS_REVIEW
      ? round2(personalScore === 0 && cogentScore === 0 ? 0.2 : 0.4)
      : round2(0.55 + Math.min(0.35, gap * 0.1));

  return {
    colour_name: colour,
    reason_present: true,
    absent_reason: false,
    verdict,
    confidence,
    method: METHODS.RULES,
    scores: { cogent: cogentScore, personal: personalScore },
    matched: [...personalMatches, ...cogentMatches],
    explanation
  };
}
