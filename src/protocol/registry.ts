// Trusted built-in protocol registry (Protocol Engine v1).
//
// v1 has NO user protocol authoring, NO import button, NO marketplace, and NO remote registry —
// those belong to a future FieldPack gate. Protocol definitions come only from this trusted
// in-code module. The architecture nonetheless supports multiple protocols (see tests, which add
// a synthetic second protocol); we simply do not ship additional production methodologies here.

import type { FieldProtocol } from './types';
import { TOURISM_CORE_PROTOCOL } from './tourismCore';

/** Every user-selectable built-in protocol. Order is the display order in New Session. */
export const BUILT_IN_PROTOCOLS: readonly FieldProtocol[] = [TOURISM_CORE_PROTOCOL];

/** The protocol bound to a new session when the caller does not choose another. */
export const DEFAULT_PROTOCOL: FieldProtocol = TOURISM_CORE_PROTOCOL;

/** Look up a built-in protocol by id (and optional exact version). */
export function getBuiltInProtocol(protocolId: string, version?: number): FieldProtocol | undefined {
  return BUILT_IN_PROTOCOLS.find(
    (protocol) => protocol.protocolId === protocolId && (version === undefined || protocol.version === version),
  );
}
