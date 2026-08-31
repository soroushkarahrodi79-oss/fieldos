import type { AssetMapFeature, ObservationMapFeature } from './mapTypes';

/**
 * Resolve a tapped marker back to its source feature. Markers carry only a kind + id (never a copy
 * of the record), so selection is a pure lookup: given the id a marker was built with, return the
 * exact observation/asset feature — or `null` if it is no longer present (e.g. list changed).
 */
export function findObservationFeature(
  features: readonly ObservationMapFeature[],
  id: string,
): ObservationMapFeature | null {
  return features.find((feature) => feature.id === id) ?? null;
}

export function findAssetFeature(
  features: readonly AssetMapFeature[],
  id: string,
): AssetMapFeature | null {
  return features.find((feature) => feature.id === id) ?? null;
}
