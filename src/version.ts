// Single source of truth for versions used across the app, exports, and backups.

/** Application (build) version. Mirrors package.json version. */
export const APP_VERSION = '0.1.0';

/**
 * FieldOS logical data schema version. Bump when the canonical persisted shape changes.
 * A matching Dexie version/migration is required only when IndexedDB stores or indexes change;
 * additive nullable fields may instead be normalized safely at the repository/import boundary.
 * Every entity carries its own `schemaVersion` and the backup manifest embeds this value.
 */
export const SCHEMA_VERSION = 2;
