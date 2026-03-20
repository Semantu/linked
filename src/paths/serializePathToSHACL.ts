/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type {PathExpr, PathRef} from './PropertyPathExpr.js';
import {isPathRef} from './PropertyPathExpr.js';

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type SHACLTriple = {
  subject: string;
  predicate: string;
  object: string;
};

export type SHACLPathResult = {
  /** The root node of the serialized path (IRI or blank node id). */
  root: string;
  /** Additional triples needed to describe the path structure. */
  triples: SHACLTriple[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SH = 'http://www.w3.org/ns/shacl#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

const SH_ALTERNATIVE_PATH = `${SH}alternativePath`;
const SH_INVERSE_PATH = `${SH}inversePath`;
const SH_ZERO_OR_MORE_PATH = `${SH}zeroOrMorePath`;
const SH_ONE_OR_MORE_PATH = `${SH}oneOrMorePath`;
const SH_ZERO_OR_ONE_PATH = `${SH}zeroOrOnePath`;
const RDF_FIRST = `${RDF}first`;
const RDF_REST = `${RDF}rest`;
const RDF_NIL = `${RDF}nil`;

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

let blankNodeCounter = 0;

/** Reset blank node counter (for deterministic testing). */
export function resetBlankNodeCounter(): void {
  blankNodeCounter = 0;
}

function freshBlankNode(): string {
  return `_:b${blankNodeCounter++}`;
}

function refToIri(ref: PathRef): string {
  if (typeof ref === 'string') return ref;
  return ref.id;
}

/**
 * Serialize a PathExpr to SHACL RDF triples.
 *
 * - Simple PathRef → direct IRI (no extra triples)
 * - Complex paths → blank nodes with SHACL path vocabulary
 * - negatedPropertySet → throws (not supported by SHACL)
 */
export function serializePathToSHACL(expr: PathExpr): SHACLPathResult {
  const triples: SHACLTriple[] = [];

  const serialize = (e: PathExpr): string => {
    // Simple ref → IRI directly
    if (isPathRef(e)) {
      return refToIri(e);
    }

    // Sequence → RDF list
    if ('seq' in e) {
      return buildRdfList(e.seq, triples);
    }

    // Alternative → sh:alternativePath with RDF list
    if ('alt' in e) {
      const bnode = freshBlankNode();
      const listRoot = buildRdfList(e.alt, triples);
      triples.push({subject: bnode, predicate: SH_ALTERNATIVE_PATH, object: listRoot});
      return bnode;
    }

    // Inverse → sh:inversePath
    if ('inv' in e) {
      const bnode = freshBlankNode();
      const inner = serialize(e.inv);
      triples.push({subject: bnode, predicate: SH_INVERSE_PATH, object: inner});
      return bnode;
    }

    // zeroOrMore → sh:zeroOrMorePath
    if ('zeroOrMore' in e) {
      const bnode = freshBlankNode();
      const inner = serialize(e.zeroOrMore);
      triples.push({subject: bnode, predicate: SH_ZERO_OR_MORE_PATH, object: inner});
      return bnode;
    }

    // oneOrMore → sh:oneOrMorePath
    if ('oneOrMore' in e) {
      const bnode = freshBlankNode();
      const inner = serialize(e.oneOrMore);
      triples.push({subject: bnode, predicate: SH_ONE_OR_MORE_PATH, object: inner});
      return bnode;
    }

    // zeroOrOne → sh:zeroOrOnePath
    if ('zeroOrOne' in e) {
      const bnode = freshBlankNode();
      const inner = serialize(e.zeroOrOne);
      triples.push({subject: bnode, predicate: SH_ZERO_OR_ONE_PATH, object: inner});
      return bnode;
    }

    // negatedPropertySet → not supported in SHACL
    if ('negatedPropertySet' in e) {
      throw new Error(
        'negatedPropertySet cannot be serialized to SHACL sh:path. ' +
        'This path form is valid in SPARQL but has no SHACL representation.',
      );
    }

    throw new Error(`Unknown PathExpr shape: ${JSON.stringify(e)}`);
  };

  /**
   * Build an RDF list from an array of PathExpr elements.
   * Returns the root blank node of the list.
   */
  function buildRdfList(items: PathExpr[], out: SHACLTriple[]): string {
    if (items.length === 0) return RDF_NIL;

    let current = freshBlankNode();
    const root = current;

    for (let i = 0; i < items.length; i++) {
      const itemNode = serialize(items[i]);
      out.push({subject: current, predicate: RDF_FIRST, object: itemNode});

      if (i === items.length - 1) {
        out.push({subject: current, predicate: RDF_REST, object: RDF_NIL});
      } else {
        const next = freshBlankNode();
        out.push({subject: current, predicate: RDF_REST, object: next});
        current = next;
      }
    }

    return root;
  }

  const root = serialize(expr);
  return {root, triples};
}
