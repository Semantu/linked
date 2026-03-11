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
  private readonly _mode?: DeleteMode;
  private readonly _whereFn?: WhereClause<S>;

  private constructor(init: DeleteBuilderInit<S>) {
    this._shape = init.shape;
    this._ids = init.ids;
    this._mode = init.mode;
    this._whereFn = init.whereFn;
  }

  private clone(overrides: Partial<DeleteBuilderInit<S>> = {}): DeleteBuilder<S> {
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
  ): DeleteBuilder<S> {
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

  /** Specify the target IDs to delete. */
  for(ids: NodeId | NodeId[]): DeleteBuilder<S> {
    const idsArray = Array.isArray(ids) ? ids : [ids];
    return this.clone({ids: idsArray, mode: 'ids'});
  }

  /** Delete all instances of this shape type. */
  all(): DeleteBuilder<S> {
    return this.clone({mode: 'all', ids: undefined, whereFn: undefined});
  }

  /** Delete instances matching a condition. */
  where(fn: WhereClause<S>): DeleteBuilder<S> {
    return this.clone({mode: 'where', whereFn: fn, ids: undefined});
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
        'DeleteBuilder requires at least one ID to delete. Specify targets with .for(ids), .all(), or .where().',
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
