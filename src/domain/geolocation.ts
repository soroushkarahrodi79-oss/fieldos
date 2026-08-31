import { nowIso } from './time';
import type { CapturedLocation, LocationStatus } from './types';

type LegacyCapturedLocation = Omit<
  CapturedLocation,
  'altitudeAccuracyMeters' | 'headingDegrees' | 'speedMetersPerSecond'
> &
  Partial<
    Pick<CapturedLocation, 'altitudeAccuracyMeters' | 'headingDegrees' | 'speedMetersPerSecond'>
  >;

/** Normalize additive raw GNSS fields on legacy records/backups without inventing values. */
export function normalizeCapturedLocation(location: LegacyCapturedLocation): CapturedLocation {
  return {
    ...location,
    altitudeAccuracyMeters: location.altitudeAccuracyMeters ?? null,
    headingDegrees: location.headingDegrees ?? null,
    speedMetersPerSecond: location.speedMetersPerSecond ?? null,
  };
}

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
    altitudeAccuracyMeters: null,
    headingDegrees: null,
    speedMetersPerSecond: null,
    locationStatus: status,
    capturedAt: nowIso(),
  };
}

/** Map the browser fix directly; no motion/accuracy value is calculated or substituted. */
export function capturedLocationFromPosition(position: GeolocationPosition): CapturedLocation {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: position.coords.accuracy,
    altitudeMeters: position.coords.altitude,
    altitudeAccuracyMeters: position.coords.altitudeAccuracy,
    headingDegrees: position.coords.heading,
    speedMetersPerSecond: position.coords.speed,
    locationStatus: 'CAPTURED',
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
        resolve(capturedLocationFromPosition(position));
      },
      (error) => resolve(unavailableLocation(locationStatusFromErrorCode(error.code))),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15_000 },
    );
  });
}
