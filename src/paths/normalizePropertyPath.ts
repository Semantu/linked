/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import {PathExpr, PathRef, parsePropertyPath, PATH_OPERATOR_CHARS, isPathRef} from './PropertyPathExpr.js';

/**
 * Input type for property path decorators.
 * Accepts all forms: string, {id}, array (sequence shorthand), or PathExpr.
 */
export type PropertyPathDecoratorInput =
  | string
  | {id: string}
  | PropertyPathDecoratorInput[]
  | PathExpr;

/** Path expression operator keys used to detect structured PathExpr objects. */
const PATH_EXPR_KEYS = new Set(['seq', 'alt', 'inv', 'zeroOrMore', 'oneOrMore', 'zeroOrOne', 'negatedPropertySet']);

/** Check if an object is a structured PathExpr (not a plain {id} ref). */
const isStructuredPathExpr = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  return Object.keys(value).some((key) => PATH_EXPR_KEYS.has(key));
};

/**
 * Normalize any property path decorator input into a canonical PathExpr.
 *
 * - `string` without path operators → preserved as-is (a PathRef)
 * - `string` with operators → parsed via `parsePropertyPath`
 * - `{id: string}` → preserved as PathRef
 * - `PathExpr` structured object → passed through
 * - `Array` → converted to `{seq: [...]}`
 */
export function normalizePropertyPath(input: PropertyPathDecoratorInput): PathExpr {
  // String input
  if (typeof input === 'string') {
    if (PATH_OPERATOR_CHARS.test(input)) {
      return parsePropertyPath(input);
    }
    return input;
  }

  // Array → sequence shorthand
  if (Array.isArray(input)) {
    const normalized = input.map((item) => normalizePropertyPath(item));
    return normalized.length === 1 ? normalized[0] : {seq: normalized};
  }

  // Object
  if (typeof input === 'object' && input !== null) {
    // Structured PathExpr (has seq, alt, inv, etc.)
    if (isStructuredPathExpr(input)) {
      return input as PathExpr;
    }
    // Plain {id} ref
    if ('id' in input) {
      return input as {id: string};
    }
  }

  throw new Error(`Invalid property path input: ${JSON.stringify(input)}`);
}

/**
 * Check whether a PathExpr is a simple single-IRI path (backward-compatible form).
 * Returns the IRI string if simple, or null if complex.
 */
export function getSimplePathId(expr: PathExpr): string | null {
  if (typeof expr === 'string') return expr;
  if (typeof expr === 'object' && expr !== null && 'id' in expr && !isStructuredPathExpr(expr)) {
    return (expr as {id: string}).id;
  }
  return null;
}
