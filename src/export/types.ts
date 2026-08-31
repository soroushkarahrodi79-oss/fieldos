import type {
  Asset,
  FieldSession,
  MediaAttachment,
  Observation,
  ObservationAuditEntry,
} from '../domain/types';

/** Media metadata WITHOUT the blob — safe to place in canonical JSON. */
export interface MediaMetadata {
  id: string;
  schemaVersion: number;
  observationId: string;
  kind: MediaAttachment['kind'];
  mimeType: string;
  byteSize: number;
  capturedAt: string;
  originalFilename: string | null;
  createdAt: string;
  /** Relative path of the blob inside a full-session backup ZIP (media/…). */
  backupFilename: string;
}

/**
 * Everything needed to represent one session. The canonical `observations.json`.
 * A future FieldOS version must, in principle, be able to restore from this.
 */
export interface SessionBundle {
  fieldosSchemaVersion: number;
  appVersion: string;
  exportedAt: string;
  session: FieldSession;
  assets: Asset[];
  observations: Observation[];
  /** Metadata only; blobs travel separately in the ZIP's media/ folder. */
  media: MediaMetadata[];
  /**
   * Complete append-only revision history for the session's observations (P1-5). One observation
   * maps to MANY entries, so this is kept as its own collection here and in canonical JSON rather
   * than flattened into the one-row-per-observation CSV/GeoJSON (which would be lossy). Absent from
   * schema-1/2 exports; importers normalize a missing field to `[]` without inventing entries.
   */
  auditEntries: ObservationAuditEntry[];
}

/** Map a MIME type to a file extension for backup filenames. */
export function extensionForMime(mimeType: string): string {
  // Recorders often report codec parameters (e.g. "audio/webm;codecs=opus"); the extension is
  // decided by the container alone, so strip parameters and normalise before mapping.
  const base = mimeType.split(';')[0]!.trim().toLowerCase();
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
  };
  return map[base] ?? 'bin';
}

/** Canonical backup path for a media blob: media/{observationId}_{mediaId}.{ext}. */
export function backupFilenameFor(media: MediaAttachment): string {
  return `media/${media.observationId}_${media.id}.${extensionForMime(media.mimeType)}`;
}
