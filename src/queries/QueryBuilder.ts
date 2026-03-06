import {Shape, ShapeType} from '../shapes/Shape.js';
import {getShapeClass} from '../utils/ShapeClass.js';
import {
  SelectQueryFactory,
  SelectQuery,
  QueryBuildFn,
  WhereClause,
  QResult,
} from './SelectQuery.js';
import type {RawSelectInput} from './IRDesugar.js';
import {buildSelectQuery} from './IRPipeline.js';
import {getQueryDispatch} from './queryDispatch.js';
import type {NodeReferenceValue} from './QueryFactory.js';
import {FieldSet, FieldSetJSON, FieldSetFieldJSON} from './FieldSet.js';

/** JSON representation of a QueryBuilder. */
export type QueryBuilderJSON = {
  shape: string;
  fields?: FieldSetFieldJSON[];
  limit?: number;
  offset?: number;
  subject?: string;
  singleResult?: boolean;
  orderDirection?: 'ASC' | 'DESC';
};

/** Internal state bag for QueryBuilder. */
interface QueryBuilderInit<S extends Shape, R> {
  shape: ShapeType<S>;
  selectFn?: QueryBuildFn<S, R>;
  whereFn?: WhereClause<S>;
  sortByFn?: QueryBuildFn<S, any>;
  sortDirection?: string;
  limit?: number;
  offset?: number;
  subject?: S | QResult<S> | NodeReferenceValue;
  singleResult?: boolean;
  selectAllLabels?: string[];
  fieldSet?: FieldSet;
}

/**
 * An immutable, fluent query builder for select queries.
 *
 * Every mutation method (`.select()`, `.where()`, `.limit()`, etc.) returns
 * a **new** QueryBuilder instance — the original is never modified.
 *
 * Implements `PromiseLike` so queries execute on `await`:
 * ```ts
 * const results = await QueryBuilder.from(Person).select(p => p.name);
 * ```
 *
 * Internally delegates to SelectQueryFactory for IR generation,
 * guaranteeing identical output to the existing DSL.
 *
 * @internal The internal delegation to SelectQueryFactory is an implementation
 * detail that will be removed in a future phase.
 */
export class QueryBuilder<S extends Shape = Shape, R = any, Result = any>
  implements PromiseLike<Result>, Promise<Result>
{
  private readonly _shape: ShapeType<S>;
  private readonly _selectFn?: QueryBuildFn<S, R>;
  private readonly _whereFn?: WhereClause<S>;
  private readonly _sortByFn?: QueryBuildFn<S, any>;
  private readonly _sortDirection?: string;
  private readonly _limit?: number;
  private readonly _offset?: number;
  private readonly _subject?: S | QResult<S> | NodeReferenceValue;
  private readonly _singleResult?: boolean;
  private readonly _selectAllLabels?: string[];
  private readonly _fieldSet?: FieldSet;

  private constructor(init: QueryBuilderInit<S, R>) {
    this._shape = init.shape;
    this._selectFn = init.selectFn;
    this._whereFn = init.whereFn;
    this._sortByFn = init.sortByFn;
    this._sortDirection = init.sortDirection;
    this._limit = init.limit;
    this._offset = init.offset;
    this._subject = init.subject;
    this._singleResult = init.singleResult;
    this._selectAllLabels = init.selectAllLabels;
    this._fieldSet = init.fieldSet;
  }

  /** Create a shallow clone with overrides. */
  private clone(overrides: Partial<QueryBuilderInit<S, any>> = {}): QueryBuilder<S, any> {
    return new QueryBuilder<S, any>({
      shape: this._shape,
      selectFn: this._selectFn as any,
      whereFn: this._whereFn,
      sortByFn: this._sortByFn,
      sortDirection: this._sortDirection,
      limit: this._limit,
      offset: this._offset,
      subject: this._subject,
      singleResult: this._singleResult,
      selectAllLabels: this._selectAllLabels,
      fieldSet: this._fieldSet,
      ...overrides,
    });
  }

  // ---------------------------------------------------------------------------
  // Static constructors
  // ---------------------------------------------------------------------------

  /**
   * Create a QueryBuilder for the given shape.
   *
   * Accepts a shape class (e.g. `Person`), a NodeShape instance,
   * or a shape IRI string (resolved via the shape registry).
   */
  static from<S extends Shape>(
    shape: ShapeType<S> | string,
  ): QueryBuilder<S> {
    const resolved = QueryBuilder.resolveShape<S>(shape);
    return new QueryBuilder<S>({shape: resolved});
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
  // Fluent API — each returns a new instance
  // ---------------------------------------------------------------------------

  /** Set the select projection via a callback, labels, or FieldSet. */
  select<NewR = R>(fn: QueryBuildFn<S, NewR>): QueryBuilder<S, NewR>;
  select(labels: string[]): QueryBuilder<S>;
  select(fieldSet: FieldSet): QueryBuilder<S>;
  select<NewR = R>(fnOrLabelsOrFieldSet: QueryBuildFn<S, NewR> | string[] | FieldSet): QueryBuilder<S, NewR> {
    if (fnOrLabelsOrFieldSet instanceof FieldSet) {
      const labels = fnOrLabelsOrFieldSet.labels();
      const selectFn = ((p: any) =>
        labels.map((label) => p[label])) as unknown as QueryBuildFn<S, any>;
      return this.clone({selectFn, selectAllLabels: undefined, fieldSet: fnOrLabelsOrFieldSet}) as QueryBuilder<S, NewR>;
    }
    if (Array.isArray(fnOrLabelsOrFieldSet)) {
      const labels = fnOrLabelsOrFieldSet;
      const selectFn = ((p: any) =>
        labels.map((label) => p[label])) as unknown as QueryBuildFn<S, any>;
      return this.clone({selectFn, selectAllLabels: undefined, fieldSet: undefined}) as QueryBuilder<S, NewR>;
    }
    return this.clone({selectFn: fnOrLabelsOrFieldSet as any, selectAllLabels: undefined, fieldSet: undefined}) as QueryBuilder<S, NewR>;
  }

  /** Select all decorated properties of the shape. */
  selectAll(): QueryBuilder<S> {
    const propertyLabels = (this._shape as any)
      .shape.getUniquePropertyShapes()
      .map((ps: any) => ps.label) as string[];
    const selectFn = ((p: any) =>
      propertyLabels.map((label) => p[label])) as unknown as QueryBuildFn<S, any>;
    return this.clone({selectFn, selectAllLabels: propertyLabels});
  }

  /** Add a where clause. */
  where(fn: WhereClause<S>): QueryBuilder<S, R> {
    return this.clone({whereFn: fn});
  }

  /** Set sort order. */
  orderBy<OR>(fn: QueryBuildFn<S, OR>, direction: 'ASC' | 'DESC' = 'ASC'): QueryBuilder<S, R> {
    return this.clone({sortByFn: fn as any, sortDirection: direction});
  }

  /**
   * Alias for orderBy — matches the existing DSL's `sortBy` method name.
   */
  sortBy<OR>(fn: QueryBuildFn<S, OR>, direction: 'ASC' | 'DESC' = 'ASC'): QueryBuilder<S, R> {
    return this.orderBy(fn, direction);
  }

  /** Set result limit. */
  limit(n: number): QueryBuilder<S, R> {
    return this.clone({limit: n});
  }

  /** Set result offset. */
  offset(n: number): QueryBuilder<S, R> {
    return this.clone({offset: n});
  }

  /** Target a single entity by ID. Implies singleResult. */
  for(id: string | NodeReferenceValue): QueryBuilder<S, R> {
    const subject = typeof id === 'string' ? {id} : id;
    return this.clone({subject, singleResult: true});
  }

  /** Target multiple entities (or all if no ids given). */
  forAll(ids?: (string | NodeReferenceValue)[]): QueryBuilder<S, R> {
    if (!ids) {
      return this.clone({subject: undefined, singleResult: false});
    }
    // For multiple IDs we'd need to handle this differently in the future.
    // For now, this is a placeholder that selects without subject filter.
    return this.clone({subject: undefined, singleResult: false});
  }

  /** Limit to one result. */
  one(): QueryBuilder<S, R> {
    return this.clone({limit: 1, singleResult: true});
  }

  /**
   * Returns the current selection as a FieldSet.
   * If the selection was set via a FieldSet, returns that directly.
   * If set via selectAll labels, constructs a FieldSet from them.
   */
  fields(): FieldSet | undefined {
    if (this._fieldSet) {
      return this._fieldSet;
    }
    if (this._selectAllLabels) {
      return FieldSet.for((this._shape as any).shape, this._selectAllLabels);
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /**
   * Serialize this QueryBuilder to a plain JSON object.
   *
   * Only label-based selections (from FieldSet, string[], or selectAll) are
   * serializable. Callback-based selections cannot be serialized and will
   * result in an empty fields array.
   *
   * The `where`, `orderBy`, and other callback-based options are similarly
   * not serializable in the current phase.
   */
  toJSON(): QueryBuilderJSON {
    const shapeId = (this._shape as any).shape?.id || '';
    const json: QueryBuilderJSON = {
      shape: shapeId,
    };

    // Serialize fields from FieldSet or selectAll labels
    const fs = this.fields();
    if (fs) {
      json.fields = fs.toJSON().fields;
    } else if (this._selectAllLabels) {
      json.fields = this._selectAllLabels.map((label) => ({path: label}));
    }

    if (this._limit !== undefined) {
      json.limit = this._limit;
    }
    if (this._offset !== undefined) {
      json.offset = this._offset;
    }
    if (this._subject && typeof this._subject === 'object' && 'id' in this._subject) {
      json.subject = (this._subject as any).id;
    }
    if (this._singleResult) {
      json.singleResult = true;
    }
    if (this._sortDirection) {
      json.orderDirection = this._sortDirection as 'ASC' | 'DESC';
    }

    return json;
  }

  /**
   * Reconstruct a QueryBuilder from a JSON object.
   * Resolves shape IRI via getShapeClass() and field paths as label selections.
   */
  static fromJSON<S extends Shape = Shape>(json: QueryBuilderJSON): QueryBuilder<S> {
    let builder = QueryBuilder.from<S>(json.shape as any);

    if (json.fields && json.fields.length > 0) {
      const fieldSet = FieldSet.fromJSON({
        shape: json.shape,
        fields: json.fields,
      });
      builder = builder.select(fieldSet) as QueryBuilder<S>;
    }

    if (json.limit !== undefined) {
      builder = builder.limit(json.limit) as QueryBuilder<S>;
    }
    if (json.offset !== undefined) {
      builder = builder.offset(json.offset) as QueryBuilder<S>;
    }
    if (json.subject) {
      builder = builder.for(json.subject) as QueryBuilder<S>;
    }
    if (json.singleResult && !json.subject) {
      builder = builder.one() as QueryBuilder<S>;
    }

    return builder;
  }

  // ---------------------------------------------------------------------------
  // Build & execute
  // ---------------------------------------------------------------------------

  /**
   * Build the internal SelectQueryFactory with our immutable state,
   * producing the same RawSelectInput the DSL path produces.
   */
  private buildFactory(): SelectQueryFactory<S, R> {
    const factory = new SelectQueryFactory<S, R>(
      this._shape,
      this._selectFn,
      this._subject as any,
    );

    if (this._whereFn) {
      factory.where(this._whereFn);
    }
    if (this._sortByFn) {
      factory.sortBy(this._sortByFn, this._sortDirection);
    }
    if (this._limit !== undefined) {
      factory.setLimit(this._limit);
    }
    if (this._offset !== undefined) {
      factory.setOffset(this._offset);
    }
    if (this._singleResult) {
      factory.singleResult = true;
    }
    return factory;
  }

  /** Get the raw pipeline input (same as SelectQueryFactory.toRawInput()). */
  toRawInput(): RawSelectInput {
    return this.buildFactory().toRawInput();
  }

  /** Build the IR (run the full pipeline: desugar → canonicalize → lower). */
  build(): SelectQuery {
    return buildSelectQuery(this.toRawInput());
  }

  /** Execute the query and return results. */
  exec(): Promise<any> {
    return getQueryDispatch().selectQuery(this.build());
  }

  // ---------------------------------------------------------------------------
  // Promise-compatible interface
  // ---------------------------------------------------------------------------

  /** `await` triggers execution. */
  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  /** Catch errors from execution. */
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
  ): Promise<any | TResult> {
    return this.exec().catch(onrejected);
  }

  /** Finally handler after execution. */
  finally(onfinally?: (() => void) | null): Promise<any> {
    return this.exec().finally(onfinally);
  }

  get [Symbol.toStringTag](): string {
    return 'QueryBuilder';
  }
}
