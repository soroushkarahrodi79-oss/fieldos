// FieldPack import — preflight-first, atomic, offline.
//
// Flow (Campaign + FieldPack v1 §11): choose → parse ZIP safely → validate manifest → verify
// SHA-256 → validate protocol → validate GeoJSON assets → check identity/version collision →
// preview → confirm → atomic local installation. NOTHING is written before confirmation; the whole
// inspection runs in memory. A FieldPack is treated as UNTRUSTED input.

import { unzipSync, strFromU8 } from 'fflate';
import type { Repositories } from '../db/repositories';
import { newId } from '../domain/ids';
import { nowIso } from '../domain/time';
import { SCHEMA_VERSION } from '../version';
import type { Asset, FieldCampaign } from '../domain/types';
import { sha256Hex } from '../export/backup';
import { ProtocolValidationError, validateProtocol } from '../protocol/validation';
import { FieldPackValidationError, validateFieldPackManifest } from './manifest';
import { parseFieldPackAssets } from './assets';
import {
  ASSETS_PATH,
  MANIFEST_PATH,
  PROTOCOL_PATH,
  type FieldPackImportResult,
  type FieldPackInspection,
} from './types';

/** A defensive bound on total decompressed FieldPack size (v1 carries only small JSON payloads). */
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

const ALLOWED_PATHS = new Set([MANIFEST_PATH, PROTOCOL_PATH, ASSETS_PATH]);

function unsafePath(name: string): boolean {
  return name.includes('..') || name.startsWith('/') || !ALLOWED_PATHS.has(name);
}

/**
 * Inspect and fully validate a `.fieldpack` archive in memory. Verifies SHA-256 integrity, validates
 * the protocol with the existing Protocol Engine runtime validator (no second protocol schema), and
 * validates the GeoJSON assets. Throws `FieldPackValidationError` on any problem — no writes occur.
 */
export async function inspectFieldPack(bytes: Uint8Array): Promise<FieldPackInspection> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new FieldPackValidationError('The selected file is not a readable FieldPack (.fieldpack) archive.');
  }

  const names = Object.keys(files);
  for (const name of names) {
    if (unsafePath(name)) {
      throw new FieldPackValidationError(`FieldPack contains an unsafe or unexpected archive path: ${name}`);
    }
  }
  const totalBytes = names.reduce((sum, name) => sum + files[name]!.byteLength, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new FieldPackValidationError('FieldPack is larger than the supported size limit for v1.');
  }
  for (const required of [MANIFEST_PATH, PROTOCOL_PATH, ASSETS_PATH]) {
    if (!files[required]) throw new FieldPackValidationError(`FieldPack is missing ${required}.`);
  }

  let manifest;
  try {
    manifest = validateFieldPackManifest(JSON.parse(strFromU8(files[MANIFEST_PATH]!)));
  } catch (cause) {
    if (cause instanceof FieldPackValidationError) throw cause;
    throw new FieldPackValidationError(`${MANIFEST_PATH} is not valid JSON.`);
  }

  // Verify integrity BEFORE interpreting the payloads: exact payload bytes must match the manifest.
  for (const name of [PROTOCOL_PATH, ASSETS_PATH]) {
    const digest = await sha256Hex(files[name]!);
    if (digest !== manifest.integrity.files[name]) {
      throw new FieldPackValidationError(`FieldPack integrity verification failed for ${name}.`);
    }
  }

  // Protocol: validated by the shared Protocol Engine validator — no duplicated logic, and a
  // malformed or newer-than-supported protocol BLOCKS the import (never silently dropped).
  let protocol;
  try {
    protocol = validateProtocol(JSON.parse(strFromU8(files[PROTOCOL_PATH]!)));
  } catch (cause) {
    if (cause instanceof ProtocolValidationError) {
      throw new FieldPackValidationError(`FieldPack protocol is invalid: ${cause.message}`);
    }
    throw new FieldPackValidationError(`${PROTOCOL_PATH} is not valid JSON.`);
  }

  let assets;
  try {
    assets = parseFieldPackAssets(JSON.parse(strFromU8(files[ASSETS_PATH]!)));
  } catch (cause) {
    if (cause instanceof FieldPackValidationError) throw cause;
    throw new FieldPackValidationError(`${ASSETS_PATH} is not valid JSON.`);
  }

  const assetTypeBreakdown: Record<string, number> = {};
  for (const asset of assets) {
    const key = asset.assetType ?? 'unclassified';
    assetTypeBreakdown[key] = (assetTypeBreakdown[key] ?? 0) + 1;
  }

  return {
    manifest,
    protocol,
    assets,
    integrityStatus: 'VERIFIED',
    compatibility: 'SUPPORTED',
    assetTypeBreakdown,
    warnings: assets.length === 0 ? ['This FieldPack contains no planned assets.'] : [],
    collision: { kind: 'none' },
  };
}

/**
 * Check the conservative collision policy against locally installed campaigns, WITHOUT writing.
 * Same id + same version → duplicate (block). Same id + different version → unsupported upgrade
 * (block). v1 never reinstalls, merges, overwrites, or auto-upgrades a campaign.
 */
export async function preflightFieldPackImport(
  repos: Repositories,
  inspection: FieldPackInspection,
): Promise<FieldPackInspection> {
  const existing = await repos.findCampaignsByFieldpackId(inspection.manifest.fieldpackId);
  for (const campaign of existing) {
    if (campaign.source.type !== 'fieldpack') continue;
    if (campaign.source.fieldpackVersion === inspection.manifest.fieldpackVersion) {
      return { ...inspection, collision: { kind: 'duplicate', existingCampaignId: campaign.id } };
    }
  }
  if (existing.length > 0) {
    const other = existing[0]!;
    return {
      ...inspection,
      collision: {
        kind: 'unsupported_upgrade',
        existingCampaignId: other.id,
        existingVersion: other.source.type === 'fieldpack' ? other.source.fieldpackVersion : 0,
      },
    };
  }
  return { ...inspection, collision: { kind: 'none' } };
}

/**
 * Commit a preflighted FieldPack: mint fresh local UUIDs, build the immutable Campaign snapshot and
 * its preloaded assets, and install them ATOMICALLY. A pending collision is always rejected — never
 * merged, overwritten, or auto-upgraded.
 */
export async function installFieldPackImport(
  repos: Repositories,
  inspection: FieldPackInspection,
): Promise<FieldPackImportResult> {
  if (inspection.collision.kind === 'duplicate') {
    throw new FieldPackValidationError(
      'This FieldPack (same id and version) is already installed. Duplicate import is blocked.',
    );
  }
  if (inspection.collision.kind === 'unsupported_upgrade') {
    throw new FieldPackValidationError(
      'A campaign from this FieldPack id is already installed at a different version. Automatic upgrades are not supported in v1.',
    );
  }

  const ts = nowIso();
  const campaignId = newId();
  // Re-validate + deep-copy the protocol into the immutable campaign snapshot.
  const protocolSnapshot = validateProtocol(inspection.protocol);
  const campaign: FieldCampaign = {
    id: campaignId,
    schemaVersion: SCHEMA_VERSION,
    title: inspection.manifest.title,
    description: inspection.manifest.description,
    protocolSnapshot,
    createdAt: ts,
    importedAt: ts,
    source: {
      type: 'fieldpack',
      fieldpackId: inspection.manifest.fieldpackId,
      fieldpackVersion: inspection.manifest.fieldpackVersion,
    },
  };
  const assets: Asset[] = inspection.assets.map((spec) => ({
    id: newId(),
    schemaVersion: SCHEMA_VERSION,
    sessionId: null,
    campaignId,
    name: spec.name,
    assetType: spec.assetType,
    latitude: spec.latitude,
    longitude: spec.longitude,
    source: 'preloaded',
    sourceRef: spec.sourceRef,
    createdAt: ts,
    updatedAt: ts,
  }));

  await repos.installCampaign(campaign, assets);
  return {
    campaignId,
    title: campaign.title,
    fieldpackId: inspection.manifest.fieldpackId,
    fieldpackVersion: inspection.manifest.fieldpackVersion,
    assetCount: assets.length,
  };
}

/** Read a chosen file as a FieldPack and inspect it (in memory). */
export async function inspectFieldPackFile(file: File): Promise<FieldPackInspection> {
  return inspectFieldPack(new Uint8Array(await file.arrayBuffer()));
}
