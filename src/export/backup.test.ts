import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { makeTestRepos } from '../test/helpers';
import { seedFixture } from '../fixtures/testFixture';
import { buildSessionBackup } from './backup';

describe('full-session ZIP backup', () => {
  it('produces an archive with manifest + 3 data files + all media', async () => {
    const { repos } = makeTestRepos();
    const fixture = await seedFixture(repos);
    const backup = await buildSessionBackup(repos, fixture.sessionId);

    const files = unzipSync(backup.zipBytes);
    const names = Object.keys(files).sort();

    expect(names).toContain('manifest.json');
    expect(names).toContain('observations.json');
    expect(names).toContain('observations.csv');
    expect(names).toContain('observations.geojson');
    const mediaFiles = names.filter((n) => n.startsWith('media/'));
    expect(mediaFiles).toHaveLength(3);
    expect(mediaFiles.every((n) => n.endsWith('.jpg'))).toBe(true);
  });

  it('writes a manifest with correct counts and versions', async () => {
    const { repos } = makeTestRepos();
    const fixture = await seedFixture(repos);
    const backup = await buildSessionBackup(repos, fixture.sessionId);

    const files = unzipSync(backup.zipBytes);
    const manifest = JSON.parse(strFromU8(files['manifest.json']!));

    expect(manifest.sessionId).toBe(fixture.sessionId);
    expect(manifest.observationCount).toBe(10);
    expect(manifest.mediaCount).toBe(3);
    expect(manifest.fieldosSchemaVersion).toBe(3);
    expect(manifest.appVersion).toBe('0.1.0');
    expect(typeof manifest.exportedAt).toBe('string');
    // The in-memory manifest matches the archived one.
    expect(backup.manifest).toEqual(manifest);
  });

  it('preserves media bytes through the archive', async () => {
    const { repos } = makeTestRepos();
    const s = await repos.createSession({ title: 'S' });
    const o = await repos.createObservation({
      sessionId: s.id,
      capturedLocation: {
        latitude: 1, longitude: 2, accuracyMeters: 5, altitudeMeters: null,
        altitudeAccuracyMeters: null, headingDegrees: null, speedMetersPerSecond: null,
        locationStatus: 'CAPTURED', capturedAt: '2026-08-21T09:00:00.000+02:00',
      },
      observation: { category: 'other', value: null },
      evidence: { method: 'OBSERVED' },
    });
    const original = new Uint8Array([9, 8, 7, 6, 5]);
    await repos.addMedia({
      observationId: o.id,
      kind: 'photo',
      blob: new Blob([original], { type: 'image/png' }),
      mimeType: 'image/png',
    });

    const backup = await buildSessionBackup(repos, s.id);
    const files = unzipSync(backup.zipBytes);
    const pngName = Object.keys(files).find((n) => n.startsWith('media/') && n.endsWith('.png'));
    expect(pngName).toBeDefined();
    expect(Array.from(files[pngName!]!)).toEqual(Array.from(original));
  });

  it('preserves raw GNSS metadata in canonical JSON inside the ZIP', async () => {
    const { repos } = makeTestRepos();
    const fixture = await seedFixture(repos);
    const backup = await buildSessionBackup(repos, fixture.sessionId);
    const files = unzipSync(backup.zipBytes);
    const canonical = JSON.parse(strFromU8(files['observations.json']!));
    expect(canonical.observations[0].capturedLocation.altitudeAccuracyMeters).toBe(4.5);
    expect(canonical.observations[0].capturedLocation.headingDegrees).toBe(127);
    expect(canonical.observations[0].capturedLocation.speedMetersPerSecond).toBe(1.8);
  });

  it('preserves the append-only audit history in canonical JSON inside the ZIP', async () => {
    const { repos } = makeTestRepos();
    const fixture = await seedFixture(repos);
    const backup = await buildSessionBackup(repos, fixture.sessionId);

    // Manifest reports the audit-entry count (10 CREATED + 1 LOCATION_ADJUSTED = 11).
    expect(backup.manifest.auditEntryCount).toBe(11);

    const files = unzipSync(backup.zipBytes);
    const canonical = JSON.parse(strFromU8(files['observations.json']!));
    expect(canonical.auditEntries).toHaveLength(11);
    expect(canonical.auditEntries.some((e: { eventType: string }) => e.eventType === 'CREATED')).toBe(true);
    expect(canonical.auditEntries.some((e: { eventType: string }) => e.eventType === 'LOCATION_ADJUSTED')).toBe(true);
    // CSV / GeoJSON stay one-row-per-observation and are NOT expanded into audit rows.
    expect(strFromU8(files['observations.csv']!).split('\r\n')).toHaveLength(11); // header + 10
  });
});
