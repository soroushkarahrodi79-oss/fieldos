import { describe, expect, it, vi } from 'vitest';
import { makeTestRepos } from '../test/helpers';
import { buildFieldPack } from './build';
import { inspectFieldPack, installFieldPackImport, preflightFieldPackImport } from './import';
import { FieldPackValidationError } from './manifest';
import { TOURISM_CORE_PROTOCOL } from '../protocol/tourismCore';
import type { FieldPackAssetSpec } from './types';

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
});
