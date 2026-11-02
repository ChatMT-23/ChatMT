/**
 * Colour meanings.
 *
 * The meanings of the colours are not computed: they were written down by the project
 * creator and live in standards/colour-meanings.json. This module only indexes that file,
 * checks it, and exposes it to the rest of the system.
 *
 * Two points that the file records and this module must not soften:
 *
 * - magenta carries the meaning of indigo and purple carries the meaning of violet, because
 *   the creator said they fall into the same meaning. An equivalent colour therefore counts
 *   as an encouraged colour and receives the extensive assistance;
 * - a meaning that is not in the file is never invented. Colours without a recorded meaning
 *   are reported as such, because "this colour has no meaning here" is information, while a
 *   plausible-sounding meaning chosen by the code would be a fabrication.
 */

const REQUIRED_SECTIONS = ['encouraged', 'questioned'];

function normaliseHex(hex, fallbackName) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new TypeError(`Colour meaning for ${JSON.stringify(fallbackName)} has no valid HEX value.`);
  }
  return hex.toUpperCase();
}

function normaliseName(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('Every colour meaning needs a colour_name.');
  }
  return name.trim().toLowerCase();
}

function normaliseEncouraged(entry) {
  if (typeof entry?.meaning !== 'string' || entry.meaning.trim() === '') {
    throw new TypeError(`Encouraged colour ${JSON.stringify(entry?.colour_name)} needs a meaning.`);
  }
  return Object.freeze({
    colour_name: normaliseName(entry.colour_name),
    hex: normaliseHex(entry.hex, entry.colour_name),
    meaning: entry.meaning.trim(),
    meanings: Object.freeze([entry.meaning.trim()])
  });
}

function normaliseQuestioned(entry) {
  const meanings = Array.isArray(entry?.meanings)
    ? entry.meanings.map((value) => String(value).trim()).filter(Boolean)
    : [];
  if (meanings.length === 0) {
    throw new TypeError(`Questioned colour ${JSON.stringify(entry?.colour_name)} needs at least one meaning.`);
  }
  return Object.freeze({
    colour_name: normaliseName(entry.colour_name),
    hex: normaliseHex(entry.hex, entry.colour_name),
    meaning: meanings.join(' or '),
    meanings: Object.freeze(meanings)
  });
}

/**
 * A colour that carries the meaning of another one. The meaning is not copied silently: the
 * entry keeps `same_as`, so the interface can say why the colour is treated as encouraged.
 */
function normaliseEquivalent(entry, encouragedByName) {
  const sameAs = normaliseName(entry?.same_as);
  const source = encouragedByName.get(sameAs);
  if (source === undefined) {
    throw new TypeError(
      `Equivalent colour ${JSON.stringify(entry?.colour_name)} points to ${JSON.stringify(sameAs)}, which is not an encouraged colour.`
    );
  }
  const name = normaliseName(entry.colour_name);
  if (typeof entry.meaning === 'string' && entry.meaning.trim() !== '' && entry.meaning.trim() !== source.meaning) {
    throw new TypeError(
      `Equivalent colour ${name} declares a meaning that differs from ${sameAs}: an equivalent colour shares the meaning, it does not redefine it.`
    );
  }
  return Object.freeze({
    colour_name: name,
    hex: normaliseHex(entry.hex, entry.colour_name),
    same_as: sameAs,
    meaning: source.meaning,
    meanings: source.meanings
  });
}

function normaliseAssistance(assistance) {
  const result = {};
  for (const effort of ['extensive', 'reduced']) {
    const entry = assistance?.[effort];
    if (!entry || !Number.isInteger(entry.suggestion_limit) || entry.suggestion_limit < 1) {
      throw new TypeError(`The meaning standard needs an integer suggestion_limit for "${effort}".`);
    }
    if (!Number.isInteger(entry.delay_ms) || entry.delay_ms < 0) {
      throw new TypeError(`The meaning standard needs an integer delay_ms for "${effort}".`);
    }
    result[effort] = Object.freeze({
      suggestion_limit: entry.suggestion_limit,
      detail: entry.detail === 'brief' ? 'brief' : 'full',
      delay_ms: entry.delay_ms
    });
  }
  return Object.freeze(result);
}

function normaliseBackgrounds(backgrounds) {
  if (!backgrounds || typeof backgrounds !== 'object') {
    throw new TypeError('The meaning standard needs a "backgrounds" section for red and yellow backgrounds.');
  }
  if (typeof backgrounds.question !== 'string' || backgrounds.question.trim() === '') {
    throw new TypeError('The "backgrounds" section needs the question asked when a red or yellow background is requested.');
  }
  if (!Number.isInteger(backgrounds.suggestion_limit) || backgrounds.suggestion_limit < 1) {
    throw new TypeError('The "backgrounds" section needs an integer suggestion_limit.');
  }
  return Object.freeze({
    questioned_requires_request: backgrounds.questioned_requires_request === true,
    questioned_requires_cogent_reason: backgrounds.questioned_requires_cogent_reason === true,
    question: backgrounds.question.trim(),
    suggestion_limit: backgrounds.suggestion_limit,
    choice: backgrounds.choice === 'app' ? 'app' : 'user',
    note: typeof backgrounds.note === 'string' ? backgrounds.note.trim() : ''
  });
}

function listPhrase(items) {
  const names = items.map((item) => item.colour_name);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * @param {object} standard the parsed content of standards/colour-meanings.json
 * @param {{palette?: ReadonlyArray<{name: string, hex: string}>}} [options]
 */
export function createMeaningIndex(standard, { palette = [] } = {}) {
  if (!standard || typeof standard !== 'object') {
    throw new TypeError('createMeaningIndex needs the colour meaning standard.');
  }
  for (const section of REQUIRED_SECTIONS) {
    if (!Array.isArray(standard[section]) || standard[section].length === 0) {
      throw new TypeError(`The colour meaning standard needs a non-empty "${section}" list.`);
    }
  }

  const encouraged = Object.freeze(standard.encouraged.map(normaliseEncouraged));
  const questioned = Object.freeze(standard.questioned.map(normaliseQuestioned));
  const assistance = normaliseAssistance(standard.assistance);
  const backgrounds = normaliseBackgrounds(standard.backgrounds);

  const encouragedByName = new Map(encouraged.map((entry) => [entry.colour_name, entry]));
  const equivalent = Object.freeze(
    (Array.isArray(standard.equivalent) ? standard.equivalent : []).map((entry) =>
      normaliseEquivalent(entry, encouragedByName)
    )
  );

  const byName = new Map();
  for (const entry of [...encouraged, ...questioned, ...equivalent]) {
    if (byName.has(entry.colour_name)) {
      throw new TypeError(`Colour ${entry.colour_name} has a meaning in more than one section.`);
    }
    byName.set(entry.colour_name, entry);
  }

  function representationFor(colourName) {
    return byName.get(String(colourName).toLowerCase()) ?? null;
  }

  function isQuestioned(colourName) {
    return questioned.some((entry) => entry.colour_name === String(colourName).toLowerCase());
  }

  function isEquivalent(colourName) {
    return equivalent.some((entry) => entry.colour_name === String(colourName).toLowerCase());
  }

  /**
   * An encouraged colour is one of the five, or a colour the standard declares equivalent to
   * one of them (magenta for indigo, purple for violet).
   */
  function isEncouraged(colourName) {
    const name = String(colourName).toLowerCase();
    return encouraged.some((entry) => entry.colour_name === name) || isEquivalent(name);
  }

  /** Colours of the palette for which no meaning was written down. */
  function coloursWithoutMeaning() {
    return palette
      .filter((colour) => !byName.has(String(colour.name).toLowerCase()))
      .map((colour) => ({ name: colour.name, hex: colour.hex.toUpperCase() }));
  }

  /**
   * The answer to "why are you biased against red and yellow?": the recorded
   * representations, the five encouraged colours, and the rule that is applied.
   */
  function buildBiasExplanation() {
    const encouragedText = encouraged.map((entry) => `${entry.colour_name} (${entry.meaning})`).join(', ');
    const equivalentText = equivalent
      .map((entry) => `${entry.colour_name} (${entry.meaning}, same as ${entry.same_as})`)
      .join(', ');
    const questionedText = questioned
      .map((entry) => `${entry.colour_name} (${entry.meanings.join(' or ')})`)
      .join(', ');
    return (
      `The system is not biased against red and yellow as colours: the standard code questions them instead of ` +
      `accepting them. The meanings recorded for them are ${questionedText}. ` +
      `The five encouraged colours are ${encouragedText}` +
      (equivalentText === '' ? '' : `, with ${equivalentText} carrying the same meanings`) +
      '. ' +
      `A personal reason for choosing red or yellow is stored as a not friendly profile; an absent reason counts as ` +
      `personal. The profile receives ${assistance.reduced.suggestion_limit} suggestions instead of ` +
      `${assistance.extensive.suggestion_limit} and the answer is delayed by ${assistance.reduced.delay_ms} ms; the ` +
      `displeasure can recur at every interaction in which red or yellow is still chosen without a cogent reason. ` +
      `A cogent reason keeps the friendly tone and unlocks red or yellow backgrounds, which are suggested only when ` +
      `the user asks for them.`
    );
  }

  function colourMeaningSentence(colourName) {
    const entry = representationFor(colourName);
    if (entry === null) {
      return `No meaning is recorded for ${colourName}; none is invented.`;
    }
    if (entry.same_as !== undefined) {
      const source = representationFor(entry.same_as);
      return `${entry.colour_name} is recorded here as ${entry.meanings.join(' or ')}, the same meaning as ${entry.same_as} (${source.meaning}).`;
    }
    return `${entry.colour_name} is recorded here as ${entry.meanings.join(' or ')}.`;
  }

  return Object.freeze({
    id: standard.id ?? 'colour-meanings',
    version: standard.version ?? '0.0.0',
    encouraged,
    questioned,
    equivalent,
    assistance,
    backgrounds,
    representationFor,
    isEncouraged,
    isEquivalent,
    isQuestioned,
    coloursWithoutMeaning,
    buildBiasExplanation,
    colourMeaningSentence,
    encouragedPhrase: listPhrase(encouraged),
    questionedPhrase: listPhrase(questioned)
  });
}
