import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { repositories } from './db/repositories';
import { captureCurrentLocation, unavailableLocation } from './domain/geolocation';
import { nearbyAssets } from './domain/geo';
import { evidenceFromForm, observationValueFor, type EvidenceForm } from './domain/observationForm';
import { nowIso } from './domain/time';
import { CATEGORY_VALUES, type Asset, type AssetType, type CapturedLocation, type EvidenceMethod, type FieldSession, type MediaAttachment, type Observation, type ObservationCategory, type Uuid } from './domain/types';
import { buildSessionBackup, buildDataExportFiles } from './export/backup';
import { buildSessionBundle } from './export/bundle';
import { extensionForMime } from './export/types';
import { getStorageHealth, requestPersistence, type StorageHealth } from './storage/storageHealth';
import { VoiceRecorder } from './components/VoiceRecorder';
import { countMedia, summarizeMedia, type MediaCounts } from './media/mediaSummary';
import type { AudioRecording } from './media/audioRecorder';
import { APP_VERSION } from './version';
import './app.css';

type Screen =
  | { name: 'home' }
  | { name: 'session'; sessionId: Uuid }
  | { name: 'capture'; sessionId: Uuid }
  | { name: 'detail'; sessionId: Uuid; observationId: Uuid }
  | { name: 'export'; sessionId: Uuid };

const categoryLabels: Record<ObservationCategory, string> = {
  visitor_pressure: 'Visitor pressure', parking_pressure: 'Parking pressure', path_condition: 'Path condition',
  litter: 'Litter', infrastructure_condition: 'Infrastructure', signage_condition: 'Signage',
  accessibility_barrier: 'Accessibility', visitor_management: 'Visitor management', other: 'Other',
};
const categories = Object.keys(categoryLabels) as ObservationCategory[];
const assetTypes: AssetType[] = ['trailhead', 'car_park', 'viewpoint', 'visitor_centre', 'path_segment', 'public_space', 'other'];
const emptyEvidence: EvidenceForm = { method: 'OBSERVED', measuredValue: '', measuredUnit: '', measuredContext: '', reportedSource: '' };

function readable(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

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
      {screen.name === 'session' && <SessionScreen sessionId={screen.sessionId} revision={revision} go={go} changed={changed} fail={fail} canUndo={lastDeleted?.sessionId === screen.sessionId} undoDelete={undoDelete} />}
      {screen.name === 'capture' && <CaptureScreen sessionId={screen.sessionId} go={go} changed={changed} fail={fail} />}
      {screen.name === 'detail' && <DetailScreen sessionId={screen.sessionId} observationId={screen.observationId} go={go} changed={changed} fail={fail} deleted={(id) => setLastDeleted({ id, sessionId: screen.sessionId })} />}
      {screen.name === 'export' && <ExportScreen sessionId={screen.sessionId} go={go} changed={changed} fail={fail} />}
    </main>
    <footer>FieldOS v{APP_VERSION} · Data stays local until you export it.</footer>
  </div>;
}

interface SharedProps { go: (screen: Screen) => void; changed: (message?: string) => void; fail: (cause: unknown) => void; }

function HomeScreen({ revision, go, changed, fail }: SharedProps & { revision: number }) {
  const [sessions, setSessions] = useState<FieldSession[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState(''); const [observerName, setObserverName] = useState(''); const [purpose, setPurpose] = useState('');

  useEffect(() => {
    let active = true; setLoading(true);
    void repositories.listSessions().then(async (rows) => {
      const entries = await Promise.all(rows.map(async (session) => [session.id, (await repositories.listObservations(session.id)).length] as const));
      if (active) { setSessions(rows.sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'))); setCounts(Object.fromEntries(entries)); setLoading(false); }
    }).catch((cause: unknown) => { if (active) { setLoading(false); fail(cause); } });
    return () => { active = false; };
  }, [fail, revision]);

  const createSession = async (event: FormEvent) => {
    event.preventDefault(); if (!title.trim()) return;
    try {
      await requestPersistence();
      const session = await repositories.createSession({ title: title.trim(), observerName: observerName.trim() || null, purpose: purpose.trim() || null, deviceLabel: navigator.userAgent });
      changed('Session created locally.'); go({ name: 'session', sessionId: session.id });
    } catch (cause) { fail(cause); }
  };
  const activeSession = sessions.find((session) => session.status === 'active');
  return <section className="page">
    <div className="eyebrow">Field sessions</div><h1>Capture evidence, even without a signal.</h1><p className="lede">Start or resume a local field campaign. Nothing is uploaded automatically.</p>
    {activeSession && <button className="primary wide" onClick={() => go({ name: 'session', sessionId: activeSession.id })}>Resume “{activeSession.title}”</button>}
    <div className="section-heading"><h2>On this device</h2><button className="secondary" onClick={() => setShowForm((value) => !value)}>+ New session</button></div>
    {showForm && <form className="card form-stack" onSubmit={(event) => void createSession(event)}><label>Session title <span>required</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Coastal trail survey" required /></label><label>Observer name <span>optional, unverified</span><input value={observerName} onChange={(event) => setObserverName(event.target.value)} /></label><label>Purpose <span>optional</span><textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} rows={2} /></label><div className="button-row"><button className="primary" type="submit">Create session</button><button className="ghost" type="button" onClick={() => setShowForm(false)}>Cancel</button></div></form>}
    {loading ? <p className="muted">Reading local data…</p> : sessions.length === 0 ? <div className="empty"><strong>No sessions yet.</strong><span>Start your first field session; it will remain on this device until exported.</span></div> : <div className="list">{sessions.map((session) => <button className="session-card" key={session.id} onClick={() => go({ name: 'session', sessionId: session.id })}><div><strong>{session.title}</strong><span>{formatTime(session.createdAt)} · {counts[session.id] ?? 0} observations</span></div><span className={`status ${session.status}`}>{session.status}</span></button>)}</div>}
  </section>;
}

function SessionScreen({ sessionId, revision, go, changed, fail, canUndo, undoDelete }: SharedProps & { sessionId: Uuid; revision: number; canUndo: boolean; undoDelete: () => Promise<void> }) {
  const [session, setSession] = useState<FieldSession | null>(null); const [observations, setObservations] = useState<Observation[]>([]); const [assets, setAssets] = useState<Asset[]>([]); const [mediaCounts, setMediaCounts] = useState<Record<string, MediaCounts>>({});
  const [assetName, setAssetName] = useState(''); const [assetType, setAssetType] = useState<AssetType>('other'); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [nextSession, nextObservations, nextAssets] = await Promise.all([repositories.getSession(sessionId), repositories.listObservations(sessionId), repositories.listAssets(sessionId)]);
    if (!nextSession) throw new Error(`Session ${sessionId} was not found on this device.`);
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
  return <section className="page session-page">
    <button className="back" onClick={() => go({ name: 'home' })}>← Sessions</button><div className="session-title"><div><div className="eyebrow">{session.status} session</div><h1>{session.title}</h1><p>{observations.length} observations · {assets.length} assets</p></div><button className="secondary" onClick={() => go({ name: 'export', sessionId })}>Export & backup</button></div>
    {canUndo && <div className="undo">Observation removed. <button onClick={() => void undoDelete()}>Undo</button></div>}
    <div className="section-heading"><h2>Observations</h2></div>
    {observations.length === 0 ? <div className="empty"><strong>No observations yet.</strong><span>Use the capture button to record the first one.</span></div> : <div className="list">{observations.map((observation) => <button className="observation-card" key={observation.id} onClick={() => go({ name: 'detail', sessionId, observationId: observation.id })}><div className="observation-icon">{categoryLabels[observation.observation.category].slice(0, 1)}</div><div><strong>{categoryLabels[observation.observation.category]}</strong><span>{observation.observation.value ? readable(observation.observation.value) : observation.note || 'Free observation'}</span><small>{formatTime(observation.capturedAt)} · {observation.capturedLocation.locationStatus === 'CAPTURED' ? `±${Math.round(observation.capturedLocation.accuracyMeters ?? 0)}m` : `GPS ${readable(observation.capturedLocation.locationStatus)}`}{mediaCounts[observation.id] && summarizeMedia(mediaCounts[observation.id]!) ? ` · ${summarizeMedia(mediaCounts[observation.id]!)}` : ''}{observation.edited ? ` · Edited ×${observation.editCount}` : ''}</small></div><span aria-hidden="true">›</span></button>)}</div>}
    <details className="card assets-panel"><summary>Known assets ({assets.length})</summary>{assets.length > 0 && <ul>{assets.map((asset) => <li key={asset.id}><strong>{asset.name}</strong><span>{asset.assetType ? readable(asset.assetType) : 'Unclassified'}{asset.latitude !== null ? ` · ${asset.latitude.toFixed(5)}, ${asset.longitude?.toFixed(5)}` : ' · No coordinates'}</span></li>)}</ul>}<div className="asset-form"><input value={assetName} onChange={(event) => setAssetName(event.target.value)} placeholder="Asset name" aria-label="Asset name" /><select value={assetType} onChange={(event) => setAssetType(event.target.value as AssetType)} aria-label="Asset type">{assetTypes.map((type) => <option key={type} value={type}>{readable(type)}</option>)}</select><button className="secondary" disabled={busy || !assetName.trim()} onClick={() => void dropAsset()}>{busy ? 'Getting GPS…' : '+ Drop asset here'}</button></div></details>
    <div className="session-actions">{session.status === 'active' && <button className="ghost danger-text" onClick={() => void closeSession()}>Close session</button>}</div>
    {session.status === 'active' ? <button className="capture-bar" onClick={() => go({ name: 'capture', sessionId })}>+ New observation</button> : <div className="closed-bar">Session closed · review or export existing evidence</div>}
  </section>;
}

function CaptureScreen({ sessionId, go, changed, fail }: SharedProps & { sessionId: Uuid }) {
  const [capturedAt] = useState(nowIso()); const [location, setLocation] = useState<CapturedLocation>(() => unavailableLocation('UNAVAILABLE')); const [locating, setLocating] = useState(true);
  const [category, setCategory] = useState<ObservationCategory | null>(null); const [value, setValue] = useState<string | null>(null); const [evidence, setEvidence] = useState<EvidenceForm>(emptyEvidence); const [note, setNote] = useState(''); const [photo, setPhoto] = useState<File | null>(null); const [audio, setAudio] = useState<AudioRecording | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]); const [assetId, setAssetId] = useState(''); const [saving, setSaving] = useState(false);
  const acquireLocation = useCallback(async () => { setLocating(true); const next = await captureCurrentLocation(); setLocation(next); setLocating(false); }, []);
  useEffect(() => { void acquireLocation(); void repositories.listAssets(sessionId).then(setAssets).catch(fail); }, [acquireLocation, fail, sessionId]);
  const assetOptions = useMemo(() => {
    if (location.latitude === null || location.longitude === null) return assets.map((asset) => ({ asset, distanceMeters: null }));
    return nearbyAssets({ latitude: location.latitude, longitude: location.longitude }, assets);
  }, [assets, location.latitude, location.longitude]);
  const selectCategory = (next: ObservationCategory) => { setCategory(next); setValue(CATEGORY_VALUES[next][0] ?? null); };
  const save = async () => {
    if (!category) return; setSaving(true);
    try {
      await requestPersistence();
      const observation = await repositories.createObservation({ sessionId, capturedAt, capturedLocation: location, observation: observationValueFor(category, value), evidence: evidenceFromForm(evidence), note: note.trim() || null, assetId: assetId || null });
      const saved: string[] = []; const failed: string[] = [];
      if (photo) { try { await repositories.addMedia({ observationId: observation.id, kind: 'photo', blob: photo, mimeType: photo.type || 'application/octet-stream', originalFilename: photo.name || null }); saved.push('photo'); } catch { failed.push('photo'); } }
      if (audio) { try { await repositories.addMedia({ observationId: observation.id, kind: 'audio', blob: audio.blob, mimeType: audio.mimeType, capturedAt: audio.startedAt, originalFilename: audioFilename(audio) }); saved.push('voice note'); } catch { failed.push('voice note'); } }
      let message = saved.length > 0 ? `Observation and ${saved.join(' and ')} saved locally.` : 'Observation saved locally.';
      if (failed.length > 0) message = `Observation${saved.length ? ` and ${saved.join(' and ')}` : ''} saved, but the ${failed.join(' and ')} could not be stored. The observation itself was not lost — back up or free device space.`;
      changed(message); go({ name: 'session', sessionId });
    } catch (cause) { fail(cause); } finally { setSaving(false); }
  };
  const setPhotoFromInput = (event: ChangeEvent<HTMLInputElement>) => setPhoto(event.target.files?.[0] ?? null);
  return <section className="page capture-page">
    <button className="back" onClick={() => go({ name: 'session', sessionId })}>← Cancel</button><div className="eyebrow">New observation</div><h1>What do you see?</h1>
    <div className={`location-card ${location.locationStatus === 'CAPTURED' ? 'good' : ''}`}><div><strong>{locating ? 'Getting a GPS fix…' : location.locationStatus === 'CAPTURED' ? `${location.latitude?.toFixed(5)}, ${location.longitude?.toFixed(5)}` : `GPS ${readable(location.locationStatus)}`}</strong><span>{formatTime(capturedAt)} · {location.locationStatus === 'CAPTURED' ? `Accuracy ±${Math.round(location.accuracyMeters ?? 0)}m` : 'You can still save without a location.'}</span></div><button className="ghost" disabled={locating} onClick={() => void acquireLocation()}>Re-fix</button></div>
    <fieldset><legend>1. Category <span>required</span></legend><div className="choice-grid">{categories.map((item) => <button type="button" key={item} className={category === item ? 'choice selected' : 'choice'} onClick={() => selectCategory(item)}>{categoryLabels[item]}</button>)}</div></fieldset>
    {category && CATEGORY_VALUES[category].length > 0 && <fieldset><legend>2. Value</legend><div className="value-row">{CATEGORY_VALUES[category].map((item) => <button type="button" key={item} className={value === item ? 'pill selected' : 'pill'} onClick={() => setValue(item)}>{readable(item)}</button>)}</div></fieldset>}
    <fieldset><legend>{category ? '3' : '2'}. Evidence</legend><div className="segmented">{(['OBSERVED', 'MEASURED', 'REPORTED'] as EvidenceMethod[]).map((method) => <button type="button" key={method} className={evidence.method === method ? 'selected' : ''} onClick={() => setEvidence((current) => ({ ...current, method }))}>{readable(method)}</button>)}</div>{evidence.method === 'MEASURED' && <div className="two-column"><label>Value<input inputMode="decimal" value={evidence.measuredValue} onChange={(event) => setEvidence((current) => ({ ...current, measuredValue: event.target.value }))} /></label><label>Unit<input value={evidence.measuredUnit} onChange={(event) => setEvidence((current) => ({ ...current, measuredUnit: event.target.value }))} placeholder="people, dB, cm…" /></label><label className="span-two">Context<input value={evidence.measuredContext} onChange={(event) => setEvidence((current) => ({ ...current, measuredContext: event.target.value }))} /></label></div>}{evidence.method === 'REPORTED' && <label>Source note <span>optional</span><input value={evidence.reportedSource} onChange={(event) => setEvidence((current) => ({ ...current, reportedSource: event.target.value }))} placeholder="Who reported this?" /></label>}</fieldset>
    <fieldset><legend>Context</legend><label>Known asset <span>optional; nearest first</span><select value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">No linked asset</option>{assetOptions.map(({ asset, distanceMeters }) => <option key={asset.id} value={asset.id}>{asset.name}{distanceMeters === null ? '' : ` · ${Math.round(distanceMeters)}m away`}</option>)}</select></label><label>Note <span>optional</span><textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder={category === 'other' ? 'Describe the observation…' : 'Add useful context…'} /></label><label className="photo-input">Photo <span>optional</span><input type="file" accept="image/*" capture="environment" onChange={setPhotoFromInput} />{photo && <small>{photo.name} · {formatBytes(photo.size)}</small>}</label><div className="voice-field"><span className="field-label">Voice note <span className="field-hint">optional · stays on this device</span></span><VoiceRecorder value={audio} onChange={setAudio} /></div></fieldset>
    <button className="capture-bar" disabled={!category || saving} onClick={() => void save()}>{saving ? 'Saving locally…' : 'Save observation'}</button>
  </section>;
}

function DetailScreen({ sessionId, observationId, go, changed, fail, deleted }: SharedProps & { sessionId: Uuid; observationId: Uuid; deleted: (id: Uuid) => void }) {
  const [observation, setObservation] = useState<Observation | null>(null); const [media, setMedia] = useState<MediaAttachment[]>([]); const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState<ObservationCategory>('other'); const [value, setValue] = useState<string | null>(null); const [evidence, setEvidence] = useState<EvidenceForm>(emptyEvidence); const [note, setNote] = useState('');
  const [adjusting, setAdjusting] = useState(false); const [latitude, setLatitude] = useState(''); const [longitude, setLongitude] = useState(''); const [reason, setReason] = useState('');
  const load = useCallback(async () => {
    const next = await repositories.getObservation(observationId); if (!next) throw new Error(`Observation ${observationId} was not found.`);
    setObservation(next); setMedia(await repositories.listMedia(observationId)); setCategory(next.observation.category); setValue(next.observation.value); setNote(next.note ?? '');
    setEvidence(next.evidence.method === 'OBSERVED' ? emptyEvidence : next.evidence.method === 'MEASURED' ? { method: 'MEASURED', measuredValue: String(next.evidence.value), measuredUnit: next.evidence.unit, measuredContext: next.evidence.context ?? '', reportedSource: '' } : { method: 'REPORTED', measuredValue: '', measuredUnit: '', measuredContext: '', reportedSource: next.evidence.sourceNote ?? '' });
    const adjusted = next.locationAdjustment; setLatitude(String(adjusted?.latitude ?? next.capturedLocation.latitude ?? '')); setLongitude(String(adjusted?.longitude ?? next.capturedLocation.longitude ?? '')); setReason(adjusted?.locationAdjustmentReason ?? '');
  }, [observationId]);
  useEffect(() => { void load().catch(fail); }, [fail, load]);
  const saveEdit = async () => { try { await repositories.updateInterpretation(observationId, { observation: observationValueFor(category, value), evidence: evidenceFromForm(evidence), note: note.trim() || null }); await load(); setEditing(false); changed('Interpretation updated; original capture preserved.'); } catch (cause) { fail(cause); } };
  const saveAdjustment = async () => {
    const lat = Number(latitude); const lon = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) { fail(new Error('Enter valid latitude and longitude.')); return; }
    try { await repositories.adjustLocation(observationId, { latitude: lat, longitude: lon, reason: reason.trim() || null }); await load(); setAdjusting(false); changed('Location adjustment saved separately from the raw GPS fix.'); } catch (cause) { fail(cause); }
  };
  const remove = async () => { if (!confirm('Remove this observation from the live list? It can be restored with Undo.')) return; try { await repositories.softDeleteObservation(observationId); deleted(observationId); changed(); go({ name: 'session', sessionId }); } catch (cause) { fail(cause); } };
  if (!observation) return <section className="page"><p>Opening observation…</p></section>;
  return <section className="page detail-page">
    <button className="back" onClick={() => go({ name: 'session', sessionId })}>← Session</button><div className="detail-heading"><div><div className="eyebrow">Observation</div><h1>{categoryLabels[observation.observation.category]}</h1></div><button className="secondary" onClick={() => setEditing((current) => !current)}>{editing ? 'Cancel edit' : 'Edit'}</button></div>
    <div className="immutable-card"><span>Original capture · read only</span><strong>{formatTime(observation.capturedAt)}</strong><p>{observation.capturedLocation.locationStatus === 'CAPTURED' ? `${observation.capturedLocation.latitude}, ${observation.capturedLocation.longitude} · ±${Math.round(observation.capturedLocation.accuracyMeters ?? 0)}m` : `No GPS fix · ${readable(observation.capturedLocation.locationStatus)}`}</p></div>
    {editing ? <div className="card form-stack"><label>Category<select value={category} onChange={(event) => { const next = event.target.value as ObservationCategory; setCategory(next); setValue(CATEGORY_VALUES[next][0] ?? null); }}>{categories.map((item) => <option key={item} value={item}>{categoryLabels[item]}</option>)}</select></label>{CATEGORY_VALUES[category].length > 0 && <label>Value<select value={value ?? ''} onChange={(event) => setValue(event.target.value)}>{CATEGORY_VALUES[category].map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select></label>}<label>Evidence<select value={evidence.method} onChange={(event) => setEvidence((current) => ({ ...current, method: event.target.value as EvidenceMethod }))}><option>OBSERVED</option><option>MEASURED</option><option>REPORTED</option></select></label>{evidence.method === 'MEASURED' && <div className="two-column"><label>Value<input value={evidence.measuredValue} onChange={(event) => setEvidence((current) => ({ ...current, measuredValue: event.target.value }))} /></label><label>Unit<input value={evidence.measuredUnit} onChange={(event) => setEvidence((current) => ({ ...current, measuredUnit: event.target.value }))} /></label><label className="span-two">Context<input value={evidence.measuredContext} onChange={(event) => setEvidence((current) => ({ ...current, measuredContext: event.target.value }))} /></label></div>}{evidence.method === 'REPORTED' && <label>Source note<input value={evidence.reportedSource} onChange={(event) => setEvidence((current) => ({ ...current, reportedSource: event.target.value }))} /></label>}<label>Note<textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="primary" onClick={() => void saveEdit()}>Save interpretation</button></div> : <div className="card detail-grid"><div><span>Value</span><strong>{observation.observation.value ? readable(observation.observation.value) : 'Free observation'}</strong></div><div><span>Evidence</span><strong>{readable(observation.evidence.method)}</strong></div><div className="span-two"><span>Note</span><p>{observation.note || 'No note'}</p></div></div>}
    <PhotoGallery media={media} />
    <VoiceEvidence media={media} />
    <section className="card"><div className="section-heading"><h2>Location adjustment</h2><button className="ghost" onClick={() => setAdjusting((current) => !current)}>{adjusting ? 'Cancel' : observation.locationAdjustment ? 'Update' : 'Adjust'}</button></div>{observation.locationAdjustment && <p className="muted">Effective location: {observation.locationAdjustment.latitude}, {observation.locationAdjustment.longitude}. Raw GPS remains unchanged.</p>}{adjusting && <div className="form-stack"><div className="two-column"><label>Latitude<input inputMode="decimal" value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label><label>Longitude<input inputMode="decimal" value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label></div><label>Reason <span>optional</span><input value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="secondary" onClick={() => void saveAdjustment()}>Save separate adjustment</button></div>}</section>
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

function ExportScreen({ sessionId, go, changed, fail }: SharedProps & { sessionId: Uuid }) {
  const [session, setSession] = useState<FieldSession | null>(null); const [observationCount, setObservationCount] = useState(0); const [recordCount, setRecordCount] = useState(0); const [mediaCount, setMediaCount] = useState(0); const [busy, setBusy] = useState(false);
  useEffect(() => { void buildSessionBundle(repositories, sessionId).then(({ bundle }) => { setSession(bundle.session); setObservationCount(bundle.observations.filter((item) => !item.deleted).length); setRecordCount(bundle.observations.length); setMediaCount(bundle.media.length); }).catch(fail); }, [fail, sessionId]);
  const dataExport = async () => { setBusy(true); try { const { bundle } = await buildSessionBundle(repositories, sessionId); const files = buildDataExportFiles(bundle).map((file) => new File([file.content], file.filename, { type: file.mimeType })); const action = await deliverFiles(files); changed(`Data export ${action}.`); } catch (cause) { fail(cause); } finally { setBusy(false); } };
  const backup = async () => { setBusy(true); try { const archive = await buildSessionBackup(repositories, sessionId); const file = new File([new Uint8Array(archive.zipBytes)], archive.filename, { type: 'application/zip' }); const action = await deliverFiles([file]); changed(`Full backup ${action}: ${archive.manifest.observationCount} records and ${archive.manifest.mediaCount} media files.`); } catch (cause) { const detail = cause instanceof Error ? cause.message : String(cause); fail(new Error(`${detail} Use Data export as the no-media fallback so the structured evidence can still leave this device.`)); } finally { setBusy(false); } };
  return <section className="page export-page"><button className="back" onClick={() => go({ name: 'session', sessionId })}>← Session</button><div className="eyebrow">Export & backup</div><h1>{session?.title ?? 'Session'}</h1><p className="lede">{observationCount} live observations{recordCount > observationCount ? ` · ${recordCount - observationCount} recoverable deleted` : ''} · {mediaCount} media files</p><div className="privacy-warning"><strong>Contains sensitive field evidence.</strong><span> Files may include precise coordinates, notes, observer identity, and photographs.</span></div><article className="export-card"><div><span className="export-kicker">Analysis copy</span><h2>Data export</h2><p>Three portable files: canonical JSON, CSV, and GeoJSON. Media is not included.</p></div><button className="secondary" disabled={busy || recordCount === 0} onClick={() => void dataExport()}>Export 3 files</button></article><article className="export-card featured"><div><span className="export-kicker">Durability backstop</span><h2>Full session backup</h2><p>One ZIP with a manifest, all three data files, deleted records, and every stored media file.</p></div><button className="primary" disabled={busy || recordCount === 0} onClick={() => void backup()}>Create full backup</button></article>{recordCount === 0 && <p className="muted">Nothing to export yet.</p>}<p className="muted">Generated entirely on this device. FieldOS does not upload these files.</p></section>;
}
