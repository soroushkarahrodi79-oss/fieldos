// FieldPack v1 — bounded, versioned mission-package format.
//
// A FieldPack is PREPARATION MATERIAL a researcher builds before going outside: exactly one field
// protocol plus planned POINT assets, packaged so it can be imported once and then operated fully
// offline. It is NOT live remote configuration, NOT a generic GIS project, and NOT executable.
//
// Packaging is a ZIP with a fixed, deterministic set of paths:
//   manifest.json      — this manifest (identity, version, integrity hashes)
//   protocol.json      — exactly one FieldProtocol (validated by the Protocol Engine runtime)
//   assets.geojson     — a FeatureCollection of Point features (planned assets)
//
// No offline map tiles, images, reference media, AI models, arbitrary documents, or scripts in v1.

import type { AssetType } from '../domain/types';
import type { FieldProtocol } from '../protocol/types';

/** Structural version of the FieldPack format understood by this build. */
export const FIELDPACK_SCHEMA_VERSION = 1;

/** Deterministic archive paths. Nothing else is consumed from a FieldPack ZIP. */
export const MANIFEST_PATH = 'manifest.json';
export const PROTOCOL_PATH = 'protocol.json';
export const ASSETS_PATH = 'assets.geojson';

/**
 * SHA-256 payload integrity, REQUIRED for v1. Hashes cover the exact bytes of `protocol.json` and
 * `assets.geojson` only — never the manifest hashing itself. This detects corruption or a changed
 * payload relative to the manifest; it is NOT a signature, a trusted publisher, authenticated
 * methodology, or tamper-proof evidence.
 */
export interface FieldPackIntegrity {
  algorithm: 'SHA-256';
  files: Record<string, string>;
}

export interface FieldPackManifest {
  format: 'fieldos-fieldpack';
  fieldpackSchemaVersion: number;
  fieldpackId: string;
  fieldpackVersion: number;
  title: string;
  description: string | null;
  createdAt: string;
  protocolFile: typeof PROTOCOL_PATH;
  assetsFile: typeof ASSETS_PATH;
  integrity: FieldPackIntegrity;
}

/**
 * One planned asset parsed from `assets.geojson`, BEFORE a local FieldOS UUID is minted. `sourceRef`
 * is the stable external mission identifier (the feature `id`); it is preserved alongside the local
 * UUID on install — the two identities are kept separate on purpose.
 */
export interface FieldPackAssetSpec {
  sourceRef: string;
  name: string;
  assetType: AssetType | null;
  latitude: number;
  longitude: number;
}

/** The result of validating a FieldPack fully in memory — no local writes have occurred. */
export interface FieldPackInspection {
  manifest: FieldPackManifest;
  /** The single validated, deep-copied protocol that will become the Campaign's snapshot. */
  protocol: FieldProtocol;
  assets: FieldPackAssetSpec[];
  /** v1 requires integrity, so a successfully inspected pack is always VERIFIED. */
  integrityStatus: 'VERIFIED';
  compatibility: 'SUPPORTED';
  /** Count of planned assets per asset type (null type counted under 'unclassified'). */
  assetTypeBreakdown: Record<string, number>;
  warnings: string[];
  /** Filled by the import preflight; `none` until the collision check runs. */
  collision: FieldPackCollision;
}

/**
 * Collision policy outcome (v1 is deliberately conservative):
 *  - `none`                 → safe to import.
 *  - `duplicate`            → this exact fieldpackId + version is already installed → BLOCK.
 *  - `unsupported_upgrade`  → the same fieldpackId is installed at a different version → BLOCK
 *                             (automatic campaign upgrade/merge is out of scope for v1).
 */
export type FieldPackCollision =
  | { kind: 'none' }
  | { kind: 'duplicate'; existingCampaignId: string }
  | { kind: 'unsupported_upgrade'; existingCampaignId: string; existingVersion: number };

export interface FieldPackImportResult {
  campaignId: string;
  title: string;
  fieldpackId: string;
  fieldpackVersion: number;
  assetCount: number;
}
