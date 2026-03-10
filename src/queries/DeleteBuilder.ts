import {Shape, ShapeConstructor} from '../shapes/Shape.js';
import {resolveShape} from './resolveShape.js';
import {DeleteQueryFactory, DeleteQuery, DeleteResponse} from './DeleteQuery.js';
import {NodeId} from './MutationQuery.js';
import {getQueryDispatch} from './queryDispatch.js';

/**
 * Internal state bag for DeleteBuilder.
 */
interface DeleteBuilderInit<S extends Shape> {
  shape: ShapeConstructor<S>;
  ids?: NodeId[];
}

/**
 * An immutable, fluent builder for delete mutations.
 *
 * Implements PromiseLike so mutations execute on `await`:
 * ```ts
 * const result = await DeleteBuilder.from(Person).for({id: '...'});
 * ```
 *
 * Internally delegates to DeleteQueryFactory for IR generation.
 */
export class DeleteBuilder<S extends Shape = Shape>
  implements PromiseLike<DeleteResponse>, Promise<DeleteResponse>
{
  private readonly _shape: ShapeConstructor<S>;
  private readonly _ids?: NodeId[];

  private constructor(init: DeleteBuilderInit<S>) {
    this._shape = init.shape;
    this._ids = init.ids;
  }

  private clone(overrides: Partial<DeleteBuilderInit<S>> = {}): DeleteBuilder<S> {
    return new DeleteBuilder<S>({
      shape: this._shape,
      ids: this._ids,
      ...overrides,
    });
  }

  // ---------------------------------------------------------------------------
  // Static constructors
  // ---------------------------------------------------------------------------

  /**
   * Create a DeleteBuilder for the given shape.
   *
   * Optionally accepts IDs inline for backwards compatibility:
   * ```ts
   * DeleteBuilder.from(Person).for({id: '...'})       // preferred
   * DeleteBuilder.from(Person, {id: '...'})            // also supported
   * ```
   */
  static from<S extends Shape>(
    shape: ShapeConstructor<S> | string,
    ids?: NodeId | NodeId[],
  ): DeleteBuilder<S> {
    const resolved = resolveShape<S>(shape);
    if (ids !== undefined) {
      const idsArray = Array.isArray(ids) ? ids : [ids];
      return new DeleteBuilder<S>({shape: resolved, ids: idsArray});
    }
    return new DeleteBuilder<S>({shape: resolved});
  }

  // ---------------------------------------------------------------------------
  // Fluent API
  // ---------------------------------------------------------------------------

  /** Specify the target IDs to delete. */
  for(ids: NodeId | NodeId[]): DeleteBuilder<S> {
    const idsArray = Array.isArray(ids) ? ids : [ids];
    return this.clone({ids: idsArray});
  }

  // ---------------------------------------------------------------------------
  // Build & execute
  // ---------------------------------------------------------------------------

  /** Build the IR mutation. Throws if no IDs were specified via .for(). */
  build(): DeleteQuery {
    if (!this._ids || this._ids.length === 0) {
      throw new Error(
        'DeleteBuilder requires at least one ID to delete. Specify targets with .for(ids).',
      );
    }
    const factory = new DeleteQueryFactory<S, {}>(
      this._shape,
      this._ids,
    );
    return factory.build();
  }

  /** Execute the mutation. */
  exec(): Promise<DeleteResponse> {
    return getQueryDispatch().deleteQuery(this.build());
  }

  // ---------------------------------------------------------------------------
  // Promise interface
  // ---------------------------------------------------------------------------

  then<TResult1 = DeleteResponse, TResult2 = never>(
    onfulfilled?: ((value: DeleteResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
  ): Promise<DeleteResponse | TResult> {
    return this.then().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<DeleteResponse> {
    return this.then().finally(onfinally);
  }

  get [Symbol.toStringTag](): string {
    return 'DeleteBuilder';
  }
}
