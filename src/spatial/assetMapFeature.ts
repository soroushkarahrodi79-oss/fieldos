import type { Asset } from '../domain/types';
import type { AssetMapFeature } from './mapTypes';

/**
 * Derive an asset's map feature — or `null` when it cannot be placed.
 *
 * An asset with no coordinates (latitude/longitude null) produces NO marker; coordinates are
 * never fabricated. Assets are POINT geometry only in the current data model — there are no
 * polygon assets to render (see DATA_MODEL.md).
 */
export function assetMapFeature(asset: Asset): AssetMapFeature | null {
  if (asset.latitude === null || asset.longitude === null) return null;

  return {
    kind: 'asset',
    id: asset.id,
    coordinate: { latitude: asset.latitude, longitude: asset.longitude },
    name: asset.name,
    assetType: asset.assetType,
    source: asset.source,
  };
}

/** Map a list of assets to features, dropping any without valid coordinates. */
export function assetMapFeatures(assets: readonly Asset[]): AssetMapFeature[] {
  const features: AssetMapFeature[] = [];
  for (const asset of assets) {
    const feature = assetMapFeature(asset);
    if (feature) features.push(feature);
  }
  return features;
}
