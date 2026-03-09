import type {NodeShape, PropertyShape} from '../shapes/SHACL.js';
import type {Shape, ShapeType} from '../shapes/Shape.js';
import {PropertyPath, walkPropertyPath} from './PropertyPath.js';
import {getShapeClass} from '../utils/ShapeClass.js';
import type {WhereCondition} from './WhereCondition.js';
import {createProxiedPathBuilder} from './ProxiedPathBuilder.js';
import type {SubSelectResult} from './SubSelectResult.js';

// Duck-type helpers for runtime detection.
// These check structural shape since the classes live in SelectQuery.ts (runtime circular dep).
// SubSelectResult is a type-only interface, so we must duck-type it (no instanceof).
// QueryBuilderObject has .property (PropertyShape) and .subject (QueryBuilderObject).
// SetSize has .subject and extends QueryNumber.
type QueryBuilderObjectLike = {
  property?: PropertyShape;
  subject?: QueryBuilderObjectLike;
  wherePath?: unknown;
};
const isQueryBuilderObject = (obj: any): obj is QueryBuilderObjectLike =>
  obj !== null &&
  typeof obj === 'object' &&
  'property' in obj &&
  'subject' in obj &&
  typeof obj.getPropertyPath === 'function';

const isSetSize = (obj: any): boolean =>
  obj !== null &&
  typeof obj === 'object' &&
  'subject' in obj &&
  typeof obj.as === 'function' &&
  typeof obj.getPropertyPath === 'function' &&
  // SetSize has a 'countable' field (may be undefined) and 'label' field
  'label' in obj;

const isSubSelectResult = (obj: any): boolean =>
  obj !== null &&
  typeof obj === 'object' &&
  typeof obj.getQueryPaths === 'function' &&
  'parentQueryPath' in obj;

// Evaluation: has .method (WhereMethods), .value (QueryBuilderObject), .getWherePath()
const isEvaluation = (obj: any): boolean =>
  obj !== null &&
  typeof obj === 'object' &&
  'method' in obj &&
  'value' in obj &&
  typeof obj.getWherePath === 'function';

// BoundComponent: has .source (QueryBuilderObject) and .originalValue (component-like)
const isBoundComponent = (obj: any): boolean =>
  obj !== null &&
  typeof obj === 'object' &&
  'source' in obj &&
  'originalValue' in obj &&
  typeof obj.getComponentQueryPaths === 'function';

/**
 * A single entry in a FieldSet: a property path with optional alias, scoped filter,
 * sub-selection, aggregation, and custom key.
 */
export type FieldSetEntry = {
  path: PropertyPath;
  alias?: string;
  scopedFilter?: WhereCondition;
  subSelect?: FieldSet;
  aggregation?: 'count';
  customKey?: string;
  evaluation?: {method: string; wherePath: any};
  preloadQueryPath?: any;
};

/**
 * Input types accepted by FieldSet construction methods.
 *
 * - `string` — resolved via walkPropertyPath (dot-separated)
 * - `PropertyPath` — used directly
 * - `FieldSet` — merged in
 * - `Record<string, string[] | FieldSet>` — nested fields
 */
export type FieldSetInput =
  | string
  | PropertyPath
  | FieldSet
  | Record<string, string[] | FieldSet>;

/** JSON representation of a FieldSet field entry. */
export type FieldSetFieldJSON = {
  path: string;
  as?: string;
  subSelect?: FieldSetJSON;
  aggregation?: string;
  customKey?: string;
  evaluation?: {method: string; wherePath: any};
};

/** JSON representation of a FieldSet. */
export type FieldSetJSON = {
  shape: string;
  fields: FieldSetFieldJSON[];
};

/**
 * An immutable, composable collection of property paths for a shape.
 *
 * FieldSet describes which properties to select, independent of
 * how the query is built. It integrates with QueryBuilder via
 * `.select(fieldSet)`.
 *
 * Every mutation method returns a new FieldSet — the original is never modified.
 */
export class FieldSet<R = any> {
  readonly shape: NodeShape;
  readonly entries: readonly FieldSetEntry[];

  private constructor(shape: NodeShape, entries: FieldSetEntry[]) {
    this.shape = shape;
    this.entries = entries;
  }

  // ---------------------------------------------------------------------------
  // Static constructors
  // ---------------------------------------------------------------------------

  /**
   * Create a FieldSet for the given shape with the specified fields.
   *
   * Accepts a ShapeClass (e.g. Person), NodeShape, or shape IRI string.
   * Fields can be string paths, PropertyPath instances, nested objects,
   * or a callback receiving a proxy for dot-access.
   */
  static for<S extends Shape>(shape: ShapeType<S>, fields: FieldSetInput[]): FieldSet<any>;
  static for<S extends Shape, R>(shape: ShapeType<S>, fn: (p: any) => R): FieldSet<R>;
  static for(shape: NodeShape | string, fields: FieldSetInput[]): FieldSet<any>;
  static for(shape: NodeShape | string, fn: (p: any) => any): FieldSet<any>;
  static for(
    shape: ShapeType<any> | NodeShape | string,
    fieldsOrFn: FieldSetInput[] | ((p: any) => any),
  ): FieldSet<any> {
    const resolved = FieldSet.resolveShapeInput(shape);
    const resolvedShape = resolved.nodeShape;

    if (typeof fieldsOrFn === 'function') {
      const fields = resolved.shapeClass
        ? FieldSet.traceFieldsWithProxy(resolved.nodeShape, resolved.shapeClass, fieldsOrFn)
        : FieldSet.traceFieldsFromCallback(resolved.nodeShape, fieldsOrFn);
      return new FieldSet(resolved.nodeShape, fields);
    }

    const entries = FieldSet.resolveInputs(resolvedShape, fieldsOrFn);
    return new FieldSet(resolvedShape, entries);
  }

  /**
   * Create a FieldSet containing all decorated properties of the shape.
   */
  static all<S extends Shape>(shape: ShapeType<S>, opts?: {depth?: number}): FieldSet;
  static all(shape: NodeShape | string, opts?: {depth?: number}): FieldSet;
  static all(shape: ShapeType<any> | NodeShape | string, opts?: {depth?: number}): FieldSet {
    const resolvedShape = FieldSet.resolveShapeInput(shape).nodeShape;
    const propertyShapes = resolvedShape.getUniquePropertyShapes();
    const entries: FieldSetEntry[] = propertyShapes.map((ps: PropertyShape) => ({
      path: new PropertyPath(resolvedShape, [ps]),
    }));
    return new FieldSet(resolvedShape, entries);
  }

  /**
   * Merge multiple FieldSets into one, deduplicating by path equality.
   * All FieldSets must share the same root shape.
   */
  static merge(sets: FieldSet[]): FieldSet {
    if (sets.length === 0) {
      throw new Error('Cannot merge empty array of FieldSets');
    }
    const shape = sets[0].shape;
    const merged: FieldSetEntry[] = [];
    const seen = new Set<string>();

    for (const set of sets) {
      for (const entry of set.entries) {
        // Include aggregation in the dedup key so that 'friends' and 'friends(count)' are distinct
        const key = entry.aggregation
          ? `${entry.path.toString()}:${entry.aggregation}`
          : entry.path.toString();
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(entry);
        }
      }
    }

    return new FieldSet(shape, merged);
  }

  // ---------------------------------------------------------------------------
  // Composition methods — each returns a new FieldSet
  // ---------------------------------------------------------------------------

  /** Returns a new FieldSet with only the given fields. */
  select(fields: FieldSetInput[]): FieldSet {
    const entries = FieldSet.resolveInputs(this.shape, fields);
    return new FieldSet(this.shape, entries);
  }

  /** Returns a new FieldSet with additional entries. */
  add(fields: FieldSetInput[]): FieldSet {
    const newEntries = FieldSet.resolveInputs(this.shape, fields);
    // Deduplicate
    const existing = new Set(this.entries.map((e) => e.path.toString()));
    const combined = [...this.entries];
    for (const entry of newEntries) {
      if (!existing.has(entry.path.toString())) {
        combined.push(entry);
      }
    }
    return new FieldSet(this.shape, combined);
  }

  /** Returns a new FieldSet without entries matching the given labels. */
  remove(labels: string[]): FieldSet {
    const labelSet = new Set(labels);
    const filtered = (this.entries as FieldSetEntry[]).filter(
      (e) => !labelSet.has(e.path.terminal?.label),
    );
    return new FieldSet(this.shape, filtered);
  }

  /** Returns a new FieldSet replacing all entries with the given fields. */
  set(fields: FieldSetInput[]): FieldSet {
    const entries = FieldSet.resolveInputs(this.shape, fields);
    return new FieldSet(this.shape, entries);
  }

  /** Returns a new FieldSet keeping only entries matching the given labels. */
  pick(labels: string[]): FieldSet {
    const labelSet = new Set(labels);
    const filtered = (this.entries as FieldSetEntry[]).filter(
      (e) => labelSet.has(e.path.terminal?.label),
    );
    return new FieldSet(this.shape, filtered);
  }

  /** Returns all PropertyPaths in this FieldSet. */
  paths(): PropertyPath[] {
    return (this.entries as FieldSetEntry[]).map((e) => e.path);
  }

  /** Returns terminal property labels of all entries. */
  labels(): string[] {
    return (this.entries as FieldSetEntry[]).map((e) => e.path.terminal?.label).filter(Boolean) as string[];
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /**
   * Serialize this FieldSet to a plain JSON object.
   * Shape is identified by its IRI, paths by dot-separated labels.
   */
  toJSON(): FieldSetJSON {
    return {
      shape: this.shape.id,
      fields: (this.entries as FieldSetEntry[]).map((entry) => {
        const field: FieldSetFieldJSON = {path: entry.path.toString()};
        if (entry.alias) {
          field.as = entry.alias;
        }
        if (entry.subSelect) {
          field.subSelect = entry.subSelect.toJSON();
        }
        if (entry.aggregation) {
          field.aggregation = entry.aggregation;
        }
        if (entry.customKey) {
          field.customKey = entry.customKey;
        }
        if (entry.evaluation) {
          field.evaluation = entry.evaluation;
        }
        return field;
      }),
    };
  }

  /**
   * Reconstruct a FieldSet from a JSON object.
   * Resolves shape IRI via getShapeClass() and paths via walkPropertyPath().
   */
  static fromJSON(json: FieldSetJSON): FieldSet {
    const resolvedShape = FieldSet.resolveShape(json.shape);
    const entries: FieldSetEntry[] = json.fields.map((field) => {
      const entry: FieldSetEntry = {
        path: walkPropertyPath(resolvedShape, field.path),
        alias: field.as,
      };
      if (field.subSelect) {
        entry.subSelect = FieldSet.fromJSON(field.subSelect);
      }
      if (field.aggregation) {
        entry.aggregation = field.aggregation as 'count';
      }
      if (field.customKey) {
        entry.customKey = field.customKey;
      }
      if (field.evaluation) {
        entry.evaluation = field.evaluation;
      }
      return entry;
    });
    return new FieldSet(resolvedShape, entries);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolves any of the accepted shape input types to a NodeShape and optional ShapeClass.
   * Accepts: ShapeType (class with .shape), NodeShape, or IRI string.
   */
  private static resolveShapeInput(shape: ShapeType<any> | NodeShape | string): {nodeShape: NodeShape; shapeClass?: ShapeType<any>} {
    if (typeof shape === 'string') {
      const shapeClass = getShapeClass(shape);
      if (!shapeClass || !shapeClass.shape) {
        throw new Error(`Cannot resolve shape for '${shape}'`);
      }
      return {nodeShape: shapeClass.shape, shapeClass: shapeClass as ShapeType<any>};
    }
    // ShapeType: has a static .shape property that is a NodeShape
    if ('shape' in shape && typeof (shape as any).shape === 'object' && (shape as any).shape !== null && 'id' in (shape as any).shape) {
      return {nodeShape: (shape as ShapeType<any>).shape, shapeClass: shape as ShapeType<any>};
    }
    // NodeShape: has .id directly
    return {nodeShape: shape as NodeShape};
  }

  /** @deprecated Use resolveShapeInput instead. Kept for fromJSON which only passes NodeShape|string. */
  private static resolveShape(shape: NodeShape | string): NodeShape {
    return FieldSet.resolveShapeInput(shape).nodeShape;
  }

  private static resolveInputs(
    shape: NodeShape,
    inputs: FieldSetInput[],
  ): FieldSetEntry[] {
    const entries: FieldSetEntry[] = [];
    for (const input of inputs) {
      if (typeof input === 'string') {
        entries.push({path: walkPropertyPath(shape, input)});
      } else if (input instanceof PropertyPath) {
        entries.push({path: input});
      } else if (input instanceof FieldSet) {
        entries.push(...(input.entries as FieldSetEntry[]));
      } else if (typeof input === 'object') {
        // Nested object form: { friends: ['name', 'hobby'] }
        for (const [key, value] of Object.entries(input)) {
          const basePath = walkPropertyPath(shape, key);
          if (value instanceof FieldSet) {
            // Merge nested FieldSet entries under this path
            for (const entry of value.entries as FieldSetEntry[]) {
              const combined = new PropertyPath(shape, [
                ...basePath.segments,
                ...entry.path.segments,
              ]);
              entries.push({path: combined, alias: entry.alias, scopedFilter: entry.scopedFilter});
            }
          } else if (Array.isArray(value)) {
            // Resolve nested string fields
            const basePropertyShape = basePath.terminal;
            if (!basePropertyShape?.valueShape) {
              throw new Error(
                `Property '${key}' has no valueShape; cannot resolve nested fields`,
              );
            }
            const nestedShapeClass = getShapeClass(basePropertyShape.valueShape);
            if (!nestedShapeClass || !nestedShapeClass.shape) {
              throw new Error(
                `Cannot resolve valueShape for property '${key}'`,
              );
            }
            for (const nestedField of value) {
              const nestedPath = walkPropertyPath(nestedShapeClass.shape, nestedField);
              const combined = new PropertyPath(shape, [
                ...basePath.segments,
                ...nestedPath.segments,
              ]);
              entries.push({path: combined});
            }
          }
        }
      }
    }
    return entries;
  }

  /**
   * Trace fields using the full ProxiedPathBuilder proxy (createProxiedPathBuilder).
   * Handles nested paths, where conditions, aggregations, and sub-selects.
   */
  private static traceFieldsWithProxy(
    nodeShape: NodeShape,
    shapeClass: ShapeType<any>,
    fn: (p: any) => any,
  ): FieldSetEntry[] {
    const proxy = createProxiedPathBuilder(shapeClass);
    const result = fn(proxy);

    // Normalize result: could be a single value, array, or custom object
    if (Array.isArray(result)) {
      return result.map((item) => FieldSet.convertTraceResult(nodeShape, item));
    }
    if (isQueryBuilderObject(result)) {
      return [FieldSet.convertTraceResult(nodeShape, result)];
    }
    // Single SubSelectResult (e.g. p.friends.select(f => [f.name]))
    if (isSubSelectResult(result)) {
      return [FieldSet.convertTraceResult(nodeShape, result)];
    }
    // Single SetSize (e.g. p.friends.size())
    if (isSetSize(result)) {
      return [FieldSet.convertTraceResult(nodeShape, result)];
    }
    // Single Evaluation (e.g. p.bestFriend.equals(...))
    if (isEvaluation(result)) {
      return [FieldSet.convertTraceResult(nodeShape, result)];
    }
    // Single BoundComponent (e.g. p.bestFriend.preloadFor(comp))
    if (isBoundComponent(result)) {
      return [FieldSet.convertTraceResult(nodeShape, result)];
    }
    if (typeof result === 'object' && result !== null) {
      // Custom object form: {name: p.name, hobby: p.hobby}
      const entries: FieldSetEntry[] = [];
      for (const [key, value] of Object.entries(result)) {
        const entry = FieldSet.convertTraceResult(nodeShape, value);
        entry.customKey = key;
        entries.push(entry);
      }
      return entries;
    }
    return [];
  }

  /**
   * Convert a single proxy trace result (QueryBuilderObject, SetSize, or SubSelectResult)
   * into a FieldSetEntry.
   */
  private static convertTraceResult(rootShape: NodeShape, obj: any): FieldSetEntry {
    // SetSize → aggregation: 'count'
    if (isSetSize(obj)) {
      const segments = FieldSet.collectPropertySegments(obj.subject);
      return {
        path: new PropertyPath(rootShape, segments),
        aggregation: 'count',
      };
    }

    // SubSelectResult → sub-select (extract sub-FieldSet from the trace)
    if (isSubSelectResult(obj)) {
      const parentPath = obj.parentQueryPath;
      const segments: PropertyShape[] = [];
      if (parentPath && Array.isArray(parentPath)) {
        for (const step of parentPath) {
          if (step && typeof step === 'object' && 'property' in step && step.property) {
            segments.push(step.property);
          }
        }
      }

      // Extract sub-select FieldSet from the factory's traced response
      let subSelect: FieldSet | undefined;
      const factoryShape = obj.shape;
      const traceResponse = obj.traceResponse;
      if (factoryShape && traceResponse !== undefined) {
        const subNodeShape = factoryShape.shape || factoryShape;
        const subEntries = FieldSet.extractSubSelectEntries(subNodeShape, traceResponse);
        if (subEntries.length > 0) {
          subSelect = FieldSet.createInternal(subNodeShape, subEntries);
        }
      }

      return {
        path: new PropertyPath(rootShape, segments),
        subSelect,
      };
    }

    // Evaluation → where-as-selection (e.g. p.bestFriend.equals(...) used as select)
    // The Evaluation's .value is the QueryBuilderObject chain leading to the comparison.
    if (isEvaluation(obj)) {
      const segments = FieldSet.collectPropertySegments(obj.value);
      return {
        path: new PropertyPath(rootShape, segments),
        evaluation: {method: obj.method, wherePath: obj.getWherePath()},
      };
    }

    // BoundComponent → preload composition (e.g. p.bestFriend.preloadFor(component))
    // BoundComponent extends QueryBuilderObject and has getPropertyPath() which returns
    // the full merged path (source chain + component query paths appended).
    if (isBoundComponent(obj)) {
      const preloadQueryPath = obj.getPropertyPath();
      // Extract the source segments for the PropertyPath (the path to the preload point)
      const segments = FieldSet.collectPropertySegments(obj.source);
      return {
        path: new PropertyPath(rootShape, segments),
        preloadQueryPath,
      };
    }

    // QueryBuilderObject → walk the chain to collect PropertyPath segments
    if (isQueryBuilderObject(obj)) {
      const segments = FieldSet.collectPropertySegments(obj);
      const entry: FieldSetEntry = {
        path: new PropertyPath(rootShape, segments),
      };
      if (obj.wherePath) {
        entry.scopedFilter = obj.wherePath as any;
      }
      return entry;
    }

    // Fallback: string label
    if (typeof obj === 'string') {
      return {path: walkPropertyPath(rootShape, obj)};
    }

    throw new Error(`Unknown trace result type: ${obj}`);
  }

  /**
   * Walk a QueryBuilderObject-like chain (via .subject) collecting PropertyShape segments
   * from leaf to root, then reverse to get root-to-leaf order.
   */
  private static collectPropertySegments(obj: QueryBuilderObjectLike): PropertyShape[] {
    const segments: PropertyShape[] = [];
    let current: QueryBuilderObjectLike | undefined = obj;
    while (current) {
      if (current.property) {
        segments.unshift(current.property);
      }
      current = current.subject;
    }
    return segments;
  }

  /**
   * Internal factory that bypasses the private constructor for use by static methods.
   */
  private static createInternal(shape: NodeShape, entries: FieldSetEntry[]): FieldSet {
    return new FieldSet(shape, entries);
  }

  /**
   * Create a FieldSet from raw entries. Used by QueryBuilder to merge preload entries.
   */
  static createFromEntries(shape: NodeShape, entries: FieldSetEntry[]): FieldSet {
    return new FieldSet(shape, entries);
  }

  /**
   * Extract FieldSetEntry[] from a sub-query's traceResponse.
   * Public alias for use by lightweight sub-select wrappers.
   */
  static extractSubSelectEntriesPublic(rootShape: NodeShape, traceResponse: any): FieldSetEntry[] {
    return FieldSet.extractSubSelectEntries(rootShape, traceResponse);
  }

  /**
   * Extract FieldSetEntry[] from a SubSelectResult's traceResponse.
   * The traceResponse is the result of calling the sub-query callback with a proxy,
   * containing QueryBuilderObjects, arrays, custom objects, etc.
   */
  private static extractSubSelectEntries(rootShape: NodeShape, traceResponse: any): FieldSetEntry[] {
    if (Array.isArray(traceResponse)) {
      return traceResponse
        .filter((item) => item !== null && item !== undefined)
        .map((item) => FieldSet.convertTraceResult(rootShape, item));
    }
    if (isQueryBuilderObject(traceResponse)) {
      return [FieldSet.convertTraceResult(rootShape, traceResponse)];
    }
    // Single sub-select factory or lightweight wrapper — convert directly
    if (isSubSelectResult(traceResponse)) {
      return [FieldSet.convertTraceResult(rootShape, traceResponse)];
    }
    // Single SetSize
    if (isSetSize(traceResponse)) {
      return [FieldSet.convertTraceResult(rootShape, traceResponse)];
    }
    // Single Evaluation
    if (isEvaluation(traceResponse)) {
      return [FieldSet.convertTraceResult(rootShape, traceResponse)];
    }
    if (typeof traceResponse === 'object' && traceResponse !== null) {
      // Custom object form: {name: p.name, hobby: p.hobby}
      const entries: FieldSetEntry[] = [];
      for (const [key, value] of Object.entries(traceResponse)) {
        if (value !== null && value !== undefined) {
          const entry = FieldSet.convertTraceResult(rootShape, value);
          entry.customKey = key;
          entries.push(entry);
        }
      }
      return entries;
    }
    return [];
  }

  /**
   * Trace fields from a callback using a simple string-capturing proxy.
   * Fallback for when no ShapeClass is available (NodeShape-only path).
   */
  private static traceFieldsFromCallback(
    shape: NodeShape,
    fn: (p: any) => any[],
  ): FieldSetEntry[] {
    const accessed: string[] = [];
    const proxy = new Proxy(
      {},
      {
        get(_target, key) {
          if (typeof key === 'string') {
            accessed.push(key);
            return key;
          }
          return undefined;
        },
      },
    );
    fn(proxy);
    return accessed.map((label) => ({
      path: walkPropertyPath(shape, label),
    }));
  }
}
