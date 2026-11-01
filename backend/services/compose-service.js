/**
 * Composition service.
 *
 * The HTTP face of modules/design/composer.js: it resolves the colour, reads the recorded
 * profile (which is what unlocks red and yellow), prepares the uploaded photo and returns the
 * composed SVG. The rules stay where they were: the colour comes from the palette, the meaning
 * from the standard file, and the permission for a questioned colour from the stored profile,
 * never from a flag in the request.
 *
 * When a generated background and a photo are both present, the photo is cut out and painted
 * into the background before the SVG is written. The flyer therefore contains one picture, not
 * a framed photo placed on top of a picture.
 */

import { createMeaningIndex } from '../../modules/meaning/colour-meanings.js';
import { composeDesign } from '../../modules/design/composer.js';
import { compositeSubject, isRasterImageDataUrl } from '../../modules/design/raster-composer.js';
import { normaliseDesignContext } from '../../modules/policy/design-suggestions.js';
import { badRequest } from '../errors.js';

const MAX_PHOTO_WIDTH = 1600;

function resolveColour(palette, colour) {
  if (colour === null || typeof colour !== 'object') {
    throw badRequest('colour_required', 'A colour is required to compose the design.');
  }
  const wantedName =
    typeof colour.name === 'string' && colour.name.trim() !== '' ? colour.name.trim().toLowerCase() : null;
  const wantedHex =
    typeof colour.hex === 'string' && colour.hex.trim() !== '' ? colour.hex.trim().toUpperCase() : null;

  if (wantedName === null && wantedHex === null) {
    throw badRequest('colour_required', 'A colour is required to compose the design.');
  }
  const byName = wantedName === null ? null : palette.find((entry) => entry.name === wantedName) ?? null;
  const byHex = wantedHex === null ? null : palette.find((entry) => entry.hex.toUpperCase() === wantedHex) ?? null;
  if (wantedName !== null && byName === null) {
    throw badRequest('unknown_colour', `${JSON.stringify(wantedName)} is not in the palette.`);
  }
  if (wantedHex !== null && byHex === null) {
    throw badRequest('unknown_colour', `${wantedHex} is not in the palette.`);
  }
  if (byName !== null && byHex !== null && byName.name !== byHex.name) {
    throw badRequest(
      'colour_mismatch',
      `The name ${byName.name} and the value ${wantedHex} point to different palette colours.`
    );
  }
  return byName ?? byHex;
}

/**
 * @param {object} options
 * @param {object} options.meaningStandard the parsed colour-meanings standard
 * @param {ReadonlyArray<object>} options.palette
 * @param {(userId: string) => object} options.standingFor the profile of one user
 * @param {object} options.images the image service, for prepare()
 * @param {object|null} [options.cutouts] the cut-out service, for removeBackground()
 * @param {object|null} [options.raster] the raster service, for the JPEG export
 */
export function createComposeService({
  meaningStandard,
  palette,
  standingFor,
  images,
  cutouts = null,
  raster = null,
  backgroundImages = null
}) {
  if (!Array.isArray(palette) || palette.length === 0) throw new TypeError('The compose service needs the palette.');
  if (typeof standingFor !== 'function') throw new TypeError('The compose service needs a standing reader.');
  if (!images || typeof images.prepare !== 'function') {
    throw new TypeError('The compose service needs the image service.');
  }

  const meanings = createMeaningIndex(meaningStandard, { palette });

  async function prepareImage(image, { cutout = false } = {}) {
    if (typeof image !== 'string' || image.trim() === '') return null;
    const prepared = await images.prepare({ image, maxWidth: MAX_PHOTO_WIDTH });
    if (!cutout || cutouts === null) return prepared;
    return prepareCutout(prepared);
  }

  async function prepareCutout(prepared) {
    if (prepared === null || prepared === undefined || cutouts === null) return prepared ?? null;
    try {
      const result = await cutouts.removeBackground({ image: prepared.image });
      return {
        ...prepared,
        cutout: result.ok === true ? result : null,
        cutout_reason: result.ok === true ? null : result.reason
      };
    } catch (error) {
      return { ...prepared, cutout: null, cutout_reason: error?.code ?? 'cutout_failed' };
    }
  }

  function svgDataUrl(svg) {
    return `data:image/svg+xml;base64,${Buffer.from(String(svg), 'utf8').toString('base64')}`;
  }

  /**
   * @param {{userId: string, colour: object, design?: object, image?: string|null, photo?: object|null, background?: object|null, variant?: number}} input
   */
  async function compose({ userId, colour, design, image = null, photo = null, background = null, variant = 0 } = {}) {
    const entry = resolveColour(palette, colour);
    const standing = standingFor(userId);
    const context = design?.width && design?.height ? design : normaliseDesignContext(design ?? {});

    const preparedPhoto =
      photo ?? (await prepareImage(image, { cutout: background !== null && background !== undefined }));

    let backgroundRecord =
      background === null || background === undefined
        ? null
        : {
            id: background.id ?? null,
            label: background.label ?? null,
            fallback: background.fallback === true,
            thumbnail: background.thumbnail ?? null,
            image:
              typeof background.image === 'string' && background.image.startsWith('data:image/')
                ? background.image
                : typeof background.svg === 'string'
                  ? svgDataUrl(background.svg)
                  : null
          };

    let backgroundImage = backgroundRecord?.image ?? null;
    let subject = null;

    if (preparedPhoto?.cutout && backgroundImage !== null && isRasterImageDataUrl(backgroundImage)) {
      try {
        const raster = await compositeSubject({
          backgroundImage,
          subjectImage: preparedPhoto.cutout.image,
          width: context.width,
          height: context.height,
          subjectWidth: preparedPhoto.cutout.width,
          subjectHeight: preparedPhoto.cutout.height
        });
        backgroundImage = raster.image;
        backgroundRecord = { ...backgroundRecord, image: raster.image, composite: true };
        subject = {
          composited: true,
          method: preparedPhoto.cutout.method,
          width: raster.subject.width,
          height: raster.subject.height,
          x: raster.subject.x,
          y: raster.subject.y,
          bottom: raster.subject.bottom,
          foreground_ratio: preparedPhoto.cutout.foreground_ratio ?? null
        };
      } catch {
        // A background that cannot be decoded (for example an SVG fallback) keeps the framed
        // photo treatment: a broken composite would be worse than a clean frame.
        subject = null;
      }
    }

    const result = composeDesign({
      meanings,
      standing,
      colourName: entry.name,
      design: context,
      photo: subject === null ? preparedPhoto : null,
      subject,
      backgroundImage,
      variant
    });

    let rasterImage = null;
    let imageError = null;
    if (raster !== null) {
      try {
        const rendered = await raster.render(result.svg);
        rasterImage = {
          data: rendered.image,
          mime: rendered.mime,
          width: rendered.width,
          height: rendered.height,
          bytes: rendered.bytes
        };
      } catch (error) {
        imageError = error?.code ?? error?.message ?? 'raster_failed';
      }
    }

    return {
      ...result,
      image: rasterImage?.data ?? null,
      image_mime: rasterImage?.mime ?? null,
      image_width: rasterImage?.width ?? null,
      image_height: rasterImage?.height ?? null,
      image_bytes: rasterImage?.bytes ?? null,
      image_error: imageError,
      background:
        backgroundRecord === null
          ? null
          : {
              ...backgroundRecord,
              // The background is already inside the SVG and the JPEG; sending it again would
              // double the response for no benefit. The thumbnail stays for the interface.
              image: null
            },
      photo:
        preparedPhoto === null
          ? null
          : {
              width: preparedPhoto.width,
              height: preparedPhoto.height,
              source: preparedPhoto.source,
              resized: preparedPhoto.resized,
              bytes: preparedPhoto.bytes,
              cutout:
                preparedPhoto.cutout === null || preparedPhoto.cutout === undefined
                  ? null
                  : {
                      method: preparedPhoto.cutout.method,
                      width: preparedPhoto.cutout.width,
                      height: preparedPhoto.cutout.height,
                      foreground_ratio: preparedPhoto.cutout.foreground_ratio ?? null
                    },
              cutout_reason: preparedPhoto.cutout_reason ?? null,
              treatment:
                subject !== null
                  ? 'background removed, subject composited into the generated background'
                  : 'cover-fit, centred, automatic: no manual crop'
            },
      stored: null,
      note: 'Nothing is written by a composition: it is a design produced from data already chosen.'
    };
  }

  return Object.freeze({ compose, prepareImage, prepareCutout, meanings });
}
