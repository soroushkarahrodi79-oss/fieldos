// SYNTHETIC TEST-ONLY PROTOCOL — NOT a production FieldOS methodology.
//
// This exists purely to prove the Protocol Engine is genuinely definition-driven: its categories
// and values do NOT exist in Tourism Core, and one category requires a note. It is deliberately
// NOT registered in `src/protocol/registry.ts`, so it never appears as a selectable methodology in
// the app — tests import it directly.

import type { FieldProtocol } from '../protocol/types';

/**
 * A compact heat-exposure protocol with categories/values absent from Tourism Core, plus a
 * required-note category, used to prove protocol-driven UI/validation/serialization/restore.
 */
export const TEST_HEAT_PROTOCOL: FieldProtocol = {
  protocolId: 'fieldos-test-heat',
  version: 1,
  schemaVersion: 1,
  name: 'Synthetic Heat Exposure (test only)',
  description: 'Synthetic test protocol — not a real FieldOS methodology.',
  categories: [
    {
      id: 'heat_exposure',
      label: 'Heat exposure',
      description: 'How exposed to direct sun this point is.',
      values: [
        { id: 'SHADED', label: 'Shaded', description: null },
        { id: 'PARTIAL', label: 'Partial shade', description: null },
        { id: 'EXPOSED', label: 'Fully exposed', description: null },
      ],
      notePolicy: 'optional',
    },
    {
      id: 'water_access',
      label: 'Water access',
      description: 'Whether drinking water is available here.',
      values: [
        { id: 'PRESENT', label: 'Present', description: null },
        { id: 'ABSENT', label: 'Absent', description: null },
      ],
      notePolicy: 'optional',
    },
    {
      id: 'heat_incident',
      label: 'Heat incident',
      description: 'A free-text heat-related incident; a note is required.',
      values: [],
      notePolicy: 'required',
    },
  ],
};
