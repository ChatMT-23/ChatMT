/**
 * Tests of the Memory Engine.
 *
 * The clock and the record ids are injected so that these tests are deterministic: no test
 * depends on the real date or on a generated UUID.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORIES,
  CONFIRMATION,
  ConsentRequiredError,
  MemoryStore,
  RecordNotFoundError,
  createVolatileAdapter
} from '../modules/memory/memory-store.js';

function createTestStore({ userId = 'user-a', adapter = createVolatileAdapter() } = {}) {
  let clock = Date.parse('2026-10-26T10:00:00.000Z');
  let counter = 0;
  const store = new MemoryStore({
    adapter,
    userId,
    now: () => new Date(clock).toISOString(),
    idFactory: () => `record-${++counter}`
  });
  return {
    store,
    adapter,
    advance(milliseconds) {
      clock += milliseconds;
    }
  };
}

test('a preference cannot be stored without explicit consent', () => {
  const { store } = createTestStore();
  assert.throws(() => store.addPreference({ hex: '#0000FF' }), ConsentRequiredError);
  assert.throws(() => store.addPreference({ hex: '#0000FF', consent: false }), ConsentRequiredError);
  assert.throws(
    () => store.addCorrection({ hex: '#0000FF', proposedOutcome: 'question' }),
    ConsentRequiredError
  );
  assert.equal(store.count(), 0, 'a refused write must leave the memory untouched');
});

test('a stored preference keeps every field the brief asks for', () => {
  const { store } = createTestStore();
  const record = store.addPreference({ hex: '#0000ff', name: 'blue', consent: true, confidence: 1 });

  assert.equal(record.id, 'record-1');
  assert.equal(record.category, CATEGORIES.PREFERENCE);
  assert.equal(record.user_id, 'user-a');
  assert.deepEqual(record.content, { kind: 'colour', hex: '#0000FF', name: 'blue', reason: null });
  assert.equal(record.origin, 'palette_selection');
  assert.equal(record.created_at, '2026-10-26T10:00:00.000Z');
  assert.equal(record.updated_at, record.created_at);
  assert.equal(record.confidence, 1);
  assert.equal(record.expires_at, null);
  assert.equal(record.confirmation, CONFIRMATION.CONFIRMED);
  assert.equal(record.consent, true);
});

test('the answer given to a "question" rule is stored with the preference', () => {
  const { store } = createTestStore();
  const record = store.addPreference({
    hex: '#FF0000',
    name: 'red',
    reason: 'it was my first bicycle',
    consent: true
  });
  assert.equal(record.content.reason, 'it was my first bicycle');
  assert.equal(store.currentPreference().content.reason, 'it was my first bicycle');
});

test('replacing a preference updates the answer, the confirmation and the date', () => {
  const { store, advance } = createTestStore();
  const record = store.addPreference({
    hex: '#00FF00',
    name: 'lime',
    consent: true,
    confirmation: CONFIRMATION.UNCONFIRMED,
    origin: 'palette_selection_uncovered'
  });

  advance(1000);
  const updated = store.updatePreference(record.id, {
    hex: '#008000',
    name: 'green',
    reason: null,
    confirmation: CONFIRMATION.CONFIRMED
  });

  assert.equal(updated.content.hex, '#008000');
  assert.equal(updated.content.name, 'green');
  assert.equal(updated.confirmation, CONFIRMATION.CONFIRMED);
  assert.equal(updated.updated_at, '2026-10-26T10:00:01.000Z');
  assert.equal(updated.created_at, '2026-10-26T10:00:00.000Z');
});

test('memory persists: a new store on the same storage sees the record', () => {
  const adapter = createVolatileAdapter();
  const first = createTestStore({ adapter });
  first.store.addPreference({ hex: '#008000', name: 'green', consent: true });

  const second = new MemoryStore({ adapter, userId: 'user-a' });
  assert.equal(second.count(), 1);
  assert.equal(second.currentPreference().content.hex, '#008000');
});

test('retrieval works by id, by category and for corrections of one colour', () => {
  const { store } = createTestStore();
  const preference = store.addPreference({ hex: '#008000', name: 'green', consent: true });
  store.addCorrection({
    hex: '#008000',
    proposedOutcome: 'question',
    note: 'green should be questioned too',
    consent: true
  });
  store.addCorrection({ hex: '#FF0000', proposedOutcome: 'accepted', consent: true });

  assert.equal(store.get(preference.id).id, preference.id);
  assert.equal(store.get('does-not-exist'), null);
  assert.equal(store.list({ category: CATEGORIES.PREFERENCE }).length, 1);
  assert.equal(store.list({ category: CATEGORIES.CORRECTION }).length, 2);
  assert.equal(store.correctionsFor('#008000').length, 1);
  assert.equal(store.correctionsFor('#008000')[0].content.proposed_outcome, 'question');
  assert.equal(store.correctionsFor('#0000FF').length, 0);
});

test('users are separated: one user never reads another user records', () => {
  const adapter = createVolatileAdapter();
  const alice = createTestStore({ adapter, userId: 'alice' });
  const bob = createTestStore({ adapter, userId: 'bob' });

  alice.store.addPreference({ hex: '#008000', name: 'green', consent: true });
  bob.store.addPreference({ hex: '#FFFF00', name: 'yellow', consent: true });

  assert.equal(alice.store.count(), 1);
  assert.equal(bob.store.count(), 1);
  assert.equal(alice.store.currentPreference().content.hex, '#008000');
  assert.equal(bob.store.currentPreference().content.hex, '#FFFF00');

  assert.equal(bob.store.clear(), 1);
  assert.equal(bob.store.count(), 0);
  assert.equal(alice.store.count(), 1, 'clearing one user must not touch another user');
});

test('updating a preference keeps its id and creation date', () => {
  const { store, advance } = createTestStore();
  const record = store.addPreference({ hex: '#0000FF', name: 'blue', consent: true });

  advance(60_000);
  const updated = store.updatePreference(record.id, { hex: '#4b0082', name: 'indigo' });

  assert.equal(updated.id, record.id);
  assert.equal(updated.created_at, '2026-10-26T10:00:00.000Z');
  assert.equal(updated.updated_at, '2026-10-26T10:01:00.000Z');
  assert.equal(updated.content.hex, '#4B0082');
  assert.equal(updated.content.name, 'indigo');
  assert.equal(store.currentPreference().content.hex, '#4B0082', 'the change must be persisted');
  assert.throws(() => store.updatePreference('missing', { hex: '#000000' }), RecordNotFoundError);
});

test('deleting removes the record and reports whether anything was removed', () => {
  const { store } = createTestStore();
  const record = store.addPreference({ hex: '#0000FF', name: 'blue', consent: true });

  assert.equal(store.delete(record.id), true);
  assert.equal(store.get(record.id), null);
  assert.equal(store.count(), 0);
  assert.equal(store.delete(record.id), false);
});

test('clear removes every record of the user and drops the storage entry', () => {
  const { store, adapter } = createTestStore();
  store.addPreference({ hex: '#0000FF', name: 'blue', consent: true });
  store.addPreference({ hex: '#008000', name: 'green', consent: true });

  assert.equal(store.clear(), 2);
  assert.equal(store.count(), 0);
  assert.equal(adapter.getItem('chatmt.memory.user-a'), null);
});

test('an expired record is not offered as context but is still there', () => {
  const { store, advance } = createTestStore();
  store.addPreference({ hex: '#0000FF', name: 'blue', consent: true, ttlMs: 60_000 });

  assert.equal(store.list().length, 1);
  advance(120_000);
  assert.equal(store.list().length, 0, 'expired records must not be used as context');
  assert.equal(store.list({ includeExpired: true }).length, 1);
  assert.equal(store.currentPreference(), null);
  assert.equal(store.isExpired(store.list({ includeExpired: true })[0]), true);
});

test('invalid input is refused instead of being stored', () => {
  const { store } = createTestStore();
  assert.throws(() => store.addPreference({ hex: 'blue', consent: true }), TypeError);
  assert.throws(() => store.addPreference({ hex: '#GGG', consent: true }), TypeError);
  assert.throws(() => store.correctionsFor('nope'), TypeError);
  assert.throws(() => store.addCorrection({ hex: '#0000FF', proposedOutcome: '  ', consent: true }), TypeError);
  assert.equal(store.count(), 0);
});

test('generic records keep the consent rule and can be found by category and kind', () => {
  const { store } = createTestStore();
  assert.throws(
    () => store.addRecord({ category: CATEGORIES.INTERACTION, content: { kind: 'x' }, origin: 'test' }),
    ConsentRequiredError
  );
  assert.throws(
    () => store.addRecord({ category: 'not-a-category', content: { kind: 'x' }, origin: 'test', consent: true }),
    TypeError
  );
  assert.throws(
    () => store.addRecord({ category: CATEGORIES.INTERACTION, content: null, origin: 'test', consent: true }),
    TypeError
  );
  assert.equal(store.count(), 0);

  const first = store.addRecord({
    category: CATEGORIES.INTERACTION,
    content: { kind: 'friendliness_standing', level: 'friendly' },
    origin: 'test',
    consent: true
  });
  store.addRecord({
    category: CATEGORIES.KNOWLEDGE,
    content: { kind: 'colour_reason_assessment', verdict: 'personal' },
    origin: 'test',
    consent: true
  });

  assert.equal(store.latestRecord({ category: CATEGORIES.INTERACTION, kind: 'friendliness_standing' }).id, first.id);
  assert.equal(store.latestRecord({ category: CATEGORIES.INTERACTION, kind: 'missing' }), null);
  assert.equal(store.latestRecord({ category: CATEGORIES.PREFERENCE }), null);
});

test('updateContent merges fields and keeps the identity of the record', () => {
  const { store, advance } = createTestStore();
  const record = store.addRecord({
    category: CATEGORIES.INTERACTION,
    content: { kind: 'friendliness_standing', level: 'friendly', pending: { displeasure: false } },
    origin: 'test',
    consent: true
  });

  advance(5000);
  const updated = store.updateContent(record.id, { level: 'not_friendly', pending: { displeasure: true } });

  assert.equal(updated.id, record.id);
  assert.equal(updated.created_at, record.created_at);
  assert.equal(updated.updated_at, '2026-10-26T10:00:05.000Z');
  assert.deepEqual(updated.content, {
    kind: 'friendliness_standing',
    level: 'not_friendly',
    pending: { displeasure: true }
  });
  assert.throws(() => store.updateContent('missing', { level: 'friendly' }), RecordNotFoundError);
});

test('unreadable storage raises an error instead of looking empty', () => {
  const adapter = createVolatileAdapter();
  adapter.setItem('chatmt.memory.user-a', '{not json');
  const store = new MemoryStore({ adapter, userId: 'user-a' });
  assert.throws(() => store.count(), /unreadable/);
});
