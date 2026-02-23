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

describe('IR desugar conversion (Phase 3)', () => {
  test('desugars simple select path', async () => {
    const query = await captureQuery(() => queryFactories.selectName());
    const desugared = desugarSelectQuery(query);

    expect(desugared.kind).toBe('desugared_select');
    expect(desugared.selections).toHaveLength(1);
    expect(desugared.selections[0].steps).toHaveLength(1);
    expect(desugared.selections[0].steps[0].propertyShapeId).toBe(
      query.select[0][0].property.id,
    );
  });

  test('desugars nested path selection', async () => {
    const query = await captureQuery(() => queryFactories.selectFriendsName());
    const desugared = desugarSelectQuery(query);

    expect(desugared.selections).toHaveLength(1);
    expect(desugared.selections[0].steps).toHaveLength(2);
    expect(desugared.selections[0].steps.map((s) => s.propertyShapeId)).toEqual([
      query.select[0][0].property.id,
      query.select[0][1].property.id,
    ]);
  });

  test('desugars where equality', async () => {
    const query = await captureQuery(() => queryFactories.selectWhereNameSemmy());
    const desugared = desugarSelectQuery(query);

    expect(desugared.where?.kind).toBe('where_comparison');
    const where = desugared.where as any;
    expect(where.operator).toBe('=');
    expect(where.left.steps).toHaveLength(1);
    expect(where.right[0]).toBe('Semmy');
  });
});
