import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { repositories } from './db/repositories';
import { captureCurrentLocation, unavailableLocation } from './domain/geolocation';
import { nearbyAssets } from './domain/geo';
import { readable } from './domain/labels';
import { evidenceFromForm, observationValueFor, type EvidenceForm } from './domain/observationForm';
import { nowIso } from './domain/time';
import type { Asset, AssetType, CapturedLocation, EvidenceMethod, FieldCampaign, FieldSession, MediaAttachment, Observation, Uuid } from './domain/types';
import { BUILT_IN_PROTOCOLS, DEFAULT_PROTOCOL } from './protocol/registry';
import { protocolForSession, resolveCategoryLabel, resolveValueLabel } from './protocol/resolve';
import { getProtocolValues } from './protocol/validation';
import type { FieldProtocol } from './protocol/types';
import { buildSessionBackup, buildDataExportFiles } from './export/backup';
import { buildSessionBundle } from './export/bundle';
import { inspectRestoreFile, preflightRestore, restoreInspection, type RestoreInspection } from './export/restore';
import { inspectFieldPackFile, installFieldPackImport, preflightFieldPackImport } from './fieldpack/import';
import type { FieldPackInspection } from './fieldpack/types';
import { extensionForMime } from './export/types';
import { getStorageHealth, requestPersistence, type StorageHealth } from './storage/storageHealth';
import { VoiceRecorder } from './components/VoiceRecorder';
import { PhotoSourcePicker } from './components/PhotoSourcePicker';
import { ObservationHistory } from './components/ObservationHistory';
import { countMedia, summarizeMedia, type MediaCounts } from './media/mediaSummary';
import type { AudioRecording } from './media/audioRecorder';
import { APP_VERSION } from './version';
import './app.css';

// The map view is a separate lazy chunk: the large MapLibre bundle loads only when the map opens,
// keeping the core offline capture flow's initial load light. The chunk is still precached, so the
// map works offline once visited; a load failure never blocks the rest of FieldOS.
const FieldMap = lazy(() => import('./components/FieldMap').then((m) => ({ default: m.FieldMap })));

type Screen =
  | { name: 'home' }
  | { name: 'campaign'; campaignId: Uuid }
  | { name: 'importFieldpack' }
  | { name: 'session'; sessionId: Uuid }
  | { name: 'capture'; sessionId: Uuid }
  | { name: 'detail'; sessionId: Uuid; observationId: Uuid }
  | { name: 'map'; sessionId: Uuid }
  | { name: 'export'; sessionId: Uuid }
  | { name: 'restore' };

const assetTypes: AssetType[] = ['trailhead', 'car_park', 'viewpoint', 'visitor_centre', 'path_segment', 'public_space', 'other'];
const emptyEvidence: EvidenceForm = { method: 'OBSERVED', measuredValue: '', measuredUnit: '', measuredContext: '', reportedSource: '' };

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function formatBytes(value: number | null): string {
  if (value === null) return 'Unknown';
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** A readable, filesystem-safe voice-note filename. UUID stays canonical; this is convenience only. */
function audioFilename(audio: AudioRecording): string {
  const ext = extensionForMime(audio.mimeType);
  const stamp = audio.startedAt.replace(/[:.]/g, '-');
  return `voice-note-${stamp}.${ext}`;
}

async function deliverFiles(files: File[]): Promise<'shared' | 'downloaded'> {
  if (navigator.share && navigator.canShare?.({ files })) {
    await navigator.share({ files, title: 'FieldOS export' });
    return 'shared';
  }
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  return 'downloaded';
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [health, setHealth] = useState<StorageHealth | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [lastDeleted, setLastDeleted] = useState<{ id: Uuid; sessionId: Uuid } | null>(null);

  const refreshHealth = useCallback(() => { void getStorageHealth().then(setHealth); }, []);
  useEffect(() => { refreshHealth(); }, [refreshHealth, revision]);

  const changed = useCallback((message?: string) => {
    setRevision((value) => value + 1); setError(null); if (message) setNotice(message);
  }, []);
  const fail = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)), []);
  const go = useCallback((next: Screen) => { setError(null); setScreen(next); }, []);
  const undoDelete = useCallback(async () => {
    if (!lastDeleted) return;
    try {
      await repositories.restoreObservation(lastDeleted.id);
      const sessionId = lastDeleted.sessionId;
      setLastDeleted(null); changed('Observation restored.'); setScreen({ name: 'session', sessionId });
    } catch (cause) { fail(cause); }
  }, [changed, fail, lastDeleted]);

  return <div className="app-shell">
    <header className="app-header"><button className="brand" onClick={() => go({ name: 'home' })} aria-label="FieldOS home">FieldOS</button><span className="local-chip">{navigator.onLine ? 'Local-first' : 'Offline · ready'}</span></header>
    {health && !health.persisted && <aside className="durability-banner"><div><strong>Back up your field data.</strong><span> It lives only on this device and persistent storage is not guaranteed.</span></div><button onClick={() => void requestPersistence().then((granted) => changed(granted ? 'Persistent storage granted.' : 'The browser did not grant persistent storage. Keep making backups.'))}>Protect storage</button></aside>}
    {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div>}
    {error && <div className="error" role="alert"><strong>Action failed.</strong> {error}<button onClick={() => setError(null)} aria-label="Dismiss">×</button></div>}
    <main>
      {screen.name === 'home' && <HomeScreen revision={revision} go={go} changed={changed} fail={fail} />}
      {screen.name === 'campaign' && <CampaignScreen campaignId={screen.campaignId} revision={revision} go={go} changed={changed} fail={fail} />}
      {screen.name === 'importFieldpack' && <ImportFieldpackScreen go={go} changed={changed} fail={fail} />}
      {screen.name === 'restore' && <RestoreScreen go={go} changed={changed} fail={fail} />}
      {screen.name === 'session' && <SessionScreen sessionId={screen.sessionId} revision={revision} go={go} changed={changed} fail={fail} canUndo={lastDeleted?.sessionId === screen.sessionId} undoDelete={undoDelete} />}
      {screen.name === 'capture' && <CaptureScreen sessionId={screen.sessionId} go={go} changed={changed} fail={fail} />}
      {screen.name === 'map' && <MapScreen sessionId={screen.sessionId} revision={revision} go={go} changed={changed} fail={fail} />}
      {screen.name === 'detail' && <DetailScreen sessionId={screen.sessionId} observationId={screen.observationId} go={go} changed={changed} fail={fail} deleted={(id) => setLastDeleted({ id, sessionId: screen.sessionId })} />}
      {screen.name === 'export' && <ExportScreen sessionId={screen.sessionId} go={go} changed={changed} fail={fail} />}
    </main>
    <footer>FieldOS v{APP_VERSION} · Data stays local until you export it.</footer>
  </div>;
}

interface SharedProps { go: (screen: Screen) => void; changed: (message?: string) => void; fail: (cause: unknown) => void; }

interface CampaignSummary { campaign: FieldCampaign; sessionCount: number; assetCount: number; }

function HomeScreen({ revision, go, changed, fail }: SharedProps & { revision: number }) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [sessions, setSessions] = useState<FieldSession[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [title, setTitle] = useState(''); const [observerName, setObserverName] = useState(''); const [purpose, setPurpose] = useState('');
  const [protocolId, setProtocolId] = useState(DEFAULT_PROTOCOL.protocolId);
  const [campaignTitle, setCampaignTitle] = useState(''); const [campaignProtocolId, setCampaignProtocolId] = useState(DEFAULT_PROTOCOL.protocolId);
  const selectedProtocol = BUILT_IN_PROTOCOLS.find((item) => item.protocolId === protocolId) ?? DEFAULT_PROTOCOL;
  const selectedCampaignProtocol = BUILT_IN_PROTOCOLS.find((item) => item.protocolId === campaignProtocolId) ?? DEFAULT_PROTOCOL;

  useEffect(() => {
    let active = true; setLoading(true);
    void (async () => {
      const [campaignRows, sessionRows] = await Promise.all([repositories.listCampaigns(), repositories.listSessions()]);
      const summaries = await Promise.all(campaignRows.map(async (campaign) => ({
        campaign,
        sessionCount: (await repositories.listCampaignSessions(campaign.id)).length,
        assetCount: (await repositories.listCampaignAssets(campaign.id)).length,
      })));
      const standalone = sessionRows.filter((session) => session.campaignId === null);
      const entries = await Promise.all(standalone.map(async (session) => [session.id, (await repositories.listObservations(session.id)).length] as const));
      if (active) {
        setCampaigns(summaries);
        setSessions(standalone.sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active')));
        setCounts(Object.fromEntries(entries)); setLoading(false);
      }
    })().catch((cause: unknown) => { if (active) { setLoading(false); fail(cause); } });
    return () => { active = false; };
  }, [fail, revision]);

  const createSession = async (event: FormEvent) => {
    event.preventDefault(); if (!title.trim()) return;
    try {
      await requestPersistence();
      const session = await repositories.createSession({ title: title.trim(), observerName: observerName.trim() || null, purpose: purpose.trim() || null, deviceLabel: navigator.userAgent, protocol: selectedProtocol });
      changed('Standalone session created locally.'); go({ name: 'session', sessionId: session.id });
    } catch (cause) { fail(cause); }
  };
  const createCampaign = async (event: FormEvent) => {
    event.preventDefault(); if (!campaignTitle.trim()) return;
    try {
      await requestPersistence();
      const campaign = await repositories.createCampaign({ title: campaignTitle.trim(), protocol: selectedCampaignProtocol });
      changed('Campaign created locally.'); go({ name: 'campaign', campaignId: campaign.id });
    } catch (cause) { fail(cause); }
  };

  return <section className="page">
    <div className="eyebrow">FieldOS</div><h1>Prepare a mission, then capture offline.</h1><p className="lede">Import a FieldPack or start a local campaign, then run protocol-bound field sessions. Nothing is uploaded automatically.</p>

    <div className="section-heading"><h2>Campaigns</h2><div className="button-row"><button className="secondary" onClick={() => go({ name: 'importFieldpack' })}>Import FieldPack</button><button className="secondary" onClick={() => setShowCampaignForm((value) => !value)}>+ New campaign</button></div></div>
    {showCampaignForm && <form className="card form-stack" onSubmit={(event) => void createCampaign(event)}><label>Campaign title <span>required</span><input autoFocus value={campaignTitle} onChange={(event) => setCampaignTitle(event.target.value)} placeholder="Summer coastal monitoring" required /></label>{BUILT_IN_PROTOCOLS.length > 1 ? <label>Protocol <span>bound for the whole campaign</span><select value={campaignProtocolId} onChange={(event) => setCampaignProtocolId(event.target.value)}>{BUILT_IN_PROTOCOLS.map((item) => <option key={`${item.protocolId}-${item.version}`} value={item.protocolId}>{item.name} · v{item.version}</option>)}</select></label> : <div className="protocol-chip"><span className="field-label">Protocol</span><strong>{selectedCampaignProtocol.name} · v{selectedCampaignProtocol.version}</strong><small className="muted">Defines every session's categories and values. Bound at creation and never changed.</small></div>}<div className="button-row"><button className="primary" type="submit">Create campaign</button><button className="ghost" type="button" onClick={() => setShowCampaignForm(false)}>Cancel</button></div></form>}
    {loading ? <p className="muted">Reading local data…</p> : campaigns.length === 0 ? <div className="empty"><strong>No campaigns yet.</strong><span>Import a FieldPack or create a local campaign to group sessions under one protocol and planned assets.</span></div> : <div className="list">{campaigns.map(({ campaign, sessionCount, assetCount }) => <button className="session-card" key={campaign.id} onClick={() => go({ name: 'campaign', campaignId: campaign.id })}><div><strong>{campaign.title}</strong><span>{protocolForSession({ protocolSnapshot: campaign.protocolSnapshot }).protocol.name} · {sessionCount} session{sessionCount === 1 ? '' : 's'} · {assetCount} planned asset{assetCount === 1 ? '' : 's'}</span></div><span className="status">{campaign.source.type === 'fieldpack' ? `FieldPack v${campaign.source.fieldpackVersion}` : 'Local'}</span></button>)}</div>}

    <div className="section-heading"><h2>Standalone sessions</h2><div className="button-row"><button className="ghost" onClick={() => go({ name: 'restore' })}>Restore backup</button><button className="secondary" onClick={() => setShowForm((value) => !value)}>+ New session</button></div></div>
    {showForm && <form className="card form-stack" onSubmit={(event) => void createSession(event)}><label>Session title <span>required</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Coastal trail survey" required /></label><label>Observer name <span>optional, unverified</span><input value={observerName} onChange={(event) => setObserverName(event.target.value)} /></label><label>Purpose <span>optional</span><textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} rows={2} /></label>{BUILT_IN_PROTOCOLS.length > 1 ? <label>Protocol <span>bound for the whole session</span><select value={protocolId} onChange={(event) => setProtocolId(event.target.value)}>{BUILT_IN_PROTOCOLS.map((item) => <option key={`${item.protocolId}-${item.version}`} value={item.protocolId}>{item.name} · v{item.version}</option>)}</select></label> : <div className="protocol-chip"><span className="field-label">Protocol</span><strong>{selectedProtocol.name} · v{selectedProtocol.version}</strong><small className="muted">Defines this session’s observation categories and values. Bound at creation and never changed.</small></div>}<div className="button-row"><button className="primary" type="submit">Create session</button><button className="ghost" type="button" onClick={() => setShowForm(false)}>Cancel</button></div></form>}
    {loading ? null : sessions.length === 0 ? <div className="empty"><strong>No standalone sessions.</strong><span>Standalone sessions live outside any campaign and remain on this device until exported.</span></div> : <div className="list">{sessions.map((session) => <button className="session-card" key={session.id} onClick={() => go({ name: 'session', sessionId: session.id })}><div><strong>{session.title}</strong><span>{formatTime(session.createdAt)} · {counts[session.id] ?? 0} observations</span></div><span className={`status ${session.status}`}>{session.status}</span></button>)}</div>}
  </section>;
}

function CampaignScreen({ campaignId, revision, go, changed, fail }: SharedProps & { campaignId: Uuid; revision: number }) {
  const [campaign, setCampaign] = useState<FieldCampaign | null>(null);
  const [sessions, setSessions] = useState<FieldSession[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [title, setTitle] = useState(''); const [observerName, setObserverName] = useState(''); const [purpose, setPurpose] = useState('');
  useEffect(() => {
    let active = true; setLoading(true);
    void (async () => {
      const found = await repositories.getCampaign(campaignId);
      if (!found) throw new Error(`Campaign ${campaignId} was not found on this device.`);
      const [campaignSessions, campaignAssets] = await Promise.all([repositories.listCampaignSessions(campaignId), repositories.listCampaignAssets(campaignId)]);
      if (active) { setCampaign(found); setSessions(campaignSessions); setAssets(campaignAssets); setLoading(false); }
    })().catch((cause: unknown) => { if (active) { setLoading(false); fail(cause); } });
    return () => { active = false; };
  }, [campaignId, fail, revision]);

  const startSession = async (event: FormEvent) => {
    event.preventDefault(); if (!campaign || !title.trim()) return; setStarting(true);
    try {
      await requestPersistence();
      // The campaign already defines the protocol — the dedicated path snapshots the campaign's own
      // protocol into the session. The user never re-selects a protocol here, and a mismatched one
      // could not be persisted even if a caller tried.
      const session = await repositories.createCampaignSession(campaignId, { title: title.trim(), observerName: observerName.trim() || null, purpose: purpose.trim() || null, deviceLabel: navigator.userAgent });
      changed('Campaign session created locally.'); go({ name: 'session', sessionId: session.id });
    } catch (cause) { fail(cause); } finally { setStarting(false); }
  };

  if (loading || !campaign) return <section className="page"><button className="back" onClick={() => go({ name: 'home' })}>← Home</button><p className="muted">Reading campaign…</p></section>;
  const protocol = campaign.protocolSnapshot;
  const activeSession = sessions.find((session) => session.status === 'active');
  const typeCounts = assets.reduce<Record<string, number>>((acc, asset) => { const key = asset.assetType ?? 'unclassified'; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
  return <section className="page">
    <button className="back" onClick={() => go({ name: 'home' })}>← Home</button>
    <div className="eyebrow">{campaign.source.type === 'fieldpack' ? `Campaign · FieldPack ${campaign.source.fieldpackId} v${campaign.source.fieldpackVersion}` : 'Campaign · local'}</div>
    <h1>{campaign.title}</h1>
    {campaign.description && <p className="lede">{campaign.description}</p>}
    <div className="card detail-grid"><div><span>Protocol</span><strong>{protocol.name} · v{protocol.version}</strong></div><div><span>Sessions</span><strong>{sessions.length}</strong></div><div><span>Planned assets</span><strong>{assets.length}</strong></div>{campaign.importedAt && <div><span>Imported</span><strong>{formatTime(campaign.importedAt)}</strong></div>}</div>

    {activeSession
      ? <button className="primary wide" onClick={() => go({ name: 'session', sessionId: activeSession.id })}>Resume “{activeSession.title}”</button>
      : null}

    <details className="card" open={sessions.length === 0}><summary>Start a field session</summary>
      <form className="form-stack" onSubmit={(event) => void startSession(event)}>
        <p className="muted">This session uses the campaign protocol <strong>{protocol.name} · v{protocol.version}</strong> — it cannot be changed per session.</p>
        <label>Session title <span>required</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Morning walk-through" required /></label>
        <label>Observer name <span>optional, unverified</span><input value={observerName} onChange={(event) => setObserverName(event.target.value)} /></label>
        <label>Purpose <span>optional</span><textarea rows={2} value={purpose} onChange={(event) => setPurpose(event.target.value)} /></label>
        <button className="primary" type="submit" disabled={starting || !title.trim()}>{starting ? 'Creating…' : 'Start field session'}</button>
      </form>
    </details>

    <div className="section-heading"><h2>Sessions</h2></div>
    {sessions.length === 0 ? <div className="empty"><strong>No sessions yet.</strong><span>Start the first field session for this campaign above.</span></div> : <div className="list">{sessions.map((session) => <button className="session-card" key={session.id} onClick={() => go({ name: 'session', sessionId: session.id })}><div><strong>{session.title}</strong><span>{formatTime(session.createdAt)}</span></div><span className={`status ${session.status}`}>{session.status}</span></button>)}</div>}

    <details className="card assets-panel"><summary>Planned assets ({assets.length})</summary>{assets.length > 0 ? <><p className="muted">{Object.entries(typeCounts).map(([type, count]) => `${readable(type)}: ${count}`).join(' · ')}</p><ul>{assets.map((asset) => <li key={asset.id}><strong>{asset.name}</strong><span>{asset.assetType ? readable(asset.assetType) : 'Unclassified'}{asset.latitude !== null ? ` · ${asset.latitude.toFixed(5)}, ${asset.longitude?.toFixed(5)}` : ''}{asset.sourceRef ? ` · ref ${asset.sourceRef}` : ''}</span></li>)}</ul></> : <p className="muted">No planned assets in this campaign.</p>}</details>
  </section>;
}

function ImportFieldpackScreen({ go, changed, fail }: SharedProps) {
  const [inspection, setInspection] = useState<FieldPackInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const choose = async (file: File | null) => {
    if (!file) return; setBusy(true); setInspection(null);
    try {
      // Full validation (manifest, SHA-256, protocol, GeoJSON) and the collision check run before any
      // write. Selecting a file never touches IndexedDB.
      setInspection(await preflightFieldPackImport(repositories, await inspectFieldPackFile(file)));
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!inspection || inspection.collision.kind !== 'none') return; setBusy(true);
    try {
      const result = await installFieldPackImport(repositories, inspection);
      changed(`Campaign installed: “${result.title}” with ${result.assetCount} planned asset${result.assetCount === 1 ? '' : 's'}.`);
      go({ name: 'campaign', campaignId: result.campaignId });
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  };
  const collisionMessage = inspection?.collision.kind === 'duplicate'
    ? 'This exact FieldPack (same id and version) is already installed. Duplicate import is blocked.'
    : inspection?.collision.kind === 'unsupported_upgrade'
      ? `A campaign from this FieldPack id is already installed at version ${inspection.collision.existingVersion}. Automatic upgrades are not supported in v1.`
      : null;
  return <section className="page export-page">
    <button className="back" onClick={() => go({ name: 'home' })}>← Home</button>
    <div className="eyebrow">Import</div><h1>Import a FieldPack</h1>
    <p className="lede">Choose a trusted <code>.fieldpack</code> file. It is validated and previewed before anything is written, and works fully offline once imported.</p>
    <label className="card form-stack">FieldPack file<input type="file" accept=".fieldpack,.zip,application/zip" disabled={busy} onChange={(event) => void choose(event.target.files?.[0] ?? null)} /></label>
    {busy && <p className="muted">Inspecting FieldPack…</p>}
    {inspection && <article className="export-card featured">
      <div><span className="export-kicker">Import preview</span><h2>{inspection.manifest.title}</h2>
        {inspection.manifest.description && <p>{inspection.manifest.description}</p>}
        <p>FieldPack <strong>{inspection.manifest.fieldpackId}</strong> · v{inspection.manifest.fieldpackVersion} · schema {inspection.manifest.fieldpackSchemaVersion}</p>
        <p>Protocol <strong>{inspection.protocol.name}</strong> · v{inspection.protocol.version} · {inspection.protocol.categories.length} categories</p>
        <p>{inspection.assets.length} planned asset{inspection.assets.length === 1 ? '' : 's'}{Object.keys(inspection.assetTypeBreakdown).length ? ` · ${Object.entries(inspection.assetTypeBreakdown).map(([type, count]) => `${readable(type)}: ${count}`).join(' · ')}` : ''}</p>
        <p>Integrity <strong>{inspection.integrityStatus}</strong> · compatibility <strong>{inspection.compatibility}</strong></p>
        {inspection.warnings.map((warning) => <p className="muted" key={warning}>{warning}</p>)}
        {collisionMessage && <p className="error">{collisionMessage}</p>}
      </div>
      <button className="primary" disabled={busy || inspection.collision.kind !== 'none'} onClick={() => void confirm()}>Confirm import</button>
    </article>}
    <p className="muted">Integrity confirms only that payload bytes match this FieldPack’s manifest; it is not a signature, a trusted publisher, or authenticated methodology.</p>
  </section>;
}

function SessionScreen({ sessionId, revision, go, changed, fail, canUndo, undoDelete }: SharedProps & { sessionId: Uuid; revision: number; canUndo: boolean; undoDelete: () => Promise<void> }) {
  const [session, setSession] = useState<FieldSession | null>(null); const [observations, setObservations] = useState<Observation[]>([]); const [assets, setAssets] = useState<Asset[]>([]); const [mediaCounts, setMediaCounts] = useState<Record<string, MediaCounts>>({});
  const [assetName, setAssetName] = useState(''); const [assetType, setAssetType] = useState<AssetType>('other'); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [nextSession, nextObservations] = await Promise.all([repositories.getSession(sessionId), repositories.listObservations(sessionId)]);
    if (!nextSession) throw new Error(`Session ${sessionId} was not found on this device.`);
    // Resolve session-dropped assets PLUS the campaign's planned assets (when campaign-bound).
    const nextAssets = await repositories.listSessionAssets(nextSession);
    const media = await Promise.all(nextObservations.map(async (observation) => [observation.id, countMedia(await repositories.listMedia(observation.id))] as const));
    setSession(nextSession); setObservations(nextObservations); setAssets(nextAssets); setMediaCounts(Object.fromEntries(media));
  }, [sessionId]);
  useEffect(() => { void load().catch(fail); }, [fail, load, revision]);
  const dropAsset = async () => {
    if (!assetName.trim()) return; setBusy(true);
    try {
      const location = await captureCurrentLocation();
      if (location.locationStatus !== 'CAPTURED' || location.latitude === null || location.longitude === null) throw new Error(`Could not drop the asset: location ${location.locationStatus.toLowerCase()}.`);
      await requestPersistence(); await repositories.createAsset({ sessionId, name: assetName.trim(), assetType, latitude: location.latitude, longitude: location.longitude }); setAssetName(''); changed('Asset saved at the current GPS position.');
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  };
  const closeSession = async () => { if (!confirm('Close this session? Existing observations remain available and exportable.')) return; try { await repositories.closeSession(sessionId); changed('Session closed.'); } catch (cause) { fail(cause); } };
  if (!session) return <section className="page"><p>Opening local session…</p></section>;
  const { protocol } = protocolForSession(session);
  return <section className="page session-page">
    <button className="back" onClick={() => go(session.campaignId ? { name: 'campaign', campaignId: session.campaignId } : { name: 'home' })}>← {session.campaignId ? 'Campaign' : 'Sessions'}</button><div className="session-title"><div><div className="eyebrow">{session.status} session{session.campaignId ? ' · campaign' : ''}</div><h1>{session.title}</h1><p>{observations.length} observations · {assets.length} assets</p></div><div className="session-title-actions"><button className="secondary" onClick={() => go({ name: 'map', sessionId })}>Map</button><button className="secondary" onClick={() => go({ name: 'export', sessionId })}>Export & backup</button></div></div>
    {canUndo && <div className="undo">Observation removed. <button onClick={() => void undoDelete()}>Undo</button></div>}
    <div className="section-heading"><h2>Observations</h2></div>
    {observations.length === 0 ? <div className="empty"><strong>No observations yet.</strong><span>Use the capture button to record the first one.</span></div> : <div className="list">{observations.map((observation) => <button className="observation-card" key={observation.id} onClick={() => go({ name: 'detail', sessionId, observationId: observation.id })}><div className="observation-icon">{resolveCategoryLabel(protocol, observation.observation.category).slice(0, 1)}</div><div><strong>{resolveCategoryLabel(protocol, observation.observation.category)}</strong><span>{observation.observation.value ? resolveValueLabel(protocol, observation.observation.category, observation.observation.value) : observation.note || 'Free observation'}</span><small>{formatTime(observation.capturedAt)} · {observation.capturedLocation.locationStatus === 'CAPTURED' ? `±${Math.round(observation.capturedLocation.accuracyMeters ?? 0)}m` : `GPS ${readable(observation.capturedLocation.locationStatus)}`}{mediaCounts[observation.id] && summarizeMedia(mediaCounts[observation.id]!) ? ` · ${summarizeMedia(mediaCounts[observation.id]!)}` : ''}{observation.edited ? ` · Edited ×${observation.editCount}` : ''}</small></div><span aria-hidden="true">›</span></button>)}</div>}
    <details className="card assets-panel"><summary>Known assets ({assets.length})</summary>{assets.length > 0 && <ul>{assets.map((asset) => <li key={asset.id}><strong>{asset.name}</strong><span>{asset.assetType ? readable(asset.assetType) : 'Unclassified'}{asset.latitude !== null ? ` · ${asset.latitude.toFixed(5)}, ${asset.longitude?.toFixed(5)}` : ' · No coordinates'}</span></li>)}</ul>}<div className="asset-form"><input value={assetName} onChange={(event) => setAssetName(event.target.value)} placeholder="Asset name" aria-label="Asset name" /><select value={assetType} onChange={(event) => setAssetType(event.target.value as AssetType)} aria-label="Asset type">{assetTypes.map((type) => <option key={type} value={type}>{readable(type)}</option>)}</select><button className="secondary" disabled={busy || !assetName.trim()} onClick={() => void dropAsset()}>{busy ? 'Getting GPS…' : '+ Drop asset here'}</button></div></details>
    <div className="session-actions">{session.status === 'active' && <button className="ghost danger-text" onClick={() => void closeSession()}>Close session</button>}</div>
    {session.status === 'active' ? <button className="capture-bar" onClick={() => go({ name: 'capture', sessionId })}>+ New observation</button> : <div className="closed-bar">Session closed · review or export existing evidence</div>}
  </section>;
}

function MapScreen({ sessionId, revision, go, fail }: SharedProps & { sessionId: Uuid; revision: number }) {
  const [session, setSession] = useState<FieldSession | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true; setLoading(true);
    void Promise.all([repositories.getSession(sessionId), repositories.listObservations(sessionId)])
      .then(async ([nextSession, nextObservations]) => {
        if (!active) return;
        if (!nextSession) throw new Error(`Session ${sessionId} was not found on this device.`);
        const nextAssets = await repositories.listSessionAssets(nextSession);
        if (!active) return;
        setSession(nextSession); setObservations(nextObservations); setAssets(nextAssets); setLoading(false);
      })
      .catch((cause: unknown) => { if (active) { setLoading(false); fail(cause); } });
    return () => { active = false; };
  }, [fail, revision, sessionId]);
  return <section className="page map-page">
    <button className="back" onClick={() => go({ name: 'session', sessionId })}>← Session</button>
    <div className="map-heading"><div className="eyebrow">Spatial view · online basemap</div><h1>{session?.title ?? 'Field map'}</h1><p className="muted">Tap a point to inspect it. Adjusted observation pins are marked; raw GPS is never overwritten.</p></div>
    {loading ? <p className="muted">Reading local data…</p> : <Suspense fallback={<div className="map-loading" role="status">Loading map…</div>}><FieldMap observations={observations} assets={assets} protocol={protocolForSession(session).protocol} onOpenObservation={(id) => go({ name: 'detail', sessionId, observationId: id })} /></Suspense>}
  </section>;
}

function CaptureScreen({ sessionId, go, changed, fail }: SharedProps & { sessionId: Uuid }) {
  const [capturedAt] = useState(nowIso()); const [location, setLocation] = useState<CapturedLocation>(() => unavailableLocation('UNAVAILABLE')); const [locating, setLocating] = useState(true);
  const [protocol, setProtocol] = useState<FieldProtocol>(DEFAULT_PROTOCOL);
  const [category, setCategory] = useState<string | null>(null); const [value, setValue] = useState<string | null>(null); const [evidence, setEvidence] = useState<EvidenceForm>(emptyEvidence); const [note, setNote] = useState(''); const [photo, setPhoto] = useState<File | null>(null); const [audio, setAudio] = useState<AudioRecording | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]); const [assetId, setAssetId] = useState(''); const [saving, setSaving] = useState(false);
  const acquireLocation = useCallback(async () => { setLocating(true); const next = await captureCurrentLocation(); setLocation(next); setLocating(false); }, []);
  useEffect(() => {
    void acquireLocation();
    // Load the session once, then resolve its protocol and the assets visible in it (session +
    // campaign planned assets) so a campaign observation can link a planned asset.
    void repositories.getSession(sessionId).then(async (s) => {
      if (!s) return;
      setProtocol(protocolForSession(s).protocol);
      setAssets(await repositories.listSessionAssets(s));
    }).catch(fail);
  }, [acquireLocation, fail, sessionId]);
  const assetOptions = useMemo(() => {
    if (location.latitude === null || location.longitude === null) return assets.map((asset) => ({ asset, distanceMeters: null }));
    return nearbyAssets({ latitude: location.latitude, longitude: location.longitude }, assets);
  }, [assets, location.latitude, location.longitude]);
  const activeCategory = category ? protocol.categories.find((item) => item.id === category) ?? null : null;
  const categoryValues = category ? getProtocolValues(protocol, category) : [];
  const selectCategory = (next: string) => { setCategory(next); const values = getProtocolValues(protocol, next); setValue(values[0]?.id ?? null); };
  const save = async () => {
    if (!category) return; setSaving(true);
    try {
      await requestPersistence();
      const observation = await repositories.createObservation({ sessionId, capturedAt, capturedLocation: location, observation: observationValueFor(protocol, category, value), evidence: evidenceFromForm(evidence), note: note.trim() || null, assetId: assetId || null });
      const saved: string[] = []; const failed: string[] = [];
      if (photo) { try { await repositories.addMedia({ observationId: observation.id, kind: 'photo', blob: photo, mimeType: photo.type || 'application/octet-stream', originalFilename: photo.name || null }); saved.push('photo'); } catch { failed.push('photo'); } }
      if (audio) { try { await repositories.addMedia({ observationId: observation.id, kind: 'audio', blob: audio.blob, mimeType: audio.mimeType, capturedAt: audio.startedAt, originalFilename: audioFilename(audio) }); saved.push('voice note'); } catch { failed.push('voice note'); } }
      let message = saved.length > 0 ? `Observation and ${saved.join(' and ')} saved locally.` : 'Observation saved locally.';
      if (failed.length > 0) message = `Observation${saved.length ? ` and ${saved.join(' and ')}` : ''} saved, but the ${failed.join(' and ')} could not be stored. The observation itself was not lost — back up or free device space.`;
      changed(message); go({ name: 'session', sessionId });
    } catch (cause) { fail(cause); } finally { setSaving(false); }
  };
  return <section className="page capture-page">
    <button className="back" onClick={() => go({ name: 'session', sessionId })}>← Cancel</button><div className="eyebrow">New observation</div><h1>What do you see?</h1>
    <div className={`location-card ${location.locationStatus === 'CAPTURED' ? 'good' : ''}`}><div><strong>{locating ? 'Getting a GPS fix…' : location.locationStatus === 'CAPTURED' ? `${location.latitude?.toFixed(5)}, ${location.longitude?.toFixed(5)}` : `GPS ${readable(location.locationStatus)}`}</strong><span>{formatTime(capturedAt)} · {location.locationStatus === 'CAPTURED' ? `Accuracy ±${Math.round(location.accuracyMeters ?? 0)}m` : 'You can still save without a location.'}</span></div><button className="ghost" disabled={locating} onClick={() => void acquireLocation()}>Re-fix</button></div>
    <fieldset><legend>1. Category <span>required</span></legend><div className="choice-grid">{protocol.categories.map((item) => <button type="button" key={item.id} className={category === item.id ? 'choice selected' : 'choice'} onClick={() => selectCategory(item.id)}>{item.label}</button>)}</div>{activeCategory?.description && <p className="field-hint">{activeCategory.description}</p>}</fieldset>
    {category && categoryValues.length > 0 && <fieldset><legend>2. Value</legend><div className="value-row">{categoryValues.map((item) => <button type="button" key={item.id} className={value === item.id ? 'pill selected' : 'pill'} onClick={() => setValue(item.id)}>{item.label}</button>)}</div></fieldset>}
    <fieldset><legend>{category ? '3' : '2'}. Evidence</legend><div className="segmented">{(['OBSERVED', 'MEASURED', 'REPORTED'] as EvidenceMethod[]).map((method) => <button type="button" key={method} className={evidence.method === method ? 'selected' : ''} onClick={() => setEvidence((current) => ({ ...current, method }))}>{readable(method)}</button>)}</div>{evidence.method === 'MEASURED' && <div className="two-column"><label>Value<input inputMode="decimal" value={evidence.measuredValue} onChange={(event) => setEvidence((current) => ({ ...current, measuredValue: event.target.value }))} /></label><label>Unit<input value={evidence.measuredUnit} onChange={(event) => setEvidence((current) => ({ ...current, measuredUnit: event.target.value }))} placeholder="people, dB, cm…" /></label><label className="span-two">Context<input value={evidence.measuredContext} onChange={(event) => setEvidence((current) => ({ ...current, measuredContext: event.target.value }))} /></label></div>}{evidence.method === 'REPORTED' && <label>Source note <span>optional</span><input value={evidence.reportedSource} onChange={(event) => setEvidence((current) => ({ ...current, reportedSource: event.target.value }))} placeholder="Who reported this?" /></label>}</fieldset>
    <fieldset><legend>Context</legend><label>Known asset <span>optional; nearest first</span><select value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">No linked asset</option>{assetOptions.map(({ asset, distanceMeters }) => <option key={asset.id} value={asset.id}>{asset.name}{distanceMeters === null ? '' : ` · ${Math.round(distanceMeters)}m away`}</option>)}</select></label><label>Note <span>optional</span><textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder={category === 'other' ? 'Describe the observation…' : 'Add useful context…'} /></label><PhotoSourcePicker value={photo} onChange={setPhoto} formatSize={formatBytes} /><div className="voice-field"><span className="field-label">Voice note <span className="field-hint">optional · stays on this device</span></span><VoiceRecorder value={audio} onChange={setAudio} /></div></fieldset>
    <button className="capture-bar" disabled={!category || saving} onClick={() => void save()}>{saving ? 'Saving locally…' : 'Save observation'}</button>
  </section>;
}

function DetailScreen({ sessionId, observationId, go, changed, fail, deleted }: SharedProps & { sessionId: Uuid; observationId: Uuid; deleted: (id: Uuid) => void }) {
  const [observation, setObservation] = useState<Observation | null>(null); const [session, setSession] = useState<FieldSession | null>(null); const [media, setMedia] = useState<MediaAttachment[]>([]); const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState<string>('other'); const [value, setValue] = useState<string | null>(null); const [evidence, setEvidence] = useState<EvidenceForm>(emptyEvidence); const [note, setNote] = useState('');
  const [adjusting, setAdjusting] = useState(false); const [latitude, setLatitude] = useState(''); const [longitude, setLongitude] = useState(''); const [reason, setReason] = useState('');
  const load = useCallback(async () => {
    const next = await repositories.getObservation(observationId); if (!next) throw new Error(`Observation ${observationId} was not found.`);
    setSession(await repositories.getSession(next.sessionId) ?? null);
    setObservation(next); setMedia(await repositories.listMedia(observationId)); setCategory(next.observation.category); setValue(next.observation.value); setNote(next.note ?? '');
    setEvidence(next.evidence.method === 'OBSERVED' ? emptyEvidence : next.evidence.method === 'MEASURED' ? { method: 'MEASURED', measuredValue: String(next.evidence.value), measuredUnit: next.evidence.unit, measuredContext: next.evidence.context ?? '', reportedSource: '' } : { method: 'REPORTED', measuredValue: '', measuredUnit: '', measuredContext: '', reportedSource: next.evidence.sourceNote ?? '' });
    const adjusted = next.locationAdjustment; setLatitude(String(adjusted?.latitude ?? next.capturedLocation.latitude ?? '')); setLongitude(String(adjusted?.longitude ?? next.capturedLocation.longitude ?? '')); setReason(adjusted?.locationAdjustmentReason ?? '');
  }, [observationId]);
  useEffect(() => { void load().catch(fail); }, [fail, load]);
  const { protocol } = protocolForSession(session);
  const categoryValues = getProtocolValues(protocol, category);
  const saveEdit = async () => { try { await repositories.updateInterpretation(observationId, { observation: observationValueFor(protocol, category, value), evidence: evidenceFromForm(evidence), note: note.trim() || null }); await load(); setEditing(false); changed('Interpretation updated; original capture preserved.'); } catch (cause) { fail(cause); } };
  const saveAdjustment = async () => {
    const lat = Number(latitude); const lon = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) { fail(new Error('Enter valid latitude and longitude.')); return; }
    try { await repositories.adjustLocation(observationId, { latitude: lat, longitude: lon, reason: reason.trim() || null }); await load(); setAdjusting(false); changed('Location adjustment saved separately from the raw GPS fix.'); } catch (cause) { fail(cause); }
  };
  const remove = async () => { if (!confirm('Remove this observation from the live list? It can be restored with Undo.')) return; try { await repositories.softDeleteObservation(observationId); deleted(observationId); changed(); go({ name: 'session', sessionId }); } catch (cause) { fail(cause); } };
  if (!observation) return <section className="page"><p>Opening observation…</p></section>;
  return <section className="page detail-page">
    <button className="back" onClick={() => go({ name: 'session', sessionId })}>← Session</button><div className="detail-heading"><div><div className="eyebrow">Observation{protocolForSession(session).isLegacy ? ' · legacy vocabulary' : ''}</div><h1>{resolveCategoryLabel(protocol, observation.observation.category)}</h1></div><button className="secondary" onClick={() => setEditing((current) => !current)}>{editing ? 'Cancel edit' : 'Edit'}</button></div>
    <div className="immutable-card"><span>Original capture · read only</span><strong>{formatTime(observation.capturedAt)}</strong><p>{observation.capturedLocation.locationStatus === 'CAPTURED' ? `${observation.capturedLocation.latitude}, ${observation.capturedLocation.longitude} · ±${Math.round(observation.capturedLocation.accuracyMeters ?? 0)}m` : `No GPS fix · ${readable(observation.capturedLocation.locationStatus)}`}</p></div>
    {editing ? <div className="card form-stack"><label>Category<select value={category} onChange={(event) => { const next = event.target.value; setCategory(next); const values = getProtocolValues(protocol, next); setValue(values[0]?.id ?? null); }}>{protocol.categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{categoryValues.length > 0 && <label>Value<select value={value ?? ''} onChange={(event) => setValue(event.target.value)}>{categoryValues.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}<label>Evidence<select value={evidence.method} onChange={(event) => setEvidence((current) => ({ ...current, method: event.target.value as EvidenceMethod }))}><option>OBSERVED</option><option>MEASURED</option><option>REPORTED</option></select></label>{evidence.method === 'MEASURED' && <div className="two-column"><label>Value<input value={evidence.measuredValue} onChange={(event) => setEvidence((current) => ({ ...current, measuredValue: event.target.value }))} /></label><label>Unit<input value={evidence.measuredUnit} onChange={(event) => setEvidence((current) => ({ ...current, measuredUnit: event.target.value }))} /></label><label className="span-two">Context<input value={evidence.measuredContext} onChange={(event) => setEvidence((current) => ({ ...current, measuredContext: event.target.value }))} /></label></div>}{evidence.method === 'REPORTED' && <label>Source note<input value={evidence.reportedSource} onChange={(event) => setEvidence((current) => ({ ...current, reportedSource: event.target.value }))} /></label>}<label>Note<textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="primary" onClick={() => void saveEdit()}>Save interpretation</button></div> : <div className="card detail-grid"><div><span>Value</span><strong>{observation.observation.value ? resolveValueLabel(protocol, observation.observation.category, observation.observation.value) : 'Free observation'}</strong></div><div><span>Evidence</span><strong>{readable(observation.evidence.method)}</strong></div><div className="span-two"><span>Note</span><p>{observation.note || 'No note'}</p></div></div>}
    <PhotoGallery media={media} />
    <VoiceEvidence media={media} />
    <section className="card"><div className="section-heading"><h2>Location adjustment</h2><button className="ghost" onClick={() => setAdjusting((current) => !current)}>{adjusting ? 'Cancel' : observation.locationAdjustment ? 'Update' : 'Adjust'}</button></div>{observation.locationAdjustment && <p className="muted">Effective location: {observation.locationAdjustment.latitude}, {observation.locationAdjustment.longitude}. Raw GPS remains unchanged.</p>}{adjusting && <div className="form-stack"><div className="two-column"><label>Latitude<input inputMode="decimal" value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label><label>Longitude<input inputMode="decimal" value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label></div><label>Reason <span>optional</span><input value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="secondary" onClick={() => void saveAdjustment()}>Save separate adjustment</button></div>}</section>
    <ObservationHistory observationId={observation.id} refreshToken={observation.updatedAt} protocol={protocol} />
    {observation.edited && <p className="audit">Edited ×{observation.editCount} · last change {formatTime(observation.updatedAt)}</p>}<button className="ghost danger-text" onClick={() => void remove()}>Remove observation</button>
  </section>;
}

function PhotoGallery({ media }: { media: MediaAttachment[] }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => { const next = media.filter((item) => item.kind === 'photo').map((item) => URL.createObjectURL(item.blob)); setUrls(next); return () => next.forEach((url) => URL.revokeObjectURL(url)); }, [media]);
  if (urls.length === 0) return null;
  return <div className="photos">{urls.map((url, index) => <img key={url} src={url} alt={`Observation evidence ${index + 1}`} />)}</div>;
}

function VoiceEvidence({ media }: { media: MediaAttachment[] }) {
  const audio = useMemo(() => media.filter((item) => item.kind === 'audio'), [media]);
  const [tracks, setTracks] = useState<{ id: Uuid; url: string; capturedAt: string }[]>([]);
  useEffect(() => {
    const next = audio.map((item) => ({ id: item.id, url: URL.createObjectURL(item.blob), capturedAt: item.capturedAt }));
    setTracks(next);
    return () => next.forEach((track) => URL.revokeObjectURL(track.url));
  }, [audio]);
  if (tracks.length === 0) return null;
  return <section className="card voice-evidence"><div className="section-heading"><h2>Voice evidence</h2></div>{tracks.map((track) => <div className="voice-evidence-item" key={track.id}><small className="muted">Recorded {formatTime(track.capturedAt)}</small>{/* eslint-disable-next-line jsx-a11y/media-has-caption -- field voice memo, no caption track */}<audio controls src={track.url} preload="metadata" /></div>)}</section>;
}

function RestoreScreen({ go, changed, fail }: SharedProps) {
  const [inspection, setInspection] = useState<RestoreInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const choose = async (file: File | null) => {
    if (!file) return;
    setBusy(true); setInspection(null);
    try {
      // Inspection, validation, hash verification, and collision checking all happen before a
      // restore is available to confirm. This selection action never writes to IndexedDB.
      setInspection(await preflightRestore(repositories, await inspectRestoreFile(file)));
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!inspection || inspection.collisions.length) return;
    setBusy(true);
    try {
      const result = await restoreInspection(repositories, inspection);
      changed(`${result.outcome === 'RESTORED_FULL' ? 'Full backup restored' : 'Structured evidence restored without media'}: ${result.observationCount} observations, ${result.mediaCount} media files. Integrity: ${result.integrityStatus}.`);
      go({ name: 'session', sessionId: result.sessionId });
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  };
  return <section className="page export-page">
    <button className="back" onClick={() => go({ name: 'home' })}>← Sessions</button>
    <div className="eyebrow">Restore</div><h1>Restore a FieldOS backup</h1>
    <p className="lede">Choose a full FieldOS ZIP backup or canonical observations.json. Nothing is written until you confirm.</p>
    <label className="card form-stack">Backup file<input type="file" accept=".zip,application/zip,.json,application/json" disabled={busy} onChange={(event) => void choose(event.target.files?.[0] ?? null)} /></label>
    {busy && <p className="muted">Inspecting backup…</p>}
    {inspection && <article className="export-card featured">
      <div><span className="export-kicker">Restore preview</span><h2>{inspection.bundle.session.title}</h2>
        <p>{formatTime(inspection.bundle.session.createdAt)} · {inspection.bundle.observations.length} observations · {inspection.bundle.assets.length} assets · {inspection.bundle.media.length} media attachments · {inspection.bundle.auditEntries.length} audit entries</p>
        <p>FieldOS schema {inspection.bundle.fieldosSchemaVersion} · app {inspection.bundle.appVersion} · {inspection.source === 'FULL_BACKUP' ? 'Full backup' : 'Data-only JSON'} · integrity <strong>{inspection.integrityStatus}</strong></p>
        {inspection.warnings.map((warning) => <p className="muted" key={warning}>{warning}</p>)}
        {inspection.collisions.length > 0 && <p className="error">Restore blocked: {inspection.collisions.length} imported ID{inspection.collisions.length === 1 ? '' : 's'} already exist locally. Existing evidence will not be changed.</p>}
      </div>
      <button className="primary" disabled={busy || inspection.collisions.length > 0} onClick={() => void confirm()}>Confirm restore</button>
    </article>}
    <p className="muted">SHA-256 verification confirms only that payload bytes match this archive’s manifest; it is not a signature, authentication, or legal chain of custody.</p>
  </section>;
}

function ExportScreen({ sessionId, go, changed, fail }: SharedProps & { sessionId: Uuid }) {
  const [session, setSession] = useState<FieldSession | null>(null); const [observationCount, setObservationCount] = useState(0); const [recordCount, setRecordCount] = useState(0); const [mediaCount, setMediaCount] = useState(0); const [busy, setBusy] = useState(false);
  useEffect(() => { void buildSessionBundle(repositories, sessionId).then(({ bundle }) => { setSession(bundle.session); setObservationCount(bundle.observations.filter((item) => !item.deleted).length); setRecordCount(bundle.observations.length); setMediaCount(bundle.media.length); }).catch(fail); }, [fail, sessionId]);
  const dataExport = async () => { setBusy(true); try { const { bundle } = await buildSessionBundle(repositories, sessionId); const files = buildDataExportFiles(bundle).map((file) => new File([file.content], file.filename, { type: file.mimeType })); const action = await deliverFiles(files); changed(`Data export ${action}.`); } catch (cause) { fail(cause); } finally { setBusy(false); } };
  const backup = async () => { setBusy(true); try { const archive = await buildSessionBackup(repositories, sessionId); const file = new File([new Uint8Array(archive.zipBytes)], archive.filename, { type: 'application/zip' }); const action = await deliverFiles([file]); changed(`Full backup ${action}: ${archive.manifest.observationCount} records and ${archive.manifest.mediaCount} media files.`); } catch (cause) { const detail = cause instanceof Error ? cause.message : String(cause); fail(new Error(`${detail} Use Data export as the no-media fallback so the structured evidence can still leave this device.`)); } finally { setBusy(false); } };
  return <section className="page export-page"><button className="back" onClick={() => go({ name: 'session', sessionId })}>← Session</button><div className="eyebrow">Export & backup</div><h1>{session?.title ?? 'Session'}</h1><p className="lede">{observationCount} live observations{recordCount > observationCount ? ` · ${recordCount - observationCount} recoverable deleted` : ''} · {mediaCount} media files</p><div className="privacy-warning"><strong>Contains sensitive field evidence.</strong><span> Files may include precise coordinates, notes, observer identity, and photographs.</span></div><article className="export-card"><div><span className="export-kicker">Analysis copy</span><h2>Data export</h2><p>Three portable files: canonical JSON, CSV, and GeoJSON. Media is not included.</p></div><button className="secondary" disabled={busy || recordCount === 0} onClick={() => void dataExport()}>Export 3 files</button></article><article className="export-card featured"><div><span className="export-kicker">Durability backstop</span><h2>Full session backup</h2><p>One ZIP with a manifest, all three data files, deleted records, and every stored media file.</p></div><button className="primary" disabled={busy || recordCount === 0} onClick={() => void backup()}>Create full backup</button></article>{recordCount === 0 && <p className="muted">Nothing to export yet.</p>}<p className="muted">Generated entirely on this device. FieldOS does not upload these files.</p></section>;
}
