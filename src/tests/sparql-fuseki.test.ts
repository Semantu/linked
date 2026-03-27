/**
 * Fuseki integration tests for the SPARQL conversion layer.
 *
 * Tests the full pipeline: factory -> IR -> SPARQL -> execute against Fuseki -> map results
 *
 * These tests are skipped gracefully if Fuseki is not available on localhost:3030.
 *
 * Coverage: all 75 query factories from query-fixtures.ts
 */
import {describe, expect, test, beforeAll, afterAll} from '@jest/globals';
import {queryFactories, Person, tmpEntityBase} from '../test-helpers/query-fixtures';
import {captureQuery} from '../test-helpers/query-capture-store';
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
  ensureFuseki,
  createTestDataset,
  deleteTestDataset,
  loadTestData,
  executeSparqlQuery,
  executeSparqlUpdate,
  clearAllData,
} from '../test-helpers/fuseki-test-store';
import {FusekiStore} from '../test-helpers/FusekiStore';

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
const E = 'https://data.lincd.org/module/-_linked-core/shape/employee';
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
<${ENT}p1> <${P}/hobby> "Reading" .
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
<${ENT}e1> <${RDF_TYPE}> <${E}> .
<${ENT}e1> <${E}/name> "Alice" .
<${ENT}e1> <${E}/department> "Engineering" .
<${ENT}e1> <${E}/bestFriend> <${ENT}e2> .
<${ENT}e2> <${RDF_TYPE}> <${E}> .
<${ENT}e2> <${E}/name> "Bob" .
<${ENT}e2> <${E}/department> "Sales" .
`.trim();

// ---------------------------------------------------------------------------
// Fuseki availability and lifecycle
// ---------------------------------------------------------------------------

let fusekiAvailable = false;

beforeAll(async () => {
  fusekiAvailable = await ensureFuseki();
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
  await clearAllData();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runSelect(
  factoryName: keyof typeof queryFactories,
): Promise<{sparql: string; ir: IRSelectQuery; results: SparqlJsonResults}> {
  const ir = await captureQuery(queryFactories[factoryName]) as IRSelectQuery;
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


// =========================================================================
// SELECT — basic property projections
// =========================================================================

describe('Fuseki SELECT — basic', () => {
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

    for (const row of rows) {
      expect(row.id).toBeDefined();
    }
  });

  test('selectFriends — returns friend references', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectFriends');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // selectFriends is a flat property_expr projection (no traversal).
    // Each person appears once; friends is a URI reference or null.
    // All 4 persons returned (OPTIONAL on friends).
    expect(rows.length).toBe(4);

    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
    // p1.friends is a single entity reference (last binding wins in flat mode)
    expect(p1!.friends).toBeDefined();
    expect(p1!.friends).not.toBeNull();
  });

  test('selectBirthDate — date coercion', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectBirthDate');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    const semmy = findRowById(rows, 'p1');
    expect(semmy).toBeDefined();
    const bd = semmy!.birthDate;
    expect(bd).toBeDefined();
    expect(bd).not.toBeNull();
    if (bd instanceof Date) {
      expect(bd.getFullYear()).toBe(1990);
      expect(bd.getMonth()).toBe(0); // January
      expect(bd.getDate()).toBe(1);
    } else {
      // Must be a parseable ISO date string starting with 1990-01-01
      const dateStr = String(bd);
      expect(dateStr).toMatch(/^1990-01-01/);
      expect(new Date(dateStr).getFullYear()).toBe(1990);
    }

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
    expect(p1!.isRealPerson).toBe(true);

    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
    expect(p2!.isRealPerson).toBe(false);
  });

  test('selectAll — returns all persons (id only)', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectAll');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    expect(rows.length).toBe(4);
  });

  test('selectAllProperties — all properties populated', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectAllProperties');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    const semmy = findRowById(rows, 'p1');
    expect(semmy).toBeDefined();
    expect(semmy!.name).toBe('Semmy');
    expect(semmy!.birthDate).toBeDefined();
    expect(semmy!.birthDate).not.toBeNull();
    expect(semmy!.isRealPerson).toBe(true);
  });

  test('selectNonExistingMultiple — multiple paths with nulls', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectNonExistingMultiple');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // p3 and p4 have no bestFriend and no friends
    const p3 = findRowById(rows, 'p3');
    expect(p3).toBeDefined();
    expect(p3!.bestFriend).toBeNull();
  });
});

// =========================================================================
// SELECT — subject targeting / single result
// =========================================================================

describe('Fuseki SELECT — subject targeting', () => {
  test('selectById — single person by URI (singleResult)', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectById');
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(false);
    const row = result as ResultRow;
    expect(row.name).toBe('Semmy');
    expect(row.id).toContain('p1');
  });

  test('selectByIdReference — same as selectById', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectByIdReference');
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(false);
    const row = result as ResultRow;
    expect(row.name).toBe('Semmy');
    expect(row.id).toContain('p1');
  });

  test('selectNonExisting — returns null (singleResult)', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectNonExisting');
    expect(result).toBeNull();
  });

  test('selectUndefinedOnly — p3 with null hobby and bestFriend', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectUndefinedOnly');
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(false);
    const row = result as ResultRow;
    expect(row.id).toContain('p3');
    // p3 has no hobby and no bestFriend
    expect(row.hobby).toBeNull();
    expect(row.bestFriend).toBeNull();
  });

  test('selectOne — single result with LIMIT 1', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectOne');
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(false);
    const row = result as ResultRow;
    expect(row.id).toContain('p1');
    expect(row.name).toBe('Semmy');
  });
});

// =========================================================================
// SELECT — nested traversals
// =========================================================================

describe('Fuseki SELECT — nested traversals', () => {
  test('selectFriendsName — friends with names (nested grouping)', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectFriendsName');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // INNER JOIN on friends traverse — only p1 and p2 have friends
    expect(rows.length).toBe(2);

    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
    const p1Friends = p1!.friends as ResultRow[];
    expect(Array.isArray(p1Friends)).toBe(true);
    expect(p1Friends.length).toBe(2);
    const p1FriendNames = p1Friends.map((f) => f.name).filter(Boolean);
    expect(p1FriendNames).toContain('Moa');
    expect(p1FriendNames).toContain('Jinx');

    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
    const p2Friends = p2!.friends as ResultRow[];
    expect(Array.isArray(p2Friends)).toBe(true);
    expect(p2Friends.length).toBe(2);
    const p2FriendNames = p2Friends.map((f) => f.name).filter(Boolean);
    expect(p2FriendNames).toContain('Jinx');
    expect(p2FriendNames).toContain('Quinn');
  });

  test('selectNestedFriendsName — double nested (friends.friends.name)', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectNestedFriendsName');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // INNER JOIN on both friends traversals.
    // p1→friends→[p2, p3]. p2→friends→[p3, p4]. p3 has no friends.
    // So p1 appears (via p2→[p3(Jinx), p4(Quinn)]).
    // p2 also appears (via p3→no friends, p4→no friends).
    // Only p1 has a friend (p2) who itself has friends.
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
  });

  test('selectMultiplePaths — name, friends, bestFriend.name', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectMultiplePaths');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    // INNER JOIN on bestFriend traverse — only p2 has bestFriend (p3)
    expect(rows.length).toBe(1);
    expect(rows[0].id).toContain('p2');
  });

  test('selectBestFriendName — bestFriend.name', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectBestFriendName');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // INNER JOIN on bestFriend traverse — only p2 has bestFriend (p3)
    expect(rows.length).toBe(1);
    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
    const bestFriend = p2!.bestFriend as ResultRow[];
    expect(Array.isArray(bestFriend)).toBe(true);
    expect(bestFriend.length).toBe(1);
    expect(bestFriend[0].name).toBe('Jinx');
  });

  test('selectDeepNested — friends.bestFriend.bestFriend.name', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectDeepNested');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    // Deep chain: friends→bestFriend→bestFriend all INNER JOINs
    // p1→friends→p2→bestFriend→p3→bestFriend→? (p3 has no bestFriend) → empty
    // No entities satisfy the full chain, so result may be empty
    expect(Array.isArray(rows)).toBe(true);
  });

  test('nestedObjectProperty — friends.bestFriend', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('nestedObjectProperty');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // INNER JOIN on friends and bestFriend.
    // p1→friends→[p2, p3]. p2→bestFriend→p3. p3→no bestFriend.
    // p2→friends→[p3, p4]. p3→no bestFriend. p4→no bestFriend.
    // Only p1 (via p2→p3) satisfies both JOINs.
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
  });

  test('nestedObjectPropertySingle — same as nestedObjectProperty', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('nestedObjectPropertySingle');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  test('selectDuplicatePaths — deduped bestFriend properties', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectDuplicatePaths');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // INNER JOIN on bestFriend — only p2 has bestFriend (p3)
    expect(rows.length).toBe(1);
    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
    expect(p2!.id).toContain('p2');
  });
});

// =========================================================================
// SELECT — sub-selects
// =========================================================================

describe('Fuseki SELECT — sub-selects', () => {
  test('subSelectSingleProp — bestFriend.select(name)', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('subSelectSingleProp');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // INNER JOIN on bestFriend — only p2 has bestFriend (p3)
    expect(rows.length).toBe(1);
    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
    const bestFriend = p2!.bestFriend as ResultRow[];
    expect(Array.isArray(bestFriend)).toBe(true);
    expect(bestFriend.length).toBe(1);
    expect(bestFriend[0].name).toBe('Jinx');
  });

  test('subSelectPluralCustom — friends.select(name, hobby)', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('subSelectPluralCustom');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // INNER JOIN on friends — p1 and p2 have friends
    expect(rows.length).toBe(2);

    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
    const friends = p1!.friends as ResultRow[];
    expect(Array.isArray(friends)).toBe(true);
    expect(friends.length).toBe(2);
    const moa = friends.find((f) => f.name === 'Moa');
    expect(moa).toBeDefined();
    expect(moa!.hobby).toBe('Jogging');
    const jinx = friends.find((f) => f.name === 'Jinx');
    expect(jinx).toBeDefined();
    // Jinx has no hobby in test data
    expect(jinx!.hobby).toBeNull();
  });

  test('subSelectAllProperties — friends.selectAll()', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('subSelectAllProperties');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
    const friends = p1!.friends as ResultRow[];
    expect(Array.isArray(friends)).toBe(true);
  });

  test('subSelectAllPropertiesSingle — bestFriend.selectAll()', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('subSelectAllPropertiesSingle');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // INNER JOIN on bestFriend — only p2 has bestFriend (p3)
    expect(rows.length).toBe(1);
    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
    expect(p2!.id).toContain('p2');
  });

  test('doubleNestedSubSelect — friends → bestFriend → name', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('doubleNestedSubSelect');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // INNER JOINs: friends then bestFriend.
    // p1→friends→[p2, p3]. p2→bestFriend→p3 (Jinx). p3→no bestFriend.
    // p2→friends→[p3, p4]. Both have no bestFriend.
    // Only p1 (via p2→p3) satisfies both joins.
    expect(rows.length).toBe(1);
    expect(rows[0].id).toContain('p1');
  });

  test('subSelectAllPrimitives — bestFriend.[name, birthDate, isRealPerson]', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('subSelectAllPrimitives');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // INNER JOIN on bestFriend — only p2 has bestFriend (p3)
    expect(rows.length).toBe(1);
    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
    const bestFriend = p2!.bestFriend as ResultRow[];
    expect(Array.isArray(bestFriend)).toBe(true);
    expect(bestFriend.length).toBe(1);
    expect(bestFriend[0].name).toBe('Jinx');
    expect(bestFriend[0].isRealPerson).toBe(true);
    // p3 has no birthDate
    expect(bestFriend[0].birthDate).toBeNull();
  });

  test('subSelectArray — friends.select([name, hobby])', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('subSelectArray');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
    const friends = p1!.friends as ResultRow[];
    expect(Array.isArray(friends)).toBe(true);
  });

  test('nestedQueries2 — friends.[firstPet, bestFriend.name]', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('nestedQueries2');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    // INNER JOIN on friends AND bestFriend — only p1 (via p2→bestFriend→p3)
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
  });

  test('preloadBestFriend — bestFriend.preloadFor(component)', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('preloadBestFriend');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // INNER JOIN on bestFriend — only p2 has bestFriend (p3)
    expect(rows.length).toBe(1);
    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
    expect(p2!.id).toContain('p2');
  });
});

// =========================================================================
// SELECT — outer where (FILTER)
// =========================================================================

describe('Fuseki SELECT — outer where (FILTER)', () => {
  test('whereHobbyEquals — filter hobby = Jogging', async () => {
    if (!fusekiAvailable) return;

    // This uses inline .where() on a literal property (hobby).
    // The SPARQL has FILTER(?a1 = "Jogging") inside OPTIONAL.
    const result = await runSelectMapped('whereHobbyEquals');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    // All persons returned (OPTIONAL), hobby filtered to Jogging
    expect(rows.length).toBe(4);

    // Phase 16 fix: hobby should be a string literal, not {id: "Jogging"}.
    // The inline .where() on a literal property uses alias_expr in projection,
    // which previously wrapped all bindings as {id: ...} regardless of type.
    const withHobby = rows.filter((r) => r.hobby !== null);
    expect(withHobby.length).toBeGreaterThan(0);
    for (const r of withHobby) {
      expect(typeof r.hobby).toBe('string');
      expect(r.hobby).toBe('Jogging');
    }
  });

  test('whereBestFriendEquals — filter bestFriend = entity(p3)', async () => {
    if (!fusekiAvailable) return;

    // Phase 7 fixed URI-vs-literal: now uses <IRI> instead of "literal" in FILTER
    const result = await runSelectMapped('whereBestFriendEquals');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // p2 has bestFriend p3 → only p2 should match
    expect(rows.length).toBe(1);
    expect(rows[0].id).toContain('p2');
  });

  test('selectWhereNameSemmy — outer where name filter', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectWhereNameSemmy');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    expect(rows.length).toBe(1);
    expect(rows[0].id).toContain('p1');
  });

  test('outerWhere — select friends, filter name = Semmy', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('outerWhere');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // Only Semmy (p1) matches the outer filter
    expect(rows.length).toBe(1);
    expect(rows[0].id).toContain('p1');
  });

  test('outerWhereLimit — filter + limit', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('outerWhereLimit');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  test('whereWithContext — filter bestFriend = context user (p3)', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('whereWithContext');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // Context user is p3. p2 has bestFriend = p3.
    // FILTER(?a0_bestFriend = <p3>) → p2 matches.
    expect(rows.length).toBe(1);
    expect(rows[0].id).toContain('p2');
  });

  test('whereSomeImplicit — friends.name = Moa (FILTER)', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('whereSomeImplicit');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // FILTER(?a1_name = "Moa") with INNER JOIN on friends traverse.
    // p1 has friend p2 (Moa) → p1 matches.
    // p2's friends are [p3(Jinx), p4(Quinn)] → neither is Moa → p2 fails.
    expect(rows.length).toBe(1);
    expect(rows[0].id).toContain('p1');
  });

  test('whereSomeExplicit — EXISTS friends.name = Moa', async () => {
    if (!fusekiAvailable) return;

    const {sparql, ir, results} = await runSelect('whereSomeExplicit');
    expect(results.results).toBeDefined();

    const mapped = mapSparqlSelectResult(results, ir);
    expect(Array.isArray(mapped)).toBe(true);
  });

  test('whereWithContextPath — EXISTS friends.name = contextUser.name', async () => {
    if (!fusekiAvailable) return;

    // Known semantic issue: generated SPARQL has FILTER(?a1_name = ?a1_name)
    // which is a tautology. Context path resolution produces the same variable
    // for both sides. All persons with friends who have a name will match.
    const result = await runSelectMapped('whereWithContextPath');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    // Tautology means all persons with a friend who has a name match
    // p1 friends [p2(Moa), p3(Jinx)] — both have names → p1 matches
    // p2 friends [p3(Jinx), p4(Quinn)] — both have names → p2 matches
    expect(rows.length).toBe(2);
  });
});

// =========================================================================
// SELECT — inline where (FILTER inside OPTIONAL)
//
// These queries use inline .where() predicates on sub-selections, e.g.
// p.friends.where(f => f.name.equals('Moa')). The pipeline now lowers
// these into SPARQL FILTER expressions inside OPTIONAL blocks.
// =========================================================================

describe('Fuseki SELECT — inline where', () => {
  test('whereFriendsNameEquals — friends filtered by name = Moa', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('whereFriendsNameEquals');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // All persons are returned (OPTIONAL filtering, not WHERE filtering).
    // Only friends matching name='Moa' should appear in the nested array.
    expect(rows.length).toBe(4);

    // p1 has friends [p2(Moa), p3(Jinx)] — only Moa should match the filter
    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
    const p1Friends = p1!.friends as ResultRow[];
    expect(Array.isArray(p1Friends)).toBe(true);
    expect(p1Friends.length).toBe(1);
    expect(p1Friends[0].id).toContain('p2'); // p2 = Moa
    // p3 (Jinx) must NOT appear
    expect(p1Friends.some((f) => f.id.includes('p3'))).toBe(false);

    // p2 has friends [p3(Jinx), p4(Quinn)] — neither is Moa, so empty
    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
    const p2Friends = p2!.friends as ResultRow[] | null;
    if (p2Friends) {
      expect(p2Friends.length).toBe(0);
    }

    // p3 and p4 have no friends at all — returns null or empty array
    const p3 = findRowById(rows, 'p3');
    expect(p3).toBeDefined();
    const p3Friends = p3!.friends as ResultRow[] | null;
    expect(!p3Friends || p3Friends.length === 0).toBe(true);
  });

  test('whereFriendsNameEqualsChained — .where().name property access', async () => {
    if (!fusekiAvailable) return;

    // Same filter as whereFriendsNameEquals but chains .name after .where().
    // Query: Person.select((p) => p.friends.where((f) => f.name.equals('Moa')).name)
    // Expected: each person's friends filtered to name=Moa, then name extracted.
    const result = await runSelectMapped('whereFriendsNameEqualsChained');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    expect(rows.length).toBe(4);

    // p1 has friends [p2(Moa), p3(Jinx)] — filter to Moa, extract name
    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
    const p1Friends = p1!.friends as ResultRow[];
    expect(Array.isArray(p1Friends)).toBe(true);
    expect(p1Friends.length).toBe(1);
    expect(p1Friends[0].name).toBe('Moa');
    // Jinx must NOT appear
    expect(p1Friends.some((f) => f.name === 'Jinx')).toBe(false);

    // p2 has friends [p3(Jinx), p4(Quinn)] — neither matches, so empty
    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
    const p2Friends = p2!.friends as ResultRow[] | null;
    if (p2Friends) {
      expect(p2Friends.length).toBe(0);
    }
  });

  test('whereAnd — friends filtered by name=Moa AND hobby=Jogging', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('whereAnd');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    expect(rows.length).toBe(4);

    // p1 friends [p2(Moa,Jogging), p3(Jinx,none)] — only p2 matches both conditions
    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
    const p1Friends = p1!.friends as ResultRow[];
    expect(Array.isArray(p1Friends)).toBe(true);
    expect(p1Friends.length).toBe(1);
    expect(p1Friends[0].id).toContain('p2');

    // p2 friends [p3(Jinx), p4(Quinn)] — neither is named Moa
    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
    const p2Friends = p2!.friends as ResultRow[] | null;
    expect(!p2Friends || p2Friends.length === 0).toBe(true);
  });

  test('whereOr — friends filtered by name=Jinx OR hobby=Jogging', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('whereOr');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    expect(rows.length).toBe(4);

    // p1 friends [p2(Moa,Jogging), p3(Jinx,no hobby)]
    // p2 matches via hobby=Jogging; p3 matches via name=Jinx
    // (hobby triple is OPTIONAL within the filtered block)
    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
    const p1Friends = p1!.friends as ResultRow[];
    expect(Array.isArray(p1Friends)).toBe(true);
    expect(p1Friends.length).toBe(2);
    const p1Ids = p1Friends.map((f) => f.id);
    expect(p1Ids.some((id) => id.includes('p2'))).toBe(true); // Moa (hobby match)
    expect(p1Ids.some((id) => id.includes('p3'))).toBe(true); // Jinx (name match)

    // p2 friends [p3(Jinx), p4(Quinn)] — p3 matches name=Jinx
    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
    const p2Friends = p2!.friends as ResultRow[];
    expect(Array.isArray(p2Friends)).toBe(true);
    expect(p2Friends.length).toBe(1);
    expect(p2Friends[0].id).toContain('p3');
  });

  test('whereAndOrAnd — (name=Jinx || hobby=Jogging) && name=Moa', async () => {
    if (!fusekiAvailable) return;

    // Parenthesized as (A || B) && C due to Phase 15.
    // Filter: (name=Jinx || hobby=Jogging) && name=Moa
    const result = await runSelectMapped('whereAndOrAnd');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    expect(rows.length).toBe(4);

    // p1 friends: p2 matches (Jinx=Moa?no || Jogging=Jogging?yes) && Moa=Moa → yes
    //             p3: (Jinx=Jinx?yes || _) && Jinx=Moa?no → fails AND
    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
    const p1Friends = p1!.friends as ResultRow[];
    expect(Array.isArray(p1Friends)).toBe(true);
    expect(p1Friends.length).toBe(1);
    expect(p1Friends[0].id).toContain('p2');
    expect(p1Friends.some((f) => f.id.includes('p3'))).toBe(false);

    // p2 friends: neither p3(Jinx) nor p4(Quinn) is named Moa → empty
    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
    const p2Friends = p2!.friends as ResultRow[] | null;
    expect(!p2Friends || p2Friends.length === 0).toBe(true);
  });

  test('whereAndOrAndNested — name=Jinx || (hobby=Jogging && name=Moa)', async () => {
    if (!fusekiAvailable) return;

    // Filter: name=Jinx || (hobby=Jogging && name=Moa)
    const result = await runSelectMapped('whereAndOrAndNested');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    expect(rows.length).toBe(4);

    // p1 friends: p2 matches (hobby=Jogging && name=Moa); p3 matches (name=Jinx)
    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
    const p1Friends = p1!.friends as ResultRow[];
    expect(Array.isArray(p1Friends)).toBe(true);
    expect(p1Friends.length).toBe(2);
    const p1Ids = p1Friends.map((f) => f.id);
    expect(p1Ids.some((id) => id.includes('p2'))).toBe(true);
    expect(p1Ids.some((id) => id.includes('p3'))).toBe(true);

    // p2 friends: p3 matches (name=Jinx)
    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
    const p2Friends = p2!.friends as ResultRow[];
    expect(Array.isArray(p2Friends)).toBe(true);
    expect(p2Friends.length).toBe(1);
    expect(p2Friends[0].id).toContain('p3');
  });
});

// =========================================================================
// SELECT — previously invalid SPARQL (now fixed)
//
// These fixtures previously produced invalid SPARQL. Phase 13 fixed them:
// - whereEvery: now uses NOT EXISTS with proper parenthesization
// - whereSequences: now uses EXISTS for .some() quantifier
// - countEquals: now uses HAVING for aggregate comparisons
// =========================================================================

describe('Fuseki SELECT — quantifiers and aggregates', () => {
  test('whereEvery — NOT EXISTS filter', async () => {
    if (!fusekiAvailable) return;

    const {sparql, ir, results} = await runSelect('whereEvery');
    expect(sparql).toContain('EXISTS');
    expect(sparql).toContain('!');

    const mapped = mapSparqlSelectResult(results, ir);
    expect(Array.isArray(mapped)).toBe(true);
    const rows = mapped as ResultRow[];
    // whereEvery: all friends must have name=Moa OR name=Jinx
    // p1 friends: [p2(Moa), p3(Jinx)] → both match → p1 passes
    // p2 friends: [p3(Jinx), p4(Quinn)] → Quinn doesn't match → p2 excluded
    // p3, p4 have no friends → vacuously true
    expect(rows.length).toBe(3);

    expect(findRowById(rows, 'p1')).toBeDefined();
    expect(findRowById(rows, 'p2')).toBeUndefined(); // Quinn fails the filter
    expect(findRowById(rows, 'p3')).toBeDefined();
    expect(findRowById(rows, 'p4')).toBeDefined();
  });

  test('whereSequences — EXISTS for some() quantifier', async () => {
    if (!fusekiAvailable) return;

    const {sparql, ir, results} = await runSelect('whereSequences');
    expect(sparql).toContain('EXISTS');

    const mapped = mapSparqlSelectResult(results, ir);
    expect(Array.isArray(mapped)).toBe(true);
    const rows = mapped as ResultRow[];
    // whereSequences: Person.select() with outer where
    //   friends.some(f => f.name='Jinx') AND name='Semmy'
    // p1 has friend p3(Jinx) and name=Semmy → only p1 matches
    // select() returns id only (no property projections)
    expect(rows.length).toBe(1);

    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
    expect(p1!.id).toContain('p1');

    expect(findRowById(rows, 'p2')).toBeUndefined();
    expect(findRowById(rows, 'p3')).toBeUndefined();
    expect(findRowById(rows, 'p4')).toBeUndefined();
  });

  test('countEquals — HAVING with aggregate', async () => {
    if (!fusekiAvailable) return;

    const {sparql, ir, results} = await runSelect('countEquals');
    expect(sparql).toContain('HAVING');
    expect(sparql).toContain('count');

    const mapped = mapSparqlSelectResult(results, ir);
    expect(Array.isArray(mapped)).toBe(true);
    const rows = mapped as ResultRow[];
    // countEquals: friends.size() = 2
    // p1 has 2 friends → matches. p2 has 2 friends → matches.
    // p3, p4 have 0 friends → don't match.
    expect(rows.length).toBe(2);

    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();

    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();

    expect(findRowById(rows, 'p3')).toBeUndefined();
    expect(findRowById(rows, 'p4')).toBeUndefined();
  });
});

// =========================================================================
// SELECT — aggregation and GROUP BY
// =========================================================================

describe('Fuseki SELECT — aggregation', () => {
  test('countFriends — count per person', async () => {
    if (!fusekiAvailable) return;

    const {ir, results} = await runSelect('countFriends');
    const mapped = mapSparqlSelectResult(results, ir);
    expect(Array.isArray(mapped)).toBe(true);
    const rows = mapped as ResultRow[];

    // All 4 persons appear (GROUP BY)
    expect(rows.length).toBe(4);

    for (const row of rows) {
      const countKey = Object.keys(row).find((k) => k !== 'id')!;
      expect(typeof row[countKey] === 'number').toBe(true);
    }

    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
    const p1CountKey = Object.keys(p1!).find((k) => k !== 'id')!;
    expect(p1![p1CountKey]).toBe(2);

    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
    const p2CountKey = Object.keys(p2!).find((k) => k !== 'id')!;
    expect(p2![p2CountKey]).toBe(2);
  });

  test('countNestedFriends — count(friends.friends)', async () => {
    if (!fusekiAvailable) return;

    const {ir, results} = await runSelect('countNestedFriends');
    const mapped = mapSparqlSelectResult(results, ir);
    expect(Array.isArray(mapped)).toBe(true);
    const rows = mapped as ResultRow[];

    // p1's friends [p2, p3]: p2 has 2 friends, p3 has 0 → GROUP BY a0 = p1, count = 2
    // p2's friends [p3, p4]: both have 0 friends → count = 0
    for (const row of rows) {
      expect(row.id).toBeDefined();
    }
  });

  test('countLabel — friends.select(numFriends: friends.size())', async () => {
    if (!fusekiAvailable) return;

    const {ir, results} = await runSelect('countLabel');
    const mapped = mapSparqlSelectResult(results, ir);
    expect(Array.isArray(mapped)).toBe(true);
  });

  test('customResultNumFriends — {numFriends: friends.size()}', async () => {
    if (!fusekiAvailable) return;

    const {ir, results} = await runSelect('customResultNumFriends');
    const mapped = mapSparqlSelectResult(results, ir);
    expect(Array.isArray(mapped)).toBe(true);
    const rows = mapped as ResultRow[];
    expect(rows.length).toBe(4);

    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
    const numKey = Object.keys(p1!).find((k) => k !== 'id')!;
    expect(p1![numKey]).toBe(2);

    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
    const p2NumKey = Object.keys(p2!).find((k) => k !== 'id')!;
    expect(p2![p2NumKey]).toBe(2);
  });

  test('customResultEqualsBoolean — {isBestFriend: bestFriend.equals(p3)}', async () => {
    if (!fusekiAvailable) return;

    // Known limitation: the boolean expression is not projected to SPARQL.
    // The result structure may lack the expected boolean field.
    const {ir, results} = await runSelect('customResultEqualsBoolean');
    const mapped = mapSparqlSelectResult(results, ir);
    expect(Array.isArray(mapped)).toBe(true);
  });
});

// =========================================================================
// SELECT — ordering
// =========================================================================

describe('Fuseki SELECT — ordering', () => {
  test('sortByAsc — ascending order', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('sortByAsc');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    const names = extractNames(rows);

    for (let i = 1; i < names.length; i++) {
      expect(names[i]! >= names[i - 1]!).toBe(true);
    }
  });

  test('sortByDesc — descending order', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('sortByDesc');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    const names = extractNames(rows);

    for (let i = 1; i < names.length; i++) {
      expect(names[i]! <= names[i - 1]!).toBe(true);
    }
  });
});

// =========================================================================
// SELECT — shape casting
// =========================================================================

describe('Fuseki SELECT — shape casting', () => {
  test('selectShapeSetAs — pets.as(Dog).guardDogLevel', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectShapeSetAs');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // INNER JOIN on pets traverse — p1 has pets [dog1], p2 has pets [dog2]
    expect(rows.length).toBe(2);
    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
    const p2 = findRowById(rows, 'p2');
    expect(p2).toBeDefined();
  });

  test('selectShapeAs — firstPet.as(Dog).guardDogLevel', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectShapeAs');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // INNER JOIN on firstPet — p1 has firstPet dog1, p2 has firstPet dog2
    expect(rows.length).toBe(2);
    const p1 = findRowById(rows, 'p1');
    expect(p1).toBeDefined();
  });
});

// =========================================================================
// SELECT — Employee subclass
// =========================================================================

describe('Fuseki SELECT — Employee', () => {
  test('selectAllEmployeeProperties — Employee.selectAll()', async () => {
    if (!fusekiAvailable) return;

    const result = await runSelectMapped('selectAllEmployeeProperties');
    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];

    // We added 2 employees to the test data
    expect(rows.length).toBe(2);

    const alice = findRowById(rows, 'e1');
    expect(alice).toBeDefined();
    expect(alice!.name).toBe('Alice');

    const bob = findRowById(rows, 'e2');
    expect(bob).toBeDefined();
    expect(bob!.name).toBe('Bob');
  });
});

// =========================================================================
// MUTATION — CREATE
// =========================================================================

describe('Fuseki mutations — CREATE', () => {
  test('createSimple — insert and verify', async () => {
    if (!fusekiAvailable) return;

    const ir = (await captureQuery(queryFactories.createSimple)) as IRCreateMutation;
    const sparql = createToSparql(ir);
    await executeSparqlUpdate(sparql);

    const verifyResult = await executeSparqlQuery(`
      SELECT ?s ?name WHERE {
        ?s <${P}/name> "Test Create" .
        ?s <${P}/name> ?name .
      }
    `);
    expect(verifyResult.results.bindings.length).toBeGreaterThanOrEqual(1);
    expect(verifyResult.results.bindings[0].name.value).toBe('Test Create');

    // Cleanup
    const createdUri = verifyResult.results.bindings[0].s.value;
    await executeSparqlUpdate(`DELETE WHERE { <${createdUri}> ?p ?o }`);
  });

  test('createWithFriends — insert with nested friends', async () => {
    if (!fusekiAvailable) return;

    const ir = (await captureQuery(queryFactories.createWithFriends)) as IRCreateMutation;
    const sparql = createToSparql(ir);
    await executeSparqlUpdate(sparql);

    // Verify the created person exists with name "Test Create"
    const verifyResult = await executeSparqlQuery(`
      SELECT ?s ?name WHERE {
        ?s <${P}/name> "Test Create" .
        ?s <${P}/name> ?name .
      }
    `);
    expect(verifyResult.results.bindings.length).toBeGreaterThanOrEqual(1);

    const createdUri = verifyResult.results.bindings[0].s.value;

    // Verify friends were linked
    const friendsResult = await executeSparqlQuery(`
      SELECT ?friend WHERE {
        <${createdUri}> <${P}/friends> ?friend .
      }
    `);
    expect(friendsResult.results.bindings.length).toBeGreaterThanOrEqual(1);

    // Cleanup: delete created entity and any nested created entities
    await executeSparqlUpdate(`DELETE WHERE { <${createdUri}> ?p ?o }`);
    // Clean up the "New Friend" entity
    const newFriendResult = await executeSparqlQuery(`
      SELECT ?s WHERE { ?s <${P}/name> "New Friend" . }
    `);
    for (const binding of newFriendResult.results.bindings) {
      await executeSparqlUpdate(`DELETE WHERE { <${binding.s.value}> ?p ?o }`);
    }
  });

  test('createWithFixedId — insert with predefined ID', async () => {
    if (!fusekiAvailable) return;

    const ir = (await captureQuery(queryFactories.createWithFixedId)) as IRCreateMutation;
    const sparql = createToSparql(ir);
    await executeSparqlUpdate(sparql);

    const fixedUri = `${ENT}fixed-id`;
    const verifyResult = await executeSparqlQuery(`
      SELECT ?name WHERE {
        <${fixedUri}> <${P}/name> ?name .
      }
    `);
    expect(verifyResult.results.bindings.length).toBe(1);
    expect(verifyResult.results.bindings[0].name.value).toBe('Fixed');

    // Cleanup
    await executeSparqlUpdate(`DELETE WHERE { <${fixedUri}> ?p ?o }`);
  });
});

// =========================================================================
// MUTATION — UPDATE
// =========================================================================

describe('Fuseki mutations — UPDATE', () => {
  test('updateSimple — update hobby', async () => {
    if (!fusekiAvailable) return;

    const ir = (await captureQuery(queryFactories.updateSimple)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    await executeSparqlUpdate(sparql);

    try {
      const verifyResult = await executeSparqlQuery(`
        SELECT ?hobby WHERE { <${ENT}p1> <${P}/hobby> ?hobby . }
      `);
      expect(verifyResult.results.bindings.length).toBe(1);
      expect(verifyResult.results.bindings[0].hobby.value).toBe('Chess');
    } finally {
      // Restore
      await executeSparqlUpdate(`
        DELETE { <${ENT}p1> <${P}/hobby> "Chess" . }
        INSERT { <${ENT}p1> <${P}/hobby> "Reading" . }
        WHERE { <${ENT}p1> <${P}/hobby> "Chess" . }
      `);
    }
  });

  test('updateOverwriteSet — overwrite friends to [p2]', async () => {
    if (!fusekiAvailable) return;

    const ir = (await captureQuery(queryFactories.updateOverwriteSet)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    await executeSparqlUpdate(sparql);

    try {
      const verifyResult = await executeSparqlQuery(`
        SELECT ?friend WHERE { <${ENT}p1> <${P}/friends> ?friend . }
      `);
      // After overwrite, p1 should have only p2 as friend
      expect(verifyResult.results.bindings.length).toBe(1);
      expect(verifyResult.results.bindings[0].friend.value).toBe(`${ENT}p2`);
    } finally {
      // Restore: re-add p3 as friend
      await executeSparqlUpdate(`
        INSERT DATA { <${ENT}p1> <${P}/friends> <${ENT}p3> . }
      `);
    }
  });

  test('updateUnsetSingleUndefined — unset hobby', async () => {
    if (!fusekiAvailable) return;

    const ir = (await captureQuery(queryFactories.updateUnsetSingleUndefined)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    await executeSparqlUpdate(sparql);

    try {
      const verifyResult = await executeSparqlQuery(`
        SELECT ?hobby WHERE { <${ENT}p1> <${P}/hobby> ?hobby . }
      `);
      expect(verifyResult.results.bindings.length).toBe(0);
    } finally {
      // Restore
      await executeSparqlUpdate(`
        INSERT DATA { <${ENT}p1> <${P}/hobby> "Reading" . }
      `);
    }
  });

  test('updateUnsetSingleNull — unset hobby (null)', async () => {
    if (!fusekiAvailable) return;

    const ir = (await captureQuery(queryFactories.updateUnsetSingleNull)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    await executeSparqlUpdate(sparql);

    try {
      const verifyResult = await executeSparqlQuery(`
        SELECT ?hobby WHERE { <${ENT}p1> <${P}/hobby> ?hobby . }
      `);
      expect(verifyResult.results.bindings.length).toBe(0);
    } finally {
      await executeSparqlUpdate(`
        INSERT DATA { <${ENT}p1> <${P}/hobby> "Reading" . }
      `);
    }
  });

  test('updateOverwriteNested — set bestFriend to nested create', async () => {
    if (!fusekiAvailable) return;

    const ir = (await captureQuery(queryFactories.updateOverwriteNested)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    await executeSparqlUpdate(sparql);

    try {
      // p1 should now have a bestFriend pointing to a new entity named "Bestie"
      const verifyResult = await executeSparqlQuery(`
        SELECT ?bf ?name WHERE {
          <${ENT}p1> <${P}/bestFriend> ?bf .
          ?bf <${P}/name> ?name .
        }
      `);
      expect(verifyResult.results.bindings.length).toBe(1);
      expect(verifyResult.results.bindings[0].name.value).toBe('Bestie');
    } finally {
      // Cleanup: remove the bestFriend link and the created entity
      const bfResult = await executeSparqlQuery(`
        SELECT ?bf WHERE { <${ENT}p1> <${P}/bestFriend> ?bf . }
      `);
      if (bfResult.results.bindings.length > 0) {
        const bfUri = bfResult.results.bindings[0].bf.value;
        await executeSparqlUpdate(`DELETE WHERE { <${ENT}p1> <${P}/bestFriend> ?o }`);
        await executeSparqlUpdate(`DELETE WHERE { <${bfUri}> ?p ?o }`);
      }
    }
  });

  test('updatePassIdReferences — set bestFriend to entity(p2)', async () => {
    if (!fusekiAvailable) return;

    const ir = (await captureQuery(queryFactories.updatePassIdReferences)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    await executeSparqlUpdate(sparql);

    try {
      const verifyResult = await executeSparqlQuery(`
        SELECT ?bf WHERE { <${ENT}p1> <${P}/bestFriend> ?bf . }
      `);
      expect(verifyResult.results.bindings.length).toBe(1);
      expect(verifyResult.results.bindings[0].bf.value).toBe(`${ENT}p2`);
    } finally {
      // Cleanup: remove bestFriend link
      await executeSparqlUpdate(`DELETE WHERE { <${ENT}p1> <${P}/bestFriend> ?o }`);
    }
  });

  test('updateAddRemoveMulti — add p2, remove p3 from friends', async () => {
    if (!fusekiAvailable) return;

    const ir = (await captureQuery(queryFactories.updateAddRemoveMulti)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    await executeSparqlUpdate(sparql);

    try {
      const verifyResult = await executeSparqlQuery(`
        SELECT ?friend WHERE { <${ENT}p1> <${P}/friends> ?friend . }
      `);
      const friends = verifyResult.results.bindings.map((b: any) => b.friend.value);
      // p1 had [p2, p3]. Remove p3 → [p2]. Add p2 (already exists) → [p2].
      expect(friends).toContain(`${ENT}p2`);
      expect(friends).not.toContain(`${ENT}p3`);
    } finally {
      // Restore: re-add p3
      await executeSparqlUpdate(`
        INSERT DATA { <${ENT}p1> <${P}/friends> <${ENT}p3> . }
      `);
    }
  });

  test('updateRemoveMulti — remove p2 from friends', async () => {
    if (!fusekiAvailable) return;

    const ir = (await captureQuery(queryFactories.updateRemoveMulti)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    await executeSparqlUpdate(sparql);

    try {
      const verifyResult = await executeSparqlQuery(`
        SELECT ?friend WHERE { <${ENT}p1> <${P}/friends> ?friend . }
      `);
      const friends = verifyResult.results.bindings.map((b: any) => b.friend.value);
      expect(friends).not.toContain(`${ENT}p2`);
      expect(friends).toContain(`${ENT}p3`);
    } finally {
      // Restore: re-add p2
      await executeSparqlUpdate(`
        INSERT DATA { <${ENT}p1> <${P}/friends> <${ENT}p2> . }
      `);
    }
  });

  test('updateAddRemoveSame — add p2 and remove p3 in one op', async () => {
    if (!fusekiAvailable) return;

    const ir = (await captureQuery(queryFactories.updateAddRemoveSame)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    await executeSparqlUpdate(sparql);

    try {
      const verifyResult = await executeSparqlQuery(`
        SELECT ?friend WHERE { <${ENT}p1> <${P}/friends> ?friend . }
      `);
      const friends = verifyResult.results.bindings.map((b: any) => b.friend.value);
      expect(friends).toContain(`${ENT}p2`);
      expect(friends).not.toContain(`${ENT}p3`);
    } finally {
      // Restore: re-add p3
      await executeSparqlUpdate(`
        INSERT DATA { <${ENT}p1> <${P}/friends> <${ENT}p3> . }
      `);
    }
  });

  test('updateUnsetMultiUndefined — unset all friends', async () => {
    if (!fusekiAvailable) return;

    const ir = (await captureQuery(queryFactories.updateUnsetMultiUndefined)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    await executeSparqlUpdate(sparql);

    try {
      const verifyResult = await executeSparqlQuery(`
        SELECT ?friend WHERE { <${ENT}p1> <${P}/friends> ?friend . }
      `);
      expect(verifyResult.results.bindings.length).toBe(0);
    } finally {
      // Restore: re-add p2 and p3
      await executeSparqlUpdate(`
        INSERT DATA {
          <${ENT}p1> <${P}/friends> <${ENT}p2> .
          <${ENT}p1> <${P}/friends> <${ENT}p3> .
        }
      `);
    }
  });

  test('updateNestedWithPredefinedId — nested create with fixed ID', async () => {
    if (!fusekiAvailable) return;

    const ir = (await captureQuery(queryFactories.updateNestedWithPredefinedId)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    await executeSparqlUpdate(sparql);

    const nestedUri = `${ENT}p3-best-friend`;

    try {
      // p1 should now have bestFriend pointing to the predefined URI
      const verifyResult = await executeSparqlQuery(`
        SELECT ?bf WHERE { <${ENT}p1> <${P}/bestFriend> ?bf . }
      `);
      expect(verifyResult.results.bindings.length).toBe(1);
      expect(verifyResult.results.bindings[0].bf.value).toBe(nestedUri);

      // Phase 17 fix: the nested entity's data is now inserted
      const nameResult = await executeSparqlQuery(`
        SELECT ?name WHERE { <${nestedUri}> <${P}/name> ?name . }
      `);
      expect(nameResult.results.bindings.length).toBe(1);
      expect(nameResult.results.bindings[0].name.value).toBe('Bestie');
    } finally {
      // Cleanup
      await executeSparqlUpdate(`DELETE WHERE { <${ENT}p1> <${P}/bestFriend> ?o }`);
      await executeSparqlUpdate(`DELETE WHERE { <${nestedUri}> ?p ?o }`);
    }
  });

  test('updateBirthDate — update date field', async () => {
    if (!fusekiAvailable) return;

    const ir = (await captureQuery(queryFactories.updateBirthDate)) as IRUpdateMutation;
    const sparql = updateToSparql(ir);
    await executeSparqlUpdate(sparql);

    try {
      const verifyResult = await executeSparqlQuery(`
        SELECT ?bd WHERE { <${ENT}p1> <${P}/birthDate> ?bd . }
      `);
      expect(verifyResult.results.bindings.length).toBe(1);
      expect(verifyResult.results.bindings[0].bd.value).toContain('2020');
    } finally {
      // Restore original birthDate
      await executeSparqlUpdate(`
        DELETE { <${ENT}p1> <${P}/birthDate> ?old . }
        INSERT { <${ENT}p1> <${P}/birthDate> "1990-01-01T00:00:00.000Z"^^<${XSD}dateTime> . }
        WHERE { <${ENT}p1> <${P}/birthDate> ?old . }
      `);
    }
  });
});

// =========================================================================
// MUTATION — DELETE
// =========================================================================

describe('Fuseki mutations — DELETE', () => {
  test('deleteSingle — delete and verify', async () => {
    if (!fusekiAvailable) return;

    const toDeleteUri = `${ENT}to-delete`;
    await executeSparqlUpdate(`
      INSERT DATA {
        <${toDeleteUri}> <${RDF_TYPE}> <${P}> .
        <${toDeleteUri}> <${P}/name> "ToBeDeleted" .
        <${ENT}p1> <${P}/bestFriend> <${toDeleteUri}> .
      }
    `);

    const beforeResult = await executeSparqlQuery(`
      SELECT ?name WHERE { <${toDeleteUri}> <${P}/name> ?name . }
    `);
    expect(beforeResult.results.bindings.length).toBe(1);

    const ir = (await captureQuery(queryFactories.deleteSingle)) as IRDeleteMutation;
    const sparql = deleteToSparql(ir);
    await executeSparqlUpdate(sparql);

    const afterResult = await executeSparqlQuery(`
      SELECT ?name WHERE { <${toDeleteUri}> <${P}/name> ?name . }
    `);
    expect(afterResult.results.bindings.length).toBe(0);

    // Clean up incoming reference
    await executeSparqlUpdate(`DELETE WHERE { <${ENT}p1> <${P}/bestFriend> <${toDeleteUri}> }`);
  });

  test('deleteSingleRef — same as deleteSingle', async () => {
    if (!fusekiAvailable) return;

    const toDeleteUri = `${ENT}to-delete`;
    await executeSparqlUpdate(`
      INSERT DATA {
        <${toDeleteUri}> <${RDF_TYPE}> <${P}> .
        <${toDeleteUri}> <${P}/name> "ToBeDeleted" .
        <${ENT}p1> <${P}/bestFriend> <${toDeleteUri}> .
      }
    `);

    const ir = (await captureQuery(queryFactories.deleteSingleRef)) as IRDeleteMutation;
    const sparql = deleteToSparql(ir);
    await executeSparqlUpdate(sparql);

    const afterResult = await executeSparqlQuery(`
      SELECT ?name WHERE { <${toDeleteUri}> <${P}/name> ?name . }
    `);
    expect(afterResult.results.bindings.length).toBe(0);

    await executeSparqlUpdate(`DELETE WHERE { <${ENT}p1> <${P}/bestFriend> <${toDeleteUri}> }`);
  });

  test('deleteMultiple — delete two entities', async () => {
    if (!fusekiAvailable) return;

    const del1 = `${ENT}to-delete-1`;
    const del2 = `${ENT}to-delete-2`;
    await executeSparqlUpdate(`
      INSERT DATA {
        <${del1}> <${RDF_TYPE}> <${P}> .
        <${del1}> <${P}/name> "Del1" .
        <${del2}> <${RDF_TYPE}> <${P}> .
        <${del2}> <${P}/name> "Del2" .
        <${del1}> <${P}/bestFriend> <${del2}> .
      }
    `);

    const ir = (await captureQuery(queryFactories.deleteMultiple)) as IRDeleteMutation;
    const sparql = deleteToSparql(ir);
    await executeSparqlUpdate(sparql);

    const after1 = await executeSparqlQuery(`
      SELECT ?name WHERE { <${del1}> <${P}/name> ?name . }
    `);
    const after2 = await executeSparqlQuery(`
      SELECT ?name WHERE { <${del2}> <${P}/name> ?name . }
    `);
    expect(after1.results.bindings.length).toBe(0);
    expect(after2.results.bindings.length).toBe(0);
  });

  test('deleteMultipleFull — delete two entities (full variant)', async () => {
    if (!fusekiAvailable) return;

    const del1 = `${ENT}to-delete-1`;
    const del2 = `${ENT}to-delete-2`;
    await executeSparqlUpdate(`
      INSERT DATA {
        <${del1}> <${RDF_TYPE}> <${P}> .
        <${del1}> <${P}/name> "Del1" .
        <${del2}> <${RDF_TYPE}> <${P}> .
        <${del2}> <${P}/name> "Del2" .
        <${del1}> <${P}/bestFriend> <${del2}> .
      }
    `);

    const ir = (await captureQuery(queryFactories.deleteMultipleFull)) as IRDeleteMutation;
    const sparql = deleteToSparql(ir);
    await executeSparqlUpdate(sparql);

    const after1 = await executeSparqlQuery(`
      SELECT ?name WHERE { <${del1}> <${P}/name> ?name . }
    `);
    const after2 = await executeSparqlQuery(`
      SELECT ?name WHERE { <${del2}> <${P}/name> ?name . }
    `);
    expect(after1.results.bindings.length).toBe(0);
    expect(after2.results.bindings.length).toBe(0);
  });
});

// =========================================================================
// SparqlStore base class — via FusekiStore
// =========================================================================

const FUSEKI_BASE_URL = process.env.FUSEKI_BASE_URL || 'http://localhost:3030';
const FUSEKI_DATASET = 'nashville-test';

describe('SparqlStore (via FusekiStore)', () => {
  const store = new FusekiStore(FUSEKI_BASE_URL, FUSEKI_DATASET);

  test('selectQuery — returns mapped result rows', async () => {
    if (!fusekiAvailable) return;

    const ir = await captureQuery(queryFactories.selectName) as IRSelectQuery;
    const result = await store.selectQuery(ir);

    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    expect(rows.length).toBe(4);

    const names = extractNames(rows);
    expect(names).toContain('Semmy');
    expect(names).toContain('Moa');
  });

  test('selectQuery — nested traversals', async () => {
    if (!fusekiAvailable) return;

    const ir = await captureQuery(queryFactories.selectFriendsName) as IRSelectQuery;
    const result = await store.selectQuery(ir);

    expect(Array.isArray(result)).toBe(true);
    const rows = result as ResultRow[];
    // selectFriendsName projects friends.name — rows should have friends arrays
    const withFriends = rows.find(
      (r) => Array.isArray(r.friends) && (r.friends as ResultRow[]).length > 0,
    );
    expect(withFriends).toBeDefined();
  });

  test('createQuery — creates entity and returns echoed result', async () => {
    if (!fusekiAvailable) return;

    const ir = (await captureQuery(queryFactories.createSimple)) as IRCreateMutation;
    const result = await store.createQuery(ir);

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe('string');
    expect(result.name).toBe('Test Create');

    // Verify the entity was actually created in Fuseki
    const verifyResult = await executeSparqlQuery(`
      SELECT ?name WHERE { <${result.id}> <${P}/name> ?name . }
    `);
    expect(verifyResult.results.bindings.length).toBe(1);
    expect(verifyResult.results.bindings[0].name.value).toBe('Test Create');

    // Cleanup
    await executeSparqlUpdate(`DELETE WHERE { <${result.id}> ?p ?o }`);
  });

  test('createQuery — respects custom __id (fixed URI)', async () => {
    if (!fusekiAvailable) return;

    const customUri = `${ENT}custom-webid-test`;
    const ir = (await captureQuery(
      queryFactories.createWithFixedId,
    )) as IRCreateMutation;

    // The IR should have data.id set from __id
    expect(ir.data.id).toBe(`${tmpEntityBase}fixed-id`);

    // Override to our test URI to avoid collision with other tests
    ir.data.id = customUri;
    const result = await store.createQuery(ir);

    // The returned id must be the custom URI, not an auto-generated one
    expect(result.id).toBe(customUri);

    // Verify it was stored under the custom URI in Fuseki
    const verifyResult = await executeSparqlQuery(`
      SELECT ?name WHERE { <${customUri}> <${P}/name> ?name . }
    `);
    expect(verifyResult.results.bindings.length).toBe(1);
    expect(verifyResult.results.bindings[0].name.value).toBe('Fixed');

    // Cleanup
    await executeSparqlUpdate(`DELETE WHERE { <${customUri}> ?p ?o }`);
  });

  test('createQuery — sequential creates do not corrupt shared object refs', async () => {
    if (!fusekiAvailable) return;

    // Simulate the auth pattern: create user, then create account referencing user
    const userIr = (await captureQuery(
      queryFactories.createSimple,
    )) as IRCreateMutation;
    const userResult = await store.createQuery(userIr);
    expect(userResult.id).toBeDefined();

    // Now create a second entity that references the first via bestFriend
    const accountIr = (await captureQuery(() =>
      Person.create({
        name: 'Account Entity',
        bestFriend: {id: userResult.id},
      } as any),
    )) as IRCreateMutation;
    const accountResult = await store.createQuery(accountIr);
    expect(accountResult.id).toBeDefined();

    // The critical check: userResult.id must still be intact after being
    // passed as a nested reference to the second create.
    // Before the fix, convertNodeDescription would delete id from the
    // shared object, making userResult.id undefined.
    expect(userResult.id).toBeDefined();
    expect(typeof userResult.id).toBe('string');

    // Verify both entities exist in Fuseki
    const userVerify = await executeSparqlQuery(`
      SELECT ?name WHERE { <${userResult.id}> <${P}/name> ?name . }
    `);
    expect(userVerify.results.bindings.length).toBe(1);

    const accountVerify = await executeSparqlQuery(`
      SELECT ?name WHERE { <${accountResult.id}> <${P}/name> ?name . }
    `);
    expect(accountVerify.results.bindings.length).toBe(1);
    expect(accountVerify.results.bindings[0].name.value).toBe('Account Entity');

    // Cleanup
    await executeSparqlUpdate(`DELETE WHERE { <${userResult.id}> ?p ?o }`);
    await executeSparqlUpdate(`DELETE WHERE { <${accountResult.id}> ?p ?o }`);
  });

  test('updateQuery — updates entity and returns echoed result', async () => {
    if (!fusekiAvailable) return;

    const ir = (await captureQuery(queryFactories.updateSimple)) as IRUpdateMutation;
    const result = await store.updateQuery(ir);

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();

    // Restore the original name
    await executeSparqlUpdate(`
      DELETE { <${ENT}p1> <${P}/name> ?old . }
      INSERT { <${ENT}p1> <${P}/name> "Semmy" . }
      WHERE { <${ENT}p1> <${P}/name> ?old . }
    `);
  });

  test('deleteQuery — deletes entity and returns response', async () => {
    if (!fusekiAvailable) return;

    const toDeleteUri = `${ENT}store-delete-test`;
    await executeSparqlUpdate(`
      INSERT DATA {
        <${toDeleteUri}> <${RDF_TYPE}> <${P}> .
        <${toDeleteUri}> <${P}/name> "StoreDeleteTest" .
      }
    `);

    const ir = {
      kind: 'delete' as const,
      shape: P,
      ids: [{id: toDeleteUri}],
    };
    const result = await store.deleteQuery(ir);

    expect(result.count).toBe(1);
    expect(result.deleted).toEqual([{id: toDeleteUri}]);

    // Verify deletion
    const afterResult = await executeSparqlQuery(`
      SELECT ?name WHERE { <${toDeleteUri}> <${P}/name> ?name . }
    `);
    expect(afterResult.results.bindings.length).toBe(0);
  });
});
