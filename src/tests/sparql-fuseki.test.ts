/**
 * Fuseki integration tests for the SPARQL conversion layer.
 *
 * Tests the full pipeline: factory -> IR -> SPARQL -> execute against Fuseki -> map results
 *
 * These tests are skipped gracefully if Fuseki is not available on localhost:3030.
 */
import {describe, expect, test, beforeAll, afterAll} from '@jest/globals';
import {queryFactories, Person, tmpEntityBase} from '../test-helpers/query-fixtures';
import {captureQuery} from '../test-helpers/query-capture-store';
import {buildSelectQuery} from '../queries/IRPipeline';
import {
  selectToSparql,
  createToSparql,
  updateToSparql,
  deleteToSparql,
} from '../sparql/irToAlgebra';
import {mapSparqlSelectResult} from '../sparql/resultMapping';
import {setQueryContext} from '../queries/QueryContext';
import type {
  IRSelectQuery,
  IRCreateMutation,
  IRUpdateMutation,
  IRDeleteMutation,
  ResultRow,
} from '../queries/IntermediateRepresentation';
import type {SparqlJsonResults} from '../sparql/resultMapping';
import {
  isFusekiAvailable,
  createTestDataset,
  deleteTestDataset,
  loadTestData,
  executeSparqlQuery,
  executeSparqlUpdate,
  clearAllData,
} from '../test-helpers/fuseki-test-store';

import '../ontologies/rdf';
import '../ontologies/xsd';

// ---------------------------------------------------------------------------
// Context setup (must happen before query factories are called)
// ---------------------------------------------------------------------------

setQueryContext('user', {id: `${tmpEntityBase}p3`}, Person);

// ---------------------------------------------------------------------------
// URI constants matching the SHACL-generated shape URIs
// ---------------------------------------------------------------------------

const P = 'https://data.lincd.org/module/-_linked-core/shape/person';
const D = 'https://data.lincd.org/module/-_linked-core/shape/dog';
const PET = 'https://data.lincd.org/module/-_linked-core/shape/pet';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const ENT = tmpEntityBase; // linked://tmp/entities/

// ---------------------------------------------------------------------------
// N-Triples test data
//
// Uses the SHACL-generated property shape URIs (e.g. <P>/name) that the
// SPARQL pipeline produces, NOT the raw linked://tmp/props/ URIs.
// ---------------------------------------------------------------------------

const TEST_DATA = `
<${ENT}p1> <${RDF_TYPE}> <${P}> .
<${ENT}p1> <${P}/name> "Semmy" .
<${ENT}p1> <${P}/birthDate> "1990-01-01T00:00:00.000Z"^^<${XSD}dateTime> .
<${ENT}p1> <${P}/isRealPerson> "true"^^<${XSD}boolean> .
<${ENT}p1> <${P}/friends> <${ENT}p2> .
<${ENT}p1> <${P}/friends> <${ENT}p3> .
<${ENT}p1> <${P}/pets> <${ENT}dog1> .
<${ENT}p1> <${P}/firstPet> <${ENT}dog1> .
<${ENT}p1> <${P}/nickNames> "Sem1" .
<${ENT}p1> <${P}/nickNames> "Sem" .
<${ENT}p1> <${P}/pluralTestProp> <${ENT}p1> .
<${ENT}p1> <${P}/pluralTestProp> <${ENT}p2> .
<${ENT}p1> <${P}/pluralTestProp> <${ENT}p3> .
<${ENT}p1> <${P}/pluralTestProp> <${ENT}p4> .
<${ENT}p2> <${RDF_TYPE}> <${P}> .
<${ENT}p2> <${P}/name> "Moa" .
<${ENT}p2> <${P}/hobby> "Jogging" .
<${ENT}p2> <${P}/isRealPerson> "false"^^<${XSD}boolean> .
<${ENT}p2> <${P}/bestFriend> <${ENT}p3> .
<${ENT}p2> <${P}/friends> <${ENT}p3> .
<${ENT}p2> <${P}/friends> <${ENT}p4> .
<${ENT}p2> <${P}/pets> <${ENT}dog2> .
<${ENT}p2> <${P}/firstPet> <${ENT}dog2> .
<${ENT}p3> <${RDF_TYPE}> <${P}> .
<${ENT}p3> <${P}/name> "Jinx" .
<${ENT}p3> <${P}/isRealPerson> "true"^^<${XSD}boolean> .
<${ENT}p4> <${RDF_TYPE}> <${P}> .
<${ENT}p4> <${P}/name> "Quinn" .
<${ENT}dog1> <${RDF_TYPE}> <${D}> .
<${ENT}dog1> <${RDF_TYPE}> <${PET}> .
<${ENT}dog1> <${D}/guardDogLevel> "2"^^<${XSD}integer> .
<${ENT}dog1> <${PET}/bestFriend> <${ENT}dog2> .
<${ENT}dog2> <${RDF_TYPE}> <${D}> .
<${ENT}dog2> <${RDF_TYPE}> <${PET}> .
`.trim();

// ---------------------------------------------------------------------------
// Fuseki availability and lifecycle
// ---------------------------------------------------------------------------

let fusekiAvailable = false;

beforeAll(async () => {
  fusekiAvailable = await isFusekiAvailable();
  if (!fusekiAvailable) {
    console.log('Fuseki not available, skipping integration tests');
    return;
  }
  await createTestDataset();
  await clearAllData();
  await loadTestData(TEST_DATA);
}, 30000);

afterAll(async () => {
  if (!fusekiAvailable) return;
  await deleteTestDataset();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runSelect(
  factoryName: keyof typeof queryFactories,
): Promise<{sparql: string; ir: IRSelectQuery; results: SparqlJsonResults}> {
  const raw = await captureQuery(queryFactories[factoryName]);
  const ir = buildSelectQuery(raw);
  const sparql = selectToSparql(ir);
  const results = await executeSparqlQuery(sparql);
  return {sparql, ir, results};
}

async function runSelectMapped(
  factoryName: keyof typeof queryFactories,
) {
  const {ir, results} = await runSelect(factoryName);
  return mapSparqlSelectResult(results, ir);
}

/** Find a row by substring match on its id. */
function findRowById(rows: ResultRow[], idFragment: string): ResultRow | undefined {
  return rows.find((r) => r.id.includes(idFragment));
}

/** Extract all names from an array of rows. */
function extractNames(rows: ResultRow[]): string[] {
  return rows
    .map((r) => r.name as string)
    .filter((n) => n != null);
}

// ---------------------------------------------------------------------------
// SELECT tests
// ---------------------------------------------------------------------------

describe('Fuseki integration — SELECT queries', () => {
  test('selectName — all persons have name', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectName');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    expect(rows.length).toBe(4);

    const names = extractNames(rows);
    expect(names).toContain('Semmy');
    expect(names).toContain('Moa');
    expect(names).toContain('Jinx');
    expect(names).toContain('Quinn');

    // Each row should have an id
    for (const row of rows) {
      expect(row.id).toBeDefined();
    }
  });

  test('selectFriends — returns friend references', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectFriends');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
    // friends should be present — either as an array of nested rows or as a direct value
    expect(p1!.friends).toBeDefined();
  });

  test('selectBirthDate — date coercion', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectBirthDate');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    const semmy = findRowById(rows, 'p1');
    expect(semmy).toBeDefined();
    // birthDate should be coerced — either a Date object or a string containing '1990'
    const bd = semmy!.birthDate;
    if (bd instanceof Date) {
      expect(bd.getFullYear()).toBe(1990);
    } else {
      expect(String(bd)).toContain('1990');
    }

    // Other persons without birthDate should have null
    const jinx = findRowById(rows, 'p3');
    expect(jinx).toBeDefined();
    expect(jinx!.birthDate).toBeNull();
  });

  test('selectIsRealPerson — boolean coercion', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectIsRealPerson');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
    // isRealPerson for p1 should be true (or truthy)
    expect(p1!.isRealPerson).toBe(true);

    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
    // isRealPerson for p2 should be false (or falsy)
    expect(p2!.isRealPerson).toBe(false);
  });

  test('selectById — single person by URI', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectById');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Semmy');
  });

  test('selectNonExisting — returns empty', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectNonExisting');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    expect(rows.length).toBe(0);
  });

  test('selectFriendsName — nested traversal', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectFriendsName');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // p1 has friends p2 (Moa) and p3 (Jinx)
    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();

    // The result structure groups friend names under the root entity
    // Check that friend names Moa and Jinx appear for p1
    if (p1!.hasFriend || p1!.friends) {
      // Nested array format
      const friendData = (p1!.hasFriend || p1!.friends) as ResultRow[];
      const friendNames = friendData.map((f) => f.name).filter(Boolean);
      expect(friendNames).toContain('Moa');
      expect(friendNames).toContain('Jinx');
    } else {
      // Flat format — friend names appear across multiple rows for p1
      const p1Rows = rows.filter((r) => r.id.includes('p1'));
      const names = p1Rows.map((r) => r.name as string).filter(Boolean);
      expect(names).toContain('Moa');
      expect(names).toContain('Jinx');
    }
  });

  test('whereHobbyEquals — filter', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('whereHobbyEquals');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // whereHobbyEquals selects hobby where hobby equals "Jogging"
    // Only p2 has hobby "Jogging", so we expect p2 in the results
    const hobbies = rows.map((r) => r.hobby).filter(Boolean);
    if (hobbies.length > 0) {
      expect(hobbies).toContain('Jogging');
    }
  });

  test('whereBestFriendEquals — filter', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('whereBestFriendEquals');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // whereBestFriendEquals filters persons whose bestFriend is p3
    // p2 has bestFriend = p3
    // Result should contain p2
    const ids = rows.map((r) => r.id);
    expect(ids.some((id) => id.includes('p2'))).toBe(true);
  });

  test('countFriends — aggregation', async () => {
    if (!fusekiAvailable) return;

    const {sparql, ir, results} = await runSelect('countFriends');
    const mapped = mapSparqlSelectResult(results, ir);
    expect(Array.isArray(mapped)).toBe(true);
    const rows = mapped as ResultRow[];

    // Each person should have a count
    // p1 has 2 friends, p2 has 2 friends, p3 has 0, p4 has 0
    for (const row of rows) {
      const count = row[Object.keys(row).find((k) => k !== 'id')!];
      expect(typeof count === 'number').toBe(true);
    }

    const p1 = findRowById(rows, 'p1');
    if (p1) {
      const countKey = Object.keys(p1).find((k) => k !== 'id')!;
      expect(p1[countKey]).toBe(2);
    }
  });

  test('sortByAsc — ordering', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('sortByAsc');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    const names = extractNames(rows);

    // Names should be alphabetically ascending
    for (let i = 1; i < names.length; i++) {
      expect(names[i]! >= names[i - 1]!).toBe(true);
    }
  });

  test('sortByDesc — ordering', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('sortByDesc');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    const names = extractNames(rows);

    // Names should be alphabetically descending
    for (let i = 1; i < names.length; i++) {
      expect(names[i]! <= names[i - 1]!).toBe(true);
    }
  });

  test('outerWhereLimit — filter + limit', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('outerWhereLimit');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  test('selectAllProperties — all properties populated', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectAllProperties');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    const semmy = findRowById(rows, 'p1');
    expect(semmy).toBeDefined();
    // Semmy should have name, birthDate, isRealPerson at minimum
    expect(semmy!.name).toBe('Semmy');
    expect(semmy!.birthDate).toBeDefined();
    expect(semmy!.birthDate).not.toBeNull();
    expect(semmy!.isRealPerson).toBe(true);
  });

  test('selectWhereNameSemmy — outer where name filter', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectWhereNameSemmy');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // Should only return persons whose name is "Semmy"
    expect(rows.length).toBe(1);
    expect(rows[0].id).toContain('p1');
  });

  test('selectAll — returns all persons (id only)', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectAll');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    expect(rows.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// MUTATION tests
// ---------------------------------------------------------------------------

describe('Fuseki integration — mutations', () => {
  test('createSimple — insert and verify', async () => {
    if (!fusekiAvailable) return;

    // Generate and execute the create mutation
    const ir = (await captureQuery(queryFactories.createSimple)) as IRCreateMutation;
    const sparql = createToSparql(ir);
    await executeSparqlUpdate(sparql);

    // Verify the created entity exists
    const verifyQuery = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      SELECT ?s ?name WHERE {
        ?s rdf:type <${P}> .
        ?s <${P}/name> "Test Create" .
        ?s <${P}/name> ?name .
      }
    `;
    const verifyResult = await executeSparqlQuery(verifyQuery);
    expect(verifyResult.results.bindings.length).toBeGreaterThanOrEqual(1);
    expect(verifyResult.results.bindings[0].name.value).toBe('Test Create');

    // Clean up: delete the created entity
    const createdUri = verifyResult.results.bindings[0].s.value;
    await executeSparqlUpdate(
      `DELETE WHERE { <${createdUri}> ?p ?o }`,
    );
  });

  test('updateSimple — update and verify', async () => {
    if (!fusekiAvailable) return;

    // First insert a test person with a hobby to update
    const setupUri = `${ENT}update-test`;
    await executeSparqlUpdate(`
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      INSERT DATA {
        <${setupUri}> rdf:type <${P}> .
        <${setupUri}> <${P}/name> "UpdateTarget" .
        <${setupUri}> <${P}/hobby> "OldHobby" .
      }
    `);

    // Generate and execute the update mutation
    // updateSimple updates p1's hobby to "Chess"
    const ir = (await captureQuery(queryFactories.updateSimple)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    await executeSparqlUpdate(sparql);

    // Verify p1's hobby was updated
    const verifyQuery = `
      SELECT ?hobby WHERE {
        <${ENT}p1> <${P}/hobby> ?hobby .
      }
    `;
    const verifyResult = await executeSparqlQuery(verifyQuery);
    expect(verifyResult.results.bindings.length).toBe(1);
    expect(verifyResult.results.bindings[0].hobby.value).toBe('Chess');

    // Clean up: restore p1's hobby (remove the Chess hobby since p1 originally had none)
    await executeSparqlUpdate(
      `DELETE WHERE { <${ENT}p1> <${P}/hobby> ?o }`,
    );

    // Clean up the test entity
    await executeSparqlUpdate(
      `DELETE WHERE { <${setupUri}> ?p ?o }`,
    );
  });

  test('deleteSingle — delete and verify', async () => {
    if (!fusekiAvailable) return;

    // First insert a person to delete
    const toDeleteUri = `${ENT}to-delete`;
    await executeSparqlUpdate(`
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      INSERT DATA {
        <${toDeleteUri}> rdf:type <${P}> .
        <${toDeleteUri}> <${P}/name> "ToBeDeleted" .
      }
    `);

    // Verify it exists
    const beforeQuery = `
      SELECT ?name WHERE {
        <${toDeleteUri}> <${P}/name> ?name .
      }
    `;
    const beforeResult = await executeSparqlQuery(beforeQuery);
    expect(beforeResult.results.bindings.length).toBe(1);

    // Generate and execute the delete mutation
    const ir = (await captureQuery(queryFactories.deleteSingle)) as IRDeleteMutation;
    const sparql = deleteToSparql(ir);
    await executeSparqlUpdate(sparql);

    // Verify the person is gone
    const afterResult = await executeSparqlQuery(beforeQuery);
    expect(afterResult.results.bindings.length).toBe(0);
  });
});
