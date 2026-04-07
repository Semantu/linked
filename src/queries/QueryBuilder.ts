import {Shape, ShapeConstructor} from '../shapes/Shape.js';
import {resolveShape} from './resolveShape.js';
import {
  SelectQuery,
  QueryBuildFn,
  WhereClause,
  QResult,
  QueryResponseToResultType,
  SelectAllQueryResponse,
  QueryComponentLike,
  processWhereClause,
  evaluateSortCallback,
} from './SelectQuery.js';
import type {SortByPath, WherePath} from './SelectQuery.js';
import type {PropertyPathSegment, RawSelectInput} from './IRDesugar.js';
import {buildSelectQuery} from './IRPipeline.js';
import {getQueryDispatch} from './queryDispatch.js';
import type {NodeReferenceValue} from './QueryFactory.js';
import {resolveUriOrThrow} from '../utils/NodeReference.js';
import {FieldSet, FieldSetJSON, FieldSetFieldJSON} from './FieldSet.js';
import {PendingQueryContext} from './QueryContext.js';
import {createProxiedPathBuilder} from './ProxiedPathBuilder.js';

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

/** A MINUS entry — either a shape type exclusion or a WHERE-clause condition. */
interface MinusEntry<S extends Shape> {
  shapeId?: string;
  whereFn?: WhereClause<S>;
}

/** Internal state bag for QueryBuilder. */
interface QueryBuilderInit<S extends Shape, R> {
  shape: ShapeConstructor<S>;
  selectFn?: QueryBuildFn<S, R>;
  whereFn?: WhereClause<S>;
  sortByFn?: QueryBuildFn<S, any>;
  sortDirection?: 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
  subject?: S | QResult<S> | NodeReferenceValue;
  subjects?: NodeReferenceValue[];
  singleResult?: boolean;
  selectAllLabels?: string[];
  fieldSet?: FieldSet;
  preloads?: PreloadEntry[];
  minusEntries?: MinusEntry<S>[];
  _nullSubject?: boolean;
  _pendingContextName?: string;
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
 * Generates IR directly via FieldSet, guaranteeing identical output to the existing DSL.
 */
export class QueryBuilder<S extends Shape = Shape, R = any, Result = any>
  implements PromiseLike<Result>, Promise<Result>
{
  private readonly _shape: ShapeConstructor<S>;
  private readonly _selectFn?: QueryBuildFn<S, R>;
  private readonly _whereFn?: WhereClause<S>;
  private readonly _sortByFn?: QueryBuildFn<S, any>;
  private readonly _sortDirection?: 'ASC' | 'DESC';
  private readonly _limit?: number;
  private readonly _offset?: number;
  private readonly _subject?: S | QResult<S> | NodeReferenceValue;
  private readonly _subjects?: NodeReferenceValue[];
  private readonly _singleResult?: boolean;
  private readonly _selectAllLabels?: string[];
  private readonly _fieldSet?: FieldSet;
  private readonly _preloads?: PreloadEntry[];
  private readonly _minusEntries?: MinusEntry<S>[];
  private readonly _nullSubject?: boolean;
  private readonly _pendingContextName?: string;

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
    this._minusEntries = init.minusEntries;
    this._nullSubject = init._nullSubject;
    this._pendingContextName = init._pendingContextName;
  }

  /** Create a shallow clone with overrides. */
  private clone<NR = R, NResult = Result>(overrides: Partial<QueryBuilderInit<S, any>> = {}): QueryBuilder<S, NR, NResult> {
    return new QueryBuilder<S, NR, NResult>({
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
      minusEntries: this._minusEntries,
      _nullSubject: this._nullSubject,
      _pendingContextName: this._pendingContextName,
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
    shape: ShapeConstructor<S> | string,
  ): QueryBuilder<S> {
    const resolved = resolveShape<S>(shape);
    return new QueryBuilder<S>({shape: resolved});
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
      return this.clone<NewR, any>({selectFn, selectAllLabels: undefined, fieldSet: fnOrLabelsOrFieldSet});
    }
    if (Array.isArray(fnOrLabelsOrFieldSet)) {
      const labels = fnOrLabelsOrFieldSet;
      const selectFn = ((p: any) =>
        labels.map((label) => p[label])) as unknown as QueryBuildFn<S, any>;
      return this.clone<NewR, any>({selectFn, selectAllLabels: undefined, fieldSet: undefined});
    }
    return this.clone<NewR, any>({selectFn: fnOrLabelsOrFieldSet as any, selectAllLabels: undefined, fieldSet: undefined});
  }

  /** Select all decorated properties of the shape. */
  selectAll(): QueryBuilder<S, any, QueryResponseToResultType<SelectAllQueryResponse<S>, S>[]> {
    const propertyLabels = this._shape.shape
      .getUniquePropertyShapes()
      .map((ps) => ps.label);
    const selectFn = ((p: any) =>
      propertyLabels.map((label) => p[label])) as unknown as QueryBuildFn<S, any>;
    return this.clone({selectFn, selectAllLabels: propertyLabels});
  }

  /** Add a where clause. */
  where(fn: WhereClause<S>): QueryBuilder<S, R, Result> {
    return this.clone({whereFn: fn});
  }

  /**
   * Exclude results matching a MINUS pattern.
   *
   * Accepts:
   * - A shape constructor to exclude by type: `.minus(Employee)`
   * - A WHERE callback to exclude by condition: `.minus(p => p.hobby.equals('Chess'))`
   * - A callback returning a property or array of properties for existence exclusion:
   *   `.minus(p => p.hobby)` or `.minus(p => [p.hobby, p.bestFriend.name])`
   *
   * Chainable: `.minus(A).minus(B)` produces two separate `MINUS { }` blocks.
   */
  minus(shapeOrFn: ShapeConstructor<any> | WhereClause<S> | ((s: any) => any)): QueryBuilder<S, R, Result> {
    const entry: MinusEntry<S> = {};
    if (typeof shapeOrFn === 'function' && 'shape' in shapeOrFn) {
      // ShapeConstructor — has a static .shape property
      entry.shapeId = (shapeOrFn as ShapeConstructor<any>).shape?.id;
    } else {
      // WhereClause callback
      entry.whereFn = shapeOrFn as WhereClause<S>;
    }
    const existing = this._minusEntries || [];
    return this.clone({minusEntries: [...existing, entry]});
  }

  /** Set sort order. */
  orderBy<OR>(fn: QueryBuildFn<S, OR>, direction: 'ASC' | 'DESC' = 'ASC'): QueryBuilder<S, R, Result> {
    return this.clone({sortByFn: fn as any, sortDirection: direction});
  }

  /**
   * @deprecated Use `orderBy()` instead.
   */
  sortBy<OR>(fn: QueryBuildFn<S, OR>, direction: 'ASC' | 'DESC' = 'ASC'): QueryBuilder<S, R, Result> {
    return this.orderBy(fn, direction);
  }

  /** Set result limit. */
  limit(n: number): QueryBuilder<S, R, Result> {
    return this.clone({limit: n});
  }

  /** Set result offset. */
  offset(n: number): QueryBuilder<S, R, Result> {
    return this.clone({offset: n});
  }

  /** Target a single entity by ID. Implies singleResult; unwraps array Result type. */
  for(id: string | NodeReferenceValue | null | undefined): QueryBuilder<S, R, Result extends (infer E)[] ? E : Result> {
    if (id instanceof PendingQueryContext) {
      // Store the pending context as subject — its .id getter resolves lazily
      // from the global context map when the query is built/serialized.
      return this.clone({subject: id as any, subjects: undefined, singleResult: true, _nullSubject: false, _pendingContextName: id.contextName}) as any;
    }
    if (id == null) {
      // Return a builder that resolves to null when executed (no subject = no query).
      // This commonly happens when getQueryContext() returns null before the user is authenticated.
      return this.clone({subject: undefined, subjects: undefined, singleResult: true, _nullSubject: true}) as any;
    }
    const subject: NodeReferenceValue = typeof id === 'string' ? {id: resolveUriOrThrow(id)} : id;
    return this.clone({subject, subjects: undefined, singleResult: true}) as any;
  }

  /**
   * Whether the query has a pending (lazy) context that hasn't resolved yet.
   * Returns true when .for() received a PendingQueryContext whose value isn't available yet.
   */
  hasPendingContext(): boolean {
    return !!(this._pendingContextName && !this._subject?.id);
  }

  /** Target multiple entities by ID, or all if no ids given. */
  forAll(ids?: (string | NodeReferenceValue)[]): QueryBuilder<S, R, Result> {
    if (!ids) {
      return this.clone({subject: undefined, subjects: undefined, singleResult: false});
    }
    const subjects = ids.map((id) => typeof id === 'string' ? {id: resolveUriOrThrow(id)} : id);
    return this.clone({subject: undefined, subjects, singleResult: false});
  }

  /** Limit to one result. Unwraps array Result type to single element. */
  one(): QueryBuilder<S, R, Result extends (infer E)[] ? E : Result> {
    return this.clone<R, Result extends (infer E)[] ? E : Result>({limit: 1, singleResult: true});
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
    return this.clone({preloads: newPreloads});
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
      return FieldSet.for(this._shape.shape, this._selectAllLabels);
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
    const shapeId = this._shape.shape?.id || '';
    const json: QueryBuilderJSON = {
      shape: shapeId,
    };

    // Serialize fields — fields() already handles _selectAllLabels, so
    // no separate branch is needed (T1: dead else-if removed).
    const fs = this.fields();
    if (fs) {
      json.fields = fs.toJSON().fields;
    }

    if (this._limit !== undefined) {
      json.limit = this._limit;
    }
    if (this._offset !== undefined) {
      json.offset = this._offset;
    }
    if (this._subject && typeof this._subject === 'object' && 'id' in this._subject) {
      json.subject = (this._subject as NodeReferenceValue).id;
    }
    if (this._subjects && this._subjects.length > 0) {
      json.subjects = this._subjects.map((s) => s.id);
    }
    if (this._singleResult) {
      json.singleResult = true;
    }
    if (this._sortDirection) {
      json.orderDirection = this._sortDirection;
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
   * Get the raw pipeline input.
   *
   * Constructs RawSelectInput directly from FieldSet entries.
   */
  toRawInput(): RawSelectInput {
    return this._buildDirectRawInput();
  }

  /**
   * Build RawSelectInput directly from FieldSet entries.
   */
  private _buildDirectRawInput(): RawSelectInput {
    let fs = this.fields();

    // When preloads exist, trace them through the proxy and merge with the FieldSet.
    if (this._preloads && this._preloads.length > 0) {
      const preloadFn = (p: any) => {
        const results: any[] = [];
        for (const entry of this._preloads!) {
          results.push(p[entry.path].preloadFor(entry.component));
        }
        return results;
      };
      const preloadFs = FieldSet.for(this._shape, preloadFn);
      if (fs) {
        fs = FieldSet.createFromEntries(fs.shape, [
          ...(fs.entries as any[]),
          ...(preloadFs.entries as any[]),
        ]);
      } else {
        fs = preloadFs;
      }
    }

    const entries = fs ? fs.entries : [];

    // Evaluate where callback
    let where: WherePath | undefined;
    if (this._whereFn) {
      where = processWhereClause(this._whereFn, this._shape);
    }

    // Evaluate sort callback
    let sortBy: SortByPath | undefined;
    if (this._sortByFn) {
      sortBy = evaluateSortCallback(
        this._shape,
        this._sortByFn as unknown as (p: any) => any,
        this._sortDirection || 'ASC',
      );
    }

    const input: RawSelectInput = {
      entries,
      subject: this._subject,
      limit: this._limit,
      offset: this._offset,
      shape: this._shape,
      sortBy,
      singleResult:
        this._singleResult ||
        !!(
          this._subject &&
          typeof this._subject === 'object' &&
          'id' in this._subject
        ),
    };

    if (where) {
      input.where = where;
    }
    if (this._subjects && this._subjects.length > 0) {
      input.subjects = this._subjects;
    }

    // Process minus entries → convert callbacks to WherePaths or property paths
    if (this._minusEntries && this._minusEntries.length > 0) {
      input.minusEntries = this._minusEntries.map((entry) => {
        if (entry.shapeId) {
          return {shapeId: entry.shapeId};
        }
        if (entry.whereFn) {
          // Call the callback through the proxy and inspect the result type
          const proxy = createProxiedPathBuilder(this._shape);
          const result = (entry.whereFn as Function)(proxy);

          // Array of QBOs → property existence paths
          if (Array.isArray(result)) {
            const propertyPaths = result.map((item: any) => {
              const segments = FieldSet.collectPropertySegments(item);
              return segments.map((seg): PropertyPathSegment => ({propertyShapeId: seg.id}));
            });
            return {propertyPaths};
          }

          // Single QBO (has .property field) → single property existence path
          if (result && typeof result === 'object' && 'property' in result && 'subject' in result) {
            const segments = FieldSet.collectPropertySegments(result);
            const propertyPaths = [segments.map((seg): PropertyPathSegment => ({propertyShapeId: seg.id}))];
            return {propertyPaths};
          }

          // Evaluation → existing WHERE-based path
          return {where: processWhereClause(entry.whereFn, this._shape)};
        }
        return {};
      });
    }

    return input;
  }

  /** Build the IR (run the full pipeline: desugar → canonicalize → lower). */
  build(): SelectQuery {
    return buildSelectQuery(this.toRawInput());
  }

  /** Execute the query and return results. */
  exec(): Promise<Result> {
    if (this._nullSubject) {
      // .for(null/undefined) was called — return null instead of executing a broken query.
      return Promise.resolve(null as Result);
    }
    if (this._pendingContextName && !this._subject?.id) {
      // Pending context hasn't resolved yet — return null rather than querying without a subject.
      return Promise.resolve(null as Result);
    }
    let query: SelectQuery;
    try {
      query = this.build();
    } catch (err) {
      return Promise.reject(
        Error(`Error while building query: ${err.stack}.\n\nQuery related to this error: ${JSON.stringify(this.toJSON())}`)
      );
    }
    return getQueryDispatch().selectQuery(query).catch(err => {
      throw Error(`Error while executing query: ${err.stack}.\n\nQuery related to this error: ${JSON.stringify(this.toJSON())}`)
    }) as Promise<Result>;
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

  /** Catch errors from execution. Chain off then() to avoid re-executing. */
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
  ): Promise<Result | TResult> {
    return this.then().catch(onrejected);
  }

  /** Finally handler after execution. Chain off then() to avoid re-executing. */
  finally(onfinally?: (() => void) | null): Promise<Result> {
    return this.then().finally(onfinally);
  }

  get [Symbol.toStringTag](): string {
    return 'QueryBuilder';
  }
}
