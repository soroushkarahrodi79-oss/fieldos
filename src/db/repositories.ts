import { FieldOsDb, db as defaultDb } from './db';
import { newId } from '../domain/ids';
import { nowIso } from '../domain/time';
import { normalizeCapturedLocation } from '../domain/geolocation';
import { buildAuditEntry, snapshotObservationForAudit } from './audit';
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
  ObservationAuditEntry,
  ObservationAuditEventType,
  ObservationAuditState,
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
    // The observation row and its CREATED audit entry (sequence 1) are written in ONE
    // transaction: if either fails, neither commits — no observation without its origin event,
    // and no audit entry without its observation.
    await persist('createObservation', () =>
      this.database.transaction(
        'rw',
        this.database.observations,
        this.database.observationAudit,
        async () => {
          await this.database.observations.add(observation);
          await this.appendAuditEntry(observation, 'CREATED', null, ts);
        },
      ),
    );
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
    // Read-modify-write and the audit append run inside ONE transaction so the persisted
    // observation and its INTERPRETATION_UPDATED entry are atomic.
    return persist('updateInterpretation', () =>
      this.database.transaction(
        'rw',
        this.database.observations,
        this.database.observationAudit,
        async () => {
          const stored = await this.database.observations.get(id);
          const existing = stored ? normalizeObservation(stored) : undefined;
          if (!existing) throw new Error(`Observation ${id} not found`);

          const before = snapshotObservationForAudit(existing);
          const updated: Observation = {
            // Immutable identity + capture block, copied verbatim.
            id: existing.id,
            schemaVersion: SCHEMA_VERSION,
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
          await this.database.observations.put(updated);
          await this.appendAuditEntry(updated, 'INTERPRETATION_UPDATED', before, updated.updatedAt);
          return updated;
        },
      ),
    );
  }

  /**
   * Non-destructive location correction (correction §4): writes a SEPARATE locationAdjustment.
   * The original capturedLocation is preserved untouched.
   */
  async adjustLocation(
    id: Uuid,
    adjustment: { latitude: number; longitude: number; reason?: string | null },
  ): Promise<Observation> {
    return persist('adjustLocation', () =>
      this.database.transaction(
        'rw',
        this.database.observations,
        this.database.observationAudit,
        async () => {
          const stored = await this.database.observations.get(id);
          const existing = stored ? normalizeObservation(stored) : undefined;
          if (!existing) throw new Error(`Observation ${id} not found`);

          // `before` retains the PREVIOUS adjustment (possibly null, or an earlier correction).
          // Re-adjusting therefore preserves the full A → B history across successive corrections.
          const before = snapshotObservationForAudit(existing);
          const ts = nowIso();
          const updated: Observation = {
            ...existing,
            schemaVersion: SCHEMA_VERSION,
            // capturedLocation is intentionally NOT touched.
            locationAdjustment: {
              latitude: adjustment.latitude,
              longitude: adjustment.longitude,
              locationAdjustedAt: ts,
              locationAdjustmentReason: adjustment.reason ?? null,
            },
            updatedAt: ts,
            editCount: existing.editCount + 1,
            edited: true,
          };
          await this.database.observations.put(updated);
          await this.appendAuditEntry(updated, 'LOCATION_ADJUSTED', before, ts);
          return updated;
        },
      ),
    );
  }

  /** Soft-delete — recoverable, never a hard delete in the field. */
  async softDeleteObservation(id: Uuid): Promise<void> {
    await this.setDeletedFlag(id, true, 'softDeleteObservation', 'SOFT_DELETED');
  }

  async restoreObservation(id: Uuid): Promise<void> {
    await this.setDeletedFlag(id, false, 'restoreObservation', 'RESTORED');
  }

  /**
   * Shared soft-delete/restore path. Idempotent: if the observation is already in the target
   * state this is a no-op that writes nothing — no fake duplicate SOFT_DELETED/RESTORED event.
   * `editCount`/`edited` are deliberately left untouched (delete/restore have never counted as
   * interpretation edits); only `deleted` and `updatedAt` change, mirrored into the audit log.
   */
  private async setDeletedFlag(
    id: Uuid,
    deleted: boolean,
    operation: string,
    eventType: ObservationAuditEventType,
  ): Promise<void> {
    await persist(operation, () =>
      this.database.transaction(
        'rw',
        this.database.observations,
        this.database.observationAudit,
        async () => {
          const stored = await this.database.observations.get(id);
          const existing = stored ? normalizeObservation(stored) : undefined;
          if (!existing) throw new Error(`Observation ${id} not found`);
          if (existing.deleted === deleted) return; // no-op — nothing to record.

          const before = snapshotObservationForAudit(existing);
          const ts = nowIso();
          const updated: Observation = {
            ...existing,
            schemaVersion: SCHEMA_VERSION,
            deleted,
            updatedAt: ts,
          };
          await this.database.observations.put(updated);
          await this.appendAuditEntry(updated, eventType, before, ts);
        },
      ),
    );
  }

  // ---- Audit / revision history ------------------------------------------

  /**
   * Append one audit entry for an observation. MUST be called inside an active read-write
   * transaction that already includes both `observations` and `observationAudit`, so the entry
   * commits atomically with the observation write that produced it. Private on purpose: audit
   * entries are only ever created by legitimate observation mutations, never by callers/UI.
   */
  private async appendAuditEntry(
    observation: Observation,
    eventType: ObservationAuditEventType,
    before: ObservationAuditState | null,
    occurredAt: IsoTimestamp,
  ): Promise<void> {
    const sequence = await this.nextAuditSequence(observation.id);
    const entry = buildAuditEntry({
      observationId: observation.id,
      sessionId: observation.sessionId,
      sequence,
      eventType,
      occurredAt,
      before,
      after: snapshotObservationForAudit(observation),
    });
    await this.database.observationAudit.add(entry);
  }

  /**
   * The next monotonic per-observation sequence (1, 2, 3, …). Because the log is append-only with
   * no deletions, taking max(existing) + 1 is gap-free; reading only this observation's few entries
   * keeps it cheap. Runs inside the caller's transaction, so it sees uncommitted prior appends.
   */
  private async nextAuditSequence(observationId: Uuid): Promise<number> {
    const existing = await this.database.observationAudit
      .where('observationId')
      .equals(observationId)
      .toArray();
    return existing.reduce((max, entry) => Math.max(max, entry.sequence), 0) + 1;
  }

  /** Read-only revision history for one observation, ordered by sequence (1 → N). */
  async listObservationAuditEntries(observationId: Uuid): Promise<ObservationAuditEntry[]> {
    const rows = await this.database.observationAudit
      .where('observationId')
      .equals(observationId)
      .toArray();
    return rows.sort((a, b) => a.sequence - b.sequence);
  }

  /**
   * Read-only revision history for an entire session — needed for export. Ordered deterministically
   * (chronological, then by observation, then by sequence) so serialization is stable.
   */
  async listSessionAuditEntries(sessionId: Uuid): Promise<ObservationAuditEntry[]> {
    const rows = await this.database.observationAudit
      .where('sessionId')
      .equals(sessionId)
      .toArray();
    return rows.sort((a, b) => {
      if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
      if (a.observationId !== b.observationId) return a.observationId < b.observationId ? -1 : 1;
      return a.sequence - b.sequence;
    });
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
