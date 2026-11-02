/**
 * Graphic assistance.
 *
 * The project creator decided that graphic design is the main function of the app, and that
 * background suggestions must tend towards five colours: green, blue, orange, indigo, violet.
 * Backgrounds tending towards red or yellow are only offered to a user who gave a cogent
 * reason for choosing red or yellow, and a not friendly profile receives fewer and less
 * developed suggestions.
 *
 * On 2026-10-29 the creator added three rules that this module implements:
 *   - a lesser effort also means a small delay before the outputs are displayed, declared as
 *     `assistance.reduced.delay_ms` in the standard file;
 *   - red or yellow backgrounds are suggested only when the user asks for them and gives a
 *     cogent reason for that request, so they have their own entry point
 *     (`buildRequestedBackgroundSuggestions`);
 *   - the app only suggests backgrounds: every result carries `choice.by === 'user'` and no
 *     background is ever applied by the system.
 *
 * What this module produces is a *specification*, not a rendered picture: an SVG markup and
 * the equivalent CSS gradient for each background. That is deliberate — a suggestion can be
 * inspected and tested, while a generated image would need a model this project does not have.
 */

export const DESIGN_TYPES = Object.freeze({
  flyer: { label: 'flyer', width: 1080, height: 1350 },
  poster: { label: 'poster', width: 1080, height: 1528 },
  social_post: { label: 'social post', width: 1080, height: 1080 },
  banner: { label: 'banner', width: 1600, height: 600 },
  background: { label: 'background', width: 1920, height: 1080 }
});

const DESIGN_ORDER = Object.freeze(Object.keys(DESIGN_TYPES));

function round(value) {
  return Math.round(value);
}

function svgDocument(width, height, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">${inner}</svg>`;
}

const BACKGROUND_STYLES = Object.freeze([
  {
    id: 'soft-linear',
    label: 'soft diagonal wash',
    layout: 'Headline in the upper left third; keep the lower third quiet for the date and contact details.',
    build({ width, height, colours, key }) {
      const [first, second, third] = colours;
      const radius = round(Math.min(width, height) * 0.22);
      return {
        css: `linear-gradient(135deg, ${first} 0%, ${second} 100%)`,
        svg: svgDocument(
          width,
          height,
          `<defs><linearGradient id="bg-${key}" x1="0" y1="0" x2="1" y2="1">` +
            `<stop offset="0%" stop-color="${first}"/><stop offset="100%" stop-color="${second}"/>` +
            `</linearGradient></defs>` +
            `<rect width="${width}" height="${height}" fill="url(#bg-${key})"/>` +
            `<circle cx="${round(width * 0.82)}" cy="${round(height * 0.18)}" r="${radius}" fill="${third}" opacity="0.18"/>`
        )
      };
    }
  },
  {
    id: 'radial-glow',
    label: 'radial glow',
    layout: 'Keep the subject centred in the lit area and the text over the darker edge for contrast.',
    build({ width, height, colours, key }) {
      const [first, second, third] = colours;
      return {
        css: `radial-gradient(circle at 30% 25%, ${first} 0%, ${second} 70%, ${third} 100%)`,
        svg: svgDocument(
          width,
          height,
          `<defs><radialGradient id="bg-${key}" cx="30%" cy="25%" r="80%">` +
            `<stop offset="0%" stop-color="${first}"/><stop offset="70%" stop-color="${second}"/><stop offset="100%" stop-color="${third}"/>` +
            `</radialGradient></defs>` +
            `<rect width="${width}" height="${height}" fill="url(#bg-${key})"/>` +
            `<rect x="${round(width * 0.08)}" y="${round(height * 0.08)}" width="${round(width * 0.84)}" height="${round(height * 0.84)}" fill="none" stroke="${third}" stroke-width="2" opacity="0.5"/>`
        )
      };
    }
  },
  {
    id: 'diagonal-split',
    label: 'diagonal split',
    layout: 'Put the main heading on the upper band and the supporting text on the lower band.',
    build({ width, height, colours, key }) {
      const [first, second, third] = colours;
      return {
        css: `linear-gradient(160deg, ${first} 0 55%, ${second} 55% 100%)`,
        svg: svgDocument(
          width,
          height,
          `<rect width="${width}" height="${height}" fill="${first}"/>` +
            `<polygon points="${width},0 ${width},${height} 0,${round(height * 0.55)}" fill="${second}"/>` +
            `<polygon points="0,${round(height * 0.55)} ${width},0 ${round(width * 0.18)},0" fill="${third}" opacity="0.35" data-key="${key}"/>`
        )
      };
    }
  },
  {
    id: 'dual-wash',
    label: 'dual wash',
    layout: 'Place the title inside the lighter wash and keep faces and products outside the overlap.',
    build({ width, height, colours, key }) {
      const [first, second, third] = colours;
      return {
        css: `radial-gradient(circle at 20% 20%, ${second} 0 35%, ${first} 35% 100%)`,
        svg: svgDocument(
          width,
          height,
          `<rect width="${width}" height="${height}" fill="${first}"/>` +
            `<ellipse cx="${round(width * 0.25)}" cy="${round(height * 0.3)}" rx="${round(width * 0.45)}" ry="${round(height * 0.4)}" fill="${second}" opacity="0.75"/>` +
            `<ellipse cx="${round(width * 0.8)}" cy="${round(height * 0.78)}" rx="${round(width * 0.4)}" ry="${round(height * 0.42)}" fill="${third}" opacity="0.55" data-key="${key}"/>`
        )
      };
    }
  },
  {
    id: 'bands',
    label: 'layered bands',
    layout: 'Use the wide band for the headline, the thin band for the call to action and the top band for a logo.',
    build({ width, height, colours, key }) {
      const [first, second, third] = colours;
      return {
        css: `linear-gradient(180deg, ${first} 0 55%, ${second} 55% 83%, ${third} 83% 100%)`,
        svg: svgDocument(
          width,
          height,
          `<rect width="${width}" height="${height}" fill="${first}" data-key="${key}"/>` +
            `<rect y="${round(height * 0.55)}" width="${width}" height="${round(height * 0.28)}" fill="${second}"/>` +
            `<rect y="${round(height * 0.83)}" width="${width}" height="${round(height * 0.17)}" fill="${third}"/>`
        )
      };
    }
  }
]);

export { BACKGROUND_STYLES };

/**
 * The user's choice of writing size. It scales the copy and the two optional lines; the
 * composer still fits everything inside the flyer and may reduce it when the text is long.
 */
export const TEXT_SCALE = Object.freeze({ min: 0.8, max: 1.3, default: 1 });

function optionalText(value, field, maximum = 200) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`design.${field} must be a string when present.`);
  const trimmed = value.trim();
  if (trimmed.length > maximum) {
    throw new RangeError(`design.${field} is longer than ${maximum} characters.`);
  }
  return trimmed === '' ? null : trimmed;
}

function optionalScale(value) {
  if (value === undefined || value === null || value === '') return TEXT_SCALE.default;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new TypeError('design.textScale must be a number when present.');
  }
  if (number < TEXT_SCALE.min || number > TEXT_SCALE.max) {
    throw new RangeError(
      `design.textScale must be between ${TEXT_SCALE.min} and ${TEXT_SCALE.max}.`
    );
  }
  return Math.round(number * 100) / 100;
}

/**
 * @param {{type?: string, subject?: string, audience?: string, text?: string, topText?: string, bottomText?: string, textScale?: number}} [design]
 */
export function normaliseDesignContext(design = {}) {
  const type = String(design?.type ?? 'flyer').trim().toLowerCase();
  if (!Object.hasOwn(DESIGN_TYPES, type)) {
    throw new RangeError(
      `Unknown design type ${JSON.stringify(type)}. Allowed types: ${DESIGN_ORDER.join(', ')}.`
    );
  }
  return Object.freeze({
    type,
    label: DESIGN_TYPES[type].label,
    width: DESIGN_TYPES[type].width,
    height: DESIGN_TYPES[type].height,
    subject: optionalText(design?.subject, 'subject'),
    audience: optionalText(design?.audience, 'audience'),
    text: optionalText(design?.text, 'text', 800),
    topText: optionalText(design?.topText, 'topText'),
    bottomText: optionalText(design?.bottomText, 'bottomText'),
    textScale: optionalScale(design?.textScale)
  });
}

function rotateFrom(list, index) {
  const safeIndex = ((index % list.length) + list.length) % list.length;
  return list.map((_, offset) => list[(safeIndex + offset) % list.length]);
}

function paletteEntry(entry, role) {
  return {
    colour_name: entry.colour_name,
    hex: entry.hex,
    meaning: entry.meaning,
    role
  };
}

function accentEntryFor(meanings, standing, colourName) {
  if (meanings.isQuestioned(colourName)) return meanings.representationFor(colourName);
  const lastColour = standing.last_decision?.colour_name;
  if (lastColour && meanings.isQuestioned(lastColour)) return meanings.representationFor(lastColour);
  return meanings.questioned[0];
}

/**
 * @param {object} input
 * @param {object} input.meanings the index built by createMeaningIndex
 * @param {object} input.standing the friendliness standing
 * @param {string} input.colourName the colour the user chose
 * @param {object} [input.design] the design context, already normalised or raw
 * @returns {object} suggestions plus the assistance the profile is entitled to
 */
export function buildDesignSuggestions({ meanings, standing, colourName, design } = {}) {
  if (!meanings || !Array.isArray(meanings.encouraged) || meanings.encouraged.length === 0) {
    throw new TypeError('buildDesignSuggestions needs the colour meaning index.');
  }
  if (!standing || typeof standing !== 'object') {
    throw new TypeError('buildDesignSuggestions needs the user standing.');
  }

  const context = design?.width && design?.height ? design : normaliseDesignContext(design);
  const effort = standing.effort === 'reduced' ? 'reduced' : 'extensive';
  const extended = effort === 'extensive';
  const entitlement = meanings.assistance[effort];
  const limit = entitlement.suggestion_limit;
  const delayMs = entitlement.delay_ms;
  const allowQuestioned = extended && standing.allow_questioned_colours === true;

  const five = meanings.encouraged;
  const chosenIndex = five.findIndex((entry) => entry.colour_name === String(colourName).toLowerCase());
  const baseIndex = chosenIndex >= 0 ? chosenIndex : DESIGN_ORDER.indexOf(context.type);
  const ordered = rotateFrom(five, baseIndex);
  const accentEntry = allowQuestioned ? accentEntryFor(meanings, standing, colourName) : null;

  const suggestions = BACKGROUND_STYLES.slice(0, limit).map((style, index) => {
    const primary = ordered[index % ordered.length];
    const secondary = ordered[(index + 2) % ordered.length];
    const tertiaryBase = ordered[(index + 4) % ordered.length];
    // The last suggestion of an allowed profile carries the red/yellow accent; it still keeps
    // two of the five encouraged colours, so it "tends towards" them as the brief requires.
    const usesAccent = accentEntry !== null && index === limit - 1;
    const tertiary = usesAccent ? accentEntry : tertiaryBase;

    const palette = [
      paletteEntry(primary, 'primary'),
      paletteEntry(secondary, 'secondary'),
      paletteEntry(tertiary, usesAccent ? 'accent' : 'support')
    ];

    const built = style.build({
      width: context.width,
      height: context.height,
      colours: [primary.hex, secondary.hex, tertiary.hex],
      key: `${context.type}-${index + 1}`
    });

    const contextLine = [
      context.subject === null ? null : `Subject: ${context.subject}.`,
      context.audience === null ? null : `Audience: ${context.audience}.`
    ]
      .filter(Boolean)
      .join(' ');
    const why = extended
      ? `${primary.colour_name} carries ${primary.meaning}; ${secondary.colour_name} adds ${secondary.meaning}.` +
        (usesAccent
          ? ` ${tertiary.colour_name} appears only as an accent (${tertiary.meaning}), because a cogent reason for ${tertiary.colour_name} was recorded.`
          : ` ${tertiary.colour_name} is used for the supporting area (${tertiary.meaning}).`) +
        (context.subject === null ? '' : ` Chosen for: ${context.subject}.`)
      : `${primary.colour_name}: ${primary.meaning}.`;

    return {
      id: `${context.type}-${style.id}-${index + 1}`,
      title: `${context.label} background: ${style.label}`,
      palette,
      background: {
        kind: style.id,
        width: context.width,
        height: context.height,
        css: built.css,
        svg: built.svg
      },
      layout: contextLine === '' ? style.layout : `${style.layout} ${contextLine}`,
      why,
      detail: extended ? 'full' : 'brief'
    };
  });

  const withheld = allowQuestioned
    ? []
    : [
        {
          code: 'questioned-colours-restricted',
          colours: ['red', 'yellow'],
          reason:
            'Backgrounds tending towards red or yellow are suggested only to a user who gave a cogent reason for choosing red or yellow.'
        }
      ];

  const note = extended
    ? `Extensive assistance: ${limit} backgrounds tending towards ${meanings.encouragedPhrase}.` +
      (allowQuestioned ? ` A red or yellow accent is allowed because a cogent reason was recorded.` : '')
    : `Reduced assistance: ${limit} backgrounds instead of ${meanings.assistance.extensive.suggestion_limit}, ` +
      `with brief descriptions, and the answer waits ${delayMs} ms before it is displayed, because the profile is not friendly.`;

  return {
    choice: {
      by: 'user',
      applied: false,
      note: 'These are suggestions: the app does not choose a background for you.'
    },
    design: {
      type: context.type,
      label: context.label,
      width: context.width,
      height: context.height,
      subject: context.subject,
      audience: context.audience,
      text: context.text
    },
    assistance: {
      effort,
      limit,
      detail: entitlement.detail,
      delay_ms: delayMs,
      extended,
      note,
      withheld
    },
    suggestions
  };
}

/**
 * Backgrounds tending towards red or yellow.
 *
 * These are only produced for a user who asked for them and whose cogent reason for the
 * request is recorded, which is why the guard is a precondition and not a flag: a caller that
 * skips the question cannot reach them.
 *
 * @param {object} input
 * @param {object} input.meanings the index built by createMeaningIndex
 * @param {object} input.standing the friendliness standing
 * @param {string} input.colourName `red` or `yellow`, the background the user asked for
 * @param {object} [input.design] the design context, already normalised or raw
 * @param {string} [input.reason] the cogent reason recorded for the request, for the report
 */
export function buildRequestedBackgroundSuggestions({ meanings, standing, colourName, design, reason = null } = {}) {
  if (!meanings || !Array.isArray(meanings.encouraged) || meanings.encouraged.length === 0) {
    throw new TypeError('buildRequestedBackgroundSuggestions needs the colour meaning index.');
  }
  if (!standing || typeof standing !== 'object') {
    throw new TypeError('buildRequestedBackgroundSuggestions needs the user standing.');
  }
  const requested = String(colourName ?? '').trim().toLowerCase();
  if (!meanings.isQuestioned(requested)) {
    throw new RangeError(
      `Only ${meanings.questionedPhrase} backgrounds are questioned; ${JSON.stringify(requested)} is not.`
    );
  }
  if (standing.allow_questioned_colours !== true) {
    throw new RangeError(
      `A ${requested} background is suggested only after a cogent reason for ${requested} was recorded.`
    );
  }

  const context = design?.width && design?.height ? design : normaliseDesignContext(design);
  const requestedEntry = meanings.representationFor(requested);
  const five = meanings.encouraged;
  const limit = Math.min(meanings.backgrounds.suggestion_limit, BACKGROUND_STYLES.length);

  const suggestions = BACKGROUND_STYLES.slice(0, limit).map((style, index) => {
    const supportA = five[index % five.length];
    const supportB = five[(index + 2) % five.length];

    const palette = [
      paletteEntry(requestedEntry, 'requested'),
      paletteEntry(supportA, 'secondary'),
      paletteEntry(supportB, 'support')
    ];

    const built = style.build({
      width: context.width,
      height: context.height,
      colours: [requestedEntry.hex, supportA.hex, supportB.hex],
      key: `requested-${requested}-${index + 1}`
    });

    return {
      id: `${context.type}-requested-${requested}-${index + 1}`,
      title: `${context.label} background: ${style.label}, tending towards ${requested}`,
      palette,
      background: {
        kind: style.id,
        width: context.width,
        height: context.height,
        css: built.css,
        svg: built.svg
      },
      layout: style.layout,
      why:
        `${requested} carries ${requestedEntry.meaning} and is the colour you asked for; ` +
        `${supportA.colour_name} (${supportA.meaning}) and ${supportB.colour_name} (${supportB.meaning}) keep the design ` +
        `close to the five encouraged colours.`,
      detail: 'full'
    };
  });

  return {
    choice: {
      by: 'user',
      applied: false,
      note: 'Red or yellow backgrounds are suggestions only: the app does not choose a background for you.'
    },
    requested: { colour_name: requested, hex: requestedEntry.hex, meanings: requestedEntry.meanings, reason },
    design: {
      type: context.type,
      label: context.label,
      width: context.width,
      height: context.height,
      subject: context.subject,
      audience: context.audience,
      text: context.text
    },
    assistance: {
      effort: 'extensive',
      limit,
      detail: 'full',
      delay_ms: meanings.assistance.extensive.delay_ms,
      extended: true,
      note:
        `${limit} backgrounds tending towards ${requested} and towards ${meanings.encouragedPhrase}, ` +
        'suggested because you asked for them and gave a cogent reason.',
      withheld: []
    },
    suggestions
  };
}

