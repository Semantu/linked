import {describe, expect, test} from '@jest/globals';
import {queryFactories} from '../test-helpers/query-fixtures';
import {captureQuery} from '../test-helpers/query-capture-store';
import {DesugaredWhereBoolean, desugarSelectQuery} from '../queries/IRDesugar';
import {canonicalizeDesugaredSelectQuery} from '../queries/IRCanonicalize';
import {WhereMethods} from '../queries/SelectQuery';

const capture = (runner: () => Promise<unknown>) => captureQuery(runner);

describe('IR canonicalization (Phase 4)', () => {
  test('canonicalizes where comparison into expression form', async () => {
    const query = await capture(() => queryFactories.selectWhereNameSemmy());
    const canonical = canonicalizeDesugaredSelectQuery(desugarSelectQuery(query));

    expect(canonical.where?.kind).toBe('where_binary');
    expect((canonical.where as any).operator).toBe('=');
  });

  test('canonicalizes where boolean chain without where_boolean wrappers', async () => {
    const query = await capture(() => queryFactories.selectWhereNameSemmy());
    const desugared = desugarSelectQuery(query);
    const synthetic: DesugaredWhereBoolean = {
      kind: 'where_boolean',
      first: desugared.where as any,
      andOr: [{and: desugared.where as any}],
    };
    const canonical = canonicalizeDesugaredSelectQuery({
      ...desugared,
      where: synthetic,
    });

    expect(canonical.where).toBeDefined();
    expect(canonical.where?.kind).not.toBe('where_boolean');
    expect(['where_binary', 'where_logical']).toContain(canonical.where?.kind);
  });

  test('flattens same-operator logical nodes', async () => {
    const query = await capture(() => queryFactories.whereSequences());
    const canonical = canonicalizeDesugaredSelectQuery(desugarSelectQuery(query));

    if (canonical.where?.kind === 'where_logical' && canonical.where.operator === 'and') {
      const nestedAnd = canonical.where.expressions.filter(
        (exp) => exp.kind === 'where_logical' && exp.operator === 'and',
      );
      expect(nestedAnd).toHaveLength(0);
    }
  });

  test('rewrites some() to where_exists', async () => {
    const query = await capture(() => queryFactories.selectWhereNameSemmy());
    const desugared = desugarSelectQuery(query);
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

  test('rewrites every() to not exists(not ...)', async () => {
    const query = await capture(() => queryFactories.selectWhereNameSemmy());
    const desugared = desugarSelectQuery(query);
    const nested = desugared.where as any;
    const canonical = canonicalizeDesugaredSelectQuery({
      ...desugared,
      where: {
        kind: 'where_comparison',
        operator: WhereMethods.EVERY,
        left: nested.left,
        right: [nested],
      },
    });

    expect(canonical.where?.kind).toBe('where_not');
    const outerNot = canonical.where as any;
    expect(outerNot.expression.kind).toBe('where_exists');
    expect(outerNot.expression.predicate.kind).toBe('where_not');
  });
});
