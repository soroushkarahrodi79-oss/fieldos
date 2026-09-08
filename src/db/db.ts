import Dexie, { type EntityTable } from 'dexie';
import type {
  Asset,
  FieldCampaign,
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
  campaigns!: EntityTable<FieldCampaign, 'id'>;

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
    // Version 3 (Campaign + FieldPack v1): add the `campaigns` store and a `campaignId` index on
    // `fieldSessions` and `assets`. Adding a new store AND adding an index to existing stores both
    // require a real Dexie version bump. All prior stores are re-declared (Dexie deletes only stores
    // OMITTED from a version), so every existing row is preserved. There is no `.upgrade()` step:
    // legacy rows simply lack `campaignId`/`sourceRef` (normalized to `null` at the read boundary,
    // never rewritten), and `null`/absent keys are not indexed by IndexedDB — standalone sessions
    // and assets are found through the ordinary (non-campaign) listing paths. The `campaigns` store
    // starts empty; no campaign is fabricated for existing sessions.
    this.version(3).stores({
      fieldSessions: 'id, status, createdAt, campaignId',
      assets: 'id, sessionId, source, campaignId',
      observations: 'id, sessionId, createdAt, capturedAt',
      media: 'id, observationId',
      observationAudit:
        'id, observationId, sessionId, &[observationId+sequence], occurredAt',
      campaigns: 'id, createdAt',
    });
  }
}

/** The shared app database instance. Tests construct their own isolated instances. */
export const db = new FieldOsDb();
