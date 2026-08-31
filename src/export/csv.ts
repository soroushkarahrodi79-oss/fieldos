import { effectiveLocation } from '../domain/geo';
import type { Observation } from '../domain/types';
import type { MediaMetadata, SessionBundle } from './types';

/** RFC-4180-style CSV field escaping. */
function csvCell(value: string | number | boolean | null): string {
  if (value === null) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const COLUMNS = [
  'observationId',
  'sessionId',
  'assetId',
  'category',
  'value',
  'evidenceMethod',
  'measurementValue',
  'measurementUnit',
  'measurementContext',
  'reportedSourceNote',
  'note',
  'capturedAt',
  'capturedLatitude',
  'capturedLongitude',
  'accuracyMeters',
  'location_altitude_accuracy_m',
  'location_heading_deg',
  'location_speed_mps',
  'locationStatus',
  'adjustedLatitude',
  'adjustedLongitude',
  'locationSource',
  'effectiveLatitude',
  'effectiveLongitude',
  'edited',
  'editCount',
  'deleted',
  'createdAt',
  'updatedAt',
  'mediaCount',
  'mediaFilenames',
] as const;

function rowFor(obs: Observation, media: MediaMetadata[]): (string | number | boolean | null)[] {
  const eff = effectiveLocation(obs);
  const ev = obs.evidence;
  const mine = media.filter((m) => m.observationId === obs.id);

  return [
    obs.id,
    obs.sessionId,
    obs.assetId,
    obs.observation.category,
    obs.observation.value, // null for `other`
    ev.method,
    ev.method === 'MEASURED' ? ev.value : null,
    ev.method === 'MEASURED' ? ev.unit : null,
    ev.method === 'MEASURED' ? ev.context : null,
    ev.method === 'REPORTED' ? ev.sourceNote : null,
    obs.note,
    obs.capturedAt,
    obs.capturedLocation.latitude,
    obs.capturedLocation.longitude,
    obs.capturedLocation.accuracyMeters,
    obs.capturedLocation.altitudeAccuracyMeters,
    obs.capturedLocation.headingDegrees,
    obs.capturedLocation.speedMetersPerSecond,
    obs.capturedLocation.locationStatus,
    obs.locationAdjustment?.latitude ?? null,
    obs.locationAdjustment?.longitude ?? null,
    eff.source,
    eff.coordinate?.latitude ?? null,
    eff.coordinate?.longitude ?? null,
    obs.edited,
    obs.editCount,
    obs.deleted,
    obs.createdAt,
    obs.updatedAt,
    mine.length,
    mine.map((m) => m.backupFilename).join(' '),
  ];
}

/** Flat, one-row-per-observation CSV for spreadsheets. Includes all observations (deleted flagged). */
export function serializeObservationsCsv(bundle: SessionBundle): string {
  const header = COLUMNS.join(',');
  const lines = bundle.observations.map((obs) =>
    rowFor(obs, bundle.media).map(csvCell).join(','),
  );
  return [header, ...lines].join('\r\n');
}
