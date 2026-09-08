import { Zip, ZipPassThrough, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { makeTestRepos } from '../test/helpers';
import { buildFieldPack } from './build';
import { inspectFieldPack, installFieldPackImport, preflightFieldPackImport } from './import';
import { FieldPackValidationError } from './manifest';
import { TOURISM_CORE_PROTOCOL } from '../protocol/tourismCore';
import type { FieldPackAssetSpec } from './types';

/**
 * Build a raw ZIP from explicit (name, bytes) pairs, ALLOWING duplicate names — something the normal
 * object-keyed `zipSync` cannot express. Used to prove the importer rejects ambiguous archives.
 * `ZipPassThrough` (no compression) emits synchronously, so chunks are complete after `end()`.
 */
function zipWithEntries(entries: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((err, data) => { if (err) throw err; chunks.push(data); });
  for (const [name, bytes] of entries) {
    const file = new ZipPassThrough(name);
    zip.add(file);
    file.push(bytes, true);
  }
  zip.end();
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

const ASSETS: FieldPackAssetSpec[] = [
  { sourceRef: 'trailhead-01', name: 'North Trailhead', assetType: 'trailhead', latitude: 40.8, longitude: -3.9 },
  { sourceRef: 'viewpoint-01', name: 'Ridge Viewpoint', assetType: 'viewpoint', latitude: 40.82, longitude: -3.92 },
];

function pack(overrides: Partial<Parameters<typeof buildFieldPack>[0]> = {}) {
  return buildFieldPack({
    fieldpackId: 'pack-import', fieldpackVersion: 1, title: 'Import mission', description: 'A synthetic mission.',
    protocol: TOURISM_CORE_PROTOCOL, assets: ASSETS, ...overrides,
  });
}

describe('FieldPack import flow', () => {
  it('previews without any local writes, then installs a campaign + assets atomically', async () => {
    const { repos, db } = makeTestRepos();
    const { bytes } = await pack();

    const inspection = await preflightFieldPackImport(repos, await inspectFieldPack(bytes));
    expect(inspection.collision).toEqual({ kind: 'none' });
    // Preview caused zero writes.
    expect(await db.campaigns.count()).toBe(0);
    expect(await db.assets.count()).toBe(0);

    const result = await installFieldPackImport(repos, inspection);
    expect(result.assetCount).toBe(2);
    const campaign = await repos.getCampaign(result.campaignId);
    expect(campaign?.source).toEqual({ type: 'fieldpack', fieldpackId: 'pack-import', fieldpackVersion: 1 });
    expect(campaign?.importedAt).not.toBeNull();
    const assets = await repos.listCampaignAssets(result.campaignId);
    expect(assets).toHaveLength(2);
    // External source refs preserved; local UUIDs are distinct from them.
    expect(assets.map((a) => a.sourceRef).sort()).toEqual(['trailhead-01', 'viewpoint-01']);
    expect(assets.every((a) => a.id !== a.sourceRef && a.source === 'preloaded' && a.sessionId === null)).toBe(true);
  });

  it('blocks a duplicate (same id + version) import — no reinstall', async () => {
    const { repos, db } = makeTestRepos();
    const { bytes } = await pack();
    await installFieldPackImport(repos, await preflightFieldPackImport(repos, await inspectFieldPack(bytes)));

    const second = await preflightFieldPackImport(repos, await inspectFieldPack(bytes));
    expect(second.collision.kind).toBe('duplicate');
    await expect(installFieldPackImport(repos, second)).rejects.toBeInstanceOf(FieldPackValidationError);
    // Still exactly one campaign and its two assets — nothing reinstalled or duplicated.
    expect(await db.campaigns.count()).toBe(1);
    expect(await db.assets.count()).toBe(2);
  });

  it('blocks a same-id newer version as an unsupported upgrade', async () => {
    const { repos, db } = makeTestRepos();
    await installFieldPackImport(repos, await preflightFieldPackImport(repos, await inspectFieldPack((await pack()).bytes)));

    const upgrade = await preflightFieldPackImport(repos, await inspectFieldPack((await pack({ fieldpackVersion: 2 })).bytes));
    expect(upgrade.collision.kind).toBe('unsupported_upgrade');
    await expect(installFieldPackImport(repos, upgrade)).rejects.toThrow('Automatic upgrades are not supported');
    expect(await db.campaigns.count()).toBe(1);
  });

  it('rolls back completely if a write fails mid-install (no partial import)', async () => {
    const { repos, db } = makeTestRepos();
    const inspection = await preflightFieldPackImport(repos, await inspectFieldPack((await pack()).bytes));
    vi.spyOn(db.assets, 'bulkAdd').mockRejectedValueOnce(new Error('simulated quota failure'));
    await expect(installFieldPackImport(repos, inspection)).rejects.toBeTruthy();
    expect(await db.campaigns.count()).toBe(0);
    expect(await db.assets.count()).toBe(0);
  });

  it('imports a different fieldpack id alongside an existing one', async () => {
    const { repos, db } = makeTestRepos();
    await installFieldPackImport(repos, await preflightFieldPackImport(repos, await inspectFieldPack((await pack()).bytes)));
    const other = await pack({ fieldpackId: 'pack-other', title: 'Other mission' });
    const inspection = await preflightFieldPackImport(repos, await inspectFieldPack(other.bytes));
    expect(inspection.collision).toEqual({ kind: 'none' });
    await installFieldPackImport(repos, inspection);
    expect(await db.campaigns.count()).toBe(2);
  });

  // --- Hardening: the collision invariant is enforced transactionally, not just at preview time ---

  it('rejects reusing the SAME previously-clean inspection twice (stale preflight)', async () => {
    const { repos, db } = makeTestRepos();
    // One inspection, preflighted while nothing was installed → collision `none`.
    const inspection = await preflightFieldPackImport(repos, await inspectFieldPack((await pack()).bytes));
    expect(inspection.collision).toEqual({ kind: 'none' });

    await installFieldPackImport(repos, inspection);
    // Reusing that exact clean inspection must NOT create a second campaign — the transactional
    // re-check inside the atomic install catches the duplicate even though `collision` still says none.
    await expect(installFieldPackImport(repos, inspection)).rejects.toBeInstanceOf(FieldPackValidationError);
    await expect(installFieldPackImport(repos, inspection)).rejects.toThrow(/already installed/i);
    expect(await db.campaigns.count()).toBe(1);
    expect(await db.assets.count()).toBe(2);
  });

  it('rejects the second of two independently-clean confirmations of the same pack (sequential race)', async () => {
    const { repos, db } = makeTestRepos();
    // BOTH inspections are taken/preflighted before EITHER is installed, so both read collision none.
    const first = await preflightFieldPackImport(repos, await inspectFieldPack((await pack()).bytes));
    const second = await preflightFieldPackImport(repos, await inspectFieldPack((await pack()).bytes));
    expect(first.collision.kind).toBe('none');
    expect(second.collision.kind).toBe('none');

    await installFieldPackImport(repos, first);
    await expect(installFieldPackImport(repos, second)).rejects.toBeInstanceOf(FieldPackValidationError);
    expect(await db.campaigns.count()).toBe(1);
    expect(await db.assets.count()).toBe(2);
  });

  it('rejects a stale-clean DIFFERENT-version inspection as an unsupported upgrade at install time', async () => {
    const { repos, db } = makeTestRepos();
    // Inspect v2 while nothing is installed (collision none), THEN install v1, THEN try the stale v2.
    const staleV2 = await preflightFieldPackImport(repos, await inspectFieldPack((await pack({ fieldpackVersion: 2 })).bytes));
    expect(staleV2.collision.kind).toBe('none');
    await installFieldPackImport(repos, await preflightFieldPackImport(repos, await inspectFieldPack((await pack()).bytes)));

    await expect(installFieldPackImport(repos, staleV2)).rejects.toThrow(/Automatic upgrades are not supported/i);
    expect(await db.campaigns.count()).toBe(1);
    // The only installed campaign is still v1 — nothing upgraded or duplicated.
    const [campaign] = await repos.listCampaigns();
    expect(campaign?.source).toEqual({ type: 'fieldpack', fieldpackId: 'pack-import', fieldpackVersion: 1 });
  });

  // --- Hardening: ambiguous archives (duplicate expected paths) are rejected outright ---

  it('rejects a FieldPack with a duplicate protocol.json entry', async () => {
    const files = unzipSync((await pack()).bytes);
    const ambiguous = zipWithEntries([
      ['manifest.json', files['manifest.json']!],
      ['protocol.json', files['protocol.json']!],
      ['protocol.json', files['protocol.json']!], // duplicate expected path
      ['assets.geojson', files['assets.geojson']!],
    ]);
    await expect(inspectFieldPack(ambiguous)).rejects.toBeInstanceOf(FieldPackValidationError);
    await expect(inspectFieldPack(ambiguous)).rejects.toThrow(/duplicate archive entries.*protocol\.json/i);
  });

  it('rejects a FieldPack with a duplicate assets.geojson entry', async () => {
    const files = unzipSync((await pack()).bytes);
    const ambiguous = zipWithEntries([
      ['manifest.json', files['manifest.json']!],
      ['protocol.json', files['protocol.json']!],
      ['assets.geojson', files['assets.geojson']!],
      ['assets.geojson', files['assets.geojson']!], // duplicate expected path
    ]);
    await expect(inspectFieldPack(ambiguous)).rejects.toThrow(/duplicate archive entries.*assets\.geojson/i);
  });

  it('still accepts a well-formed single-entry archive (no false positive from the duplicate check)', async () => {
    // Repacking the same three payloads with the streaming builder must inspect cleanly.
    const files = unzipSync((await pack()).bytes);
    const rebuilt = zipWithEntries([
      ['manifest.json', files['manifest.json']!],
      ['protocol.json', files['protocol.json']!],
      ['assets.geojson', files['assets.geojson']!],
    ]);
    const inspection = await inspectFieldPack(rebuilt);
    expect(inspection.integrityStatus).toBe('VERIFIED');
    expect(inspection.assets).toHaveLength(2);
  });
});
