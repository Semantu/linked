import {Shape, ShapeType} from '../shapes/Shape.js';
import {getShapeClass} from '../utils/ShapeClass.js';
import {UpdatePartial, NodeReferenceValue, toNodeReference} from './QueryFactory.js';
import {UpdateQueryFactory, UpdateQuery} from './UpdateQuery.js';
import {getQueryDispatch} from './queryDispatch.js';

/**
 * Internal state bag for UpdateBuilder.
 */
interface UpdateBuilderInit<S extends Shape> {
  shape: ShapeType<S>;
  data?: UpdatePartial<S>;
  targetId?: string;
}

/**
 * An immutable, fluent builder for update mutations.
 *
 * Every mutation method returns a new UpdateBuilder — the original is never modified.
 *
 * Implements PromiseLike so mutations execute on `await`:
 * ```ts
 * const result = await UpdateBuilder.from(Person).for({id: '...'}).set({name: 'Bob'});
 * ```
 *
 * `.for(id)` must be called before `.build()` or `.exec()`.
 *
 * Internally delegates to UpdateQueryFactory for IR generation.
 */
export class UpdateBuilder<S extends Shape = Shape>
  implements PromiseLike<any>, Promise<any>
{
  private readonly _shape: ShapeType<S>;
  private readonly _data?: UpdatePartial<S>;
  private readonly _targetId?: string;

  private constructor(init: UpdateBuilderInit<S>) {
    this._shape = init.shape;
    this._data = init.data;
    this._targetId = init.targetId;
  }

  private clone(overrides: Partial<UpdateBuilderInit<S>> = {}): UpdateBuilder<S> {
    return new UpdateBuilder<S>({
      shape: this._shape,
      data: this._data,
      targetId: this._targetId,
      ...overrides,
    });
  }

  // ---------------------------------------------------------------------------
  // Static constructors
  // ---------------------------------------------------------------------------

  static from<S extends Shape>(shape: ShapeType<S> | string): UpdateBuilder<S> {
    const resolved = UpdateBuilder.resolveShape<S>(shape);
    return new UpdateBuilder<S>({shape: resolved});
  }

  private static resolveShape<S extends Shape>(
    shape: ShapeType<S> | string,
  ): ShapeType<S> {
    if (typeof shape === 'string') {
      const shapeClass = getShapeClass(shape);
      if (!shapeClass) {
        throw new Error(`Cannot resolve shape for '${shape}'`);
      }
      return shapeClass as unknown as ShapeType<S>;
    }
    return shape;
  }

  // ---------------------------------------------------------------------------
  // Fluent API
  // ---------------------------------------------------------------------------

  /** Target a specific entity by ID. Required before build/exec. */
  for(id: string | NodeReferenceValue): UpdateBuilder<S> {
    const resolvedId = typeof id === 'string' ? id : id.id;
    return this.clone({targetId: resolvedId});
  }

  /** Set the update data. */
  set(data: UpdatePartial<S>): UpdateBuilder<S> {
    return this.clone({data});
  }

  // ---------------------------------------------------------------------------
  // Build & execute
  // ---------------------------------------------------------------------------

  /** Build the IR mutation. Throws if no target ID was set via .for(). */
  build(): UpdateQuery {
    if (!this._targetId) {
      throw new Error(
        'UpdateBuilder requires .for(id) before .build(). Specify which entity to update.',
      );
    }
    if (!this._data) {
      throw new Error(
        'UpdateBuilder requires .set(data) before .build(). Specify what to update.',
      );
    }
    const factory = new UpdateQueryFactory<S, UpdatePartial<S>>(
      this._shape as any as typeof Shape,
      this._targetId,
      this._data,
    );
    return factory.build();
  }

  /** Execute the mutation. */
  exec(): Promise<any> {
    return getQueryDispatch().updateQuery(this.build());
  }

  // ---------------------------------------------------------------------------
  // Promise interface
  // ---------------------------------------------------------------------------

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
  ): Promise<any | TResult> {
    return this.exec().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<any> {
    return this.exec().finally(onfinally);
  }

  get [Symbol.toStringTag](): string {
    return 'UpdateBuilder';
  }
}
