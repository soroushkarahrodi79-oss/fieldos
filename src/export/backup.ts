import { zipSync, type Zippable } from 'fflate';
import type { Repositories } from '../db/repositories';
import type { Uuid } from '../domain/types';
import { buildSessionBundle } from './bundle';
import { serializeSessionJson } from './json';
import { serializeObservationsCsv } from './csv';
import { serializeObservationsGeoJson } from './geojson';
import type { SessionBundle } from './types';

/** Minimum manifest for a full-session backup (correction §5). */
export interface BackupManifest {
  fieldosSchemaVersion: number;
  exportedAt: string;
  sessionId: string;
  observationCount: number;
  mediaCount: number;
  /** Total append-only revision-history entries across the session's observations. */
  auditEntryCount: number;
  appVersion: string;
}

export interface DataExportFile {
  filename: string;
  content: string;
  mimeType: string;
}

/**
 * DATA EXPORT (analysis / interoperability): the three text files. Does NOT embed media.
 * Also the fallback when ZIP generation fails so structured data always gets out.
 */
export function buildDataExportFiles(bundle: SessionBundle): DataExportFile[] {
  return [
    {
      filename: 'observations.json',
      content: serializeSessionJson(bundle),
      mimeType: 'application/json',
    },
    {
      filename: 'observations.csv',
      content: serializeObservationsCsv(bundle),
      mimeType: 'text/csv',
    },
    {
      filename: 'observations.geojson',
      content: serializeObservationsGeoJson(bundle),
      mimeType: 'application/geo+json',
    },
  ];
}

function manifestFor(bundle: SessionBundle): BackupManifest {
  return {
    fieldosSchemaVersion: bundle.fieldosSchemaVersion,
    exportedAt: bundle.exportedAt,
    sessionId: bundle.session.id,
    observationCount: bundle.observations.length,
    mediaCount: bundle.media.length,
    auditEntryCount: bundle.auditEntries.length,
    appVersion: bundle.appVersion,
  };
}

export interface SessionBackup {
  zipBytes: Uint8Array;
  manifest: BackupManifest;
  /** Suggested download filename for the archive. */
  filename: string;
}

/**
 * FULL SESSION BACKUP: a single ZIP containing manifest.json + the three data files + media/*.
 * This is the complete, restorable-in-principle package — the durability backstop when media exists.
 */
export async function buildSessionBackup(
  repos: Repositories,
  sessionId: Uuid,
): Promise<SessionBackup> {
  const { bundle, mediaBlobs } = await buildSessionBundle(repos, sessionId);
  const manifest = manifestFor(bundle);
  const encoder = new TextEncoder();

  const entries: Zippable = {
    'manifest.json': encoder.encode(JSON.stringify(manifest, null, 2)),
  };
  for (const file of buildDataExportFiles(bundle)) {
    entries[file.filename] = encoder.encode(file.content);
  }
  // Binary media under media/{observationId}_{mediaId}.{ext}, matching the metadata paths.
  for (const media of mediaBlobs) {
    const meta = bundle.media.find((m) => m.id === media.id);
    if (!meta) continue;
    const bytes = new Uint8Array(await media.blob.arrayBuffer());
    entries[meta.backupFilename] = bytes;
  }

  const zipBytes = zipSync(entries);
  const stamp = bundle.exportedAt.replace(/[:.]/g, '-');
  return { zipBytes, manifest, filename: `fieldos-session-${sessionId}-${stamp}.zip` };
}
