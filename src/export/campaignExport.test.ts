import { describe, expect, it } from 'vitest';
import { makeTestRepos } from '../test/helpers';
import { buildSessionBundle } from './bundle';
import { serializeSessionJson } from './json';
import { inspectSessionJson, preflightRestore, restoreInspection } from './restore';
import { TOURISM_CORE_PROTOCOL } from '../protocol/tourismCore';
import { SCHEMA_VERSION } from '../version';
import type { Asset, CapturedLocation, FieldCampaign } from '../domain/types';

const goodFix = (): CapturedLocation => ({
  latitude: 47.37, longitude: 8.54, accuracyMeters: 5, altitudeMeters: 667,
  altitudeAccuracyMeters: 4.5, headingDegrees: 127, speedMetersPerSecond: 1.8,
  locationStatus: 'CAPTURED', capturedAt: '2026-08-21T09:00:00.000+02:00',
});

const campaign: FieldCampaign = {
  id: crypto.randomUUID(), schemaVersion: SCHEMA_VERSION, title: 'Coast mission', description: 'synthetic',
  protocolSnapshot: TOURISM_CORE_PROTOCOL, createdAt: '2026-09-07T00:00:00.000Z', importedAt: '2026-09-07T00:00:00.000Z',
  source: { type: 'fieldpack', fieldpackId: 'pack-coast', fieldpackVersion: 3 },
};

function plannedAsset(): Asset {
  return {
    id: crypto.randomUUID(), schemaVersion: SCHEMA_VERSION, sessionId: null, campaignId: campaign.id,
    name: 'North Trailhead', assetType: 'trailhead', latitude: 47.37, longitude: 8.54, source: 'preloaded',
    sourceRef: 'trailhead-01', createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z',
  };
}

async function campaignSessionBundle() {
  const src = makeTestRepos();
  const asset = plannedAsset();
  await src.repos.installCampaign(campaign, [asset]);
  const session = await src.repos.createSession({ title: 'Field run', campaignId: campaign.id, protocol: campaign.protocolSnapshot });
  // An observation that references the CAMPAIGN-level asset (not a session asset).
  await src.repos.createObservation({
    sessionId: session.id, capturedLocation: goodFix(), assetId: asset.id,
    observation: { category: 'visitor_pressure', value: 'HIGH' }, evidence: { method: 'OBSERVED' },
  });
  const { bundle } = await buildSessionBundle(src.repos, session.id);
  return { src, session, asset, bundle };
}

describe('Campaign export context', () => {
  it('exports campaign context and includes the referenced campaign asset for self-containment', async () => {
    const { bundle, asset } = await campaignSessionBundle();
    expect(bundle.campaignContext).toEqual({
      campaignId: campaign.id, title: 'Coast mission', sourceFieldpackId: 'pack-coast', sourceFieldpackVersion: 3,
    });
    // The referenced campaign asset travels with the bundle so the observation's assetId resolves.
    expect(bundle.assets.map((a) => a.id)).toContain(asset.id);
  });

  it('a standalone session exports campaignContext null', async () => {
    const { repos } = makeTestRepos();
    const session = await repos.createSession({ title: 'Solo' });
    const { bundle } = await buildSessionBundle(repos, session.id);
    expect(bundle.campaignContext).toBeNull();
  });
});

describe('Campaign-bound session restore (§21)', () => {
  it('restores a campaign session WITHOUT the Campaign present and never fabricates one', async () => {
    const { session, asset, bundle } = await campaignSessionBundle();
    const target = makeTestRepos();

    const inspection = await preflightRestore(target.repos, inspectSessionJson(serializeSessionJson(bundle)));
    const result = await restoreInspection(target.repos, inspection);
    expect(result.outcome).toBe('RESTORED_WITHOUT_MEDIA');

    // No Campaign is fabricated from the session's campaignId or the exported context.
    expect(await target.repos.getCampaign(campaign.id)).toBeUndefined();
    expect(await target.db.campaigns.count()).toBe(0);

    // The session is restored self-contained: campaignId retained, protocol intact, asset resolvable.
    const restored = await target.repos.getSession(session.id);
    expect(restored?.campaignId).toBe(campaign.id);
    expect(restored?.protocolSnapshot).toEqual(TOURISM_CORE_PROTOCOL);
    const resolved = await target.repos.listSessionAssets(restored!);
    expect(resolved.map((a) => a.id)).toContain(asset.id);
    // The observation's campaign-asset reference remains valid.
    const observations = await target.repos.listObservations(session.id);
    expect(observations[0]!.assetId).toBe(asset.id);
  });
});
