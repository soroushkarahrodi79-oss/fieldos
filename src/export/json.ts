import type { SessionBundle } from './types';

/**
 * Canonical JSON serialization of a session bundle.
 *
 * Invariant: UUIDs and timestamps are emitted verbatim (JSON.stringify does not touch strings),
 * so a serialize → parse round-trip reproduces the records exactly. No timestamp is regenerated.
 */
export function serializeSessionJson(bundle: SessionBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/** Parse a canonical JSON export back into a bundle (basis for a future restore). */
export function parseSessionJson(text: string): SessionBundle {
  return JSON.parse(text) as SessionBundle;
}
