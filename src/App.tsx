import { useCallback, useEffect, useState } from 'react';
import { repositories } from './db/repositories';
import { getStorageHealth, requestPersistence, type StorageHealth } from './storage/storageHealth';
import { seedFixture } from './fixtures/testFixture';
import { buildSessionBackup, buildDataExportFiles } from './export/backup';
import { buildSessionBundle } from './export/bundle';
import { APP_VERSION, SCHEMA_VERSION } from './version';
import type { FieldSession } from './domain/types';

/**
 * Phase 1A DEV/DEBUG SCREEN ONLY — not the polished field UI.
 * Its sole purpose is to verify persistence, provenance and export/backup on a real device.
 */
export function App() {
  const [health, setHealth] = useState<StorageHealth | null>(null);
  const [sessions, setSessions] = useState<FieldSession[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const say = useCallback((msg: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${msg}`, ...l]), []);

  const refresh = useCallback(async () => {
    setHealth(await getStorageHealth());
    setSessions(await repositories.listSessions());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      setBusy(true);
      try {
        await fn();
      } catch (err) {
        say(`ERROR (${label}): ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
        void refresh();
      }
    },
    [refresh, say],
  );

  const download = (data: string | Uint8Array, filename: string, mime: string) => {
    // Copy into a fresh ArrayBuffer-backed view so the Blob typing is satisfied.
    const part: BlobPart = typeof data === 'string' ? data : new Uint8Array(data);
    const url = URL.createObjectURL(new Blob([part], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const bytes = (n: number | null) => (n === null ? '—' : `${(n / 1024).toFixed(1)} KB`);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '0 auto', padding: 16, lineHeight: 1.5 }}>
      <h1 style={{ marginBottom: 4 }}>FieldOS</h1>
      <p style={{ marginTop: 0, color: '#6b7280' }}>
        Phase 1A foundation · dev/debug screen · app v{APP_VERSION} · schema v{SCHEMA_VERSION}
      </p>

      <section style={card}>
        <h2 style={h2}>Storage health</h2>
        {health ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Storage Manager supported: <b>{String(health.supported)}</b></li>
            <li>Persistent storage granted: <b>{String(health.persisted)}</b></li>
            <li>Usage: {bytes(health.estimate.usageBytes)} / Quota: {bytes(health.estimate.quotaBytes)}</li>
          </ul>
        ) : (
          <p>Checking…</p>
        )}
        <p style={{ color: '#6b7280', fontSize: 13 }}>
          Durability is not guaranteed — validate on a real device and rely on backups.
        </p>
        <button disabled={busy} style={btn} onClick={() => run('persist', async () => {
          const ok = await requestPersistence();
          say(`requestPersistence() → ${ok}`);
        })}>Request persistent storage</button>
      </section>

      <section style={card}>
        <h2 style={h2}>Data ({sessions.length} session{sessions.length === 1 ? '' : 's'})</h2>
        <button disabled={busy} style={btn} onClick={() => run('seed', async () => {
          const f = await seedFixture(repositories);
          say(`Seeded synthetic fixture: session ${f.sessionId.slice(0, 8)}… (10 obs, 3 media)`);
        })}>Seed synthetic fixture</button>
        <button disabled={busy} style={btn} onClick={() => run('refresh', async () => { await refresh(); })}>Refresh</button>

        <ul style={{ marginTop: 12, paddingLeft: 18 }}>
          {sessions.map((s) => (
            <li key={s.id} style={{ marginBottom: 8 }}>
              <b>{s.title}</b> <span style={{ color: '#6b7280' }}>({s.status})</span>
              <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                <button disabled={busy} style={btnSm} onClick={() => run('backup', async () => {
                  const backup = await buildSessionBackup(repositories, s.id);
                  download(backup.zipBytes, backup.filename, 'application/zip');
                  say(`Backup ZIP: ${backup.manifest.observationCount} obs, ${backup.manifest.mediaCount} media`);
                })}>Full backup (ZIP)</button>
                <button disabled={busy} style={btnSm} onClick={() => run('export', async () => {
                  const { bundle } = await buildSessionBundle(repositories, s.id);
                  const files = buildDataExportFiles(bundle);
                  for (const file of files) download(file.content, file.filename, file.mimeType);
                  say(`Data export: ${files.map((f) => f.filename).join(', ')}`);
                })}>Data export (json/csv/geojson)</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section style={card}>
        <h2 style={h2}>Log</h2>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12, color: '#374151' }}>
          {log.length ? log.join('\n') : 'No actions yet.'}
        </pre>
      </section>
    </main>
  );
}

const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginTop: 16 };
const h2: React.CSSProperties = { fontSize: 16, marginTop: 0 };
const btn: React.CSSProperties = { padding: '8px 12px', marginRight: 8, marginTop: 8, borderRadius: 6, border: '1px solid #d1d5db', background: '#f9fafb', cursor: 'pointer' };
const btnSm: React.CSSProperties = { ...btn, padding: '6px 10px', fontSize: 13, marginTop: 0 };
