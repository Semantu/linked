import {describe, expect, test} from '@jest/globals';
import {Person, queryFactories} from '../test-helpers/query-fixtures';
import {QueryCaptureStore, captureQuery} from '../test-helpers/query-capture-store';
import {desugarSelectQuery, DesugaredSelectionPath} from '../queries/IRDesugar';
import {buildCanonicalProjection} from '../queries/IRProjection';

const store = new QueryCaptureStore();
Person.queryParser = store;

const capture = (runner: () => Promise<unknown>) => captureQuery(store, runner);

describe('IR projection canonicalization (Phase 7)', () => {
  test('builds flat projection items from selections', async () => {
    const query = await capture(() => queryFactories.selectMultiplePaths());
    const desugared = desugarSelectQuery(query);
    const paths = desugared.selections.filter(
      (s): s is DesugaredSelectionPath => s.kind === 'selection_path',
    );
    const projection = buildCanonicalProjection(paths, {
      rootAlias: 'a0',
      resolveTraversal: (fromAlias, propertyShapeId) => `${fromAlias}:${propertyShapeId}`,
    });

    expect(projection.projection).toHaveLength(3);
    expect(projection.projection.every((item) => item.alias && item.expression)).toBe(true);
    expect(projection.projection.every((item) => item.expression.kind === 'property_expr')).toBe(true);
  });

  test('keeps deterministic alias order for same query', async () => {
    const query = await capture(() => queryFactories.selectMultiplePaths());
    const desugared = desugarSelectQuery(query);
    const paths = desugared.selections.filter(
      (s): s is DesugaredSelectionPath => s.kind === 'selection_path',
    );

    const options = {
      rootAlias: 'a0',
      resolveTraversal: (fromAlias: string, propertyShapeId: string) => `${fromAlias}:${propertyShapeId}`,
    };

    const p1 = buildCanonicalProjection(paths, options);
    const p2 = buildCanonicalProjection(paths, options);

    expect(p1.projection.map((p) => p.alias)).toEqual(p2.projection.map((p) => p.alias));
    expect(p1.projection.map((p) => p.alias)).toEqual(['a0', 'a1', 'a2']);
  });

  test('adds optional resultMap entries', async () => {
    const query = await capture(() => queryFactories.selectMultiplePaths());
    const desugared = desugarSelectQuery(query);
    const paths = desugared.selections.filter(
      (s): s is DesugaredSelectionPath => s.kind === 'selection_path',
    );
    const projection = buildCanonicalProjection(paths, {
      rootAlias: 'a0',
      resolveTraversal: (fromAlias, propertyShapeId) => `${fromAlias}:${propertyShapeId}`,
    });

    expect(projection.resultMap).toHaveLength(3);
    expect(projection.resultMap?.[0].alias).toBe('a0');
  });
});
