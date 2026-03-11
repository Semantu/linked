/**
 * Golden tests for the full SPARQL mutation pipeline:
 *   query factory → IR → algebra → SPARQL string
 *
 * Covers create (INSERT DATA), update (DELETE/INSERT), and delete (DELETE WHERE).
 *
 * Create mutations with ULID-generated URIs use toContain/toMatch assertions
 * since the URI varies per run. All other mutations are deterministic and
 * use exact toBe assertions.
 */
import {describe, expect, test} from '@jest/globals';
import {queryFactories, tmpEntityBase} from '../test-helpers/query-fixtures';
import {captureQuery} from '../test-helpers/query-capture-store';
import {
  createToSparql,
  updateToSparql,
  updateWhereToSparql,
  deleteToSparql,
  deleteAllToSparql,
  deleteWhereToSparql,
} from '../sparql/irToAlgebra';
import type {
  IRCreateMutation,
  IRUpdateMutation,
  IRDeleteMutation,
  IRDeleteAllMutation,
  IRDeleteWhereMutation,
  IRUpdateWhereMutation,
} from '../queries/IntermediateRepresentation';

import '../ontologies/rdf';
import '../ontologies/xsd';

// ---------------------------------------------------------------------------
// URI shorthands
// ---------------------------------------------------------------------------

const P = 'https://data.lincd.org/module/-_linked-core/shape/person';
const ENT = tmpEntityBase; // linked://tmp/entities/

// ---------------------------------------------------------------------------
// Create mutation tests
// ---------------------------------------------------------------------------

describe('SPARQL golden — create mutations', () => {
  test('createSimple — ULID URI, contains expected triples', async () => {
    const ir = (await captureQuery(queryFactories.createSimple)) as IRCreateMutation;
    const sparql = createToSparql(ir);

    // Structure checks — URI is non-deterministic (ULID)
    expect(sparql).toContain('PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>');
    expect(sparql).toContain('INSERT DATA {');
    expect(sparql).toContain(`rdf:type <${P}>`);
    expect(sparql).toContain(`<${P}/name> "Test Create"`);
    expect(sparql).toContain(`<${P}/hobby> "Chess"`);

    // The generated URI should match the ULID pattern
    expect(sparql).toMatch(
      /http:\/\/example\.org\/data\/person_[0-9A-Z]{26}/,
    );

    // Verify the overall shape
    expect(sparql).toMatch(/^PREFIX rdf:.*\nINSERT DATA \{[\s\S]*\}$/);
  });

  test('createWithFriends — nested create with ULID URIs', async () => {
    const ir = (await captureQuery(queryFactories.createWithFriends)) as IRCreateMutation;
    const sparql = createToSparql(ir);

    expect(sparql).toContain('INSERT DATA {');
    expect(sparql).toContain(`rdf:type <${P}>`);
    expect(sparql).toContain(`<${P}/name> "Test Create"`);
    // Reference to existing entity p2
    expect(sparql).toContain(`<${P}/friends> <${ENT}p2>`);
    // Nested friend create
    expect(sparql).toContain(`<${P}/name> "New Friend"`);

    // Should have two rdf:type triples (root + nested)
    const typeMatches = sparql.match(/rdf:type/g);
    expect(typeMatches).not.toBeNull();
    expect(typeMatches!.length).toBe(2);
  });

  test('createWithFixedId — deterministic URI', async () => {
    const ir = (await captureQuery(queryFactories.createWithFixedId)) as IRCreateMutation;
    const sparql = createToSparql(ir);

    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
INSERT DATA {
  <${ENT}fixed-id> rdf:type <${P}> .
  <${ENT}fixed-id> <${P}/name> "Fixed" .
  <${ENT}fixed-id> <${P}/bestFriend> <${ENT}fixed-id-2> .
}`);
  });
});

// ---------------------------------------------------------------------------
// Update mutation tests
// ---------------------------------------------------------------------------

describe('SPARQL golden — update mutations', () => {
  test('updateSimple', async () => {
    const ir = (await captureQuery(queryFactories.updateSimple)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    expect(sparql).toBe(
`DELETE {
  <${ENT}p1> <${P}/hobby> ?old_hobby .
}
INSERT {
  <${ENT}p1> <${P}/hobby> "Chess" .
}
WHERE {
  OPTIONAL {
    <${ENT}p1> <${P}/hobby> ?old_hobby .
  }
}`);
  });

  test('updateOverwriteSet', async () => {
    const ir = (await captureQuery(queryFactories.updateOverwriteSet)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    expect(sparql).toBe(
`DELETE {
  <${ENT}p1> <${P}/friends> ?old_friends .
}
INSERT {
  <${ENT}p1> <${P}/friends> <${ENT}p2> .
}
WHERE {
  OPTIONAL {
    <${ENT}p1> <${P}/friends> ?old_friends .
  }
}`);
  });

  test('updateUnsetSingleUndefined', async () => {
    const ir = (await captureQuery(queryFactories.updateUnsetSingleUndefined)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    expect(sparql).toBe(
`DELETE {
  <${ENT}p1> <${P}/hobby> ?old_hobby .
}
WHERE {
  OPTIONAL {
    <${ENT}p1> <${P}/hobby> ?old_hobby .
  }
}`);
  });

  test('updateUnsetSingleNull', async () => {
    const ir = (await captureQuery(queryFactories.updateUnsetSingleNull)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    expect(sparql).toBe(
`DELETE {
  <${ENT}p1> <${P}/hobby> ?old_hobby .
}
WHERE {
  OPTIONAL {
    <${ENT}p1> <${P}/hobby> ?old_hobby .
  }
}`);
  });

  test('updateOverwriteNested — ULID in nested create', async () => {
    const ir = (await captureQuery(queryFactories.updateOverwriteNested)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);

    // The nested create generates a ULID, so check structure
    expect(sparql).toContain('PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>');
    expect(sparql).toContain('DELETE {');
    expect(sparql).toContain(`<${ENT}p1> <${P}/bestFriend> ?old_bestFriend .`);
    expect(sparql).toContain('INSERT {');
    expect(sparql).toContain(`<${ENT}p1> <${P}/bestFriend>`);
    expect(sparql).toContain(`rdf:type <${P}>`);
    expect(sparql).toContain(`<${P}/name> "Bestie"`);
    expect(sparql).toContain('WHERE {');
    expect(sparql).toContain(`<${ENT}p1> <${P}/bestFriend> ?old_bestFriend .`);
  });

  test('updatePassIdReferences', async () => {
    const ir = (await captureQuery(queryFactories.updatePassIdReferences)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    expect(sparql).toBe(
`DELETE {
  <${ENT}p1> <${P}/bestFriend> ?old_bestFriend .
}
INSERT {
  <${ENT}p1> <${P}/bestFriend> <${ENT}p2> .
}
WHERE {
  OPTIONAL {
    <${ENT}p1> <${P}/bestFriend> ?old_bestFriend .
  }
}`);
  });

  test('updateAddRemoveMulti', async () => {
    const ir = (await captureQuery(queryFactories.updateAddRemoveMulti)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    expect(sparql).toBe(
`DELETE {
  <${ENT}p1> <${P}/friends> <${ENT}p3> .
}
INSERT {
  <${ENT}p1> <${P}/friends> <${ENT}p2> .
}
WHERE {
  OPTIONAL {
    <${ENT}p1> <${P}/friends> <${ENT}p3> .
  }
}`);
  });

  test('updateRemoveMulti', async () => {
    const ir = (await captureQuery(queryFactories.updateRemoveMulti)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    expect(sparql).toBe(
`DELETE {
  <${ENT}p1> <${P}/friends> <${ENT}p2> .
}
WHERE {
  OPTIONAL {
    <${ENT}p1> <${P}/friends> <${ENT}p2> .
  }
}`);
  });

  test('updateAddRemoveSame', async () => {
    const ir = (await captureQuery(queryFactories.updateAddRemoveSame)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    expect(sparql).toBe(
`DELETE {
  <${ENT}p1> <${P}/friends> <${ENT}p3> .
}
INSERT {
  <${ENT}p1> <${P}/friends> <${ENT}p2> .
}
WHERE {
  OPTIONAL {
    <${ENT}p1> <${P}/friends> <${ENT}p3> .
  }
}`);
  });

  test('updateUnsetMultiUndefined', async () => {
    const ir = (await captureQuery(queryFactories.updateUnsetMultiUndefined)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    expect(sparql).toBe(
`DELETE {
  <${ENT}p1> <${P}/friends> ?old_friends .
}
WHERE {
  OPTIONAL {
    <${ENT}p1> <${P}/friends> ?old_friends .
  }
}`);
  });

  test('updateNestedWithPredefinedId', async () => {
    const ir = (await captureQuery(queryFactories.updateNestedWithPredefinedId)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
DELETE {
  <${ENT}p1> <${P}/bestFriend> ?old_bestFriend .
}
INSERT {
  <${ENT}p1> <${P}/bestFriend> <${ENT}p3-best-friend> .
  <${ENT}p3-best-friend> rdf:type <${P}> .
  <${ENT}p3-best-friend> <${P}/name> "Bestie" .
}
WHERE {
  OPTIONAL {
    <${ENT}p1> <${P}/bestFriend> ?old_bestFriend .
  }
}`);
  });

  test('updateBirthDate', async () => {
    const ir = (await captureQuery(queryFactories.updateBirthDate)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    expect(sparql).toBe(
`PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
DELETE {
  <${ENT}p1> <${P}/birthDate> ?old_birthDate .
}
INSERT {
  <${ENT}p1> <${P}/birthDate> "2020-01-01T00:00:00.000Z"^^xsd:dateTime .
}
WHERE {
  OPTIONAL {
    <${ENT}p1> <${P}/birthDate> ?old_birthDate .
  }
}`);
  });
});

// ---------------------------------------------------------------------------
// Delete mutation tests
// ---------------------------------------------------------------------------

describe('SPARQL golden — delete mutations', () => {
  test('deleteSingle', async () => {
    const ir = (await captureQuery(queryFactories.deleteSingle)) as IRDeleteMutation;
    const sparql = deleteToSparql(ir);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
DELETE {
  <${ENT}to-delete> ?p ?o .
  ?s ?p2 <${ENT}to-delete> .
  <${ENT}to-delete> rdf:type <${P}> .
}
WHERE {
  <${ENT}to-delete> ?p ?o .
  <${ENT}to-delete> rdf:type <${P}> .
  OPTIONAL {
    ?s ?p2 <${ENT}to-delete> .
  }
}`);
  });

  test('deleteSingleRef', async () => {
    const ir = (await captureQuery(queryFactories.deleteSingleRef)) as IRDeleteMutation;
    const sparql = deleteToSparql(ir);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
DELETE {
  <${ENT}to-delete> ?p ?o .
  ?s ?p2 <${ENT}to-delete> .
  <${ENT}to-delete> rdf:type <${P}> .
}
WHERE {
  <${ENT}to-delete> ?p ?o .
  <${ENT}to-delete> rdf:type <${P}> .
  OPTIONAL {
    ?s ?p2 <${ENT}to-delete> .
  }
}`);
  });

  test('deleteMultiple', async () => {
    const ir = (await captureQuery(queryFactories.deleteMultiple)) as IRDeleteMutation;
    const sparql = deleteToSparql(ir);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
DELETE {
  <${ENT}to-delete-1> ?p_0 ?o_0 .
  ?s_0 ?p2_0 <${ENT}to-delete-1> .
  <${ENT}to-delete-1> rdf:type <${P}> .
  <${ENT}to-delete-2> ?p_1 ?o_1 .
  ?s_1 ?p2_1 <${ENT}to-delete-2> .
  <${ENT}to-delete-2> rdf:type <${P}> .
}
WHERE {
  <${ENT}to-delete-1> ?p_0 ?o_0 .
  <${ENT}to-delete-1> rdf:type <${P}> .
  <${ENT}to-delete-2> ?p_1 ?o_1 .
  <${ENT}to-delete-2> rdf:type <${P}> .
  OPTIONAL {
    ?s_0 ?p2_0 <${ENT}to-delete-1> .
  }
  OPTIONAL {
    ?s_1 ?p2_1 <${ENT}to-delete-2> .
  }
}`);
  });

  test('deleteMultipleFull', async () => {
    const ir = (await captureQuery(queryFactories.deleteMultipleFull)) as IRDeleteMutation;
    const sparql = deleteToSparql(ir);
    expect(sparql).toBe(
`PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
DELETE {
  <${ENT}to-delete-1> ?p_0 ?o_0 .
  ?s_0 ?p2_0 <${ENT}to-delete-1> .
  <${ENT}to-delete-1> rdf:type <${P}> .
  <${ENT}to-delete-2> ?p_1 ?o_1 .
  ?s_1 ?p2_1 <${ENT}to-delete-2> .
  <${ENT}to-delete-2> rdf:type <${P}> .
}
WHERE {
  <${ENT}to-delete-1> ?p_0 ?o_0 .
  <${ENT}to-delete-1> rdf:type <${P}> .
  <${ENT}to-delete-2> ?p_1 ?o_1 .
  <${ENT}to-delete-2> rdf:type <${P}> .
  OPTIONAL {
    ?s_0 ?p2_0 <${ENT}to-delete-1> .
  }
  OPTIONAL {
    ?s_1 ?p2_1 <${ENT}to-delete-2> .
  }
}`);
  });
});

// ---------------------------------------------------------------------------
// Bulk delete mutation tests
// ---------------------------------------------------------------------------

describe('SPARQL golden — bulk delete mutations', () => {
  test('deleteAll — deletes all instances of shape', async () => {
    const ir = (await captureQuery(queryFactories.deleteAll)) as IRDeleteAllMutation;
    expect(ir.kind).toBe('delete_all');
    const sparql = deleteAllToSparql(ir);
    expect(sparql).toContain('DELETE');
    expect(sparql).toContain(`rdf:type <${P}>`);
    expect(sparql).toContain('?a0 ?p ?o');
  });

  test('deleteWhere — deletes instances matching condition', async () => {
    const ir = (await captureQuery(queryFactories.deleteWhere)) as IRDeleteWhereMutation;
    expect(ir.kind).toBe('delete_where');
    const sparql = deleteWhereToSparql(ir);
    expect(sparql).toContain('DELETE');
    expect(sparql).toContain(`rdf:type <${P}>`);
    expect(sparql).toContain('?a0 ?p ?o');
    expect(sparql).toContain('FILTER');
  });
});

// ---------------------------------------------------------------------------
// Conditional update mutation tests
// ---------------------------------------------------------------------------

describe('SPARQL golden — conditional update mutations', () => {
  test('updateForAll — updates all instances of shape', async () => {
    const ir = (await captureQuery(queryFactories.updateForAll)) as IRUpdateWhereMutation;
    expect(ir.kind).toBe('update_where');
    const sparql = updateWhereToSparql(ir);
    expect(sparql).toContain('DELETE');
    expect(sparql).toContain('INSERT');
    expect(sparql).toContain(`rdf:type <${P}>`);
    expect(sparql).toContain('?a0');
    // Should NOT have FILTER (no where condition)
    expect(sparql).not.toContain('FILTER');
  });

  test('updateWhere — updates instances matching condition', async () => {
    const ir = (await captureQuery(queryFactories.updateWhere)) as IRUpdateWhereMutation;
    expect(ir.kind).toBe('update_where');
    const sparql = updateWhereToSparql(ir);
    expect(sparql).toContain('DELETE');
    expect(sparql).toContain('INSERT');
    expect(sparql).toContain(`rdf:type <${P}>`);
    expect(sparql).toContain('?a0');
    expect(sparql).toContain('FILTER');
  });
});

// ---------------------------------------------------------------------------
// Builder equivalence tests — sugar methods produce identical SPARQL
// ---------------------------------------------------------------------------

describe('SPARQL golden — builder equivalence', () => {
  test('Person.deleteAll() === DeleteBuilder.from(Person).all()', async () => {
    const irSugar = (await captureQuery(queryFactories.deleteAll)) as IRDeleteAllMutation;
    const irBuilder = (await captureQuery(queryFactories.deleteAllBuilder)) as IRDeleteAllMutation;
    expect(deleteAllToSparql(irSugar)).toBe(deleteAllToSparql(irBuilder));
  });

  test('Person.deleteWhere(fn) === DeleteBuilder.from(Person).where(fn)', async () => {
    const irSugar = (await captureQuery(queryFactories.deleteWhere)) as IRDeleteWhereMutation;
    const irBuilder = (await captureQuery(queryFactories.deleteWhereBuilder)) as IRDeleteWhereMutation;
    expect(deleteWhereToSparql(irSugar)).toBe(deleteWhereToSparql(irBuilder));
  });
});
