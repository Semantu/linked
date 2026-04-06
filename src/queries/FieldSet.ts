import type {NodeShape, PropertyShape} from '../shapes/SHACL.js';
import type {Shape, ShapeConstructor} from '../shapes/Shape.js';
import {PropertyPath, walkPropertyPath} from './PropertyPath.js';
import {getShapeClass} from '../utils/ShapeClass.js';
import type {WherePath} from './SelectQuery.js';
import {createProxiedPathBuilder} from './ProxiedPathBuilder.js';
import {isExpressionNode} from '../expressions/ExpressionNode.js';
import type {ExpressionNode} from '../expressions/ExpressionNode.js';

// Duck-type helpers for runtime detection.
// These check structural shape since the classes live in SelectQuery.ts (runtime circular dep).
// QueryBuilderObject has .property (PropertyShape) and .subject (QueryBuilderObject).
// SetSize has .subject and extends QueryPrimitive<number>.
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

// BoundComponent: has .source (QueryBuilderObject) and .originalValue (component-like)
const isBoundComponent = (obj: any): boolean =>
  obj !== null &&
  typeof obj === 'object' &&
  'source' in obj &&
  'originalValue' in obj;

/**
 * A single entry in a FieldSet: a property path with optional alias, scoped filter,
 * sub-selection, aggregation, and custom key.
 */
export type FieldSetEntry = {
  path: PropertyPath;
  alias?: string;
  scopedFilter?: WherePath;
  /** Index into path.segments indicating which segment the scopedFilter applies to.
   *  Defaults to the last segment if not specified. */
  scopedFilterIndex?: number;
  /** Nested object selection — the user explicitly selected sub-fields (e.g. `p.friends.select(...)`) */
  subSelect?: FieldSet;
  aggregation?: 'count';
  customKey?: string;
  /** Component preload composition — the FieldSet comes from a linked component's own query,
   *  merged in via `preloadFor()`. Distinct from subSelect which is a user-authored nested query. */
  preloadSubSelect?: FieldSet;
  /** Computed expression from proxy tracing (e.g. `p.age.times(12)`) */
  expressionNode?: ExpressionNode;
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
export class FieldSet<R = any, Source = any> {
  readonly shape: NodeShape;
  readonly entries: readonly FieldSetEntry[];
  /** Phantom field — carries the callback response type for conditional type inference. */
  declare readonly __response: R;
  /** Phantom field — carries the source context (QueryShapeSet/QueryShape) for conditional type inference. */
  declare readonly __source: Source;

  /**
   * For sub-select FieldSets: the raw callback return value (proxy trace objects).
   * Stored so conditional types can extract the response type.
   */
  readonly traceResponse?: R;

  /**
   * For sub-select FieldSets: the parent property segments leading to this sub-select.
   */
  readonly parentSegments?: PropertyShape[];

  /**
   * For sub-select FieldSets: the shape class (ShapeType) of the sub-select's target.
   */
  readonly shapeType?: any;

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
  static for<S extends Shape>(shape: ShapeConstructor<S>, fields: FieldSetInput[]): FieldSet<any>;
  static for<S extends Shape, R>(shape: ShapeConstructor<S>, fn: (p: any) => R): FieldSet<R>;
  static for(shape: NodeShape | string, fields: FieldSetInput[]): FieldSet<any>;
  static for(shape: NodeShape | string, fn: (p: any) => any): FieldSet<any>;
  static for(
    shape: ShapeConstructor<any> | NodeShape | string,
    fieldsOrFn: FieldSetInput[] | ((p: any) => any),
  ): FieldSet<any> {
    const resolved = FieldSet.resolveShapeInput(shape);
    const resolvedShape = resolved.nodeShape;

    if (typeof fieldsOrFn === 'function') {
      if (!resolved.shapeClass) {
        throw new Error(
          `Cannot use callback form for shape '${resolved.nodeShape.id}': no ShapeConstructor registered. ` +
          `Use string field names instead, or pass the Shape class directly.`,
        );
      }
      const fields = FieldSet.traceFieldsWithProxy(resolved.nodeShape, resolved.shapeClass, fieldsOrFn);
      return new FieldSet(resolved.nodeShape, fields);
    }

    const entries = FieldSet.resolveInputs(resolvedShape, fieldsOrFn);
    return new FieldSet(resolvedShape, entries);
  }

  /**
   * Create a typed FieldSet for a sub-select. Traces the callback through the proxy,
   * stores parentSegments and traceResponse for runtime compatibility, and preserves
   * R and Source generics for conditional type inference.
   */
  static forSubSelect<R, Source>(
    shapeClass: any,
    fn: (p: any) => R,
    parentSegments: PropertyShape[],
  ): FieldSet<R, Source> {
    const nodeShape = shapeClass.shape || shapeClass;
    // Trace once: get both the raw response (for type carriers) and the entries
    const proxy = createProxiedPathBuilder(shapeClass);
    const traceResponse = fn(proxy as any);
    const entries = FieldSet.extractSubSelectEntries(nodeShape, traceResponse);
    const fs = new FieldSet(nodeShape, entries) as FieldSet<R, Source>;
    // Writable cast — these readonly fields are initialised once here at construction time
    const w = fs as {-readonly [K in 'traceResponse' | 'parentSegments' | 'shapeType']: FieldSet<R, Source>[K]};
    w.traceResponse = traceResponse;
    w.parentSegments = parentSegments;
    w.shapeType = shapeClass;
    return fs;
  }


  /**
   * Create a FieldSet containing all decorated properties of the shape.
   *
   * @param opts.depth Controls how deep to include nested shape properties:
   *   - `depth=1` (default): this level only — properties of the root shape.
   *   - `depth=0`: throws — use a node reference instead.
   *   - `depth>1`: recursively includes nested shape properties up to the given depth.
   */
  static all<S extends Shape>(shape: ShapeConstructor<S>, opts?: {depth?: number}): FieldSet;
  static all(shape: NodeShape | string, opts?: {depth?: number}): FieldSet;
  static all(shape: ShapeConstructor<any> | NodeShape | string, opts?: {depth?: number}): FieldSet {
    const depth = opts?.depth ?? 1;
    if (depth < 1) {
      throw new Error(
        'FieldSet.all() requires depth >= 1. Use a node reference ({id}) for depth 0.',
      );
    }
    const resolved = FieldSet.resolveShapeInput(shape);
    // Seed visited with the root shape to prevent self-referencing cycles
    const visited = new Set<string>([resolved.nodeShape.id]);
    return FieldSet.allForShape(resolved.nodeShape, depth, visited);
  }

  /**
   * Recursive helper for all(). Tracks visited shape IDs to prevent infinite loops
   * from circular shape references.
   */
  private static allForShape(
    nodeShape: NodeShape,
    depth: number,
    visited: Set<string>,
  ): FieldSet {
    const propertyShapes = nodeShape.getUniquePropertyShapes();
    const entries: FieldSetEntry[] = [];

    for (const ps of propertyShapes) {
      const entry: FieldSetEntry = {path: new PropertyPath(nodeShape, [ps])};

      // If depth > 1, recurse into nested shapes
      if (depth > 1 && ps.valueShape) {
        const nestedShapeClass = getShapeClass(ps.valueShape);
        if (nestedShapeClass?.shape && !visited.has(nestedShapeClass.shape.id)) {
          visited.add(nestedShapeClass.shape.id);
          const nestedFs = FieldSet.allForShape(nestedShapeClass.shape, depth - 1, visited);
          if (nestedFs.entries.length > 0) {
            entry.subSelect = nestedFs;
          }
        }
      }

      entries.push(entry);
    }

    return new FieldSet(nodeShape, entries);
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
    for (const set of sets) {
      if (set.shape.id !== shape.id) {
        throw new Error(
          `Cannot merge FieldSets with different shapes: '${shape.label || shape.id}' and '${set.shape.label || set.shape.id}'`,
        );
      }
    }
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

  /** Synonym for replacing all entries — returns a new FieldSet with only the given fields. */
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
        } else if (entry.preloadSubSelect) {
          // Preloads produce identical IR to subSelect — serialize as subSelect.
          field.subSelect = entry.preloadSubSelect.toJSON();
        }
        if (entry.aggregation) {
          field.aggregation = entry.aggregation;
        }
        if (entry.customKey) {
          field.customKey = entry.customKey;
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
      return entry;
    });
    return new FieldSet(resolvedShape, entries);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolves any of the accepted shape input types to a NodeShape and optional ShapeClass.
   * Accepts: ShapeConstructor (class with .shape), NodeShape, or IRI string.
   */
  private static resolveShapeInput(shape: ShapeConstructor<any> | NodeShape | string): {nodeShape: NodeShape; shapeClass?: ShapeConstructor<any>} {
    if (typeof shape === 'string') {
      const shapeClass = getShapeClass(shape);
      if (!shapeClass || !shapeClass.shape) {
        throw new Error(`Cannot resolve shape for '${shape}'`);
      }
      return {nodeShape: shapeClass.shape, shapeClass};
    }
    // ShapeConstructor: has a static .shape property that is a NodeShape
    if ('shape' in shape && typeof shape.shape === 'object' && shape.shape !== null && 'id' in shape.shape) {
      return {nodeShape: (shape as ShapeConstructor<any>).shape, shapeClass: shape as ShapeConstructor<any>};
    }
    // NodeShape: has .id directly — try to look up its ShapeConstructor for full proxy support
    const nodeShape = shape as NodeShape;
    const shapeClass = nodeShape.id ? getShapeClass(nodeShape.id) : undefined;
    return shapeClass
      ? {nodeShape, shapeClass}
      : {nodeShape};
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
    shapeClass: ShapeConstructor<any>,
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
    // Single FieldSet sub-select (e.g. p.friends.select(f => [f.name]))
    if (result instanceof FieldSet && result.parentSegments !== undefined) {
      return [FieldSet.convertTraceResult(nodeShape, result)];
    }
    // Single SetSize (e.g. p.friends.size())
    if (isSetSize(result)) {
      return [FieldSet.convertTraceResult(nodeShape, result)];
    }
    // Single BoundComponent (e.g. p.bestFriend.preloadFor(comp))
    if (isBoundComponent(result)) {
      return [FieldSet.convertTraceResult(nodeShape, result)];
    }
    // Single ExpressionNode (e.g. p.age.times(12))
    if (isExpressionNode(result)) {
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
   * Convert a single proxy trace result (QueryBuilderObject, SetSize, or FieldSet sub-select)
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

    // FieldSet sub-select — use its entries directly (created by forSubSelect)
    if (obj instanceof FieldSet && obj.parentSegments !== undefined) {
      const subSelect = obj.entries.length > 0 ? obj : undefined;
      return {
        path: new PropertyPath(rootShape, obj.parentSegments),
        subSelect: subSelect as FieldSet | undefined,
      };
    }

    // BoundComponent → preload composition (e.g. p.bestFriend.preloadFor(component))
    // Extract the component's FieldSet and store it as preloadSubSelect.
    if (isBoundComponent(obj)) {
      const segments = FieldSet.collectPropertySegments(obj.source);
      const componentFieldSet = FieldSet.extractComponentFieldSet(obj.originalValue);
      return {
        path: new PropertyPath(rootShape, segments),
        preloadSubSelect: componentFieldSet,
      };
    }

    // ExpressionNode → computed expression (e.g. p.age.times(12))
    if (isExpressionNode(obj)) {
      return {
        path: new PropertyPath(rootShape, []),
        expressionNode: obj,
      };
    }

    // QueryBuilderObject → walk the chain to collect PropertyPath segments
    if (isQueryBuilderObject(obj)) {
      const segments = FieldSet.collectPropertySegments(obj);
      const entry: FieldSetEntry = {
        path: new PropertyPath(rootShape, segments),
      };
      // Walk from leaf to root to find wherePath on any object in the chain.
      // Track which segment it belongs to so desugarEntry attaches the filter correctly.
      let current: QueryBuilderObjectLike | undefined = obj;
      let leafDistance = 0;
      while (current) {
        if (current.wherePath) {
          entry.scopedFilter = current.wherePath as WherePath;
          entry.scopedFilterIndex = segments.length - 1 - leafDistance;
          break;
        }
        current = current.subject;
        leafDistance++;
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
  static collectPropertySegments(obj: QueryBuilderObjectLike): PropertyShape[] {
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
   * Extract a FieldSet from a component-like object for preload composition.
   *
   * Supports multiple component interfaces:
   * - `.fields` as a FieldSet directly
   * - `.query` as a FieldSet, QueryBuilder (duck-typed via .fields()), or
   *   Record<string, QueryBuilder> (e.g. `{person: PersonQuery}`)
   */
  static extractComponentFieldSet(component: any): FieldSet | undefined {
    // Prefer .fields if it's a FieldSet
    if (component.fields instanceof FieldSet) {
      return component.fields;
    }
    const query = component.query;
    if (query instanceof FieldSet) {
      return query;
    }
    // QueryBuilder duck-type — has .fields() method
    if (query && typeof query.fields === 'function') {
      return query.fields();
    }
    // Record form: { propName: QueryBuilder }
    if (typeof query === 'object') {
      for (const key in query) {
        const value = (query as Record<string, any>)[key];
        if (value && typeof value.fields === 'function') {
          return value.fields();
        }
      }
    }
    return undefined;
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
   * Extract FieldSetEntry[] from a sub-select's traceResponse.
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
    // Single FieldSet sub-select — convert directly
    if (traceResponse instanceof FieldSet && traceResponse.parentSegments !== undefined) {
      return [FieldSet.convertTraceResult(rootShape, traceResponse)];
    }
    // Single SetSize
    if (isSetSize(traceResponse)) {
      return [FieldSet.convertTraceResult(rootShape, traceResponse)];
    }
    // Single ExpressionNode
    if (isExpressionNode(traceResponse)) {
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

}
