import {describe, expect, test} from '@jest/globals';
import {Person, queryFactories} from '../test-helpers/query-fixtures';
import {QueryCaptureStore, captureQuery} from '../test-helpers/query-capture-store';
import {setQueryContext} from '../queries/QueryContext';
import {
  desugarSelectQuery,
  DesugaredSelectionPath,
  DesugaredSubSelect,
  DesugaredCustomObjectSelect,
  DesugaredEvaluationSelect,
  DesugaredMultiSelection,
} from '../queries/IRDesugar';

const store = new QueryCaptureStore();
Person.queryParser = store;
setQueryContext('user', {id: 'user-1'}, Person);

const capture = (runner: () => Promise<unknown>) => captureQuery(store, runner);

const asPath = (s: unknown): DesugaredSelectionPath => {
  expect((s as any).kind).toBe('selection_path');
  return s as DesugaredSelectionPath;
};

const asSubSelect = (s: unknown): DesugaredSubSelect => {
  expect((s as any).kind).toBe('sub_select');
  return s as DesugaredSubSelect;
};

const asCustomObject = (s: unknown): DesugaredCustomObjectSelect => {
  expect((s as any).kind).toBe('custom_object_select');
  return s as DesugaredCustomObjectSelect;
};

const asEvaluation = (s: unknown): DesugaredEvaluationSelect => {
  expect((s as any).kind).toBe('evaluation_select');
  return s as DesugaredEvaluationSelect;
};

describe('IR desugar conversion', () => {
  // === Basic selection ===

  test('desugars simple select path', async () => {
    const query = await capture(() => queryFactories.selectName());
    const desugared = desugarSelectQuery(query);

    expect(desugared.kind).toBe('desugared_select');
    expect(desugared.selections).toHaveLength(1);
    const sel = asPath(desugared.selections[0]);
    expect(sel.steps).toHaveLength(1);
    expect(sel.steps[0].kind).toBe('property_step');
    // Property ID comes from shape metadata, not fixture constants
    expect(sel.steps[0]).toHaveProperty('propertyShapeId');
  });

  test('desugars nested path selection', async () => {
    const query = await capture(() => queryFactories.selectFriendsName());
    const desugared = desugarSelectQuery(query);

    expect(desugared.selections).toHaveLength(1);
    const sel = asPath(desugared.selections[0]);
    expect(sel.steps).toHaveLength(2);
    expect(sel.steps[0].kind).toBe('property_step');
    expect(sel.steps[1].kind).toBe('property_step');
  });

  test('desugars multiple paths', async () => {
    const query = await capture(() => queryFactories.selectMultiplePaths());
    const desugared = desugarSelectQuery(query);

    expect(desugared.selections).toHaveLength(3);
    expect(asPath(desugared.selections[0]).steps).toHaveLength(1); // name
    expect(asPath(desugared.selections[1]).steps).toHaveLength(1); // friends
    expect(asPath(desugared.selections[2]).steps).toHaveLength(2); // bestFriend.name
  });

  test('desugars empty select', async () => {
    const query = await capture(() => queryFactories.selectAll());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(0);
  });

  test('desugars selectAll properties', async () => {
    const query = await capture(() => queryFactories.selectAllProperties());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections.length).toBeGreaterThan(0);
    desugared.selections.forEach((s) => {
      expect(asPath(s).steps).toHaveLength(1);
    });
  });

  // === Where clauses ===

  test('desugars where equality', async () => {
    const query = await capture(() => queryFactories.selectWhereNameSemmy());
    const desugared = desugarSelectQuery(query);

    expect(desugared.where?.kind).toBe('where_comparison');
    const where = desugared.where as any;
    expect(where.operator).toBe('=');
    expect(where.left.steps).toHaveLength(1);
    expect(where.right[0]).toBe('Semmy');
  });

  test('desugars where and', async () => {
    const query = await capture(() => queryFactories.whereAnd());
    const desugared = desugarSelectQuery(query);
    // inline where on friends path — the selection should still desugar
    expect(desugared.selections).toHaveLength(1);
  });

  test('desugars where or', async () => {
    const query = await capture(() => queryFactories.whereOr());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(1);
  });

  test('desugars outer where with selections', async () => {
    const query = await capture(() => queryFactories.outerWhere());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(1);
    expect(desugared.where).toBeDefined();
    expect(desugared.where!.kind).toBe('where_comparison');
  });

  test('desugars where some explicit', async () => {
    const query = await capture(() => queryFactories.whereSomeExplicit());
    const desugared = desugarSelectQuery(query);
    expect(desugared.where).toBeDefined();
  });

  test('desugars where every', async () => {
    const query = await capture(() => queryFactories.whereEvery());
    const desugared = desugarSelectQuery(query);
    expect(desugared.where).toBeDefined();
  });

  test('desugars where sequences', async () => {
    const query = await capture(() => queryFactories.whereSequences());
    const desugared = desugarSelectQuery(query);
    expect(desugared.where).toBeDefined();
    expect(desugared.where!.kind).toBe('where_boolean');
  });

  // === Count / aggregation ===

  test('desugars count (size)', async () => {
    const query = await capture(() => queryFactories.countFriends());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(1);
    const sel = asPath(desugared.selections[0]);
    expect(sel.steps.some((s) => s.kind === 'count_step')).toBe(true);
  });

  test('desugars nested count', async () => {
    const query = await capture(() => queryFactories.countNestedFriends());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(1);
    const sel = asPath(desugared.selections[0]);
    expect(sel.steps.some((s) => s.kind === 'count_step')).toBe(true);
  });

  // === Sub-selects ===

  test('desugars sub-select with custom object', async () => {
    const query = await capture(() => queryFactories.subSelectSingleProp());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(1);
    const sel = asSubSelect(desugared.selections[0]);
    expect(sel.parentPath.length).toBeGreaterThan(0);
    expect(sel.selections).toBeDefined();
  });

  test('desugars sub-select plural custom object', async () => {
    const query = await capture(() => queryFactories.subSelectPluralCustom());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(1);
    const sel = asSubSelect(desugared.selections[0]);
    const inner = asCustomObject(sel.selections);
    expect(inner.entries.length).toBe(2);
    expect(inner.entries.map((e) => e.key).sort()).toEqual(['hobby', 'name']);
  });

  test('desugars sub-select all properties', async () => {
    const query = await capture(() => queryFactories.subSelectAllProperties());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(1);
    const sel = asSubSelect(desugared.selections[0]);
    expect(sel.parentPath.length).toBeGreaterThan(0);
  });

  test('desugars sub-select array', async () => {
    const query = await capture(() => queryFactories.subSelectArray());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(1);
    const sel = asSubSelect(desugared.selections[0]);
    expect(sel.parentPath.length).toBeGreaterThan(0);
  });

  test('desugars double nested sub-select', async () => {
    const query = await capture(() => queryFactories.doubleNestedSubSelect());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(1);
    const outer = asSubSelect(desugared.selections[0]);
    expect(outer.parentPath.length).toBeGreaterThan(0);
  });

  test('desugars sub-select all primitives', async () => {
    const query = await capture(() => queryFactories.subSelectAllPrimitives());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(1);
    const sel = asSubSelect(desugared.selections[0]);
    expect(sel.parentPath.length).toBeGreaterThan(0);
  });

  // === Custom result objects at top level ===

  test('desugars custom result object with evaluation', async () => {
    const query = await capture(() => queryFactories.customResultEqualsBoolean());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(1);
    const sel = asCustomObject(desugared.selections[0]);
    expect(sel.entries).toHaveLength(1);
    expect(sel.entries[0].key).toBe('isBestFriend');
  });

  test('desugars custom result object with count', async () => {
    const query = await capture(() => queryFactories.customResultNumFriends());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(1);
    const sel = asCustomObject(desugared.selections[0]);
    expect(sel.entries).toHaveLength(1);
    expect(sel.entries[0].key).toBe('numFriends');
  });

  // === Type casting ===

  test('desugars type cast (as) on shape set — cast is implicit in property resolution', async () => {
    const query = await capture(() => queryFactories.selectShapeSetAs());
    const desugared = desugarSelectQuery(query);
    // as() doesn't produce a separate step — it changes which properties are accessible
    // The path is just [pets, guardDogLevel] where guardDogLevel comes from Dog shape
    expect(desugared.selections).toHaveLength(1);
    const sel = asPath(desugared.selections[0]);
    expect(sel.steps).toHaveLength(2);
    expect(sel.steps.every((s) => s.kind === 'property_step')).toBe(true);
  });

  test('desugars type cast (as) on single shape — cast is implicit in property resolution', async () => {
    const query = await capture(() => queryFactories.selectShapeAs());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(1);
    const sel = asPath(desugared.selections[0]);
    expect(sel.steps).toHaveLength(2);
    expect(sel.steps.every((s) => s.kind === 'property_step')).toBe(true);
  });

  // === Preload ===

  test('desugars preload composition', async () => {
    const query = await capture(() => queryFactories.preloadBestFriend());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(1);
    // Preload pushes sub-query select into the path — should not throw
  });

  // === Sorting / limiting ===

  test('desugars sort by ASC', async () => {
    const query = await capture(() => queryFactories.sortByAsc());
    const desugared = desugarSelectQuery(query);
    expect(desugared.sortBy).toBeDefined();
    expect(desugared.sortBy!.direction).toBe('ASC');
  });

  test('desugars sort by DESC', async () => {
    const query = await capture(() => queryFactories.sortByDesc());
    const desugared = desugarSelectQuery(query);
    expect(desugared.sortBy).toBeDefined();
    expect(desugared.sortBy!.direction).toBe('DESC');
  });

  test('desugars limit', async () => {
    const query = await capture(() => queryFactories.outerWhereLimit());
    const desugared = desugarSelectQuery(query);
    expect(desugared.limit).toBe(1);
    expect(desugared.where).toBeDefined();
  });

  // === One modifier ===

  test('desugars one() as singleResult', async () => {
    const query = await capture(() => queryFactories.selectOne());
    const desugared = desugarSelectQuery(query);
    expect(desugared.singleResult).toBe(true);
    expect(desugared.limit).toBe(1);
  });

  // === Subject targeting ===

  test('desugars subject by ID', async () => {
    const query = await capture(() => queryFactories.selectById());
    const desugared = desugarSelectQuery(query);
    expect(desugared.subjectId).toBeDefined();
    expect(desugared.singleResult).toBe(true);
  });

  // === Nested queries ===

  test('desugars nested queries with mixed sub-selects', async () => {
    const query = await capture(() => queryFactories.nestedQueries2());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(1);
    // Should not throw — contains double-nested sub-selects
  });

  // === Where with query context ===

  test('desugars where with query context', async () => {
    const query = await capture(() => queryFactories.whereWithContext());
    const desugared = desugarSelectQuery(query);
    expect(desugared.where).toBeDefined();
  });

  // === Count in where ===

  test('desugars count in where clause', async () => {
    const query = await capture(() => queryFactories.countEquals());
    const desugared = desugarSelectQuery(query);
    expect(desugared.where).toBeDefined();
  });

  // === Duplicate paths ===

  test('desugars duplicate paths', async () => {
    const query = await capture(() => queryFactories.selectDuplicatePaths());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(3);
  });

  // === Count with label in sub-select ===

  test('desugars count label in sub-select', async () => {
    const query = await capture(() => queryFactories.countLabel());
    const desugared = desugarSelectQuery(query);
    expect(desugared.selections).toHaveLength(1);
    // Should not throw
  });
});
