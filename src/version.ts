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
 *   - FieldOS schema version 3  ← logical/canonical shape (P1-5 added the audit-entry collection)
 * The two are bumped independently and must not be conflated.
 */
export const SCHEMA_VERSION = 3;
