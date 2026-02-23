import { describe, expect, test } from "@jest/globals";
import { Shape } from "../shapes/Shape";
import { SelectQueryFactory } from "../queries/SelectQuery";
import { IQueryParser } from "../interfaces/IQueryParser";
import { DeleteResponse } from "../queries/DeleteQuery";
import { CreateResponse } from "../queries/CreateQuery";
import {
  AddId,
  NodeReferenceValue,
  UpdatePartial,
} from "../queries/QueryFactory";
import { UpdateQueryFactory } from "../queries/UpdateQuery";
import { CreateQueryFactory } from "../queries/CreateQuery";
import { DeleteQueryFactory } from "../queries/DeleteQuery";
import { NodeId } from "../queries/MutationQuery";
import { Person, queryFactories } from "../test-helpers/query-fixtures";
import { SelectQueryIR, buildSelectQueryIR } from "../queries/IRPipeline";

class QueryCaptureStore implements IQueryParser {
  lastQuery?: any;

  async selectQuery<ResultType>(query: SelectQueryFactory<Shape>) {
    this.lastQuery = query.getQueryObject();
    return [] as ResultType;
  }

  async createQuery<
    ShapeType extends Shape,
    U extends UpdatePartial<ShapeType>
  >(updateObjectOrFn: U, shapeClass: typeof Shape): Promise<CreateResponse<U>> {
    const factory = new CreateQueryFactory(shapeClass, updateObjectOrFn);
    this.lastQuery = factory.getQueryObject();
    return {} as CreateResponse<U>;
  }

  async updateQuery<
    ShapeType extends Shape,
    U extends UpdatePartial<ShapeType>
  >(
    id: string | NodeReferenceValue,
    updateObjectOrFn: U,
    shapeClass: typeof Shape
  ): Promise<AddId<U>> {
    const factory = new UpdateQueryFactory(shapeClass, id, updateObjectOrFn);
    this.lastQuery = factory.getQueryObject();
    return {} as AddId<U>;
  }

  async deleteQuery(
    id: NodeId | NodeId[] | NodeReferenceValue[],
    shapeClass: typeof Shape
  ): Promise<DeleteResponse> {
    const ids = (Array.isArray(id) ? id : [id]) as NodeId[];
    const factory = new DeleteQueryFactory(shapeClass, ids);
    this.lastQuery = factory.getQueryObject();
    return { deleted: [], count: 0 };
  }
}

const store = new QueryCaptureStore();
Person.queryParser = store;

const sanitize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).reduce(
      (acc, [key, child]) => {
        if (child !== undefined) acc[key] = sanitize(child);
        return acc;
      },
      {} as Record<string, unknown>
    );
  }
  return value;
};

const captureCanonical = async (
  runner: () => Promise<unknown>
): Promise<SelectQueryIR> => {
  store.lastQuery = undefined;
  await runner();
  return sanitize(buildSelectQueryIR(store.lastQuery)) as SelectQueryIR;
};

describe("select canonical IR golden fixtures (Phase 9)", () => {
  test("basic selection fixture", async () => {
    const actual = await captureCanonical(() => queryFactories.selectName());

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

  test("nested selection fixture", async () => {
    const actual = await captureCanonical(() =>
      queryFactories.selectNestedFriendsName()
    );

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

  test("filtering fixture with normalized quantifier", async () => {
    const actual = await captureCanonical(() =>
      queryFactories.whereSomeExplicit()
    );

    expect(actual.where?.kind).toBe("exists_expr");
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

  test("aggregation fixture (count path)", async () => {
    const actual = await captureCanonical(() =>
      queryFactories.countNestedFriends()
    );

    expect(actual.projection[0].expression.kind).toBe("aggregate_expr");
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
        ],
        "projection": [
          {
            "alias": "a1",
            "expression": {
              "args": [
                {
                  "kind": "property_expr",
                  "property": {
                    "propertyShapeId": "https://data.lincd.org/module/-_linked-core/shape/person/friends",
                  },
                  "sourceAlias": "a1",
                },
              ],
              "kind": "aggregate_expr",
              "name": "count",
            },
            "kind": "projection_item",
          },
        ],
        "resultMap": {
          "entries": [
            {
              "alias": "a1",
              "key": "friends",
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

  test("sorting/limit fixture keeps limit and semantic where shape", async () => {
    const actual = await captureCanonical(() =>
      queryFactories.outerWhereLimit()
    );

    expect(actual.limit).toBe(1);
    expect(actual.where?.kind).toBe("logical_expr");
    expect(actual).toMatchInlineSnapshot(`
      {
        "kind": "select_query",
        "limit": 1,
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
        "where": {
          "expressions": [
            {
              "kind": "binary_expr",
              "left": {
                "kind": "property_expr",
                "property": {
                  "propertyShapeId": "https://data.lincd.org/module/-_linked-core/shape/person/name",
                },
                "sourceAlias": "a0",
              },
              "operator": "=",
              "right": {
                "kind": "literal_expr",
                "value": "Semmy",
              },
            },
            {
              "kind": "binary_expr",
              "left": {
                "kind": "property_expr",
                "property": {
                  "propertyShapeId": "https://data.lincd.org/module/-_linked-core/shape/person/name",
                },
                "sourceAlias": "a0",
              },
              "operator": "=",
              "right": {
                "kind": "literal_expr",
                "value": "Moa",
              },
            },
          ],
          "kind": "logical_expr",
          "operator": "or",
        },
      }
    `);
  });

  test("sort-by fixture emits orderBy with ASC direction", async () => {
    const actual = await captureCanonical(() => queryFactories.sortByAsc());

    expect(actual.orderBy).toEqual([
      {
        kind: "order_by_item",
        direction: "ASC",
        expression: {
          kind: "property_expr",
          sourceAlias: "a0",
          property: {
            propertyShapeId:
              "https://data.lincd.org/module/-_linked-core/shape/person/name",
          },
        },
      },
    ]);
  });

  test("sort-by fixture emits orderBy with DESC direction", async () => {
    const actual = await captureCanonical(() => queryFactories.sortByDesc());

    expect(actual.orderBy).toEqual([
      {
        kind: "order_by_item",
        direction: "DESC",
        expression: {
          kind: "property_expr",
          sourceAlias: "a0",
          property: {
            propertyShapeId:
              "https://data.lincd.org/module/-_linked-core/shape/person/name",
          },
        },
      },
    ]);
  });
});
