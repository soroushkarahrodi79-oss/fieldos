import type { Evidence, EvidenceMethod, ObservationCategory, ObservationValue } from './types';

export function observationValueFor(
  category: ObservationCategory,
  rawValue: string | null,
): ObservationValue {
  switch (category) {
    case 'visitor_pressure':
      if (rawValue === 'NONE' || rawValue === 'LOW' || rawValue === 'MODERATE' || rawValue === 'HIGH') return { category, value: rawValue };
      break;
    case 'parking_pressure':
      if (rawValue === 'LOW' || rawValue === 'MODERATE' || rawValue === 'HIGH' || rawValue === 'FULL') return { category, value: rawValue };
      break;
    case 'path_condition':
      if (rawValue === 'GOOD' || rawValue === 'FAIR' || rawValue === 'POOR' || rawValue === 'BLOCKED') return { category, value: rawValue };
      break;
    case 'litter':
      if (rawValue === 'NONE' || rawValue === 'LOW' || rawValue === 'MODERATE' || rawValue === 'HIGH') return { category, value: rawValue };
      break;
    case 'infrastructure_condition':
      if (rawValue === 'GOOD' || rawValue === 'FAIR' || rawValue === 'POOR' || rawValue === 'DAMAGED') return { category, value: rawValue };
      break;
    case 'signage_condition':
      if (rawValue === 'GOOD' || rawValue === 'DAMAGED' || rawValue === 'MISSING' || rawValue === 'UNCLEAR') return { category, value: rawValue };
      break;
    case 'accessibility_barrier':
      if (rawValue === 'NONE' || rawValue === 'MINOR' || rawValue === 'MAJOR' || rawValue === 'UNKNOWN') return { category, value: rawValue };
      break;
    case 'visitor_management':
      if (rawValue === 'PRESENT' || rawValue === 'ABSENT' || rawValue === 'NOT_ASSESSED') return { category, value: rawValue };
      break;
    case 'other':
      return { category, value: null };
  }
  throw new Error(`Choose a valid value for ${category.replaceAll('_', ' ')}.`);
}

export interface EvidenceForm {
  method: EvidenceMethod;
  measuredValue: string;
  measuredUnit: string;
  measuredContext: string;
  reportedSource: string;
}

export function evidenceFromForm(form: EvidenceForm): Evidence {
  if (form.method === 'OBSERVED') return { method: 'OBSERVED' };
  if (form.method === 'REPORTED') {
    return { method: 'REPORTED', sourceNote: form.reportedSource.trim() || null };
  }

  const value = Number(form.measuredValue);
  const unit = form.measuredUnit.trim();
  if (!Number.isFinite(value) || !unit) {
    throw new Error('Measured evidence needs a numeric value and unit.');
  }
  return {
    method: 'MEASURED',
    value,
    unit,
    context: form.measuredContext.trim() || null,
  };
}
