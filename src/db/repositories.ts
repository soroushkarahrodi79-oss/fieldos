import { FieldOsDb, db as defaultDb } from './db';
import { newId } from '../domain/ids';
import { nowIso } from '../domain/time';
import { normalizeCapturedLocation } from '../domain/geolocation';
import { SCHEMA_VERSION } from '../version';
import type {
  Asset,
  AssetSource,
  AssetType,
  CapturedLocation,
  Evidence,
  FieldSession,
  IsoTimestamp,
  MediaAttachment,
  MediaKind,
  Observation,
  ObservationInterpretationPatch,
  ObservationValue,
  Uuid,
} from '../domain/types';

/**
 * Thrown when a write fails to persist (e.g. QuotaExceededError). The point of this type is
 * that persistence failures are NEVER swallowed and NEVER reported as success — callers and
 * the UI must react to it. (Engineering rule: no silent persistence failures.)
 */
export class StoragePersistenceError extends Error {
  override readonly cause: unknown;
  constructor(operation: string, cause: unknown) {
    super(`FieldOS could not persist data (${operation}). Data was NOT saved.`);
    this.name = 'StoragePersistenceError';
    this.cause = cause;
  }
}

async function persist<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    // Surface, never swallow. The record is not saved.
    throw new StoragePersistenceError(operation, cause);
  }
}

/** Present old IndexedDB observations through today's deterministic domain shape. */
function normalizeObservation(observation: Observation): Observation {
  return {
    ...observation,
    capturedLocation: normalizeCapturedLocation(observation.capturedLocation),
  };
}

// ---------------------------------------------------------------------------
// Input shapes (only the fields a caller supplies)
// ---------------------------------------------------------------------------

export interface CreateSessionInput {
  title: string;
  purpose?: string | null;
  observerName?: string | null;
  deviceLabel?: string | null;
}

export interface CreateAssetInput {
  name: string;
  sessionId?: Uuid | null;
  assetType?: AssetType | null;
  latitude?: number | null;
  longitude?: number | null;
  source?: AssetSource;
}

export interface CreateObservationInput {
  sessionId: Uuid;
  capturedLocation: CapturedLocation;
  observation: ObservationValue;
  evidence: Evidence;
  assetId?: Uuid | null;
  note?: string | null;
  /** When the thing was observed. Defaults to now. Never regenerated later. */
  capturedAt?: IsoTimestamp;
}

export interface AddMediaInput {
  observationId: Uuid;
  kind: MediaKind;
  blob: Blob;
  mimeType: string;
  originalFilename?: string | null;
  capturedAt?: IsoTimestamp;
}

/**
 * All data-access for FieldOS. Instantiated against a specific database so tests can run
 * against isolated in-memory instances.
 */
export class Repositories {
  constructor(private readonly database: FieldOsDb) {}

  // ---- Sessions ----------------------------------------------------------

  async createSession(input: CreateSessionInput): Promise<FieldSession> {
    const ts = nowIso();
    const session: FieldSession = {
      id: newId(),
      schemaVersion: SCHEMA_VERSION,
      title: input.title,
      purpose: input.purpose ?? null,
      observerName: input.observerName ?? null,
      status: 'active',
      createdAt: ts,
      closedAt: null,
      updatedAt: ts,
      deviceLabel: input.deviceLabel ?? null,
    };
    await persist('createSession', () => this.database.fieldSessions.add(session));
    return session;
  }

  getSession(id: Uuid): Promise<FieldSession | undefined> {
    return this.database.fieldSessions.get(id);
  }

  listSessions(): Promise<FieldSession[]> {
    return this.database.fieldSessions.orderBy('createdAt').reverse().toArray();
  }

  async closeSession(id: Uuid): Promise<void> {
    const ts = nowIso();
    const updated = await persist('closeSession', () =>
      this.database.fieldSessions.update(id, { status: 'closed', closedAt: ts, updatedAt: ts }),
    );
    if (updated === 0) throw new Error(`Session ${id} not found`);
  }

  // ---- Assets ------------------------------------------------------------

  async createAsset(input: CreateAssetInput): Promise<Asset> {
    const ts = nowIso();
    const asset: Asset = {
      id: newId(),
      schemaVersion: SCHEMA_VERSION,
      sessionId: input.sessionId ?? null,
      name: input.name,
      assetType: input.assetType ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      source: input.source ?? 'field_created',
      createdAt: ts,
      updatedAt: ts,
    };
    await persist('createAsset', () => this.database.assets.add(asset));
    return asset;
  }

  getAsset(id: Uuid): Promise<Asset | undefined> {
    return this.database.assets.get(id);
  }

  listAssets(sessionId?: Uuid): Promise<Asset[]> {
    if (sessionId === undefined) return this.database.assets.toArray();
    return this.database.assets.where('sessionId').equals(sessionId).toArray();
  }

  // ---- Observations ------------------------------------------------------

  async createObservation(input: CreateObservationInput): Promise<Observation> {
    const ts = nowIso();
    const observation: Observation = {
      id: newId(),
      schemaVersion: SCHEMA_VERSION,
      sessionId: input.sessionId,
      assetId: input.assetId ?? null,
      // Capture block — written once, never mutated after this.
      capturedAt: input.capturedAt ?? ts,
      capturedLocation: normalizeCapturedLocation(input.capturedLocation),
      // Interpretation block.
      observation: input.observation,
      evidence: input.evidence,
      note: input.note ?? null,
      locationAdjustment: null,
      // Bookkeeping.
      createdAt: ts,
      updatedAt: ts,
      editCount: 0,
      edited: false,
      deleted: false,
    };
    await persist('createObservation', () => this.database.observations.add(observation));
    return observation;
  }

  async getObservation(id: Uuid): Promise<Observation | undefined> {
    const observation = await this.database.observations.get(id);
    return observation ? normalizeObservation(observation) : undefined;
  }

  /** Live (non-deleted) observations in a session, newest first. */
  async listObservations(
    sessionId: Uuid,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<Observation[]> {
    const rows = await this.database.observations
      .where('sessionId')
      .equals(sessionId)
      .toArray();
    const normalized = rows.map(normalizeObservation);
    const filtered = opts.includeDeleted ? normalized : normalized.filter((o) => !o.deleted);
    return filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /**
   * Edit ONLY the interpretation block. The capture block (capturedAt, capturedLocation) and
   * createdAt are reconstructed from the existing record and can never change here.
   */
  async updateInterpretation(
    id: Uuid,
    patch: ObservationInterpretationPatch,
  ): Promise<Observation> {
    const stored = await this.database.observations.get(id);
    const existing = stored ? normalizeObservation(stored) : undefined;
    if (!existing) throw new Error(`Observation ${id} not found`);

    const updated: Observation = {
      // Immutable identity + capture block, copied verbatim.
      id: existing.id,
      schemaVersion: existing.schemaVersion,
      sessionId: existing.sessionId,
      capturedAt: existing.capturedAt,
      capturedLocation: existing.capturedLocation,
      createdAt: existing.createdAt,
      locationAdjustment: existing.locationAdjustment,
      deleted: existing.deleted,
      // Interpretation fields — patched if provided, else preserved.
      assetId: patch.assetId !== undefined ? patch.assetId : existing.assetId,
      observation: patch.observation ?? existing.observation,
      evidence: patch.evidence ?? existing.evidence,
      note: patch.note !== undefined ? patch.note : existing.note,
      // Bookkeeping.
      updatedAt: nowIso(),
      editCount: existing.editCount + 1,
      edited: true,
    };
    await persist('updateInterpretation', () => this.database.observations.put(updated));
    return updated;
  }

  /**
   * Non-destructive location correction (correction §4): writes a SEPARATE locationAdjustment.
   * The original capturedLocation is preserved untouched.
   */
  async adjustLocation(
    id: Uuid,
    adjustment: { latitude: number; longitude: number; reason?: string | null },
  ): Promise<Observation> {
    const stored = await this.database.observations.get(id);
    const existing = stored ? normalizeObservation(stored) : undefined;
    if (!existing) throw new Error(`Observation ${id} not found`);

    const updated: Observation = {
      ...existing,
      // capturedLocation is intentionally NOT touched.
      locationAdjustment: {
        latitude: adjustment.latitude,
        longitude: adjustment.longitude,
        locationAdjustedAt: nowIso(),
        locationAdjustmentReason: adjustment.reason ?? null,
      },
      updatedAt: nowIso(),
      editCount: existing.editCount + 1,
      edited: true,
    };
    await persist('adjustLocation', () => this.database.observations.put(updated));
    return updated;
  }

  /** Soft-delete — recoverable, never a hard delete in the field. */
  async softDeleteObservation(id: Uuid): Promise<void> {
    const updated = await persist('softDeleteObservation', () =>
      this.database.observations.update(id, { deleted: true, updatedAt: nowIso() }),
    );
    if (updated === 0) throw new Error(`Observation ${id} not found`);
  }

  async restoreObservation(id: Uuid): Promise<void> {
    const updated = await persist('restoreObservation', () =>
      this.database.observations.update(id, { deleted: false, updatedAt: nowIso() }),
    );
    if (updated === 0) throw new Error(`Observation ${id} not found`);
  }

  // ---- Media -------------------------------------------------------------

  async addMedia(input: AddMediaInput): Promise<MediaAttachment> {
    const ts = nowIso();
    const media: MediaAttachment = {
      id: newId(),
      schemaVersion: SCHEMA_VERSION,
      observationId: input.observationId,
      kind: input.kind,
      blob: input.blob,
      mimeType: input.mimeType,
      byteSize: input.blob.size,
      capturedAt: input.capturedAt ?? ts,
      originalFilename: input.originalFilename ?? null,
      createdAt: ts,
    };
    await persist('addMedia', () => this.database.media.add(media));
    return media;
  }

  listMedia(observationId: Uuid): Promise<MediaAttachment[]> {
    return this.database.media.where('observationId').equals(observationId).toArray();
  }
}

/** The app-wide repositories bound to the shared database. */
export const repositories = new Repositories(defaultDb);
