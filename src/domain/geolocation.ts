import { nowIso } from './time';
import type { CapturedLocation, LocationStatus } from './types';

export function locationStatusFromErrorCode(code: number): Exclude<LocationStatus, 'CAPTURED'> {
  if (code === 1) return 'DENIED';
  if (code === 3) return 'TIMEOUT';
  return 'UNAVAILABLE';
}

export function unavailableLocation(status: Exclude<LocationStatus, 'CAPTURED'>): CapturedLocation {
  return {
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    altitudeMeters: null,
    locationStatus: status,
    capturedAt: nowIso(),
  };
}

export function captureCurrentLocation(timeoutMs = 12_000): Promise<CapturedLocation> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(unavailableLocation('UNAVAILABLE'));
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          altitudeMeters: position.coords.altitude,
          locationStatus: 'CAPTURED',
          capturedAt: nowIso(),
        });
      },
      (error) => resolve(unavailableLocation(locationStatusFromErrorCode(error.code))),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15_000 },
    );
  });
}
