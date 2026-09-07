import { describe, expect, it } from 'vitest';
import { makeTestRepos } from '../test/helpers';
import { ProtocolValidationError } from '../protocol/validation';
import { TOURISM_CORE_PROTOCOL } from '../protocol/tourismCore';
import { TEST_HEAT_PROTOCOL } from '../fixtures/testProtocol';
import type { CapturedLocation, FieldSession } from '../domain/types';

const goodFix = (): CapturedLocation => ({
  latitude: 47.37, longitude: 8.54, accuracyMeters: 5, altitudeMeters: 667,
  altitudeAccuracyMeters: 4.5, headingDegrees: 127, speedMetersPerSecond: 1.8,
  locationStatus: 'CAPTURED', capturedAt: '2026-08-21T09:00:00.000+02:00',
});

describe('session ↔ protocol binding', () => {
  it('binds the default Tourism Core snapshot to a new session', async () => {
    const { repos } = makeTestRepos();
    const session = await repos.createSession({ title: 'Default' });
    expect(session.protocolSnapshot?.protocolId).toBe('fieldos-tourism-core');
    expect(session.protocolSnapshot).toEqual(TOURISM_CORE_PROTOCOL);
    // Stored snapshot is a COPY — mutating the registry object never reaches it.
    expect(session.protocolSnapshot).not.toBe(TOURISM_CORE_PROTOCOL);
  });

  it('binds an alternate chosen protocol', async () => {
    const { repos } = makeTestRepos();
    const session = await repos.createSession({ title: 'Heat', protocol: TEST_HEAT_PROTOCOL });
    expect(session.protocolSnapshot?.protocolId).toBe('fieldos-test-heat');
    expect(await repos.getSession(session.id)).toEqual(session);
  });

  it('refuses to bind a malformed protocol at creation', async () => {
    const { repos } = makeTestRepos();
    const bad = { ...TEST_HEAT_PROTOCOL, categories: [] };
    await expect(repos.createSession({ title: 'Bad', protocol: bad })).rejects.toBeInstanceOf(ProtocolValidationError);
  });

  it('normalizes a legacy session with no snapshot to null WITHOUT rewriting the row', async () => {
    const { repos, db } = makeTestRepos();
    const created = await repos.createSession({ title: 'Legacy' });
    const legacy = { ...created };
    delete (legacy as Record<string, unknown>).protocolSnapshot; // simulate a pre-Protocol-Engine row
    await db.fieldSessions.put(legacy as FieldSession);

    expect((await repos.getSession(created.id))?.protocolSnapshot).toBeNull();
    expect((await repos.listSessions())[0]?.protocolSnapshot).toBeNull();
    // The stored row is not rewritten to carry a fabricated snapshot.
    const stored = await db.fieldSessions.get(created.id);
    expect(stored).not.toHaveProperty('protocolSnapshot');
  });

  it('never mutates the snapshot through ordinary editing or closing', async () => {
    const { repos } = makeTestRepos();
    const session = await repos.createSession({ title: 'Immutable', protocol: TEST_HEAT_PROTOCOL });
    const original = structuredClone(session.protocolSnapshot);

    const obs = await repos.createObservation({
      sessionId: session.id, capturedLocation: goodFix(),
      observation: { category: 'heat_exposure', value: 'SHADED' }, evidence: { method: 'OBSERVED' },
    });
    await repos.updateInterpretation(obs.id, { observation: { category: 'heat_exposure', value: 'EXPOSED' } });
    await repos.adjustLocation(obs.id, { latitude: 1, longitude: 2 });
    await repos.closeSession(session.id);

    const reread = await repos.getSession(session.id);
    expect(reread?.protocolSnapshot).toEqual(original);
    expect(reread?.status).toBe('closed');
  });
});

describe('observation write validation against the session protocol', () => {
  it('accepts a valid observation and rejects an unknown category', async () => {
    const { repos } = makeTestRepos();
    const session = await repos.createSession({ title: 'Heat', protocol: TEST_HEAT_PROTOCOL });

    await expect(repos.createObservation({
      sessionId: session.id, capturedLocation: goodFix(),
      observation: { category: 'heat_exposure', value: 'PARTIAL' }, evidence: { method: 'OBSERVED' },
    })).resolves.toMatchObject({ observation: { category: 'heat_exposure', value: 'PARTIAL' } });

    // A Tourism Core category is NOT part of this heat-protocol session.
    await expect(repos.createObservation({
      sessionId: session.id, capturedLocation: goodFix(),
      observation: { category: 'parking_pressure', value: 'FULL' }, evidence: { method: 'OBSERVED' },
    })).rejects.toBeInstanceOf(ProtocolValidationError);
  });

  it('rejects a wrong value for a category', async () => {
    const { repos } = makeTestRepos();
    const session = await repos.createSession({ title: 'Heat', protocol: TEST_HEAT_PROTOCOL });
    await expect(repos.createObservation({
      sessionId: session.id, capturedLocation: goodFix(),
      observation: { category: 'heat_exposure', value: 'FULL' }, evidence: { method: 'OBSERVED' },
    })).rejects.toBeInstanceOf(ProtocolValidationError);
  });

  it('enforces a required note policy on create', async () => {
    const { repos } = makeTestRepos();
    const session = await repos.createSession({ title: 'Heat', protocol: TEST_HEAT_PROTOCOL });
    // heat_incident requires a note.
    await expect(repos.createObservation({
      sessionId: session.id, capturedLocation: goodFix(),
      observation: { category: 'heat_incident', value: null }, evidence: { method: 'OBSERVED' }, note: null,
    })).rejects.toBeInstanceOf(ProtocolValidationError);
    // With a note it succeeds.
    await expect(repos.createObservation({
      sessionId: session.id, capturedLocation: goodFix(),
      observation: { category: 'heat_incident', value: null }, evidence: { method: 'OBSERVED' }, note: 'collapse near summit',
    })).resolves.toBeTruthy();
  });

  it('rejects an out-of-protocol edit and rolls the transaction back', async () => {
    const { repos, db } = makeTestRepos();
    const session = await repos.createSession({ title: 'Heat', protocol: TEST_HEAT_PROTOCOL });
    const obs = await repos.createObservation({
      sessionId: session.id, capturedLocation: goodFix(),
      observation: { category: 'heat_exposure', value: 'SHADED' }, evidence: { method: 'OBSERVED' },
    });
    const auditBefore = await db.observationAudit.where('observationId').equals(obs.id).count();

    await expect(repos.updateInterpretation(obs.id, {
      observation: { category: 'heat_exposure', value: 'NOPE' },
    })).rejects.toBeInstanceOf(ProtocolValidationError);

    // Nothing changed: value preserved, editCount untouched, no new audit entry.
    const reread = await repos.getObservation(obs.id);
    expect(reread?.observation).toEqual({ category: 'heat_exposure', value: 'SHADED' });
    expect(reread?.editCount).toBe(0);
    expect(await db.observationAudit.where('observationId').equals(obs.id).count()).toBe(auditBefore);
  });

  it('validates a LEGACY (null-snapshot) session against the legacy Tourism vocabulary', async () => {
    const { repos, db } = makeTestRepos();
    const created = await repos.createSession({ title: 'Legacy' });
    const legacy = { ...created };
    delete (legacy as Record<string, unknown>).protocolSnapshot;
    await db.fieldSessions.put(legacy as FieldSession);

    // A legacy tourism category/value is still accepted.
    await expect(repos.createObservation({
      sessionId: created.id, capturedLocation: goodFix(),
      observation: { category: 'litter', value: 'HIGH' }, evidence: { method: 'OBSERVED' },
    })).resolves.toBeTruthy();
    // An unknown category is still rejected for a legacy session.
    await expect(repos.createObservation({
      sessionId: created.id, capturedLocation: goodFix(),
      observation: { category: 'heat_exposure', value: 'SHADED' }, evidence: { method: 'OBSERVED' },
    })).rejects.toBeInstanceOf(ProtocolValidationError);
  });
});
