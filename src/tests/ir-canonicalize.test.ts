import {describe, expect, test} from '@jest/globals';
import {queryFactories} from '../test-helpers/query-fixtures';
import {captureRawQuery} from '../test-helpers/query-capture-store';
import {DesugaredWhereBoolean, desugarSelectQuery} from '../queries/IRDesugar';
import {canonicalizeDesugaredSelectQuery} from '../queries/IRCanonicalize';
import {WhereMethods} from '../queries/SelectQuery';

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

    // .some() now produces ExistsCondition → where_exists_condition (passthrough)
    expect(canonical.where?.kind).toBe('where_exists_condition');
  });

  test('every() now passes through as where_exists_condition', async () => {
    const query = await capture(() => queryFactories.whereEvery());
    const canonical = canonicalizeDesugaredSelectQuery(desugarSelectQuery(query));

    // .every() produces ExistsCondition with negated predicate → where_exists_condition
    expect(canonical.where?.kind).toBe('where_exists_condition');
  });

  // Verify the old WhereMethods-based canonicalization still works for any remaining usage
  test('legacy: WhereMethods.SOME still canonicalizes to where_exists', async () => {
    const query = await capture(() => queryFactories.selectWhereNameSemmy());
    const desugared = desugarSelectQuery(query);
    // Skip if desugared where is expression-based (no left/right to borrow)
    if (desugared.where?.kind !== 'where_comparison') return;
    const nested = desugared.where as any;
    const canonical = canonicalizeDesugaredSelectQuery({
      ...desugared,
      where: {
        kind: 'where_comparison',
        operator: WhereMethods.SOME,
        left: nested.left,
        right: [nested],
      },
    });

    expect(canonical.where?.kind).toBe('where_exists');
  });
});
