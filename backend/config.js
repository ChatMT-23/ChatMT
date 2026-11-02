/**
 * Backend configuration.
 *
 * Values come from the process environment, after backend/env-file.js has read the local .env
 * file (see server.js). A secret still never has to be written into a tracked file: .env is
 * ignored by git and an exported variable wins over the file. Every value has a declared default,
 * and an invalid value stops the server at startup instead of being silently replaced.
 *
 * The language model is DeepSeek by default (OpenAI-compatible endpoint). The older Z.ai names
 * are still accepted, so an existing shell keeps working without being edited.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));

const DEFAULT_LLM_API_BASE = 'https://api.deepseek.com';
const DEFAULT_LLM_MODEL = 'deepseek-flash';
const DEFAULT_IMAGE_API_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_IMAGE_MODEL = 'krea/k3-edit';

const DEFAULT_ORIGINS = [
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];

function integer(value, fallback, { minimum, maximum, name }) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}; received ${JSON.stringify(value)}.`);
  }
  return parsed;
}

function text(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function choice(value, fallback, { allowed, name }) {
  const raw = text(value);
  if (raw === null) return fallback;
  if (!allowed.includes(raw)) {
    throw new RangeError(`${name} must be one of ${allowed.join(', ')}; received ${JSON.stringify(value)}.`);
  }
  return raw;
}

function originList(value) {
  const raw = text(value);
  if (raw === null) return DEFAULT_ORIGINS;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

/**
 * @param {Record<string, string|undefined>} [env]
 */
export function loadConfig(env = process.env) {
  const onVercel = text(env.VERCEL) === '1' || text(env.VERCEL_ENV) !== null;
  const dataSetting = text(env.CHATMT_DATA_DIR) ?? (onVercel ? '/tmp/chatmt-data' : 'data');
  const cacheSetting =
    text(env.CHATMT_IMAGE_CACHE_DIR) ??
    (onVercel ? '/tmp/chatmt-background-cache' : path.join('data', 'background-cache'));
  const llmApiBase =
    text(env.CHATMT_LLM_API_BASE) ??
    text(env.DEEPSEEK_API_BASE) ??
    text(env.ZAI_API_BASE) ??
    DEFAULT_LLM_API_BASE;
  const llmApiKey = text(env.CHATMT_LLM_API_KEY) ?? text(env.DEEPSEEK_API_KEY) ?? text(env.ZAI_API_KEY);
  const imageApiKey = text(env.OPENROUTER_API_KEY) ?? text(env.CHATMT_IMAGE_API_KEY);

  return Object.freeze({
    host: text(env.CHATMT_HOST) ?? '127.0.0.1',
    port: integer(env.PORT ?? env.CHATMT_PORT, 3080, { minimum: 0, maximum: 65535, name: 'PORT' }),
    dataDir: path.isAbsolute(dataSetting) ? dataSetting : path.resolve(REPOSITORY_ROOT, dataSetting),
    standardsDir: path.join(REPOSITORY_ROOT, 'standards'),
    // The interface is served by this server, so the page and the API share one origin and
    // there is nothing to configure in the browser. See backend/static-files.js.
    frontendDir: path.join(REPOSITORY_ROOT, 'frontend'),
    allowedOrigins: Object.freeze(originList(env.CHATMT_ALLOWED_ORIGINS)),
    maxBodyBytes: integer(env.CHATMT_MAX_BODY_BYTES, 12 * 1024 * 1024, {
      minimum: 1024,
      maximum: 64 * 1024 * 1024,
      name: 'CHATMT_MAX_BODY_BYTES'
    }),
    image: Object.freeze({
      maxBytes: integer(env.CHATMT_MAX_IMAGE_BYTES, 8 * 1024 * 1024, {
        minimum: 1024,
        maximum: 32 * 1024 * 1024,
        name: 'CHATMT_MAX_IMAGE_BYTES'
      }),
      maxDimension: integer(env.CHATMT_MAX_IMAGE_DIMENSION, 8000, {
        minimum: 16,
        maximum: 12000,
        name: 'CHATMT_MAX_IMAGE_DIMENSION'
      }),
      maxPixels: integer(env.CHATMT_MAX_IMAGE_PIXELS, 40_000_000, {
        minimum: 10_000,
        maximum: 80_000_000,
        name: 'CHATMT_MAX_IMAGE_PIXELS'
      })
    }),
    imageGeneration: Object.freeze({
      apiBase: text(env.OPENROUTER_API_BASE) ?? DEFAULT_IMAGE_API_BASE,
      apiKey: imageApiKey,
      model:
        text(env.OPENROUTER_IMAGE_MODEL) ?? text(env.CHATMT_IMAGE_MODEL) ?? DEFAULT_IMAGE_MODEL,
      timeoutMs: integer(env.CHATMT_IMAGE_TIMEOUT_MS, 90_000, {
        minimum: 1000,
        maximum: 180_000,
        name: 'CHATMT_IMAGE_TIMEOUT_MS'
      }),
      cacheDir: path.isAbsolute(cacheSetting) ? cacheSetting : path.resolve(REPOSITORY_ROOT, cacheSetting),
      configured: Boolean(imageApiKey)
    }),
    llm: Object.freeze({
      apiBase: llmApiBase,
      apiKey: llmApiKey,
      model:
        text(env.CHATMT_LLM_MODEL) ?? text(env.DEEPSEEK_MODEL) ?? text(env.ZAI_MODEL) ?? DEFAULT_LLM_MODEL,
      // DeepSeek thinking mode: the provider takes a top-level "thinking" object and a
      // reasoning effort. With thinking disabled neither parameter is sent at all.
      thinking: choice(env.CHATMT_LLM_THINKING, 'enabled', {
        allowed: ['enabled', 'disabled'],
        name: 'CHATMT_LLM_THINKING'
      }),
      reasoningEffort: choice(env.CHATMT_LLM_REASONING_EFFORT, 'high', {
        allowed: ['minimal', 'low', 'medium', 'high'],
        name: 'CHATMT_LLM_REASONING_EFFORT'
      }),
      // A reasoning model answers in seconds, not in milliseconds: 6 s was too short for the
      // thinking stages, so the declared default is larger and still bounded.
      timeoutMs: integer(env.CHATMT_LLM_TIMEOUT_MS, 20_000, {
        minimum: 500,
        maximum: 60_000,
        name: 'CHATMT_LLM_TIMEOUT_MS'
      }),
      configured: Boolean(llmApiKey)
    })
  });
}
