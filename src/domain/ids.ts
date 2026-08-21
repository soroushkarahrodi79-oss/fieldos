import type { Uuid } from './types';

/**
 * Generate a client-side UUIDv4. Uses the platform `crypto.randomUUID()` — no library.
 * Client-generated IDs are globally unique so offline records never collide on a future sync.
 */
export function newId(): Uuid {
  return crypto.randomUUID();
}
