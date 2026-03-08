import {Shape, ShapeType} from '../shapes/Shape.js';
import {getShapeClass} from '../utils/ShapeClass.js';
import {
  SelectQueryFactory,
  SelectQuery,
  QueryBuildFn,
  WhereClause,
  QResult,
  QueryResponseToResultType,
  SelectAllQueryResponse,
  QueryComponentLike,
} from './SelectQuery.js';
import type {SelectPath} from './SelectQuery.js';
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
  subjects?: string[];
  singleResult?: boolean;
  orderDirection?: 'ASC' | 'DESC';
};

/** A preload entry binding a property path to a component's query. */
interface PreloadEntry {
  path: string;
  component: QueryComponentLike<any, any>;
}

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
  subjects?: NodeReferenceValue[];
  singleResult?: boolean;
  selectAllLabels?: string[];
  fieldSet?: FieldSet;
  preloads?: PreloadEntry[];
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
  private readonly _subjects?: NodeReferenceValue[];
  private readonly _singleResult?: boolean;
  private readonly _selectAllLabels?: string[];
  private readonly _fieldSet?: FieldSet;
  private readonly _preloads?: PreloadEntry[];

  private constructor(init: QueryBuilderInit<S, R>) {
    this._shape = init.shape;
    this._selectFn = init.selectFn;
    this._whereFn = init.whereFn;
    this._sortByFn = init.sortByFn;
    this._sortDirection = init.sortDirection;
    this._limit = init.limit;
    this._offset = init.offset;
    this._subject = init.subject;
    this._subjects = init.subjects;
    this._singleResult = init.singleResult;
    this._selectAllLabels = init.selectAllLabels;
    this._fieldSet = init.fieldSet;
    this._preloads = init.preloads;
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
      subjects: this._subjects,
      singleResult: this._singleResult,
      selectAllLabels: this._selectAllLabels,
      fieldSet: this._fieldSet,
      preloads: this._preloads,
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
  select<NewR>(fn: QueryBuildFn<S, NewR>): QueryBuilder<S, NewR, QueryResponseToResultType<NewR, S>[]>;
  select(labels: string[]): QueryBuilder<S>;
  select<NewR>(fieldSet: FieldSet<NewR>): QueryBuilder<S, NewR, QueryResponseToResultType<NewR, S>[]>;
  select<NewR = R>(fnOrLabelsOrFieldSet: QueryBuildFn<S, NewR> | string[] | FieldSet<any>): QueryBuilder<S, NewR, any> {
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
  selectAll(): QueryBuilder<S, any, QueryResponseToResultType<SelectAllQueryResponse<S>, S>[]> {
    const propertyLabels = (this._shape as any)
      .shape.getUniquePropertyShapes()
      .map((ps: any) => ps.label) as string[];
    const selectFn = ((p: any) =>
      propertyLabels.map((label) => p[label])) as unknown as QueryBuildFn<S, any>;
    return this.clone({selectFn, selectAllLabels: propertyLabels});
  }

  /** Add a where clause. */
  where(fn: WhereClause<S>): QueryBuilder<S, R, Result> {
    return this.clone({whereFn: fn}) as unknown as QueryBuilder<S, R, Result>;
  }

  /** Set sort order. */
  orderBy<OR>(fn: QueryBuildFn<S, OR>, direction: 'ASC' | 'DESC' = 'ASC'): QueryBuilder<S, R, Result> {
    return this.clone({sortByFn: fn as any, sortDirection: direction}) as unknown as QueryBuilder<S, R, Result>;
  }

  /**
   * Alias for orderBy — matches the existing DSL's `sortBy` method name.
   */
  sortBy<OR>(fn: QueryBuildFn<S, OR>, direction: 'ASC' | 'DESC' = 'ASC'): QueryBuilder<S, R, Result> {
    return this.orderBy(fn, direction);
  }

  /** Set result limit. */
  limit(n: number): QueryBuilder<S, R, Result> {
    return this.clone({limit: n}) as unknown as QueryBuilder<S, R, Result>;
  }

  /** Set result offset. */
  offset(n: number): QueryBuilder<S, R, Result> {
    return this.clone({offset: n}) as unknown as QueryBuilder<S, R, Result>;
  }

  /** Target a single entity by ID. Implies singleResult. */
  for(id: string | NodeReferenceValue): QueryBuilder<S, R, Result> {
    const subject = typeof id === 'string' ? {id} : id;
    return this.clone({subject, subjects: undefined, singleResult: true}) as unknown as QueryBuilder<S, R, Result>;
  }

  /** Target multiple entities by ID, or all if no ids given. */
  forAll(ids?: (string | NodeReferenceValue)[]): QueryBuilder<S, R, Result> {
    if (!ids) {
      return this.clone({subject: undefined, subjects: undefined, singleResult: false}) as unknown as QueryBuilder<S, R, Result>;
    }
    const subjects = ids.map((id) => (typeof id === 'string' ? {id} : id));
    return this.clone({subject: undefined, subjects, singleResult: false}) as unknown as QueryBuilder<S, R, Result>;
  }

  /** Limit to one result. Unwraps array Result type to single element. */
  one(): QueryBuilder<S, R, Result extends (infer E)[] ? E : Result> {
    return this.clone({limit: 1, singleResult: true}) as unknown as QueryBuilder<S, R, Result extends (infer E)[] ? E : Result>;
  }

  /**
   * Preload a component's query fields at the given property path.
   *
   * This merges the component's query paths into this query's selection,
   * wrapping them in an OPTIONAL block (handled by the IR pipeline).
   *
   * Equivalent to the DSL's `.preloadFor()`:
   * ```ts
   * // DSL style
   * Person.select(p => p.bestFriend.preloadFor(PersonCard))
   * // QueryBuilder style
   * QueryBuilder.from(Person).select(p => [p.name]).preload('bestFriend', PersonCard)
   * ```
   *
   * NOTE: Preloads hold live component references and are not serializable.
   * They are injected into the selectFn at build time (see buildFactory()),
   * so changes to preload handling must account for the selectFn wrapping logic.
   */
  preload<CS extends Shape, CR>(
    path: string,
    component: QueryComponentLike<CS, CR>,
  ): QueryBuilder<S, R, Result> {
    const newPreloads = [...(this._preloads || []), {path, component}];
    return this.clone({preloads: newPreloads}) as unknown as QueryBuilder<S, R, Result>;
  }

  /**
   * Returns the current selection as a FieldSet.
   * If the selection was set via a FieldSet, returns that directly.
   * If set via selectAll labels, constructs a FieldSet from them.
   * If set via a callback, eagerly evaluates it through the proxy to produce a FieldSet.
   */
  fields(): FieldSet | undefined {
    if (this._fieldSet) {
      return this._fieldSet;
    }
    if (this._selectAllLabels) {
      return FieldSet.for((this._shape as any).shape, this._selectAllLabels);
    }
    if (this._selectFn) {
      // Eagerly evaluate the callback through FieldSet.for(ShapeClass, callback)
      // The callback is pure — same proxy always produces same paths.
      return FieldSet.for(this._shape, this._selectFn as unknown as (p: any) => any[]);
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /**
   * Serialize this QueryBuilder to a plain JSON object.
   *
   * Selections are serializable regardless of how they were set (FieldSet,
   * string[], selectAll, or callback). Callback-based selections are eagerly
   * evaluated through the proxy to produce a FieldSet.
   *
   * The `where` and `orderBy` callbacks are not serialized (only the direction
   * is preserved for orderBy).
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
    if (this._subjects && this._subjects.length > 0) {
      json.subjects = this._subjects.map((s) => s.id);
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
    if (json.subjects && json.subjects.length > 0) {
      builder = builder.forAll(json.subjects) as QueryBuilder<S>;
    }
    if (json.singleResult && !json.subject) {
      builder = builder.one() as QueryBuilder<S>;
    }
    // Restore orderDirection. The sort key callback isn't serializable,
    // so we only store the direction. When a sort key is later re-applied
    // via .orderBy(), the direction will be available.
    if (json.orderDirection) {
      // Access private clone() — safe because fromJSON is in the same class.
      builder = (builder as any).clone({sortDirection: json.orderDirection}) as QueryBuilder<S>;
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
    // If preloads exist, wrap the selectFn to include preloadFor calls
    let selectFn = this._selectFn;
    if (this._preloads && this._preloads.length > 0) {
      const originalFn = selectFn;
      const preloads = this._preloads;
      selectFn = ((p: any, q: any) => {
        const original = originalFn ? originalFn(p, q) : [];
        const results = Array.isArray(original) ? [...original] : [original];
        for (const entry of preloads) {
          results.push(p[entry.path].preloadFor(entry.component));
        }
        return results;
      }) as any;
    }

    const factory = new SelectQueryFactory<S, R>(
      this._shape,
      selectFn,
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

  /**
   * Get the select paths for this query.
   * Used by BoundComponent to merge component query paths into a parent query.
   */
  getQueryPaths(): SelectPath {
    return this.buildFactory().getQueryPaths();
  }

  /** Get the raw pipeline input (same as SelectQueryFactory.toRawInput()). */
  toRawInput(): RawSelectInput {
    const raw = this.buildFactory().toRawInput();
    if (this._subjects && this._subjects.length > 0) {
      raw.subjects = this._subjects;
    }
    return raw;
  }

  /** Build the IR (run the full pipeline: desugar → canonicalize → lower). */
  build(): SelectQuery {
    return buildSelectQuery(this.toRawInput());
  }

  /** Execute the query and return results. */
  exec(): Promise<Result> {
    return getQueryDispatch().selectQuery(this.build()) as Promise<Result>;
  }

  // ---------------------------------------------------------------------------
  // Promise-compatible interface
  // ---------------------------------------------------------------------------

  /** `await` triggers execution. */
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  /** Catch errors from execution. */
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
  ): Promise<Result | TResult> {
    return this.exec().catch(onrejected);
  }

  /** Finally handler after execution. */
  finally(onfinally?: (() => void) | null): Promise<Result> {
    return this.exec().finally(onfinally);
  }

  get [Symbol.toStringTag](): string {
    return 'QueryBuilder';
  }
}
