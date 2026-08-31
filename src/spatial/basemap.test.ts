import { describe, expect, it } from 'vitest';
import { observationMapFeatures } from './observationMapFeature';
import {
  BASEMAP_BACKGROUND,
  OSM_ATTRIBUTION,
  basemapUnavailableMessage,
  buildBasemapStyle,
} from './basemap';
import type { CapturedLocation, Observation } from '../domain/types';

describe('basemap style', () => {
  it('is an inline style so map init never depends on the network', () => {
    const style = buildBasemapStyle();
    expect(style.version).toBe(8);
    expect(style.sources.osm.type).toBe('raster');
    expect(style.sources.osm.tiles.length).toBeGreaterThan(0);
    // Every tile endpoint is a concrete https URL template — no remote style document is fetched.
    for (const tile of style.sources.osm.tiles) {
      expect(tile).toMatch(/^https:\/\/.+\{z\}\/\{x\}\/\{y\}/);
    }
  });

  it('carries required OSM attribution and a neutral offline background layer', () => {
    const style = buildBasemapStyle();
    expect(style.sources.osm.attribution).toBe(OSM_ATTRIBUTION);
    const background = style.layers.find((l) => l.type === 'background');
    expect(background).toBeDefined();
    expect(background && 'paint' in background && background.paint['background-color']).toBe(
      BASEMAP_BACKGROUND,
    );
  });
});

describe('(10) offline / basemap-failure fallback', () => {
  it('reports an offline-specific message when the network is down', () => {
    expect(basemapUnavailableMessage(false)).toContain('offline');
    expect(basemapUnavailableMessage(true)).not.toContain('offline');
    // Both variants still reassure that records remain available.
    expect(basemapUnavailableMessage(false)).toMatch(/still shown|available/i);
  });

  it('spatial overlays are unaffected by basemap failure (pure of tiles)', () => {
    const captured: CapturedLocation = {
      latitude: 40.4,
      longitude: -3.7,
      accuracyMeters: 6,
      altitudeMeters: null,
      altitudeAccuracyMeters: null,
      headingDegrees: null,
      speedMetersPerSecond: null,
      locationStatus: 'CAPTURED',
      capturedAt: '2026-08-21T09:00:00.000+02:00',
    };
    const observation: Observation = {
      id: 'o',
      schemaVersion: 3,
      sessionId: 's',
      assetId: null,
      capturedAt: captured.capturedAt,
      capturedLocation: captured,
      observation: { category: 'other', value: null },
      evidence: { method: 'OBSERVED' },
      note: null,
      locationAdjustment: null,
      createdAt: captured.capturedAt,
      updatedAt: captured.capturedAt,
      editCount: 0,
      edited: false,
      deleted: false,
    };
    // Feature derivation does not touch tiles/network — overlays render regardless of basemap state.
    const features = observationMapFeatures([observation]);
    expect(features).toHaveLength(1);
    expect(features[0]!.coordinate).toEqual({ latitude: 40.4, longitude: -3.7 });
  });
});
