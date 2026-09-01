import type { Coordinate } from '../domain/types';

/**
 * The initial framing for the map, derived from whatever spatial data exists. No hard-coded
 * study area, no arbitrary global fallback: with nothing to show we report `empty` so the UI can
 * render an honest empty state instead of dropping the researcher onto a random world map.
 *
 * Bounds are expressed as [[west, south], [east, north]] in lng/lat order (MapLibre's convention).
 */
export type Viewport =
  | { kind: 'empty' }
  | { kind: 'point'; center: [number, number]; zoom: number }
  | { kind: 'bounds'; bounds: [[number, number], [number, number]] };

/** Default zoom when everything collapses to a single coordinate. */
const SINGLE_POINT_ZOOM = 15;

function sameCoordinate(a: Coordinate, b: Coordinate): boolean {
  return a.latitude === b.latitude && a.longitude === b.longitude;
}

/**
 * Frame the map over the supplied coordinates (observations + assets + optionally the device).
 *  - no coordinates at all → `empty`
 *  - one distinct coordinate → `point` centred there
 *  - several → `bounds` fitting them all
 */
export function computeViewport(coordinates: readonly Coordinate[]): Viewport {
  if (coordinates.length === 0) return { kind: 'empty' };

  const first = coordinates[0]!;
  const allSame = coordinates.every((c) => sameCoordinate(c, first));
  if (allSame) {
    return { kind: 'point', center: [first.longitude, first.latitude], zoom: SINGLE_POINT_ZOOM };
  }

  let west = first.longitude;
  let east = first.longitude;
  let south = first.latitude;
  let north = first.latitude;
  for (const c of coordinates) {
    if (c.longitude < west) west = c.longitude;
    if (c.longitude > east) east = c.longitude;
    if (c.latitude < south) south = c.latitude;
    if (c.latitude > north) north = c.latitude;
  }
  return {
    kind: 'bounds',
    bounds: [
      [west, south],
      [east, north],
    ],
  };
}

/** Convenience: gather every coordinate from typed feature lists for {@link computeViewport}. */
export function collectCoordinates(
  ...groups: readonly (readonly { coordinate: Coordinate }[])[]
): Coordinate[] {
  const out: Coordinate[] = [];
  for (const group of groups) {
    for (const item of group) out.push(item.coordinate);
  }
  return out;
}
