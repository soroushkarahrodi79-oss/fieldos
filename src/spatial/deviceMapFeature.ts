import type { CapturedLocation } from '../domain/types';
import type { DeviceMapFeature } from './mapTypes';

/**
 * Turn a single geolocation fix into the device-position feature — or `null` when there is no
 * usable fix (permission denied, unavailable, timeout, or a captured status with null coords).
 *
 * Location failure is NON-FATAL: a `null` result simply means no "you are here" marker; the map
 * still renders every observation and asset. This uses the same capture shape as the rest of
 * FieldOS — a single current-position fix, never `watchPosition`, no track, no speed/heading.
 */
export function deviceMapFeature(location: CapturedLocation): DeviceMapFeature | null {
  if (location.locationStatus !== 'CAPTURED') return null;
  if (location.latitude === null || location.longitude === null) return null;
  return {
    kind: 'device',
    coordinate: { latitude: location.latitude, longitude: location.longitude },
    accuracyMeters: location.accuracyMeters,
  };
}
