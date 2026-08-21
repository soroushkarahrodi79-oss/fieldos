import type { Asset, Coordinate, Observation } from './types';

/**
 * The effective location of an observation is DERIVED, never persisted:
 *  - the manual adjustment if the user corrected the pin, else
 *  - the raw captured coordinate if a fix exists, else
 *  - null (no fabricated coordinate).
 *
 * Returns which source was used so exports can record `locationSource` honestly.
 */
export type LocationSource = 'adjusted' | 'captured' | 'none';

export function effectiveLocation(obs: Observation): {
  coordinate: Coordinate | null;
  source: LocationSource;
} {
  if (obs.locationAdjustment) {
    return {
      coordinate: {
        latitude: obs.locationAdjustment.latitude,
        longitude: obs.locationAdjustment.longitude,
      },
      source: 'adjusted',
    };
  }
  const { latitude, longitude } = obs.capturedLocation;
  if (latitude !== null && longitude !== null) {
    return { coordinate: { latitude, longitude }, source: 'captured' };
  }
  return { coordinate: null, source: 'none' };
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle distance between two coordinates in metres (haversine).
 * This is the entire "geospatial engine" for P0 — no map library, no tiles.
 */
export function haversineMeters(a: Coordinate, b: Coordinate): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface AssetDistance {
  asset: Asset;
  distanceMeters: number;
}

/**
 * Assets with known coordinates, sorted nearest-first relative to `from`.
 * Assets without coordinates are omitted (they have no distance).
 */
export function nearbyAssets(from: Coordinate, assets: readonly Asset[]): AssetDistance[] {
  const withCoords: AssetDistance[] = [];
  for (const asset of assets) {
    if (asset.latitude === null || asset.longitude === null) continue;
    withCoords.push({
      asset,
      distanceMeters: haversineMeters(from, {
        latitude: asset.latitude,
        longitude: asset.longitude,
      }),
    });
  }
  return withCoords.sort((x, y) => x.distanceMeters - y.distanceMeters);
}
