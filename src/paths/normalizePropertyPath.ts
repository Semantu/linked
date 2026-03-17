/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import {PathExpr, PathRef, parsePropertyPath, PATH_OPERATOR_CHARS, isPathRef} from './PropertyPathExpr.js';
import {resolvePrefixedUri} from '../utils/NodeReference.js';

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
  let result: PathExpr;

  // String input
  if (typeof input === 'string') {
    if (PATH_OPERATOR_CHARS.test(input)) {
      result = parsePropertyPath(input);
    } else {
      result = input;
    }
  }
  // Array → sequence shorthand
  else if (Array.isArray(input)) {
    const normalized = input.map((item) => normalizePropertyPath(item));
    result = normalized.length === 1 ? normalized[0] : {seq: normalized};
  }
  // Object
  else if (typeof input === 'object' && input !== null) {
    // Structured PathExpr (has seq, alt, inv, etc.)
    if (isStructuredPathExpr(input)) {
      result = input as PathExpr;
    }
    // Plain {id} ref
    else if ('id' in input) {
      result = input as {id: string};
    } else {
      throw new Error(`Invalid property path input: ${JSON.stringify(input)}`);
    }
  } else {
    throw new Error(`Invalid property path input: ${JSON.stringify(input)}`);
  }

  // Resolve prefixed string refs to {id: fullIRI}
  return resolvePathExprPrefixes(result);
}

/**
 * Resolve all prefixed string refs in a PathExpr AST to `{id: fullIRI}` form.
 * Strings that resolve to a full IRI become `{id: resolved}`.
 * Strings that don't change (no prefix match) are left as-is.
 */
function resolvePathRef(ref: PathRef): PathRef {
  if (typeof ref === 'string') {
    const resolved = resolvePrefixedUri(ref);
    return resolved !== ref ? {id: resolved} : ref;
  }
  // {id} ref — resolve the id value
  const resolved = resolvePrefixedUri(ref.id);
  return resolved !== ref.id ? {id: resolved} : ref;
}

/** Map array, returning original if nothing changed (preserves identity). */
function mapIfChanged<T>(arr: T[], fn: (item: T) => T): T[] {
  let changed = false;
  const result = arr.map((item) => {
    const mapped = fn(item);
    if (mapped !== item) changed = true;
    return mapped;
  });
  return changed ? result : arr;
}

function resolvePathExprPrefixes(expr: PathExpr): PathExpr {
  if (isPathRef(expr)) {
    return resolvePathRef(expr as PathRef);
  }
  if ('seq' in (expr as any)) {
    const orig = (expr as {seq: PathExpr[]}).seq;
    const resolved = mapIfChanged(orig, resolvePathExprPrefixes);
    return resolved === orig ? expr : {seq: resolved};
  }
  if ('alt' in (expr as any)) {
    const orig = (expr as {alt: PathExpr[]}).alt;
    const resolved = mapIfChanged(orig, resolvePathExprPrefixes);
    return resolved === orig ? expr : {alt: resolved};
  }
  if ('inv' in (expr as any)) {
    const inner = (expr as {inv: PathExpr}).inv;
    const resolved = resolvePathExprPrefixes(inner);
    return resolved === inner ? expr : {inv: resolved};
  }
  if ('zeroOrMore' in (expr as any)) {
    const inner = (expr as {zeroOrMore: PathExpr}).zeroOrMore;
    const resolved = resolvePathExprPrefixes(inner);
    return resolved === inner ? expr : {zeroOrMore: resolved};
  }
  if ('oneOrMore' in (expr as any)) {
    const inner = (expr as {oneOrMore: PathExpr}).oneOrMore;
    const resolved = resolvePathExprPrefixes(inner);
    return resolved === inner ? expr : {oneOrMore: resolved};
  }
  if ('zeroOrOne' in (expr as any)) {
    const inner = (expr as {zeroOrOne: PathExpr}).zeroOrOne;
    const resolved = resolvePathExprPrefixes(inner);
    return resolved === inner ? expr : {zeroOrOne: resolved};
  }
  if ('negatedPropertySet' in (expr as any)) {
    const items = (expr as {negatedPropertySet: (PathRef | {inv: PathRef})[]}).negatedPropertySet;
    const resolved = mapIfChanged(items, (item) => {
      if (typeof item === 'string' || (typeof item === 'object' && 'id' in item && !('inv' in item))) {
        return resolvePathRef(item as PathRef) as typeof item;
      }
      const invItem = item as {inv: PathRef};
      const resolvedInv = resolvePathRef(invItem.inv);
      return resolvedInv === invItem.inv ? item : {inv: resolvedInv} as typeof item;
    });
    return resolved === items ? expr : {negatedPropertySet: resolved};
  }
  return expr;
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
