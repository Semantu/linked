import {Shape, ShapeConstructor} from '../shapes/Shape.js';
import {resolveShape} from './resolveShape.js';
import {AddId, UpdatePartial, NodeReferenceValue} from './QueryFactory.js';
import {UpdateQueryFactory, UpdateQuery} from './UpdateQuery.js';
import {getQueryDispatch} from './queryDispatch.js';
import {WhereClause, processWhereClause} from './SelectQuery.js';
import {buildCanonicalUpdateWhereMutationIR} from './IRMutation.js';
import {toWhere} from './IRDesugar.js';
import {canonicalizeWhere} from './IRCanonicalize.js';
import {lowerWhereToIR} from './IRLower.js';

type UpdateMode = 'for' | 'forAll' | 'where';

/**
 * Internal state bag for UpdateBuilder.
 */
interface UpdateBuilderInit<S extends Shape> {
  shape: ShapeConstructor<S>;
  data?: UpdatePartial<S>;
  targetId?: string;
  mode?: UpdateMode;
  whereFn?: WhereClause<S>;
}

/**
 * An immutable, fluent builder for update mutations.
 *
 * Every mutation method returns a new UpdateBuilder — the original is never modified.
 *
 * Implements PromiseLike so mutations execute on `await`:
 * ```ts
 * const result = await UpdateBuilder.from(Person).for({id: '...'}).set({name: 'Bob'});
 * await UpdateBuilder.from(Person).set({hobby: 'x'}).forAll();  // returns void
 * ```
 *
 * R is the resolved type: AddId<U> for ID-based, void for bulk operations.
 */
export class UpdateBuilder<S extends Shape = Shape, U extends UpdatePartial<S> = UpdatePartial<S>, R = AddId<U>>
  implements PromiseLike<R>, Promise<R>
{
  private readonly _shape: ShapeConstructor<S>;
  private readonly _data?: UpdatePartial<S>;
  private readonly _targetId?: string;
  private readonly _mode?: UpdateMode;
  private readonly _whereFn?: WhereClause<S>;

  private constructor(init: UpdateBuilderInit<S>) {
    this._shape = init.shape;
    this._data = init.data;
    this._targetId = init.targetId;
    this._mode = init.mode;
    this._whereFn = init.whereFn;
  }

  private clone(overrides: Partial<UpdateBuilderInit<S>> = {}): UpdateBuilder<S, any, any> {
    return new UpdateBuilder<S, any>({
      shape: this._shape,
      data: this._data,
      targetId: this._targetId,
      mode: this._mode,
      whereFn: this._whereFn,
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

  /** Target a specific entity by ID. */
  for(id: string | NodeReferenceValue): UpdateBuilder<S, U, AddId<U>> {
    const resolvedId = typeof id === 'string' ? id : id.id;
    return this.clone({targetId: resolvedId, mode: 'for'}) as unknown as UpdateBuilder<S, U, AddId<U>>;
  }

  /** Update all instances of this shape type. Returns void. */
  forAll(): UpdateBuilder<S, U, void> {
    return this.clone({mode: 'forAll', targetId: undefined, whereFn: undefined}) as unknown as UpdateBuilder<S, U, void>;
  }

  /** Update instances matching a condition. Returns void. */
  where(fn: WhereClause<S>): UpdateBuilder<S, U, void> {
    return this.clone({mode: 'where', whereFn: fn, targetId: undefined}) as unknown as UpdateBuilder<S, U, void>;
  }

  /** Set the update data. */
  set<NewU extends UpdatePartial<S>>(data: NewU): UpdateBuilder<S, NewU, R> {
    return this.clone({data}) as unknown as UpdateBuilder<S, NewU, R>;
  }

  // ---------------------------------------------------------------------------
  // Build & execute
  // ---------------------------------------------------------------------------

  /** Build the IR mutation. */
  build(): UpdateQuery {
    if (!this._data) {
      throw new Error(
        'UpdateBuilder requires .set(data) before .build(). Specify what to update.',
      );
    }

    const mode = this._mode || (this._targetId ? 'for' : undefined);

    if (mode === 'forAll') {
      return this.buildUpdateWhere();
    }

    if (mode === 'where') {
      if (!this._whereFn) {
        throw new Error(
          'UpdateBuilder.where() requires a condition callback.',
        );
      }
      return this.buildUpdateWhere();
    }

    // Default: ID-based update
    if (!this._targetId) {
      throw new Error(
        'UpdateBuilder requires .for(id), .forAll(), or .where() before .build().',
      );
    }
    const factory = new UpdateQueryFactory<S, UpdatePartial<S>>(
      this._shape,
      this._targetId,
      this._data,
    );
    return factory.build();
  }

  private buildUpdateWhere(): UpdateQuery {
    const factory = new UpdateQueryFactory<S, UpdatePartial<S>>(
      this._shape,
      '__placeholder__', // not used for where/forAll
      this._data!,
    );
    const description = factory.fields;

    let where;
    let wherePatterns;

    if (this._whereFn) {
      const wherePath = processWhereClause(this._whereFn, this._shape);
      const desugared = toWhere(wherePath);
      const canonical = canonicalizeWhere(desugared);
      const lowered = lowerWhereToIR(canonical);
      where = lowered.where;
      wherePatterns = lowered.wherePatterns;
    }

    return buildCanonicalUpdateWhereMutationIR({
      shape: this._shape.shape,
      updates: description,
      where,
      wherePatterns,
    });
  }

  /** Execute the mutation. */
  exec(): Promise<R> {
    const mode = this._mode || (this._targetId ? 'for' : undefined);
    if (mode === 'forAll' || mode === 'where') {
      return getQueryDispatch().updateQuery(this.build()).then(() => undefined) as Promise<R>;
    }
    return getQueryDispatch().updateQuery(this.build()) as Promise<R>;
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
    return 'UpdateBuilder';
  }
}
