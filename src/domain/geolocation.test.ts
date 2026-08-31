import { describe, expect, it } from 'vitest';
import {
  capturedLocationFromPosition,
  locationStatusFromErrorCode,
  normalizeCapturedLocation,
  unavailableLocation,
} from './geolocation';

describe('geolocation helpers', () => {
  it('maps browser error codes without inventing a position', () => {
    expect(locationStatusFromErrorCode(1)).toBe('DENIED');
    expect(locationStatusFromErrorCode(2)).toBe('UNAVAILABLE');
    expect(locationStatusFromErrorCode(3)).toBe('TIMEOUT');
    expect(locationStatusFromErrorCode(99)).toBe('UNAVAILABLE');
  });

  it.each(['DENIED', 'TIMEOUT', 'UNAVAILABLE'] as const)(
    'creates an honest %s no-fix capture with all raw metadata null',
    (status) => {
      const location = unavailableLocation(status);
      expect(location.locationStatus).toBe(status);
      expect(location.latitude).toBeNull();
      expect(location.longitude).toBeNull();
      expect(location.accuracyMeters).toBeNull();
      expect(location.altitudeMeters).toBeNull();
      expect(location.altitudeAccuracyMeters).toBeNull();
      expect(location.headingDegrees).toBeNull();
      expect(location.speedMetersPerSecond).toBeNull();
    },
  );

  it('maps a full browser position without changing raw GNSS values', () => {
    const location = capturedLocationFromPosition({
      coords: {
        latitude: 40.4168,
        longitude: -3.7038,
        accuracy: 6.2,
        altitude: 667,
        altitudeAccuracy: 4.5,
        heading: 127,
        speed: 1.8,
        toJSON: () => ({}),
      },
      timestamp: 0,
      toJSON: () => ({}),
    });

    expect(location.altitudeAccuracyMeters).toBe(4.5);
    expect(location.headingDegrees).toBe(127);
    expect(location.speedMetersPerSecond).toBe(1.8);
  });

  it('preserves browser null values instead of substituting zero', () => {
    const location = capturedLocationFromPosition({
      coords: {
        latitude: 40.4168,
        longitude: -3.7038,
        accuracy: 6.2,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: 0,
      toJSON: () => ({}),
    });

    expect(location.altitudeAccuracyMeters).toBeNull();
    expect(location.headingDegrees).toBeNull();
    expect(location.speedMetersPerSecond).toBeNull();
  });

  it('normalizes legacy missing values to null while preserving real zeroes', () => {
    const normalized = normalizeCapturedLocation({
      latitude: 1,
      longitude: 2,
      accuracyMeters: 3,
      altitudeMeters: null,
      headingDegrees: 0,
      speedMetersPerSecond: 0,
      locationStatus: 'CAPTURED',
      capturedAt: '2026-08-21T09:00:00.000+02:00',
    });
    expect(normalized.altitudeAccuracyMeters).toBeNull();
    expect(normalized.headingDegrees).toBe(0);
    expect(normalized.speedMetersPerSecond).toBe(0);
  });
});
