/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type {PathExpr, PathRef} from './PropertyPathExpr.js';
import {isPathRef} from './PropertyPathExpr.js';

// ---------------------------------------------------------------------------
// Precedence levels (higher = tighter binding)
// ---------------------------------------------------------------------------
const PREC_ALT = 1;
const PREC_SEQ = 2;
const PREC_UNARY = 3;
const PREC_PRIMARY = 4;

function refToSparql(ref: PathRef): string {
  if (typeof ref === 'string') {
    // If it looks like a full IRI (contains ://), wrap in <>
    if (ref.includes('://')) return `<${ref}>`;
    // Otherwise treat as prefixed name
    return ref;
  }
  return `<${ref.id}>`;
}

/**
 * Render a PathExpr to SPARQL property path syntax.
 * Handles all forms including negatedPropertySet.
 * Adds parentheses only when needed for correct precedence.
 */
export function pathExprToSparql(expr: PathExpr): string {
  return renderExpr(expr, 0);
}

function renderExpr(expr: PathExpr, parentPrec: number): string {
  if (isPathRef(expr)) {
    return refToSparql(expr);
  }

  if ('seq' in expr) {
    const inner = expr.seq.map((e) => renderExpr(e, PREC_SEQ)).join('/');
    return parentPrec > PREC_SEQ ? `(${inner})` : inner;
  }

  if ('alt' in expr) {
    const inner = expr.alt.map((e) => renderExpr(e, PREC_ALT)).join('|');
    return parentPrec > PREC_ALT ? `(${inner})` : inner;
  }

  if ('inv' in expr) {
    return `^${renderExpr(expr.inv, PREC_UNARY)}`;
  }

  if ('zeroOrMore' in expr) {
    return `${renderExpr(expr.zeroOrMore, PREC_PRIMARY)}*`;
  }

  if ('oneOrMore' in expr) {
    return `${renderExpr(expr.oneOrMore, PREC_PRIMARY)}+`;
  }

  if ('zeroOrOne' in expr) {
    return `${renderExpr(expr.zeroOrOne, PREC_PRIMARY)}?`;
  }

  if ('negatedPropertySet' in expr) {
    const items = expr.negatedPropertySet.map((item) => {
      if (typeof item === 'string' || (typeof item === 'object' && 'id' in item && !('inv' in item))) {
        return refToSparql(item as PathRef);
      }
      const invItem = item as {inv: PathRef};
      return `^${refToSparql(invItem.inv)}`;
    });
    return items.length === 1 ? `!${items[0]}` : `!(${items.join('|')})`;
  }

  throw new Error(`Unknown PathExpr shape: ${JSON.stringify(expr)}`);
}
