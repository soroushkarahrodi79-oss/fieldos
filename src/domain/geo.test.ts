import { describe, expect, it } from 'vitest';
import { effectiveLocation, haversineMeters, nearbyAssets } from './geo';
import type { Asset, Observation } from './types';

function obs(partial: Partial<Observation>): Observation {
  return {
    id: 'o',
    schemaVersion: 1,
    sessionId: 's',
    assetId: null,
    capturedAt: '2026-08-21T09:00:00.000+02:00',
    capturedLocation: {
      latitude: 47.37,
      longitude: 8.54,
      accuracyMeters: 5,
      altitudeMeters: null,
      altitudeAccuracyMeters: null,
      headingDegrees: null,
      speedMetersPerSecond: null,
      locationStatus: 'CAPTURED',
      capturedAt: '2026-08-21T09:00:00.000+02:00',
    },
    observation: { category: 'other', value: null },
    evidence: { method: 'OBSERVED' },
    note: null,
    locationAdjustment: null,
    createdAt: '2026-08-21T09:00:00.000+02:00',
    updatedAt: '2026-08-21T09:00:00.000+02:00',
    editCount: 0,
    edited: false,
    deleted: false,
    ...partial,
  };
}

describe('haversineMeters', () => {
  it('is ~0 for identical points', () => {
    expect(haversineMeters({ latitude: 47.37, longitude: 8.54 }, { latitude: 47.37, longitude: 8.54 })).toBeCloseTo(0, 5);
  });

  it('computes a known distance (~111km per degree of latitude)', () => {
    const d = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe('effectiveLocation', () => {
  it('uses the captured fix when no adjustment', () => {
    const r = effectiveLocation(obs({}));
    expect(r.source).toBe('captured');
    expect(r.coordinate).toEqual({ latitude: 47.37, longitude: 8.54 });
  });

  it('prefers a manual adjustment over the raw fix', () => {
    const r = effectiveLocation(
      obs({
        locationAdjustment: {
          latitude: 48,
          longitude: 9,
          locationAdjustedAt: '2026-08-21T09:10:00.000+02:00',
          locationAdjustmentReason: null,
        },
      }),
    );
    expect(r.source).toBe('adjusted');
    expect(r.coordinate).toEqual({ latitude: 48, longitude: 9 });
  });

  it('returns none when there is no coordinate (never fabricated)', () => {
    const r = effectiveLocation(
      obs({
        capturedLocation: {
          latitude: null,
          longitude: null,
          accuracyMeters: null,
          altitudeMeters: null,
          altitudeAccuracyMeters: null,
          headingDegrees: null,
          speedMetersPerSecond: null,
          locationStatus: 'DENIED',
          capturedAt: '2026-08-21T09:00:00.000+02:00',
        },
      }),
    );
    expect(r.source).toBe('none');
    expect(r.coordinate).toBeNull();
  });
});

describe('nearbyAssets', () => {
  const mkAsset = (name: string, lat: number | null, lon: number | null): Asset => ({
    id: name,
    schemaVersion: 1,
    sessionId: 's',
    name,
    assetType: null,
    latitude: lat,
    longitude: lon,
    source: 'field_created',
    createdAt: '2026-08-21T09:00:00.000+02:00',
    updatedAt: '2026-08-21T09:00:00.000+02:00',
  });

  it('sorts assets with coordinates nearest-first and omits those without', () => {
    const from = { latitude: 47.37, longitude: 8.54 };
    const result = nearbyAssets(from, [
      mkAsset('far', 47.5, 8.7),
      mkAsset('near', 47.371, 8.541),
      mkAsset('nocoords', null, null),
    ]);
    expect(result.map((r) => r.asset.name)).toEqual(['near', 'far']);
    expect(result[0]!.distanceMeters).toBeLessThan(result[1]!.distanceMeters);
  });
});
