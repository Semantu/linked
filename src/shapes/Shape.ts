/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import type {ICoreIterable} from '../interfaces/ICoreIterable.js';
import type {NodeShape, PropertyShape} from './SHACL.js';
import {
  GetQueryResponseType,
  QResult,
  QShape,
  QueryBuildFn,
  QueryResponseToResultType,
  QueryShape,
  SelectAllQueryResponse,
  SelectQueryFactory,
} from '../queries/SelectQuery.js';
import {NodeReferenceValue, UpdatePartial} from '../queries/QueryFactory.js';
import {NodeId} from '../queries/MutationQuery.js';
import {QueryBuilder} from '../queries/QueryBuilder.js';
import {CreateBuilder} from '../queries/CreateBuilder.js';
import {UpdateBuilder} from '../queries/UpdateBuilder.js';
import {DeleteBuilder} from '../queries/DeleteBuilder.js';
import {getPropertyShapeByLabel} from '../utils/ShapeClass.js';
import {ShapeSet} from '../collections/ShapeSet.js';

//shape that returns property shapes for its keys
type AccessPropertiesShape<T extends Shape> = {
  [P in keyof T]: PropertyShape;
};
type PropertyShapeMapFunction<T extends Shape, ResponseType> = (
  p: AccessPropertiesShape<T>,
) => ResponseType;

export type ShapeType<S extends Shape = Shape> = (abstract new (
  ...args: any[]
) => S) & {
  shape: NodeShape;
  targetClass?: NodeReferenceValue;
};

export abstract class Shape {
  static targetClass: NodeReferenceValue = null;
  static shape: NodeShape;
  static typesToShapes: Map<string, Set<typeof Shape>> = new Map();

  __queryContextId?: string;
  id?: string;

  constructor(node?: string | NodeReferenceValue) {
    if (node) {
      this.id = typeof node === 'string' ? node : node.id;
    }
  }

  get nodeShape(): NodeShape {
    return (this.constructor as typeof Shape).shape;
  }

  get uri(): string {
    return this.id;
  }

  set uri(value: string) {
    this.id = value;
  }

  /**
   * @internal
   * @param shapeClass
   * @param type
   */
  static registerByType(shapeClass: typeof Shape, type?: NodeReferenceValue) {
    if (!type) {
      if (shapeClass === Shape) {
        return;
      }
      const shapeType = shapeClass.targetClass;
      if (shapeType) {
        type = shapeType;
      }
    }
    if (!type) {
      return;
    }
    const typeId = type.id;
    if (!this.typesToShapes.has(typeId)) {
      this.typesToShapes.set(typeId, new Set());
    }
    this.typesToShapes.get(typeId).add(shapeClass);
  }

  /**
   * Select properties of instances of this shape.
   * Returns a single result if a single subject is provided, or an array of results if no subjects are provided.
   * The select function (first or second argument) receives a proxy of the shape that allows you to virtually access any property you want up to any level of depth.
   * @param selectFn
   */
  static select<
    ShapeType extends Shape,
    S = unknown,
    ResultType = QueryResponseToResultType<S, ShapeType>[],
  >(
    this: {new (...args: any[]): ShapeType; },
    selectFn: QueryBuildFn<ShapeType, S>,
  ): QueryBuilder<ShapeType, S, ResultType>;
  static select<
    ShapeType extends Shape,
    S = unknown,
    ResultType = QueryResponseToResultType<
      GetQueryResponseType<SelectQueryFactory<ShapeType, S>>,
      ShapeType
    >[],
  >(
    this: {new (...args: any[]): ShapeType},
  ): QueryBuilder<ShapeType, S, ResultType>;
  static select<
    ShapeType extends Shape,
    S = unknown,
    ResultType = QueryResponseToResultType<
      GetQueryResponseType<SelectQueryFactory<ShapeType, S>>,
      ShapeType
    >,
  >(
    this: {new (...args: any[]): ShapeType; },
    subjects?: ShapeType | QResult<ShapeType>,
    selectFn?: QueryBuildFn<ShapeType, S>,
  ): QueryBuilder<ShapeType, S, ResultType>;
  static select<
    ShapeType extends Shape,
    S = unknown,
    ResultType = QueryResponseToResultType<
      GetQueryResponseType<SelectQueryFactory<ShapeType, S>>,
      ShapeType
    >[],
  >(
    this: {new (...args: any[]): ShapeType; },
    subjects?: ICoreIterable<ShapeType> | QResult<ShapeType>[],
    selectFn?: QueryBuildFn<ShapeType, S>,
  ): QueryBuilder<ShapeType, S, ResultType>;
  static select<
    ShapeType extends Shape,
    S = unknown,
    ResultType = QueryResponseToResultType<
      GetQueryResponseType<SelectQueryFactory<ShapeType, S>>,
      ShapeType
    >[],
  >(
    this: {new (...args: any[]): ShapeType; },
    targetOrSelectFn?: ShapeType | QueryBuildFn<ShapeType, S>,
    selectFn?: QueryBuildFn<ShapeType, S>,
  ): QueryBuilder<ShapeType, S, ResultType> {
    let _selectFn;
    let subject;
    if (selectFn) {
      _selectFn = selectFn;
      subject = targetOrSelectFn;
    } else {
      _selectFn = targetOrSelectFn;
    }

    let builder = QueryBuilder.from(this as any) as QueryBuilder<ShapeType, any, any>;
    if (_selectFn) {
      builder = builder.select(_selectFn as any);
    }
    if (subject) {
      builder = builder.for(subject as any);
    }
    return builder as QueryBuilder<ShapeType, S, ResultType>;
  }

  /**
   * Select all decorated properties of this shape.
   * Returns a single result if a single subject is provided, or an array of results if no subject is provided.
   */
  static selectAll<
    ShapeType extends Shape,
    ResultType = QueryResponseToResultType<
      SelectAllQueryResponse<ShapeType>,
      ShapeType
    >[],
  >(
    this: {new (...args: any[]): ShapeType; },
  ): QueryBuilder<ShapeType, any, ResultType>;
  static selectAll<
    ShapeType extends Shape,
    ResultType = QueryResponseToResultType<
      SelectAllQueryResponse<ShapeType>,
      ShapeType
    >,
  >(
    this: {new (...args: any[]): ShapeType; },
    subject: ShapeType | QResult<ShapeType>,
  ): QueryBuilder<ShapeType, any, ResultType>;
  static selectAll<
    ShapeType extends Shape,
    ResultType = QueryResponseToResultType<
      SelectAllQueryResponse<ShapeType>,
      ShapeType
    >[],
  >(
    this: {new (...args: any[]): ShapeType; },
    subject?: ShapeType | QResult<ShapeType>,
  ): QueryBuilder<ShapeType, any, ResultType> {
    let builder = QueryBuilder.from(this as any).selectAll() as QueryBuilder<ShapeType, any, any>;
    if (subject) {
      builder = builder.for(subject as any);
    }
    return builder as QueryBuilder<ShapeType, any, ResultType>;
  }


  static update<ShapeType extends Shape, U extends UpdatePartial<ShapeType>>(
    this: {new (...args: any[]): ShapeType; },
    id: string | NodeReferenceValue | QShape<ShapeType>,
    updateObjectOrFn?: U,
  ): UpdateBuilder<ShapeType, U> {
    let builder = UpdateBuilder.from(this as any) as UpdateBuilder<ShapeType, any>;
    builder = builder.for(id as any);
    if (updateObjectOrFn) {
      builder = builder.set(updateObjectOrFn);
    }
    return builder as unknown as UpdateBuilder<ShapeType, U>;
  }

  static create<ShapeType extends Shape, U extends UpdatePartial<ShapeType>>(
    this: {new (...args: any[]): ShapeType; },
    updateObjectOrFn?: U,
  ): CreateBuilder<ShapeType, U> {
    let builder = CreateBuilder.from(this as any) as CreateBuilder<ShapeType, any>;
    if (updateObjectOrFn) {
      builder = builder.set(updateObjectOrFn);
    }
    return builder as unknown as CreateBuilder<ShapeType, U>;
  }

  static delete<ShapeType extends Shape>(
    this: {new (...args: any[]): ShapeType; },
    id: NodeId | NodeId[] | NodeReferenceValue[],
  ): DeleteBuilder<ShapeType> {
    return DeleteBuilder.from(this as any, id as any) as DeleteBuilder<ShapeType>;
  }

  static mapPropertyShapes<ShapeType extends Shape, ResponseType = unknown>(
    this: {new (...args: any[]): ShapeType; targetClass: any},
    mapFunction?: PropertyShapeMapFunction<ShapeType, ResponseType>,
  ): ResponseType {
    let dummyShape = new (this as any)();
    dummyShape.proxy = new Proxy(dummyShape, {
      get(target, key, receiver) {
        if (typeof key === 'string') {
          if (key in dummyShape) {
            if (typeof dummyShape[key] === 'function') {
              return target[key].bind(target);
            }
            let propertyShape = getPropertyShapeByLabel(
              dummyShape.constructor,
              key.toString(),
            );
            if (propertyShape) {
              return propertyShape;
            }
            throw new Error(
              `${this.name}.${key.toString()} is missing a @linkedProperty decorator. This method can only access decorated get/set methods.`,
            );
          }
        }
      },
    });
    return mapFunction(dummyShape.proxy);
  }

  static getSetOf<T extends Shape>(
    this: {new (...args: any[]): T},
    values: Iterable<T | NodeReferenceValue | string>,
  ): ShapeSet<T> {
    const set = new ShapeSet<T>();
    for (const value of values) {
      if (value instanceof Shape) {
        set.add(value as T);
      } else {
        const instance = new (this as any)();
        instance.id = typeof value === 'string' ? value : value.id;
        set.add(instance);
      }
    }
    return set;
  }
}
