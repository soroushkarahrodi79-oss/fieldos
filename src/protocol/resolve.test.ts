import { describe, expect, it } from 'vitest';
import { protocolForSession, resolveCategoryLabel, resolveValueLabel } from './resolve';
import { TOURISM_CORE_PROTOCOL } from './tourismCore';
import { TEST_HEAT_PROTOCOL } from '../fixtures/testProtocol';
import type { FieldSession } from '../domain/types';

function session(protocolSnapshot: FieldSession['protocolSnapshot']): FieldSession {
  return {
    id: 's', schemaVersion: 4, title: 'S', purpose: null, observerName: null,
    status: 'active', createdAt: 't', closedAt: null, updatedAt: 't', deviceLabel: null,
    protocolSnapshot,
  };
}

describe('protocolForSession', () => {
  it('returns the session snapshot when present', () => {
    const resolved = protocolForSession(session(TEST_HEAT_PROTOCOL));
    expect(resolved.isLegacy).toBe(false);
    expect(resolved.protocol.protocolId).toBe('fieldos-test-heat');
  });

  it('falls back to the legacy FieldOS vocabulary for a legacy (null-snapshot) session', () => {
    const resolved = protocolForSession(session(null));
    expect(resolved.isLegacy).toBe(true);
    expect(resolved.protocol).toBe(TOURISM_CORE_PROTOCOL);
    // A missing/undefined session resolves the same way.
    expect(protocolForSession(null).isLegacy).toBe(true);
  });
});

describe('label resolution', () => {
  it('resolves labels from the tourism protocol', () => {
    expect(resolveCategoryLabel(TOURISM_CORE_PROTOCOL, 'parking_pressure')).toBe('Parking pressure');
    expect(resolveValueLabel(TOURISM_CORE_PROTOCOL, 'parking_pressure', 'FULL')).toBe('Full');
    expect(resolveValueLabel(TOURISM_CORE_PROTOCOL, 'other', null)).toBe('');
  });

  it('a second protocol displays ITS OWN labels, not Tourism Core ones', () => {
    // These ids do not exist in Tourism Core; resolution must come from the passed protocol.
    expect(resolveCategoryLabel(TEST_HEAT_PROTOCOL, 'heat_exposure')).toBe('Heat exposure');
    expect(resolveValueLabel(TEST_HEAT_PROTOCOL, 'heat_exposure', 'EXPOSED')).toBe('Fully exposed');
    // And a Tourism Core id is unknown to the heat protocol → readable fallback, never a wrong label.
    expect(resolveCategoryLabel(TEST_HEAT_PROTOCOL, 'parking_pressure')).toBe('Parking Pressure');
  });

  it('falls back to a readable token when the protocol lacks the id', () => {
    expect(resolveCategoryLabel(TOURISM_CORE_PROTOCOL, 'unknown_thing')).toBe('Unknown Thing');
    expect(resolveValueLabel(TOURISM_CORE_PROTOCOL, 'litter', 'WEIRD_VALUE')).toBe('Weird Value');
  });
});
