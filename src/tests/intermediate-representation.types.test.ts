import {describe, test} from '@jest/globals';
import {
  IRCreateMutation,
  IRDeleteMutation,
  IRExpression,
  IRGraphPattern,
  IRSelectQuery,
  IRUpdateMutation,
} from '../queries/IntermediateRepresentation';

const expectType = <T>(_value: T) => _value;

describe.skip('intermediate representation type contracts (compile only)', () => {
  test('select query discriminators and required fields', () => {
    const query: IRSelectQuery = {
      kind: 'select',
      root: {
        kind: 'shape_scan',
        shape: 'shape:Person',
        alias: 'p',
      },
      patterns: [],
      projection: [
        {
          alias: 'name',
          expression: {
            kind: 'property_expr',
            sourceAlias: 'p',
            property: 'prop:name',
          },
        },
      ],
      where: {
        kind: 'binary_expr',
        operator: '=',
        left: {
          kind: 'property_expr',
          sourceAlias: 'p',
          property: 'prop:name',
        },
        right: {kind: 'literal_expr', value: 'Semmy'},
      },
    };

    expectType<'select'>(query.kind);
    expectType<string>(query.root.shape);
  });

  test('graph pattern and expression unions are discriminated', () => {
    const pattern: IRGraphPattern = {
      kind: 'join',
      patterns: [
        {
          kind: 'shape_scan',
          shape: 'shape:Person',
          alias: 'p',
        },
        {
          kind: 'traverse',
          from: 'p',
          to: 'f',
          property: 'prop:friends',
        },
      ],
    };

    const expr: IRExpression = {
      kind: 'exists_expr',
      pattern,
    };

    expectType<'exists_expr'>(expr.kind);
  });

  test('mutation kinds stay distinct', () => {
    const create: IRCreateMutation = {
      kind: 'create',
      shape: 'shape:Person',
      data: {
        shape: 'shape:Person',
        fields: [
          {
            property: 'prop:name',
            value: 'Alice',
          },
        ],
      },
    };

    const update: IRUpdateMutation = {
      kind: 'update',
      shape: 'shape:Person',
      id: 'id:1',
      data: {
        shape: 'shape:Person',
        fields: [
          {
            property: 'prop:name',
            value: 'Alicia',
          },
        ],
      },
    };

    const del: IRDeleteMutation = {
      kind: 'delete',
      shape: 'shape:Person',
      ids: [{id: 'id:1'}],
    };

    expectType<'create'>(create.kind);
    expectType<'update'>(update.kind);
    expectType<'delete'>(del.kind);
  });
});
