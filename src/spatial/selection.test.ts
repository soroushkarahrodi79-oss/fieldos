import { describe, expect, it } from 'vitest';
import { findAssetFeature, findObservationFeature } from './selection';
import type { AssetMapFeature, ObservationMapFeature } from './mapTypes';

const obsFeature = (id: string): ObservationMapFeature => ({
  kind: 'observation',
  id,
  coordinate: { latitude: 1, longitude: 2 },
  placement: 'captured',
  category: 'litter',
  value: 'HIGH',
  evidenceMethod: 'OBSERVED',
  capturedAt: '2026-08-21T09:00:00.000+02:00',
  accuracyMeters: 5,
  locationStatus: 'CAPTURED',
});

const assetFeature = (id: string): AssetMapFeature => ({
  kind: 'asset',
  id,
  coordinate: { latitude: 3, longitude: 4 },
  name: id,
  assetType: 'viewpoint',
  source: 'field_created',
});

describe('feature selection', () => {
  it('(8) resolves a tapped observation marker to the correct observation id', () => {
    const features = [obsFeature('a'), obsFeature('b'), obsFeature('c')];
    expect(findObservationFeature(features, 'b')!.id).toBe('b');
    expect(findObservationFeature(features, 'missing')).toBeNull();
  });

  it('(8b) resolves a tapped asset marker to the correct asset id', () => {
    const features = [assetFeature('x'), assetFeature('y')];
    expect(findAssetFeature(features, 'y')!.name).toBe('y');
    expect(findAssetFeature(features, 'nope')).toBeNull();
  });
});
