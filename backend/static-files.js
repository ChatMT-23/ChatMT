/**
 * Static files for the interface.
 *
 * The interface is an ES-module page: the browser refuses to load modules from `file://`, so
 * the project needs an HTTP server. Serving it from the same server that answers /api keeps one
 * origin for page and API, which removes CORS from the normal path and means `npm start` is the
 * only command needed.
 *
 * Only the frontend directory is exposed. A request is resolved against that directory and then
 * checked to be inside it, so `../` cannot reach the standards, the data directory or the code.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8'
});

/** @returns {string|null} the absolute file path, or null when the path escapes the directory */
export function resolveWithin(root, pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const segments = decoded.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '..' || segment === '.')) return null;

  const file = path.resolve(root, ...segments);
  const relative = path.relative(root, file);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return file;
}

export function contentTypeFor(file) {
  return MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * @param {{root: string, urlPath: string}} input
 * @returns {Promise<{found: false} | {found: true, status: number, headers: object, body: Buffer | string, redirect?: string}>}
 */
export async function readStaticFile({ root, urlPath }) {
  if (urlPath === '/' || urlPath === '/frontend' || urlPath === '/index.html') {
    return { found: true, status: 302, headers: { Location: '/frontend/' }, body: '' };
  }
  if (!urlPath.startsWith('/frontend/')) return { found: false };

  // `root` is the frontend directory itself, so the public prefix is stripped before the path
  // is resolved. What remains cannot climb out of it: resolveWithin checks the result.
  const relativePath = urlPath.slice('/frontend'.length);
  const file = resolveWithin(root, relativePath === '/' ? '/index.html' : relativePath);
  if (file === null) return { found: false };

  try {
    const body = await fs.readFile(file);
    return {
      found: true,
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(file),
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      },
      body
    };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return { found: false };
    throw error;
  }
}
