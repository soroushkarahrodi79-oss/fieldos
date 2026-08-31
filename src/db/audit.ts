import { newId } from '../domain/ids';
import { SCHEMA_VERSION } from '../version';
import type {
  Observation,
  ObservationAuditEntry,
  ObservationAuditEventType,
  ObservationAuditState,
  Uuid,
} from '../domain/types';

/**
 * Deterministic audit helpers.
 *
 * These are kept tiny and pure so snapshot logic is not smeared across the repository methods.
 * The repository (data layer) is the ONLY place audit entries are created — never the UI.
 */

/** Deep-clone a value so a stored snapshot can never be mutated by later edits to the source. */
function deepClone<T>(value: T): T {
  // Audit state is entirely JSON-safe (no Blobs), so structuredClone is exact and cheap.
  // A defensive fallback keeps this working in any runtime lacking structuredClone.
  const clone = (globalThis as { structuredClone?: <U>(v: U) => U }).structuredClone;
  return clone ? clone(value) : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * Capture the MUTABLE state of an observation for the revision log.
 *
 * The immutable raw capture block (`capturedAt`, raw `capturedLocation`) is intentionally NOT
 * included: it can never change, so the log preserves only what legitimately can. Every nested
 * object is deep-cloned so the snapshot is frozen against later mutation of the live record.
 */
export function snapshotObservationForAudit(observation: Observation): ObservationAuditState {
  return {
    schemaVersion: observation.schemaVersion,
    assetId: observation.assetId,
    observation: deepClone(observation.observation),
    evidence: deepClone(observation.evidence),
    note: observation.note,
    locationAdjustment: deepClone(observation.locationAdjustment),
    deleted: observation.deleted,
    updatedAt: observation.updatedAt,
    editCount: observation.editCount,
    edited: observation.edited,
  };
}

/**
 * Build one append-only audit entry. `before` is deep-cloned again here as a belt-and-braces
 * guard (callers already pass frozen snapshots). `sequence` is supplied by the repository from a
 * per-observation counter read inside the same transaction, guaranteeing monotonic 1,2,3,… order.
 */
export function buildAuditEntry(params: {
  observationId: Uuid;
  sessionId: Uuid;
  sequence: number;
  eventType: ObservationAuditEventType;
  occurredAt: string;
  before: ObservationAuditState | null;
  after: ObservationAuditState;
}): ObservationAuditEntry {
  return {
    id: newId(),
    schemaVersion: SCHEMA_VERSION,
    observationId: params.observationId,
    sessionId: params.sessionId,
    sequence: params.sequence,
    eventType: params.eventType,
    occurredAt: params.occurredAt,
    before: params.before ? deepClone(params.before) : null,
    after: deepClone(params.after),
  };
}
