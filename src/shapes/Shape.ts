/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import type {NodeShape, PropertyShape} from './SHACL.js';
import type {
  QueryBuildFn,
  QueryResponseToResultType,
  QueryShape,
  SelectAllQueryResponse,
  WhereClause,
} from '../queries/SelectQuery.js';
import type {NodeReferenceValue, UpdatePartial} from '../queries/QueryFactory.js';
import type {NodeId} from '../queries/MutationQuery.js';
import {QueryBuilder} from '../queries/QueryBuilder.js';
import {CreateBuilder} from '../queries/CreateBuilder.js';
import {UpdateBuilder} from '../queries/UpdateBuilder.js';
import {DeleteBuilder} from '../queries/DeleteBuilder.js';
import type {ExpressionUpdateProxy, ExpressionUpdateResult} from '../expressions/ExpressionMethods.js';
import {getPropertyShapeByLabel} from '../utils/ShapeClass.js';
import {ShapeSet} from '../collections/ShapeSet.js';

//shape that returns property shapes for its keys
type AccessPropertiesShape<T extends Shape> = {
  [P in keyof T]: PropertyShape;
};
type PropertyShapeMapFunction<T extends Shape, ResponseType> = (
  p: AccessPropertiesShape<T>,
) => ResponseType;

/**
 * Concrete constructor type for Shape subclasses — used at runtime boundaries
 * (Builder `from()` methods, Shape static `this` parameters, mutation factories).
 *
 * Uses concrete `new` (not `abstract new`), so TypeScript allows direct
 * instantiation (`new shape()`) and property access (`shape.shape`) without casts.
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
   * Chain `.for(id)` to target a single entity, or `.forAll(ids)` for multiple.
   * The select callback receives a proxy of the shape for type-safe property access.
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
    ResultType = QueryResponseToResultType<R, S>[],
  >(
    this: ShapeConstructor<S>,
    selectFn?: QueryBuildFn<S, R>,
  ): QueryBuilder<S, R, ResultType> {
    let builder = QueryBuilder.from(this) as QueryBuilder<S, any, any>;
    if (selectFn) {
      builder = builder.select(selectFn as any);
    }
    return builder as QueryBuilder<S, R, ResultType>;
  }

  /**
   * Select all decorated properties of this shape.
   * Chain `.for(id)` to target a single entity.
   */
  static selectAll<
    S extends Shape,
    ResultType = QueryResponseToResultType<
      SelectAllQueryResponse<S>,
      S
    >[],
  >(
    this: ShapeConstructor<S>,
  ): QueryBuilder<S, any, ResultType> {
    return QueryBuilder.from(this).selectAll() as QueryBuilder<S, any, ResultType>;
  }


  /**
   * Update properties of an instance of this shape.
   * Chain `.for(id)` to target a specific entity.
   *
   * ```typescript
   * await Person.update({name: 'Alice'}).for({id: '...'});
   * ```
   */
  static update<S extends Shape>(
    this: ShapeConstructor<S>,
    data: (p: ExpressionUpdateProxy<S>) => ExpressionUpdateResult<S>,
  ): UpdateBuilder<S, any>;
  static update<S extends Shape, U extends UpdatePartial<S>>(
    this: ShapeConstructor<S>,
    data: U,
  ): UpdateBuilder<S, U>;
  static update<S extends Shape>(
    this: ShapeConstructor<S>,
    data: any,
  ): UpdateBuilder<S, any> {
    return UpdateBuilder.from(this).set(data) as unknown as UpdateBuilder<S, any>;
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

  /** Delete all instances of this shape type. Returns void. */
  static deleteAll<S extends Shape>(
    this: ShapeConstructor<S>,
  ): DeleteBuilder<S, void> {
    return (DeleteBuilder.from(this) as DeleteBuilder<S>).all();
  }

  /** Delete instances matching a condition. Sugar for `.delete().where(fn)`. Returns void. */
  static deleteWhere<S extends Shape>(
    this: ShapeConstructor<S>,
    fn: WhereClause<S>,
  ): DeleteBuilder<S, void> {
    return (DeleteBuilder.from(this) as DeleteBuilder<S>).where(fn);
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
