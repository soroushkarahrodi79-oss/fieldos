// FieldPack import — preflight-first, atomic, offline.
//
// Flow (Campaign + FieldPack v1 §11): choose → parse ZIP safely → validate manifest → verify
// SHA-256 → validate protocol → validate GeoJSON assets → check identity/version collision →
// preview → confirm → atomic local installation. NOTHING is written before confirmation; the whole
// inspection runs in memory. A FieldPack is treated as UNTRUSTED input.

import { unzipSync, strFromU8 } from 'fflate';
import { CampaignFieldpackCollisionError, type Repositories } from '../db/repositories';
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
 * Enumerate EVERY entry filename in the ZIP central directory, INCLUDING duplicates. This is needed
 * because fflate's `unzipSync` returns a name→bytes object that silently collapses duplicate entries
 * (last one wins) — so a FieldPack carrying two `protocol.json` entries would look single and
 * unambiguous to `unzipSync` while actually being ambiguous. We read the raw central directory so
 * such duplicates can be detected and rejected before anything is trusted.
 *
 * Standard ZIP layout only (v1 FieldPacks are small JSON archives); a structure we cannot parse is
 * treated as an unreadable FieldPack rather than being trusted.
 */
function centralDirectoryNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const EOCD_SIG = 0x06054b50;
  const CDH_SIG = 0x02014b50;
  const EOCD_MIN = 22;
  // The End Of Central Directory record sits at the end (it may be followed by a variable-length
  // comment), so scan backwards for its signature.
  let eocd = -1;
  for (let i = bytes.length - EOCD_MIN; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new FieldPackValidationError('The selected file is not a readable FieldPack (.fieldpack) archive.');
  const totalEntries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const names: string[] = [];
  for (let n = 0; n < totalEntries; n++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CDH_SIG) {
      throw new FieldPackValidationError('The selected file is not a readable FieldPack (.fieldpack) archive.');
    }
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    names.push(strFromU8(bytes.subarray(offset + 46, offset + 46 + nameLen)));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** Reject a ZIP that carries the same archive path more than once (ambiguous / overwriting). */
function assertNoDuplicateEntries(bytes: Uint8Array): void {
  const counts = new Map<string, number>();
  for (const name of centralDirectoryNames(bytes)) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  if (duplicates.length) {
    throw new FieldPackValidationError(
      `FieldPack contains duplicate archive entries (${duplicates.join(', ')}), which is ambiguous and not accepted.`,
    );
  }
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

  // Detect duplicate archive entries BEFORE trusting the collapsed name→bytes object above: fflate
  // keeps only the last entry for a repeated name, so an ambiguous/overwriting pack must be rejected
  // here rather than silently resolving to whichever copy happened to come last.
  assertNoDuplicateEntries(bytes);

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
  // First-line rejection from the point-in-time preview (fast, user-facing feedback).
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

  // The invariant is ultimately enforced INSIDE this atomic install (re-checked against current
  // campaigns), so a stale/reused inspection whose `collision` still reads `none` is still rejected
  // here. Translate that transactional rejection into the import surface's error type for uniform
  // messaging.
  try {
    await repos.installCampaign(campaign, assets);
  } catch (cause) {
    if (cause instanceof CampaignFieldpackCollisionError) {
      throw new FieldPackValidationError(cause.message);
    }
    throw cause;
  }
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
