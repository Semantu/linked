import {describe, expect, test} from '@jest/globals';
import {Shape} from '../shapes/Shape';
import {SelectQueryFactory} from '../queries/SelectQuery';
import {IQueryParser} from '../interfaces/IQueryParser';
import {DeleteResponse} from '../queries/DeleteQuery';
import {CreateResponse} from '../queries/CreateQuery';
import {AddId, NodeReferenceValue, UpdatePartial} from '../queries/QueryFactory';
import {UpdateQueryFactory} from '../queries/UpdateQuery';
import {CreateQueryFactory} from '../queries/CreateQuery';
import {DeleteQueryFactory} from '../queries/DeleteQuery';
import {NodeId} from '../queries/MutationQuery';
import {Person, queryFactories} from '../test-helpers/query-fixtures';
import {desugarSelectQuery} from '../queries/IRDesugar';
import {buildCanonicalProjection} from '../queries/IRProjection';

class QueryCaptureStore implements IQueryParser {
  lastQuery?: any;

  async selectQuery<ResultType>(query: SelectQueryFactory<Shape>) {
    this.lastQuery = query.getQueryObject();
    return [] as ResultType;
  }

  async createQuery<ShapeType extends Shape, U extends UpdatePartial<ShapeType>>(
    updateObjectOrFn: U,
    shapeClass: typeof Shape,
  ): Promise<CreateResponse<U>> {
    const factory = new CreateQueryFactory(shapeClass, updateObjectOrFn);
    this.lastQuery = factory.getQueryObject();
    return {} as CreateResponse<U>;
  }

  async updateQuery<ShapeType extends Shape, U extends UpdatePartial<ShapeType>>(
    id: string | NodeReferenceValue,
    updateObjectOrFn: U,
    shapeClass: typeof Shape,
  ): Promise<AddId<U>> {
    const factory = new UpdateQueryFactory(shapeClass, id, updateObjectOrFn);
    this.lastQuery = factory.getQueryObject();
    return {} as AddId<U>;
  }

  async deleteQuery(
    id: NodeId | NodeId[] | NodeReferenceValue[],
    shapeClass: typeof Shape,
  ): Promise<DeleteResponse> {
    const ids = (Array.isArray(id) ? id : [id]) as NodeId[];
    const factory = new DeleteQueryFactory(shapeClass, ids);
    this.lastQuery = factory.getQueryObject();
    return {deleted: [], count: 0};
  }
}

const store = new QueryCaptureStore();
Person.queryParser = store;

const captureQuery = async (runner: () => Promise<unknown>) => {
  store.lastQuery = undefined;
  await runner();
  return store.lastQuery;
};

describe('IR projection canonicalization (Phase 7)', () => {
  test('builds flat projection items from selections', async () => {
    const query = await captureQuery(() => queryFactories.selectMultiplePaths());
    const desugared = desugarSelectQuery(query);
    const projection = buildCanonicalProjection(desugared.selections);

    expect(projection.projection).toHaveLength(3);
    expect(projection.projection.every((item) => item.kind === 'projection_item')).toBe(true);
  });

  test('keeps deterministic alias order for same query', async () => {
    const query = await captureQuery(() => queryFactories.selectMultiplePaths());
    const desugared = desugarSelectQuery(query);

    const p1 = buildCanonicalProjection(desugared.selections);
    const p2 = buildCanonicalProjection(desugared.selections);

    expect(p1.projection.map((p) => p.alias)).toEqual(p2.projection.map((p) => p.alias));
    expect(p1.projection.map((p) => p.alias)).toEqual(['a0', 'a1', 'a2']);
  });

  test('adds optional resultMap entries', async () => {
    const query = await captureQuery(() => queryFactories.selectMultiplePaths());
    const desugared = desugarSelectQuery(query);
    const projection = buildCanonicalProjection(desugared.selections);

    expect(projection.resultMap?.kind).toBe('result_map');
    expect(projection.resultMap?.entries).toHaveLength(3);
    expect(projection.resultMap?.entries[0].alias).toBe('a0');
  });
});
