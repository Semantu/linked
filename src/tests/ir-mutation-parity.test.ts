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
import {buildCanonicalMutationIR} from '../queries/IRMutation';
import {Person, queryFactories, tmpEntityBase} from '../test-helpers/query-fixtures';
import {
  IRCreateMutation,
  IRDeleteMutation,
  IRNodeFieldUpdate,
  IRSetModificationValue,
  IRUpdateMutation,
} from '../queries/IntermediateRepresentation';

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

const captureMutationQuery = async (runner: () => Promise<unknown>) => {
  store.lastQuery = undefined;
  await runner();
  return store.lastQuery;
};

const captureMutationIR = async (
  runner: () => Promise<unknown>,
): Promise<IRCreateMutation | IRUpdateMutation | IRDeleteMutation> => {
  const query = await captureMutationQuery(runner);
  return buildCanonicalMutationIR(query);
};

const fieldBySuffix = (fields: IRNodeFieldUpdate[], suffix: string) =>
  fields.find((field) => field.property.propertyShapeId.endsWith(`/${suffix}`));

const assertSetModification = (
  value: unknown,
  expected: {add?: number; remove?: number},
) => {
  const setMod = value as IRSetModificationValue;
  if (expected.add !== undefined) {
    expect(setMod.add).toHaveLength(expected.add);
  }
  if (expected.remove !== undefined) {
    expect(setMod.remove).toHaveLength(expected.remove);
  }
};

describe('mutation IR parity (Phase 4)', () => {
  test('create with nested friend snapshot', async () => {
    const canonical = await captureMutationIR(() => queryFactories.createWithFriends());

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

  test('covers all create mutation patterns from query.test.ts', async () => {
    const createSimple = await captureMutationIR(() => queryFactories.createSimple());
    expect(createSimple.kind).toBe('create_mutation');
    if (createSimple.kind === 'create_mutation') {
      expect(fieldBySuffix(createSimple.description.fields, 'name')?.value).toBe('Test Create');
      expect(fieldBySuffix(createSimple.description.fields, 'hobby')?.value).toBe('Chess');
    }

    const createWithFriends = await captureMutationIR(() => queryFactories.createWithFriends());
    expect(createWithFriends.kind).toBe('create_mutation');
    if (createWithFriends.kind === 'create_mutation') {
      const friendsField = fieldBySuffix(createWithFriends.description.fields, 'friends');
      expect(Array.isArray(friendsField?.value)).toBe(true);
      expect((friendsField?.value as any[])?.[0]?.id).toBe(`${tmpEntityBase}p2`);
      expect((friendsField?.value as any[])?.[1]?.shape?.shapeId).toBe(Person.shape.id);
    }

    const createWithFixedId = await captureMutationIR(() => queryFactories.createWithFixedId());
    expect(createWithFixedId.kind).toBe('create_mutation');
    if (createWithFixedId.kind === 'create_mutation') {
      expect(createWithFixedId.description.id).toBe(`${tmpEntityBase}fixed-id`);
      expect(fieldBySuffix(createWithFixedId.description.fields, 'bestFriend')?.value).toEqual({
        id: `${tmpEntityBase}fixed-id-2`,
      });
    }
  });

  test('covers all delete mutation patterns from query.test.ts', async () => {
    const deleteSingle = await captureMutationIR(() => queryFactories.deleteSingle());
    expect(deleteSingle.kind).toBe('delete_mutation');
    if (deleteSingle.kind === 'delete_mutation') {
      expect(deleteSingle.ids).toEqual([{id: `${tmpEntityBase}to-delete`}]);
    }

    const deleteSingleRef = await captureMutationIR(() => queryFactories.deleteSingleRef());
    expect(deleteSingleRef.kind).toBe('delete_mutation');
    if (deleteSingleRef.kind === 'delete_mutation') {
      expect(deleteSingleRef.ids).toEqual([{id: `${tmpEntityBase}to-delete`}]);
    }

    const deleteMultiple = await captureMutationIR(() => queryFactories.deleteMultiple());
    expect(deleteMultiple.kind).toBe('delete_mutation');
    if (deleteMultiple.kind === 'delete_mutation') {
      expect(deleteMultiple.ids).toEqual([
        {id: `${tmpEntityBase}to-delete-1`},
        {id: `${tmpEntityBase}to-delete-2`},
      ]);
    }

    const deleteMultipleFull = await captureMutationIR(() => queryFactories.deleteMultipleFull());
    expect(deleteMultipleFull.kind).toBe('delete_mutation');
    if (deleteMultipleFull.kind === 'delete_mutation') {
      expect(deleteMultipleFull.ids).toEqual([
        {id: `${tmpEntityBase}to-delete-1`},
        {id: `${tmpEntityBase}to-delete-2`},
      ]);
    }
  });

  test('covers all update mutation patterns from query.test.ts', async () => {
    const updateSimple = await captureMutationIR(() => queryFactories.updateSimple());
    expect(updateSimple.kind).toBe('update_mutation');
    if (updateSimple.kind === 'update_mutation') {
      expect(updateSimple.id).toBe(`${tmpEntityBase}p1`);
      expect(fieldBySuffix(updateSimple.updates.fields, 'hobby')?.value).toBe('Chess');
    }

    const updateOverwriteSet = await captureMutationIR(() => queryFactories.updateOverwriteSet());
    expect(updateOverwriteSet.kind).toBe('update_mutation');
    if (updateOverwriteSet.kind === 'update_mutation') {
      expect(fieldBySuffix(updateOverwriteSet.updates.fields, 'friends')?.value).toEqual([
        {id: `${tmpEntityBase}p2`},
      ]);
    }

    const updateUnsetSingleUndefined = await captureMutationIR(() =>
      queryFactories.updateUnsetSingleUndefined(),
    );
    expect(updateUnsetSingleUndefined.kind).toBe('update_mutation');
    if (updateUnsetSingleUndefined.kind === 'update_mutation') {
      expect(fieldBySuffix(updateUnsetSingleUndefined.updates.fields, 'hobby')?.value).toBeUndefined();
    }

    const updateUnsetSingleNull = await captureMutationIR(() =>
      queryFactories.updateUnsetSingleNull(),
    );
    expect(updateUnsetSingleNull.kind).toBe('update_mutation');
    if (updateUnsetSingleNull.kind === 'update_mutation') {
      expect(fieldBySuffix(updateUnsetSingleNull.updates.fields, 'hobby')?.value).toBeUndefined();
    }

    const updateOverwriteNested = await captureMutationIR(() =>
      queryFactories.updateOverwriteNested(),
    );
    expect(updateOverwriteNested.kind).toBe('update_mutation');
    if (updateOverwriteNested.kind === 'update_mutation') {
      const bestFriend = fieldBySuffix(updateOverwriteNested.updates.fields, 'bestFriend')?.value as any;
      expect(bestFriend.shape?.shapeId).toBe(Person.shape.id);
      expect(fieldBySuffix(bestFriend.fields, 'name')?.value).toBe('Bestie');
    }

    const updatePassIdReferences = await captureMutationIR(() =>
      queryFactories.updatePassIdReferences(),
    );
    expect(updatePassIdReferences.kind).toBe('update_mutation');
    if (updatePassIdReferences.kind === 'update_mutation') {
      expect(fieldBySuffix(updatePassIdReferences.updates.fields, 'bestFriend')?.value).toEqual({
        id: `${tmpEntityBase}p2`,
      });
    }

    const updateAddRemoveMulti = await captureMutationIR(() =>
      queryFactories.updateAddRemoveMulti(),
    );
    expect(updateAddRemoveMulti.kind).toBe('update_mutation');
    if (updateAddRemoveMulti.kind === 'update_mutation') {
      const friends = fieldBySuffix(updateAddRemoveMulti.updates.fields, 'friends')?.value;
      assertSetModification(friends, {add: 1, remove: 1});
    }

    const updateRemoveMulti = await captureMutationIR(() => queryFactories.updateRemoveMulti());
    expect(updateRemoveMulti.kind).toBe('update_mutation');
    if (updateRemoveMulti.kind === 'update_mutation') {
      const friends = fieldBySuffix(updateRemoveMulti.updates.fields, 'friends')?.value;
      assertSetModification(friends, {remove: 1});
      expect((friends as IRSetModificationValue).add).toBeUndefined();
    }

    const updateAddRemoveSame = await captureMutationIR(() => queryFactories.updateAddRemoveSame());
    expect(updateAddRemoveSame.kind).toBe('update_mutation');
    if (updateAddRemoveSame.kind === 'update_mutation') {
      const friends = fieldBySuffix(updateAddRemoveSame.updates.fields, 'friends')?.value;
      assertSetModification(friends, {add: 1, remove: 1});
    }

    const updateUnsetMultiUndefined = await captureMutationIR(() =>
      queryFactories.updateUnsetMultiUndefined(),
    );
    expect(updateUnsetMultiUndefined.kind).toBe('update_mutation');
    if (updateUnsetMultiUndefined.kind === 'update_mutation') {
      expect(fieldBySuffix(updateUnsetMultiUndefined.updates.fields, 'friends')?.value).toBeUndefined();
    }

    const updateNestedWithPredefinedId = await captureMutationIR(() =>
      queryFactories.updateNestedWithPredefinedId(),
    );
    expect(updateNestedWithPredefinedId.kind).toBe('update_mutation');
    if (updateNestedWithPredefinedId.kind === 'update_mutation') {
      const bestFriend = fieldBySuffix(
        updateNestedWithPredefinedId.updates.fields,
        'bestFriend',
      )?.value as any;
      expect(bestFriend.id).toBe(`${tmpEntityBase}p3-best-friend`);
      if (bestFriend.fields) {
        expect(fieldBySuffix(bestFriend.fields, 'name')?.value).toBe('Bestie');
      }
    }

    const updateBirthDate = await captureMutationIR(() => queryFactories.updateBirthDate());
    expect(updateBirthDate.kind).toBe('update_mutation');
    if (updateBirthDate.kind === 'update_mutation') {
      const birthDate = fieldBySuffix(updateBirthDate.updates.fields, 'birthDate')?.value;
      expect(birthDate).toBeInstanceOf(Date);
      expect((birthDate as Date).toISOString()).toBe('2020-01-01T00:00:00.000Z');
    }
  });
});
