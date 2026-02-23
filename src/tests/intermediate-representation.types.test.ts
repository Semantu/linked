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
      kind: 'select_query',
      root: {
        kind: 'shape_scan',
        shape: {shapeId: 'shape:Person'},
        alias: 'p',
      },
      projection: [
        {
          kind: 'projection_item',
          alias: 'name',
          expression: {
            kind: 'property_expr',
            sourceAlias: 'p',
            property: {propertyShapeId: 'prop:name'},
          },
        },
      ],
      where: {
        kind: 'binary_expr',
        operator: '=',
        left: {
          kind: 'property_expr',
          sourceAlias: 'p',
          property: {propertyShapeId: 'prop:name'},
        },
        right: {kind: 'literal_expr', value: 'Semmy'},
      },
    };

    expectType<'select_query'>(query.kind);
    expectType<string>(query.root.shape.shapeId);
  });

  test('graph pattern and expression unions are discriminated', () => {
    const pattern: IRGraphPattern = {
      kind: 'join',
      patterns: [
        {
          kind: 'shape_scan',
          shape: {shapeId: 'shape:Person'},
          alias: 'p',
        },
        {
          kind: 'traverse',
          from: 'p',
          to: 'f',
          property: {propertyShapeId: 'prop:friends'},
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
      kind: 'create_mutation',
      shape: {shapeId: 'shape:Person'},
      description: {
        shape: {shapeId: 'shape:Person'},
        fields: [
          {
            property: {propertyShapeId: 'prop:name'},
            value: 'Alice',
          },
        ],
      },
    };

    const update: IRUpdateMutation = {
      kind: 'update_mutation',
      shape: {shapeId: 'shape:Person'},
      id: 'id:1',
      updates: {
        shape: {shapeId: 'shape:Person'},
        fields: [
          {
            property: {propertyShapeId: 'prop:name'},
            value: 'Alicia',
          },
        ],
      },
    };

    const del: IRDeleteMutation = {
      kind: 'delete_mutation',
      shape: {shapeId: 'shape:Person'},
      ids: [{id: 'id:1'}],
    };

    expectType<'create_mutation'>(create.kind);
    expectType<'update_mutation'>(update.kind);
    expectType<'delete_mutation'>(del.kind);
  });
});
