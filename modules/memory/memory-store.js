/**
 * Memory Engine (Phase 2 scope).
 *
 * The brief asks for five memory categories. Phase 2 uses two of them:
 *   A. conversational  -> not stored yet (there is no conversation yet)
 *   B. preference      -> implemented: the colour the user chose
 *   C. knowledge       -> not stored yet (nothing is learned from text yet)
 *   D. correction      -> implemented: the user says an answer was wrong
 *   E. interaction     -> not stored yet (no outcome tracking yet)
 *
 * The categories that are not used are declared here so the schema does not have to change
 * later, but no record of those categories is created by this version. Nothing in the
 * interface claims otherwise.
 *
 * Privacy rules implemented here:
 * - nothing is written without `consent === true`;
 * - records are stored per user id, so one user never sees another user's records;
 * - `clear()` removes everything for the current user;
 * - the storage adapter is injected, so the browser uses localStorage while tests use memory.
 */

import { isValidHex, normaliseHex } from '../color_engine/color-space.js';

export const CATEGORIES = Object.freeze({
  CONVERSATIONAL: 'conversational',
  PREFERENCE: 'preference',
  KNOWLEDGE: 'knowledge',
  CORRECTION: 'correction',
  INTERACTION: 'interaction'
});

export const CONFIRMATION = Object.freeze({
  CONFIRMED: 'confirmed',
  UNCONFIRMED: 'unconfirmed'
});

/** Thrown when a write is attempted without explicit consent. */
export class ConsentRequiredError extends Error {
  constructor() {
    super('Nothing can be stored without explicit consent.');
    this.name = 'ConsentRequiredError';
  }
}

/** Thrown when a record id does not exist for the current user. */
export class RecordNotFoundError extends Error {
  constructor(id) {
    super(`No record with id ${JSON.stringify(id)} for this user.`);
    this.name = 'RecordNotFoundError';
    this.id = id;
  }
}

/**
 * Storage adapter backed by a Map. Used by tests and as a fallback when the browser
 * refuses localStorage (for example in private mode).
 */
export function createVolatileAdapter() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    available: true
  };
}

function defaultIdFactory() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const STORAGE_PREFIX = 'chatmt.memory';

export class MemoryStore {
  /**
   * @param {object} options
   * @param {{getItem: Function, setItem: Function, removeItem: Function}} options.adapter
   * @param {string} [options.userId] records are namespaced by this id
   * @param {() => string} [options.now] injectable clock (tests)
   * @param {() => string} [options.idFactory] injectable id generator (tests)
   */
  constructor({ adapter, userId = 'local-user', now = () => new Date().toISOString(), idFactory = defaultIdFactory } = {}) {
    if (!adapter || typeof adapter.getItem !== 'function' || typeof adapter.setItem !== 'function') {
      throw new TypeError('MemoryStore requires a storage adapter with getItem and setItem.');
    }
    this.adapter = adapter;
    this.userId = userId;
    this.now = now;
    this.idFactory = idFactory;
    this.storageKey = `${STORAGE_PREFIX}.${userId}`;
  }

  /** @returns {Array<object>} every record of the current user, corrupted storage included */
  #read() {
    const raw = this.adapter.getItem(this.storageKey);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.records) ? parsed.records : [];
    } catch {
      // A damaged storage must not crash the interface nor silently look empty.
      throw new Error(`Stored memory for ${this.userId} is unreadable and was not modified.`);
    }
  }

  #write(records) {
    this.adapter.setItem(this.storageKey, JSON.stringify({ version: 1, userId: this.userId, records }));
  }

  #createRecord({ category, content, origin, confidence = 1, ttlMs = null, confirmation = CONFIRMATION.CONFIRMED, consent }) {
    if (consent !== true) throw new ConsentRequiredError();
    const now = this.now();
    return {
      id: this.idFactory(),
      category,
      user_id: this.userId,
      content,
      origin,
      created_at: now,
      updated_at: now,
      confidence,
      expires_at: ttlMs === null ? null : new Date(new Date(now).getTime() + ttlMs).toISOString(),
      confirmation,
      consent: true
    };
  }

  #assertColourHex(hex) {
    if (!isValidHex(hex)) throw new TypeError(`Not a valid colour: ${JSON.stringify(hex)}`);
    return normaliseHex(hex);
  }

  /** A record is expired when `expires_at` is in the past. */
  isExpired(record) {
    return record.expires_at !== null && new Date(record.expires_at).getTime() <= new Date(this.now()).getTime();
  }

  /**
   * Store a colour preference (category B).
   * @param {{hex: string, name?: string|null, reason?: string|null, consent: boolean, origin?: string, confidence?: number, ttlMs?: number|null, confirmation?: string}} input
   * @returns {object} the stored record
   */
  addPreference({
    hex,
    name = null,
    reason = null,
    consent,
    origin = 'palette_selection',
    confidence = 1,
    ttlMs = null,
    confirmation = CONFIRMATION.CONFIRMED
  }) {
    const normalised = this.#assertColourHex(hex);
    const record = this.#createRecord({
      category: CATEGORIES.PREFERENCE,
      content: { kind: 'colour', hex: normalised, name, reason },
      origin,
      confidence,
      ttlMs,
      confirmation,
      consent
    });
    const records = this.#read();
    records.push(record);
    this.#write(records);
    return record;
  }

  /**
   * Store the user's correction of an answer (category D). A correction is kept as a
   * separate record: it never rewrites the standard code by itself.
   * @param {{hex: string, name?: string|null, targetStandardId?: string|null, proposedOutcome: string, note?: string, consent: boolean}} input
   */
  addCorrection({ hex, name = null, targetStandardId = null, proposedOutcome, note = '', consent }) {
    const normalised = this.#assertColourHex(hex);
    if (typeof proposedOutcome !== 'string' || proposedOutcome.trim() === '') {
      throw new TypeError('A correction needs the outcome it proposes (for example "accepted").');
    }
    const record = this.#createRecord({
      category: CATEGORIES.CORRECTION,
      content: {
        kind: 'colour_outcome_correction',
        hex: normalised,
        name,
        target_standard_id: targetStandardId,
        proposed_outcome: proposedOutcome,
        note: String(note)
      },
      origin: 'user_correction',
      confidence: 1,
      ttlMs: null,
      confirmation: CONFIRMATION.CONFIRMED,
      consent
    });
    const records = this.#read();
    records.push(record);
    this.#write(records);
    return record;
  }

  /**
   * Store a record of any declared category. Used by the backend for the friendliness
   * standing (category `interaction`) and for the assessment of a reason (category
   * `knowledge`); the same consent rule applies as everywhere else.
   *
   * @param {{category: string, content: object, origin: string, confidence?: number, ttlMs?: number|null, confirmation?: string, consent: boolean}} input
   */
  addRecord({
    category,
    content,
    origin,
    confidence = 1,
    ttlMs = null,
    confirmation = CONFIRMATION.CONFIRMED,
    consent
  }) {
    const allowed = Object.values(CATEGORIES);
    if (!allowed.includes(category)) {
      throw new TypeError(`Unknown memory category ${JSON.stringify(category)}. Allowed: ${allowed.join(', ')}.`);
    }
    if (content === null || typeof content !== 'object' || Array.isArray(content)) {
      throw new TypeError('A record needs an object as its content.');
    }
    if (typeof origin !== 'string' || origin.trim() === '') {
      throw new TypeError('A record needs a non-empty origin.');
    }
    const record = this.#createRecord({
      category,
      content,
      origin,
      confidence,
      ttlMs,
      confirmation,
      consent
    });
    const records = this.#read();
    records.push(record);
    this.#write(records);
    return record;
  }

  /**
   * The most recent valid record of a category, optionally of one content kind.
   * @param {{category: string, kind?: string|null}} input
   * @returns {object|null}
   */
  latestRecord({ category, kind = null } = {}) {
    const records = this.list({ category });
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];
      if (kind === null || record.content?.kind === kind) return record;
    }
    return null;
  }

  /**
   * Merge fields into the content of an existing record, keeping its id and creation date.
   * @param {string} id
   * @param {object} patch
   */
  updateContent(id, patch) {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new TypeError('updateContent needs an object of fields.');
    }
    const records = this.#read();
    const record = records.find((entry) => entry.id === id);
    if (!record) throw new RecordNotFoundError(id);
    record.content = { ...record.content, ...patch };
    record.updated_at = this.now();
    this.#write(records);
    return record;
  }

  /**
   * Update a stored preference, keeping its id and creation date.
   * @param {string} id
   * @param {{hex?: string, name?: string|null, reason?: string|null, confirmation?: string}} [changes]
   */
  updatePreference(id, { hex, name, reason, confirmation } = {}) {
    const records = this.#read();
    const record = records.find((entry) => entry.id === id);
    if (!record) throw new RecordNotFoundError(id);
    if (record.category !== CATEGORIES.PREFERENCE) {
      throw new TypeError(`Record ${id} is not a preference and cannot be edited as one.`);
    }
    if (hex !== undefined) record.content.hex = this.#assertColourHex(hex);
    if (name !== undefined) record.content.name = name;
    if (reason !== undefined) record.content.reason = reason;
    if (confirmation !== undefined) record.confirmation = confirmation;
    record.updated_at = this.now();
    this.#write(records);
    return record;
  }

  get(id) {
    return this.#read().find((record) => record.id === id) ?? null;
  }

  /**
   * @param {{category?: string|null, includeExpired?: boolean}} [options]
   * @returns {Array<object>}
   */
  list({ category = null, includeExpired = false } = {}) {
    return this.#read().filter(
      (record) => (category === null || record.category === category) && (includeExpired || !this.isExpired(record))
    );
  }

  /** Stored preferences, most recent first. */
  listPreferences({ includeExpired = false } = {}) {
    return this.list({ category: CATEGORIES.PREFERENCE, includeExpired }).reverse();
  }

  /** The most recent valid preference, or null. */
  currentPreference() {
    return this.listPreferences()[0] ?? null;
  }

  /** Corrections recorded for one exact colour, newest first. Exact HEX match only. */
  correctionsFor(hex, { includeExpired = false } = {}) {
    const normalised = this.#assertColourHex(hex);
    return this.list({ category: CATEGORIES.CORRECTION, includeExpired })
      .filter((record) => record.content.hex === normalised)
      .reverse();
  }

  /** Delete one record. @returns {boolean} true when a record was removed */
  delete(id) {
    const records = this.#read();
    const remaining = records.filter((record) => record.id !== id);
    if (remaining.length === records.length) return false;
    this.#write(remaining);
    return true;
  }

  /** Delete every record of the current user and drop the storage entry. @returns {number} records removed */
  clear() {
    const removed = this.#read().length;
    this.adapter.removeItem(this.storageKey);
    return removed;
  }

  /** @returns {number} number of records of the current user (expired included) */
  count() {
    return this.#read().length;
  }
}
