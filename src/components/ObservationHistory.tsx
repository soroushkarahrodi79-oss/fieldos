import { useEffect, useState } from 'react';
import { repositories } from '../db/repositories';
import type {
  Evidence,
  LocationAdjustment,
  ObservationAuditEntry,
  ObservationAuditState,
  ObservationValue,
  Uuid,
} from '../domain/types';

/**
 * Read-only revision history for one observation (P1-5).
 *
 * This renders the append-only audit log. It NEVER shows the immutable raw capture block as
 * though it changed — only mutable interpretation/adjustment/lifecycle state appears here. Event
 * types are shown as text (not colour alone). No editing affordances exist on this surface.
 */

const EVENT_LABELS: Record<ObservationAuditEntry['eventType'], string> = {
  CREATED: 'Created',
  INTERPRETATION_UPDATED: 'Interpretation updated',
  LOCATION_ADJUSTED: 'Location adjusted',
  SOFT_DELETED: 'Removed from live list',
  RESTORED: 'Restored to live list',
};

function readable(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function describeObservationValue(value: ObservationValue): string {
  return value.value ? `${readable(value.category)} · ${readable(value.value)}` : readable(value.category);
}

function describeEvidence(evidence: Evidence): string {
  if (evidence.method === 'MEASURED') {
    const context = evidence.context ? `, ${evidence.context}` : '';
    return `Measured (${evidence.value} ${evidence.unit}${context})`;
  }
  if (evidence.method === 'REPORTED') {
    return evidence.sourceNote ? `Reported (${evidence.sourceNote})` : 'Reported';
  }
  return 'Observed';
}

function describeNote(note: string | null): string {
  if (!note) return 'no note';
  const trimmed = note.length > 60 ? `${note.slice(0, 57)}…` : note;
  return `“${trimmed}”`;
}

function describeAsset(assetId: Uuid | null): string {
  return assetId ? `linked (#${assetId.slice(0, 8)})` : 'no linked asset';
}

function describeAdjustment(adjustment: LocationAdjustment | null): string {
  if (!adjustment) return 'no manual adjustment';
  return `${adjustment.latitude}, ${adjustment.longitude}`;
}

interface FieldChange {
  field: string;
  from: string;
  to: string;
}

/** Concise field-level diff between two snapshots (used for interpretation edits). */
function interpretationChanges(
  before: ObservationAuditState,
  after: ObservationAuditState,
): FieldChange[] {
  const changes: FieldChange[] = [];
  if (JSON.stringify(before.observation) !== JSON.stringify(after.observation)) {
    changes.push({
      field: 'Category',
      from: describeObservationValue(before.observation),
      to: describeObservationValue(after.observation),
    });
  }
  if (JSON.stringify(before.evidence) !== JSON.stringify(after.evidence)) {
    changes.push({ field: 'Evidence', from: describeEvidence(before.evidence), to: describeEvidence(after.evidence) });
  }
  if (before.note !== after.note) {
    changes.push({ field: 'Note', from: describeNote(before.note), to: describeNote(after.note) });
  }
  if (before.assetId !== after.assetId) {
    changes.push({ field: 'Asset', from: describeAsset(before.assetId), to: describeAsset(after.assetId) });
  }
  return changes;
}

function EntryDetails({ entry }: { entry: ObservationAuditEntry }) {
  if (entry.eventType === 'INTERPRETATION_UPDATED' && entry.before) {
    const changes = interpretationChanges(entry.before, entry.after);
    if (changes.length === 0) return <p className="history-detail muted">No field-level changes recorded.</p>;
    return (
      <ul className="history-changes">
        {changes.map((change) => (
          <li key={change.field}>
            <span className="history-field">{change.field}:</span> {change.from} → {change.to}
          </li>
        ))}
      </ul>
    );
  }
  if (entry.eventType === 'LOCATION_ADJUSTED') {
    const reason = entry.after.locationAdjustment?.locationAdjustmentReason;
    return (
      <ul className="history-changes">
        <li>
          <span className="history-field">Adjustment:</span> {describeAdjustment(entry.before?.locationAdjustment ?? null)} →{' '}
          {describeAdjustment(entry.after.locationAdjustment)}
        </li>
        {reason && (
          <li>
            <span className="history-field">Reason:</span> {reason}
          </li>
        )}
        <li className="muted">Raw GPS capture unchanged.</li>
      </ul>
    );
  }
  if (entry.eventType === 'CREATED') {
    return (
      <p className="history-detail">
        Recorded as {describeObservationValue(entry.after.observation)} · {describeEvidence(entry.after.evidence)}.
      </p>
    );
  }
  return null;
}

export function ObservationHistory({
  observationId,
  refreshToken,
}: {
  observationId: Uuid;
  /** Any value that changes after a mutation, to trigger a reload (e.g. observation.updatedAt). */
  refreshToken?: string;
}) {
  const [entries, setEntries] = useState<ObservationAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    repositories
      .listObservationAuditEntries(observationId)
      .then((rows) => {
        if (active) {
          setEntries(rows);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [observationId, refreshToken]);

  if (error) {
    return (
      <section className="card observation-history">
        <div className="section-heading">
          <h2>History</h2>
        </div>
        <p className="muted">Revision history could not be read: {error}</p>
      </section>
    );
  }

  if (!entries) {
    return (
      <section className="card observation-history">
        <div className="section-heading">
          <h2>History</h2>
        </div>
        <p className="muted">Reading revision history…</p>
      </section>
    );
  }

  // Legacy boundary: an observation created before P1-5 has no CREATED event. Say so honestly
  // rather than presenting the first recorded change as if it were the original creation.
  const legacyBoundary = entries.length > 0 && entries[0]!.eventType !== 'CREATED';

  return (
    <section className="card observation-history">
      <div className="section-heading">
        <h2>History</h2>
      </div>
      {entries.length === 0 ? (
        <p className="muted">
          No revision history yet. Changes are recorded from the first edit made after audit logging
          was introduced.
        </p>
      ) : (
        <>
          {legacyBoundary && (
            <p className="history-legacy-note muted">
              Revision history begins with the first change recorded after audit logging was
              introduced; earlier history may not be available.
            </p>
          )}
          <ol className="history-list">
            {entries.map((entry) => (
              <li key={entry.id} className="history-entry">
                <div className="history-entry-head">
                  <span className="history-seq">{entry.sequence}</span>
                  <div>
                    <strong>{EVENT_LABELS[entry.eventType]}</strong>
                    <small className="muted">{formatTime(entry.occurredAt)}</small>
                  </div>
                </div>
                <EntryDetails entry={entry} />
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
