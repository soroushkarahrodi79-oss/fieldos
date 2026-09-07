// Built-in protocol: Tourism Field Observation Core (fieldos-tourism-core, v1).
//
// HISTORICAL NOTE: FieldOS P0 encoded this exact vocabulary as a hard-coded TypeScript union in
// `src/domain/types.ts` (CATEGORY_VALUES + a discriminated ObservationValue). Protocol Engine v1
// promotes that same vocabulary to a first-class, versioned protocol WITHOUT changing any machine
// id or value semantics. It is the canonical definition bound to new default FieldOS sessions, and
// it is ALSO the "legacy FieldOS vocabulary" used to render/validate sessions created before the
// Protocol Engine (which carry `protocolSnapshot: null` and must not be given a fabricated one).
//
// Category ids, value ids, scopes, and value sets are copied verbatim from the P0 model — do not
// rename or reinterpret them. `notePolicy` is `optional` for every category (including `other`),
// preserving the exact P0 behaviour where a free-text note was encouraged but never enforced.

import type { FieldProtocol } from './types';
import { PROTOCOL_SCHEMA_VERSION } from './validation';

/** Machine id + version of the built-in tourism protocol. Stable and language-independent. */
export const TOURISM_CORE_PROTOCOL_ID = 'fieldos-tourism-core';
export const TOURISM_CORE_PROTOCOL_VERSION = 1;

/** Turn an UPPER_SNAKE value token into the same display label the P0 UI derived via `readable`. */
function label(token: string): string {
  return token
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function values(...ids: string[]) {
  return ids.map((id) => ({ id, label: label(id), description: null }));
}

/**
 * The Tourism Field Observation Core protocol. Frozen deeply so the exported constant cannot be
 * mutated in place; sessions store a validated deep COPY, so a session snapshot is independent of
 * this registry object.
 */
export const TOURISM_CORE_PROTOCOL: FieldProtocol = deepFreeze({
  protocolId: TOURISM_CORE_PROTOCOL_ID,
  version: TOURISM_CORE_PROTOCOL_VERSION,
  schemaVersion: PROTOCOL_SCHEMA_VERSION,
  name: 'Tourism Field Observation Core',
  description:
    'The core FieldOS tourism vocabulary: controlled categories for on-site visitor, access, and condition observations, each with its own value set (no universal scale).',
  categories: [
    {
      id: 'visitor_pressure',
      label: 'Visitor pressure',
      description: 'Density/pressure of people at this point now.',
      values: values('NONE', 'LOW', 'MODERATE', 'HIGH'),
      notePolicy: 'optional',
    },
    {
      id: 'parking_pressure',
      label: 'Parking pressure',
      description: 'Occupancy of a parking area (FULL = no spaces; empty counts as LOW).',
      values: values('LOW', 'MODERATE', 'HIGH', 'FULL'),
      notePolicy: 'optional',
    },
    {
      id: 'path_condition',
      label: 'Path condition',
      description: 'The walking surface of a trail/path (BLOCKED = impassable).',
      values: values('GOOD', 'FAIR', 'POOR', 'BLOCKED'),
      notePolicy: 'optional',
    },
    {
      id: 'litter',
      label: 'Litter',
      description: 'Visible litter / waste on the ground.',
      values: values('NONE', 'LOW', 'MODERATE', 'HIGH'),
      notePolicy: 'optional',
    },
    {
      id: 'infrastructure_condition',
      label: 'Infrastructure',
      description:
        'Built structures other than the path and signage (railings, steps, boardwalk, benches, toilets, barriers).',
      values: values('GOOD', 'FAIR', 'POOR', 'DAMAGED'),
      notePolicy: 'optional',
    },
    {
      id: 'signage_condition',
      label: 'Signage',
      description: 'Wayfinding/interpretive signs (MISSING = expected sign absent).',
      values: values('GOOD', 'DAMAGED', 'MISSING', 'UNCLEAR'),
      notePolicy: 'optional',
    },
    {
      id: 'accessibility_barrier',
      label: 'Accessibility',
      description: 'Barrier to access (steps, gradient, surface, width).',
      values: values('NONE', 'MINOR', 'MAJOR', 'UNKNOWN'),
      notePolicy: 'optional',
    },
    {
      id: 'visitor_management',
      label: 'Visitor management',
      description: 'Presence of a management measure (marshalling, ropes, one-way, wardens).',
      values: values('PRESENT', 'ABSENT', 'NOT_ASSESSED'),
      notePolicy: 'optional',
    },
    {
      id: 'other',
      label: 'Other',
      description: 'Anything not covered above; the note carries the content.',
      values: [],
      notePolicy: 'optional',
    },
  ],
});

/** Recursively freeze a plain-JSON value so the exported protocol constant is read-only. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
