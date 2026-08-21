import { describe, expect, it } from 'vitest';
import { evidenceFromForm, observationValueFor } from './observationForm';

describe('observation form conversion', () => {
  it('creates category-specific values and rejects mismatches', () => {
    expect(observationValueFor('path_condition', 'BLOCKED')).toEqual({ category: 'path_condition', value: 'BLOCKED' });
    expect(observationValueFor('other', null)).toEqual({ category: 'other', value: null });
    expect(() => observationValueFor('path_condition', 'FULL')).toThrow(/valid value/);
  });

  it('validates measured evidence', () => {
    expect(evidenceFromForm({ method: 'MEASURED', measuredValue: '12', measuredUnit: 'people', measuredContext: '', reportedSource: '' }))
      .toEqual({ method: 'MEASURED', value: 12, unit: 'people', context: null });
    expect(() => evidenceFromForm({ method: 'MEASURED', measuredValue: '', measuredUnit: '', measuredContext: '', reportedSource: '' }))
      .toThrow(/numeric value and unit/);
  });
});
