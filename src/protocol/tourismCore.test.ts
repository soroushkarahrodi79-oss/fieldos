import { describe, expect, it } from 'vitest';
import { TOURISM_CORE_PROTOCOL } from './tourismCore';
import { isValidProtocol } from './validation';

// This locks the built-in vocabulary to the exact P0 semantics. Protocol Engine v1 must NOT
// rename or reinterpret any machine id — it only makes the same vocabulary definition-driven.
const EXPECTED: Record<string, string[]> = {
  visitor_pressure: ['NONE', 'LOW', 'MODERATE', 'HIGH'],
  parking_pressure: ['LOW', 'MODERATE', 'HIGH', 'FULL'],
  path_condition: ['GOOD', 'FAIR', 'POOR', 'BLOCKED'],
  litter: ['NONE', 'LOW', 'MODERATE', 'HIGH'],
  infrastructure_condition: ['GOOD', 'FAIR', 'POOR', 'DAMAGED'],
  signage_condition: ['GOOD', 'DAMAGED', 'MISSING', 'UNCLEAR'],
  accessibility_barrier: ['NONE', 'MINOR', 'MAJOR', 'UNKNOWN'],
  visitor_management: ['PRESENT', 'ABSENT', 'NOT_ASSESSED'],
  other: [],
};

describe('Tourism Core built-in protocol', () => {
  it('is a valid protocol with the stable identity', () => {
    expect(isValidProtocol(TOURISM_CORE_PROTOCOL)).toBe(true);
    expect(TOURISM_CORE_PROTOCOL.protocolId).toBe('fieldos-tourism-core');
    expect(TOURISM_CORE_PROTOCOL.version).toBe(1);
    expect(TOURISM_CORE_PROTOCOL.name).toBe('Tourism Field Observation Core');
  });

  it('preserves the exact P0 category ids and value sets, in order', () => {
    const actual = Object.fromEntries(
      TOURISM_CORE_PROTOCOL.categories.map((c) => [c.id, c.values.map((v) => v.id)]),
    );
    expect(actual).toEqual(EXPECTED);
  });

  it('keeps the P0 category display labels', () => {
    const labels = Object.fromEntries(TOURISM_CORE_PROTOCOL.categories.map((c) => [c.id, c.label]));
    expect(labels.visitor_pressure).toBe('Visitor pressure');
    expect(labels.infrastructure_condition).toBe('Infrastructure');
    expect(labels.signage_condition).toBe('Signage');
    expect(labels.accessibility_barrier).toBe('Accessibility');
  });

  it('keeps every category note policy optional (no new P0 enforcement, including `other`)', () => {
    for (const category of TOURISM_CORE_PROTOCOL.categories) {
      expect(category.notePolicy).toBe('optional');
    }
  });

  it('is deeply frozen so the exported constant cannot be mutated in place', () => {
    expect(Object.isFrozen(TOURISM_CORE_PROTOCOL)).toBe(true);
    expect(Object.isFrozen(TOURISM_CORE_PROTOCOL.categories)).toBe(true);
    expect(Object.isFrozen(TOURISM_CORE_PROTOCOL.categories[0])).toBe(true);
  });
});
