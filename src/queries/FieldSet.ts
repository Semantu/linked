import type {NodeShape, PropertyShape} from '../shapes/SHACL.js';
import {PropertyPath, walkPropertyPath} from './PropertyPath.js';
import {getShapeClass} from '../utils/ShapeClass.js';
import type {WhereCondition} from './WhereCondition.js';

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
export class FieldSet {
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
   * Accepts string paths (dot-separated), PropertyPath instances,
   * nested objects, or a callback receiving a proxy for dot-access.
   */
  static for(
    shape: NodeShape | string,
    fields: FieldSetInput[],
  ): FieldSet;
  static for(
    shape: NodeShape | string,
    fn: (p: any) => any[],
  ): FieldSet;
  static for(
    shape: NodeShape | string,
    fieldsOrFn: FieldSetInput[] | ((p: any) => any[]),
  ): FieldSet {
    const resolvedShape = FieldSet.resolveShape(shape);

    if (typeof fieldsOrFn === 'function') {
      // Callback form: create proxy that traces property access to strings
      const fields = FieldSet.traceFieldsFromCallback(resolvedShape, fieldsOrFn);
      return new FieldSet(resolvedShape, fields);
    }

    const entries = FieldSet.resolveInputs(resolvedShape, fieldsOrFn);
    return new FieldSet(resolvedShape, entries);
  }

  /**
   * Create a FieldSet containing all decorated properties of the shape.
   */
  static all(shape: NodeShape | string, opts?: {depth?: number}): FieldSet {
    const resolvedShape = FieldSet.resolveShape(shape);
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

  private static resolveShape(shape: NodeShape | string): NodeShape {
    if (typeof shape === 'string') {
      const shapeClass = getShapeClass(shape);
      if (!shapeClass || !shapeClass.shape) {
        throw new Error(`Cannot resolve shape for '${shape}'`);
      }
      return shapeClass.shape;
    }
    return shape;
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
   * Trace fields from a callback that accesses properties on a proxy.
   * The proxy records each accessed property label and converts to entries.
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
            return key; // Return the label for the array
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
