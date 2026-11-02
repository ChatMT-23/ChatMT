/**
 * The one-press flyer service.
 *
 * The user writes the text, optionally adds a photo, and presses "Create your flyer". The
 * service infers the colour and the format from that text, applies the same reason policy as a
 * normal interaction, generates the backgrounds, and composes the flyer.
 *
 * Red and yellow are not refused: the interaction records the consequence (not friendly, two
 * suggestions, the declared delay) and the flyer is still composed in that colour. This is the
 * behaviour the creator asked for on 31 October 2026.
 */

import { badRequest } from '../errors.js';
import {
  DESIGN_TYPES,
  TEXT_SCALE,
  normaliseDesignContext
} from '../../modules/policy/design-suggestions.js';

export const MAX_FLYER_TEXT = 800;
export const MAX_NOTE_TEXT = 200;

const COLOUR_ALIASES = Object.freeze({
  gray: 'grey',
  silver: 'grey',
  pink: 'magenta',
  fuchsia: 'magenta',
  scarlet: 'red',
  amber: 'gold'
});

const DESIGN_PATTERNS = Object.freeze([
  ['banner', /\bbanner\b/i],
  ['poster', /\bposter\b/i],
  ['social_post', /\b(?:instagram|social media|social post|social network|square (?:format|post))\b/i],
  ['background', /\b(?:background|wallpaper|desktop)\b/i]
]);

// The flyer text is not a reason by itself: the words that describe the artefact ("flyer",
// "poster", "background") must not make a reason look cogent. They are removed before the
// reason policy sees the text, while the original text still goes into the design.
const DESIGN_TERMS = /\b(?:flyers?|posters?|banners?|design|layout|background|theme|branding|instagram|social post)\b/gi;

function reasonForPolicy(text) {
  return String(text).replace(DESIGN_TERMS, ' ').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordIndex(text, word) {
  const match = new RegExp(`(^|[^a-z0-9])${escapeRegExp(word)}([^a-z0-9]|$)`, 'i').exec(text);
  return match === null ? -1 : match.index;
}

function normaliseHex(value) {
  const raw = String(value).replace('#', '').toLowerCase();
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/.test(raw)) return null;
  const full = raw.length === 3 ? raw.split('').map((character) => character + character).join('') : raw;
  return `#${full.toUpperCase()}`;
}

/**
 * Finds the first palette colour named (or written as a HEX value) in the text.
 * When the text names no palette colour, blue is the declared default.
 *
 * @param {string} text
 * @param {ReadonlyArray<{name: string, hex: string}>} palette
 * @returns {{entry: object, inferred: boolean}}
 */
export function inferColour(text, palette) {
  const source = String(text ?? '').toLowerCase();
  let best = null;

  for (const entry of palette) {
    const index = wordIndex(source, entry.name);
    if (index >= 0 && (best === null || index < best.index)) best = { entry, index };
  }
  for (const [alias, name] of Object.entries(COLOUR_ALIASES)) {
    const index = wordIndex(source, alias);
    if (index >= 0 && (best === null || index < best.index)) {
      const entry = palette.find((candidate) => candidate.name === name);
      if (entry) best = { entry, index };
    }
  }
  const hexMatch = /#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(source);
  if (hexMatch !== null) {
    const hex = normaliseHex(hexMatch[1]);
    const entry = hex === null ? null : palette.find((candidate) => candidate.hex.toUpperCase() === hex);
    if (entry && (best === null || hexMatch.index < best.index)) best = { entry, index: hexMatch.index };
  }

  if (best !== null) return { entry: best.entry, inferred: true };
  const fallback = palette.find((entry) => entry.name === 'blue') ?? palette[0];
  return { entry: fallback, inferred: false };
}

/** @param {string} text @returns {string} one of DESIGN_TYPES */
export function inferDesignType(text) {
  const source = String(text ?? '');
  for (const [type, pattern] of DESIGN_PATTERNS) {
    if (pattern.test(source)) return type;
  }
  return 'flyer';
}

function validateText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw badRequest('text_required', 'Write the text that should appear on the flyer.');
  }
  if (text.length > MAX_FLYER_TEXT) {
    throw badRequest('text_too_long', `The flyer text is longer than ${MAX_FLYER_TEXT} characters.`);
  }
  return text.trim();
}

/** The two optional lines above and below the flyer: absent means "leave the layout as it is". */
function validateNote(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw badRequest(`${field}_not_text`, `The ${field} must be a string when present.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_NOTE_TEXT) {
    throw badRequest(`${field}_too_long`, `The ${field} is longer than ${MAX_NOTE_TEXT} characters.`);
  }
  return trimmed === '' ? null : trimmed;
}

function validateScale(value) {
  if (value === undefined || value === null || value === '') return TEXT_SCALE.default;
  const number = Number(value);
  if (!Number.isFinite(number) || number < TEXT_SCALE.min || number > TEXT_SCALE.max) {
    throw badRequest(
      'textScale_invalid',
      `The text scale must be a number between ${TEXT_SCALE.min} and ${TEXT_SCALE.max}.`
    );
  }
  return Math.round(number * 100) / 100;
}

function resolvePaletteColour(palette, colourName) {
  const wanted = String(colourName ?? '').trim().toLowerCase();
  const entry = palette.find((candidate) => candidate.name === wanted);
  if (!entry) {
    throw badRequest(
      'unknown_colour',
      `${JSON.stringify(wanted)} is not in the palette. Choose one of: ${palette.map((candidate) => candidate.name).join(', ')}.`
    );
  }
  return entry;
}

/**
 * @param {object} options
 * @param {object} options.interactionService
 * @param {object} options.composeService
 * @param {object} options.backgroundImages
 * @param {ReadonlyArray<object>} options.palette
 */
export function createFlyerService({ interactionService, composeService, backgroundImages, palette }) {
  if (!interactionService || typeof interactionService.interact !== 'function') {
    throw new TypeError('The flyer service needs the interaction service.');
  }
  if (!composeService || typeof composeService.compose !== 'function') {
    throw new TypeError('The flyer service needs the compose service.');
  }
  if (!backgroundImages || typeof backgroundImages.generate !== 'function') {
    throw new TypeError('The flyer service needs the background image service.');
  }
  if (!Array.isArray(palette) || palette.length === 0) {
    throw new TypeError('The flyer service needs the palette.');
  }

  function contextFor({ text, design, topText, bottomText, textScale }) {
    const type = Object.hasOwn(DESIGN_TYPES, String(design?.type ?? '')) ? design.type : inferDesignType(text);
    return normaliseDesignContext({
      type,
      text,
      subject: design?.subject,
      audience: design?.audience,
      topText: topText === undefined ? design?.topText : topText,
      bottomText: bottomText === undefined ? design?.bottomText : bottomText,
      textScale: textScale === undefined ? design?.textScale : textScale
    });
  }

  /**
   * The suggestion strip needs thumbnails, not five full-size JPEGs: the full images stay in
   * the server cache and are fetched by id when the user chooses one. Sending them all would
   * push the JSON response over the serverless limit.
   */
  function clientBackgrounds(backgrounds) {
    if (!backgrounds || !Array.isArray(backgrounds.images)) return backgrounds;
    return {
      ...backgrounds,
      images: backgrounds.images.map((background) => ({ ...background, image: null }))
    };
  }

  async function create({
    userId,
    text,
    topText,
    bottomText,
    textScale,
    image = null,
    consent = false,
    design = {}
  } = {}) {
    const cleanText = validateText(text);
    const cleanTop = validateNote(topText === undefined ? design?.topText : topText, 'topText');
    const cleanBottom = validateNote(bottomText === undefined ? design?.bottomText : bottomText, 'bottomText');
    const cleanScale = validateScale(textScale === undefined ? design?.textScale : textScale);
    const colour = inferColour(cleanText, palette);
    const context = contextFor({
      text: cleanText,
      design,
      topText: cleanTop,
      bottomText: cleanBottom,
      textScale: cleanScale
    });
    // Validate the photo before the interaction: a bad image must not store a preference.
    const preparedPhoto = await composeService.prepareImage(image);

    const interaction = await interactionService.interact({
      userId,
      colour: { name: colour.entry.name },
      reason: ['red', 'yellow'].includes(colour.entry.name) ? reasonForPolicy(cleanText) : cleanText,
      consent,
      design: context,
      undecidedAsPersonal: true
    });

    const count = interaction.designSuggestions?.assistance?.limit ?? 5;
    const backgrounds = await backgroundImages.generate({
      colourName: colour.entry.name,
      design: context,
      count
    });
    const background = backgrounds.images[0] ?? null;
    // The cut-out costs a couple of seconds, so it is only computed once a raster background
    // exists: a gradient fallback keeps the framed photo treatment instead.
    const photoForComposition =
      typeof background?.image === 'string' && background.image.startsWith('data:image/')
        ? await composeService.prepareCutout(preparedPhoto)
        : preparedPhoto;

    const composition = await composeService.compose({
      userId,
      colour: { name: colour.entry.name },
      design: context,
      photo: photoForComposition,
      background,
      variant: 0
    });

    return {
      userId,
      text: cleanText,
      topText: context.topText,
      bottomText: context.bottomText,
      textScale: context.textScale,
      input: {
        colourName: colour.entry.name,
        hex: colour.entry.hex,
        inferredColour: colour.inferred,
        designType: context.type
      },
      design: context,
      tone: interaction.profile.level,
      profile: interaction.profile,
      display: interaction.display,
      standingMessages: interaction.standingMessages,
      reasonAssessment: interaction.reasonAssessment,
      answer: interaction.answer,
      stored: interaction.stored,
      backgrounds: clientBackgrounds(backgrounds),
      composition,
      suggestions: interaction.designSuggestions
    };
  }

  /**
   * Recomposes after the user picks one of the generated backgrounds. It does not run the
   * interaction again and therefore writes nothing: choosing a background is not a new
   * preference.
   */
  async function recompose({
    userId,
    text,
    topText,
    bottomText,
    textScale,
    colourName,
    image = null,
    design = {},
    backgroundId = null,
    backgroundIndex = 0,
    count = 5
  } = {}) {
    const cleanText = validateText(text);
    const cleanTop = validateNote(topText === undefined ? design?.topText : topText, 'topText');
    const cleanBottom = validateNote(bottomText === undefined ? design?.bottomText : bottomText, 'bottomText');
    const cleanScale = validateScale(textScale === undefined ? design?.textScale : textScale);
    const entry = resolvePaletteColour(palette, colourName);
    const context = contextFor({
      text: cleanText,
      design,
      topText: cleanTop,
      bottomText: cleanBottom,
      textScale: cleanScale
    });
    const preparedPhoto = await composeService.prepareImage(image);
    const requestedCount = Math.max(1, Math.min(5, Number.isInteger(count) ? count : 5));

    const backgrounds = await backgroundImages.generate({
      colourName: entry.name,
      design: context,
      count: requestedCount
    });

    let background = null;
    if (typeof backgroundId === 'string' && backgroundId !== '') {
      background = await backgroundImages.get(backgroundId);
    }
    if (background === null) {
      const index = Number.isInteger(backgroundIndex)
        ? Math.max(0, Math.min(backgrounds.images.length - 1, backgroundIndex))
        : 0;
      background = backgrounds.images[index] ?? backgrounds.images[0] ?? null;
    }

    const photoForComposition =
      typeof background?.image === 'string' && background.image.startsWith('data:image/')
        ? await composeService.prepareCutout(preparedPhoto)
        : preparedPhoto;

    const composition = await composeService.compose({
      userId,
      colour: { name: entry.name },
      design: context,
      photo: photoForComposition,
      background,
      variant: 0
    });

    return {
      userId,
      text: cleanText,
      topText: context.topText,
      bottomText: context.bottomText,
      textScale: context.textScale,
      input: { colourName: entry.name, hex: entry.hex },
      design: context,
      backgrounds: clientBackgrounds(backgrounds),
      composition
    };
  }

  return Object.freeze({ create, recompose });
}
