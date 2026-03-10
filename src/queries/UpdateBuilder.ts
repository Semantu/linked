import {Shape, ShapeConstructor} from '../shapes/Shape.js';
import {resolveShape} from './resolveShape.js';
import {AddId, UpdatePartial, NodeReferenceValue} from './QueryFactory.js';
import {UpdateQueryFactory, UpdateQuery} from './UpdateQuery.js';
import {getQueryDispatch} from './queryDispatch.js';

/**
 * Internal state bag for UpdateBuilder.
 */
interface UpdateBuilderInit<S extends Shape> {
  shape: ShapeConstructor<S>;
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
export class UpdateBuilder<S extends Shape = Shape, U extends UpdatePartial<S> = UpdatePartial<S>>
  implements PromiseLike<AddId<U>>, Promise<AddId<U>>
{
  private readonly _shape: ShapeConstructor<S>;
  private readonly _data?: UpdatePartial<S>;
  private readonly _targetId?: string;

  private constructor(init: UpdateBuilderInit<S>) {
    this._shape = init.shape;
    this._data = init.data;
    this._targetId = init.targetId;
  }

  private clone(overrides: Partial<UpdateBuilderInit<S>> = {}): UpdateBuilder<S, any> {
    return new UpdateBuilder<S, any>({
      shape: this._shape,
      data: this._data,
      targetId: this._targetId,
      ...overrides,
    });
  }

  // ---------------------------------------------------------------------------
  // Static constructors
  // ---------------------------------------------------------------------------

  static from<S extends Shape>(shape: ShapeConstructor<S> | string): UpdateBuilder<S> {
    const resolved = resolveShape<S>(shape);
    return new UpdateBuilder<S>({shape: resolved});
  }

  // ---------------------------------------------------------------------------
  // Fluent API
  // ---------------------------------------------------------------------------

  /** Target a specific entity by ID. Required before build/exec. */
  for(id: string | NodeReferenceValue): UpdateBuilder<S, U> {
    const resolvedId = typeof id === 'string' ? id : id.id;
    return this.clone({targetId: resolvedId}) as unknown as UpdateBuilder<S, U>;
  }

  /** Set the update data. */
  set<NewU extends UpdatePartial<S>>(data: NewU): UpdateBuilder<S, NewU> {
    return this.clone({data}) as unknown as UpdateBuilder<S, NewU>;
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
      this._shape,
      this._targetId,
      this._data,
    );
    return factory.build();
  }

  /** Execute the mutation. */
  exec(): Promise<AddId<U>> {
    return getQueryDispatch().updateQuery(this.build()) as Promise<AddId<U>>;
  }

  // ---------------------------------------------------------------------------
  // Promise interface
  // ---------------------------------------------------------------------------

  then<TResult1 = AddId<U>, TResult2 = never>(
    onfulfilled?: ((value: AddId<U>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
  ): Promise<AddId<U> | TResult> {
    return this.then().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<AddId<U>> {
    return this.then().finally(onfinally);
  }

  get [Symbol.toStringTag](): string {
    return 'UpdateBuilder';
  }
}
