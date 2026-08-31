import { effectiveLocation } from '../domain/geo';
import type { Observation } from '../domain/types';
import type { SessionBundle } from './types';

interface GeoJsonFeature {
  type: 'Feature';
  // GeoJSON permits null geometry for an unlocated feature — we never fabricate a coordinate.
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  properties: Record<string, string | number | boolean | null>;
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  /** Non-standard but harmless metadata; QGIS ignores unknown members. */
  fieldosSchemaVersion: number;
  exportedAt: string;
  sessionId: string;
  features: GeoJsonFeature[];
}

function featureFor(obs: Observation): GeoJsonFeature {
  const eff = effectiveLocation(obs);
  const ev = obs.evidence;

  const properties: Record<string, string | number | boolean | null> = {
    observationId: obs.id,
    sessionId: obs.sessionId,
    assetId: obs.assetId,
    category: obs.observation.category,
    value: obs.observation.value,
    evidenceMethod: ev.method,
    measurementValue: ev.method === 'MEASURED' ? ev.value : null,
    measurementUnit: ev.method === 'MEASURED' ? ev.unit : null,
    reportedSourceNote: ev.method === 'REPORTED' ? ev.sourceNote : null,
    note: obs.note,
    capturedAt: obs.capturedAt,
    accuracyMeters: obs.capturedLocation.accuracyMeters,
    altitudeAccuracyMeters: obs.capturedLocation.altitudeAccuracyMeters,
    headingDegrees: obs.capturedLocation.headingDegrees,
    speedMetersPerSecond: obs.capturedLocation.speedMetersPerSecond,
    locationStatus: obs.capturedLocation.locationStatus,
    locationSource: eff.source,
    edited: obs.edited,
    editCount: obs.editCount,
    deleted: obs.deleted,
    createdAt: obs.createdAt,
    updatedAt: obs.updatedAt,
  };

  return {
    type: 'Feature',
    geometry: eff.coordinate
      ? { type: 'Point', coordinates: [eff.coordinate.longitude, eff.coordinate.latitude] }
      : null,
    properties,
  };
}

/** GeoJSON FeatureCollection — geometry uses effectiveLocation ([lon, lat] per spec). */
export function serializeObservationsGeoJson(bundle: SessionBundle): string {
  const collection: GeoJsonFeatureCollection = {
    type: 'FeatureCollection',
    fieldosSchemaVersion: bundle.fieldosSchemaVersion,
    exportedAt: bundle.exportedAt,
    sessionId: bundle.session.id,
    features: bundle.observations.map(featureFor),
  };
  return JSON.stringify(collection, null, 2);
}
