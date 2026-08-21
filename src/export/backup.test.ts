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
    expect(manifest.fieldosSchemaVersion).toBe(1);
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
});
