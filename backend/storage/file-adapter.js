/**
 * File storage adapter for the Memory Engine.
 *
 * The Memory Engine asks its adapter for a string by key; in the browser that key maps to
 * localStorage, here it maps to one JSON file per key. Writes are atomic (temporary file +
 * rename) so an interrupted request cannot leave a half-written profile behind.
 *
 * The adapter does not interpret the data: the Memory Engine writes
 * `{version, userId, records}` and reads it back.
 */

import fs from 'node:fs';
import path from 'node:path';

export class StorageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StorageError';
    this.code = 'storage_unavailable';
  }
}

let writeCounter = 0;

/** Files are named after the key, with every character outside a safe set replaced. */
export function fileNameForKey(key) {
  return `${String(key).replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
}

/**
 * @param {{directory: string}} options
 */
export function createFileAdapter({ directory } = {}) {
  if (typeof directory !== 'string' || directory.trim() === '') {
    throw new TypeError('createFileAdapter needs a directory.');
  }
  const root = path.resolve(directory);
  try {
    fs.mkdirSync(root, { recursive: true });
  } catch (error) {
    throw new StorageError(`Cannot create the data directory ${root}: ${error.message}`);
  }

  const fileFor = (key) => path.join(root, fileNameForKey(key));

  return {
    available: true,
    directory: root,
    fileFor,

    getItem(key) {
      try {
        return fs.readFileSync(fileFor(key), 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw new StorageError(`Cannot read the stored profile: ${error.message}`);
      }
    },

    setItem(key, value) {
      if (typeof value !== 'string') {
        throw new TypeError('The file adapter stores strings only.');
      }
      const target = fileFor(key);
      const temporary = `${target}.${process.pid}.${++writeCounter}.tmp`;
      try {
        fs.writeFileSync(temporary, value, { encoding: 'utf8' });
        fs.renameSync(temporary, target);
      } catch (error) {
        try {
          fs.rmSync(temporary, { force: true });
        } catch {
          // Best effort: the temporary file is named after this process and is harmless.
        }
        throw new StorageError(`Cannot write the stored profile: ${error.message}`);
      }
    },

    removeItem(key) {
      try {
        fs.rmSync(fileFor(key), { force: true });
      } catch (error) {
        throw new StorageError(`Cannot remove the stored profile: ${error.message}`);
      }
    }
  };
}
