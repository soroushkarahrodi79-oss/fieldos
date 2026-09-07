// FieldPack assets.geojson parsing — POINT assets only (Campaign + FieldPack v1 §9).
//
// This intentionally closes the previously deferred "preloaded GeoJSON assets" capability, but
// stays deliberately narrow: a FeatureCollection of Point features, each with a stable source id, a
// non-empty name, valid WGS84 coordinates, and a known-or-null asset type. Polygon/LineString/
// GeometryCollection/MultiPoint/null geometry and out-of-range coordinates are REJECTED. Polygon
// asset support remains deferred.

import type { AssetType } from '../domain/types';
import { FieldPackValidationError } from './manifest';
import type { FieldPackAssetSpec } from './types';

const KNOWN_ASSET_TYPES: ReadonlySet<AssetType> = new Set<AssetType>([
  'trailhead', 'car_park', 'viewpoint', 'visitor_centre', 'path_segment', 'public_space', 'other',
]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FieldPackValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** Parse and validate the GeoJSON asset payload into normalized specs (no UUIDs minted yet). */
export function parseFieldPackAssets(raw: unknown): FieldPackAssetSpec[] {
  const collection = object(raw, 'assets.geojson');
  if (collection.type !== 'FeatureCollection') {
    throw new FieldPackValidationError('assets.geojson must be a GeoJSON FeatureCollection.');
  }
  if (!Array.isArray(collection.features)) {
    throw new FieldPackValidationError('assets.geojson features must be an array.');
  }

  const specs: FieldPackAssetSpec[] = [];
  const seenRefs = new Set<string>();

  collection.features.forEach((rawFeature, index) => {
    const feature = object(rawFeature, `Feature ${index}`);
    if (feature.type !== 'Feature') {
      throw new FieldPackValidationError(`Feature ${index} must have type "Feature".`);
    }

    // Geometry: Point only. Null geometry and non-point geometries are rejected — never fabricated.
    if (feature.geometry === null || feature.geometry === undefined) {
      throw new FieldPackValidationError(`Feature ${index} has no geometry; a Point is required.`);
    }
    const geometry = object(feature.geometry, `Feature ${index} geometry`);
    if (geometry.type !== 'Point') {
      throw new FieldPackValidationError(
        `Feature ${index} geometry type "${String(geometry.type)}" is not supported; only Point assets are allowed.`,
      );
    }
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
      throw new FieldPackValidationError(`Feature ${index} Point coordinates must be [longitude, latitude].`);
    }
    const longitude = geometry.coordinates[0];
    const latitude = geometry.coordinates[1];
    if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new FieldPackValidationError(`Feature ${index} has an out-of-range longitude.`);
    }
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new FieldPackValidationError(`Feature ${index} has an out-of-range latitude.`);
    }

    const properties = object(feature.properties, `Feature ${index} properties`);
    const rawRef = properties.id;
    if (typeof rawRef !== 'string' || rawRef.trim() === '') {
      throw new FieldPackValidationError(`Feature ${index} must carry a non-empty string "id" (source asset id).`);
    }
    const sourceRef = rawRef;
    if (seenRefs.has(sourceRef)) {
      throw new FieldPackValidationError(`Duplicate source asset id "${sourceRef}"; asset ids must be unique.`);
    }
    seenRefs.add(sourceRef);

    const rawName = properties.name;
    if (typeof rawName !== 'string' || rawName.trim() === '') {
      throw new FieldPackValidationError(`Asset "${sourceRef}" must have a non-empty name.`);
    }

    // Known asset type, or safely null. An unknown non-null type is rejected rather than silently
    // dropped (do not discard unknown semantics).
    let assetType: AssetType | null = null;
    if (properties.assetType !== undefined && properties.assetType !== null) {
      if (typeof properties.assetType !== 'string' || !KNOWN_ASSET_TYPES.has(properties.assetType as AssetType)) {
        throw new FieldPackValidationError(`Asset "${sourceRef}" has an unknown assetType "${String(properties.assetType)}".`);
      }
      assetType = properties.assetType as AssetType;
    }

    specs.push({ sourceRef, name: rawName, assetType, latitude, longitude });
  });

  return specs;
}
