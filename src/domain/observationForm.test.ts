import { describe, expect, it } from 'vitest';
import { evidenceFromForm, observationValueFor } from './observationForm';
import { TOURISM_CORE_PROTOCOL } from '../protocol/tourismCore';

const p = TOURISM_CORE_PROTOCOL;

describe('observation form conversion', () => {
  it('creates category-specific values and rejects mismatches', () => {
    expect(observationValueFor(p, 'path_condition', 'BLOCKED')).toEqual({ category: 'path_condition', value: 'BLOCKED' });
    expect(observationValueFor(p, 'other', null)).toEqual({ category: 'other', value: null });
    // `other` is a valueless category — any stray raw value collapses to null.
    expect(observationValueFor(p, 'other', 'ANYTHING')).toEqual({ category: 'other', value: null });
    expect(() => observationValueFor(p, 'path_condition', 'FULL')).toThrow(/valid value/);
  });

  it('validates measured evidence', () => {
    expect(evidenceFromForm({ method: 'MEASURED', measuredValue: '12', measuredUnit: 'people', measuredContext: '', reportedSource: '' }))
      .toEqual({ method: 'MEASURED', value: 12, unit: 'people', context: null });
    expect(() => evidenceFromForm({ method: 'MEASURED', measuredValue: '', measuredUnit: '', measuredContext: '', reportedSource: '' }))
      .toThrow(/numeric value and unit/);
  });
});
