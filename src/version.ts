// Single source of truth for versions used across the app, exports, and backups.

/** Application (build) version. Mirrors package.json version. */
export const APP_VERSION = '0.1.0';

/**
 * FieldOS data schema version. Bump this ONLY when the persisted shape changes,
 * and add a matching Dexie migration. Every entity carries its own `schemaVersion`
 * and the backup manifest embeds this value so old archives stay interpretable.
 */
export const SCHEMA_VERSION = 1;
