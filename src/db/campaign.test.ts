import Dexie from 'dexie';
import { describe, expect, it, vi } from 'vitest';
import { FieldOsDb } from './db';
import {
  CampaignFieldpackCollisionError,
  CampaignNotFoundError,
  CampaignProtocolMismatchError,
  Repositories,
  RestoreCollisionError,
} from './repositories';
import { makeTestRepos } from '../test/helpers';
import { TOURISM_CORE_PROTOCOL } from '../protocol/tourismCore';
import { TEST_HEAT_PROTOCOL } from '../fixtures/testProtocol';
import { ProtocolValidationError } from '../protocol/validation';
import { SCHEMA_VERSION } from '../version';
import type { Asset, CapturedLocation, FieldCampaign } from '../domain/types';

const goodFix = (): CapturedLocation => ({
  latitude: 47.37, longitude: 8.54, accuracyMeters: 5, altitudeMeters: 667,
  altitudeAccuracyMeters: 4.5, headingDegrees: 127, speedMetersPerSecond: 1.8,
  locationStatus: 'CAPTURED', capturedAt: '2026-08-21T09:00:00.000+02:00',
});

function campaignAsset(campaignId: string, sourceRef: string, name: string): Asset {
  return {
    id: crypto.randomUUID(), schemaVersion: SCHEMA_VERSION, sessionId: null, campaignId,
    name, assetType: 'trailhead', latitude: 47.37, longitude: 8.54, source: 'preloaded',
    sourceRef, createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z',
  };
}

function fieldpackCampaign(overrides: Partial<FieldCampaign> = {}): FieldCampaign {
  return {
    id: crypto.randomUUID(), schemaVersion: SCHEMA_VERSION, title: 'Coast mission', description: null,
    protocolSnapshot: TOURISM_CORE_PROTOCOL, createdAt: '2026-09-07T00:00:00.000Z',
    importedAt: '2026-09-07T00:00:00.000Z',
    source: { type: 'fieldpack', fieldpackId: 'pack-coast', fieldpackVersion: 1 },
    ...overrides,
  };
}

describe('Campaign domain', () => {
  it('creates a local campaign bound to the default protocol snapshot (a copy)', async () => {
    const { repos } = makeTestRepos();
    const campaign = await repos.createCampaign({ title: 'Local mission' });
    expect(campaign.source).toEqual({ type: 'local_created' });
    expect(campaign.importedAt).toBeNull();
    expect(campaign.protocolSnapshot).toEqual(TOURISM_CORE_PROTOCOL);
    expect(campaign.protocolSnapshot).not.toBe(TOURISM_CORE_PROTOCOL); // deep copy
    expect((await repos.getCampaign(campaign.id))?.title).toBe('Local mission');
  });

  it('binds an alternate protocol to a local campaign and refuses a malformed one', async () => {
    const { repos } = makeTestRepos();
    const campaign = await repos.createCampaign({ title: 'Heat', protocol: TEST_HEAT_PROTOCOL });
    expect(campaign.protocolSnapshot.protocolId).toBe('fieldos-test-heat');
    await expect(
      repos.createCampaign({ title: 'Bad', protocol: { ...TEST_HEAT_PROTOCOL, categories: [] } }),
    ).rejects.toBeInstanceOf(ProtocolValidationError);
  });

  it('installs a campaign and its assets atomically', async () => {
    const { repos } = makeTestRepos();
    const campaign = fieldpackCampaign();
    const assets = [campaignAsset(campaign.id, 'trailhead-01', 'North'), campaignAsset(campaign.id, 'trailhead-02', 'South')];
    await repos.installCampaign(campaign, assets);
    expect((await repos.getCampaign(campaign.id))?.title).toBe('Coast mission');
    expect(await repos.listCampaignAssets(campaign.id)).toHaveLength(2);
  });

  it('rolls back the whole install if asset writes fail (no partial campaign)', async () => {
    const { repos, db } = makeTestRepos();
    const campaign = fieldpackCampaign();
    const assets = [campaignAsset(campaign.id, 'a', 'A')];
    vi.spyOn(db.assets, 'bulkAdd').mockRejectedValueOnce(new Error('simulated quota failure'));
    await expect(repos.installCampaign(campaign, assets)).rejects.toBeTruthy();
    // Neither the campaign nor its assets are left behind.
    expect(await repos.getCampaign(campaign.id)).toBeUndefined();
    expect(await db.campaigns.count()).toBe(0);
    expect(await db.assets.count()).toBe(0);
  });

  it('rejects an install that collides with an existing id', async () => {
    const { repos } = makeTestRepos();
    const campaign = fieldpackCampaign();
    await repos.installCampaign(campaign, []);
    await expect(repos.installCampaign(campaign, [])).rejects.toBeInstanceOf(RestoreCollisionError);
  });

  it('transactionally rejects a second install of the same fieldpackId + version (distinct ids)', async () => {
    const { repos, db } = makeTestRepos();
    await repos.installCampaign(fieldpackCampaign(), []);
    // A brand-new campaign object (fresh UUID) from the SAME fieldpackId + version must still be
    // blocked as a duplicate by the transactional guard — not by the id-collision check.
    await expect(repos.installCampaign(fieldpackCampaign(), [])).rejects.toBeInstanceOf(
      CampaignFieldpackCollisionError,
    );
    expect(await db.campaigns.count()).toBe(1);
  });

  it('transactionally rejects a same-id different-version install as an unsupported upgrade', async () => {
    const { repos, db } = makeTestRepos();
    await repos.installCampaign(fieldpackCampaign(), []);
    const upgrade = fieldpackCampaign({
      source: { type: 'fieldpack', fieldpackId: 'pack-coast', fieldpackVersion: 2 },
    });
    await expect(repos.installCampaign(upgrade, [])).rejects.toMatchObject({
      name: 'CampaignFieldpackCollisionError',
      kind: 'unsupported_upgrade',
    });
    expect(await db.campaigns.count()).toBe(1);
  });

  it('finds campaigns by fieldpack id for the collision policy', async () => {
    const { repos } = makeTestRepos();
    await repos.installCampaign(fieldpackCampaign(), []);
    await repos.createCampaign({ title: 'Unrelated local' });
    const found = await repos.findCampaignsByFieldpackId('pack-coast');
    expect(found).toHaveLength(1);
    expect(await repos.findCampaignsByFieldpackId('pack-absent')).toHaveLength(0);
  });
});

describe('Session ↔ Campaign binding', () => {
  it('binds a session to a campaign and inherits its protocol; standalone stays null', async () => {
    const { repos } = makeTestRepos();
    const campaign = await repos.createCampaign({ title: 'Heat mission', protocol: TEST_HEAT_PROTOCOL });
    const bound = await repos.createSession({ title: 'Run 1', campaignId: campaign.id, protocol: campaign.protocolSnapshot });
    expect(bound.campaignId).toBe(campaign.id);
    expect(bound.protocolSnapshot?.protocolId).toBe('fieldos-test-heat');

    const standalone = await repos.createSession({ title: 'Solo' });
    expect(standalone.campaignId).toBeNull();
    expect((await repos.listCampaignSessions(campaign.id)).map((s) => s.id)).toEqual([bound.id]);
  });

  it('createCampaignSession always snapshots the campaign protocol (matching protocol accepted)', async () => {
    const { repos } = makeTestRepos();
    const campaign = await repos.createCampaign({ title: 'Heat mission', protocol: TEST_HEAT_PROTOCOL });
    // No protocol supplied → inherits the campaign's snapshot.
    const inherited = await repos.createCampaignSession(campaign.id, { title: 'Run A' });
    expect(inherited.campaignId).toBe(campaign.id);
    expect(inherited.protocolSnapshot).toEqual(campaign.protocolSnapshot);
    // Explicitly passing the campaign's own protocol is accepted (it matches).
    const matched = await repos.createCampaignSession(campaign.id, { title: 'Run B', protocol: campaign.protocolSnapshot });
    expect(matched.protocolSnapshot?.protocolId).toBe('fieldos-test-heat');
  });

  it('refuses to persist a campaign-bound session carrying a DIFFERENT protocol (invariant)', async () => {
    const { repos, db } = makeTestRepos();
    // Campaign is bound to Tourism Core; caller tries to bind an unrelated protocol to its session.
    const campaign = await repos.createCampaign({ title: 'Coast', protocol: TOURISM_CORE_PROTOCOL });

    await expect(
      repos.createCampaignSession(campaign.id, { title: 'Bad', protocol: TEST_HEAT_PROTOCOL }),
    ).rejects.toBeInstanceOf(CampaignProtocolMismatchError);
    // The public createSession path routes campaignId through the same guard — same rejection.
    await expect(
      repos.createSession({ title: 'Bad', campaignId: campaign.id, protocol: TEST_HEAT_PROTOCOL }),
    ).rejects.toBeInstanceOf(CampaignProtocolMismatchError);

    // Nothing was persisted: the campaign has no sessions and no session row leaked in.
    expect(await repos.listCampaignSessions(campaign.id)).toHaveLength(0);
    expect(await db.fieldSessions.count()).toBe(0);
  });

  it('rejects binding a session to a campaign that does not exist', async () => {
    const { repos, db } = makeTestRepos();
    await expect(
      repos.createCampaignSession(crypto.randomUUID(), { title: 'Orphan' }),
    ).rejects.toBeInstanceOf(CampaignNotFoundError);
    expect(await db.fieldSessions.count()).toBe(0);
  });

  it('legacy sessions and assets normalize campaign fields to null without rewriting rows', async () => {
    const { repos, db } = makeTestRepos();
    const created = await repos.createSession({ title: 'Legacy' });
    const legacy = { ...created };
    delete (legacy as Record<string, unknown>).campaignId;
    await db.fieldSessions.put(legacy as never);
    expect((await repos.getSession(created.id))?.campaignId).toBeNull();
    const stored = await db.fieldSessions.get(created.id);
    expect(stored).not.toHaveProperty('campaignId');
  });
});

describe('Campaign asset visibility (§18)', () => {
  it('resolves campaign assets + session assets without duplication', async () => {
    const { repos } = makeTestRepos();
    const campaign = fieldpackCampaign();
    const planned = [campaignAsset(campaign.id, 'p1', 'Planned 1'), campaignAsset(campaign.id, 'p2', 'Planned 2')];
    await repos.installCampaign(campaign, planned);
    const session = await repos.createSession({ title: 'Run', campaignId: campaign.id, protocol: campaign.protocolSnapshot });
    await repos.createAsset({ sessionId: session.id, name: 'Dropped here', latitude: 1, longitude: 2 });

    const resolved = await repos.listSessionAssets(session);
    expect(resolved).toHaveLength(3);
    // Each asset appears exactly once.
    expect(new Set(resolved.map((a) => a.id)).size).toBe(3);
    // Planned assets are NOT duplicated into the session (they keep sessionId null).
    expect(await repos.listAssets(session.id)).toHaveLength(1);
    expect(resolved.filter((a) => a.source === 'preloaded')).toHaveLength(2);
  });

  it('a standalone session resolves only its own assets', async () => {
    const { repos } = makeTestRepos();
    const session = await repos.createSession({ title: 'Solo' });
    await repos.createAsset({ sessionId: session.id, name: 'Own', latitude: 1, longitude: 2 });
    expect(await repos.listSessionAssets(session)).toHaveLength(1);
  });

  it('an observation may reference a campaign asset', async () => {
    const { repos } = makeTestRepos();
    const campaign = fieldpackCampaign();
    const planned = campaignAsset(campaign.id, 'p1', 'Planned');
    await repos.installCampaign(campaign, [planned]);
    const session = await repos.createSession({ title: 'Run', campaignId: campaign.id, protocol: campaign.protocolSnapshot });
    const obs = await repos.createObservation({
      sessionId: session.id, capturedLocation: goodFix(), assetId: planned.id,
      observation: { category: 'visitor_pressure', value: 'HIGH' }, evidence: { method: 'OBSERVED' },
    });
    expect(obs.assetId).toBe(planned.id);
  });
});

describe('Campaign DB migration (v2 → v3)', () => {
  it('adds the campaigns store and campaignId indexes while preserving prior data', async () => {
    const name = `fieldos-campaign-migrate-${crypto.randomUUID()}`;
    // Build a database at Dexie VERSION 2 (P1-5 era: audit store, no campaigns store).
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      fieldSessions: 'id, status, createdAt', assets: 'id, sessionId, source',
      observations: 'id, sessionId, createdAt, capturedAt', media: 'id, observationId',
    });
    legacy.version(2).stores({
      fieldSessions: 'id, status, createdAt', assets: 'id, sessionId, source',
      observations: 'id, sessionId, createdAt, capturedAt', media: 'id, observationId',
      observationAudit: 'id, observationId, sessionId, &[observationId+sequence], occurredAt',
    });
    await legacy.open();
    const sessionId = crypto.randomUUID();
    await legacy.table('fieldSessions').add({ id: sessionId, title: 'v2 session', status: 'active' });
    await legacy.table('assets').add({ id: crypto.randomUUID(), sessionId, name: 'v2 asset', source: 'field_created' });
    legacy.close();

    const upgraded = new FieldOsDb(name);
    await upgraded.open();
    expect(upgraded.verno).toBe(3);
    // Prior rows survive; the new store is present and empty (no fabricated campaign relation).
    expect(await upgraded.fieldSessions.count()).toBe(1);
    expect(await upgraded.assets.count()).toBe(1);
    expect(await upgraded.campaigns.count()).toBe(0);
    // The new campaignId index is queryable.
    expect(await upgraded.fieldSessions.where('campaignId').equals('anything').toArray()).toEqual([]);
    upgraded.close();

    // A repository over the reopened DB reads the legacy rows with campaign fields normalized to null.
    const repos = new Repositories(new FieldOsDb(name));
    expect((await repos.getSession(sessionId))?.campaignId).toBeNull();
  });
});
