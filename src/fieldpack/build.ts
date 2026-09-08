// Deterministic FieldPack builder — internal infrastructure for tests and development ONLY.
//
// This is NOT a user-facing FieldPack authoring workflow (that is deliberately deferred, §22). It
// exists so tests and development can construct a valid, integrity-hashed `.fieldpack` archive
// without a UI. Given the same inputs it produces byte-identical output.

import { zipSync, type Zippable } from 'fflate';
import type { FieldProtocol } from '../protocol/types';
import { sha256Hex } from '../export/backup';
import {
  ASSETS_PATH,
  FIELDPACK_SCHEMA_VERSION,
  MANIFEST_PATH,
  PROTOCOL_PATH,
  type FieldPackAssetSpec,
  type FieldPackManifest,
} from './types';

export interface BuildFieldPackInput {
  fieldpackId: string;
  fieldpackVersion: number;
  title: string;
  description?: string | null;
  /** Defaults to a fixed synthetic timestamp for deterministic output. */
  createdAt?: string;
  protocol: FieldProtocol;
  assets: FieldPackAssetSpec[];
}

/** Serialize asset specs into a GeoJSON Point FeatureCollection matching the v1 parser. */
export function buildAssetsGeoJson(assets: readonly FieldPackAssetSpec[]): string {
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      features: assets.map((asset) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [asset.longitude, asset.latitude] },
        properties: {
          id: asset.sourceRef,
          name: asset.name,
          assetType: asset.assetType,
        },
      })),
    },
    null,
    2,
  );
}

/** Build a valid, integrity-hashed FieldPack archive (ZIP bytes) plus its manifest. */
export async function buildFieldPack(
  input: BuildFieldPackInput,
): Promise<{ bytes: Uint8Array; manifest: FieldPackManifest }> {
  const encoder = new TextEncoder();
  const protocolBytes = encoder.encode(JSON.stringify(input.protocol, null, 2));
  const assetsBytes = encoder.encode(buildAssetsGeoJson(input.assets));

  const manifest: FieldPackManifest = {
    format: 'fieldos-fieldpack',
    fieldpackSchemaVersion: FIELDPACK_SCHEMA_VERSION,
    fieldpackId: input.fieldpackId,
    fieldpackVersion: input.fieldpackVersion,
    title: input.title,
    description: input.description ?? null,
    createdAt: input.createdAt ?? '2026-09-07T00:00:00.000Z',
    protocolFile: PROTOCOL_PATH,
    assetsFile: ASSETS_PATH,
    integrity: {
      algorithm: 'SHA-256',
      files: {
        [PROTOCOL_PATH]: await sha256Hex(protocolBytes),
        [ASSETS_PATH]: await sha256Hex(assetsBytes),
      },
    },
  };

  const entries: Zippable = {
    [MANIFEST_PATH]: encoder.encode(JSON.stringify(manifest, null, 2)),
    [PROTOCOL_PATH]: protocolBytes,
    [ASSETS_PATH]: assetsBytes,
  };
  return { bytes: zipSync(entries), manifest };
}
