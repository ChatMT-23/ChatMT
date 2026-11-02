/**
 * Interaction service.
 *
 * One interaction is: a colour chosen from the palette, optionally a reason for choosing red
 * or yellow, optionally consent to store the result, optionally a design context. The service
 * applies the policy decided by the project creator, including the additions of 2026-10-29:
 *
 *   - the colour is compared with the standard codes by the existing reflection engine;
 *   - a reason for red/yellow is classified by declared rules first, and by a language model
 *     only when the rules cannot decide;
 *   - choosing green, blue, orange, indigo, violet, magenta or purple makes the profile
 *     friendly and gives the extensive assistance;
 *   - a personal reason — and an absent one, which is personal in nature — makes the profile
 *     not friendly, schedules displeasure plus an explanation for the next interaction, and
 *     the displeasure can recur at every new personal or absent choice;
 *   - a cogent reason keeps or restores the friendly profile and unlocks red/yellow
 *     backgrounds;
 *   - design suggestions always tend towards the five encouraged colours; the reduced effort
 *     gives two of them and a declared delay before the outputs are displayed;
 *   - red or yellow backgrounds are a separate request (`requestBackground`): the app asks why
 *     immediately, and only a cogent reason produces them.
 *
 * Nothing is stored without `consent === true`; the Memory Engine enforces that again.
 */

import { createReflectionEngine } from '../../modules/reflection/reflection-engine.js';
import { buildResponse } from '../../modules/response/response-engine.js';
import { assessReasonWithRules, VERDICTS } from '../../modules/reflection/reason-assessment.js';
import { CATEGORIES, CONFIRMATION } from '../../modules/memory/memory-store.js';
import {
  DECISION_VERDICTS,
  STANDING_KIND,
  applyDecision,
  collectEngagementMessages,
  normaliseStanding,
  summaryOf
} from '../../modules/policy/standing-engine.js';
import {
  buildDesignSuggestions,
  buildRequestedBackgroundSuggestions,
  normaliseDesignContext
} from '../../modules/policy/design-suggestions.js';
import { createMeaningIndex } from '../../modules/meaning/colour-meanings.js';
import { InvalidColourError } from '../../modules/color_engine/color-engine.js';
import { normaliseHex } from '../../modules/color_engine/color-space.js';
import { ApiError, badRequest, notFound } from '../errors.js';

const ASSESSMENT_KIND = 'colour_reason_assessment';
const MAX_REASON_LENGTH = 1000;
/** A decided LLM verdict with less confidence than this is treated as undecided. */
const LLM_MIN_CONFIDENCE = 0.5;

function colourNames(palette) {
  return palette.map((colour) => colour.name).join(', ');
}

/**
 * @param {object} options
 * @param {object} options.standards the parsed usage-of-colours standard
 * @param {object} options.meaningStandard the parsed colour-meanings standard
 * @param {ReadonlyArray<object>} options.palette
 * @param {(userId: string) => object} options.storeFactory returns a MemoryStore for a user
 * @param {object} [options.llm] classifier created by backend/llm-classifier.js
 * @param {() => string} [options.now] injectable clock
 */
export function createInteractionService({
  standards,
  meaningStandard,
  palette,
  storeFactory,
  llm = null,
  now = () => new Date().toISOString()
}) {
  if (typeof storeFactory !== 'function') throw new TypeError('The interaction service needs a storeFactory.');
  if (!Array.isArray(palette) || palette.length === 0) throw new TypeError('The interaction service needs the palette.');

  const engine = createReflectionEngine({ standards });
  const meanings = createMeaningIndex(meaningStandard, { palette });

  function resolveColour(colour) {
    if (colour === null || typeof colour !== 'object') {
      throw badRequest('colour_required', `A colour is required. Choose one of: ${colourNames(palette)}.`);
    }
    const wantedName =
      typeof colour.name === 'string' && colour.name.trim() !== '' ? colour.name.trim().toLowerCase() : null;
    let wantedHex = null;
    if (colour.hex !== undefined && colour.hex !== null) {
      try {
        wantedHex = normaliseHex(colour.hex);
      } catch (error) {
        if (error instanceof InvalidColourError) {
          throw badRequest('invalid_colour', `Not a valid HEX colour: ${JSON.stringify(colour.hex)}.`);
        }
        throw error;
      }
    }
    if (wantedName === null && wantedHex === null) {
      throw badRequest('colour_required', `A colour is required. Choose one of: ${colourNames(palette)}.`);
    }

    const byName = wantedName === null ? null : palette.find((entry) => entry.name === wantedName) ?? null;
    const byHex = wantedHex === null ? null : palette.find((entry) => entry.hex.toUpperCase() === wantedHex) ?? null;

    if (wantedName !== null && byName === null) {
      throw badRequest('unknown_colour', `${JSON.stringify(wantedName)} is not in the palette. Choose one of: ${colourNames(palette)}.`);
    }
    if (wantedHex !== null && byHex === null) {
      throw badRequest('unknown_colour', `${wantedHex} is not in the palette. Choose one of: ${colourNames(palette)}.`);
    }
    if (byName !== null && byHex !== null && byName.name !== byHex.name) {
      throw badRequest(
        'colour_mismatch',
        `The name ${byName.name} and the value ${wantedHex} point to different palette colours.`
      );
    }
    return byName ?? byHex;
  }

  function validateReason(reason) {
    if (reason === undefined || reason === null) return '';
    if (typeof reason !== 'string') throw badRequest('invalid_reason', 'reason must be a string when present.');
    if (reason.length > MAX_REASON_LENGTH) {
      throw badRequest('reason_too_long', `reason is longer than ${MAX_REASON_LENGTH} characters.`);
    }
    return reason.trim();
  }

  function validateConsent(consent) {
    if (consent === undefined) return false;
    if (typeof consent !== 'boolean') throw badRequest('invalid_consent', 'consent must be true or false.');
    return consent;
  }

  async function decideReason(colour, reason) {
    const rules = assessReasonWithRules({ colourName: colour.name, reason });
    let assessment = { ...rules };

    if (rules.verdict === VERDICTS.NEEDS_REVIEW && rules.reason_present && llm?.configured) {
      try {
        const candidate = await llm.classify({ colourName: colour.name, reason, meanings });
        const confidence = typeof candidate.confidence === 'number' ? candidate.confidence : 0;
        assessment =
          candidate.verdict === VERDICTS.NEEDS_REVIEW || confidence >= LLM_MIN_CONFIDENCE
            ? candidate
            : {
                ...rules,
                explanation: [
                  ...rules.explanation,
                  `The language model returned "${candidate.verdict}" with confidence ${confidence}, below the declared threshold of ${LLM_MIN_CONFIDENCE}, so the reason remains undecided.`
                ],
                llm: { attempted: true, status: 'low_confidence', confidence }
              };
      } catch (error) {
        assessment = {
          ...rules,
          explanation: [
            ...rules.explanation,
            `The configured language model could not be used (${error.code ?? 'llm_failed'}), so the reason remains undecided.`
          ],
          llm: { attempted: true, status: 'failed', code: error.code ?? 'llm_failed' }
        };
      }
    } else if (rules.verdict === VERDICTS.NEEDS_REVIEW && !llm?.configured) {
      assessment = {
        ...rules,
        explanation: [
          ...rules.explanation,
          'No language model is configured, so the second stage could not be asked.'
        ],
        llm: { attempted: false, status: 'not_configured' }
      };
    }

    return assessment;
  }

  /**
   * The standing decision implied by one interaction, or null when the colour says nothing
   * about the profile (a colour with no recorded meaning, such as lime or grey).
   */
  function verdictFor({ colourEntry, assessment }) {
    if (meanings.isQuestioned(colourEntry.name)) {
      if (assessment === null || assessment.verdict === VERDICTS.NEEDS_REVIEW) return DECISION_VERDICTS.NEEDS_REVIEW;
      if (assessment.reason_present === false) return DECISION_VERDICTS.ABSENT;
      return assessment.verdict === VERDICTS.COGENT ? DECISION_VERDICTS.COGENT : DECISION_VERDICTS.PERSONAL;
    }
    if (meanings.isEncouraged(colourEntry.name)) return DECISION_VERDICTS.ENCOURAGED;
    return null;
  }

  function loadStanding(store) {
    const record = store.latestRecord({ category: CATEGORIES.INTERACTION, kind: STANDING_KIND });
    return { record, standing: normaliseStanding(record?.content) };
  }

  function deliverPending(store, record, standing) {
    const delivered = collectEngagementMessages(standing, { meanings, at: now() });
    if (delivered.delivered && record !== null) {
      store.updateContent(record.id, delivered.standing);
    }
    return delivered;
  }

  function persistStanding(store, record, standing, assessment) {
    const saved =
      record === null
        ? store.addRecord({
            category: CATEGORIES.INTERACTION,
            content: standing,
            origin: 'colour_reason_assessment',
            confidence: assessment?.confidence ?? 1,
            consent: true
          })
        : store.updateContent(record.id, standing);

    let assessmentRecordId = null;
    if (assessment !== null) {
      const knowledge = store.addRecord({
        category: CATEGORIES.KNOWLEDGE,
        content: {
          kind: ASSESSMENT_KIND,
          colour_name: assessment.colour_name,
          hex: palette.find((entry) => entry.name === assessment.colour_name)?.hex ?? null,
          reason_present: assessment.reason_present ?? null,
          verdict: assessment.verdict,
          confidence: assessment.confidence,
          method: assessment.method,
          matched: (assessment.matched ?? []).map(({ side, id, label, weight }) => ({ side, id, label, weight })),
          meanings: meanings.representationFor(assessment.colour_name)?.meanings ?? []
        },
        origin: 'colour_reason_assessment',
        confidence: assessment.confidence,
        consent: true
      });
      assessmentRecordId = knowledge.id;
    }

    return { standingRecordId: saved.id, assessmentRecordId };
  }

  function storageFor({ colourEntry, reflection, assessment, reasonGiven, consent }) {
    const questioned = meanings.isQuestioned(colourEntry.name);

    if (questioned && !reasonGiven) {
      return {
        permitted: false,
        stored: false,
        confirmation: CONFIRMATION.UNCONFIRMED,
        requiresQuestionAnswer: true,
        explanation:
          `Standard code ${reflection.rule?.id ?? 'unknown'} asks "${reflection.rule?.question ?? 'why?'}". ` +
          'The colour preference is not stored until that question is answered. An absent reason is personal in nature, so ' +
          (consent
            ? 'the profile is stored as not friendly.'
            : 'the profile would be recorded as not friendly, but consent was not given, so nothing was stored.')
      };
    }

    if (assessment !== null && assessment.verdict === VERDICTS.NEEDS_REVIEW) {
      return {
        permitted: false,
        stored: false,
        confirmation: CONFIRMATION.UNCONFIRMED,
        requiresQuestionAnswer: false,
        explanation:
          'The reason could not be classified, so neither the preference nor the profile was stored. Give a concrete purpose (meaning, audience, contrast, design context) or a clearer personal reason.'
      };
    }

    if (consent !== true) {
      return {
        permitted: true,
        stored: false,
        confirmation: reflection.coverage === 'covered' ? CONFIRMATION.CONFIRMED : CONFIRMATION.UNCONFIRMED,
        requiresQuestionAnswer: false,
        explanation: 'Consent was not given, so nothing was stored.'
      };
    }

    if (questioned && assessment?.verdict === VERDICTS.PERSONAL) {
      return {
        permitted: true,
        stored: true,
        confirmation: CONFIRMATION.CONFIRMED,
        requiresQuestionAnswer: false,
        explanation:
          'The preference was stored after your consent, and the profile was stored as not friendly because the reason was personal.'
      };
    }
    if (questioned && assessment?.verdict === VERDICTS.COGENT) {
      return {
        permitted: true,
        stored: true,
        confirmation: CONFIRMATION.CONFIRMED,
        requiresQuestionAnswer: false,
        explanation:
          'The preference was stored after your consent, with a friendly profile because the reason was cogent.'
      };
    }
    if (reflection.coverage === 'uncovered') {
      return {
        permitted: true,
        stored: true,
        confirmation: CONFIRMATION.UNCONFIRMED,
        requiresQuestionAnswer: false,
        explanation:
          'No standard code covers this colour, so it was stored as an unconfirmed observation, not as an accepted preference.'
      };
    }
    return {
      permitted: true,
      stored: true,
      confirmation: CONFIRMATION.CONFIRMED,
      requiresQuestionAnswer: false,
      explanation: `Standard code ${reflection.rule?.id ?? 'unknown'} accepts this colour, so the preference was stored after your consent.`
    };
  }

  function noticeFor({ colourEntry, assessment, consent, applied }) {
    const questioned = meanings.isQuestioned(colourEntry.name);
    const meaningSentence = meanings.colourMeaningSentence(colourEntry.name);

    if (!questioned) {
      if (meanings.isEquivalent(colourEntry.name)) {
        const source = meanings.representationFor(colourEntry.name).same_as;
        return `${colourEntry.name} carries the same meaning as ${source}, so it is treated as an encouraged colour: ${meaningSentence} The profile is friendly.`;
      }
      return meanings.isEncouraged(colourEntry.name)
        ? `${colourEntry.name} is one of the five encouraged colours: ${meaningSentence} The profile is friendly.`
        : meaningSentence;
    }
    if (assessment === null) return null;

    if (assessment.verdict === VERDICTS.NEEDS_REVIEW) {
      return `${meaningSentence} The reason remains undecided; no friendly or not friendly profile was stored.`;
    }
    if (assessment.reason_present === false) {
      return (
        `${meaningSentence} No reason was given, and an absent reason is personal in nature: ` +
        (applied && consent
          ? 'the profile is now not friendly. The displeasure and the explanation of the lesser effort are due at the next interaction. '
          : 'the profile would now be not friendly, but consent was not given, so it was not stored. ') +
        'The colour preference is not stored until the question is answered.'
      );
    }
    if (applied !== true) {
      return `The reason was classified as ${assessment.verdict}, but consent was not given, so the profile was not stored.`;
    }
    if (assessment.verdict === VERDICTS.PERSONAL) {
      return (
        `${meaningSentence} The reason was recorded as personal, so the profile is now not friendly. ` +
        'The displeasure and the explanation of the lesser effort are due at the next interaction, and they can recur ' +
        'if red or yellow is chosen again without a cogent reason.'
      );
    }
    return (
      `${meaningSentence} The reason was recorded as cogent, so the friendly tone is kept and ` +
      'a red or yellow background can be suggested if you ask for one.'
    );
  }

  /**
   * @param {{userId: string, colour: object, reason?: string, consent?: boolean, design?: object, undecidedAsPersonal?: boolean}} input
   */
  async function interact({ userId, colour, reason, consent, design, undecidedAsPersonal = false } = {}) {
    const colourEntry = resolveColour(colour);
    const reasonText = validateReason(reason);
    const consented = validateConsent(consent);
    const store = storeFactory(userId);

    const loaded = loadStanding(store);
    const delivery = deliverPending(store, loaded.record, loaded.standing);
    let standing = delivery.standing;

    const reflection = engine.reflect(
      { type: 'palette_selection', hex: colourEntry.hex, name: colourEntry.name },
      { memory: store }
    );
    const answer = buildResponse(reflection);

    const questioned = meanings.isQuestioned(colourEntry.name);
    // Only red and yellow carry a question, so only they produce an assessment; for the other
    // colours a reason is simply stored with the preference.
    let assessment = questioned ? await decideReason(colourEntry, reasonText) : null;
    // The one-press flyer cannot stop to ask a second question: a reason that the declared rules
    // cannot classify is treated as personal for that flow, so red and yellow still compose with
    // the reduced assistance instead of being refused. The normal interaction keeps needs_review.
    if (undecidedAsPersonal && assessment?.verdict === VERDICTS.NEEDS_REVIEW) {
      assessment = {
        ...assessment,
        verdict: VERDICTS.PERSONAL,
        method: 'undecided-as-personal',
        explanation: [
          ...(assessment.explanation ?? []),
          'The flyer flow treats an undecided reason as personal: the colour still composes, with the reduced assistance.'
        ]
      };
    }
    const verdict = verdictFor({ colourEntry, assessment });

    let applied = false;
    let stored = { preferenceId: null, standingRecordId: null, assessmentRecordId: null };

    if (verdict !== null && verdict !== DECISION_VERDICTS.NEEDS_REVIEW && consented) {
      const decision = applyDecision(standing, {
        verdict,
        colourName: colourEntry.name,
        confidence: assessment?.confidence ?? 1,
        method: assessment?.method ?? 'rules',
        at: now()
      });
      standing = decision.standing;
      applied = decision.changed;
      const ids = persistStanding(store, loaded.record, standing, assessment);
      stored = { ...stored, ...ids };
    }

    const storage = storageFor({
      colourEntry,
      reflection,
      assessment,
      reasonGiven: reasonText !== '',
      consent: consented
    });

    if (consented && storage.permitted) {
      const preference = store.addPreference({
        hex: colourEntry.hex,
        name: colourEntry.name,
        reason: reasonText === '' ? null : reasonText,
        consent: true,
        confirmation: storage.confirmation,
        origin: questioned ? 'palette_selection_question_answered' : 'palette_selection'
      });
      stored = { ...stored, preferenceId: preference.id };
    }

    answer.storage = storage;
    answer.reasonAssessment = assessment;
    answer.standingMessages = delivery.messages.map((message) => message.text);
    answer.policyNotice = noticeFor({ colourEntry, assessment, consent: consented, applied });

    const context = normaliseDesignContext(design ?? {});
    const designSuggestions = buildDesignSuggestions({
      meanings,
      standing,
      colourName: colourEntry.name,
      design: context
    });

    const profile = {
      ...summaryOf(standing, { meanings }),
      decision:
        assessment === null && verdict !== DECISION_VERDICTS.ENCOURAGED
          ? null
          : {
              verdict,
              confidence: assessment?.confidence ?? 1,
              method: assessment?.method ?? 'rules',
              applied: applied && consented
            }
    };

    return {
      userId,
      input: { colourName: colourEntry.name, hex: colourEntry.hex },
      answer,
      reasonAssessment: assessment,
      profile,
      display: { delay_ms: profile.display_delay_ms },
      standingMessages: delivery.messages,
      designSuggestions,
      stored
    };
  }

  /**
   * A request for a background tending towards red or yellow.
   *
   * The app asks why immediately; a reason that is not cogent activates the unfriendly mood and
   * stores the profile for the next engagement. The red or yellow backgrounds are produced only
   * for a cogent reason, and even then they are suggestions: the choice stays with the user.
   */
  async function requestBackground({ userId, colour, reason, consent, design } = {}) {
    const colourEntry = resolveColour(colour);
    if (!meanings.isQuestioned(colourEntry.name)) {
      throw badRequest(
        'background_not_questioned',
        `Only red and yellow backgrounds are questioned. Choose one of: ${meanings.questionedPhrase}.`
      );
    }
    const reasonText = validateReason(reason);
    const consented = validateConsent(consent);
    const store = storeFactory(userId);

    const loaded = loadStanding(store);
    const delivery = deliverPending(store, loaded.record, loaded.standing);
    let standing = delivery.standing;
    const context = normaliseDesignContext(design ?? {});

    const stored = { standingRecordId: null, assessmentRecordId: null };
    const base = {
      userId,
      request: { colour_name: colourEntry.name, hex: colourEntry.hex, design: context },
      question: meanings.backgrounds.question,
      standingMessages: delivery.messages
    };

    if (reasonText === '') {
      return {
        ...base,
        requiresReason: true,
        accepted: false,
        notice:
          `The app asks immediately: "${meanings.backgrounds.question}" A red or yellow background is suggested only ` +
          'when it is requested and a cogent reason for the request is given.',
        profile: summaryOf(standing, { meanings }),
        designSuggestions: null,
        stored
      };
    }

    const assessment = await decideReason(colourEntry, reasonText);
    if (assessment.verdict === VERDICTS.NEEDS_REVIEW) {
      return {
        ...base,
        requiresReason: true,
        accepted: false,
        notice:
          'The reason for the red or yellow background could not be classified, so no background is suggested and no ' +
          'profile was stored. Give a concrete purpose: meaning, audience, contrast, context or design use.',
        reasonAssessment: assessment,
        profile: summaryOf(standing, { meanings }),
        designSuggestions: null,
        stored
      };
    }

    const verdict =
      assessment.reason_present === false
        ? DECISION_VERDICTS.ABSENT
        : assessment.verdict === VERDICTS.COGENT
          ? DECISION_VERDICTS.COGENT
          : DECISION_VERDICTS.PERSONAL;

    let applied = false;
    if (consented) {
      const decision = applyDecision(standing, {
        verdict,
        colourName: colourEntry.name,
        confidence: assessment.confidence,
        method: assessment.method,
        at: now()
      });
      standing = decision.standing;
      applied = decision.changed;
      const ids = persistStanding(store, loaded.record, standing, assessment);
      stored.standingRecordId = ids.standingRecordId;
      stored.assessmentRecordId = ids.assessmentRecordId;
    }

    const accepted = verdict === DECISION_VERDICTS.COGENT && consented;
    const designSuggestions = accepted
      ? buildRequestedBackgroundSuggestions({
          meanings,
          standing,
          colourName: colourEntry.name,
          design: context,
          reason: reasonText
        })
      : buildDesignSuggestions({
          meanings,
          standing,
          colourName: colourEntry.name,
          design: context
        });

    const profile = summaryOf(standing, { meanings });
    return {
      ...base,
      requiresReason: false,
      accepted,
      reasonAssessment: assessment,
      notice: accepted
        ? `A cogent reason was recorded for the ${colourEntry.name} background, so ${meanings.backgrounds.suggestion_limit} ` +
          `backgrounds tending towards ${colourEntry.name} are suggested. They are suggestions: the choice of which ` +
          'background to use stays with you.'
        : `The reason for the ${colourEntry.name} background is ${assessment.verdict === VERDICTS.PERSONAL ? 'personal' : 'absent'}, ` +
          'so the unfriendly mood is active: no red or yellow background is suggested, and the profile was stored for ' +
          'the next engagement' +
          (consented ? '.' : ' only for this answer, because consent was not given.') +
          ` What is suggested instead still tends towards ${meanings.encouragedPhrase}.`,
      profile,
      display: { delay_ms: profile.display_delay_ms },
      designSuggestions,
      stored
    };
  }

  /** Suggestions for a user without storing anything: used by the design endpoint. */
  function suggestionsFor({ userId, colour, design } = {}) {
    const colourEntry = resolveColour(colour);
    const store = storeFactory(userId);
    const standing = loadStanding(store).standing;
    const context = normaliseDesignContext(design ?? {});
    return {
      userId,
      input: { colourName: colourEntry.name, hex: colourEntry.hex },
      profile: summaryOf(standing, { meanings }),
      designSuggestions: buildDesignSuggestions({
        meanings,
        standing,
        colourName: colourEntry.name,
        design: context
      })
    };
  }

  /** Store a preference directly, applying the same reason policy as an interaction. */
  async function savePreference({ userId, colour, reason, consent } = {}) {
    const colourEntry = resolveColour(colour);
    const reasonText = validateReason(reason);
    const consented = validateConsent(consent);
    if (consented !== true) throw new ApiError(403, 'consent_required', 'Nothing is stored without consent: true.');

    const store = storeFactory(userId);
    const loaded = loadStanding(store);
    const questioned = meanings.isQuestioned(colourEntry.name);

    if (questioned && reasonText === '') {
      throw badRequest('reason_required', `Standard code for ${colourEntry.name} asks a question: give the reason in "reason".`);
    }

    let assessment = null;
    let standing = loaded.standing;
    let ids = { standingRecordId: null, assessmentRecordId: null };
    if (questioned) {
      assessment = await decideReason(colourEntry, reasonText);
      if (assessment.verdict === VERDICTS.NEEDS_REVIEW) {
        throw badRequest(
          'reason_unclear',
          'The reason could not be classified as cogent or personal; nothing was stored. Give a concrete purpose or a clearer personal reason.'
        );
      }
      const decision = applyAssessmentCompat(standing, assessment);
      standing = decision.standing;
      ids = persistStanding(store, loaded.record, standing, assessment);
    } else if (meanings.isEncouraged(colourEntry.name)) {
      const decision = applyDecision(standing, {
        verdict: DECISION_VERDICTS.ENCOURAGED,
        colourName: colourEntry.name,
        method: 'rules',
        at: now()
      });
      standing = decision.standing;
      ids = persistStanding(store, loaded.record, standing, null);
    }

    const preference = store.addPreference({
      hex: colourEntry.hex,
      name: colourEntry.name,
      reason: reasonText === '' ? null : reasonText,
      consent: true,
      confirmation: colourEntry.covered ? CONFIRMATION.CONFIRMED : CONFIRMATION.UNCONFIRMED,
      origin: questioned ? 'palette_selection_question_answered' : 'palette_selection'
    });

    return {
      preference,
      reasonAssessment: assessment,
      profile: summaryOf(standing, { meanings }),
      stored: { preferenceId: preference.id, ...ids }
    };
  }

  function applyAssessmentCompat(standing, assessment) {
    const verdict =
      assessment.reason_present === false
        ? DECISION_VERDICTS.ABSENT
        : assessment.verdict === VERDICTS.COGENT
          ? DECISION_VERDICTS.COGENT
          : DECISION_VERDICTS.PERSONAL;
    return applyDecision(standing, {
      verdict,
      colourName: assessment.colour_name,
      confidence: assessment.confidence,
      method: assessment.method,
      at: now()
    });
  }

  function addCorrection({ userId, hex, name = null, targetStandardId = null, proposedOutcome, note = '', consent } = {}) {
    if (consent !== true) throw new ApiError(403, 'consent_required', 'Nothing is stored without consent: true.');
    const store = storeFactory(userId);
    const record = store.addCorrection({ hex, name, targetStandardId, proposedOutcome, note, consent: true });
    return { correction: record };
  }

  function standingFor(userId) {
    const store = storeFactory(userId);
    const loaded = loadStanding(store);
    const preview = collectEngagementMessages(loaded.standing, { meanings, at: now() });
    return {
      userId,
      profile: summaryOf(loaded.standing, { meanings }),
      pendingMessages: preview.messages,
      hasStoredProfile: loaded.record !== null
    };
  }

  function memoryFor(userId, { includeExpired = false } = {}) {
    const store = storeFactory(userId);
    const records = store.list({ includeExpired }).slice().reverse();
    return {
      userId,
      count: records.length,
      records: records.map((record) => ({ ...record, expired: store.isExpired(record) })),
      profile: summaryOf(loadStanding(store).standing, { meanings })
    };
  }

  function deleteRecord(userId, recordId) {
    const store = storeFactory(userId);
    if (!store.delete(recordId)) throw notFound('record_not_found', `No record ${JSON.stringify(recordId)} for this user.`);
    return { deleted: true, recordId };
  }

  function clearMemory(userId) {
    const store = storeFactory(userId);
    return { deletedCount: store.clear() };
  }

  function paletteView() {
    return {
      colours: palette.map((colour) => {
        const entry = meanings.representationFor(colour.name);
        return {
          name: colour.name,
          hex: colour.hex,
          covered: colour.covered,
          encouraged: meanings.isEncouraged(colour.name),
          equivalent: meanings.isEquivalent(colour.name),
          same_as: entry?.same_as ?? null,
          questioned: meanings.isQuestioned(colour.name),
          meanings: entry === null ? null : entry.meanings
        };
      }),
      encouraged: meanings.encouraged.map((entry) => entry.colour_name),
      equivalent: meanings.equivalent.map((entry) => ({ colour_name: entry.colour_name, same_as: entry.same_as })),
      questioned: meanings.questioned.map((entry) => entry.colour_name)
    };
  }

  function meaningsView() {
    return {
      standard: { id: meanings.id, version: meanings.version },
      encouraged: meanings.encouraged,
      equivalent: meanings.equivalent,
      questioned: meanings.questioned,
      assistance: meanings.assistance,
      backgrounds: meanings.backgrounds,
      noMeaningRecorded: meanings.coloursWithoutMeaning(),
      policies: Array.isArray(meaningStandard.policies) ? meaningStandard.policies : [],
      biasExplanation: meanings.buildBiasExplanation()
    };
  }

  return Object.freeze({
    meanings,
    palette: paletteView(),
    meaningsView,
    interact,
    requestBackground,
    suggestionsFor,
    savePreference,
    addCorrection,
    standingFor,
    memoryFor,
    deleteRecord,
    clearMemory,
    resolveColour
  });
}
