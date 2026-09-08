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
  // Additive protocol provenance (Protocol Engine v1): identifies which protocol interpreted this
  // session's category/value ids. Same for every row; empty for a legacy (no-snapshot) session.
  // The full protocol definition is NOT flattened per row — it lives in canonical JSON / backup.
  'protocolId',
  'protocolVersion',
  // Additive campaign provenance (Campaign + FieldPack v1): the organisational mission this session
  // belonged to. Same for every row; empty for a standalone/legacy session.
  'campaignId',
] as const;

function rowFor(
  obs: Observation,
  media: MediaMetadata[],
  protocolId: string,
  protocolVersion: number | null,
  campaignId: string,
): (string | number | boolean | null)[] {
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
    protocolId,
    protocolVersion,
    campaignId,
  ];
}

/** Flat, one-row-per-observation CSV for spreadsheets. Includes all observations (deleted flagged). */
export function serializeObservationsCsv(bundle: SessionBundle): string {
  const protocol = bundle.session.protocolSnapshot;
  const protocolId = protocol?.protocolId ?? '';
  const protocolVersion = protocol?.version ?? null;
  const campaignId = bundle.session.campaignId ?? '';
  const header = COLUMNS.join(',');
  const lines = bundle.observations.map((obs) =>
    rowFor(obs, bundle.media, protocolId, protocolVersion, campaignId).map(csvCell).join(','),
  );
  return [header, ...lines].join('\r\n');
}
