import { describe, expect, it } from 'vitest';
import { assetMapFeature, assetMapFeatures } from './assetMapFeature';
import type { Asset } from '../domain/types';

function asset(partial: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    schemaVersion: 3,
    sessionId: 's',
    name: 'North trailhead',
    assetType: 'trailhead',
    latitude: 47.37,
    longitude: 8.54,
    source: 'field_created',
    createdAt: '2026-08-21T09:00:00.000+02:00',
    updatedAt: '2026-08-21T09:00:00.000+02:00',
    ...partial,
  };
}

describe('assetMapFeature', () => {
  it('(6) an asset with coordinates becomes a placed feature', () => {
    const feature = assetMapFeature(asset());
    expect(feature).not.toBeNull();
    expect(feature!.coordinate).toEqual({ latitude: 47.37, longitude: 8.54 });
    expect(feature!.name).toBe('North trailhead');
    expect(feature!.assetType).toBe('trailhead');
  });

  it('(7) an asset without coordinates generates no fabricated position', () => {
    expect(assetMapFeature(asset({ latitude: null, longitude: null }))).toBeNull();
    expect(assetMapFeature(asset({ latitude: 47.37, longitude: null }))).toBeNull();
    expect(assetMapFeature(asset({ latitude: null, longitude: 8.54 }))).toBeNull();
  });

  it('maps a list and drops the coordinate-less ones', () => {
    const features = assetMapFeatures([
      asset({ id: 'a' }),
      asset({ id: 'b', latitude: null, longitude: null }),
      asset({ id: 'c', latitude: 40, longitude: -3 }),
    ]);
    expect(features.map((f) => f.id)).toEqual(['a', 'c']);
  });
});
