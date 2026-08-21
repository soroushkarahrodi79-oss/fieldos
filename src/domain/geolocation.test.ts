import { describe, expect, it } from 'vitest';
import { locationStatusFromErrorCode, unavailableLocation } from './geolocation';

describe('geolocation helpers', () => {
  it('maps browser error codes without inventing a position', () => {
    expect(locationStatusFromErrorCode(1)).toBe('DENIED');
    expect(locationStatusFromErrorCode(2)).toBe('UNAVAILABLE');
    expect(locationStatusFromErrorCode(3)).toBe('TIMEOUT');
    expect(locationStatusFromErrorCode(99)).toBe('UNAVAILABLE');
  });

  it('creates an honest no-fix capture', () => {
    const location = unavailableLocation('TIMEOUT');
    expect(location.locationStatus).toBe('TIMEOUT');
    expect(location.latitude).toBeNull();
    expect(location.longitude).toBeNull();
    expect(location.accuracyMeters).toBeNull();
  });
});
