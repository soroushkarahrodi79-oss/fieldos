import { describe, expect, it } from 'vitest';
import type { Asset, FieldSession, Observation } from '../domain/types';
import { summarizeCampaignExecution } from './execution';

const captured = {
  latitude: 40.4,
  longitude: -3.7,
  accuracyMeters: 8,
  altitudeMeters: null,
  altitudeAccuracyMeters: null,
  headingDegrees: null,
  speedMetersPerSecond: null,
  locationStatus: 'CAPTURED' as const,
  capturedAt: '2026-10-01T10:00:00.000Z',
};

function session(id: string, campaignId = 'campaign-1'): FieldSession {
  return {
    id, schemaVersion: 5, title: id, purpose: null, observerName: null, status: 'active',
    createdAt: '2026-10-01T09:00:00.000Z', closedAt: null, updatedAt: '2026-10-01T09:00:00.000Z',
    deviceLabel: null, protocolSnapshot: null, campaignId,
  };
}

function asset(id: string): Asset {
  return {
    id, schemaVersion: 5, sessionId: null, campaignId: 'campaign-1', name: id, assetType: 'viewpoint',
    latitude: 40.4, longitude: -3.7, source: 'preloaded', sourceRef: id,
    createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z',
  };
}

function observation(id: string, sessionId: string, assetId: string | null, patch: Partial<Observation> = {}): Observation {
  return {
    id, schemaVersion: 5, sessionId, assetId,
    capturedAt: '2026-10-01T10:00:00.000Z', capturedLocation: captured,
    observation: { category: 'visitor_pressure', value: 'moderate' },
    evidence: { method: 'OBSERVED' }, note: null, locationAdjustment: null,
    createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z',
    editCount: 0, edited: false, deleted: false, ...patch,
  };
}

describe('summarizeCampaignExecution', () => {
  it('derives planned-asset coverage from linked, non-deleted campaign observations', () => {
    const summary = summarizeCampaignExecution(
      [session('s1')],
      [asset('a1'), asset('a2')],
      [
        observation('o1', 's1', 'a1'),
        observation('o2', 's1', 'a1', { capturedAt: '2026-10-01T11:00:00.000Z' }),
        observation('deleted', 's1', 'a2', { deleted: true }),
        observation('other-session', 'outside', 'a2'),
      ],
    );

    expect(summary.coveredAssetCount).toBe(1);
    expect(summary.remainingAssetCount).toBe(1);
    expect(summary.coveragePercent).toBe(50);
    expect(summary.observationCount).toBe(2);
    expect(summary.assets).toEqual([
      { assetId: 'a1', status: 'COVERED', observationCount: 2, lastObservedAt: '2026-10-01T11:00:00.000Z' },
      { assetId: 'a2', status: 'NOT_COVERED', observationCount: 0, lastObservedAt: null },
    ]);
    expect(summary.checkpoint.status).toBe('REVIEW_RECOMMENDED');
  });

  it('surfaces quality gaps without treating manual corrections or reported evidence as fabricated failure', () => {
    const noGps = {
      ...captured,
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      locationStatus: 'DENIED' as const,
    };
    const summary = summarizeCampaignExecution(
      [session('s1')],
      [asset('a1')],
      [
        observation('o1', 's1', 'a1', {
          capturedLocation: noGps,
          locationAdjustment: {
            latitude: 40.41, longitude: -3.71,
            locationAdjustedAt: '2026-10-01T10:05:00.000Z',
            locationAdjustmentReason: 'Map correction',
          },
          evidence: { method: 'REPORTED', sourceNote: 'Ranger' },
        }),
        observation('o2', 's1', null),
      ],
    );

    expect(summary.observationsWithoutRawGps).toBe(1);
    expect(summary.observationsWithoutPlannedAsset).toBe(1);
    expect(summary.manualLocationAdjustmentCount).toBe(1);
    expect(summary.evidenceCounts).toEqual({ OBSERVED: 1, MEASURED: 0, REPORTED: 1 });
    expect(summary.checkpoint.issues).toHaveLength(2);
    expect(summary.checkpoint.disclosures).toHaveLength(2);
  });

  it('is ready to review only when planned coverage and basic evidence-link/GPS checks are clean', () => {
    const summary = summarizeCampaignExecution(
      [session('s1')],
      [asset('a1')],
      [observation('o1', 's1', 'a1')],
    );

    expect(summary.checkpoint.status).toBe('READY_TO_REVIEW');
    expect(summary.checkpoint.issues).toEqual([]);
  });

  it('does not invent a coverage percentage when the campaign has no planned assets', () => {
    const summary = summarizeCampaignExecution([session('s1')], [], [observation('o1', 's1', null)]);
    expect(summary.coveragePercent).toBeNull();
    expect(summary.checkpoint.status).toBe('NO_PLANNED_ASSETS');
  });
});
