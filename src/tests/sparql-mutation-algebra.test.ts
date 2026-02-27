import {describe, expect, test} from '@jest/globals';
import {Person, queryFactories, tmpEntityBase} from '../test-helpers/query-fixtures';
import {captureQuery} from '../test-helpers/query-capture-store';
import {
  createToAlgebra,
  updateToAlgebra,
  deleteToAlgebra,
} from '../sparql/irToAlgebra';
import type {
  IRCreateMutation,
  IRUpdateMutation,
  IRDeleteMutation,
} from '../queries/IntermediateRepresentation';
import type {
  SparqlInsertDataPlan,
  SparqlDeleteInsertPlan,
  SparqlDeleteWherePlan,
  SparqlTriple,
  SparqlBGP,
} from '../sparql/SparqlAlgebra';

// Ensure prefixes are registered
import '../ontologies/rdf';
import '../ontologies/xsd';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const XSD_DATETIME = 'http://www.w3.org/2001/XMLSchema#dateTime';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const captureMutationIR = (runner: () => Promise<unknown>) =>
  captureQuery(runner) as Promise<IRCreateMutation | IRUpdateMutation | IRDeleteMutation>;

/** Find a triple by predicate URI (partial match on suffix). */
function findTripleByPredicateSuffix(
  triples: SparqlTriple[],
  suffix: string,
): SparqlTriple | undefined {
  return triples.find(
    (t) => t.predicate.kind === 'iri' && t.predicate.value.endsWith(`/${suffix}`),
  );
}

/** Count triples with a given predicate URI suffix. */
function countTriplesByPredicateSuffix(
  triples: SparqlTriple[],
  suffix: string,
): number {
  return triples.filter(
    (t) => t.predicate.kind === 'iri' && t.predicate.value.endsWith(`/${suffix}`),
  ).length;
}

/** Find a triple with a specific predicate and object IRI. */
function findTripleByPredicateAndObject(
  triples: SparqlTriple[],
  predicateSuffix: string,
  objectIri: string,
): SparqlTriple | undefined {
  return triples.find(
    (t) =>
      t.predicate.kind === 'iri' &&
      t.predicate.value.endsWith(`/${suffix(predicateSuffix)}`) &&
      t.object.kind === 'iri' &&
      t.object.value === objectIri,
  );
}

function suffix(s: string): string {
  return s;
}

// ---------------------------------------------------------------------------
// Create mutation tests
// ---------------------------------------------------------------------------

describe('createToAlgebra', () => {
  test('createSimple produces InsertDataPlan with type + field triples', async () => {
    const ir = (await captureMutationIR(() =>
      queryFactories.createSimple(),
    )) as IRCreateMutation;

    const plan = createToAlgebra(ir, {dataRoot: 'http://example.org/data'});

    expect(plan.type).toBe('insert_data');

    // Should have a type triple
    const typeTriple = plan.triples.find(
      (t) => t.predicate.kind === 'iri' && t.predicate.value === RDF_TYPE,
    );
    expect(typeTriple).toBeDefined();
    expect(typeTriple!.subject.kind).toBe('iri');
    expect(typeTriple!.object.kind).toBe('iri');

    // The generated URI should start with the dataRoot and contain a ULID
    if (typeTriple!.subject.kind === 'iri') {
      expect(typeTriple!.subject.value).toMatch(
        /^http:\/\/example\.org\/data\/person_[0-9A-Z]{26}$/,
      );
    }

    // Should have name triple
    const nameTriple = findTripleByPredicateSuffix(plan.triples, 'name');
    expect(nameTriple).toBeDefined();
    expect(nameTriple!.object).toEqual({kind: 'literal', value: 'Test Create'});

    // Should have hobby triple
    const hobbyTriple = findTripleByPredicateSuffix(plan.triples, 'hobby');
    expect(hobbyTriple).toBeDefined();
    expect(hobbyTriple!.object).toEqual({kind: 'literal', value: 'Chess'});

    // All triples should share the same subject URI
    const subjectUri = typeTriple!.subject;
    for (const t of plan.triples) {
      if (t.predicate.kind === 'iri' && t.predicate.value === RDF_TYPE) {
        expect(t.subject).toEqual(subjectUri);
      }
    }
  });

  test('createWithFixedId uses provided ID instead of generating', async () => {
    const ir = (await captureMutationIR(() =>
      queryFactories.createWithFixedId(),
    )) as IRCreateMutation;

    const plan = createToAlgebra(ir);

    expect(plan.type).toBe('insert_data');

    // The subject URI should be the fixed ID
    const typeTriple = plan.triples.find(
      (t) => t.predicate.kind === 'iri' && t.predicate.value === RDF_TYPE,
    );
    expect(typeTriple).toBeDefined();
    expect(typeTriple!.subject).toEqual({
      kind: 'iri',
      value: `${tmpEntityBase}fixed-id`,
    });

    // Should have a bestFriend triple pointing to an IRI (not a literal)
    const bfTriple = findTripleByPredicateSuffix(plan.triples, 'bestFriend');
    expect(bfTriple).toBeDefined();
    expect(bfTriple!.object.kind).toBe('iri');
  });

  test('createWithFriends produces nested triples', async () => {
    const ir = (await captureMutationIR(() =>
      queryFactories.createWithFriends(),
    )) as IRCreateMutation;

    const plan = createToAlgebra(ir, {dataRoot: 'http://example.org/data'});

    expect(plan.type).toBe('insert_data');

    // Should have type triples — at least 2 (root + nested friend)
    const typeTriples = plan.triples.filter(
      (t) => t.predicate.kind === 'iri' && t.predicate.value === RDF_TYPE,
    );
    expect(typeTriples.length).toBeGreaterThanOrEqual(2);

    // Should have friend triples (hasFriend property)
    const friendTriples = plan.triples.filter(
      (t) =>
        t.predicate.kind === 'iri' &&
        t.predicate.value.endsWith('/friends'),
    );
    expect(friendTriples.length).toBeGreaterThanOrEqual(2);

    // One friend should point to existing entity p2
    const p2Friend = friendTriples.find(
      (t) => t.object.kind === 'iri' && t.object.value === `${tmpEntityBase}p2`,
    );
    expect(p2Friend).toBeDefined();

    // The other friend should point to a newly generated URI
    const generatedFriend = friendTriples.find(
      (t) =>
        t.object.kind === 'iri' && t.object.value !== `${tmpEntityBase}p2`,
    );
    expect(generatedFriend).toBeDefined();

    // Nested friend should have name "New Friend"
    const newFriendUri =
      generatedFriend?.object.kind === 'iri' ? generatedFriend.object.value : '';
    const newFriendNameTriple = plan.triples.find(
      (t) =>
        t.subject.kind === 'iri' &&
        t.subject.value === newFriendUri &&
        t.predicate.kind === 'iri' &&
        t.predicate.value.endsWith('/name'),
    );
    expect(newFriendNameTriple).toBeDefined();
    expect(newFriendNameTriple!.object).toEqual({
      kind: 'literal',
      value: 'New Friend',
    });
  });
});

// ---------------------------------------------------------------------------
// Update mutation tests
// ---------------------------------------------------------------------------

describe('updateToAlgebra', () => {
  test('updateSimple produces delete/insert for hobby', async () => {
    const ir = (await captureMutationIR(() =>
      queryFactories.updateSimple(),
    )) as IRUpdateMutation;

    const plan = updateToAlgebra(ir);

    expect(plan.type).toBe('delete_insert');

    // Delete patterns should have a variable for old value
    const deleteHobby = plan.deletePatterns.find(
      (t) =>
        t.predicate.kind === 'iri' && t.predicate.value.endsWith('/hobby'),
    );
    expect(deleteHobby).toBeDefined();
    expect(deleteHobby!.subject).toEqual({
      kind: 'iri',
      value: `${tmpEntityBase}p1`,
    });
    expect(deleteHobby!.object.kind).toBe('variable');

    // Insert patterns should have the new literal value
    const insertHobby = plan.insertPatterns.find(
      (t) =>
        t.predicate.kind === 'iri' && t.predicate.value.endsWith('/hobby'),
    );
    expect(insertHobby).toBeDefined();
    expect(insertHobby!.object).toEqual({kind: 'literal', value: 'Chess'});

    // WHERE should match the old triples
    expect(plan.whereAlgebra.type).toBe('bgp');
    const whereBgp = plan.whereAlgebra as SparqlBGP;
    expect(whereBgp.triples.length).toBeGreaterThanOrEqual(1);
  });

  test('updateOverwriteSet produces wildcard delete + specific insert', async () => {
    const ir = (await captureMutationIR(() =>
      queryFactories.updateOverwriteSet(),
    )) as IRUpdateMutation;

    const plan = updateToAlgebra(ir);

    expect(plan.type).toBe('delete_insert');

    // Delete should have a wildcard variable for old friends
    const deleteFriends = plan.deletePatterns.find(
      (t) =>
        t.predicate.kind === 'iri' && t.predicate.value.endsWith('/friends'),
    );
    expect(deleteFriends).toBeDefined();
    expect(deleteFriends!.object.kind).toBe('variable');

    // Insert should have the specific friend reference
    const insertFriends = plan.insertPatterns.find(
      (t) =>
        t.predicate.kind === 'iri' && t.predicate.value.endsWith('/friends'),
    );
    expect(insertFriends).toBeDefined();
    expect(insertFriends!.object).toEqual({
      kind: 'iri',
      value: `${tmpEntityBase}p2`,
    });
  });

  test('updateAddRemoveMulti produces specific add/remove patterns', async () => {
    const ir = (await captureMutationIR(() =>
      queryFactories.updateAddRemoveMulti(),
    )) as IRUpdateMutation;

    const plan = updateToAlgebra(ir);

    expect(plan.type).toBe('delete_insert');

    // Delete should contain specific remove targets (not wildcard)
    const deleteFriends = plan.deletePatterns.filter(
      (t) =>
        t.predicate.kind === 'iri' && t.predicate.value.endsWith('/friends'),
    );
    expect(deleteFriends.length).toBeGreaterThanOrEqual(1);

    // At least one delete pattern should have a specific IRI object (entity p3)
    const specificDelete = deleteFriends.find(
      (t) =>
        t.object.kind === 'iri' && t.object.value === `${tmpEntityBase}p3`,
    );
    expect(specificDelete).toBeDefined();

    // Insert should contain the add target (entity p2)
    const insertFriends = plan.insertPatterns.filter(
      (t) =>
        t.predicate.kind === 'iri' && t.predicate.value.endsWith('/friends'),
    );
    expect(insertFriends.length).toBeGreaterThanOrEqual(1);
    const addedFriend = insertFriends.find(
      (t) =>
        t.object.kind === 'iri' && t.object.value === `${tmpEntityBase}p2`,
    );
    expect(addedFriend).toBeDefined();

    // Should NOT have a wildcard delete (only specific removes)
    const wildcardDelete = deleteFriends.find(
      (t) => t.object.kind === 'variable',
    );
    expect(wildcardDelete).toBeUndefined();
  });

  test('updateUnsetSingleUndefined produces delete only', async () => {
    const ir = (await captureMutationIR(() =>
      queryFactories.updateUnsetSingleUndefined(),
    )) as IRUpdateMutation;

    const plan = updateToAlgebra(ir);

    expect(plan.type).toBe('delete_insert');

    // Delete patterns should have a variable for old hobby
    const deleteHobby = plan.deletePatterns.find(
      (t) =>
        t.predicate.kind === 'iri' && t.predicate.value.endsWith('/hobby'),
    );
    expect(deleteHobby).toBeDefined();
    expect(deleteHobby!.object.kind).toBe('variable');

    // Insert patterns should be empty (no replacement)
    expect(plan.insertPatterns.length).toBe(0);
  });

  test('updateUnsetSingleNull produces delete only', async () => {
    const ir = (await captureMutationIR(() =>
      queryFactories.updateUnsetSingleNull(),
    )) as IRUpdateMutation;

    const plan = updateToAlgebra(ir);

    expect(plan.type).toBe('delete_insert');
    expect(plan.insertPatterns.length).toBe(0);

    // Delete patterns should exist for hobby
    const deleteHobby = plan.deletePatterns.find(
      (t) =>
        t.predicate.kind === 'iri' && t.predicate.value.endsWith('/hobby'),
    );
    expect(deleteHobby).toBeDefined();
  });

  test('updateOverwriteNested produces delete old + insert nested create', async () => {
    const ir = (await captureMutationIR(() =>
      queryFactories.updateOverwriteNested(),
    )) as IRUpdateMutation;

    const plan = updateToAlgebra(ir, {dataRoot: 'http://example.org/data'});

    expect(plan.type).toBe('delete_insert');

    // Delete should have wildcard for old bestFriend
    const deleteBf = plan.deletePatterns.find(
      (t) =>
        t.predicate.kind === 'iri' &&
        t.predicate.value.endsWith('/bestFriend'),
    );
    expect(deleteBf).toBeDefined();
    expect(deleteBf!.object.kind).toBe('variable');

    // Insert should have the bestFriend pointing to a new URI
    const insertBf = plan.insertPatterns.find(
      (t) =>
        t.predicate.kind === 'iri' &&
        t.predicate.value.endsWith('/bestFriend'),
    );
    expect(insertBf).toBeDefined();
    expect(insertBf!.object.kind).toBe('iri');

    // Insert should also have nested create triples (type + name)
    const nestedUri =
      insertBf!.object.kind === 'iri' ? insertBf!.object.value : '';
    const nestedTypeTriple = plan.insertPatterns.find(
      (t) =>
        t.subject.kind === 'iri' &&
        t.subject.value === nestedUri &&
        t.predicate.kind === 'iri' &&
        t.predicate.value === RDF_TYPE,
    );
    expect(nestedTypeTriple).toBeDefined();

    const nestedNameTriple = plan.insertPatterns.find(
      (t) =>
        t.subject.kind === 'iri' &&
        t.subject.value === nestedUri &&
        t.predicate.kind === 'iri' &&
        t.predicate.value.endsWith('/name'),
    );
    expect(nestedNameTriple).toBeDefined();
    expect(nestedNameTriple!.object).toEqual({
      kind: 'literal',
      value: 'Bestie',
    });
  });

  test('updateBirthDate produces typed dateTime literal', async () => {
    const ir = (await captureMutationIR(() =>
      queryFactories.updateBirthDate(),
    )) as IRUpdateMutation;

    const plan = updateToAlgebra(ir);

    expect(plan.type).toBe('delete_insert');

    const insertBd = plan.insertPatterns.find(
      (t) =>
        t.predicate.kind === 'iri' &&
        t.predicate.value.endsWith('/birthDate'),
    );
    expect(insertBd).toBeDefined();
    expect(insertBd!.object).toEqual({
      kind: 'literal',
      value: '2020-01-01T00:00:00.000Z',
      datatype: XSD_DATETIME,
    });
  });

  test('updatePassIdReferences produces IRI object for reference', async () => {
    const ir = (await captureMutationIR(() =>
      queryFactories.updatePassIdReferences(),
    )) as IRUpdateMutation;

    const plan = updateToAlgebra(ir);

    const insertBf = plan.insertPatterns.find(
      (t) =>
        t.predicate.kind === 'iri' &&
        t.predicate.value.endsWith('/bestFriend'),
    );
    expect(insertBf).toBeDefined();
    expect(insertBf!.object).toEqual({
      kind: 'iri',
      value: `${tmpEntityBase}p2`,
    });
  });

  test('updateNestedWithPredefinedId uses the predefined ID as reference', async () => {
    // The update partial {id: '...', name: 'Bestie'} is treated as a node reference
    // by the IR pipeline (because 'id' is present, it becomes a NodeReferenceValue).
    // The 'name' field is stripped. So this becomes a simple reference update.
    const ir = (await captureMutationIR(() =>
      queryFactories.updateNestedWithPredefinedId(),
    )) as IRUpdateMutation;

    const plan = updateToAlgebra(ir);

    // The bestFriend insert should point to the predefined ID as an IRI reference
    const insertBf = plan.insertPatterns.find(
      (t) =>
        t.predicate.kind === 'iri' &&
        t.predicate.value.endsWith('/bestFriend'),
    );
    expect(insertBf).toBeDefined();
    expect(insertBf!.object).toEqual({
      kind: 'iri',
      value: `${tmpEntityBase}p3-best-friend`,
    });

    // Delete should have wildcard for old bestFriend
    const deleteBf = plan.deletePatterns.find(
      (t) =>
        t.predicate.kind === 'iri' &&
        t.predicate.value.endsWith('/bestFriend'),
    );
    expect(deleteBf).toBeDefined();
    expect(deleteBf!.object.kind).toBe('variable');
  });

  test('updateRemoveMulti produces only remove patterns (no add)', async () => {
    const ir = (await captureMutationIR(() =>
      queryFactories.updateRemoveMulti(),
    )) as IRUpdateMutation;

    const plan = updateToAlgebra(ir);

    expect(plan.type).toBe('delete_insert');

    // Delete patterns should exist
    expect(plan.deletePatterns.length).toBeGreaterThanOrEqual(1);

    // Insert patterns for friends should be empty
    const insertFriends = plan.insertPatterns.filter(
      (t) =>
        t.predicate.kind === 'iri' && t.predicate.value.endsWith('/friends'),
    );
    expect(insertFriends.length).toBe(0);
  });

  test('updateUnsetMultiUndefined produces wildcard delete, no insert', async () => {
    const ir = (await captureMutationIR(() =>
      queryFactories.updateUnsetMultiUndefined(),
    )) as IRUpdateMutation;

    const plan = updateToAlgebra(ir);

    expect(plan.type).toBe('delete_insert');

    // Delete should have wildcard
    const deleteFriends = plan.deletePatterns.find(
      (t) =>
        t.predicate.kind === 'iri' && t.predicate.value.endsWith('/friends'),
    );
    expect(deleteFriends).toBeDefined();
    expect(deleteFriends!.object.kind).toBe('variable');

    // No insert
    expect(plan.insertPatterns.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Delete mutation tests
// ---------------------------------------------------------------------------

describe('deleteToAlgebra', () => {
  test('deleteSingle produces bidirectional delete', async () => {
    const ir = (await captureMutationIR(() =>
      queryFactories.deleteSingle(),
    )) as IRDeleteMutation;

    const plan = deleteToAlgebra(ir);

    expect(plan.type).toBe('delete_where');
    expect(plan.patterns.type).toBe('bgp');

    const bgp = plan.patterns as SparqlBGP;

    // Should have subject wildcard: <id> ?p ?o
    const subjectWildcard = bgp.triples.find(
      (t) =>
        t.subject.kind === 'iri' &&
        t.subject.value === `${tmpEntityBase}to-delete` &&
        t.predicate.kind === 'variable' &&
        t.predicate.name === 'p' &&
        t.object.kind === 'variable' &&
        t.object.name === 'o',
    );
    expect(subjectWildcard).toBeDefined();

    // Should have object wildcard: ?s ?p2 <id>
    const objectWildcard = bgp.triples.find(
      (t) =>
        t.subject.kind === 'variable' &&
        t.subject.name === 's' &&
        t.predicate.kind === 'variable' &&
        t.predicate.name === 'p2' &&
        t.object.kind === 'iri' &&
        t.object.value === `${tmpEntityBase}to-delete`,
    );
    expect(objectWildcard).toBeDefined();

    // Should have type guard triple: <id> rdf:type <shape>
    const typeGuard = bgp.triples.find(
      (t) =>
        t.subject.kind === 'iri' &&
        t.subject.value === `${tmpEntityBase}to-delete` &&
        t.predicate.kind === 'iri' &&
        t.predicate.value === RDF_TYPE,
    );
    expect(typeGuard).toBeDefined();
  });

  test('deleteMultiple handles multiple IDs', async () => {
    const ir = (await captureMutationIR(() =>
      queryFactories.deleteMultiple(),
    )) as IRDeleteMutation;

    const plan = deleteToAlgebra(ir);

    expect(plan.type).toBe('delete_where');
    expect(plan.patterns.type).toBe('bgp');

    const bgp = plan.patterns as SparqlBGP;

    // Should have triples for both IDs
    // Each ID gets 3 triples: subject wildcard, object wildcard, type guard
    expect(bgp.triples.length).toBe(6); // 2 IDs * 3 triples

    // Verify both entity URIs appear
    const entity1Triples = bgp.triples.filter(
      (t) =>
        (t.subject.kind === 'iri' &&
          t.subject.value === `${tmpEntityBase}to-delete-1`) ||
        (t.object.kind === 'iri' &&
          t.object.value === `${tmpEntityBase}to-delete-1`),
    );
    expect(entity1Triples.length).toBeGreaterThanOrEqual(2);

    const entity2Triples = bgp.triples.filter(
      (t) =>
        (t.subject.kind === 'iri' &&
          t.subject.value === `${tmpEntityBase}to-delete-2`) ||
        (t.object.kind === 'iri' &&
          t.object.value === `${tmpEntityBase}to-delete-2`),
    );
    expect(entity2Triples.length).toBeGreaterThanOrEqual(2);
  });
});
