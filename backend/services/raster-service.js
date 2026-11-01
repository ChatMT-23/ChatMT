/**
 * Raster export.
 *
 * The interface used to hand the browser an SVG. A phone gallery does not open SVG, so the
 * downloaded flyer is now a JPEG: resvg turns the composed SVG into pixels, and Jimp writes a
 * compact JPEG at the same size. The SVG stays in the API for inspection and for the tests, but
 * it is no longer what the public page previews or downloads.
 *
 * The SVG carries its text as glyph outlines, so this step does not depend on the fonts
 * installed on the server. That is what keeps the phone, the browser and the server identical.
 */

import { Resvg } from '@resvg/resvg-js';
import { Jimp } from 'jimp';

export function createRasterService({ quality = 92 } = {}) {
  if (!Number.isInteger(quality) || quality < 40 || quality > 100) {
    throw new TypeError('quality must be an integer between 40 and 100.');
  }

  async function render(svg) {
    if (typeof svg !== 'string' || !svg.startsWith('<svg')) {
      throw new TypeError('The raster service needs an SVG document.');
    }

    const png = new Resvg(svg, { background: '#10161a' }).render().asPng();
    const image = await Jimp.read(Buffer.from(png));
    const jpeg = await image.getBuffer('image/jpeg', { quality });

    return {
      image: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      mime: 'image/jpeg',
      width: image.bitmap.width,
      height: image.bitmap.height,
      bytes: jpeg.length,
      png_bytes: png.length
    };
  }

  return Object.freeze({ render, quality });
}
