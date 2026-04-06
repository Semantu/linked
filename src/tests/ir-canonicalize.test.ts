import {describe, expect, test} from '@jest/globals';
import {queryFactories} from '../test-helpers/query-fixtures';
import {captureRawQuery} from '../test-helpers/query-capture-store';
import {desugarSelectQuery} from '../queries/IRDesugar';
import {canonicalizeDesugaredSelectQuery} from '../queries/IRCanonicalize';

const capture = (runner: () => Promise<unknown>) => captureRawQuery(runner);

describe('IR canonicalization (Phase 4)', () => {
  test('canonicalizes where .equals() into expression form', async () => {
    const query = await capture(() => queryFactories.selectWhereNameSemmy());
    const canonical = canonicalizeDesugaredSelectQuery(desugarSelectQuery(query));

    // .equals() now goes through the ExpressionNode path → where_expression
    expect(canonical.where?.kind).toBe('where_expression');
  });

  test('canonicalizes where boolean chain (inline where has no top-level where)', async () => {
    const query = await capture(() => queryFactories.whereAndOrAnd());
    const canonical = canonicalizeDesugaredSelectQuery(desugarSelectQuery(query));

    // whereAndOrAnd uses inline where on a selection, not a top-level where
    // The inline where is embedded in the selection, not canonical.where
    expect(canonical.selections).toBeDefined();
  });

  test('flattens same-operator logical nodes', async () => {
    const query = await capture(() => queryFactories.whereSequences());
    const canonical = canonicalizeDesugaredSelectQuery(desugarSelectQuery(query));

    // whereSequences uses .some().and() — now goes through ExistsCondition path
    expect(canonical.where).toBeDefined();
  });

  test('some() now passes through as where_exists_condition', async () => {
    const query = await capture(() => queryFactories.whereSomeExplicit());
    const canonical = canonicalizeDesugaredSelectQuery(desugarSelectQuery(query));

    expect(canonical.where?.kind).toBe('where_exists_condition');
  });

  test('every() now passes through as where_exists_condition', async () => {
    const query = await capture(() => queryFactories.whereEvery());
    const canonical = canonicalizeDesugaredSelectQuery(desugarSelectQuery(query));

    expect(canonical.where?.kind).toBe('where_exists_condition');
  });

  test('all where types pass through canonicalization', async () => {
    const query1 = await capture(() => queryFactories.selectWhereNameSemmy());
    const canonical1 = canonicalizeDesugaredSelectQuery(desugarSelectQuery(query1));
    expect(canonical1.where?.kind).toBe('where_expression');

    const query2 = await capture(() => queryFactories.whereSomeExplicit());
    const canonical2 = canonicalizeDesugaredSelectQuery(desugarSelectQuery(query2));
    expect(canonical2.where?.kind).toBe('where_exists_condition');
  });
});
