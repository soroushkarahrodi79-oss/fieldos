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

describe('Repositories — data layer quality gate', () => {
  it('creates a FieldSession', async () => {
    const { repos } = makeTestRepos();
    const s = await repos.createSession({ title: 'Session A' });
    expect(s.id).toMatch(/[0-9a-f-]{36}/);
    expect(s.status).toBe('active');
    expect(await repos.getSession(s.id)).toEqual(s);
  });

  it('creates an Asset', async () => {
    const { repos } = makeTestRepos();
    const s = await repos.createSession({ title: 'S' });
    const a = await repos.createAsset({ sessionId: s.id, name: 'Car park', latitude: 1, longitude: 2 });
    expect(a.source).toBe('field_created');
    expect(await repos.listAssets(s.id)).toHaveLength(1);
  });

  it('creates an Observation and stores captured GPS metadata', async () => {
    const { repos } = makeTestRepos();
    const s = await repos.createSession({ title: 'S' });
    const o = await repos.createObservation({
      sessionId: s.id,
      capturedLocation: goodFix(),
      observation: { category: 'visitor_pressure', value: 'HIGH' },
      evidence: { method: 'OBSERVED' },
    });
    expect(o.capturedLocation.accuracyMeters).toBe(5);
    expect(o.capturedLocation.locationStatus).toBe('CAPTURED');
    expect(o.edited).toBe(false);
    expect(o.editCount).toBe(0);
  });

  it('saves an observation without GPS (no fabricated coordinate)', async () => {
    const { repos } = makeTestRepos();
    const s = await repos.createSession({ title: 'S' });
    const o = await repos.createObservation({
      sessionId: s.id,
      capturedLocation: {
        latitude: null,
        longitude: null,
        accuracyMeters: null,
        altitudeMeters: null,
        altitudeAccuracyMeters: null,
        headingDegrees: null,
        speedMetersPerSecond: null,
        locationStatus: 'TIMEOUT',
        capturedAt: '2026-08-21T09:05:00.000+02:00',
      },
      observation: { category: 'signage_condition', value: 'MISSING' },
      evidence: { method: 'OBSERVED' },
    });
    expect(o.capturedLocation.latitude).toBeNull();
    expect(o.capturedLocation.longitude).toBeNull();
    expect(o.capturedLocation.locationStatus).toBe('TIMEOUT');
  });

  it('edits interpretation WITHOUT destroying original capture metadata', async () => {
    const { repos } = makeTestRepos();
    const s = await repos.createSession({ title: 'S' });
    const o = await repos.createObservation({
      sessionId: s.id,
      capturedLocation: goodFix(),
      observation: { category: 'litter', value: 'LOW' },
      evidence: { method: 'OBSERVED' },
    });

    const edited = await repos.updateInterpretation(o.id, {
      observation: { category: 'litter', value: 'HIGH' },
      note: 'more than first thought',
    });

    // Interpretation changed + tracked…
    expect(edited.observation).toEqual({ category: 'litter', value: 'HIGH' });
    expect(edited.note).toBe('more than first thought');
    expect(edited.edited).toBe(true);
    expect(edited.editCount).toBe(1);
    // …but the immutable capture block and createdAt are untouched.
    expect(edited.capturedAt).toBe(o.capturedAt);
    expect(edited.capturedLocation).toEqual(o.capturedLocation);
    expect(edited.capturedLocation).toMatchObject({
      latitude: 47.37,
      longitude: 8.54,
      accuracyMeters: 5,
      altitudeMeters: 667,
      altitudeAccuracyMeters: 4.5,
      headingDegrees: 127,
      speedMetersPerSecond: 1.8,
    });
    expect(edited.createdAt).toBe(o.createdAt);
  });

  it('adjusts location non-destructively (raw capturedLocation preserved)', async () => {
    const { repos } = makeTestRepos();
    const s = await repos.createSession({ title: 'S' });
    const o = await repos.createObservation({
      sessionId: s.id,
      capturedLocation: goodFix(),
      observation: { category: 'accessibility_barrier', value: 'MAJOR' },
      evidence: { method: 'OBSERVED' },
    });

    const adjusted = await repos.adjustLocation(o.id, {
      latitude: 47.9,
      longitude: 8.9,
      reason: 'moved pin',
    });

    expect(adjusted.locationAdjustment?.latitude).toBe(47.9);
    expect(adjusted.locationAdjustment?.locationAdjustmentReason).toBe('moved pin');
    // Original fix must still be exactly the captured one.
    expect(adjusted.capturedLocation).toEqual(o.capturedLocation);
    expect(adjusted.capturedLocation.altitudeAccuracyMeters).toBe(4.5);
    expect(adjusted.capturedLocation.headingDegrees).toBe(127);
    expect(adjusted.capturedLocation.speedMetersPerSecond).toBe(1.8);
    expect(adjusted.edited).toBe(true);
  });

  it('loads a legacy observation with absent GNSS additions as explicit nulls', async () => {
    const { repos, db } = makeTestRepos();
    const s = await repos.createSession({ title: 'Legacy' });
    const current = await repos.createObservation({
      sessionId: s.id,
      capturedLocation: goodFix(),
      observation: { category: 'other', value: null },
      evidence: { method: 'OBSERVED' },
    });
    const legacy = {
      ...current,
      schemaVersion: 1,
      capturedLocation: {
        latitude: current.capturedLocation.latitude,
        longitude: current.capturedLocation.longitude,
        accuracyMeters: current.capturedLocation.accuracyMeters,
        altitudeMeters: current.capturedLocation.altitudeMeters,
        locationStatus: current.capturedLocation.locationStatus,
        capturedAt: current.capturedLocation.capturedAt,
      },
    } as unknown as Observation;
    await db.observations.put(legacy);

    const loaded = await repos.getObservation(current.id);
    const listed = (await repos.listObservations(s.id))[0];
    for (const observation of [loaded, listed]) {
      expect(observation?.capturedLocation.altitudeAccuracyMeters).toBeNull();
      expect(observation?.capturedLocation.headingDegrees).toBeNull();
      expect(observation?.capturedLocation.speedMetersPerSecond).toBeNull();
    }
  });

  it('attaches media metadata', async () => {
    const { repos } = makeTestRepos();
    const s = await repos.createSession({ title: 'S' });
    const o = await repos.createObservation({
      sessionId: s.id,
      capturedLocation: goodFix(),
      observation: { category: 'other', value: null },
      evidence: { method: 'OBSERVED' },
    });
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });
    const m = await repos.addMedia({ observationId: o.id, kind: 'photo', blob, mimeType: 'image/jpeg' });
    expect(m.byteSize).toBe(4);
    expect(await repos.listMedia(o.id)).toHaveLength(1);
  });

  it('reads records after the DB is closed and reopened', async () => {
    const name = `fieldos-reopen-${crypto.randomUUID()}`;
    const first = new Repositories(new FieldOsDb(name));
    const s = await first.createSession({ title: 'Persisted' });
    await first.createObservation({
      sessionId: s.id,
      capturedLocation: goodFix(),
      observation: { category: 'visitor_pressure', value: 'LOW' },
      evidence: { method: 'OBSERVED' },
    });
    // Reopen a brand-new connection to the same database name.
    const second = new Repositories(new FieldOsDb(name));
    const reloaded = await second.getSession(s.id);
    expect(reloaded?.title).toBe('Persisted');
    expect(await second.listObservations(s.id)).toHaveLength(1);
  });

  it('soft-deletes a draft safely (recoverable, hidden from live list)', async () => {
    const { repos } = makeTestRepos();
    const s = await repos.createSession({ title: 'S' });
    const o = await repos.createObservation({
      sessionId: s.id,
      capturedLocation: goodFix(),
      observation: { category: 'litter', value: 'NONE' },
      evidence: { method: 'OBSERVED' },
    });
    await repos.softDeleteObservation(o.id);

    expect(await repos.listObservations(s.id)).toHaveLength(0);
    expect(await repos.listObservations(s.id, { includeDeleted: true })).toHaveLength(1);
    // Recoverable.
    await repos.restoreObservation(o.id);
    expect(await repos.listObservations(s.id)).toHaveLength(1);
  });

  it('surfaces a storage failure instead of pretending data was saved', async () => {
    const { repos, db } = makeTestRepos();
    const s = await repos.createSession({ title: 'S' });
    // Simulate a quota/IO failure on the underlying write.
    const spy = vi.spyOn(db.observations, 'add').mockRejectedValueOnce(new Error('QuotaExceededError'));

    await expect(
      repos.createObservation({
        sessionId: s.id,
        capturedLocation: goodFix(),
        observation: { category: 'litter', value: 'LOW' },
        evidence: { method: 'OBSERVED' },
      }),
    ).rejects.toBeInstanceOf(StoragePersistenceError);

    // Nothing was persisted — no silent success.
    expect(await repos.listObservations(s.id, { includeDeleted: true })).toHaveLength(0);
    spy.mockRestore();
  });
});
