/**
 * Minimal .env reader.
 *
 * The backend has no dependencies, so this file parses the classic KEY=VALUE format itself:
 * blank lines, `#` comments, an optional `export ` prefix, and single or double quotes. Values
 * are never expanded or interpolated.
 *
 * An existing process variable always wins, so `DEEPSEEK_API_KEY=... npm start` overrides the
 * file without editing it, and an explicit empty value (as the tests pass) is not replaced.
 */

import fs from 'node:fs';

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * @param {string} raw
 * @returns {Record<string, string>}
 */
export function parseEnvFile(raw) {
  const values = {};
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const entry = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    const key = entry.slice(0, separator).trim();
    if (!KEY.test(key)) continue;

    let value = entry.slice(separator + 1).trim();
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      // An unquoted value ends at a comment: "KEY=value # note" keeps only "value".
      const comment = value.search(/\s#/);
      if (comment >= 0) value = value.slice(0, comment).trim();
    }
    values[key] = value;
  }
  return values;
}

/**
 * Reads a .env file into an environment object. A missing file is not an error: the server runs
 * on its declared defaults, with no language model configured.
 *
 * @param {{path?: string|null, env?: Record<string, string|undefined>}} [options]
 * @returns {{path: string|null, found: boolean, loaded: string[]}}
 */
export function loadEnvFile({ path: filePath = null, env = process.env } = {}) {
  const result = { path: filePath, found: false, loaded: [] };
  if (!filePath) return result;

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return result;
  }

  result.found = true;
  for (const [key, value] of Object.entries(parseEnvFile(raw))) {
    if (Object.hasOwn(env, key)) continue;
    env[key] = value;
    result.loaded.push(key);
  }
  return result;
}
