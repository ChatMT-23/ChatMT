/**
 * Vercel serverless entry point.
 *
 * Vercel invokes this file for every /api/* request. The existing backend is already a request
 * handler; createRequestHandler() keeps the services in module scope, so a warm function reuses
 * the standards, the memory adapter and the image client.
 *
 * The local server (npm start) still uses backend/server.js directly. The static frontend is
 * served by Vercel from the `frontend` output directory; the API and the page share the origin.
 */

import path from 'node:path';

import { createRequestHandler } from '../backend/server.js';
import { loadConfig } from '../backend/config.js';
import { loadEnvFile } from '../backend/env-file.js';

// Local `vercel dev` can read the ignored .env; on Vercel the variables are already in the
// process environment and this call is a no-op.
loadEnvFile({ path: path.join(process.cwd(), '.env') });

const handler = createRequestHandler(loadConfig());

export default function chatmtVercelHandler(req, res) {
  return handler(req, res);
}
