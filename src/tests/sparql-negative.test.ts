import {describe, expect, test} from '@jest/globals';
import {selectToAlgebra, createToAlgebra, deleteToAlgebra} from '../sparql/irToAlgebra';
import {serializeAlgebraNode, selectPlanToSparql} from '../sparql/algebraToString';
import {mapSparqlSelectResult} from '../sparql/resultMapping';
import type {IRSelectQuery, IRCreateMutation, IRDeleteMutation} from '../queries/IntermediateRepresentation';
import type {SparqlAlgebraNode, SparqlSelectPlan, SparqlBGP, SparqlJoin} from '../sparql/SparqlAlgebra';
import type {SparqlJsonResults} from '../sparql/resultMapping';

import '../ontologies/rdf';
import '../ontologies/xsd';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHAPE = 'http://example.org/Shape';
const PROP_VAL = 'http://example.org/props/val';

const XSD = 'http://www.w3.org/2001/XMLSchema#';
const XSD_INTEGER = `${XSD}integer`;
const XSD_BOOLEAN = `${XSD}boolean`;
const XSD_DATE_TIME = `${XSD}dateTime`;

// ---------------------------------------------------------------------------
// irToAlgebra — error paths
// ---------------------------------------------------------------------------

describe('irToAlgebra — error paths', () => {
  test('unknown expression kind — throws with specific message', () => {
    const ir: IRSelectQuery = {
      kind: 'select',
      root: {kind: 'shape_scan', alias: 'a0', shape: SHAPE},
      patterns: [],
      projection: [{alias: 'a0', expression: {kind: 'alias_expr', alias: 'a0'}}],
      where: {kind: 'bogus_expr'} as any,
      resultMap: [{key: 'id', alias: 'a0'}],
    };

    expect(() => selectToAlgebra(ir)).toThrow(/Unknown IR expression kind: bogus_expr/);
  });

  test('unknown pattern kind in EXISTS — throws with specific message', () => {
    const ir: IRSelectQuery = {
      kind: 'select',
      root: {kind: 'shape_scan', alias: 'a0', shape: SHAPE},
      patterns: [],
      projection: [{alias: 'a0', expression: {kind: 'alias_expr', alias: 'a0'}}],
      where: {
        kind: 'exists_expr',
        pattern: {kind: 'bogus_pattern'} as any,
      },
      resultMap: [{key: 'id', alias: 'a0'}],
    };

    expect(() => selectToAlgebra(ir)).toThrow(/Unsupported pattern kind in EXISTS: bogus_pattern/);
  });

  test('empty projection — produces valid plan', () => {
    const ir: IRSelectQuery = {
      kind: 'select',
      root: {kind: 'shape_scan', alias: 'a0', shape: SHAPE},
      patterns: [],
      projection: [],
      resultMap: [],
    };

    const plan = selectToAlgebra(ir);
    expect(plan).toBeDefined();
    expect(plan.type).toBe('select');
    // Root alias is always included, but no additional projection items
    // The root alias 'a0' is auto-added, so projection length is 1
    expect(plan.projection.length).toBeLessThanOrEqual(1);
  });

  test('create with empty properties — includes type triple', () => {
    const ir: IRCreateMutation = {
      kind: 'create',
      shape: SHAPE,
      data: {
        shape: SHAPE,
        fields: [],
      },
    };

    const plan = createToAlgebra(ir);
    expect(plan.type).toBe('insert_data');

    // Should have at least the rdf:type triple
    const typeTriple = plan.triples.find(
      (t) =>
        t.predicate.kind === 'iri' &&
        t.predicate.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
    );
    expect(typeTriple).toBeDefined();
  });

  test('delete with empty ids — produces valid plan', () => {
    const ir: IRDeleteMutation = {
      kind: 'delete',
      shape: SHAPE,
      ids: [],
    };

    expect(() => deleteToAlgebra(ir)).not.toThrow();
    const plan = deleteToAlgebra(ir);
    expect(plan.type).toBe('delete_insert');
  });
});

// ---------------------------------------------------------------------------
// resultMapping — type coercion edge cases
// ---------------------------------------------------------------------------

describe('resultMapping — type coercion edge cases', () => {
  /**
   * Helper: build a minimal flat select query projecting one property.
   */
  function singleFieldQuery(property: string): IRSelectQuery {
    return {
      kind: 'select',
      root: {kind: 'shape_scan', shape: SHAPE, alias: 'a0'},
      patterns: [],
      projection: [
        {
          alias: 'a1',
          expression: {kind: 'property_expr', sourceAlias: 'a0', property, maxCount: 1},
        },
      ],
      resultMap: [{key: property, alias: 'a1'}],
    };
  }

  test('NaN numeric string — returns NaN', () => {
    const query = singleFieldQuery(PROP_VAL);

    const json: SparqlJsonResults = {
      head: {vars: ['a0', 'a0_val']},
      results: {
        bindings: [
          {
            a0: {type: 'uri', value: 'http://example.org/e1'},
            a0_val: {type: 'literal', value: 'not-a-number', datatype: XSD_INTEGER},
          },
        ],
      },
    };

    const result = mapSparqlSelectResult(json, query);
    expect(Array.isArray(result)).toBe(true);
    const rows = result as any[];
    expect(rows.length).toBe(1);
    expect(Number.isNaN(rows[0].val)).toBe(true);
  });

  test('empty string boolean — returns false', () => {
    const query = singleFieldQuery(PROP_VAL);

    const json: SparqlJsonResults = {
      head: {vars: ['a0', 'a0_val']},
      results: {
        bindings: [
          {
            a0: {type: 'uri', value: 'http://example.org/e1'},
            a0_val: {type: 'literal', value: '', datatype: XSD_BOOLEAN},
          },
        ],
      },
    };

    const result = mapSparqlSelectResult(json, query);
    const rows = result as any[];
    expect(rows[0].val).toBe(false);
  });

  test('malformed dateTime — does not throw', () => {
    const query = singleFieldQuery(PROP_VAL);

    const json: SparqlJsonResults = {
      head: {vars: ['a0', 'a0_val']},
      results: {
        bindings: [
          {
            a0: {type: 'uri', value: 'http://example.org/e1'},
            a0_val: {type: 'literal', value: 'not-a-date', datatype: XSD_DATE_TIME},
          },
        ],
      },
    };

    expect(() => mapSparqlSelectResult(json, query)).not.toThrow();
    const result = mapSparqlSelectResult(json, query);
    const rows = result as any[];
    // The result should be a Date (even if invalid) since the coercer calls new Date(...)
    expect(rows[0].val).toBeDefined();
  });

  test('missing datatype — returns raw string', () => {
    const query = singleFieldQuery(PROP_VAL);

    const json: SparqlJsonResults = {
      head: {vars: ['a0', 'a0_val']},
      results: {
        bindings: [
          {
            a0: {type: 'uri', value: 'http://example.org/e1'},
            a0_val: {type: 'literal', value: '42'},
          },
        ],
      },
    };

    const result = mapSparqlSelectResult(json, query);
    const rows = result as any[];
    expect(rows[0].val).toBe('42');
    expect(typeof rows[0].val).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// algebraToString — edge cases
// ---------------------------------------------------------------------------

describe('algebraToString — edge cases', () => {
  test('empty BGP — serializes without error', () => {
    const emptyBgp: SparqlBGP = {type: 'bgp', triples: []};

    expect(() => serializeAlgebraNode(emptyBgp)).not.toThrow();
    const result = serializeAlgebraNode(emptyBgp);
    expect(typeof result).toBe('string');
  });

  test('deeply nested join (5 levels) — no stack overflow', () => {
    // Build 5-deep nested Join tree, each wrapping a single-triple BGP
    function makeBgp(varName: string): SparqlBGP {
      return {
        type: 'bgp',
        triples: [
          {
            subject: {kind: 'variable', name: varName},
            predicate: {kind: 'iri', value: 'http://example.org/p'},
            object: {kind: 'literal', value: varName},
          },
        ],
      };
    }

    // Build from the bottom up: join(join(join(join(bgp0, bgp1), bgp2), bgp3), bgp4)
    let node: SparqlAlgebraNode = makeBgp('v0');
    for (let i = 1; i < 5; i++) {
      node = {type: 'join', left: node, right: makeBgp(`v${i}`)} as SparqlJoin;
    }

    expect(() => serializeAlgebraNode(node)).not.toThrow();
    const result = serializeAlgebraNode(node);
    expect(typeof result).toBe('string');

    // All 5 subject variables should appear
    for (let i = 0; i < 5; i++) {
      expect(result).toContain(`?v${i}`);
    }
  });

  test('select plan with all optional fields — serializes all clauses', () => {
    const plan: SparqlSelectPlan = {
      type: 'select',
      algebra: {
        type: 'bgp',
        triples: [
          {
            subject: {kind: 'variable', name: 'a0'},
            predicate: {kind: 'iri', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'},
            object: {kind: 'iri', value: 'http://example.org/Shape'},
          },
        ],
      },
      projection: [{kind: 'variable', name: 'a0'}],
      distinct: true,
      orderBy: [
        {
          expression: {kind: 'variable_expr', name: 'a0'},
          direction: 'ASC',
        },
      ],
      limit: 10,
      offset: 5,
      groupBy: ['a0'],
      aggregates: [
        {
          variable: 'cnt',
          aggregate: {kind: 'aggregate_expr', name: 'COUNT', args: [{kind: 'variable_expr', name: 'a0'}]},
        },
      ],
    };

    const sparql = selectPlanToSparql(plan);
    expect(sparql).toContain('SELECT DISTINCT');
    expect(sparql).toContain('ORDER BY');
    expect(sparql).toContain('LIMIT 10');
    expect(sparql).toContain('OFFSET 5');
    expect(sparql).toContain('GROUP BY');
  });
});
