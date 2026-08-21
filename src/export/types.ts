import type { Asset, FieldSession, MediaAttachment, Observation } from '../domain/types';

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
}

/** Map a MIME type to a file extension for backup filenames. */
export function extensionForMime(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
  };
  return map[mimeType] ?? 'bin';
}

/** Canonical backup path for a media blob: media/{observationId}_{mediaId}.{ext}. */
export function backupFilenameFor(media: MediaAttachment): string {
  return `media/${media.observationId}_${media.id}.${extensionForMime(media.mimeType)}`;
}
