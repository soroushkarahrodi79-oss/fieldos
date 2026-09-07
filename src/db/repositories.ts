import { FieldOsDb, db as defaultDb } from './db';
import { newId } from '../domain/ids';
import { nowIso } from '../domain/time';
import { normalizeCapturedLocation } from '../domain/geolocation';
import { buildAuditEntry, snapshotObservationForAudit } from './audit';
import { SCHEMA_VERSION } from '../version';
import { DEFAULT_PROTOCOL } from '../protocol/registry';
import { protocolForSession } from '../protocol/resolve';
import { ProtocolValidationError, validateObservationAgainstProtocol, validateProtocol } from '../protocol/validation';
import type { FieldProtocol } from '../protocol/types';
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

/**
 * A deterministic "this record does not exist" outcome — NOT a storage failure. It is thrown from
 * inside a transaction (so atomicity is preserved) but must reach callers as itself, never masked
 * as a `StoragePersistenceError`, whose meaning is reserved for genuine IndexedDB/write failures.
 */
export class ObservationNotFoundError extends Error {
  readonly observationId: Uuid;
  constructor(id: Uuid) {
    super(`Observation ${id} not found`);
    this.name = 'ObservationNotFoundError';
    this.observationId = id;
  }
}

/** A restore attempted to reuse an existing local identity. Nothing has been written. */
export class RestoreCollisionError extends Error {
  readonly ids: string[];
  constructor(ids: string[]) {
    super(`Restore blocked because ${ids.length} imported ID${ids.length === 1 ? '' : 's'} already exist locally.`);
    this.name = 'RestoreCollisionError';
    this.ids = ids;
  }
}

/** Domain-level outcomes that are correct answers, not persistence failures — passed through as-is. */
function isDomainError(cause: unknown): boolean {
  return (
    cause instanceof ObservationNotFoundError ||
    cause instanceof RestoreCollisionError ||
    // A protocol validation failure inside a transaction is a deterministic rejection, not a
    // storage failure. It still rolls the transaction back (nothing invalid is committed), but it
    // must reach the caller as itself so the UI can show the real reason.
    cause instanceof ProtocolValidationError
  );
}

/** Validated canonical records accepted only by the dedicated restore path. */
export interface RestoreRecords {
  session: FieldSession;
  assets: Asset[];
  observations: Observation[];
  auditEntries: ObservationAuditEntry[];
  media: MediaAttachment[];
}

async function persist<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    // Known domain errors (e.g. not-found) are legitimate outcomes, not storage failures — re-throw
    // them unchanged. Only actual IndexedDB/Dexie/write failures become a StoragePersistenceError,
    // so that type keeps meaning "the write did not persist". Never swallow either.
    if (isDomainError(cause)) throw cause;
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

/**
 * Present a session through today's deterministic domain shape. A session stored before Protocol
 * Engine v1 has no `protocolSnapshot` property; normalize it to explicit `null` on READ only —
 * the stored row is never rewritten, so historical absence stays historical absence.
 */
function normalizeSession(session: FieldSession): FieldSession {
  return { ...session, protocolSnapshot: session.protocolSnapshot ?? null };
}

// ---------------------------------------------------------------------------
// Input shapes (only the fields a caller supplies)
// ---------------------------------------------------------------------------

export interface CreateSessionInput {
  title: string;
  purpose?: string | null;
  observerName?: string | null;
  deviceLabel?: string | null;
  /**
   * Protocol to bind (immutably) to the new session. Defaults to the built-in Tourism Field
   * Observation Core. The definition is validated and deep-copied into the session snapshot, so
   * later changes to a registry protocol object can never alter historical sessions.
   */
  protocol?: FieldProtocol;
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
    // Validate + deep-copy the chosen (or default) protocol into an immutable snapshot. A malformed
    // protocol fails here, before anything is written — a session can never bind an invalid protocol.
    const protocolSnapshot = validateProtocol(input.protocol ?? DEFAULT_PROTOCOL);
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
      protocolSnapshot,
    };
    await persist('createSession', () => this.database.fieldSessions.add(session));
    return session;
  }

  async getSession(id: Uuid): Promise<FieldSession | undefined> {
    const session = await this.database.fieldSessions.get(id);
    return session ? normalizeSession(session) : undefined;
  }

  async listSessions(): Promise<FieldSession[]> {
    const rows = await this.database.fieldSessions.orderBy('createdAt').reverse().toArray();
    return rows.map(normalizeSession);
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
    // Correctness gate (Protocol Engine v1): the observation's category/value must belong to the
    // session's protocol, and a required-note policy must be honoured — validated against the
    // session's immutable snapshot (or the legacy vocabulary for a pre-Protocol-Engine session).
    // This throws a ProtocolValidationError before any write, so nothing invalid is persisted.
    const session = await this.getSession(input.sessionId);
    if (!session) throw new Error(`Session ${input.sessionId} not found`);
    const { protocol } = protocolForSession(session);
    validateObservationAgainstProtocol(protocol, {
      category: input.observation.category,
      value: input.observation.value,
      note: input.note ?? null,
    });

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
        this.database.fieldSessions,
        this.database.observations,
        this.database.observationAudit,
        async () => {
          const stored = await this.database.observations.get(id);
          const existing = stored ? normalizeObservation(stored) : undefined;
          if (!existing) throw new ObservationNotFoundError(id);

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
          // Re-validate the edited interpretation against the session's protocol (snapshot, or the
          // legacy vocabulary for a legacy session). A ProtocolValidationError rolls back the whole
          // transaction, so an edit can never persist an out-of-protocol category/value/note.
          const storedSession = await this.database.fieldSessions.get(existing.sessionId);
          const { protocol } = protocolForSession(storedSession ? normalizeSession(storedSession) : null);
          validateObservationAgainstProtocol(protocol, {
            category: updated.observation.category,
            value: updated.observation.value,
            note: updated.note,
          });
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
          if (!existing) throw new ObservationNotFoundError(id);

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
          if (!existing) throw new ObservationNotFoundError(id);
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

  // ---- Restore ----------------------------------------------------------

  /**
   * Check every imported identity against every FieldOS entity store. UUIDs are intentionally
   * never remapped: a collision blocks reconstruction rather than corrupting provenance.
   */
  async findRestoreCollisions(ids: readonly string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    const found = await Promise.all(unique.map(async (id) => {
      const rows = await Promise.all([
        this.database.fieldSessions.get(id), this.database.assets.get(id),
        this.database.observations.get(id), this.database.observationAudit.get(id),
        this.database.media.get(id),
      ]);
      return rows.some(Boolean) ? id : null;
    }));
    return found.filter((id): id is string => id !== null);
  }

  /**
   * Reconstruct externally validated evidence verbatim in one transaction. This deliberately
   * bypasses normal create APIs, which mint IDs/timestamps/audit events and would falsify history.
   */
  async restoreRecords(records: RestoreRecords): Promise<void> {
    const ids = [
      records.session.id,
      ...records.assets.map((item) => item.id),
      ...records.observations.map((item) => item.id),
      ...records.auditEntries.map((item) => item.id),
      ...records.media.map((item) => item.id),
    ];
    await persist('restore', () => this.database.transaction(
      'rw', this.database.fieldSessions, this.database.assets, this.database.observations,
      this.database.observationAudit, this.database.media,
      async () => {
        const collisions = await this.findRestoreCollisions(ids);
        if (collisions.length) throw new RestoreCollisionError(collisions);
        await this.database.fieldSessions.add(records.session);
        if (records.assets.length) await this.database.assets.bulkAdd(records.assets);
        if (records.observations.length) await this.database.observations.bulkAdd(records.observations);
        if (records.auditEntries.length) await this.database.observationAudit.bulkAdd(records.auditEntries);
        if (records.media.length) await this.database.media.bulkAdd(records.media);
      },
    ));
  }
}

/** The app-wide repositories bound to the shared database. */
export const repositories = new Repositories(defaultDb);
