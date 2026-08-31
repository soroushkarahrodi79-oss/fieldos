import type { SessionBundle } from './types';
import { normalizeCapturedLocation } from '../domain/geolocation';

/**
 * Canonical JSON serialization of a session bundle.
 *
 * Invariant: UUIDs and timestamps are emitted verbatim (JSON.stringify does not touch strings),
 * so a serialize → parse round-trip reproduces the records exactly. No timestamp is regenerated.
 */
export function serializeSessionJson(bundle: SessionBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/** Parse a canonical JSON export back into a bundle (basis for a future restore). */
export function parseSessionJson(text: string): SessionBundle {
  const bundle = JSON.parse(text) as SessionBundle;
  return {
    ...bundle,
    observations: bundle.observations.map((observation) => ({
      ...observation,
      capturedLocation: normalizeCapturedLocation(observation.capturedLocation),
    })),
    // Schema-1/2 exports predate the revision log: normalize a missing collection to an empty
    // array. No historical audit events are ever fabricated for those older records.
    auditEntries: bundle.auditEntries ?? [],
  };
}
