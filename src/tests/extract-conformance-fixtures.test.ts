/**
 * Conformance fixture extraction script.
 *
 * Runs each query factory, captures the IR and SPARQL output,
 * and writes JSON fixture files to spec/conformance/.
 *
 * Run with: npx jest --config jest.config.js --runInBand src/tests/extract-conformance-fixtures.test.ts
 */
import {describe, test} from '@jest/globals';
import {queryFactories} from '../test-helpers/query-fixtures';
import {captureQuery} from '../test-helpers/query-capture-store';
import {selectToSparql, createToSparql, updateToSparql, deleteToSparql, deleteAllToSparql, deleteWhereToSparql, updateWhereToSparql} from '../sparql/irToAlgebra';
import {setQueryContext} from '../queries/QueryContext';
import {Person} from '../test-helpers/query-fixtures';
import * as fs from 'fs';
import * as path from 'path';

import '../ontologies/rdf';
import '../ontologies/xsd';

setQueryContext('user', {id: 'user-1'}, Person);

const SPEC_DIR = path.resolve(__dirname, '../../spec/conformance');

/** Strip undefined values from IR for clean JSON. */
const sanitize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce(
      (acc, [key, child]) => {
        if (child !== undefined) acc[key] = sanitize(child);
        return acc;
      },
      {} as Record<string, unknown>,
    );
  }
  return value;
};

// ---------------------------------------------------------------------------
// Select query fixtures
// ---------------------------------------------------------------------------

const selectFactories: Record<string, {description: string; category: string}> = {
  // Basic selection
  selectName: {description: 'Select name property from Person', category: 'basic-select'},
  selectFriends: {description: 'Select friends property from Person', category: 'basic-select'},
  selectBirthDate: {description: 'Select birthDate property from Person', category: 'basic-select'},
  selectIsRealPerson: {description: 'Select boolean isRealPerson from Person', category: 'basic-select'},
  selectAll: {description: 'Select Person without specific properties (id only)', category: 'basic-select'},
  selectAllProperties: {description: 'Select all properties from Person', category: 'basic-select'},
  selectNonExistingMultiple: {description: 'Select multiple optional properties', category: 'basic-select'},

  // Subject targeting
  selectById: {description: 'Select by subject ID (entity)', category: 'subject-targeting'},
  selectByIdReference: {description: 'Select by subject ID reference', category: 'subject-targeting'},
  selectNonExisting: {description: 'Select non-existing entity', category: 'subject-targeting'},
  selectUndefinedOnly: {description: 'Select undefined-only properties for entity', category: 'subject-targeting'},
  selectOne: {description: 'Select one with .one() / LIMIT 1', category: 'subject-targeting'},

  // Nested traversals
  selectFriendsName: {description: 'Traverse friends then select name', category: 'nested-traversal'},
  selectNestedFriendsName: {description: 'Double-nested traversal: friends.friends.name', category: 'nested-traversal'},
  selectMultiplePaths: {description: 'Multiple paths: name, friends, bestFriend.name', category: 'nested-traversal'},
  selectBestFriendName: {description: 'Single-value traversal: bestFriend.name', category: 'nested-traversal'},
  selectDeepNested: {description: 'Deep nesting: friends.bestFriend.bestFriend.name', category: 'nested-traversal'},
  selectDuplicatePaths: {description: 'Multiple properties from same traversal target', category: 'nested-traversal'},
  nestedObjectProperty: {description: 'Nested object property: friends.bestFriend', category: 'nested-traversal'},

  // Inline where (filter on traversal)
  whereFriendsNameEquals: {description: 'Inline where: friends filtered by name', category: 'inline-where'},
  whereHobbyEquals: {description: 'Inline where: hobby filtered by value', category: 'inline-where'},
  whereAnd: {description: 'Inline where: AND condition on friends', category: 'inline-where'},
  whereOr: {description: 'Inline where: OR condition on friends', category: 'inline-where'},
  whereAndOrAnd: {description: 'Inline where: nested AND/OR/AND', category: 'inline-where'},
  whereAndOrAndNested: {description: 'Inline where: deeply nested AND/OR/AND', category: 'inline-where'},

  // Outer where (query-level filter)
  selectWhereNameSemmy: {description: 'Outer where: name equals literal', category: 'outer-where'},
  whereBestFriendEquals: {description: 'Outer where: bestFriend equals reference', category: 'outer-where'},
  outerWhere: {description: 'Outer where with separate select', category: 'outer-where'},
  outerWhereLimit: {description: 'Outer where with OR and LIMIT', category: 'outer-where'},
  whereSomeImplicit: {description: 'Implicit some: friends.name.equals', category: 'outer-where'},
  whereSomeExplicit: {description: 'Explicit some(): EXISTS subquery', category: 'outer-where'},
  whereEvery: {description: 'Every(): NOT EXISTS(NOT ...) pattern', category: 'outer-where'},
  whereSequences: {description: 'Chained some().and() sequence', category: 'outer-where'},

  // Aggregates
  countFriends: {description: 'Count friends with GROUP BY', category: 'aggregation'},
  countNestedFriends: {description: 'Count nested friends.friends with GROUP BY', category: 'aggregation'},
  countLabel: {description: 'Count with custom label in sub-select', category: 'aggregation'},
  customResultNumFriends: {description: 'Custom result object with count', category: 'aggregation'},
  countEquals: {description: 'Where clause on aggregate (HAVING)', category: 'aggregation'},
  customResultEqualsBoolean: {description: 'Boolean comparison in projection', category: 'aggregation'},

  // Ordering
  sortByAsc: {description: 'ORDER BY ASC on name', category: 'ordering'},
  sortByDesc: {description: 'ORDER BY DESC on name', category: 'ordering'},

  // Sub-selects
  subSelectSingleProp: {description: 'Sub-select single property from bestFriend', category: 'sub-select'},
  subSelectPluralCustom: {description: 'Sub-select with custom object from friends', category: 'sub-select'},
  subSelectAllProperties: {description: 'Sub-select all properties from friends', category: 'sub-select'},
  subSelectAllPropertiesSingle: {description: 'Sub-select all from bestFriend (singular)', category: 'sub-select'},
  subSelectAllPrimitives: {description: 'Sub-select specific primitives from bestFriend', category: 'sub-select'},
  subSelectArray: {description: 'Sub-select with array of paths', category: 'sub-select'},
  doubleNestedSubSelect: {description: 'Double-nested sub-select: friends → bestFriend', category: 'sub-select'},
  nestedQueries2: {description: 'Mixed sub-selects and plain paths', category: 'sub-select'},

  // Shape casting
  selectShapeSetAs: {description: 'Cast ShapeSet with .as(Dog)', category: 'shape-casting'},
  selectShapeAs: {description: 'Cast single shape with .as(Dog)', category: 'shape-casting'},

  // Employee (inheritance)
  selectAllEmployeeProperties: {description: 'Select all from Employee (inherits Person)', category: 'inheritance'},

  // MINUS patterns
  minusMultiProperty: {description: 'MINUS: exclude where multiple properties exist', category: 'minus'},
  minusNestedPath: {description: 'MINUS: exclude where nested path exists', category: 'minus'},
  minusMixed: {description: 'MINUS: flat and nested in one block', category: 'minus'},
  minusSingleProperty: {description: 'MINUS: single property existence', category: 'minus'},
};

describe('Extract conformance fixtures', () => {
  // Group fixtures by category
  const categories = new Map<string, Array<{name: string; description: string}>>();
  for (const [name, meta] of Object.entries(selectFactories)) {
    if (!categories.has(meta.category)) categories.set(meta.category, []);
    categories.get(meta.category)!.push({name, description: meta.description});
  }

  test('extract select fixtures', async () => {
    for (const [category, entries] of categories) {
      const fixtures: any[] = [];

      for (const {name, description} of entries) {
        const factory = (queryFactories as any)[name];
        if (!factory) {
          console.warn(`Skipping ${name}: factory not found`);
          continue;
        }

        try {
          const ir = await captureQuery(factory);
          if (!ir) {
            console.warn(`Skipping ${name}: no IR captured`);
            continue;
          }

          let sparql: string | undefined;
          try {
            if (ir.kind === 'select') {
              sparql = selectToSparql(ir);
            }
          } catch (e) {
            console.warn(`Skipping SPARQL for ${name}: ${e}`);
          }

          fixtures.push({
            name,
            description,
            ir: sanitize(ir),
            ...(sparql ? {expectedSparql: sparql} : {}),
          });
        } catch (e) {
          console.warn(`Skipping ${name}: ${e}`);
        }
      }

      if (fixtures.length > 0) {
        const outPath = path.join(SPEC_DIR, 'select', `${category}.json`);
        fs.mkdirSync(path.dirname(outPath), {recursive: true});
        fs.writeFileSync(outPath, JSON.stringify(fixtures, null, 2) + '\n');
        console.log(`Wrote ${fixtures.length} fixtures to ${outPath}`);
      }
    }
  });

  // Mutation fixtures
  test('extract mutation fixtures', async () => {
    const mutationFactories: Record<string, {description: string; kind: string}> = {
      createSimple: {description: 'Create person with name and hobby', kind: 'create'},
      createWithFriends: {description: 'Create person with friend references and nested create', kind: 'create'},
      updateSimple: {description: 'Update single field (hobby)', kind: 'update'},
      updateOverwriteSet: {description: 'Overwrite set (friends array)', kind: 'update'},
      updateUnsetSingleUndefined: {description: 'Unset single field via undefined', kind: 'update'},
      updateUnsetSingleNull: {description: 'Unset single field via null', kind: 'update'},
      updateOverwriteNested: {description: 'Overwrite with nested create', kind: 'update'},
      updatePassIdReferences: {description: 'Update with ID reference', kind: 'update'},
      updateAddRemoveMulti: {description: 'Add and remove from set', kind: 'update'},
      updateRemoveMulti: {description: 'Remove from set', kind: 'update'},
      updateUnsetMultiUndefined: {description: 'Unset multi-value field', kind: 'update'},
      deleteSingle: {description: 'Delete single entity', kind: 'delete'},
      deleteMultiple: {description: 'Delete multiple entities', kind: 'delete'},
      deleteAll: {description: 'Delete all instances of shape', kind: 'delete_all'},
      deleteWhere: {description: 'Delete where condition matches', kind: 'delete_where'},
    };

    const fixtures: any[] = [];

    for (const [name, meta] of Object.entries(mutationFactories)) {
      const factory = (queryFactories as any)[name];
      if (!factory) {
        console.warn(`Skipping mutation ${name}: factory not found`);
        continue;
      }

      try {
        const ir = await captureQuery(factory);
        if (!ir) {
          console.warn(`Skipping mutation ${name}: no IR captured`);
          continue;
        }

        let sparql: string | undefined;
        try {
          if (ir.kind === 'create') {
            sparql = createToSparql(ir);
          } else if (ir.kind === 'update') {
            sparql = updateToSparql(ir);
          } else if (ir.kind === 'delete') {
            sparql = deleteToSparql(ir);
          } else if (ir.kind === 'delete_all') {
            sparql = deleteAllToSparql(ir);
          } else if (ir.kind === 'delete_where') {
            sparql = deleteWhereToSparql(ir);
          } else if (ir.kind === 'update_where') {
            sparql = updateWhereToSparql(ir);
          }
        } catch (e) {
          console.warn(`Skipping SPARQL for mutation ${name}: ${e}`);
        }

        fixtures.push({
          name,
          description: meta.description,
          ir: sanitize(ir),
          ...(sparql ? {expectedSparql: sparql} : {}),
        });
      } catch (e) {
        console.warn(`Skipping mutation ${name}: ${e}`);
      }
    }

    if (fixtures.length > 0) {
      const outPath = path.join(SPEC_DIR, 'mutations', 'mutations.json');
      fs.mkdirSync(path.dirname(outPath), {recursive: true});
      fs.writeFileSync(outPath, JSON.stringify(fixtures, null, 2) + '\n');
      console.log(`Wrote ${fixtures.length} mutation fixtures to ${outPath}`);
    }
  });
});
