import {describe, expect, test} from '@jest/globals';
import {CreateQueryFactory} from '../queries/CreateQuery';
import {DeleteQueryFactory} from '../queries/DeleteQuery';
import {buildCanonicalMutationIR} from '../queries/IRMutation';
import {UpdateQueryFactory} from '../queries/UpdateQuery';
import {Person, tmpEntityBase} from '../test-helpers/query-fixtures';

describe('mutation IR parity (Phase 10)', () => {
  test('create query converts to canonical create mutation IR', () => {
    const createFactory = new CreateQueryFactory(Person as any, {
      name: 'Test Create',
      friends: [{id: `${tmpEntityBase}p2`}, {name: 'New Friend'}],
    } as any);

    const canonical = buildCanonicalMutationIR(createFactory.getQueryObject());

    expect(canonical).toMatchInlineSnapshot(`
      {
        "description": {
          "fields": [
            {
              "property": {
                "propertyShapeId": "https://data.lincd.org/module/-_linked-core/shape/person/name",
              },
              "value": "Test Create",
            },
            {
              "property": {
                "propertyShapeId": "https://data.lincd.org/module/-_linked-core/shape/person/friends",
              },
              "value": [
                {
                  "id": "linked://tmp/entities/p2",
                },
                {
                  "fields": [
                    {
                      "property": {
                        "propertyShapeId": "https://data.lincd.org/module/-_linked-core/shape/person/name",
                      },
                      "value": "New Friend",
                    },
                  ],
                  "shape": {
                    "shapeId": "https://data.lincd.org/module/-_linked-core/shape/person",
                  },
                },
              ],
            },
          ],
          "shape": {
            "shapeId": "https://data.lincd.org/module/-_linked-core/shape/person",
          },
        },
        "kind": "create_mutation",
        "shape": {
          "shapeId": "https://data.lincd.org/module/-_linked-core/shape/person",
        },
      }
    `);
  });

  test('update query keeps id and set add/remove semantics', () => {
    const updateFactory = new UpdateQueryFactory(Person as any, `${tmpEntityBase}p1`, {
      friends: {add: [{id: `${tmpEntityBase}p2`}], remove: [{id: `${tmpEntityBase}p3`}]},
    } as any);

    const canonical = buildCanonicalMutationIR(updateFactory.getQueryObject());

    expect(canonical.kind).toBe('update_mutation');
    expect(canonical).toMatchInlineSnapshot(`
      {
        "id": "linked://tmp/entities/p1",
        "kind": "update_mutation",
        "shape": {
          "shapeId": "https://data.lincd.org/module/-_linked-core/shape/person",
        },
        "updates": {
          "fields": [
            {
              "property": {
                "propertyShapeId": "https://data.lincd.org/module/-_linked-core/shape/person/friends",
              },
              "value": {
                "add": [
                  {
                    "id": "linked://tmp/entities/p2",
                  },
                ],
                "remove": [
                  {
                    "id": "linked://tmp/entities/p3",
                  },
                ],
              },
            },
          ],
          "shape": {
            "shapeId": "https://data.lincd.org/module/-_linked-core/shape/person",
          },
        },
      }
    `);
  });

  test('delete query converts ids as compact references', () => {
    const deleteFactory = new DeleteQueryFactory(Person as any, [
      `${tmpEntityBase}to-delete-1`,
      `${tmpEntityBase}to-delete-2`,
    ]);

    const canonical = buildCanonicalMutationIR(deleteFactory.getQueryObject());

    expect(canonical).toEqual({
      kind: 'delete_mutation',
      shape: {shapeId: 'https://data.lincd.org/module/-_linked-core/shape/person'},
      ids: [
        {id: `${tmpEntityBase}to-delete-1`},
        {id: `${tmpEntityBase}to-delete-2`},
      ],
    });
  });
});
