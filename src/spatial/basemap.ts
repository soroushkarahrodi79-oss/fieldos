// Basemap strategy (P1-6) — ONLINE RASTER ONLY. No PMTiles, no tile caching, no offline basemap.
//
// The style is an INLINE object (not a remote style URL), so map initialization never depends on
// the network: MapLibre constructs the map from this literal even with no connectivity, and only
// the raster tile IMAGES fail to load when offline. That is what keeps the evidence overlays
// (observations / assets / current position) structurally renderable when the basemap is gone.
//
// Source: OpenStreetMap standard raster tiles. Keyless and free, but the OSM tile usage policy
// (https://operations.osmfoundation.org/policies/tiles/) forbids heavy/bulk use — this is suitable
// for MVP and field TESTING only, NOT high-volume production. Attribution is REQUIRED and shown.

/** OSM standard raster tile endpoints. */
export const OSM_RASTER_TILES: readonly string[] = [
  'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
  'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
  'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
];

/** Required OSM attribution string. Must remain visible on the map. */
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/** Neutral canvas colour shown where tiles have not (or cannot) load — e.g. offline. */
export const BASEMAP_BACKGROUND = '#e7ece6';

/**
 * A minimal MapLibre-compatible style spec, typed locally so this module stays free of the heavy
 * `maplibre-gl` import and remains unit-testable in the Node test environment. It is cast to
 * MapLibre's `StyleSpecification` at the single call site in FieldMap.
 */
export interface RasterBasemapStyle {
  version: 8;
  sources: {
    osm: {
      type: 'raster';
      tiles: string[];
      tileSize: number;
      attribution: string;
      maxzoom: number;
    };
  };
  layers: Array<
    | { id: string; type: 'background'; paint: { 'background-color': string } }
    | { id: string; type: 'raster'; source: 'osm' }
  >;
}

/** Build the inline online raster basemap style. */
export function buildBasemapStyle(): RasterBasemapStyle {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [...OSM_RASTER_TILES],
        tileSize: 256,
        attribution: OSM_ATTRIBUTION,
        maxzoom: 19,
      },
    },
    layers: [
      // A background layer paints first, so a failed/absent tile grid shows a calm neutral field
      // rather than a black void — and the overlays stay legible on top.
      { id: 'background', type: 'background', paint: { 'background-color': BASEMAP_BACKGROUND } },
      { id: 'osm', type: 'raster', source: 'osm' },
    ],
  };
}

/**
 * The message to surface when basemap tiles cannot be shown. This never blocks the rest of the
 * map — the spatial records remain accessible through the normal (non-map) workflow regardless.
 */
export function basemapUnavailableMessage(online: boolean): string {
  return online
    ? 'Basemap tiles could not load. Your observations and assets are still shown and remain available in the list.'
    : 'Basemap unavailable offline. Your observations and assets are still shown and remain available in the list.';
}
