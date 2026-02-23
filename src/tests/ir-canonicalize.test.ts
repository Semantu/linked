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
import {DesugaredWhereBoolean, desugarSelectQuery} from '../queries/IRDesugar';
import {canonicalizeDesugaredSelectQuery} from '../queries/IRCanonicalize';
import {WhereMethods} from '../queries/SelectQuery';

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

describe('IR canonicalization (Phase 4)', () => {
  test('canonicalizes where comparison into expression form', async () => {
    const query = await captureQuery(() => queryFactories.selectWhereNameSemmy());
    const canonical = canonicalizeDesugaredSelectQuery(desugarSelectQuery(query));

    expect(canonical.where?.kind).toBe('where_binary');
    expect((canonical.where as any).operator).toBe('=');
  });

  test('canonicalizes where boolean chain without where_boolean wrappers', async () => {
    const query = await captureQuery(() => queryFactories.selectWhereNameSemmy());
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
    const query = await captureQuery(() => queryFactories.whereSequences());
    const canonical = canonicalizeDesugaredSelectQuery(desugarSelectQuery(query));

    if (canonical.where?.kind === 'where_logical' && canonical.where.operator === 'and') {
      const nestedAnd = canonical.where.expressions.filter(
        (exp) => exp.kind === 'where_logical' && exp.operator === 'and',
      );
      expect(nestedAnd).toHaveLength(0);
    }
  });

  test('rewrites some() to where_exists', async () => {
    const query = await captureQuery(() => queryFactories.selectWhereNameSemmy());
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
    const query = await captureQuery(() => queryFactories.selectWhereNameSemmy());
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
