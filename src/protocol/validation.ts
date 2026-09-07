// Protocol Engine v1 — deterministic, pure validation.
//
// Two responsibilities, both dependency-free and unit-testable:
//   1. Validate a protocol DEFINITION is structurally sound (and interpretable by this build).
//   2. Validate an OBSERVATION's {category, value, note} against a protocol.
//
// This replaces the previous compile-time closed union of tourism categories with runtime
// validation: correctness is not weakened, it is relocated so the vocabulary can be definition-
// driven. No executable code is ever read from a protocol; only plain JSON shapes are inspected.

import type { FieldProtocol, NotePolicy, ProtocolCategory, ProtocolValue } from './types';

/**
 * Highest protocol structural schema this FieldOS build understands. A protocol declaring a
 * higher `schemaVersion` is rejected conservatively (see §14: never silently drop semantics).
 */
export const PROTOCOL_SCHEMA_VERSION = 1;

/** A protocol definition (or an observation against one) failed validation. */
export class ProtocolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolValidationError';
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProtocolValidationError(`${label} must be a non-empty string.`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new ProtocolValidationError(`${label} must be a string or null.`);
  return value;
}

function notePolicy(value: unknown, label: string): NotePolicy {
  if (value !== 'optional' && value !== 'required') {
    throw new ProtocolValidationError(`${label} must be "optional" or "required".`);
  }
  return value;
}

function validateValue(raw: unknown, categoryId: string, index: number): ProtocolValue {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ProtocolValidationError(`Value ${index} in category "${categoryId}" must be an object.`);
  }
  const value = raw as Record<string, unknown>;
  return {
    id: nonEmptyString(value.id, `Value ${index} id in category "${categoryId}"`),
    label: nonEmptyString(value.label, `Value "${String(value.id)}" label in category "${categoryId}"`),
    description: nullableString(value.description, `Value "${String(value.id)}" description in category "${categoryId}"`),
  };
}

function validateCategory(raw: unknown, index: number): ProtocolCategory {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ProtocolValidationError(`Category ${index} must be an object.`);
  }
  const category = raw as Record<string, unknown>;
  const id = nonEmptyString(category.id, `Category ${index} id`);
  const label = nonEmptyString(category.label, `Category "${id}" label`);
  const description = nullableString(category.description, `Category "${id}" description`);
  const policy = notePolicy(category.notePolicy, `Category "${id}" notePolicy`);

  if (!Array.isArray(category.values)) {
    throw new ProtocolValidationError(`Category "${id}" values must be an array.`);
  }
  const values = category.values.map((value, valueIndex) => validateValue(value, id, valueIndex));
  const valueIds = new Set<string>();
  for (const value of values) {
    if (valueIds.has(value.id)) {
      throw new ProtocolValidationError(`Category "${id}" has a duplicate value id "${value.id}".`);
    }
    valueIds.add(value.id);
  }

  return { id, label, description, values, notePolicy: policy };
}

/**
 * Validate a protocol definition and return a fresh, deep-copied, normalized `FieldProtocol`.
 * Returning a copy means the caller can persist the result as an immutable snapshot without
 * sharing references with a built-in registry object. Throws `ProtocolValidationError` on any
 * structural problem or an unsupported (newer) protocol schema.
 */
export function validateProtocol(raw: unknown): FieldProtocol {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ProtocolValidationError('Protocol must be an object.');
  }
  const protocol = raw as Record<string, unknown>;

  const protocolId = nonEmptyString(protocol.protocolId, 'Protocol protocolId');
  const name = nonEmptyString(protocol.name, 'Protocol name');
  const description = nullableString(protocol.description, 'Protocol description');

  if (!Number.isInteger(protocol.version) || (protocol.version as number) < 1) {
    throw new ProtocolValidationError('Protocol version must be a positive integer.');
  }
  if (!Number.isInteger(protocol.schemaVersion) || (protocol.schemaVersion as number) < 1) {
    throw new ProtocolValidationError('Protocol schemaVersion must be a positive integer.');
  }
  if ((protocol.schemaVersion as number) > PROTOCOL_SCHEMA_VERSION) {
    throw new ProtocolValidationError(
      'This protocol was created for a newer Protocol Engine schema and cannot be interpreted by this version.',
    );
  }

  if (!Array.isArray(protocol.categories) || protocol.categories.length === 0) {
    throw new ProtocolValidationError('Protocol must define at least one category.');
  }
  const categories = protocol.categories.map((category, index) => validateCategory(category, index));
  const categoryIds = new Set<string>();
  for (const category of categories) {
    if (categoryIds.has(category.id)) {
      throw new ProtocolValidationError(`Protocol has a duplicate category id "${category.id}".`);
    }
    categoryIds.add(category.id);
  }

  return {
    protocolId,
    version: protocol.version as number,
    schemaVersion: protocol.schemaVersion as number,
    name,
    description,
    categories,
  };
}

/** Boolean form of {@link validateProtocol} for guards and tests. */
export function isValidProtocol(raw: unknown): boolean {
  try {
    validateProtocol(raw);
    return true;
  } catch {
    return false;
  }
}

/** The category with this id, or `undefined` when the protocol has no such category. */
export function getProtocolCategory(
  protocol: FieldProtocol,
  categoryId: string,
): ProtocolCategory | undefined {
  return protocol.categories.find((category) => category.id === categoryId);
}

/** The controlled values for a category (empty array for a free/`other`-style category). */
export function getProtocolValues(protocol: FieldProtocol, categoryId: string): ProtocolValue[] {
  return getProtocolCategory(protocol, categoryId)?.values ?? [];
}

/**
 * Validate one observation against a protocol. Throws `ProtocolValidationError` if:
 *  - the category is not part of the protocol;
 *  - the value does not belong to the category (or a value is given for a valueless category,
 *    or omitted for a category that requires one);
 *  - the category's note policy is `required` but no note was supplied.
 *
 * `note` is only checked when provided; pass it to enforce the note policy at the write boundary.
 */
export function validateObservationAgainstProtocol(
  protocol: FieldProtocol,
  observation: { category: string; value: string | null; note?: string | null },
): void {
  const category = getProtocolCategory(protocol, observation.category);
  if (!category) {
    throw new ProtocolValidationError(
      `Category "${observation.category}" is not part of this session's protocol.`,
    );
  }

  if (category.values.length === 0) {
    if (observation.value !== null) {
      throw new ProtocolValidationError(`"${category.label}" does not take a controlled value.`);
    }
  } else if (observation.value === null) {
    throw new ProtocolValidationError(`Choose a valid value for ${category.label}.`);
  } else if (!category.values.some((value) => value.id === observation.value)) {
    throw new ProtocolValidationError(
      `"${observation.value}" is not a valid value for ${category.label}.`,
    );
  }

  if (
    observation.note !== undefined &&
    category.notePolicy === 'required' &&
    (observation.note === null || observation.note.trim() === '')
  ) {
    throw new ProtocolValidationError(`${category.label} requires a note.`);
  }
}
