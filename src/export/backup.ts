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
  /**
   * Hashes of the exact payload bytes in this archive. This detects accidental corruption or a
   * changed payload relative to this manifest; it is not a signature or authenticated provenance.
   */
  integrity?: BackupIntegrity;
}

export interface BackupIntegrity {
  algorithm: 'SHA-256';
  files: Record<string, string>;
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

function manifestFor(bundle: SessionBundle, integrity?: BackupIntegrity): BackupManifest {
  return {
    fieldosSchemaVersion: bundle.fieldosSchemaVersion,
    exportedAt: bundle.exportedAt,
    sessionId: bundle.session.id,
    observationCount: bundle.observations.length,
    mediaCount: bundle.media.length,
    auditEntryCount: bundle.auditEntries.length,
    appVersion: bundle.appVersion,
    ...(integrity ? { integrity } : {}),
  };
}

/** Hex SHA-256 over the precise bytes that are stored in a ZIP entry. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a plain ArrayBuffer: TypeScript correctly distinguishes a possible
  // SharedArrayBuffer-backed view from Web Crypto's accepted BufferSource.
  const payload = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(payload).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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
  const encoder = new TextEncoder();
  const payloads: Record<string, Uint8Array> = {};
  for (const file of buildDataExportFiles(bundle)) {
    payloads[file.filename] = encoder.encode(file.content);
  }
  // Binary media under media/{observationId}_{mediaId}.{ext}, matching the metadata paths.
  for (const media of mediaBlobs) {
    const meta = bundle.media.find((m) => m.id === media.id);
    if (!meta) continue;
    const bytes = new Uint8Array(await media.blob.arrayBuffer());
    payloads[meta.backupFilename] = bytes;
  }

  const integrity: BackupIntegrity = {
    algorithm: 'SHA-256',
    files: Object.fromEntries(
      await Promise.all(Object.entries(payloads).map(async ([name, bytes]) => [name, await sha256Hex(bytes)])),
    ),
  };
  const manifest = manifestFor(bundle, integrity);
  const entries: Zippable = {
    'manifest.json': encoder.encode(JSON.stringify(manifest, null, 2)),
    ...payloads,
  };

  const zipBytes = zipSync(entries);
  const stamp = bundle.exportedAt.replace(/[:.]/g, '-');
  return { zipBytes, manifest, filename: `fieldos-session-${sessionId}-${stamp}.zip` };
}
