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
import {buildSelectQueryIR} from '../queries/IRPipeline';

class QueryCaptureStore implements IQueryParser {
  lastQuery?: any;

  async selectQuery<ResultType>(query: SelectQueryFactory<Shape>) {
    this.lastQuery = query.getLegacyQueryObject();
    return [] as ResultType;
  }

  async createQuery<ShapeType extends Shape, U extends UpdatePartial<ShapeType>>(
    updateObjectOrFn: U,
    shapeClass: typeof Shape,
  ): Promise<CreateResponse<U>> {
    const factory = new CreateQueryFactory(shapeClass, updateObjectOrFn);
    this.lastQuery = factory.getLegacyQueryObject();
    return {} as CreateResponse<U>;
  }

  async updateQuery<ShapeType extends Shape, U extends UpdatePartial<ShapeType>>(
    id: string | NodeReferenceValue,
    updateObjectOrFn: U,
    shapeClass: typeof Shape,
  ): Promise<AddId<U>> {
    const factory = new UpdateQueryFactory(shapeClass, id, updateObjectOrFn);
    this.lastQuery = factory.getLegacyQueryObject();
    return {} as AddId<U>;
  }

  async deleteQuery(
    id: NodeId | NodeId[] | NodeReferenceValue[],
    shapeClass: typeof Shape,
  ): Promise<DeleteResponse> {
    const ids = (Array.isArray(id) ? id : [id]) as NodeId[];
    const factory = new DeleteQueryFactory(shapeClass, ids);
    this.lastQuery = factory.getLegacyQueryObject();
    return {deleted: [], count: 0};
  }
}

const store = new QueryCaptureStore();
Person.queryParser = store;

const captureLegacyQuery = async (runner: () => Promise<unknown>) => {
  store.lastQuery = undefined;
  await runner();
  return store.lastQuery;
};

describe('IR pipeline behavior', () => {
  test('buildSelectQueryIR lowers legacy select query shape', async () => {
    const query = await captureLegacyQuery(() => queryFactories.sortByDesc());
    const ir = buildSelectQueryIR(query);

    expect(ir.kind).toBe('select_query');
    expect(ir.root.kind).toBe('shape_scan');
    expect(ir.projection.length).toBe(1);
    expect(ir.orderBy?.[0]?.direction).toBe('DESC');
    expect(ir.limit).toBeUndefined();
  });

  test('getIR and getQueryObject both expose IR output', async () => {
    const selectFactory = Person.query((p) => p.name).where((p) =>
      p.name.equals('Semmy'),
    );

    const irFromMethod = selectFactory.getIR();
    const irFromQueryObject = selectFactory.getQueryObject();

    expect(irFromMethod.kind).toBe('select_query');
    expect(irFromQueryObject.kind).toBe('select_query');
    expect(irFromMethod).toEqual(irFromQueryObject);
  });

  test('builder accepts already-lowered IR as pass-through', async () => {
    const selectFactory = Person.query((p) => p.name);
    const ir = selectFactory.getIR();

    expect(buildSelectQueryIR(ir)).toBe(ir);
  });
});
