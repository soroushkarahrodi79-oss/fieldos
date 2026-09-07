// FieldOS domain types (Phase 0.5 corrected).
//
// Invariants encoded here:
//  - Capture block (capturedAt + capturedLocation) is written once; the repository layer
//    never mutates it. A correction is a SEPARATE `locationAdjustment`.
//  - Observation "value" is a DISCRIMINATED union keyed by category — there is no universal
//    ordinal scale, no numeric score, no composite index.
//  - Evidence method is one of OBSERVED / MEASURED / REPORTED only. No DERIVED / MISSING.
//  - Absence of data is represented by null, never by a fabricated value or coordinate.

import type { FieldProtocol } from '../protocol/types';

/** ISO-8601 timestamp string with offset, e.g. "2026-08-21T14:03:22.000+02:00". */
export type IsoTimestamp = string;

/** UUIDv4 string (crypto.randomUUID()). */
export type Uuid = string;

// ---------------------------------------------------------------------------
// Location (correction §4): immutable capture + optional non-destructive adjustment
// ---------------------------------------------------------------------------

export type LocationStatus = 'CAPTURED' | 'DENIED' | 'UNAVAILABLE' | 'TIMEOUT';

/** Raw device fix at capture time. IMMUTABLE once written. */
export interface CapturedLocation {
  /** null when locationStatus !== 'CAPTURED' — never fabricated. */
  latitude: number | null;
  longitude: number | null;
  /** Metres, from Geolocation `coords.accuracy`. Honest uncertainty — never dropped. */
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  /** Metres, mapped directly from Geolocation `coords.altitudeAccuracy`. */
  altitudeAccuracyMeters: number | null;
  /** Degrees, mapped directly from Geolocation `coords.heading`; never estimated. */
  headingDegrees: number | null;
  /** Metres per second, mapped directly from Geolocation `coords.speed`; never inferred. */
  speedMetersPerSecond: number | null;
  locationStatus: LocationStatus;
  capturedAt: IsoTimestamp;
}

/** A manual correction. Written separately; never overwrites CapturedLocation. */
export interface LocationAdjustment {
  latitude: number;
  longitude: number;
  locationAdjustedAt: IsoTimestamp;
  locationAdjustmentReason: string | null;
}

/** A plain resolved coordinate (derived, not persisted). */
export interface Coordinate {
  latitude: number;
  longitude: number;
}

// ---------------------------------------------------------------------------
// Observation value: protocol-driven, definition-validated (Protocol Engine v1)
// ---------------------------------------------------------------------------

// P0 encoded the vocabulary as a CLOSED discriminated union of tourism categories plus a
// CATEGORY_VALUES table. Protocol Engine v1 removes that closed union so categories/values are
// driven by the session's protocol snapshot at runtime. The SERIALIZED shape is preserved exactly:
// an observation value is a `{ category, value }` pair of machine ids. `value` is `null` for a
// free/`other`-style category. Correctness is not weakened — it moves from compile-time to runtime
// validation against the protocol (see `src/protocol/validation.ts`). The controlled vocabulary
// itself lives in protocol definitions (see `src/protocol/tourismCore.ts` for the built-in one).

export interface ObservationValue {
  /** A category id defined by the session's protocol (e.g. 'visitor_pressure', 'other'). */
  category: string;
  /** A value id belonging to that category, or `null` for a free/`other`-style category. */
  value: string | null;
}

// ---------------------------------------------------------------------------
// Evidence method (correction §3): OBSERVED / MEASURED / REPORTED only
// ---------------------------------------------------------------------------

export type EvidenceMethod = 'OBSERVED' | 'MEASURED' | 'REPORTED';

export type Evidence =
  | { method: 'OBSERVED' }
  | { method: 'MEASURED'; value: number; unit: string; context: string | null }
  | { method: 'REPORTED'; sourceNote: string | null };

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type SessionStatus = 'active' | 'closed';

export interface FieldSession {
  id: Uuid;
  schemaVersion: number;
  title: string;
  purpose: string | null;
  /** Self-declared, UNVERIFIED (P0 has no authentication). */
  observerName: string | null;
  status: SessionStatus;
  createdAt: IsoTimestamp;
  closedAt: IsoTimestamp | null;
  updatedAt: IsoTimestamp;
  deviceLabel: string | null;
  /**
   * Immutable protocol snapshot bound at session creation (Protocol Engine v1). Written once and
   * never changed — there is deliberately no "change protocol" for an existing session. `null` for
   * a LEGACY session created before the Protocol Engine: historical absence is preserved, never
   * back-filled with a fabricated snapshot. Legacy sessions render via the legacy FieldOS
   * vocabulary (see `src/protocol/resolve.ts`).
   */
  protocolSnapshot: FieldProtocol | null;
}

export type AssetType =
  | 'trailhead'
  | 'car_park'
  | 'viewpoint'
  | 'visitor_centre'
  | 'path_segment'
  | 'public_space'
  | 'other';

export type AssetSource = 'field_created' | 'preloaded';

export interface Asset {
  id: Uuid;
  schemaVersion: number;
  sessionId: Uuid | null;
  name: string;
  assetType: AssetType | null;
  latitude: number | null;
  longitude: number | null;
  source: AssetSource;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface Observation {
  id: Uuid;
  schemaVersion: number;
  sessionId: Uuid;
  assetId: Uuid | null;

  // --- Capture block (IMMUTABLE) ---
  capturedAt: IsoTimestamp;
  capturedLocation: CapturedLocation;

  // --- Interpretation block (editable) ---
  observation: ObservationValue;
  evidence: Evidence;
  note: string | null;
  locationAdjustment: LocationAdjustment | null;

  // --- Bookkeeping ---
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  editCount: number;
  edited: boolean;
  deleted: boolean;
}

// ---------------------------------------------------------------------------
// Observation audit / revision history (P1-5): append-only LOCAL revision log
//
// This records what changed in an observation's MUTABLE state, when, and what the previous
// state was. It is append-only at the application layer — the repository exposes no update or
// delete for audit entries. It is NOT a cryptographic chain of custody, NOT tamper-proof, NOT
// digitally signed, and NOT authenticated authorship (P0 has no accounts). The honest claim is
// "append-only local observation revision history".
//
// SNAPSHOT BOUNDARY: the immutable raw capture block (`capturedAt`, raw `capturedLocation`) is
// deliberately NOT copied into audit snapshots. Those values are write-once on the canonical
// Observation and can never change, so duplicating them into every revision would be redundant.
// The audit log exists to preserve the history of the fields that CAN legitimately change.
// ---------------------------------------------------------------------------

export type ObservationAuditEventType =
  | 'CREATED'
  | 'INTERPRETATION_UPDATED'
  | 'LOCATION_ADJUSTED'
  | 'SOFT_DELETED'
  | 'RESTORED';

/** A snapshot of the MUTABLE observation state at one moment (no raw capture block). */
export interface ObservationAuditState {
  schemaVersion: number;
  assetId: Uuid | null;
  observation: ObservationValue;
  evidence: Evidence;
  note: string | null;
  locationAdjustment: LocationAdjustment | null;
  deleted: boolean;
  updatedAt: IsoTimestamp;
  editCount: number;
  edited: boolean;
}

/**
 * One append-only revision-history entry for an observation. `sequence` is monotonic per
 * observation starting at 1. `before` is null only for a genuine CREATED event.
 */
export interface ObservationAuditEntry {
  id: Uuid;
  schemaVersion: number;
  observationId: Uuid;
  sessionId: Uuid;
  /** 1-based, strictly increasing per observation. No gaps, no duplicates. */
  sequence: number;
  eventType: ObservationAuditEventType;
  occurredAt: IsoTimestamp;
  /** State immediately before this event; null only for CREATED. */
  before: ObservationAuditState | null;
  /** State immediately after this event. */
  after: ObservationAuditState;
}

export type MediaKind = 'photo' | 'audio';

export interface MediaAttachment {
  id: Uuid;
  schemaVersion: number;
  observationId: Uuid;
  kind: MediaKind;
  blob: Blob;
  mimeType: string;
  byteSize: number;
  capturedAt: IsoTimestamp;
  originalFilename: string | null;
  createdAt: IsoTimestamp;
}

/** The editable fields of an observation. Capture block is intentionally excluded. */
export interface ObservationInterpretationPatch {
  observation?: ObservationValue;
  evidence?: Evidence;
  note?: string | null;
  assetId?: Uuid | null;
}
