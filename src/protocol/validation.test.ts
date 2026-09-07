import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_SCHEMA_VERSION,
  ProtocolValidationError,
  getProtocolCategory,
  getProtocolValues,
  isValidProtocol,
  validateObservationAgainstProtocol,
  validateProtocol,
} from './validation';
import { TOURISM_CORE_PROTOCOL } from './tourismCore';
import { TEST_HEAT_PROTOCOL } from '../fixtures/testProtocol';
import type { FieldProtocol } from './types';

// A minimal well-formed protocol builder for structural mutation tests.
function makeProtocol(overrides: Partial<FieldProtocol> = {}): FieldProtocol {
  return {
    protocolId: 'p',
    version: 1,
    schemaVersion: 1,
    name: 'P',
    description: null,
    categories: [
      { id: 'c1', label: 'C1', description: null, notePolicy: 'optional', values: [{ id: 'V', label: 'V', description: null }] },
    ],
    ...overrides,
  };
}

describe('protocol definition validation', () => {
  it('accepts the built-in Tourism Core protocol', () => {
    expect(isValidProtocol(TOURISM_CORE_PROTOCOL)).toBe(true);
    // Returns a deep copy, not the same reference — so a stored snapshot cannot alias the registry.
    const validated = validateProtocol(TOURISM_CORE_PROTOCOL);
    expect(validated).toEqual(TOURISM_CORE_PROTOCOL);
    expect(validated).not.toBe(TOURISM_CORE_PROTOCOL);
    expect(validated.categories).not.toBe(TOURISM_CORE_PROTOCOL.categories);
  });

  it('accepts the alternate synthetic protocol', () => {
    expect(isValidProtocol(TEST_HEAT_PROTOCOL)).toBe(true);
  });

  it('rejects a duplicate category id', () => {
    const proto = makeProtocol({
      categories: [
        { id: 'dup', label: 'A', description: null, notePolicy: 'optional', values: [] },
        { id: 'dup', label: 'B', description: null, notePolicy: 'optional', values: [] },
      ],
    });
    expect(() => validateProtocol(proto)).toThrow(/duplicate category id/);
  });

  it('rejects a duplicate value id within a category', () => {
    const proto = makeProtocol({
      categories: [
        {
          id: 'c', label: 'C', description: null, notePolicy: 'optional',
          values: [{ id: 'X', label: 'X', description: null }, { id: 'X', label: 'X2', description: null }],
        },
      ],
    });
    expect(() => validateProtocol(proto)).toThrow(/duplicate value id/);
  });

  it('rejects malformed definitions', () => {
    expect(() => validateProtocol(null)).toThrow(ProtocolValidationError);
    expect(() => validateProtocol({})).toThrow(/protocolId/);
    expect(() => validateProtocol(makeProtocol({ categories: [] }))).toThrow(/at least one category/);
    expect(() => validateProtocol(makeProtocol({ version: 0 }))).toThrow(/version/);
    expect(() => validateProtocol(makeProtocol({ version: 1.5 }))).toThrow(/version/);
    // A bad note policy, a missing label, and a non-array values list are each rejected.
    expect(() => validateProtocol(makeProtocol({ categories: [{ id: 'c', label: 'C', description: null, notePolicy: 'sometimes' as never, values: [] }] }))).toThrow(/notePolicy/);
    expect(() => validateProtocol(makeProtocol({ categories: [{ id: 'c', label: '', description: null, notePolicy: 'optional', values: [] }] }))).toThrow(/label/);
    expect(() => validateProtocol(makeProtocol({ categories: [{ id: 'c', label: 'C', description: null, notePolicy: 'optional', values: 'nope' as never }] }))).toThrow(/must be an array/);
  });

  it('rejects a protocol from a newer, unsupported engine schema (conservative failure)', () => {
    expect(() => validateProtocol(makeProtocol({ schemaVersion: PROTOCOL_SCHEMA_VERSION + 1 }))).toThrow(/newer Protocol Engine schema/);
  });
});

describe('protocol helpers', () => {
  it('looks up categories and values', () => {
    expect(getProtocolCategory(TOURISM_CORE_PROTOCOL, 'parking_pressure')?.label).toBe('Parking pressure');
    expect(getProtocolCategory(TOURISM_CORE_PROTOCOL, 'nope')).toBeUndefined();
    expect(getProtocolValues(TOURISM_CORE_PROTOCOL, 'parking_pressure').map((v) => v.id)).toEqual(['LOW', 'MODERATE', 'HIGH', 'FULL']);
    expect(getProtocolValues(TOURISM_CORE_PROTOCOL, 'other')).toEqual([]);
  });
});

describe('observation validation against a protocol', () => {
  it('accepts a valid category/value', () => {
    expect(() => validateObservationAgainstProtocol(TOURISM_CORE_PROTOCOL, { category: 'litter', value: 'HIGH' })).not.toThrow();
    expect(() => validateObservationAgainstProtocol(TEST_HEAT_PROTOCOL, { category: 'heat_exposure', value: 'EXPOSED' })).not.toThrow();
  });

  it('rejects an unknown category', () => {
    expect(() => validateObservationAgainstProtocol(TOURISM_CORE_PROTOCOL, { category: 'heat_exposure', value: 'SHADED' })).toThrow(/not part of/);
  });

  it('rejects a wrong value for a category', () => {
    // FULL is valid for parking_pressure but not for litter.
    expect(() => validateObservationAgainstProtocol(TOURISM_CORE_PROTOCOL, { category: 'litter', value: 'FULL' })).toThrow(/not a valid value/);
    // A value supplied for a valueless category is rejected.
    expect(() => validateObservationAgainstProtocol(TOURISM_CORE_PROTOCOL, { category: 'other', value: 'X' })).toThrow(/does not take/);
    // A missing value for a category that requires one is rejected.
    expect(() => validateObservationAgainstProtocol(TOURISM_CORE_PROTOCOL, { category: 'litter', value: null })).toThrow(/valid value/);
  });

  it('enforces a required note policy only when note is supplied for checking', () => {
    // Required-note category with no note → rejected.
    expect(() => validateObservationAgainstProtocol(TEST_HEAT_PROTOCOL, { category: 'heat_incident', value: null, note: null })).toThrow(/requires a note/);
    expect(() => validateObservationAgainstProtocol(TEST_HEAT_PROTOCOL, { category: 'heat_incident', value: null, note: '   ' })).toThrow(/requires a note/);
    // With a note it passes.
    expect(() => validateObservationAgainstProtocol(TEST_HEAT_PROTOCOL, { category: 'heat_incident', value: null, note: 'collapsed visitor' })).not.toThrow();
    // Tourism Core `other` keeps the P0 behaviour: a note is optional (not enforced).
    expect(() => validateObservationAgainstProtocol(TOURISM_CORE_PROTOCOL, { category: 'other', value: null, note: null })).not.toThrow();
  });
});
