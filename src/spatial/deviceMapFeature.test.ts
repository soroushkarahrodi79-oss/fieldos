import { describe, expect, it } from 'vitest';
import { deviceMapFeature } from './deviceMapFeature';
import type { CapturedLocation } from '../domain/types';

function fix(partial: Partial<CapturedLocation> = {}): CapturedLocation {
  return {
    latitude: 47.37,
    longitude: 8.54,
    accuracyMeters: 8,
    altitudeMeters: null,
    altitudeAccuracyMeters: null,
    headingDegrees: null,
    speedMetersPerSecond: null,
    locationStatus: 'CAPTURED',
    capturedAt: '2026-08-21T09:00:00.000+02:00',
    ...partial,
  };
}

describe('deviceMapFeature', () => {
  it('builds a device marker from a real fix', () => {
    const feature = deviceMapFeature(fix());
    expect(feature).toEqual({
      kind: 'device',
      coordinate: { latitude: 47.37, longitude: 8.54 },
      accuracyMeters: 8,
    });
  });

  it('(9) a geolocation-denied state yields no marker and does not throw', () => {
    expect(() =>
      deviceMapFeature(fix({ latitude: null, longitude: null, accuracyMeters: null, locationStatus: 'DENIED' })),
    ).not.toThrow();
    expect(
      deviceMapFeature(fix({ latitude: null, longitude: null, accuracyMeters: null, locationStatus: 'DENIED' })),
    ).toBeNull();
  });

  it('yields no marker for unavailable/timeout statuses', () => {
    expect(deviceMapFeature(fix({ latitude: null, longitude: null, locationStatus: 'UNAVAILABLE' }))).toBeNull();
    expect(deviceMapFeature(fix({ latitude: null, longitude: null, locationStatus: 'TIMEOUT' }))).toBeNull();
  });
});
