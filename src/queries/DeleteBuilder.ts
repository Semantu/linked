import {Shape, ShapeType} from '../shapes/Shape.js';
import {getShapeClass} from '../utils/ShapeClass.js';
import {NodeReferenceValue} from './QueryFactory.js';
import {DeleteQueryFactory, DeleteQuery, DeleteResponse} from './DeleteQuery.js';
import {NodeId} from './MutationQuery.js';
import {getQueryDispatch} from './queryDispatch.js';

/**
 * Internal state bag for DeleteBuilder.
 */
interface DeleteBuilderInit<S extends Shape> {
  shape: ShapeType<S>;
  ids: NodeId[];
}

/**
 * An immutable, fluent builder for delete mutations.
 *
 * Implements PromiseLike so mutations execute on `await`:
 * ```ts
 * const result = await DeleteBuilder.from(Person, {id: '...'});
 * ```
 *
 * Internally delegates to DeleteQueryFactory for IR generation.
 */
export class DeleteBuilder<S extends Shape = Shape>
  implements PromiseLike<DeleteResponse>, Promise<DeleteResponse>
{
  private readonly _shape: ShapeType<S>;
  private readonly _ids: NodeId[];

  private constructor(init: DeleteBuilderInit<S>) {
    this._shape = init.shape;
    this._ids = init.ids;
  }

  // ---------------------------------------------------------------------------
  // Static constructors
  // ---------------------------------------------------------------------------

  /**
   * Create a DeleteBuilder for the given shape and target IDs.
   */
  static from<S extends Shape>(
    shape: ShapeType<S> | string,
    ids: NodeId | NodeId[],
  ): DeleteBuilder<S> {
    const resolved = DeleteBuilder.resolveShape<S>(shape);
    const idsArray = Array.isArray(ids) ? ids : [ids];
    return new DeleteBuilder<S>({shape: resolved, ids: idsArray});
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
  // Build & execute
  // ---------------------------------------------------------------------------

  /** Build the IR mutation. */
  build(): DeleteQuery {
    const factory = new DeleteQueryFactory<S, {}>(
      this._shape as any as typeof Shape,
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
    return this.exec().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<DeleteResponse> {
    return this.exec().finally(onfinally);
  }

  get [Symbol.toStringTag](): string {
    return 'DeleteBuilder';
  }
}
