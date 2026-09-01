import { effectiveLocation } from '../domain/geo';
import type { Observation } from '../domain/types';
import type { ObservationMapFeature } from './mapTypes';

/**
 * Derive an observation's map feature — or `null` when it must not appear on the active map.
 *
 * Provenance rules (P1-6, non-negotiable):
 *  - Placement uses the DERIVED `effectiveLocation` policy: the manual adjustment if one exists,
 *    else the raw captured fix. The raw `capturedLocation` is only READ here, never mutated.
 *  - No fabricated coordinate: an observation with no adjustment and no captured fix (denied /
 *    unavailable / timeout GPS) yields `null` — it produces no marker.
 *  - Soft-deleted observations are excluded from the normal active map.
 */
export function observationMapFeature(observation: Observation): ObservationMapFeature | null {
  if (observation.deleted) return null;

  const eff = effectiveLocation(observation);
  if (!eff.coordinate) return null; // no fix and no adjustment → no marker (never fabricated)

  return {
    kind: 'observation',
    id: observation.id,
    coordinate: eff.coordinate,
    placement: eff.source === 'adjusted' ? 'adjusted' : 'captured',
    category: observation.observation.category,
    value: observation.observation.value,
    evidenceMethod: observation.evidence.method,
    capturedAt: observation.capturedAt,
    accuracyMeters: observation.capturedLocation.accuracyMeters,
    locationStatus: observation.capturedLocation.locationStatus,
  };
}

/** Map a list of observations to features, dropping the ones with no mappable position. */
export function observationMapFeatures(
  observations: readonly Observation[],
): ObservationMapFeature[] {
  const features: ObservationMapFeature[] = [];
  for (const observation of observations) {
    const feature = observationMapFeature(observation);
    if (feature) features.push(feature);
  }
  return features;
}
