import {Shape, ShapeConstructor} from '../shapes/Shape.js';
import {resolveShape} from './resolveShape.js';
import {DeleteQueryFactory, DeleteQuery, DeleteResponse} from './DeleteQuery.js';
import {NodeId} from './MutationQuery.js';
import {getQueryDispatch} from './queryDispatch.js';
import {WhereClause, processWhereClause} from './SelectQuery.js';
import {
  buildCanonicalDeleteAllMutationIR,
  buildCanonicalDeleteWhereMutationIR,
} from './IRMutation.js';
import {toWhere} from './IRDesugar.js';
import {canonicalizeWhere} from './IRCanonicalize.js';
import {lowerWhereToIR} from './IRLower.js';

type DeleteMode = 'ids' | 'all' | 'where';

/**
 * Internal state bag for DeleteBuilder.
 */
interface DeleteBuilderInit<S extends Shape> {
  shape: ShapeConstructor<S>;
  ids?: NodeId[];
  mode?: DeleteMode;
  whereFn?: WhereClause<S>;
}

/**
 * An immutable, fluent builder for delete mutations.
 *
 * Implements PromiseLike so mutations execute on `await`:
 * ```ts
 * const result = await DeleteBuilder.from(Person, {id: '...'});
 * await DeleteBuilder.from(Person).all();  // returns void
 * ```
 *
 * R is the resolved type: DeleteResponse for ID-based, void for bulk operations.
 */
export class DeleteBuilder<S extends Shape = Shape, R = DeleteResponse>
  implements PromiseLike<R>, Promise<R>
{
  private readonly _shape: ShapeConstructor<S>;
  private readonly _ids?: NodeId[];
  private readonly _mode?: DeleteMode;
  private readonly _whereFn?: WhereClause<S>;

  private constructor(init: DeleteBuilderInit<S>) {
    this._shape = init.shape;
    this._ids = init.ids;
    this._mode = init.mode;
    this._whereFn = init.whereFn;
  }

  private clone(overrides: Partial<DeleteBuilderInit<S>> = {}): DeleteBuilder<S, any> {
    return new DeleteBuilder<S>({
      shape: this._shape,
      ids: this._ids,
      mode: this._mode,
      whereFn: this._whereFn,
      ...overrides,
    });
  }

  // ---------------------------------------------------------------------------
  // Static constructors
  // ---------------------------------------------------------------------------

  static from<S extends Shape>(
    shape: ShapeConstructor<S> | string,
    ids?: NodeId | NodeId[],
  ): DeleteBuilder<S, DeleteResponse> {
    const resolved = resolveShape<S>(shape);
    if (ids !== undefined) {
      const idsArray = Array.isArray(ids) ? ids : [ids];
      return new DeleteBuilder<S>({shape: resolved, ids: idsArray, mode: 'ids'});
    }
    return new DeleteBuilder<S>({shape: resolved});
  }

  // ---------------------------------------------------------------------------
  // Fluent API
  // ---------------------------------------------------------------------------

  /** Delete all instances of this shape type. Returns void. */
  all(): DeleteBuilder<S, void> {
    return this.clone({mode: 'all', ids: undefined, whereFn: undefined}) as DeleteBuilder<S, void>;
  }

  /** Delete instances matching a condition. Returns void. */
  where(fn: WhereClause<S>): DeleteBuilder<S, void> {
    return this.clone({mode: 'where', whereFn: fn, ids: undefined}) as DeleteBuilder<S, void>;
  }

  // ---------------------------------------------------------------------------
  // Build & execute
  // ---------------------------------------------------------------------------

  /** Build the IR mutation. */
  build(): DeleteQuery {
    const mode = this._mode || (this._ids ? 'ids' : undefined);

    if (mode === 'all') {
      return buildCanonicalDeleteAllMutationIR({
        shape: this._shape.shape,
      });
    }

    if (mode === 'where') {
      if (!this._whereFn) {
        throw new Error(
          'DeleteBuilder.where() requires a condition callback.',
        );
      }
      const wherePath = processWhereClause(this._whereFn, this._shape);
      const desugared = toWhere(wherePath);
      const canonical = canonicalizeWhere(desugared);
      const {where, wherePatterns} = lowerWhereToIR(canonical);
      return buildCanonicalDeleteWhereMutationIR({
        shape: this._shape.shape,
        where,
        wherePatterns,
      });
    }

    // Default: ID-based delete
    if (!this._ids || this._ids.length === 0) {
      throw new Error(
        'DeleteBuilder requires at least one ID to delete. Use DeleteBuilder.from(shape, ids), .all(), or .where().',
      );
    }
    const factory = new DeleteQueryFactory<S, {}>(
      this._shape,
      this._ids,
    );
    return factory.build();
  }

  /** Execute the mutation. */
  exec(): Promise<R> {
    const mode = this._mode || (this._ids ? 'ids' : undefined);
    if (mode === 'all' || mode === 'where') {
      return getQueryDispatch().deleteQuery(this.build()).then(() => undefined) as Promise<R>;
    }
    return getQueryDispatch().deleteQuery(this.build()) as Promise<R>;
  }

  // ---------------------------------------------------------------------------
  // Promise interface
  // ---------------------------------------------------------------------------

  then<TResult1 = R, TResult2 = never>(
    onfulfilled?: ((value: R) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
  ): Promise<R | TResult> {
    return this.then().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<R> {
    return this.then().finally(onfinally);
  }

  get [Symbol.toStringTag](): string {
    return 'DeleteBuilder';
  }
}
