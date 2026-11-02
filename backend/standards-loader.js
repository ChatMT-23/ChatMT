/**
 * Loads the standards from standards/*.json.
 *
 * The files stay the authoritative source: they can be edited without touching the code, and
 * a broken file stops the server with a message that says which file and why.
 */

import fs from 'node:fs';
import path from 'node:path';

function readJson(directory, fileName) {
  const file = path.join(directory, fileName);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read the standard ${fileName}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`The standard ${fileName} is not valid JSON: ${error.message}`);
  }
}

/**
 * @param {{directory: string}} options
 * @returns {{usage: object, meanings: object}}
 */
export function loadStandards({ directory } = {}) {
  if (typeof directory !== 'string' || directory.trim() === '') {
    throw new TypeError('loadStandards needs the standards directory.');
  }
  return {
    usage: readJson(directory, 'usage-of-colours.json'),
    meanings: readJson(directory, 'colour-meanings.json')
  };
}
