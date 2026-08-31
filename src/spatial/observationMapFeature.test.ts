import { describe, expect, it } from 'vitest';
import { observationMapFeature, observationMapFeatures } from './observationMapFeature';
import type { CapturedLocation, LocationAdjustment, Observation } from '../domain/types';

const CAPTURED: CapturedLocation = {
  latitude: 47.37,
  longitude: 8.54,
  accuracyMeters: 5,
  altitudeMeters: null,
  altitudeAccuracyMeters: null,
  headingDegrees: null,
  speedMetersPerSecond: null,
  locationStatus: 'CAPTURED',
  capturedAt: '2026-08-21T09:00:00.000+02:00',
};

function obs(partial: Partial<Observation> = {}): Observation {
  return {
    id: 'obs-1',
    schemaVersion: 3,
    sessionId: 's',
    assetId: null,
    capturedAt: '2026-08-21T09:00:00.000+02:00',
    capturedLocation: CAPTURED,
    observation: { category: 'litter', value: 'HIGH' },
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

describe('observationMapFeature', () => {
  it('(1) places a captured observation at its raw captured coordinate', () => {
    const feature = observationMapFeature(obs());
    expect(feature).not.toBeNull();
    expect(feature!.coordinate).toEqual({ latitude: 47.37, longitude: 8.54 });
    expect(feature!.placement).toBe('captured');
    expect(feature!.id).toBe('obs-1');
    expect(feature!.category).toBe('litter');
    expect(feature!.value).toBe('HIGH');
  });

  it('(2) places an adjusted observation at the adjusted coordinate and flags it', () => {
    const adjustment: LocationAdjustment = {
      latitude: 48,
      longitude: 9,
      locationAdjustedAt: '2026-08-21T09:10:00.000+02:00',
      locationAdjustmentReason: 'moved off the raw fix',
    };
    const feature = observationMapFeature(obs({ locationAdjustment: adjustment }));
    expect(feature!.coordinate).toEqual({ latitude: 48, longitude: 9 });
    expect(feature!.placement).toBe('adjusted');
  });

  it('(3) never mutates the raw captured coordinate when deriving a feature', () => {
    const record = obs({
      locationAdjustment: {
        latitude: 48,
        longitude: 9,
        locationAdjustedAt: '2026-08-21T09:10:00.000+02:00',
        locationAdjustmentReason: null,
      },
    });
    observationMapFeature(record);
    // The raw capture block is untouched — the map read the DERIVED location only.
    expect(record.capturedLocation.latitude).toBe(47.37);
    expect(record.capturedLocation.longitude).toBe(8.54);
  });

  it('(4) produces no marker for a denied/missing fix with no adjustment', () => {
    const feature = observationMapFeature(
      obs({
        capturedLocation: {
          ...CAPTURED,
          latitude: null,
          longitude: null,
          accuracyMeters: null,
          locationStatus: 'DENIED',
        },
      }),
    );
    expect(feature).toBeNull();
  });

  it('(4b) still maps a denied fix that WAS given a manual adjustment', () => {
    const feature = observationMapFeature(
      obs({
        capturedLocation: { ...CAPTURED, latitude: null, longitude: null, locationStatus: 'DENIED' },
        locationAdjustment: {
          latitude: 10,
          longitude: 20,
          locationAdjustedAt: '2026-08-21T09:10:00.000+02:00',
          locationAdjustmentReason: null,
        },
      }),
    );
    expect(feature!.coordinate).toEqual({ latitude: 10, longitude: 20 });
    expect(feature!.placement).toBe('adjusted');
  });

  it('(5) excludes a soft-deleted observation from the active map', () => {
    expect(observationMapFeature(obs({ deleted: true }))).toBeNull();
  });

  it('maps a list and drops the unmappable ones', () => {
    const features = observationMapFeatures([
      obs({ id: 'a' }),
      obs({ id: 'b', deleted: true }),
      obs({
        id: 'c',
        capturedLocation: { ...CAPTURED, latitude: null, longitude: null, locationStatus: 'TIMEOUT' },
      }),
    ]);
    expect(features.map((f) => f.id)).toEqual(['a']);
  });
});
