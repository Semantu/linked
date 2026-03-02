import {describe, expect, test} from '@jest/globals';
import {Person, queryFactories, tmpEntityBase} from '../test-helpers/query-fixtures';
import {captureQuery} from '../test-helpers/query-capture-store';
import {
  IRCreateMutation,
  IRDeleteMutation,
  IRFieldUpdate,
  IRSetModificationValue,
  IRUpdateMutation,
} from '../queries/IntermediateRepresentation';

const captureMutationIR = (runner: () => Promise<unknown>) =>
  captureQuery(runner) as Promise<IRCreateMutation | IRUpdateMutation | IRDeleteMutation>;

const fieldBySuffix = (fields: IRFieldUpdate[], suffix: string) =>
  fields.find((field) => field.property.endsWith(`/${suffix}`));

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
        "data": {
          "fields": [
            {
              "property": "https://data.lincd.org/module/-_linked-core/shape/person/name",
              "value": "Test Create",
            },
            {
              "property": "https://data.lincd.org/module/-_linked-core/shape/person/friends",
              "value": [
                {
                  "id": "linked://tmp/entities/p2",
                },
                {
                  "fields": [
                    {
                      "property": "https://data.lincd.org/module/-_linked-core/shape/person/name",
                      "value": "New Friend",
                    },
                  ],
                  "shape": "https://data.lincd.org/module/-_linked-core/shape/person",
                },
              ],
            },
          ],
          "shape": "https://data.lincd.org/module/-_linked-core/shape/person",
        },
        "kind": "create",
        "shape": "https://data.lincd.org/module/-_linked-core/shape/person",
      }
    `);
  });

  test('covers all create mutation patterns from query.test.ts', async () => {
    const createSimple = await captureMutationIR(() => queryFactories.createSimple());
    expect(createSimple.kind).toBe('create');
    if (createSimple.kind === 'create') {
      expect(fieldBySuffix(createSimple.data.fields, 'name')?.value).toBe('Test Create');
      expect(fieldBySuffix(createSimple.data.fields, 'hobby')?.value).toBe('Chess');
    }

    const createWithFriends = await captureMutationIR(() => queryFactories.createWithFriends());
    expect(createWithFriends.kind).toBe('create');
    if (createWithFriends.kind === 'create') {
      const friendsField = fieldBySuffix(createWithFriends.data.fields, 'friends');
      expect(Array.isArray(friendsField?.value)).toBe(true);
      expect((friendsField?.value as any[])?.[0]?.id).toBe(`${tmpEntityBase}p2`);
      expect((friendsField?.value as any[])?.[1]?.shape).toBe(Person.shape.id);
    }

    const createWithFixedId = await captureMutationIR(() => queryFactories.createWithFixedId());
    expect(createWithFixedId.kind).toBe('create');
    if (createWithFixedId.kind === 'create') {
      expect(createWithFixedId.data.id).toBe(`${tmpEntityBase}fixed-id`);
      expect(fieldBySuffix(createWithFixedId.data.fields, 'bestFriend')?.value).toEqual({
        id: `${tmpEntityBase}fixed-id-2`,
      });
    }
  });

  test('covers all delete mutation patterns from query.test.ts', async () => {
    const deleteSingle = await captureMutationIR(() => queryFactories.deleteSingle());
    expect(deleteSingle.kind).toBe('delete');
    if (deleteSingle.kind === 'delete') {
      expect(deleteSingle.ids).toEqual([{id: `${tmpEntityBase}to-delete`}]);
    }

    const deleteSingleRef = await captureMutationIR(() => queryFactories.deleteSingleRef());
    expect(deleteSingleRef.kind).toBe('delete');
    if (deleteSingleRef.kind === 'delete') {
      expect(deleteSingleRef.ids).toEqual([{id: `${tmpEntityBase}to-delete`}]);
    }

    const deleteMultiple = await captureMutationIR(() => queryFactories.deleteMultiple());
    expect(deleteMultiple.kind).toBe('delete');
    if (deleteMultiple.kind === 'delete') {
      expect(deleteMultiple.ids).toEqual([
        {id: `${tmpEntityBase}to-delete-1`},
        {id: `${tmpEntityBase}to-delete-2`},
      ]);
    }

    const deleteMultipleFull = await captureMutationIR(() => queryFactories.deleteMultipleFull());
    expect(deleteMultipleFull.kind).toBe('delete');
    if (deleteMultipleFull.kind === 'delete') {
      expect(deleteMultipleFull.ids).toEqual([
        {id: `${tmpEntityBase}to-delete-1`},
        {id: `${tmpEntityBase}to-delete-2`},
      ]);
    }
  });

  test('covers all update mutation patterns from query.test.ts', async () => {
    const updateSimple = await captureMutationIR(() => queryFactories.updateSimple());
    expect(updateSimple.kind).toBe('update');
    if (updateSimple.kind === 'update') {
      expect(updateSimple.id).toBe(`${tmpEntityBase}p1`);
      expect(fieldBySuffix(updateSimple.data.fields, 'hobby')?.value).toBe('Chess');
    }

    const updateOverwriteSet = await captureMutationIR(() => queryFactories.updateOverwriteSet());
    expect(updateOverwriteSet.kind).toBe('update');
    if (updateOverwriteSet.kind === 'update') {
      expect(fieldBySuffix(updateOverwriteSet.data.fields, 'friends')?.value).toEqual([
        {id: `${tmpEntityBase}p2`},
      ]);
    }

    const updateUnsetSingleUndefined = await captureMutationIR(() =>
      queryFactories.updateUnsetSingleUndefined(),
    );
    expect(updateUnsetSingleUndefined.kind).toBe('update');
    if (updateUnsetSingleUndefined.kind === 'update') {
      expect(fieldBySuffix(updateUnsetSingleUndefined.data.fields, 'hobby')?.value).toBeUndefined();
    }

    const updateUnsetSingleNull = await captureMutationIR(() =>
      queryFactories.updateUnsetSingleNull(),
    );
    expect(updateUnsetSingleNull.kind).toBe('update');
    if (updateUnsetSingleNull.kind === 'update') {
      expect(fieldBySuffix(updateUnsetSingleNull.data.fields, 'hobby')?.value).toBeUndefined();
    }

    const updateOverwriteNested = await captureMutationIR(() =>
      queryFactories.updateOverwriteNested(),
    );
    expect(updateOverwriteNested.kind).toBe('update');
    if (updateOverwriteNested.kind === 'update') {
      const bestFriend = fieldBySuffix(updateOverwriteNested.data.fields, 'bestFriend')?.value as any;
      expect(bestFriend.shape).toBe(Person.shape.id);
      expect(fieldBySuffix(bestFriend.fields, 'name')?.value).toBe('Bestie');
    }

    const updatePassIdReferences = await captureMutationIR(() =>
      queryFactories.updatePassIdReferences(),
    );
    expect(updatePassIdReferences.kind).toBe('update');
    if (updatePassIdReferences.kind === 'update') {
      expect(fieldBySuffix(updatePassIdReferences.data.fields, 'bestFriend')?.value).toEqual({
        id: `${tmpEntityBase}p2`,
      });
    }

    const updateAddRemoveMulti = await captureMutationIR(() =>
      queryFactories.updateAddRemoveMulti(),
    );
    expect(updateAddRemoveMulti.kind).toBe('update');
    if (updateAddRemoveMulti.kind === 'update') {
      const friends = fieldBySuffix(updateAddRemoveMulti.data.fields, 'friends')?.value;
      assertSetModification(friends, {add: 1, remove: 1});
    }

    const updateRemoveMulti = await captureMutationIR(() => queryFactories.updateRemoveMulti());
    expect(updateRemoveMulti.kind).toBe('update');
    if (updateRemoveMulti.kind === 'update') {
      const friends = fieldBySuffix(updateRemoveMulti.data.fields, 'friends')?.value;
      assertSetModification(friends, {remove: 1});
      expect((friends as IRSetModificationValue).add).toBeUndefined();
    }

    const updateAddRemoveSame = await captureMutationIR(() => queryFactories.updateAddRemoveSame());
    expect(updateAddRemoveSame.kind).toBe('update');
    if (updateAddRemoveSame.kind === 'update') {
      const friends = fieldBySuffix(updateAddRemoveSame.data.fields, 'friends')?.value;
      assertSetModification(friends, {add: 1, remove: 1});
    }

    const updateUnsetMultiUndefined = await captureMutationIR(() =>
      queryFactories.updateUnsetMultiUndefined(),
    );
    expect(updateUnsetMultiUndefined.kind).toBe('update');
    if (updateUnsetMultiUndefined.kind === 'update') {
      expect(fieldBySuffix(updateUnsetMultiUndefined.data.fields, 'friends')?.value).toBeUndefined();
    }

    const updateNestedWithPredefinedId = await captureMutationIR(() =>
      queryFactories.updateNestedWithPredefinedId(),
    );
    expect(updateNestedWithPredefinedId.kind).toBe('update');
    if (updateNestedWithPredefinedId.kind === 'update') {
      const bestFriend = fieldBySuffix(
        updateNestedWithPredefinedId.data.fields,
        'bestFriend',
      )?.value as any;
      expect(bestFriend.id).toBe(`${tmpEntityBase}p3-best-friend`);
      expect(bestFriend.shape).toBe(Person.shape.id);
      expect(bestFriend.fields).toBeDefined();
      expect(fieldBySuffix(bestFriend.fields, 'name')?.value).toBe('Bestie');
    }

    const updateBirthDate = await captureMutationIR(() => queryFactories.updateBirthDate());
    expect(updateBirthDate.kind).toBe('update');
    if (updateBirthDate.kind === 'update') {
      const birthDate = fieldBySuffix(updateBirthDate.data.fields, 'birthDate')?.value;
      expect(birthDate).toBeInstanceOf(Date);
      expect((birthDate as Date).toISOString()).toBe('2020-01-01T00:00:00.000Z');
    }
  });
});
