// Session → protocol resolution and centralized label resolution (Protocol Engine v1).
//
// Every surface that renders an observation category/value (session list, detail, edit, map popup,
// revision history) resolves labels THROUGH here, so a second protocol displays its own labels and
// no hidden hard-coded Tourism Core dependency remains in generic UI.
//
// LEGACY: a session created before the Protocol Engine has `protocolSnapshot: null`. We render and
// validate it against the known legacy FieldOS vocabulary (Tourism Core v1) WITHOUT persisting a
// fabricated snapshot — historical absence stays historical absence.

import type { FieldSession } from '../domain/types';
import type { FieldProtocol } from './types';
import { TOURISM_CORE_PROTOCOL } from './tourismCore';
import { getProtocolCategory } from './validation';

/** Turn an UPPER_SNAKE / snake_case token into a readable fallback label. */
function readableToken(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export interface ResolvedProtocol {
  protocol: FieldProtocol;
  /** true when the session had no snapshot and is rendered via the legacy FieldOS vocabulary. */
  isLegacy: boolean;
}

/**
 * The protocol used to render/validate a session's observations. Returns the session's immutable
 * snapshot when present; otherwise the legacy FieldOS vocabulary (Tourism Core v1), flagged
 * `isLegacy` so the UI can label it honestly.
 */
export function protocolForSession(
  session: Pick<FieldSession, 'protocolSnapshot'> | null | undefined,
): ResolvedProtocol {
  if (session && session.protocolSnapshot) {
    return { protocol: session.protocolSnapshot, isLegacy: false };
  }
  return { protocol: TOURISM_CORE_PROTOCOL, isLegacy: true };
}

/** Display label for a category id, falling back to a readable token if the protocol lacks it. */
export function resolveCategoryLabel(protocol: FieldProtocol, categoryId: string): string {
  return getProtocolCategory(protocol, categoryId)?.label ?? readableToken(categoryId);
}

/**
 * Display label for a value id within a category. `null`/empty value → '' (free observation).
 * Falls back to a readable token if the protocol does not define the value's label.
 */
export function resolveValueLabel(
  protocol: FieldProtocol,
  categoryId: string,
  valueId: string | null,
): string {
  if (!valueId) return '';
  const value = getProtocolCategory(protocol, categoryId)?.values.find((entry) => entry.id === valueId);
  return value?.label ?? readableToken(valueId);
}
