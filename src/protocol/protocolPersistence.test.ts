import { describe, expect, it } from 'vitest';
import { makeTestRepos } from '../test/helpers';
import { buildSessionBundle } from '../export/bundle';
import { parseSessionJson, serializeSessionJson } from '../export/json';
import { serializeObservationsCsv } from '../export/csv';
import { serializeObservationsGeoJson } from '../export/geojson';
import { buildSessionBackup } from '../export/backup';
import {
  RestoreValidationError,
  inspectFullBackup,
  inspectSessionJson,
  preflightRestore,
  restoreInspection,
} from '../export/restore';
import { TEST_HEAT_PROTOCOL } from '../fixtures/testProtocol';
import type { CapturedLocation, Uuid } from '../domain/types';
import type { Repositories } from '../db/repositories';

const goodFix = (): CapturedLocation => ({
  latitude: 47.37, longitude: 8.54, accuracyMeters: 5, altitudeMeters: 667,
  altitudeAccuracyMeters: 4.5, headingDegrees: 127, speedMetersPerSecond: 1.8,
  locationStatus: 'CAPTURED', capturedAt: '2026-08-21T09:00:00.000+02:00',
});

async function seedHeatSession(repos: Repositories): Promise<Uuid> {
  const session = await repos.createSession({ title: 'Heat run', protocol: TEST_HEAT_PROTOCOL });
  await repos.createObservation({
    sessionId: session.id, capturedLocation: goodFix(),
    observation: { category: 'heat_exposure', value: 'EXPOSED' }, evidence: { method: 'OBSERVED' },
  });
  await repos.createObservation({
    sessionId: session.id, capturedLocation: goodFix(),
    observation: { category: 'heat_incident', value: null }, evidence: { method: 'OBSERVED' }, note: 'shade collapse',
  });
  return session.id;
}

describe('canonical JSON carries the protocol snapshot', () => {
  it('round-trips the snapshot exactly', async () => {
    const { repos } = makeTestRepos();
    const sessionId = await seedHeatSession(repos);
    const { bundle } = await buildSessionBundle(repos, sessionId);

    expect(bundle.session.protocolSnapshot).toEqual(TEST_HEAT_PROTOCOL);
    const parsed = parseSessionJson(serializeSessionJson(bundle));
    expect(parsed.session.protocolSnapshot).toEqual(TEST_HEAT_PROTOCOL);
  });

  it('normalizes a legacy canonical export with no snapshot to null', async () => {
    const { repos } = makeTestRepos();
    const sessionId = await seedHeatSession(repos);
    const { bundle } = await buildSessionBundle(repos, sessionId);
    const legacy = JSON.parse(serializeSessionJson(bundle));
    delete legacy.session.protocolSnapshot; // pre-Protocol-Engine export
    const parsed = parseSessionJson(JSON.stringify(legacy));
    expect(parsed.session.protocolSnapshot).toBeNull();
  });
});

describe('CSV / GeoJSON additive protocol metadata', () => {
  it('adds protocol id/version columns and properties (not the whole definition)', async () => {
    const { repos } = makeTestRepos();
    const sessionId = await seedHeatSession(repos);
    const { bundle } = await buildSessionBundle(repos, sessionId);

    const csv = serializeObservationsCsv(bundle);
    const header = csv.split('\r\n')[0]!.split(',');
    expect(header).toContain('protocolId');
    expect(header).toContain('protocolVersion');
    const idColumn = header.indexOf('protocolId');
    expect(csv.split('\r\n')[1]!.split(',')[idColumn]).toBe('fieldos-test-heat');
    // The full definition (e.g. category labels) is NOT flattened into rows.
    expect(csv).not.toContain('Fully exposed');

    const gj = JSON.parse(serializeObservationsGeoJson(bundle));
    expect(gj.features[0].properties.protocolId).toBe('fieldos-test-heat');
    expect(gj.features[0].properties.protocolVersion).toBe(1);
  });
});

describe('full backup + restore preserve protocol semantics', () => {
  it('restores the alternate protocol snapshot exactly into a fresh database', async () => {
    const { repos: source } = makeTestRepos();
    const sessionId = await seedHeatSession(source);
    const backup = await buildSessionBackup(source, sessionId);

    const { repos: target } = makeTestRepos();
    const inspection = await preflightRestore(target, await inspectFullBackup(backup.zipBytes));
    expect(inspection.integrityStatus).toBe('VERIFIED');
    expect(inspection.bundle.session.protocolSnapshot).toEqual(TEST_HEAT_PROTOCOL);

    const result = await restoreInspection(target, inspection);
    const restored = await target.getSession(result.sessionId);
    expect(restored?.protocolSnapshot).toEqual(TEST_HEAT_PROTOCOL);
    // The alternate vocabulary survives — its categories/values are intact.
    expect(restored?.protocolSnapshot?.categories.map((c) => c.id)).toEqual(['heat_exposure', 'water_access', 'heat_incident']);
  });

  it('BLOCKS restore when the backup carries a malformed protocol snapshot (never discards it)', async () => {
    const { repos } = makeTestRepos();
    const sessionId = await seedHeatSession(repos);
    const { bundle } = await buildSessionBundle(repos, sessionId);
    const corrupt = JSON.parse(serializeSessionJson(bundle));
    corrupt.session.protocolSnapshot.categories = []; // structurally invalid protocol

    expect(() => inspectSessionJson(JSON.stringify(corrupt))).toThrow(RestoreValidationError);
    expect(() => inspectSessionJson(JSON.stringify(corrupt))).toThrow(/protocol snapshot is invalid/);
  });

  it('keeps a legacy backup (no snapshot) restorable, normalizing to null', async () => {
    const { repos } = makeTestRepos();
    const sessionId = await seedHeatSession(repos);
    const { bundle } = await buildSessionBundle(repos, sessionId);
    const legacy = JSON.parse(serializeSessionJson(bundle));
    delete legacy.session.protocolSnapshot;
    legacy.session.id = crypto.randomUUID(); // avoid collision with the source session
    // Re-point child records at the new session id so the bundle stays internally consistent.
    for (const o of legacy.observations) o.sessionId = legacy.session.id;
    for (const a of legacy.auditEntries) a.sessionId = legacy.session.id;

    const inspection = inspectSessionJson(JSON.stringify(legacy));
    expect(inspection.bundle.session.protocolSnapshot).toBeNull();

    const { repos: target } = makeTestRepos();
    const result = await restoreInspection(target, await preflightRestore(target, inspection));
    expect((await target.getSession(result.sessionId))?.protocolSnapshot).toBeNull();
  });
});
