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
import {
  Dog,
  Employee,
  Person,
  Pet,
  queryFactories,
  tmpEntityBase,
} from '../test-helpers/query-fixtures';
import {SelectQueryIR, buildSelectQueryIR} from '../queries/IRPipeline';
import {setQueryContext} from '../queries/QueryContext';

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
Pet.queryParser = store;
Dog.queryParser = store;
Employee.queryParser = store;
setQueryContext('user', {id: 'user-1'}, Person);

const sanitize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce(
      (acc, [key, child]) => {
        if (child !== undefined) acc[key] = sanitize(child);
        return acc;
      },
      {} as Record<string, unknown>,
    );
  }
  return value;
};

const captureIR = async (
  runner: () => Promise<unknown>,
): Promise<SelectQueryIR> => {
  store.lastQuery = undefined;
  await runner();
  return sanitize(buildSelectQueryIR(store.lastQuery)) as SelectQueryIR;
};

type SelectCase = {
  name: string;
  run: () => Promise<unknown>;
  minProjection?: number;
  exactProjection?: number;
  minPatterns?: number;
  hasWhere?: boolean;
  whereKind?: 'binary_expr' | 'logical_expr' | 'exists_expr' | 'not_expr';
  singleResult?: boolean;
  subjectId?: string;
  orderByDirection?: 'ASC' | 'DESC';
  limit?: number;
  requireAggregate?: boolean;
  expectedRootShapeId?: string;
  requiredResultKeys?: string[];
};

const assertSelectCase = (ir: SelectQueryIR, testCase: SelectCase) => {
  expect(ir.kind).toBe('select_query');
  expect(ir.root.kind).toBe('shape_scan');
  expect(ir.root.alias).toBeDefined();
  expect(Array.isArray(ir.patterns)).toBe(true);
  expect(Array.isArray(ir.projection)).toBe(true);
  expect(ir.resultMap?.kind).toBe('result_map');
  expect(ir.resultMap?.entries.length).toBe(ir.projection.length);

  if (testCase.expectedRootShapeId) {
    expect(ir.root.shape.shapeId).toBe(testCase.expectedRootShapeId);
  } else {
    expect(ir.root.shape.shapeId).toBeDefined();
  }

  if (testCase.exactProjection !== undefined) {
    expect(ir.projection.length).toBe(testCase.exactProjection);
  }

  if (testCase.minProjection !== undefined) {
    expect(ir.projection.length).toBeGreaterThanOrEqual(testCase.minProjection);
  }

  if (testCase.minPatterns !== undefined) {
    expect(ir.patterns.length).toBeGreaterThanOrEqual(testCase.minPatterns);
  }

  if (testCase.hasWhere) {
    expect(ir.where).toBeDefined();
  }

  if (testCase.whereKind) {
    expect(ir.where?.kind).toBe(testCase.whereKind);
  }

  if (testCase.singleResult !== undefined) {
    expect(ir.singleResult).toBe(testCase.singleResult);
  }

  if (testCase.subjectId) {
    expect(ir.subjectId).toBe(testCase.subjectId);
  }

  if (testCase.orderByDirection) {
    expect(ir.orderBy).toBeDefined();
    expect(ir.orderBy?.[0]?.direction).toBe(testCase.orderByDirection);
  }

  if (testCase.limit !== undefined) {
    expect(ir.limit).toBe(testCase.limit);
  }

  if (testCase.requireAggregate) {
    expect(
      ir.projection.some((item) => item.expression.kind === 'aggregate_expr'),
    ).toBe(true);
  }

  if (testCase.requiredResultKeys?.length) {
    const keys = ir.resultMap?.entries.map((entry) => entry.key) ?? [];
    testCase.requiredResultKeys.forEach((key) => {
      expect(keys).toContain(key);
    });
  }
};

const basicCases: SelectCase[] = [
  {name: 'selectName', run: () => queryFactories.selectName(), minProjection: 1},
  {name: 'selectFriends', run: () => queryFactories.selectFriends(), minProjection: 1},
  {name: 'selectBirthDate', run: () => queryFactories.selectBirthDate(), minProjection: 1},
  {name: 'selectIsRealPerson', run: () => queryFactories.selectIsRealPerson(), minProjection: 1},
  {
    name: 'selectById',
    run: () => queryFactories.selectById(),
    minProjection: 1,
    singleResult: true,
    subjectId: `${tmpEntityBase}p1`,
  },
  {
    name: 'selectByIdReference',
    run: () => queryFactories.selectByIdReference(),
    minProjection: 1,
    singleResult: true,
    subjectId: `${tmpEntityBase}p1`,
  },
  {
    name: 'selectNonExisting',
    run: () => queryFactories.selectNonExisting(),
    minProjection: 1,
    singleResult: true,
    subjectId: 'https://does.not/exist',
  },
  {
    name: 'selectUndefinedOnly',
    run: () => queryFactories.selectUndefinedOnly(),
    minProjection: 2,
    singleResult: true,
    subjectId: `${tmpEntityBase}p3`,
  },
];

const nestedCases: SelectCase[] = [
  {
    name: 'selectFriendsName',
    run: () => queryFactories.selectFriendsName(),
    minProjection: 1,
    minPatterns: 1,
  },
  {
    name: 'selectNestedFriendsName',
    run: () => queryFactories.selectNestedFriendsName(),
    minProjection: 1,
    minPatterns: 2,
  },
  {
    name: 'selectMultiplePaths',
    run: () => queryFactories.selectMultiplePaths(),
    exactProjection: 3,
    minPatterns: 1,
  },
  {
    name: 'selectBestFriendName',
    run: () => queryFactories.selectBestFriendName(),
    minProjection: 1,
    minPatterns: 1,
  },
  {
    name: 'selectDeepNested',
    run: () => queryFactories.selectDeepNested(),
    minProjection: 1,
    minPatterns: 3,
  },
];

const filteringCases: SelectCase[] = [
  {
    name: 'whereFriendsNameEquals',
    run: () => queryFactories.whereFriendsNameEquals(),
    minProjection: 1,
  },
  {
    name: 'whereBestFriendEquals',
    run: () => queryFactories.whereBestFriendEquals(),
    hasWhere: true,
    whereKind: 'binary_expr',
    exactProjection: 0,
  },
  {
    name: 'whereHobbyEquals',
    run: () => queryFactories.whereHobbyEquals(),
    minProjection: 1,
  },
  {name: 'whereAnd', run: () => queryFactories.whereAnd(), minProjection: 1},
  {name: 'whereOr', run: () => queryFactories.whereOr(), minProjection: 1},
  {name: 'selectAll', run: () => queryFactories.selectAll(), exactProjection: 0},
  {
    name: 'selectAllProperties',
    run: () => queryFactories.selectAllProperties(),
    minProjection: 10,
  },
  {
    name: 'selectAllEmployeeProperties',
    run: () => queryFactories.selectAllEmployeeProperties(),
    minProjection: 10,
    expectedRootShapeId: Employee.shape.id,
  },
  {
    name: 'selectWhereNameSemmy',
    run: () => queryFactories.selectWhereNameSemmy(),
    hasWhere: true,
    whereKind: 'binary_expr',
    exactProjection: 0,
  },
  {name: 'whereAndOrAnd', run: () => queryFactories.whereAndOrAnd(), minProjection: 1},
  {
    name: 'whereAndOrAndNested',
    run: () => queryFactories.whereAndOrAndNested(),
    minProjection: 1,
  },
  {
    name: 'whereSomeImplicit',
    run: () => queryFactories.whereSomeImplicit(),
    hasWhere: true,
    whereKind: 'binary_expr',
    exactProjection: 0,
  },
  {
    name: 'whereSomeExplicit',
    run: () => queryFactories.whereSomeExplicit(),
    hasWhere: true,
    whereKind: 'exists_expr',
    exactProjection: 0,
  },
  {
    name: 'whereEvery',
    run: () => queryFactories.whereEvery(),
    hasWhere: true,
    whereKind: 'not_expr',
    exactProjection: 0,
  },
  {
    name: 'whereSequences',
    run: () => queryFactories.whereSequences(),
    hasWhere: true,
    whereKind: 'logical_expr',
    exactProjection: 0,
  },
  {
    name: 'outerWhere',
    run: () => queryFactories.outerWhere(),
    hasWhere: true,
    whereKind: 'binary_expr',
    minProjection: 1,
  },
  {
    name: 'whereWithContext',
    run: () => queryFactories.whereWithContext(),
    hasWhere: true,
    whereKind: 'binary_expr',
    minProjection: 1,
  },
  {
    name: 'whereWithContextPath',
    run: () => queryFactories.whereWithContextPath(),
    hasWhere: true,
    whereKind: 'exists_expr',
    minProjection: 1,
  },
];

const aggregationCases: SelectCase[] = [
  {
    name: 'countFriends',
    run: () => queryFactories.countFriends(),
    exactProjection: 1,
    requireAggregate: true,
  },
  {
    name: 'countNestedFriends',
    run: () => queryFactories.countNestedFriends(),
    exactProjection: 1,
    minPatterns: 1,
    requireAggregate: true,
  },
  {
    name: 'countLabel',
    run: () => queryFactories.countLabel(),
    exactProjection: 1,
    minPatterns: 1,
    requireAggregate: true,
    requiredResultKeys: ['numFriends'],
  },
  {
    name: 'nestedObjectProperty',
    run: () => queryFactories.nestedObjectProperty(),
    exactProjection: 1,
    minPatterns: 1,
  },
  {
    name: 'nestedObjectPropertySingle',
    run: () => queryFactories.nestedObjectPropertySingle(),
    exactProjection: 1,
    minPatterns: 1,
  },
  {
    name: 'subSelectSingleProp',
    run: () => queryFactories.subSelectSingleProp(),
    exactProjection: 1,
    minPatterns: 1,
    requiredResultKeys: ['name'],
  },
  {
    name: 'subSelectPluralCustom',
    run: () => queryFactories.subSelectPluralCustom(),
    exactProjection: 2,
    minPatterns: 1,
    requiredResultKeys: ['name', 'hobby'],
  },
  {
    name: 'subSelectAllProperties',
    run: () => queryFactories.subSelectAllProperties(),
    minProjection: 10,
    minPatterns: 1,
  },
  {
    name: 'subSelectAllPropertiesSingle',
    run: () => queryFactories.subSelectAllPropertiesSingle(),
    minProjection: 10,
    minPatterns: 1,
  },
  {
    name: 'doubleNestedSubSelect',
    run: () => queryFactories.doubleNestedSubSelect(),
    exactProjection: 1,
    minPatterns: 2,
    requiredResultKeys: ['name'],
  },
  {
    name: 'subSelectAllPrimitives',
    run: () => queryFactories.subSelectAllPrimitives(),
    exactProjection: 3,
    minPatterns: 1,
  },
  {
    name: 'customResultEqualsBoolean',
    run: () => queryFactories.customResultEqualsBoolean(),
    exactProjection: 1,
    requiredResultKeys: ['isBestFriend'],
  },
  {
    name: 'customResultNumFriends',
    run: () => queryFactories.customResultNumFriends(),
    exactProjection: 1,
    requireAggregate: true,
    requiredResultKeys: ['numFriends'],
  },
  {
    name: 'countEquals',
    run: () => queryFactories.countEquals(),
    hasWhere: true,
    whereKind: 'binary_expr',
    exactProjection: 0,
  },
  {
    name: 'subSelectArray',
    run: () => queryFactories.subSelectArray(),
    exactProjection: 2,
    minPatterns: 1,
  },
];

const transformationCases: SelectCase[] = [
  {
    name: 'selectShapeSetAs',
    run: () => queryFactories.selectShapeSetAs(),
    exactProjection: 1,
    minPatterns: 1,
  },
  {
    name: 'selectNonExistingMultiple',
    run: () => queryFactories.selectNonExistingMultiple(),
    exactProjection: 2,
  },
  {
    name: 'selectShapeAs',
    run: () => queryFactories.selectShapeAs(),
    exactProjection: 1,
    minPatterns: 1,
  },
  {
    name: 'selectOne',
    run: () => queryFactories.selectOne(),
    hasWhere: true,
    whereKind: 'binary_expr',
    exactProjection: 1,
    singleResult: true,
  },
  {
    name: 'nestedQueries2',
    run: () => queryFactories.nestedQueries2(),
    minProjection: 1,
    minPatterns: 1,
  },
  {
    name: 'selectDuplicatePaths',
    run: () => queryFactories.selectDuplicatePaths(),
    exactProjection: 3,
    minPatterns: 1,
  },
];

const preloadCases: SelectCase[] = [
  {
    name: 'preloadBestFriend',
    run: () => queryFactories.preloadBestFriend(),
    minProjection: 1,
    minPatterns: 1,
  },
];

const sortingCases: SelectCase[] = [
  {
    name: 'outerWhereLimit',
    run: () => queryFactories.outerWhereLimit(),
    hasWhere: true,
    whereKind: 'logical_expr',
    exactProjection: 1,
    limit: 1,
  },
  {
    name: 'sortByAsc',
    run: () => queryFactories.sortByAsc(),
    exactProjection: 1,
    orderByDirection: 'ASC',
  },
  {
    name: 'sortByDesc',
    run: () => queryFactories.sortByDesc(),
    exactProjection: 1,
    orderByDirection: 'DESC',
  },
];

describe('select canonical IR golden fixtures', () => {
  test('basic selection fixture', async () => {
    const actual = await captureIR(() => queryFactories.selectName());
    expect(actual).toMatchInlineSnapshot(`
      {
        "kind": "select_query",
        "patterns": [],
        "projection": [
          {
            "alias": "a1",
            "expression": {
              "kind": "property_expr",
              "property": {
                "propertyShapeId": "https://data.lincd.org/module/-_linked-core/shape/person/name",
              },
              "sourceAlias": "a0",
            },
            "kind": "projection_item",
          },
        ],
        "resultMap": {
          "entries": [
            {
              "alias": "a1",
              "key": "https://data.lincd.org/module/-_linked-core/shape/person/name",
            },
          ],
          "kind": "result_map",
        },
        "root": {
          "alias": "a0",
          "kind": "shape_scan",
          "shape": {
            "shapeId": "https://data.lincd.org/module/-_linked-core/shape/person",
          },
        },
        "singleResult": false,
      }
    `);
  });

  test('nested selection fixture', async () => {
    const actual = await captureIR(() => queryFactories.selectNestedFriendsName());
    expect(actual).toMatchInlineSnapshot(`
      {
        "kind": "select_query",
        "patterns": [
          {
            "from": "a0",
            "kind": "traverse",
            "property": {
              "propertyShapeId": "https://data.lincd.org/module/-_linked-core/shape/person/friends",
            },
            "to": "a1",
          },
          {
            "from": "a1",
            "kind": "traverse",
            "property": {
              "propertyShapeId": "https://data.lincd.org/module/-_linked-core/shape/person/friends",
            },
            "to": "a2",
          },
        ],
        "projection": [
          {
            "alias": "a1",
            "expression": {
              "kind": "property_expr",
              "property": {
                "propertyShapeId": "https://data.lincd.org/module/-_linked-core/shape/person/name",
              },
              "sourceAlias": "a2",
            },
            "kind": "projection_item",
          },
        ],
        "resultMap": {
          "entries": [
            {
              "alias": "a1",
              "key": "https://data.lincd.org/module/-_linked-core/shape/person/name",
            },
          ],
          "kind": "result_map",
        },
        "root": {
          "alias": "a0",
          "kind": "shape_scan",
          "shape": {
            "shapeId": "https://data.lincd.org/module/-_linked-core/shape/person",
          },
        },
        "singleResult": false,
      }
    `);
  });

  test('filtering fixture with normalized quantifier', async () => {
    const actual = await captureIR(() => queryFactories.whereSomeExplicit());
    expect(actual.where?.kind).toBe('exists_expr');
    expect(actual).toMatchInlineSnapshot(`
      {
        "kind": "select_query",
        "patterns": [],
        "projection": [],
        "resultMap": {
          "entries": [],
          "kind": "result_map",
        },
        "root": {
          "alias": "a0",
          "kind": "shape_scan",
          "shape": {
            "shapeId": "https://data.lincd.org/module/-_linked-core/shape/person",
          },
        },
        "singleResult": false,
        "where": {
          "filter": {
            "kind": "binary_expr",
            "left": {
              "kind": "property_expr",
              "property": {
                "propertyShapeId": "https://data.lincd.org/module/-_linked-core/shape/person/name",
              },
              "sourceAlias": "a1",
            },
            "operator": "=",
            "right": {
              "kind": "literal_expr",
              "value": "Moa",
            },
          },
          "kind": "exists_expr",
          "pattern": {
            "from": "a0",
            "kind": "traverse",
            "property": {
              "propertyShapeId": "https://data.lincd.org/module/-_linked-core/shape/person/friends",
            },
            "to": "a1",
          },
        },
      }
    `);
  });
});

describe('select IR parity coverage (Phase 3)', () => {
  test.each([
    ...basicCases,
    ...nestedCases,
    ...filteringCases,
    ...aggregationCases,
    ...transformationCases,
    ...preloadCases,
    ...sortingCases,
  ])('$name emits expected IR structure', async (testCase) => {
    const actual = await captureIR(testCase.run);
    assertSelectCase(actual, testCase);
  });
});
