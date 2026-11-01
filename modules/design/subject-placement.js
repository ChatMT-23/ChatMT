/**
 * Placement of a cut-out subject in a generated background.
 *
 * The one-press flyer keeps the lower part of the generated background for the text. The
 * subject is therefore placed in the upper part, centred, and scaled to fit a declared box.
 * The same numbers are used by the raster compositor (which bakes the subject into the
 * background) and by the SVG composer (which starts the text below the subject), so the two
 * layers cannot drift apart.
 */

export const SUBJECT_BOX = Object.freeze({
  maxWidthRatio: 0.62,
  maxHeightRatio: 0.5,
  bottomRatio: 0.57,
  fadeRatio: 0.18
});

/**
 * @param {{width: number, height: number, subject: {width: number, height: number}}} input
 * @returns {{x: number, y: number, width: number, height: number, bottom: number}}
 */
export function subjectPlacement({ width, height, subject }) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('The canvas needs a positive width and height.');
  }
  if (
    !subject ||
    !Number.isFinite(subject.width) ||
    !Number.isFinite(subject.height) ||
    subject.width <= 0 ||
    subject.height <= 0
  ) {
    throw new RangeError('The subject needs a positive width and height.');
  }

  const maxWidth = Math.max(1, Math.round(width * SUBJECT_BOX.maxWidthRatio));
  const maxHeight = Math.max(1, Math.round(height * SUBJECT_BOX.maxHeightRatio));
  const bottom = Math.round(height * SUBJECT_BOX.bottomRatio);
  const scale = Math.min(maxWidth / subject.width, maxHeight / subject.height);
  const subjectWidth = Math.max(1, Math.round(subject.width * scale));
  const subjectHeight = Math.max(1, Math.round(subject.height * scale));

  return Object.freeze({
    x: Math.round((width - subjectWidth) / 2),
    y: bottom - subjectHeight,
    width: subjectWidth,
    height: subjectHeight,
    bottom
  });
}
