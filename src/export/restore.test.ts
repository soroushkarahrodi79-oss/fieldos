import { describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { StoragePersistenceError } from '../db/repositories';
import { seedFixture } from '../fixtures/testFixture';
import { makeTestRepos } from '../test/helpers';
import { buildSessionBackup } from './backup';
import { inspectFullBackup, inspectSessionJson, preflightRestore, restoreInspection, RestoreValidationError } from './restore';

describe('restore and backup integrity', () => {
  async function completeInspection() {
    const source = makeTestRepos();
    const fixture = await seedFixture(source.repos);
    const backup = await buildSessionBackup(source.repos, fixture.sessionId);
    const target = makeTestRepos();
    return { source, fixture, backup, target, inspection: await preflightRestore(target.repos, await inspectFullBackup(backup.zipBytes)) };
  }

  it('adds SHA-256 hashes matching exact ZIP payload bytes', async () => {
    const { repos } = makeTestRepos();
    const fixture = await seedFixture(repos);
    const backup = await buildSessionBackup(repos, fixture.sessionId);
    const inspection = await inspectFullBackup(backup.zipBytes);
    expect(backup.manifest.integrity?.algorithm).toBe('SHA-256');
    expect(Object.keys(backup.manifest.integrity?.files ?? {})).toContain('observations.json');
    expect(inspection.integrityStatus).toBe('VERIFIED');
  });

  it('rejects changed structured and media payload bytes when hashes are present', async () => {
    const { backup } = await completeInspection();
    const structured = unzipSync(backup.zipBytes);
    structured['observations.json'] = new TextEncoder().encode(strFromU8(structured['observations.json']!).replace('SYNTHETIC', 'XYNTHE TIC'));
    await expect(inspectFullBackup(zipSync(structured))).rejects.toThrow('integrity');
    const media = unzipSync(backup.zipBytes);
    const name = Object.keys(media).find((item) => item.startsWith('media/'))!;
    const mediaBytes = media[name]!;
    mediaBytes[0] = (mediaBytes[0] ?? 0) ^ 0x01;
    await expect(inspectFullBackup(zipSync(media))).rejects.toThrow('integrity');
  });

  it('restores a full backup verbatim, including audit history and exact media bytes', async () => {
    const { source, fixture, target, inspection } = await completeInspection();
    const result = await restoreInspection(target.repos, inspection);
    expect(result.outcome).toBe('RESTORED_FULL');
    expect((await target.repos.getSession(fixture.sessionId))?.id).toBe(fixture.sessionId);
    const observations = await target.repos.listObservations(fixture.sessionId, { includeDeleted: true });
    expect(observations).toHaveLength(10);
    const original = await source.repos.getObservation(fixture.observationIds[6]!);
    const restored = observations.find((item) => item.id === fixture.observationIds[6]);
    expect(restored?.capturedAt).toBe(original?.capturedAt);
    expect(restored?.capturedLocation).toEqual(original?.capturedLocation);
    expect(restored?.locationAdjustment).toEqual(original?.locationAdjustment);
    expect(restored?.editCount).toBe(original?.editCount);
    expect(restored?.deleted).toBe(original?.deleted);
    expect((await target.repos.listObservationAuditEntries(fixture.observationIds[6]!)).map((entry) => entry.sequence)).toEqual([1, 2]);
    const media = await target.repos.listMedia(fixture.observationIds[0]!);
    expect(Array.from(new Uint8Array(await media[0]!.blob.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff, 0x01, 0x00, 0x10]);
  });

  it('rejects collisions without changing existing local data', async () => {
    const { target, inspection, fixture } = await completeInspection();
    await target.repos.createSession({ title: 'unrelated' });
    await target.db.fieldSessions.add({ ...inspection.bundle.session, title: 'existing collision' });
    const preflight = await preflightRestore(target.repos, inspection);
    expect(preflight.collisions).toContain(fixture.sessionId);
    await expect(restoreInspection(target.repos, preflight)).rejects.toThrow('Restore blocked');
    expect((await target.repos.getSession(fixture.sessionId))?.title).toBe('existing collision');
    expect(await target.db.observations.count()).toBe(0);
  });

  it('rolls back all restore stores when persistence fails', async () => {
    const { target, inspection, fixture } = await completeInspection();
    vi.spyOn(target.db.media, 'bulkAdd').mockRejectedValueOnce(new Error('simulated quota failure'));
    await expect(restoreInspection(target.repos, inspection)).rejects.toBeInstanceOf(StoragePersistenceError);
    expect(await target.repos.getSession(fixture.sessionId)).toBeUndefined();
    expect(await target.db.assets.count()).toBe(0);
    expect(await target.db.observations.count()).toBe(0);
    expect(await target.db.observationAudit.count()).toBe(0);
    expect(await target.db.media.count()).toBe(0);
  });

  it('marks older backups without hashes as legacy-unverified and supports data-only restore without media', async () => {
    const { backup, target } = await completeInspection();
    const files = unzipSync(backup.zipBytes);
    const legacyManifest = JSON.parse(strFromU8(files['manifest.json']!));
    delete legacyManifest.integrity;
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(legacyManifest));
    expect((await inspectFullBackup(zipSync(files))).integrityStatus).toBe('LEGACY_UNVERIFIED');
    const json = strFromU8(unzipSync(backup.zipBytes)['observations.json']!);
    const dataOnly = await preflightRestore(target.repos, inspectSessionJson(json));
    expect(dataOnly.warnings[0]).toContain('media attachments are unavailable');
    const result = await restoreInspection(target.repos, dataOnly);
    expect(result.outcome).toBe('RESTORED_WITHOUT_MEDIA');
    expect(await target.db.media.count()).toBe(0);
  });

  it('blocks missing canonical JSON and newer schemas before any writes', async () => {
    const { backup } = await completeInspection();
    const missing = unzipSync(backup.zipBytes); delete missing['observations.json'];
    await expect(inspectFullBackup(zipSync(missing))).rejects.toBeInstanceOf(RestoreValidationError);
    const json = JSON.parse(strFromU8(unzipSync(backup.zipBytes)['observations.json']!));
    json.fieldosSchemaVersion = 999;
    expect(() => inspectSessionJson(JSON.stringify(json))).toThrow('newer FieldOS schema');
  });

  it('rejects malformed bundles, invalid references, duplicate audit sequences, count mismatches, and missing media', async () => {
    const { backup } = await completeInspection();
    expect(() => inspectSessionJson('{')).toThrow(RestoreValidationError);
    const canonical = JSON.parse(strFromU8(unzipSync(backup.zipBytes)['observations.json']!));
    canonical.observations[0].assetId = 'missing-asset';
    expect(() => inspectSessionJson(JSON.stringify(canonical))).toThrow('unavailable asset');
    const withDuplicate = JSON.parse(strFromU8(unzipSync(backup.zipBytes)['observations.json']!));
    const adjusted = withDuplicate.auditEntries.find((entry: { eventType: string }) => entry.eventType === 'LOCATION_ADJUSTED');
    adjusted.sequence = 1;
    expect(() => inspectSessionJson(JSON.stringify(withDuplicate))).toThrow('duplicates an observation audit sequence');
    const countMismatch = unzipSync(backup.zipBytes);
    const manifest = JSON.parse(strFromU8(countMismatch['manifest.json']!)); delete manifest.integrity; manifest.mediaCount = 999;
    countMismatch['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
    await expect(inspectFullBackup(zipSync(countMismatch))).rejects.toThrow('counts or schema');
    const missingMedia = unzipSync(backup.zipBytes);
    delete missingMedia[Object.keys(missingMedia).find((name) => name.startsWith('media/'))!];
    await expect(inspectFullBackup(zipSync(missingMedia))).rejects.toThrow();
  });
});
