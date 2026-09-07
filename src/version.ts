// Single source of truth for versions used across the app, exports, and backups.

/** Application (build) version. Mirrors package.json version. */
export const APP_VERSION = '0.1.0';

/**
 * FieldOS logical data schema version. Bump when the canonical persisted shape changes.
 * A matching Dexie version/migration is required only when IndexedDB stores or indexes change;
 * additive nullable fields may instead be normalized safely at the repository/import boundary.
 * Every entity carries its own `schemaVersion` and the backup manifest embeds this value.
 *
 * This is DISTINCT from the Dexie/IndexedDB database version (see `src/db/db.ts`):
 *   - Dexie DB version 2  ← physical stores/indexes (P1-5 added the `observationAudit` store)
 *   - FieldOS schema version 4  ← logical/canonical shape
 * The two are bumped independently and must not be conflated.
 *
 * History of the logical schema version:
 *   - 1  initial model
 *   - 2  additive nullable GNSS fields inside CapturedLocation (no Dexie migration)
 *   - 3  P1-5 append-only `observationAudit` entry collection (Dexie DB 1 → 2)
 *   - 4  Protocol Engine v1: FieldSession gains an immutable `protocolSnapshot`. This is an
 *        additive nullable object field on an existing store, so it needs NO Dexie migration
 *        (DB stays at version 2); legacy rows missing it normalize to `null` at the read boundary
 *        without being rewritten.
 */
export const SCHEMA_VERSION = 4;
