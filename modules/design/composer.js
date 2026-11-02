/**
 * Automatic composition.
 *
 * The creator asked (30 October 2026) that the app carry out the graphic work itself, the way a
 * design assistant does: once the background colour is chosen, the app places the photo and
 * writes the text, and the user does none of it by hand.
 *
 * This module is that step, and it is deterministic on purpose: the same colour, photo and flyer
 * setup always produce the same design. Three things are never guessed:
 *   - the colours come from `standards/colour-meanings.json` and from the colour the user chose;
 *   - the words come from that recorded meaning plus the flyer setup (subject, audience), never
 *     from a model, so the text can be read and corrected;
 *   - the app composes, it does not choose the background: `choice.by` stays `user`, and the
 *     colour questioned by the standard (red, yellow) is still refused unless the recorded
 *     profile allows it.
 *
 * The result is an SVG document. It is never inserted into the page: the interface shows it as
 * an image (an object URL) and offers it for download, so the rule "no SVG markup in the
 * document, no innerHTML" still holds.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as fontkit from 'fontkit';

import { normaliseDesignContext } from '../policy/design-suggestions.js';

const XML_ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' });

const FONT_DIRECTORY = fileURLToPath(new URL('../../frontend/fonts/', import.meta.url));

function loadTypeface(fileName) {
  return fontkit.openSync(path.join(FONT_DIRECTORY, fileName));
}

/**
 * The flyer carries its own glyph outlines. Nothing depends on the fonts installed on the phone
 * or on the service that turns the SVG into a JPEG: the same curves are used everywhere.
 */
const TYPEFACES = Object.freeze({
  display: loadTypeface('Gloock-Regular.ttf'),
  body: loadTypeface('InstrumentSans-Regular.ttf'),
  bodyBold: loadTypeface('InstrumentSans-Bold.ttf'),
  mono: loadTypeface('GeistMono-Regular.ttf'),
  monoBold: loadTypeface('GeistMono-Bold.ttf')
});

function xml(value) {
  return String(value).replace(/[&<>"']/g, (character) => XML_ESCAPES[character]);
}

function round(value) {
  return Math.round(value);
}

function capitalise(text) {
  const raw = String(text);
  return raw.length === 0 ? raw : raw[0].toUpperCase() + raw.slice(1);
}

function hexToRgb(hex) {
  const value = String(hex).replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  const channel = (value) => Math.max(0, Math.min(255, round(value))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Mixes a colour towards white (ratio > 0) or towards black (target). Used for surfaces only. */
function mix(hex, target, ratio) {
  const from = hexToRgb(hex);
  const to = hexToRgb(target);
  return rgbToHex({
    r: from.r + (to.r - from.r) * ratio,
    g: from.g + (to.g - from.g) * ratio,
    b: from.b + (to.b - from.b) * ratio
  });
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The ink that keeps the text readable on a ground: dark on light colours, light on dark ones. */
function inkFor(hex) {
  return relativeLuminance(hex) > 0.42 ? '#14120e' : '#fbf8f1';
}

/** Width of a line in the same units resvg and the browser will draw. */
function textWidth(text, typeface, size, spacing = 0) {
  const value = String(text);
  const scale = size / typeface.unitsPerEm;
  const tracking = spacing === 0 ? 0 : spacing * Math.max(0, value.length - 1);
  return typeface.layout(value).advanceWidth * scale + tracking;
}

/** Word wrapping measured on the real glyphs, with a hard break for a word wider than the column. */
function wrapToWidth(text, typeface, size, maxWidth, spacing = 0) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  const fits = (value) => textWidth(value, typeface, size, spacing) <= maxWidth;

  for (const word of words) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line !== '') {
      lines.push(line);
      line = '';
    }
    if (fits(word)) {
      line = word;
      continue;
    }
    let chunk = '';
    for (const character of word) {
      if (fits(chunk + character)) {
        chunk += character;
      } else {
        if (chunk !== '') lines.push(chunk);
        chunk = character;
      }
    }
    line = chunk;
  }

  if (line !== '') lines.push(line);
  return lines.length === 0 ? [''] : lines;
}

const FONTS = Object.freeze({
  display: 'display',
  body: 'body',
  mono: 'mono'
});

function typefaceFor(font, weight) {
  if (font === FONTS.display) return TYPEFACES.display;
  if (font === FONTS.mono) return weight >= 600 ? TYPEFACES.monoBold : TYPEFACES.mono;
  return weight >= 600 ? TYPEFACES.bodyBold : TYPEFACES.body;
}

export const COMPOSITION_LAYOUTS = Object.freeze({
  showcase: {
    label: 'generated background, text on the scrim',
    for: 'the one-press flyer with a generated background'
  },
  'band-right': {
    label: 'text band left, photo right',
    for: 'wide formats (banner, background)'
  },
  stack: {
    label: 'photo above, text below',
    for: 'portrait formats (flyer, poster)'
  },
  cover: {
    label: 'full-bleed photo, text on the scrim',
    for: 'square formats (social post)'
  }
});

function layoutFor(width, height, hasBackground = false) {
  if (hasBackground) return 'showcase';
  const ratio = width / height;
  if (ratio >= 1.6) return 'band-right';
  if (ratio <= 0.95) return 'stack';
  return 'cover';
}

function splitUserText(text) {
  const raw = String(text ?? '').trim();
  if (raw === '') return null;
  const lines = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length > 1) {
    return { headline: lines[0], body: lines.slice(1).join(' ') };
  }
  const sentences = raw.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
  if (sentences.length > 1 && sentences[0].length <= 90) {
    return { headline: sentences[0], body: sentences.slice(1).join(' ') };
  }
  return { headline: raw, body: '' };
}

function buildCopy({ colourName, entry, context }) {
  const meaningPhrase = entry.meanings.join(' or ');
  const userCopy = splitUserText(context.text);
  const headline = userCopy?.headline ?? context.subject ?? `${capitalise(colourName)} — ${meaningPhrase}`;
  const subhead = context.audience === null ? null : `For ${context.audience}`;
  const body = userCopy
    ? userCopy.body === ''
      ? `${capitalise(colourName)} carries ${meaningPhrase}.`
      : userCopy.body
    : [
        `${capitalise(colourName)} carries ${meaningPhrase}.`,
        context.subject === null ? null : `${context.subject} is the subject, set in the colour you chose.`,
        context.audience === null ? null : `It speaks to ${context.audience}.`
      ]
        .filter(Boolean)
        .join(' ');
  return {
    kicker: `chatmt · ${context.label}`,
    topText: context.topText,
    headline,
    subhead,
    body,
    bottomText: context.bottomText,
    footer: `${colourName} · ${entry.hex} · ${context.width}×${context.height}`
  };
}

function svgDocument({ width, height, content, title, description = '' }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img">` +
    `<title>${xml(title)}</title>` +
    (description === '' ? '' : `<desc>${xml(description)}</desc>`) +
    `${content}</svg>`
  );
}

function photoLayer({ photo, x, y, width, height, id }) {
  return (
    `<defs><clipPath id="photo-${id}"><rect x="${x}" y="${y}" width="${width}" height="${height}"/></clipPath></defs>` +
    // "slice" is the automatic fit: the photo fills the frame without distortion, and the app
    // decides the crop instead of asking the user for one.
    `<image href="${photo.image}" x="${x}" y="${y}" width="${width}" height="${height}" ` +
    `preserveAspectRatio="xMidYMid slice" clip-path="url(#photo-${id})"/>`
  );
}

function scrimLayer({ x, y, width, height, colour, direction = 'vertical', id, stops = null }) {
  const list =
    Array.isArray(stops) && stops.length > 0
      ? stops
      : [
          { offset: 0, opacity: 0 },
          { offset: 1, opacity: 0.94 }
        ];
  const [x1, y1, x2, y2] = direction === 'vertical' ? [0, y, 0, y + height] : [x, 0, x + width, 0];
  return (
    `<defs><linearGradient id="scrim-${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ` +
    `gradientUnits="userSpaceOnUse">` +
    list
      .map(
        (stop) =>
          `<stop offset="${round(stop.offset * 100)}%" stop-color="${colour}" stop-opacity="${stop.opacity}"/>`
      )
      .join('') +
    `</linearGradient></defs>` +
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="url(#scrim-${id})"/>`
  );
}

function textPath({ text, x, y, size, fill, typeface, spacing = 0 }) {
  const value = String(text);
  if (value === '') return '';
  const scale = size / typeface.unitsPerEm;
  const run = typeface.layout(value);
  let cursor = x;
  let data = '';
  for (let index = 0; index < run.glyphs.length; index++) {
    const glyph = run.glyphs[index];
    const position = run.positions[index];
    if (glyph.path.commands.length > 0) {
      data += glyph.path
        .scale(scale, -scale)
        .translate(cursor + (position.xOffset ?? 0) * scale, y + (position.yOffset ?? 0) * scale)
        .toSVG();
    }
    cursor += position.xAdvance * scale + spacing;
  }
  return data === '' ? '' : `<path d="${data}" fill="${fill}"/>`;
}

function textLines({ lines, x, y, lineHeight, size, fill, font, weight = 400, spacing = 0 }) {
  const typeface = typefaceFor(font, weight);
  return lines
    .map((line, index) =>
      textPath({
        text: line,
        x,
        y: y + index * lineHeight,
        size,
        fill,
        typeface,
        spacing
      })
    )
    .join('');
}

/**
 * The optional lines written by the user above and below the flyer. They are set in the mono
 * face so they read as notes, and measured with the same glyph engine as the rest of the copy.
 */
function buildNoteBlock(text, { size, maxWidth, spacing = 0 }) {
  const lines = wrapToWidth(text, TYPEFACES.monoBold, size, maxWidth, spacing);
  const lineHeight = Math.round(size * 1.4);
  return {
    lines,
    size,
    lineHeight,
    spacing,
    height: size + (lines.length - 1) * lineHeight
  };
}

function noteLayer({ note, x, firstBaseline, fill }) {
  return textLines({
    lines: note.lines,
    x,
    y: firstBaseline,
    lineHeight: note.lineHeight,
    size: note.size,
    fill,
    font: FONTS.mono,
    weight: 700,
    spacing: note.spacing
  });
}

/** A soft dark wash at the top, used only when a user line has to sit over a picture. */
function topNoteScrim({ width, height, id }) {
  return scrimLayer({
    x: 0,
    y: 0,
    width,
    height,
    colour: '#10161a',
    id,
    stops: [
      { offset: 0, opacity: 0.86 },
      { offset: 0.55, opacity: 0.62 },
      { offset: 1, opacity: 0 }
    ]
  });
}

function geometricField({ x, y, width, height, colour, id }) {
  const light = mix(colour, '#ffffff', 0.34);
  const deep = mix(colour, '#000000', 0.3);
  return (
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${colour}"/>` +
    `<circle cx="${round(x + width * 0.72)}" cy="${round(y + height * 0.28)}" r="${round(Math.min(width, height) * 0.3)}" fill="${light}" opacity="0.5"/>` +
    `<circle cx="${round(x + width * 0.34)}" cy="${round(y + height * 0.72)}" r="${round(Math.min(width, height) * 0.22)}" fill="${deep}" opacity="0.35"/>` +
    `<rect x="${round(x + width * 0.08)}" y="${round(y + height * 0.08)}" width="${round(width * 0.84)}" height="${round(height * 0.84)}" ` +
    `fill="none" stroke="${light}" stroke-width="2" opacity="0.45" data-field="${id}"/>`
  );
}

/**
 * Composes one design from the chosen colour, the optional photo and the flyer setup.
 *
 * @param {object} input
 * @param {object} input.meanings the index built by createMeaningIndex
 * @param {object} [input.standing] the friendliness standing, needed for red and yellow
 * @param {string} input.colourName the colour the user chose
 * @param {object} [input.design] the flyer setup (type, subject, audience, text)
 * @param {{image: string, width: number, height: number}|null} [input.photo] a prepared photo
 * @param {number} [input.variant] rotates the composition among a few layouts
 */
export function composeDesign({
  meanings,
  standing = null,
  colourName,
  design,
  photo = null,
  subject = null,
  backgroundImage = null,
  variant = 0
} = {}) {
  if (!meanings || typeof meanings.representationFor !== 'function') {
    throw new TypeError('composeDesign needs the colour meaning index.');
  }

  const requested = String(colourName ?? '').trim().toLowerCase();
  const entry = meanings.representationFor(requested);
  if (entry === null || entry === undefined) {
    throw new RangeError(`Unknown colour ${JSON.stringify(requested)}: it is not in the palette.`);
  }

  const context = design?.width && design?.height ? design : normaliseDesignContext(design ?? {});
  const { width, height } = context;
  const hasBackground = typeof backgroundImage === 'string' && backgroundImage !== '';
  const layoutId = layoutFor(width, height, hasBackground);
  const ink = inkFor(entry.hex);
  const copy = buildCopy({ colourName: requested, entry, context });
  const margin = round(Math.min(width, height) * 0.07);
  const headlineSize = Math.max(30, Math.min(96, round(Math.min(width, height) * 0.078)));
  const bodySize = Math.max(15, Math.min(30, round(headlineSize * 0.4)));
  const kickerSize = Math.max(11, round(bodySize * 0.72));
  const footerSize = kickerSize;
  const actions = [];
  const layoutMetrics = {};

  const parts = [];

  if (layoutId === 'showcase') {
    const hasSubject = subject !== null && subject.composited === true;
    const background = hasBackground
      ? photoLayer({ photo: { image: backgroundImage }, x: 0, y: 0, width, height, id: 'bg' })
      : geometricField({ x: 0, y: 0, width, height, colour: entry.hex, id: 'bg' });
    parts.push(background);

    const scrimTop = round(height * (hasSubject ? 0.48 : 0.42));
    parts.push(
      scrimLayer({
        x: 0,
        y: scrimTop,
        width,
        height: height - scrimTop,
        colour: '#10161a',
        id: 'showcase',
        stops: hasSubject
          ? [
              { offset: 0, opacity: 0 },
              { offset: 0.12, opacity: 0.18 },
              { offset: 0.25, opacity: 0.55 },
              { offset: 0.4, opacity: 0.82 },
              { offset: 0.55, opacity: 0.94 },
              { offset: 1, opacity: 0.97 }
            ]
          : null
      })
    );

    const ink = '#fbf8f1';
    const textTop = hasSubject
      ? Math.max(round(height * 0.62), round(subject.bottom + height * 0.025))
      : round(height * (photo === null ? 0.6 : 0.62));
    const columnWidth = width - margin * 2;
    const density =
      copy.headline.length + copy.body.length > 420
        ? 0.56
        : copy.headline.length + copy.body.length > 260
          ? 0.7
          : copy.headline.length + copy.body.length > 150
            ? 0.84
            : 1;
    let headlineSize = Math.max(34, round(Math.min(96, Math.min(width, height) * 0.085) * density));
    let bodySize = Math.max(15, round(Math.min(30, headlineSize * 0.36)));
    const kickerSize = Math.max(11, round(bodySize * 0.72));
    const footerSize = kickerSize;
    const noteSize = Math.max(12, round(kickerSize * 1.05));
    const noteSpacing = Math.max(0, round(noteSize * 0.05));
    const noteGap = Math.round(noteSize * 0.85);
    const topNote =
      copy.topText === null
        ? null
        : buildNoteBlock(copy.topText, { size: noteSize, maxWidth: columnWidth, spacing: noteSpacing });
    const bottomNote =
      copy.bottomText === null
        ? null
        : buildNoteBlock(copy.bottomText, { size: noteSize, maxWidth: columnWidth, spacing: noteSpacing });
    const ruleY = height - margin * 1.45;
    const bottomNoteTop =
      bottomNote === null ? null : round(ruleY - noteGap - bottomNote.height - noteSize * 0.05);
    const textLimit = bottomNoteTop === null ? ruleY : bottomNoteTop - noteGap;
    const available = textLimit - textTop;
    let headlineLines = wrapToWidth(copy.headline, TYPEFACES.display, headlineSize, columnWidth);
    let bodyLines = wrapToWidth(copy.body, TYPEFACES.body, bodySize, columnWidth);
    let textTrimmed = false;

    const blockHeight = () =>
      kickerSize * 2.1 +
      headlineSize +
      (headlineLines.length - 1) * headlineSize * 1.06 +
      bodySize * 1.8 +
      (bodyLines.length - 1) * bodySize * 1.45 +
      bodySize * 0.4;

    while (headlineSize > 36 && blockHeight() > available) {
      headlineSize -= 2;
      bodySize = Math.max(13, round(headlineSize * 0.36));
      headlineLines = wrapToWidth(copy.headline, TYPEFACES.display, headlineSize, columnWidth);
      bodyLines = wrapToWidth(copy.body, TYPEFACES.body, bodySize, columnWidth);
    }
    while (bodySize > 11 && blockHeight() > available) {
      bodySize -= 1;
      bodyLines = wrapToWidth(copy.body, TYPEFACES.body, bodySize, columnWidth);
    }
    while (bodyLines.length > 1 && blockHeight() > available) {
      bodyLines.pop();
      textTrimmed = true;
    }
    if (textTrimmed) {
      bodyLines[bodyLines.length - 1] = `${bodyLines[bodyLines.length - 1].replace(/[.,;:]$/, '')}\u2026`;
    }

    const bodyLineHeight = round(bodySize * 1.45);
    const headlineTop = textTop + kickerSize * 2.1 + headlineSize;
    const afterHeadline = headlineTop + (headlineLines.length - 1) * headlineSize * 1.06;
    const bodyTop = afterHeadline + bodySize * 1.8;
    const textBottom = bodyTop + Math.max(0, bodyLines.length - 1) * bodyLineHeight + bodySize * 0.25;
    layoutMetrics.text_top = textTop;
    layoutMetrics.text_bottom = round(textBottom);
    layoutMetrics.rule_y = round(ruleY);
    layoutMetrics.text_overflow = textBottom > textLimit - 2;
    layoutMetrics.text_trimmed = textTrimmed;
    if (topNote !== null) {
      layoutMetrics.top_note_top = margin;
      layoutMetrics.top_note_bottom = round(margin + topNote.height);
    }
    if (bottomNote !== null) {
      layoutMetrics.bottom_note_top = bottomNoteTop;
      layoutMetrics.bottom_note_bottom = round(bottomNoteTop + bottomNote.height);
    }

    if (photo !== null && !hasSubject) {
      const insetX = margin;
      const insetY = margin;
      const insetW = width - margin * 2;
      const insetH = round(height * 0.38);
      parts.push(photoLayer({ photo, x: insetX, y: insetY, width: insetW, height: insetH, id: 'inset' }));
      parts.push(
        `<rect x="${insetX}" y="${insetY}" width="${insetW}" height="${insetH}" fill="none" ` +
          `stroke="#fbf8f1" stroke-width="${Math.max(3, round(width * 0.006))}" opacity="0.92"/>`
      );
    }

    if (topNote !== null) {
      parts.push(
        topNoteScrim({
          width,
          height: round(margin + topNote.height + noteSize * 0.9),
          id: 'top-note'
        })
      );
    }

    parts.push(
      textLines({
        lines: [copy.kicker.toUpperCase()],
        x: margin,
        y: textTop,
        lineHeight: kickerSize * 1.4,
        size: kickerSize,
        fill: ink,
        font: FONTS.mono,
        spacing: 2
      })
    );
    parts.push(
      textLines({
        lines: headlineLines,
        x: margin,
        y: headlineTop,
        lineHeight: round(headlineSize * 1.06),
        size: headlineSize,
        fill: ink,
        font: FONTS.display
      })
    );
    parts.push(
      textLines({
        lines: bodyLines,
        x: margin,
        y: bodyTop,
        lineHeight: bodyLineHeight,
        size: bodySize,
        fill: ink,
        font: FONTS.body
      })
    );
    if (bottomNote !== null) {
      parts.push(
        noteLayer({
          note: bottomNote,
          x: margin,
          firstBaseline: bottomNoteTop + Math.round(noteSize * 0.8),
          fill: ink
        })
      );
    }
    parts.push(
      `<rect x="${margin}" y="${round(ruleY)}" width="${round(width - margin * 2)}" height="1" fill="${ink}" opacity="0.3"/>` +
        textLines({
          lines: [copy.footer],
          x: margin,
          y: height - margin,
          lineHeight: footerSize * 1.3,
          size: footerSize,
          fill: ink,
          font: FONTS.mono
        })
    );
    parts.push(
      `<rect x="${round(margin * 0.45)}" y="${round(margin * 0.45)}" width="${round(width - margin * 0.9)}" ` +
        `height="${round(height - margin * 0.9)}" fill="none" stroke="${ink}" stroke-width="1.5" opacity="0.5"/>`
    );
    if (topNote !== null) {
      parts.push(
        noteLayer({
          note: topNote,
          x: margin,
          firstBaseline: margin + Math.round(noteSize * 0.8),
          fill: ink
        })
      );
    }

    actions.push(
      hasSubject
        ? 'The photo background was removed and the subject is fixed into the generated background, with no frame.'
        : hasBackground
          ? 'Generated background placed full-bleed; the text sits on a scrim for contrast.'
          : 'No generated background was available: a colour field built from the chosen colour is used.',
      hasSubject
        ? 'The subject is anchored above the text area and its lower edge fades into the scrim.'
        : photo !== null
          ? 'Photo framed in the upper area with a clean border; the fit is automatic, no manual crop.'
          : 'No photo sent: the flyer uses the generated background alone.',
      `Headline and body wrapped automatically inside the safe margin (${headlineLines.length} headline line${headlineLines.length === 1 ? '' : 's'}).`
    );
  } else if (layoutId === 'stack') {
    const photoHeight = photo === null ? round(height * 0.46) : round(height * 0.58);
    const contentTop = photoHeight + margin;
    const columnWidth = width - margin * 2;
    const subtitle = copy.subhead === null ? [] : [copy.subhead];
    const headlineLines = wrapToWidth(copy.headline, TYPEFACES.display, headlineSize, columnWidth);
    let bodyLines = wrapToWidth(copy.body, TYPEFACES.body, bodySize, columnWidth);
    let stackBodySize = bodySize;
    const noteSize = Math.max(12, round(kickerSize * 1.05));
    const noteSpacing = Math.max(0, round(noteSize * 0.05));
    const noteGap = Math.round(noteSize * 0.85);
    const topNote =
      copy.topText === null
        ? null
        : buildNoteBlock(copy.topText, { size: noteSize, maxWidth: columnWidth, spacing: noteSpacing });
    const bottomNote =
      copy.bottomText === null
        ? null
        : buildNoteBlock(copy.bottomText, { size: noteSize, maxWidth: columnWidth, spacing: noteSpacing });
    const footerRuleY = height - margin * 1.5;
    const bottomNoteTop =
      bottomNote === null ? null : round(footerRuleY - noteGap - bottomNote.height - noteSize * 0.05);
    const textLimit = bottomNoteTop === null ? footerRuleY : bottomNoteTop - noteGap;
    const headlineTop = contentTop + kickerSize * 2.4 + headlineSize;
    const afterHeadline = headlineTop + (headlineLines.length - 1) * headlineSize * 1.08;
    const bodyBaseline = () => afterHeadline + stackBodySize * (subtitle.length === 0 ? 1.9 : 3.6);
    const bodyBottom = () =>
      bodyBaseline() +
      Math.max(0, bodyLines.length - 1) * Math.round(stackBodySize * 1.5) +
      stackBodySize * 0.25;
    let textTrimmed = false;

    if (bottomNote !== null) {
      while (stackBodySize > 11 && bodyBottom() > textLimit) {
        stackBodySize -= 1;
        bodyLines = wrapToWidth(copy.body, TYPEFACES.body, stackBodySize, columnWidth);
      }
      while (bodyLines.length > 1 && bodyBottom() > textLimit) {
        bodyLines.pop();
        textTrimmed = true;
      }
      if (textTrimmed) {
        bodyLines[bodyLines.length - 1] = `${bodyLines[bodyLines.length - 1].replace(/[.,;:]$/, '')}\u2026`;
      }
    }

    parts.push(`<rect width="${width}" height="${height}" fill="${entry.hex}"/>`);
    parts.push(
      photo !== null
        ? photoLayer({ photo, x: 0, y: 0, width, height: photoHeight, id: 'main' }) +
            scrimLayer({ x: 0, y: round(photoHeight * 0.55), width, height: round(photoHeight * 0.45), colour: entry.hex, id: 'main' })
        : geometricField({ x: 0, y: 0, width, height: photoHeight, colour: entry.hex, id: 'main' })
    );
    if (topNote !== null && photo !== null) {
      parts.push(
        topNoteScrim({
          width,
          height: round(margin + topNote.height + noteSize * 0.9),
          id: 'top-note-stack'
        })
      );
    }
    parts.push(
      textLines({
        lines: [copy.kicker.toUpperCase()],
        x: margin,
        y: contentTop + kickerSize,
        lineHeight: kickerSize * 1.4,
        size: kickerSize,
        fill: ink,
        font: FONTS.mono,
        spacing: 2
      })
    );
    parts.push(
      textLines({
        lines: headlineLines,
        x: margin,
        y: headlineTop,
        lineHeight: round(headlineSize * 1.08),
        size: headlineSize,
        fill: ink,
        font: FONTS.display
      })
    );
    parts.push(
      textLines({
        lines: subtitle,
        x: margin,
        y: afterHeadline + stackBodySize * 1.9,
        lineHeight: round(stackBodySize * 1.4),
        size: stackBodySize,
        fill: ink,
        font: FONTS.body,
        weight: 700
      })
    );
    parts.push(
      textLines({
        lines: bodyLines,
        x: margin,
        y: bodyBaseline(),
        lineHeight: round(stackBodySize * 1.5),
        size: stackBodySize,
        fill: ink,
        font: FONTS.body
      })
    );
    if (bottomNote !== null) {
      parts.push(
        noteLayer({
          note: bottomNote,
          x: margin,
          firstBaseline: bottomNoteTop + Math.round(noteSize * 0.8),
          fill: ink
        })
      );
      layoutMetrics.text_top = contentTop;
      layoutMetrics.text_bottom = round(bodyBottom());
      layoutMetrics.rule_y = round(footerRuleY);
      layoutMetrics.text_overflow = bodyBottom() > textLimit - 2;
      layoutMetrics.text_trimmed = textTrimmed;
    }
    if (topNote !== null) {
      layoutMetrics.top_note_top = margin;
      layoutMetrics.top_note_bottom = round(margin + topNote.height);
    }
    if (bottomNote !== null) {
      layoutMetrics.bottom_note_top = bottomNoteTop;
      layoutMetrics.bottom_note_bottom = round(bottomNoteTop + bottomNote.height);
    }
    parts.push(
      `<rect x="${margin}" y="${round(footerRuleY)}" width="${round(width - margin * 2)}" height="1" fill="${ink}" opacity="0.35"/>` +
        textLines({
          lines: [copy.footer],
          x: margin,
          y: height - margin,
          lineHeight: footerSize * 1.3,
          size: footerSize,
          fill: ink,
          font: FONTS.mono
        })
    );
    if (topNote !== null) {
      parts.push(
        noteLayer({
          note: topNote,
          x: margin,
          firstBaseline: margin + Math.round(noteSize * 0.8),
          fill: photo === null ? ink : '#fbf8f1'
        })
      );
    }

    actions.push(
      photo !== null
        ? 'Photo fitted automatically: cover-fit inside the top frame, cropped by the app, no manual crop.'
        : 'No photo sent: a geometric field built from the chosen colour fills the top frame.',
      'A gradient scrim was placed under the text so it stays readable over the photo.',
      `Headline wrapped automatically into ${headlineLines.length} line${headlineLines.length === 1 ? '' : 's'} inside the safe margin.`,
      'Footer rule and colour code added by the app.'
    );
  } else if (layoutId === 'band-right') {
    const bandWidth = round(width * 0.56);
    const photoX = bandWidth;
    const columnWidth = bandWidth - margin * 2;
    const headlineLines = wrapToWidth(copy.headline, TYPEFACES.display, headlineSize, columnWidth);
    let bodyLines = wrapToWidth(copy.body, TYPEFACES.body, bodySize, columnWidth);
    let bandBodySize = bodySize;
    const subtitle = copy.subhead === null ? [] : [copy.subhead];
    const noteSize = Math.max(12, round(kickerSize * 1.05));
    const noteSpacing = Math.max(0, round(noteSize * 0.05));
    const noteGap = Math.round(noteSize * 0.85);
    const topNote =
      copy.topText === null
        ? null
        : buildNoteBlock(copy.topText, { size: noteSize, maxWidth: columnWidth, spacing: noteSpacing });
    const bottomNote =
      copy.bottomText === null
        ? null
        : buildNoteBlock(copy.bottomText, { size: noteSize, maxWidth: columnWidth, spacing: noteSpacing });
    const footerTop = height - margin - round(footerSize * 1.3);
    const bottomNoteTop =
      bottomNote === null ? null : round(footerTop - noteGap - bottomNote.height - noteSize * 0.05);
    const textLimit = bottomNoteTop === null ? footerTop : bottomNoteTop - noteGap;
    const headlineTop = round(height * 0.42);
    const afterHeadline = headlineTop + (headlineLines.length - 1) * headlineSize * 1.08;
    const bodyBaseline = () => afterHeadline + bandBodySize * (subtitle.length === 0 ? 1.9 : 3.6);
    const bodyBottom = () =>
      bodyBaseline() +
      Math.max(0, bodyLines.length - 1) * Math.round(bandBodySize * 1.5) +
      bandBodySize * 0.25;
    let textTrimmed = false;

    if (bottomNote !== null) {
      while (bandBodySize > 11 && bodyBottom() > textLimit) {
        bandBodySize -= 1;
        bodyLines = wrapToWidth(copy.body, TYPEFACES.body, bandBodySize, columnWidth);
      }
      while (bodyLines.length > 1 && bodyBottom() > textLimit) {
        bodyLines.pop();
        textTrimmed = true;
      }
      if (textTrimmed) {
        bodyLines[bodyLines.length - 1] = `${bodyLines[bodyLines.length - 1].replace(/[.,;:]$/, '')}\u2026`;
      }
    }

    parts.push(`<rect width="${width}" height="${height}" fill="${entry.hex}"/>`);
    parts.push(
      photo !== null
        ? photoLayer({ photo, x: photoX, y: 0, width: width - photoX, height, id: 'main' }) +
            scrimLayer({ x: photoX, y: 0, width: round((width - photoX) * 0.42), height, colour: entry.hex, direction: 'horizontal', id: 'main' })
        : geometricField({ x: photoX, y: 0, width: width - photoX, height, colour: entry.hex, id: 'main' })
    );
    parts.push(
      textLines({
        lines: [copy.kicker.toUpperCase()],
        x: margin,
        y: margin + kickerSize,
        lineHeight: kickerSize * 1.4,
        size: kickerSize,
        fill: ink,
        font: FONTS.mono,
        spacing: 2
      })
    );
    parts.push(
      textLines({
        lines: headlineLines,
        x: margin,
        y: headlineTop,
        lineHeight: round(headlineSize * 1.08),
        size: headlineSize,
        fill: ink,
        font: FONTS.display
      })
    );
    parts.push(
      textLines({
        lines: subtitle,
        x: margin,
        y: afterHeadline + bandBodySize * 1.9,
        lineHeight: round(bandBodySize * 1.4),
        size: bandBodySize,
        fill: ink,
        font: FONTS.body,
        weight: 700
      })
    );
    parts.push(
      textLines({
        lines: bodyLines,
        x: margin,
        y: bodyBaseline(),
        lineHeight: round(bandBodySize * 1.5),
        size: bandBodySize,
        fill: ink,
        font: FONTS.body
      })
    );
    if (bottomNote !== null) {
      parts.push(
        noteLayer({
          note: bottomNote,
          x: margin,
          firstBaseline: bottomNoteTop + Math.round(noteSize * 0.8),
          fill: ink
        })
      );
      layoutMetrics.text_top = headlineTop;
      layoutMetrics.text_bottom = round(bodyBottom());
      layoutMetrics.text_overflow = bodyBottom() > textLimit - 2;
      layoutMetrics.text_trimmed = textTrimmed;
    }
    if (topNote !== null) {
      layoutMetrics.top_note_top = margin;
      layoutMetrics.top_note_bottom = round(margin + topNote.height);
    }
    if (bottomNote !== null) {
      layoutMetrics.bottom_note_top = bottomNoteTop;
      layoutMetrics.bottom_note_bottom = round(bottomNoteTop + bottomNote.height);
    }
    parts.push(
      textLines({
        lines: [copy.footer],
        x: margin,
        y: height - margin,
        lineHeight: footerSize * 1.3,
        size: footerSize,
        fill: ink,
        font: FONTS.mono
      })
    );
    if (topNote !== null) {
      parts.push(
        noteLayer({
          note: topNote,
          x: margin,
          firstBaseline: margin + Math.round(noteSize * 0.8),
          fill: ink
        })
      );
    }

    actions.push(
      photo !== null
        ? 'Photo fitted automatically in the right band: cover-fit, no manual crop.'
        : 'No photo sent: a geometric field built from the chosen colour fills the right band.',
      'A horizontal scrim was placed where the photo meets the text.',
      `Headline wrapped automatically into ${headlineLines.length} line${headlineLines.length === 1 ? '' : 's'}.`,
      'Text kept on the colour band: nothing sits over the photo.'
    );
  } else {
    const textTop = round(height * 0.6);
    const columnWidth = width - margin * 2;
    let coverHeadlineSize = headlineSize;
    let coverBodySize = bodySize;
    let headlineLines = wrapToWidth(copy.headline, TYPEFACES.display, coverHeadlineSize, columnWidth);
    let bodyLines = wrapToWidth(copy.body, TYPEFACES.body, coverBodySize, columnWidth);
    const noteSize = Math.max(12, round(kickerSize * 1.05));
    const noteSpacing = Math.max(0, round(noteSize * 0.05));
    const noteGap = Math.round(noteSize * 0.85);
    const topNote =
      copy.topText === null
        ? null
        : buildNoteBlock(copy.topText, { size: noteSize, maxWidth: columnWidth, spacing: noteSpacing });
    const bottomNote =
      copy.bottomText === null
        ? null
        : buildNoteBlock(copy.bottomText, { size: noteSize, maxWidth: columnWidth, spacing: noteSpacing });
    const bottomFirstBaseline =
      bottomNote === null
        ? null
        : height -
          margin -
          Math.round(noteSize * 0.25) -
          (bottomNote.lines.length - 1) * bottomNote.lineHeight;
    const bottomNoteTop =
      bottomFirstBaseline === null ? null : bottomFirstBaseline - Math.round(noteSize * 0.8);
    const textLimit = bottomNoteTop === null ? height - margin : bottomNoteTop - noteGap;
    const headlineLineHeight = (size) => round(size * 1.08);
    const bodyLineHeight = (size) => round(size * 1.5);

    const fits = () => {
      const top = textTop + kickerSize * 2 + coverHeadlineSize;
      const headlineBottom = top + (headlineLines.length - 1) * headlineLineHeight(coverHeadlineSize);
      const bodyTop = textLimit - (bodyLines.length - 1) * bodyLineHeight(coverBodySize);
      return bodyTop - headlineBottom >= coverBodySize * 1.2;
    };

    while (coverBodySize > 11 && !fits()) {
      coverBodySize -= 1;
      bodyLines = wrapToWidth(copy.body, TYPEFACES.body, coverBodySize, columnWidth);
    }
    while (coverHeadlineSize > 30 && !fits()) {
      coverHeadlineSize -= 2;
      coverBodySize = Math.max(11, round(coverHeadlineSize * 0.36));
      headlineLines = wrapToWidth(copy.headline, TYPEFACES.display, coverHeadlineSize, columnWidth);
      bodyLines = wrapToWidth(copy.body, TYPEFACES.body, coverBodySize, columnWidth);
    }

    const headlineTop = textTop + kickerSize * 2 + coverHeadlineSize;
    const bodyTop = textLimit - (bodyLines.length - 1) * bodyLineHeight(coverBodySize);
    layoutMetrics.text_top = textTop;
    layoutMetrics.text_bottom = round(bodyTop + coverBodySize * 0.25);
    layoutMetrics.rule_y = round(textLimit);
    layoutMetrics.text_overflow = !fits();
    if (topNote !== null) {
      layoutMetrics.top_note_top = margin;
      layoutMetrics.top_note_bottom = round(margin + topNote.height);
    }
    if (bottomNote !== null) {
      layoutMetrics.bottom_note_top = bottomNoteTop;
      layoutMetrics.bottom_note_bottom = round(bottomNoteTop + bottomNote.height);
    }

    parts.push(`<rect width="${width}" height="${height}" fill="${entry.hex}"/>`);
    parts.push(
      photo !== null
        ? photoLayer({ photo, x: 0, y: 0, width, height, id: 'main' }) +
            scrimLayer({ x: 0, y: textTop - round(height * 0.3), width, height: height - textTop + round(height * 0.3), colour: entry.hex, id: 'main' })
        : geometricField({ x: 0, y: 0, width, height, colour: entry.hex, id: 'main' })
    );
    if (topNote !== null && photo !== null) {
      parts.push(
        topNoteScrim({
          width,
          height: round(margin + topNote.height + noteSize * 0.9),
          id: 'top-note-cover'
        })
      );
    }
    parts.push(
      textLines({
        lines: [copy.kicker.toUpperCase()],
        x: margin,
        y: textTop,
        lineHeight: kickerSize * 1.4,
        size: kickerSize,
        fill: ink,
        font: FONTS.mono,
        spacing: 2
      })
    );
    parts.push(
      textLines({
        lines: headlineLines,
        x: margin,
        y: headlineTop,
        lineHeight: headlineLineHeight(coverHeadlineSize),
        size: coverHeadlineSize,
        fill: ink,
        font: FONTS.display
      })
    );
    parts.push(
      textLines({
        lines: bodyLines,
        x: margin,
        y: bodyTop,
        lineHeight: bodyLineHeight(coverBodySize),
        size: coverBodySize,
        fill: ink,
        font: FONTS.body
      })
    );
    if (bottomNote !== null) {
      parts.push(
        noteLayer({
          note: bottomNote,
          x: margin,
          firstBaseline: bottomFirstBaseline,
          fill: ink
        })
      );
    }
    if (topNote !== null) {
      parts.push(
        noteLayer({
          note: topNote,
          x: margin,
          firstBaseline: margin + Math.round(noteSize * 0.8),
          fill: photo === null ? ink : '#fbf8f1'
        })
      );
    }

    actions.push(
      photo !== null
        ? 'Photo placed full-bleed: cover-fit, centred, no manual crop.'
        : 'No photo sent: a geometric field built from the chosen colour is used.',
      'A scrim was placed from below so the text keeps its contrast on any photo.',
      `Headline wrapped automatically into ${headlineLines.length} line${headlineLines.length === 1 ? '' : 's'}.`
    );
  }

  if (copy.topText !== null) {
    actions.push('The optional line written by the user is set at the top edge of the flyer.');
  }
  if (copy.bottomText !== null) {
    actions.push('The optional line written by the user is set above the footer.');
  }

  const svg = svgDocument({
    width,
    height,
    title: `${copy.headline} \u2014 ${context.label}`,
    description: [copy.topText, copy.kicker, copy.headline, copy.subhead, copy.body, copy.bottomText, copy.footer]
      .filter(Boolean)
      .join(' \u2014 '),
    content: parts.join('')
  });

  const warnings = [];
  if (layoutMetrics.text_trimmed === true) {
    warnings.push('The text was longer than the flyer could hold at a readable size; the body was shortened with an ellipsis.');
  }
  if (layoutMetrics.text_overflow === true) {
    warnings.push('The text block is taller than its declared area; reduce the text or choose a taller format.');
  }
  if (photo === null && !hasBackground) {
    warnings.push('No photo or generated background was available: the frame uses a colour field instead.');
  }
  if (meanings.isQuestioned(requested)) {
    warnings.push(
      standing?.allow_questioned_colours === true
        ? `The ${requested} flyer uses the colour because a cogent reason for ${requested} is recorded in the profile.`
        : `The ${requested} flyer is composed with the colour you chose. The profile is not friendly, so fewer background suggestions and the declared delay apply.`
    );
  }

  return {
    choice: {
      by: 'user',
      applied: true,
      note: 'The app composed the design from the colour you chose; it did not choose the colour for you.'
    },
    design: {
      type: context.type,
      label: context.label,
      width,
      height,
      subject: context.subject,
      audience: context.audience,
      text: context.text,
      topText: context.topText,
      bottomText: context.bottomText
    },
    colour: {
      colour_name: requested,
      hex: entry.hex,
      meanings: entry.meanings,
      ink
    },
    layout: {
      id: layoutId,
      label: COMPOSITION_LAYOUTS[layoutId].label,
      for: COMPOSITION_LAYOUTS[layoutId].for,
      margin,
      variant: Number.isInteger(variant) ? variant : 0,
      ...layoutMetrics
    },
    copy,
    photo:
      photo === null
        ? null
        : { width: photo.width, height: photo.height, treatment: 'cover-fit, centred, automatic' },
    subject:
      subject === null || subject.composited !== true
        ? null
        : {
            composited: true,
            method: subject.method ?? null,
            width: subject.width,
            height: subject.height,
            x: subject.x,
            y: subject.y,
            bottom: subject.bottom,
            foreground_ratio: subject.foreground_ratio ?? null
          },
    actions,
    warnings,
    svg,
    svg_bytes: Buffer.byteLength(svg, 'utf8')
  };
}
