import Dexie from 'dexie';
import { describe, expect, it, vi } from 'vitest';
import { FieldOsDb } from './db';
import { Repositories, StoragePersistenceError } from './repositories';
import { makeTestRepos } from '../test/helpers';
import type { CapturedLocation, Observation } from '../domain/types';

const goodFix = (): CapturedLocation => ({
  latitude: 47.37,
  longitude: 8.54,
  accuracyMeters: 5,
  altitudeMeters: 667,
  altitudeAccuracyMeters: 4.5,
  headingDegrees: 127,
  speedMetersPerSecond: 1.8,
  locationStatus: 'CAPTURED',
  capturedAt: '2026-08-21T09:00:00.000+02:00',
});

async function newObservation(repos: Repositories) {
  const session = await repos.createSession({ title: 'Audit session' });
  const observation = await repos.createObservation({
    sessionId: session.id,
    capturedLocation: goodFix(),
    observation: { category: 'litter', value: 'LOW' },
    evidence: { method: 'OBSERVED' },
    note: 'first look',
  });
  return { session, observation };
}

describe('observation audit — Dexie migration (v1 → v2)', () => {
  it('upgrades a version-1 database, preserving all data and adding the audit store', async () => {
    const name = `fieldos-migrate-${crypto.randomUUID()}`;

    // Build a database at Dexie VERSION 1 only (the pre-P1-5 schema: no audit store).
    const legacyDb = new Dexie(name);
    legacyDb.version(1).stores({
      fieldSessions: 'id, status, createdAt',
      assets: 'id, sessionId, source',
      observations: 'id, sessionId, createdAt, capturedAt',
      media: 'id, observationId',
    });
    await legacyDb.open();
    const sessionId = crypto.randomUUID();
    const observationId = crypto.randomUUID();
    await legacyDb.table('fieldSessions').add({ id: sessionId, title: 'v1 session', status: 'active' });
    await legacyDb.table('assets').add({ id: crypto.randomUUID(), sessionId, name: 'v1 asset', source: 'field_created' });
    await legacyDb.table('observations').add({ id: observationId, sessionId, note: 'v1 observation' });
    await legacyDb.table('media').add({ id: crypto.randomUUID(), observationId, kind: 'photo' });
    legacyDb.close();

    // Re-open under the real app schema, which declares version 2 → triggers the upgrade.
    const upgraded = new FieldOsDb(name);
    await upgraded.open();
    expect(upgraded.verno).toBe(2);

    // All version-1 rows survive untouched.
    expect(await upgraded.fieldSessions.count()).toBe(1);
    expect(await upgraded.assets.count()).toBe(1);
    expect(await upgraded.observations.count()).toBe(1);
    expect(await upgraded.media.count()).toBe(1);
    expect((await upgraded.fieldSessions.get(sessionId))?.title).toBe('v1 session');
    expect((await upgraded.observations.get(observationId))?.note).toBe('v1 observation');

    // The new store exists, is queryable, and starts empty — no fabricated history.
    expect(await upgraded.observationAudit.count()).toBe(0);
    expect(await upgraded.observationAudit.where('observationId').equals(observationId).toArray()).toEqual([]);
    upgraded.close();
  });
});

describe('observation audit — CREATED', () => {
  it('records exactly one CREATED entry (sequence 1) with before=null', async () => {
    const { repos } = makeTestRepos();
    const { observation } = await newObservation(repos);

    const entries = await repos.listObservationAuditEntries(observation.id);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry!.sequence).toBe(1);
    expect(entry!.eventType).toBe('CREATED');
    expect(entry!.before).toBeNull();
    expect(entry!.after.observation).toEqual({ category: 'litter', value: 'LOW' });
    expect(entry!.after.note).toBe('first look');
    expect(entry!.after.editCount).toBe(0);
    expect(entry!.after.deleted).toBe(false);
    // Snapshot boundary: raw capture block is NOT carried into the audit state.
    expect(entry!.after).not.toHaveProperty('capturedAt');
    expect(entry!.after).not.toHaveProperty('capturedLocation');
  });
});

describe('observation audit — interpretation edits', () => {
  it('appends INTERPRETATION_UPDATED (sequence 2) with before/after and preserves raw capture', async () => {
    const { repos } = makeTestRepos();
    const { observation } = await newObservation(repos);

    const edited = await repos.updateInterpretation(observation.id, {
      observation: { category: 'litter', value: 'HIGH' },
      note: 'worse than first thought',
    });

    const entries = await repos.listObservationAuditEntries(observation.id);
    expect(entries.map((e) => e.sequence)).toEqual([1, 2]);
    const second = entries[1]!;
    expect(second.eventType).toBe('INTERPRETATION_UPDATED');
    expect(second.before?.observation).toEqual({ category: 'litter', value: 'LOW' });
    expect(second.before?.note).toBe('first look');
    expect(second.after.observation).toEqual({ category: 'litter', value: 'HIGH' });
    expect(second.after.note).toBe('worse than first thought');

    // Raw capture is untouched by the edit and never appears in the log.
    expect(edited.capturedAt).toBe(observation.capturedAt);
    expect(edited.capturedLocation).toEqual(observation.capturedLocation);
    expect(second.after).not.toHaveProperty('capturedLocation');
  });

  it('keeps sequences strictly increasing across multiple edits', async () => {
    const { repos } = makeTestRepos();
    const { observation } = await newObservation(repos);
    await repos.updateInterpretation(observation.id, { note: 'edit 1' });
    await repos.updateInterpretation(observation.id, { note: 'edit 2' });
    await repos.updateInterpretation(observation.id, { note: 'edit 3' });

    const sequences = (await repos.listObservationAuditEntries(observation.id)).map((e) => e.sequence);
    expect(sequences).toEqual([1, 2, 3, 4]);
  });

  it('does not mutate historical snapshots when the observation changes later', async () => {
    const { repos } = makeTestRepos();
    const { observation } = await newObservation(repos);
    await repos.updateInterpretation(observation.id, { note: 'second note' });

    const afterFirst = (await repos.listObservationAuditEntries(observation.id))[0]!;
    expect(afterFirst.after.note).toBe('first look'); // CREATED snapshot is frozen.
  });

  it('gives independent observations their own sequence counters starting at 1', async () => {
    const { repos } = makeTestRepos();
    const session = await repos.createSession({ title: 'Two obs' });
    const a = await repos.createObservation({
      sessionId: session.id,
      capturedLocation: goodFix(),
      observation: { category: 'litter', value: 'LOW' },
      evidence: { method: 'OBSERVED' },
    });
    const b = await repos.createObservation({
      sessionId: session.id,
      capturedLocation: goodFix(),
      observation: { category: 'litter', value: 'HIGH' },
      evidence: { method: 'OBSERVED' },
    });
    await repos.updateInterpretation(a.id, { note: 'a edit' });
    await repos.updateInterpretation(b.id, { note: 'b edit' });

    expect((await repos.listObservationAuditEntries(a.id)).map((e) => e.sequence)).toEqual([1, 2]);
    expect((await repos.listObservationAuditEntries(b.id)).map((e) => e.sequence)).toEqual([1, 2]);
  });
});

describe('observation audit — location adjustments', () => {
  it('retains previous and new adjustment in before/after and never changes raw GNSS', async () => {
    const { repos } = makeTestRepos();
    const { observation } = await newObservation(repos);

    await repos.adjustLocation(observation.id, { latitude: 47.9, longitude: 8.9, reason: 'A' });
    const afterSecond = await repos.adjustLocation(observation.id, { latitude: 48.1, longitude: 9.1, reason: 'B' });

    const entries = await repos.listObservationAuditEntries(observation.id);
    expect(entries.map((e) => e.eventType)).toEqual(['CREATED', 'LOCATION_ADJUSTED', 'LOCATION_ADJUSTED']);

    const firstAdjust = entries[1]!;
    const secondAdjust = entries[2]!;
    expect(firstAdjust.before?.locationAdjustment).toBeNull();
    expect(firstAdjust.after.locationAdjustment?.latitude).toBe(47.9);
    // The A → B history is preserved: the second event's `before` holds adjustment A.
    expect(secondAdjust.before?.locationAdjustment?.latitude).toBe(47.9);
    expect(secondAdjust.before?.locationAdjustment?.locationAdjustmentReason).toBe('A');
    expect(secondAdjust.after.locationAdjustment?.latitude).toBe(48.1);

    // Raw captured GNSS is unchanged throughout.
    expect(afterSecond.capturedLocation).toEqual(observation.capturedLocation);
  });
});

describe('observation audit — soft delete / restore', () => {
  it('records SOFT_DELETED then RESTORED in order', async () => {
    const { repos } = makeTestRepos();
    const { observation } = await newObservation(repos);
    await repos.softDeleteObservation(observation.id);
    await repos.restoreObservation(observation.id);

    const entries = await repos.listObservationAuditEntries(observation.id);
    expect(entries.map((e) => e.eventType)).toEqual(['CREATED', 'SOFT_DELETED', 'RESTORED']);
    expect(entries[1]!.before?.deleted).toBe(false);
    expect(entries[1]!.after.deleted).toBe(true);
    expect(entries[2]!.after.deleted).toBe(false);
  });

  it('does not append a duplicate event for a no-op repeated delete or restore', async () => {
    const { repos } = makeTestRepos();
    const { observation } = await newObservation(repos);
    await repos.softDeleteObservation(observation.id);
    await repos.softDeleteObservation(observation.id); // already deleted → no-op
    await repos.restoreObservation(observation.id);
    await repos.restoreObservation(observation.id); // already live → no-op

    const events = (await repos.listObservationAuditEntries(observation.id)).map((e) => e.eventType);
    expect(events).toEqual(['CREATED', 'SOFT_DELETED', 'RESTORED']);
  });

  it('does not bump editCount for delete/restore', async () => {
    const { repos } = makeTestRepos();
    const { observation } = await newObservation(repos);
    await repos.softDeleteObservation(observation.id);
    const reloaded = await repos.getObservation(observation.id);
    expect(reloaded?.editCount).toBe(0);
    expect(reloaded?.edited).toBe(false);
  });
});

describe('observation audit — legacy (pre-audit) observations', () => {
  async function insertLegacyObservation(repos: Repositories, db: FieldOsDb) {
    const session = await repos.createSession({ title: 'Legacy' });
    const created = await repos.createObservation({
      sessionId: session.id,
      capturedLocation: goodFix(),
      observation: { category: 'other', value: null },
      evidence: { method: 'OBSERVED' },
    });
    // Simulate a record that existed before audit logging: strip its audit entries and
    // downgrade the schemaVersion, exactly as a schema-1/2 record would look.
    await db.observationAudit.where('observationId').equals(created.id).delete();
    await db.observations.put({ ...created, schemaVersion: 1 } as Observation);
    return created;
  }

  it('has no audit entries until its first real mutation, and does not fabricate CREATED', async () => {
    const { repos, db } = makeTestRepos();
    const legacy = await insertLegacyObservation(repos, db);

    // Reading / listing must not manufacture any audit event.
    await repos.getObservation(legacy.id);
    await repos.listObservations(legacy.sessionId);
    expect(await repos.listObservationAuditEntries(legacy.id)).toEqual([]);

    // First edit begins the history at sequence 1 as INTERPRETATION_UPDATED (NOT CREATED).
    await repos.updateInterpretation(legacy.id, { note: 'first real change' });
    const entries = await repos.listObservationAuditEntries(legacy.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.sequence).toBe(1);
    expect(entries[0]!.eventType).toBe('INTERPRETATION_UPDATED');
    expect(entries.some((e) => e.eventType === 'CREATED')).toBe(false);
  });
});

describe('observation audit — transactional atomicity (rollback)', () => {
  it('rolls back the observation write when the audit append fails', async () => {
    const { repos, db } = makeTestRepos();
    const session = await repos.createSession({ title: 'Rollback' });
    const spy = vi.spyOn(db.observationAudit, 'add').mockRejectedValueOnce(new Error('audit IO failure'));

    await expect(
      repos.createObservation({
        sessionId: session.id,
        capturedLocation: goodFix(),
        observation: { category: 'litter', value: 'LOW' },
        evidence: { method: 'OBSERVED' },
      }),
    ).rejects.toBeInstanceOf(StoragePersistenceError);

    // Neither the observation nor any audit entry may remain.
    expect(await db.observations.count()).toBe(0);
    expect(await db.observationAudit.count()).toBe(0);
    spy.mockRestore();
  });

  it('leaves no audit entry when the observation write fails', async () => {
    const { repos, db } = makeTestRepos();
    const session = await repos.createSession({ title: 'Rollback 2' });
    const spy = vi.spyOn(db.observations, 'add').mockRejectedValueOnce(new Error('quota exceeded'));

    await expect(
      repos.createObservation({
        sessionId: session.id,
        capturedLocation: goodFix(),
        observation: { category: 'litter', value: 'LOW' },
        evidence: { method: 'OBSERVED' },
      }),
    ).rejects.toBeInstanceOf(StoragePersistenceError);

    expect(await db.observations.count()).toBe(0);
    expect(await db.observationAudit.count()).toBe(0);
    spy.mockRestore();
  });

  it('rolls back an interpretation edit and its audit entry together on failure', async () => {
    const { repos, db } = makeTestRepos();
    const { observation } = await newObservation(repos);
    const spy = vi.spyOn(db.observationAudit, 'add').mockRejectedValueOnce(new Error('audit IO failure'));

    await expect(
      repos.updateInterpretation(observation.id, { note: 'should not persist' }),
    ).rejects.toBeInstanceOf(StoragePersistenceError);

    // The observation is unchanged and only the original CREATED entry remains.
    const reloaded = await repos.getObservation(observation.id);
    expect(reloaded?.note).toBe('first look');
    expect(reloaded?.editCount).toBe(0);
    const entries = await repos.listObservationAuditEntries(observation.id);
    expect(entries.map((e) => e.eventType)).toEqual(['CREATED']);
    spy.mockRestore();
  });
});
