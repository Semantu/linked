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
import {
  buildSelectQueryIR,
  buildCanonicalSelectIR,
  toCanonicalParityView,
  toLegacyParityView,
} from '../queries/IRPipeline';

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

describe('IR pipeline parity (Phase 8)', () => {
  test('legacy parity for selection + where + sort/limit fields', async () => {
    const query = await captureQuery(() => queryFactories.sortByDesc());
    const canonical = buildSelectQueryIR(query);

    const legacyView = toLegacyParityView(query);
    const canonicalView = toCanonicalParityView(canonical);

    expect(canonicalView).toEqual(legacyView);
  });

  test('legacy parity for subject and singleResult', async () => {
    const query = await captureQuery(() => queryFactories.selectById());
    const canonical = buildSelectQueryIR(query);

    expect(toCanonicalParityView(canonical)).toEqual(toLegacyParityView(query));
    expect(canonical.subjectId).toBe(query.subject.id);
    expect(canonical.singleResult).toBe(true);
  });

  test('select factory exposes canonical IR helper', async () => {
    const selectFactory = Person.query((p) => p.name).where((p) =>
      p.name.equals('Semmy'),
    );
    const canonical = selectFactory.getIR();

    expect(canonical.kind).toBe('select_query');
    expect(canonical.projection.length).toBe(1);
    expect(canonical.where).toBeDefined();
  });
});

  test('compatibility alias helper still exposes canonical_select_ir', async () => {
    const selectFactory = Person.query((p) => p.name).where((p) =>
      p.name.equals('Semmy'),
    );

    const canonicalAlias = selectFactory.getCanonicalIR();
    const canonicalAliasFromBuilder = buildCanonicalSelectIR(selectFactory.getQueryObject());

    expect(canonicalAlias.kind).toBe('canonical_select_ir');
    expect(canonicalAliasFromBuilder.kind).toBe('canonical_select_ir');
    expect(canonicalAlias.projection.length).toBe(1);
  });
