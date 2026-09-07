import type { Evidence, EvidenceMethod, ObservationValue } from './types';
import type { FieldProtocol } from '../protocol/types';
import { getProtocolCategory, validateObservationAgainstProtocol } from '../protocol/validation';

/**
 * Build a validated `ObservationValue` for a category against the session's protocol.
 *
 * A category with a controlled value set requires a matching value id; a free/`other`-style
 * category (no values) collapses to `value: null` regardless of the raw input. The value/category
 * fit is validated against the protocol (the note policy is enforced separately at the write
 * boundary, where the note is known). Throws if the category/value is not valid for the protocol.
 */
export function observationValueFor(
  protocol: FieldProtocol,
  category: string,
  rawValue: string | null,
): ObservationValue {
  const definition = getProtocolCategory(protocol, category);
  const value = definition && definition.values.length === 0 ? null : rawValue;
  validateObservationAgainstProtocol(protocol, { category, value });
  return { category, value };
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
