// FieldOS domain types (Phase 0.5 corrected).
//
// Invariants encoded here:
//  - Capture block (capturedAt + capturedLocation) is written once; the repository layer
//    never mutates it. A correction is a SEPARATE `locationAdjustment`.
//  - Observation "value" is a DISCRIMINATED union keyed by category — there is no universal
//    ordinal scale, no numeric score, no composite index.
//  - Evidence method is one of OBSERVED / MEASURED / REPORTED only. No DERIVED / MISSING.
//  - Absence of data is represented by null, never by a fabricated value or coordinate.

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
// Observation value: discriminated per-category vocabularies (correction §2)
// ---------------------------------------------------------------------------

export type ObservationCategory =
  | 'visitor_pressure'
  | 'parking_pressure'
  | 'path_condition'
  | 'litter'
  | 'infrastructure_condition'
  | 'signage_condition'
  | 'accessibility_barrier'
  | 'visitor_management'
  | 'other';

export type ObservationValue =
  | { category: 'visitor_pressure'; value: 'NONE' | 'LOW' | 'MODERATE' | 'HIGH' }
  | { category: 'parking_pressure'; value: 'LOW' | 'MODERATE' | 'HIGH' | 'FULL' }
  | { category: 'path_condition'; value: 'GOOD' | 'FAIR' | 'POOR' | 'BLOCKED' }
  | { category: 'litter'; value: 'NONE' | 'LOW' | 'MODERATE' | 'HIGH' }
  | { category: 'infrastructure_condition'; value: 'GOOD' | 'FAIR' | 'POOR' | 'DAMAGED' }
  | { category: 'signage_condition'; value: 'GOOD' | 'DAMAGED' | 'MISSING' | 'UNCLEAR' }
  | { category: 'accessibility_barrier'; value: 'NONE' | 'MINOR' | 'MAJOR' | 'UNKNOWN' }
  | { category: 'visitor_management'; value: 'PRESENT' | 'ABSENT' | 'NOT_ASSESSED' }
  | { category: 'other'; value: null };

/**
 * The allowed values per category — the single source of truth for the UI's value row
 * and for validation. `other` has no categorical value.
 */
export const CATEGORY_VALUES = {
  visitor_pressure: ['NONE', 'LOW', 'MODERATE', 'HIGH'],
  parking_pressure: ['LOW', 'MODERATE', 'HIGH', 'FULL'],
  path_condition: ['GOOD', 'FAIR', 'POOR', 'BLOCKED'],
  litter: ['NONE', 'LOW', 'MODERATE', 'HIGH'],
  infrastructure_condition: ['GOOD', 'FAIR', 'POOR', 'DAMAGED'],
  signage_condition: ['GOOD', 'DAMAGED', 'MISSING', 'UNCLEAR'],
  accessibility_barrier: ['NONE', 'MINOR', 'MAJOR', 'UNKNOWN'],
  visitor_management: ['PRESENT', 'ABSENT', 'NOT_ASSESSED'],
  other: [],
} as const satisfies Record<ObservationCategory, readonly string[]>;

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
