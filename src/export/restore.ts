import { unzipSync, strFromU8 } from 'fflate';
import type { Repositories } from '../db/repositories';
import { RestoreCollisionError } from '../db/repositories';
import { normalizeCapturedLocation } from '../domain/geolocation';
import type { MediaAttachment } from '../domain/types';
import { SCHEMA_VERSION } from '../version';
import { ProtocolValidationError, validateProtocol } from '../protocol/validation';
import { sha256Hex, type BackupManifest } from './backup';
import type { MediaMetadata, SessionBundle } from './types';

export type BackupIntegrityStatus = 'VERIFIED' | 'LEGACY_UNVERIFIED' | 'INVALID';
export type RestoreSource = 'FULL_BACKUP' | 'DATA_ONLY_JSON';

export class RestoreValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreValidationError';
  }
}

export interface RestoreInspection {
  source: RestoreSource;
  bundle: SessionBundle;
  /** Present only for a complete ZIP backup; never manufactured for JSON-only imports. */
  media: MediaAttachment[];
  integrityStatus: BackupIntegrityStatus;
  compatibility: 'SUPPORTED' | 'UNSUPPORTED_NEWER_SCHEMA';
  warnings: string[];
  collisions: string[];
  manifest: BackupManifest | null;
}

export interface RestoreResult {
  outcome: 'RESTORED_FULL' | 'RESTORED_WITHOUT_MEDIA';
  sessionId: string;
  integrityStatus: BackupIntegrityStatus;
  observationCount: number;
  mediaCount: number;
}

const fixedPayloadNames = new Set(['observations.json', 'observations.csv', 'observations.geojson']);

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RestoreValidationError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new RestoreValidationError(`${label} must be an array.`);
  return value;
}
function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new RestoreValidationError(`${label} must be a non-empty string.`);
  return value;
}
function timestamp(value: unknown, label: string): void { nonEmptyString(value, label); }
function finiteNumber(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RestoreValidationError(`${label} must be a finite number.`);
}
function safeMediaPath(path: string): boolean {
  return /^media\/[A-Za-z0-9_-]+_[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(path) && !path.includes('..') && !path.startsWith('/');
}

function validateBundle(raw: unknown): SessionBundle {
  const bundle = object(raw, 'Session bundle');
  const schema = bundle.fieldosSchemaVersion;
  if (!Number.isInteger(schema) || (schema as number) < 1) throw new RestoreValidationError('Session bundle has an invalid FieldOS schema version.');
  if ((schema as number) > SCHEMA_VERSION) throw new RestoreValidationError('This backup was created by a newer FieldOS schema and cannot be restored by this version.');
  nonEmptyString(bundle.appVersion, 'Bundle appVersion'); timestamp(bundle.exportedAt, 'Bundle exportedAt');
  const session = object(bundle.session, 'Session');
  nonEmptyString(session.id, 'Session ID'); nonEmptyString(session.title, 'Session title'); timestamp(session.createdAt, 'Session createdAt'); timestamp(session.updatedAt, 'Session updatedAt');
  if (session.closedAt !== null && typeof session.closedAt !== 'string') throw new RestoreValidationError('Session closedAt must be a string or null.');
  if (session.status !== 'active' && session.status !== 'closed') throw new RestoreValidationError('Session status is invalid.');
  // Protocol snapshot (Protocol Engine v1): validate its STRUCTURE before any DB write. A malformed
  // or unsupported-newer protocol BLOCKS the restore — we never discard the snapshot and proceed,
  // and never silently lose semantics. Absent/null is a valid legacy session; normalize to null.
  if (session.protocolSnapshot === undefined || session.protocolSnapshot === null) {
    session.protocolSnapshot = null;
  } else {
    try {
      session.protocolSnapshot = validateProtocol(session.protocolSnapshot);
    } catch (cause) {
      const detail = cause instanceof ProtocolValidationError ? cause.message : String(cause);
      throw new RestoreValidationError(`Session protocol snapshot is invalid: ${detail}`);
    }
  }
  // Campaign link (Campaign + FieldPack v1). A campaign-bound session restores self-contained even
  // when its Campaign is absent locally — the campaignId is retained as historical reference and no
  // Campaign entity is ever fabricated from it (§21).
  if (session.campaignId !== undefined && session.campaignId !== null && typeof session.campaignId !== 'string') {
    throw new RestoreValidationError('Session campaignId must be a string or null.');
  }
  session.campaignId = session.campaignId ?? null;
  const assets = array(bundle.assets, 'Assets').map((item, index) => {
    const asset = object(item, `Asset ${index}`); nonEmptyString(asset.id, `Asset ${index} ID`);
    // An asset either belongs to this session (session-dropped) OR is a campaign asset referenced by
    // the session's observations (sessionId null + a campaignId). Anything else does not belong.
    const isSessionAsset = asset.sessionId === session.id;
    const isCampaignAsset =
      (asset.sessionId === null || asset.sessionId === undefined) &&
      typeof asset.campaignId === 'string' && asset.campaignId.trim() !== '';
    if (!isSessionAsset && !isCampaignAsset) {
      throw new RestoreValidationError(`Asset ${asset.id} does not belong to the imported session or its campaign.`);
    }
    nonEmptyString(asset.name, `Asset ${asset.id} name`); timestamp(asset.createdAt, `Asset ${asset.id} createdAt`); timestamp(asset.updatedAt, `Asset ${asset.id} updatedAt`);
    return asset;
  });
  const assetIds = new Set(assets.map((asset) => asset.id as string));
  const observations: Record<string, unknown>[] = array(bundle.observations, 'Observations').map((item, index) => {
    const observation = object(item, `Observation ${index}`); const id = nonEmptyString(observation.id, `Observation ${index} ID`);
    if (observation.sessionId !== session.id) throw new RestoreValidationError(`Observation ${id} does not belong to the imported session.`);
    if (observation.assetId !== null && !assetIds.has(observation.assetId as string)) throw new RestoreValidationError(`Observation ${id} references an unavailable asset.`);
    timestamp(observation.capturedAt, `Observation ${id} capturedAt`); timestamp(observation.createdAt, `Observation ${id} createdAt`); timestamp(observation.updatedAt, `Observation ${id} updatedAt`);
    const location = object(observation.capturedLocation, `Observation ${id} capturedLocation`);
    if (!['CAPTURED', 'DENIED', 'UNAVAILABLE', 'TIMEOUT'].includes(location.locationStatus as string)) throw new RestoreValidationError(`Observation ${id} has an invalid location status.`);
    timestamp(location.capturedAt, `Observation ${id} capturedLocation.capturedAt`);
    if (location.latitude !== null) finiteNumber(location.latitude, `Observation ${id} latitude`);
    if (location.longitude !== null) finiteNumber(location.longitude, `Observation ${id} longitude`);
    if (location.locationStatus === 'CAPTURED' && (location.latitude === null || location.longitude === null)) throw new RestoreValidationError(`Observation ${id} has a captured location without coordinates.`);
    if (!Number.isInteger(observation.editCount) || (observation.editCount as number) < 0 || typeof observation.edited !== 'boolean' || typeof observation.deleted !== 'boolean') throw new RestoreValidationError(`Observation ${id} has invalid edit state.`);
    object(observation.observation, `Observation ${id} value`); object(observation.evidence, `Observation ${id} evidence`);
    return { ...observation, capturedLocation: normalizeCapturedLocation(location as never) } as Record<string, unknown>;
  });
  const observationIds = new Set(observations.map((observation) => observation.id as string));
  const media: Record<string, unknown>[] = array(bundle.media, 'Media').map((item, index) => {
    const entry = object(item, `Media ${index}`); const id = nonEmptyString(entry.id, `Media ${index} ID`);
    if (!observationIds.has(entry.observationId as string)) throw new RestoreValidationError(`Media ${id} references an unavailable observation.`);
    const path = nonEmptyString(entry.backupFilename, `Media ${id} backup path`);
    if (!safeMediaPath(path)) throw new RestoreValidationError(`Media ${id} has an unsafe backup path.`);
    timestamp(entry.capturedAt, `Media ${id} capturedAt`); timestamp(entry.createdAt, `Media ${id} createdAt`); nonEmptyString(entry.mimeType, `Media ${id} mime type`); finiteNumber(entry.byteSize, `Media ${id} byte size`);
    return entry;
  });
  const paths = media.map((item) => item.backupFilename as string);
  if (new Set(paths).size !== paths.length) throw new RestoreValidationError('Media backup paths must be unique.');
  const auditRaw = bundle.auditEntries === undefined && (schema as number) <= 2 ? [] : array(bundle.auditEntries, 'Audit entries');
  const seenSequences = new Set<string>();
  const auditEntries: Record<string, unknown>[] = auditRaw.map((item, index) => {
    const entry = object(item, `Audit entry ${index}`); const id = nonEmptyString(entry.id, `Audit entry ${index} ID`);
    if (!observationIds.has(entry.observationId as string) || entry.sessionId !== session.id) throw new RestoreValidationError(`Audit entry ${id} has an invalid observation or session reference.`);
    if (!Number.isInteger(entry.sequence) || (entry.sequence as number) < 1) throw new RestoreValidationError(`Audit entry ${id} has an invalid sequence.`);
    const key = `${entry.observationId}:${entry.sequence}`;
    if (seenSequences.has(key)) throw new RestoreValidationError(`Audit entry ${id} duplicates an observation audit sequence.`);
    seenSequences.add(key); timestamp(entry.occurredAt, `Audit entry ${id} occurredAt`); object(entry.after, `Audit entry ${id} after`);
    return entry;
  });
  // Campaign context is additive mission provenance; validate its shape if present, normalize a
  // missing/null value to null, and never fabricate a Campaign from it.
  let campaignContext: SessionBundle['campaignContext'] = null;
  if (bundle.campaignContext !== undefined && bundle.campaignContext !== null) {
    const context = object(bundle.campaignContext, 'Campaign context');
    const campaignId = nonEmptyString(context.campaignId, 'Campaign context campaignId');
    const title = nonEmptyString(context.title, 'Campaign context title');
    if (context.sourceFieldpackId !== null && typeof context.sourceFieldpackId !== 'string') throw new RestoreValidationError('Campaign context sourceFieldpackId must be a string or null.');
    if (context.sourceFieldpackVersion !== null && !Number.isInteger(context.sourceFieldpackVersion)) throw new RestoreValidationError('Campaign context sourceFieldpackVersion must be an integer or null.');
    campaignContext = {
      campaignId,
      title,
      sourceFieldpackId: (context.sourceFieldpackId as string | null) ?? null,
      sourceFieldpackVersion: (context.sourceFieldpackVersion as number | null) ?? null,
    };
  }
  const allIds = [session.id as string, ...assets.map((x) => x.id as string), ...observations.map((x) => x.id as string), ...media.map((x) => x.id as string), ...auditEntries.map((x) => x.id as string)];
  if (new Set(allIds).size !== allIds.length) throw new RestoreValidationError('Imported identities must be globally unique.');
  return {
    fieldosSchemaVersion: schema as number,
    appVersion: bundle.appVersion as string,
    exportedAt: bundle.exportedAt as string,
    session: session as unknown as SessionBundle['session'],
    assets: assets as unknown as SessionBundle['assets'],
    observations: observations as unknown as SessionBundle['observations'],
    media: media as unknown as MediaMetadata[],
    auditEntries: auditEntries as unknown as SessionBundle['auditEntries'],
    campaignContext,
  };
}

function manifest(raw: unknown): BackupManifest {
  const value = object(raw, 'Backup manifest');
  nonEmptyString(value.sessionId, 'Manifest session ID'); nonEmptyString(value.exportedAt, 'Manifest exportedAt'); nonEmptyString(value.appVersion, 'Manifest appVersion');
  for (const name of ['fieldosSchemaVersion', 'observationCount', 'mediaCount', 'auditEntryCount']) if (!Number.isInteger(value[name]) || (value[name] as number) < 0) throw new RestoreValidationError(`Manifest ${name} is invalid.`);
  if ((value.fieldosSchemaVersion as number) > SCHEMA_VERSION) throw new RestoreValidationError('This backup was created by a newer FieldOS schema and cannot be restored by this version.');
  if (value.integrity !== undefined) {
    const integrity = object(value.integrity, 'Manifest integrity');
    if (integrity.algorithm !== 'SHA-256') throw new RestoreValidationError('Manifest integrity algorithm is unsupported.');
    const files = object(integrity.files, 'Manifest integrity files');
    for (const [name, hash] of Object.entries(files)) if (!safeMediaPath(name) && !fixedPayloadNames.has(name) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new RestoreValidationError('Manifest integrity hashes are invalid.');
  }
  return value as unknown as BackupManifest;
}

function baseInspection(source: RestoreSource, bundle: SessionBundle, media: MediaAttachment[], integrityStatus: BackupIntegrityStatus, warnings: string[], backupManifest: BackupManifest | null): RestoreInspection {
  return { source, bundle, media, integrityStatus, compatibility: 'SUPPORTED', warnings, collisions: [], manifest: backupManifest };
}

/** Inspect a canonical JSON export without writing any local data. */
export function inspectSessionJson(textValue: string): RestoreInspection {
  let raw: unknown;
  try { raw = JSON.parse(textValue); } catch { throw new RestoreValidationError('The selected JSON is not valid JSON.'); }
  const bundle = validateBundle(raw);
  const warnings = bundle.media.length ? [`Structured evidence can be restored, but ${bundle.media.length} media attachment${bundle.media.length === 1 ? '' : 's'} are unavailable because this is a data-only JSON export.`] : [];
  return baseInspection('DATA_ONLY_JSON', bundle, [], 'LEGACY_UNVERIFIED', warnings, null);
}

/** Inspect and verify a full FieldOS ZIP backup entirely in memory, before any database write. */
export async function inspectFullBackup(bytes: Uint8Array): Promise<RestoreInspection> {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new RestoreValidationError('The selected file is not a readable FieldOS ZIP backup.'); }
  const names = Object.keys(files);
  if (names.some((name) => name.includes('..') || name.startsWith('/') || (!fixedPayloadNames.has(name) && name !== 'manifest.json' && !safeMediaPath(name)))) throw new RestoreValidationError('Backup contains an unsafe or unexpected archive path.');
  if (!files['manifest.json']) throw new RestoreValidationError('Backup is missing manifest.json.');
  if (!files['observations.json']) throw new RestoreValidationError('Backup is missing observations.json.');
  let backupManifest: BackupManifest;
  try { backupManifest = manifest(JSON.parse(strFromU8(files['manifest.json']!))); } catch (cause) { if (cause instanceof RestoreValidationError) throw cause; throw new RestoreValidationError('Backup manifest.json is not valid JSON.'); }
  let rawBundle: unknown;
  try { rawBundle = JSON.parse(strFromU8(files['observations.json']!)); } catch { throw new RestoreValidationError('Backup observations.json is not valid JSON.'); }
  const bundle = validateBundle(rawBundle);
  if (backupManifest.sessionId !== bundle.session.id) throw new RestoreValidationError('Backup manifest session ID does not match observations.json.');
  if (backupManifest.fieldosSchemaVersion !== bundle.fieldosSchemaVersion || backupManifest.observationCount !== bundle.observations.length || backupManifest.mediaCount !== bundle.media.length || backupManifest.auditEntryCount !== bundle.auditEntries.length) throw new RestoreValidationError('Backup manifest counts or schema do not match the canonical data.');
  const integrity = backupManifest.integrity;
  if (integrity) {
    const payloadNames = names.filter((name) => name !== 'manifest.json').sort();
    const hashNames = Object.keys(integrity.files).sort();
    if (payloadNames.join('\u0000') !== hashNames.join('\u0000')) throw new RestoreValidationError('Backup integrity file list does not match archive payloads.');
    for (const name of payloadNames) if (await sha256Hex(files[name]!) !== integrity.files[name]) throw new RestoreValidationError(`Backup integrity verification failed for ${name}.`);
  }
  const media: MediaAttachment[] = bundle.media.map((entry) => {
    const payload = files[entry.backupFilename];
    if (!payload) throw new RestoreValidationError(`Backup is missing media payload ${entry.backupFilename}.`);
    if (payload.byteLength !== entry.byteSize) throw new RestoreValidationError(`Media payload size does not match metadata for ${entry.id}.`);
    const blobBytes = new ArrayBuffer(payload.byteLength);
    new Uint8Array(blobBytes).set(payload);
    return { id: entry.id, schemaVersion: entry.schemaVersion, observationId: entry.observationId, kind: entry.kind, mimeType: entry.mimeType, byteSize: entry.byteSize, capturedAt: entry.capturedAt, originalFilename: entry.originalFilename, createdAt: entry.createdAt, blob: new Blob([blobBytes], { type: entry.mimeType }) };
  });
  return baseInspection('FULL_BACKUP', bundle, media, integrity ? 'VERIFIED' : 'LEGACY_UNVERIFIED', integrity ? [] : ['This backup predates SHA-256 payload integrity metadata, so its integrity could not be cryptographically verified.'], backupManifest);
}

/** Preflight collision status after structural/integrity validation, still without mutation. */
export async function preflightRestore(repos: Repositories, inspection: RestoreInspection): Promise<RestoreInspection> {
  const ids = [inspection.bundle.session.id, ...inspection.bundle.assets.map((item) => item.id), ...inspection.bundle.observations.map((item) => item.id), ...inspection.bundle.auditEntries.map((item) => item.id), ...inspection.media.map((item) => item.id)];
  return { ...inspection, collisions: await repos.findRestoreCollisions(ids) };
}

/** Commit a preflighted restore atomically. A collision is always rejected, never merged/remapped. */
export async function restoreInspection(repos: Repositories, inspection: RestoreInspection): Promise<RestoreResult> {
  if (inspection.collisions.length) throw new RestoreCollisionError(inspection.collisions);
  await repos.restoreRecords({ session: inspection.bundle.session, assets: inspection.bundle.assets, observations: inspection.bundle.observations, auditEntries: inspection.bundle.auditEntries, media: inspection.media });
  return { outcome: inspection.source === 'FULL_BACKUP' ? 'RESTORED_FULL' : 'RESTORED_WITHOUT_MEDIA', sessionId: inspection.bundle.session.id, integrityStatus: inspection.integrityStatus, observationCount: inspection.bundle.observations.length, mediaCount: inspection.media.length };
}

/** Choose the deliberate full-backup or data-only path from the selected filename. */
export async function inspectRestoreFile(file: File): Promise<RestoreInspection> {
  if (file.name.toLowerCase().endsWith('.zip')) return inspectFullBackup(new Uint8Array(await file.arrayBuffer()));
  return inspectSessionJson(await file.text());
}
