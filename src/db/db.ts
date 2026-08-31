import Dexie, { type EntityTable } from 'dexie';
import type { Asset, FieldSession, MediaAttachment, Observation } from '../domain/types';

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
  }
}

/** The shared app database instance. Tests construct their own isolated instances. */
export const db = new FieldOsDb();
