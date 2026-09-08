import type { Repositories } from '../db/repositories';
import { nowIso } from '../domain/time';
import { APP_VERSION, SCHEMA_VERSION } from '../version';
import {
  backupFilenameFor,
  type MediaMetadata,
  type SessionBundle,
  type SessionCampaignContext,
} from './types';
import type { Asset, MediaAttachment, Uuid } from '../domain/types';

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

  const sessionAssets = await repos.listAssets(sessionId);
  const observations = await repos.listObservations(sessionId, { includeDeleted: true });
  const auditEntries = await repos.listSessionAuditEntries(sessionId);

  // Campaign context + referential integrity (Campaign + FieldPack v1 §20). A campaign-bound
  // session may reference campaign-level assets that are NOT session-scoped. To keep the bundle
  // self-contained (every observation `assetId` resolves) without dumping the whole campaign, we
  // include ONLY the campaign assets actually referenced by this session's observations.
  let campaignContext: SessionCampaignContext | null = null;
  const assets: Asset[] = [...sessionAssets];
  if (session.campaignId) {
    const campaign = await repos.getCampaign(session.campaignId);
    if (campaign) {
      campaignContext = {
        campaignId: campaign.id,
        title: campaign.title,
        sourceFieldpackId: campaign.source.type === 'fieldpack' ? campaign.source.fieldpackId : null,
        sourceFieldpackVersion: campaign.source.type === 'fieldpack' ? campaign.source.fieldpackVersion : null,
      };
    }
    const referenced = new Set(observations.map((obs) => obs.assetId).filter((id): id is Uuid => id !== null));
    const present = new Set(assets.map((asset) => asset.id));
    const campaignAssets = await repos.listCampaignAssets(session.campaignId);
    for (const asset of campaignAssets) {
      if (referenced.has(asset.id) && !present.has(asset.id)) assets.push(asset);
    }
  }

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
    auditEntries,
    campaignContext,
  };
  return { bundle, mediaBlobs };
}
