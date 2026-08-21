import type { Repositories } from '../db/repositories';
import { nowIso } from '../domain/time';
import { APP_VERSION, SCHEMA_VERSION } from '../version';
import { backupFilenameFor, type MediaMetadata, type SessionBundle } from './types';
import type { MediaAttachment, Uuid } from '../domain/types';

/**
 * Assemble the canonical bundle for a session.
 *
 * A full backup is COMPLETE: it includes soft-deleted observations (they are recoverable) so
 * nothing is silently dropped. Analysis consumers can filter on the `deleted` flag.
 *
 * Returns the JSON-safe bundle plus the raw media rows (with blobs) so the ZIP writer can add
 * the binary files. `exportedAt` is a fresh timestamp; all STORED timestamps pass through verbatim.
 */
export async function buildSessionBundle(
  repos: Repositories,
  sessionId: Uuid,
): Promise<{ bundle: SessionBundle; mediaBlobs: MediaAttachment[] }> {
  const session = await repos.getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const assets = await repos.listAssets(sessionId);
  const observations = await repos.listObservations(sessionId, { includeDeleted: true });

  const mediaBlobs: MediaAttachment[] = [];
  const media: MediaMetadata[] = [];
  for (const obs of observations) {
    const rows = await repos.listMedia(obs.id);
    for (const m of rows) {
      mediaBlobs.push(m);
      media.push({
        id: m.id,
        schemaVersion: m.schemaVersion,
        observationId: m.observationId,
        kind: m.kind,
        mimeType: m.mimeType,
        byteSize: m.byteSize,
        capturedAt: m.capturedAt,
        originalFilename: m.originalFilename,
        createdAt: m.createdAt,
        backupFilename: backupFilenameFor(m),
      });
    }
  }

  const bundle: SessionBundle = {
    fieldosSchemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: nowIso(),
    session,
    assets,
    observations,
    media,
  };
  return { bundle, mediaBlobs };
}
