import Dexie, { type EntityTable } from 'dexie';
import type {
  Asset,
  FieldSession,
  MediaAttachment,
  Observation,
  ObservationAuditEntry,
} from '../domain/types';

/**
 * FieldOS local database (IndexedDB via Dexie).
 *
 * Dexie earns its place by giving explicit, versioned migrations and clean transactions
 * over the raw IndexedDB API. Schema strings list only the INDEXED properties; full objects
 * are stored regardless. Bump the Dexie version and add an upgrade path when stores or indexes
 * change. Additive nullable object fields can be normalized at the repository boundary.
 */
export class FieldOsDb extends Dexie {
  fieldSessions!: EntityTable<FieldSession, 'id'>;
  assets!: EntityTable<Asset, 'id'>;
  observations!: EntityTable<Observation, 'id'>;
  media!: EntityTable<MediaAttachment, 'id'>;
  observationAudit!: EntityTable<ObservationAuditEntry, 'id'>;

  constructor(name = 'fieldos') {
    super(name);
    this.version(1).stores({
      fieldSessions: 'id, status, createdAt',
      assets: 'id, sessionId, source',
      // Note: `deleted` is a boolean and booleans are NOT valid IndexedDB keys, so it is
      // deliberately not indexed — live/deleted filtering happens in memory (a session holds
      // at most a few hundred observations).
      observations: 'id, sessionId, createdAt, capturedAt',
      media: 'id, observationId',
    });
    // Version 2 (P1-5): add the append-only `observationAudit` store. This is a real IndexedDB
    // version upgrade, NOT an additive-nullable-field change, because it introduces a new object
    // store. All version-1 stores are re-declared unchanged so their existing data is preserved
    // (Dexie deletes only stores that are OMITTED from a version). There is no `.upgrade()` step:
    // the four original stores keep their rows verbatim and the new store simply starts empty.
    // No historical audit entries are fabricated for observations created before this version.
    this.version(2).stores({
      fieldSessions: 'id, status, createdAt',
      assets: 'id, sessionId, source',
      observations: 'id, sessionId, createdAt, capturedAt',
      media: 'id, observationId',
      // UNIQUE compound &[observationId+sequence]: gives deterministic per-observation ordering, a
      // cheap "next sequence" lookup, AND enforces the no-duplicate-sequence invariant in IndexedDB
      // itself — a second entry with the same (observationId, sequence) is rejected by the database,
      // not merely by the repository's max+1 logic. Safe to declare unique here because the store is
      // introduced fresh in DB version 2 with no legacy audit rows that could violate it.
      // `occurredAt` supports chronological session-wide reads.
      observationAudit:
        'id, observationId, sessionId, &[observationId+sequence], occurredAt',
    });
  }
}

/** The shared app database instance. Tests construct their own isolated instances. */
export const db = new FieldOsDb();
