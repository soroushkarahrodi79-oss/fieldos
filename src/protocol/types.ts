// FieldOS Protocol Engine v1 — canonical protocol types.
//
// A Field Protocol defines the STRUCTURE AND SEMANTICS of an observation methodology:
// "what kinds of observations may be recorded in this field session, and what controlled values
// mean for each kind?". It is intentionally narrow and evidence-oriented — NOT a generic form
// builder. There are no arbitrary field types, no questions, no branching, no calculations, no
// scoring, and NO executable code. Definitions are pure JSON and runtime-validatable.
//
// Evidence provenance (OBSERVED / MEASURED / REPORTED) stays FieldOS-owned and is deliberately
// NOT part of a protocol: protocols define WHAT is assessed; evidence defines HOW the claim was
// obtained. Those are separate dimensions and must never be collapsed.

/** Whether a free-text note is required alongside an observation in a category. */
export type NotePolicy = 'optional' | 'required';

/**
 * One controlled value within a category. `id` is a stable, language-independent machine token
 * (persisted in observations and exports); `label` is the human display string, kept separate so
 * wording can change without rewriting stored evidence.
 */
export interface ProtocolValue {
  id: string;
  label: string;
  description: string | null;
}

/**
 * One kind of observation the protocol permits. `id` is unique within the protocol. A category
 * with a NON-EMPTY `values` list requires the observation to carry one of those value ids; a
 * category with an EMPTY `values` list is a free/`other`-style category whose observation value
 * must be `null` (the note carries the content).
 */
export interface ProtocolCategory {
  id: string;
  label: string;
  description: string | null;
  values: ProtocolValue[];
  notePolicy: NotePolicy;
}

/**
 * A compact, versioned, immutable observation methodology. `protocolId` + `version` identify it;
 * `schemaVersion` is the Protocol Engine's own structural version so a future, unsupported protocol
 * schema can be rejected conservatively rather than silently misread.
 */
export interface FieldProtocol {
  protocolId: string;
  version: number;
  schemaVersion: number;
  name: string;
  description: string | null;
  categories: ProtocolCategory[];
}
