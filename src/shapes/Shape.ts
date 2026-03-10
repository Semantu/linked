/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import type {ICoreIterable} from '../interfaces/ICoreIterable.js';
import type {NodeShape, PropertyShape} from './SHACL.js';
import {
  QResult,
  QShape,
  QueryBuildFn,
  QueryResponseToResultType,
  QueryShape,
  SelectAllQueryResponse,
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

/**
 * Concrete constructor type for Shape subclasses — used at runtime boundaries
 * (Builder `from()` methods, Shape static `this` parameters, mutation factories).
 *
 * Unlike `ShapeType` (which uses `abstract new`), this uses a concrete `new`,
 * so TypeScript allows direct instantiation (`new shape()`) and property access
 * (`shape.shape`) without casts.
 */
export type ShapeConstructor<S extends Shape = Shape> = (new (
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
    S extends Shape,
    R = unknown,
    ResultType = QueryResponseToResultType<R, S>[],
  >(
    this: ShapeConstructor<S>,
    selectFn: QueryBuildFn<S, R>,
  ): QueryBuilder<S, R, ResultType>;
  static select<
    S extends Shape,
    R = unknown,
    ResultType = QueryResponseToResultType<R, S>[],
  >(
    this: ShapeConstructor<S>,
  ): QueryBuilder<S, R, ResultType>;
  static select<
    S extends Shape,
    R = unknown,
    ResultType = QueryResponseToResultType<R, S>,
  >(
    this: ShapeConstructor<S>,
    subjects?: S | QResult<S>,
    selectFn?: QueryBuildFn<S, R>,
  ): QueryBuilder<S, R, ResultType>;
  static select<
    S extends Shape,
    R = unknown,
    ResultType = QueryResponseToResultType<R, S>[],
  >(
    this: ShapeConstructor<S>,
    subjects?: ICoreIterable<S> | QResult<S>[],
    selectFn?: QueryBuildFn<S, R>,
  ): QueryBuilder<S, R, ResultType>;
  static select<
    S extends Shape,
    R = unknown,
    ResultType = QueryResponseToResultType<R, S>[],
  >(
    this: ShapeConstructor<S>,
    targetOrSelectFn?: S | QueryBuildFn<S, R>,
    selectFn?: QueryBuildFn<S, R>,
  ): QueryBuilder<S, R, ResultType> {
    let _selectFn;
    let subject;
    if (selectFn) {
      _selectFn = selectFn;
      subject = targetOrSelectFn;
    } else {
      _selectFn = targetOrSelectFn;
    }

    let builder = QueryBuilder.from(this) as QueryBuilder<S, any, any>;
    if (_selectFn) {
      builder = builder.select(_selectFn as any);
    }
    if (subject) {
      builder = builder.for(subject as any);
    }
    return builder as QueryBuilder<S, R, ResultType>;
  }

  /**
   * Select all decorated properties of this shape.
   * Returns a single result if a single subject is provided, or an array of results if no subject is provided.
   */
  static selectAll<
    S extends Shape,
    ResultType = QueryResponseToResultType<
      SelectAllQueryResponse<S>,
      S
    >[],
  >(
    this: ShapeConstructor<S>,
  ): QueryBuilder<S, any, ResultType>;
  static selectAll<
    S extends Shape,
    ResultType = QueryResponseToResultType<
      SelectAllQueryResponse<S>,
      S
    >,
  >(
    this: ShapeConstructor<S>,
    subject: S | QResult<S>,
  ): QueryBuilder<S, any, ResultType>;
  static selectAll<
    S extends Shape,
    ResultType = QueryResponseToResultType<
      SelectAllQueryResponse<S>,
      S
    >[],
  >(
    this: ShapeConstructor<S>,
    subject?: S | QResult<S>,
  ): QueryBuilder<S, any, ResultType> {
    let builder = QueryBuilder.from(this).selectAll() as QueryBuilder<S, any, any>;
    if (subject) {
      builder = builder.for(subject as any);
    }
    return builder as QueryBuilder<S, any, ResultType>;
  }


  static update<S extends Shape, U extends UpdatePartial<S>>(
    this: ShapeConstructor<S>,
    id: string | NodeReferenceValue | QShape<S>,
    updateObjectOrFn?: U,
  ): UpdateBuilder<S, U> {
    let builder = UpdateBuilder.from(this) as UpdateBuilder<S, any>;
    builder = builder.for(id as any);
    if (updateObjectOrFn) {
      builder = builder.set(updateObjectOrFn);
    }
    return builder as unknown as UpdateBuilder<S, U>;
  }

  static create<S extends Shape, U extends UpdatePartial<S>>(
    this: ShapeConstructor<S>,
    updateObjectOrFn?: U,
  ): CreateBuilder<S, U> {
    let builder = CreateBuilder.from(this) as CreateBuilder<S, any>;
    if (updateObjectOrFn) {
      builder = builder.set(updateObjectOrFn);
    }
    return builder as unknown as CreateBuilder<S, U>;
  }

  static delete<S extends Shape>(
    this: ShapeConstructor<S>,
    id: NodeId | NodeId[] | NodeReferenceValue[],
  ): DeleteBuilder<S> {
    return DeleteBuilder.from(this, id) as DeleteBuilder<S>;
  }

  static mapPropertyShapes<S extends Shape, ResponseType = unknown>(
    this: ShapeConstructor<S>,
    mapFunction?: PropertyShapeMapFunction<S, ResponseType>,
  ): ResponseType {
    // SAFETY: dummyShape is used as a dynamic proxy target — we assign .proxy and
    // access arbitrary property names on it, which S doesn't declare.
    let dummyShape: any = new this();
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
    this: ShapeConstructor<T>,
    values: Iterable<T | NodeReferenceValue | string>,
  ): ShapeSet<T> {
    const set = new ShapeSet<T>();
    for (const value of values) {
      if (value instanceof Shape) {
        set.add(value as T);
      } else {
        const instance = new this();
        instance.id = typeof value === 'string' ? value : value.id;
        set.add(instance);
      }
    }
    return set;
  }
}
