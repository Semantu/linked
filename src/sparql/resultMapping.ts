import type {
  IRCreateMutation,
  IRExpression,
  IRFieldValue,
  IRNodeData,
  IRSelectQuery,
  IRUpdateMutation,
  CreateResult,
  ResultFieldValue,
  ResultRow,
  SelectResult,
  UpdateResult,
} from '../queries/IntermediateRepresentation.js';

// ---------------------------------------------------------------------------
// SPARQL JSON Result Types
// ---------------------------------------------------------------------------

export type SparqlJsonResults = {
  head: {vars: string[]};
  results: {
    bindings: SparqlBinding[];
  };
};

export type SparqlBinding = Record<
  string,
  {
    type: 'uri' | 'literal' | 'bnode' | 'typed-literal';
    value: string;
    datatype?: string;
    'xml:lang'?: string;
  }
>;

// ---------------------------------------------------------------------------
// XSD constants (kept local to avoid pulling in the full ontology module)
// ---------------------------------------------------------------------------

const XSD = 'http://www.w3.org/2001/XMLSchema#';
const XSD_BOOLEAN = `${XSD}boolean`;
const XSD_INTEGER = `${XSD}integer`;
const XSD_LONG = `${XSD}long`;
const XSD_DECIMAL = `${XSD}decimal`;
const XSD_FLOAT = `${XSD}float`;
const XSD_DOUBLE = `${XSD}double`;
const XSD_DATE_TIME = `${XSD}dateTime`;
const XSD_DATE = `${XSD}date`;

const NUMERIC_DATATYPES = new Set([
  XSD_INTEGER,
  XSD_LONG,
  XSD_DECIMAL,
  XSD_FLOAT,
  XSD_DOUBLE,
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the local name (last segment) from a full URI.
 * E.g. "https://data.lincd.org/.../person/name" → "name"
 */
function localName(uri: string): string {
  const hashIdx = uri.lastIndexOf('#');
  if (hashIdx >= 0) return uri.substring(hashIdx + 1);
  const slashIdx = uri.lastIndexOf('/');
  return slashIdx >= 0 ? uri.substring(slashIdx + 1) : uri;
}

/**
 * Derives the SPARQL variable name that will appear in the result bindings
 * for a given projection expression.
 *
 * Convention (aligned with irToAlgebra variable naming):
 * - `property_expr(sourceAlias, property)` → `{sourceAlias}_{localName(property)}`
 * - `alias_expr(alias)` → `{alias}`
 * - `aggregate_expr` → uses the projection alias directly
 * - Anything else → falls back to the projection alias
 */
function sparqlVarName(expression: IRExpression, projectionAlias: string): string {
  switch (expression.kind) {
    case 'property_expr':
      return `${expression.sourceAlias}_${localName(expression.property)}`;
    case 'alias_expr':
      return expression.alias;
    case 'aggregate_expr':
      return projectionAlias;
    default:
      return projectionAlias;
  }
}

/**
 * Coerces a raw SPARQL binding value into the appropriate JS type
 * based on the binding's type and datatype annotations.
 */
function coerceValue(
  binding: {type: string; value: string; datatype?: string},
): ResultFieldValue {
  // URI → return the URI string as an id
  if (binding.type === 'uri') {
    return binding.value;
  }

  // Typed literal → coerce based on datatype
  if (binding.datatype) {
    if (binding.datatype === XSD_BOOLEAN) {
      return binding.value === 'true' || binding.value === '1';
    }
    if (NUMERIC_DATATYPES.has(binding.datatype)) {
      return Number(binding.value);
    }
    if (binding.datatype === XSD_DATE_TIME || binding.datatype === XSD_DATE) {
      return new Date(binding.value);
    }
  }

  // Untyped literal or bnode → string
  return binding.value;
}

/**
 * Determines whether a projection expression targets an entity reference
 * (i.e., a URI variable) vs a property value. Used for result structuring.
 *
 * - `alias_expr` → entity reference (the alias itself is a traversed entity)
 * - `property_expr` where the property represents an object property → URI reference
 * - Other expressions → literal/property value
 */
function isUriExpression(expression: IRExpression): boolean {
  return expression.kind === 'alias_expr';
}

// ---------------------------------------------------------------------------
// Type: nesting descriptor for reconstructing nested objects from flat bindings
// ---------------------------------------------------------------------------

type NestingDescriptor = {
  /** The root alias variable name (e.g. "a0") */
  rootVar: string;
  /** Flat fields: fields directly on the root entity */
  flatFields: Array<{
    key: string;
    sparqlVar: string;
    expression: IRExpression;
  }>;
  /** Nested groups: fields that come from traversed entities */
  nestedGroups: Array<{
    key: string;
    traverseAlias: string;
    fields: Array<{
      key: string;
      sparqlVar: string;
      expression: IRExpression;
    }>;
  }>;
};

/**
 * Analyzes the query structure to build a nesting descriptor that guides
 * how flat SPARQL bindings should be grouped into nested result objects.
 */
function buildNestingDescriptor(query: IRSelectQuery): NestingDescriptor {
  const rootAlias = query.root.alias;

  // Build a map from alias → traverse pattern (to identify which aliases are traversals)
  const traverseMap = new Map<string, {from: string; property: string}>();
  for (const pattern of query.patterns) {
    if (pattern.kind === 'traverse') {
      traverseMap.set(pattern.to, {from: pattern.from, property: pattern.property});
    }
  }

  const flatFields: NestingDescriptor['flatFields'] = [];
  const nestedGroupMap = new Map<string, NestingDescriptor['nestedGroups'][number]>();

  const resultMap = query.resultMap ?? [];
  const projectionByAlias = new Map(
    query.projection.map((p) => [p.alias, p]),
  );

  for (const entry of resultMap) {
    const projItem = projectionByAlias.get(entry.alias);
    if (!projItem) continue;

    const expression = projItem.expression;
    const sparqlVar = sparqlVarName(expression, entry.alias);
    const resultKey = localName(entry.key);

    // Determine which entity this field belongs to
    let sourceAlias: string;
    if (expression.kind === 'property_expr') {
      sourceAlias = expression.sourceAlias;
    } else if (expression.kind === 'alias_expr') {
      sourceAlias = expression.alias;
    } else {
      sourceAlias = rootAlias;
    }

    // If the source alias is the root, it's a flat field
    if (sourceAlias === rootAlias) {
      flatFields.push({key: resultKey, sparqlVar, expression});
    } else {
      // It's a field on a traversed entity — group by traverse alias
      // Walk up the traverse chain to find the immediate child of root
      let groupAlias = sourceAlias;
      let traverseInfo = traverseMap.get(groupAlias);
      while (traverseInfo && traverseInfo.from !== rootAlias) {
        groupAlias = traverseInfo.from;
        traverseInfo = traverseMap.get(groupAlias);
      }

      // The grouping key is the traverse alias (e.g., "a1" for friends)
      const traverseProperty = traverseInfo
        ? localName(traverseInfo.property)
        : sourceAlias;

      let group = nestedGroupMap.get(sourceAlias);
      if (!group) {
        group = {
          key: traverseProperty,
          traverseAlias: sourceAlias,
          fields: [],
        };
        nestedGroupMap.set(sourceAlias, group);
      }
      group.fields.push({key: resultKey, sparqlVar, expression});
    }
  }

  return {
    rootVar: rootAlias,
    flatFields,
    nestedGroups: Array.from(nestedGroupMap.values()),
  };
}

// ---------------------------------------------------------------------------
// Main API: mapSparqlSelectResult
// ---------------------------------------------------------------------------

/**
 * Maps a SPARQL JSON result set back into the `SelectResult` shape expected
 * by the Linked DSL.
 *
 * 1. Walks `query.resultMap` to know which alias → result key mapping
 * 2. Walks `query.projection` to know each alias's expression type (for type coercion)
 * 3. For each binding row, extracts values by variable name, coerces types, handles missing → null
 * 4. Groups rows by root alias to reconstruct nested objects
 * 5. If `query.singleResult` → returns single row or null
 */
export function mapSparqlSelectResult(
  json: SparqlJsonResults,
  query: IRSelectQuery,
): SelectResult {
  const bindings = json.results.bindings;

  // If no resultMap, just return entity references
  if (!query.resultMap || query.resultMap.length === 0) {
    const rootVar = query.root.alias;
    const rows: ResultRow[] = [];
    const seenIds = new Set<string>();
    for (const binding of bindings) {
      const rootBinding = binding[rootVar];
      if (!rootBinding) continue;
      const id = rootBinding.value;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      rows.push({id});
    }
    if (query.singleResult) {
      return rows.length > 0 ? rows[0] : null;
    }
    return rows;
  }

  const descriptor = buildNestingDescriptor(query);

  // If there are no nested groups, produce flat rows
  if (descriptor.nestedGroups.length === 0) {
    return mapFlatRows(bindings, descriptor, query);
  }

  // Otherwise, group and nest
  return mapNestedRows(bindings, descriptor, query);
}

/**
 * Maps flat (non-nested) result rows — no traversals involved.
 */
function mapFlatRows(
  bindings: SparqlBinding[],
  descriptor: NestingDescriptor,
  query: IRSelectQuery,
): SelectResult {
  const rows: ResultRow[] = [];
  const seenIds = new Set<string>();

  for (const binding of bindings) {
    const rootBinding = binding[descriptor.rootVar];
    if (!rootBinding) continue;
    const id = rootBinding.value;

    // Deduplicate by root id
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const row: ResultRow = {id};
    for (const field of descriptor.flatFields) {
      const val = binding[field.sparqlVar];
      if (!val) {
        row[field.key] = null;
      } else if (isUriExpression(field.expression)) {
        // An alias_expr that resolved to a URI → wrap as nested entity ref
        row[field.key] = {id: val.value} as ResultRow;
      } else if (val.type === 'uri') {
        // A property_expr that returned a URI → entity reference
        row[field.key] = {id: val.value} as ResultRow;
      } else {
        row[field.key] = coerceValue(val);
      }
    }
    rows.push(row);
  }

  if (query.singleResult) {
    return rows.length > 0 ? rows[0] : null;
  }
  return rows;
}

/**
 * Maps nested result rows — groups flat SPARQL bindings by root entity,
 * then collects traversed entities into arrays.
 */
function mapNestedRows(
  bindings: SparqlBinding[],
  descriptor: NestingDescriptor,
  query: IRSelectQuery,
): SelectResult {
  // Group bindings by root entity id
  const rootGroups = new Map<
    string,
    {rootBinding: SparqlBinding; children: SparqlBinding[]}
  >();

  for (const binding of bindings) {
    const rootBindingVal = binding[descriptor.rootVar];
    if (!rootBindingVal) continue;
    const rootId = rootBindingVal.value;

    let group = rootGroups.get(rootId);
    if (!group) {
      group = {rootBinding: binding, children: []};
      rootGroups.set(rootId, group);
    }
    group.children.push(binding);
  }

  const rows: ResultRow[] = [];

  for (const [rootId, group] of rootGroups) {
    const row: ResultRow = {id: rootId};

    // Flat fields from the first binding (they're the same across all grouped rows)
    for (const field of descriptor.flatFields) {
      const val = group.rootBinding[field.sparqlVar];
      if (!val) {
        row[field.key] = null;
      } else if (val.type === 'uri') {
        row[field.key] = {id: val.value} as ResultRow;
      } else {
        row[field.key] = coerceValue(val);
      }
    }

    // Nested groups — collect traversed entities
    for (const nestedGroup of descriptor.nestedGroups) {
      const nestedRows = new Map<string, ResultRow>();

      for (const binding of group.children) {
        const nestedIdBinding = binding[nestedGroup.traverseAlias];
        if (!nestedIdBinding) continue;
        const nestedId = nestedIdBinding.value;

        if (!nestedRows.has(nestedId)) {
          const nestedRow: ResultRow = {id: nestedId};
          for (const field of nestedGroup.fields) {
            const val = binding[field.sparqlVar];
            if (!val) {
              nestedRow[field.key] = null;
            } else if (val.type === 'uri') {
              nestedRow[field.key] = {id: val.value} as ResultRow;
            } else {
              nestedRow[field.key] = coerceValue(val);
            }
          }
          nestedRows.set(nestedId, nestedRow);
        }
      }

      row[nestedGroup.key] = Array.from(nestedRows.values());
    }

    rows.push(row);
  }

  if (query.singleResult) {
    return rows.length > 0 ? rows[0] : null;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// mapSparqlCreateResult
// ---------------------------------------------------------------------------

/**
 * Constructs a `CreateResult` from a generated URI and the IR create mutation.
 * Echoes back the created fields as a `ResultRow` with the generated URI as `id`.
 */
export function mapSparqlCreateResult(
  generatedUri: string,
  query: IRCreateMutation,
): CreateResult {
  const row: ResultRow = {id: generatedUri};
  populateRowFromNodeData(row, query.data);
  return row;
}

/**
 * Recursively populates a ResultRow from IRNodeData.
 */
function populateRowFromNodeData(row: ResultRow, data: IRNodeData): void {
  for (const field of data.fields) {
    const key = localName(field.property);
    row[key] = fieldValueToResult(field.value);
  }
}

/**
 * Converts an IRFieldValue to the corresponding ResultFieldValue.
 */
function fieldValueToResult(value: IRFieldValue): ResultFieldValue {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value;
  if (value instanceof Date) return value;

  // NodeReferenceValue — has an id field
  if (typeof value === 'object' && 'id' in value && !('shape' in value) && !('fields' in value)) {
    return {id: (value as {id: string}).id} as ResultRow;
  }

  // IRNodeData — nested created entity
  if (typeof value === 'object' && 'shape' in value && 'fields' in value) {
    const nested = value as IRNodeData;
    const nestedRow: ResultRow = {id: nested.id || ''};
    populateRowFromNodeData(nestedRow, nested);
    return nestedRow;
  }

  // Array
  if (Array.isArray(value)) {
    return value.map((item) => {
      const result = fieldValueToResult(item);
      if (result && typeof result === 'object' && 'id' in result) {
        return result as ResultRow;
      }
      // Wrap primitive array items into rows if needed
      return result as any;
    });
  }

  return null;
}

// ---------------------------------------------------------------------------
// mapSparqlUpdateResult
// ---------------------------------------------------------------------------

/**
 * Constructs an `UpdateResult` from the IR update mutation.
 * Echoes back the updated fields as an `UpdateResult` with the target node's `id`.
 */
export function mapSparqlUpdateResult(query: IRUpdateMutation): UpdateResult {
  const result: UpdateResult = {id: query.id};

  for (const field of query.data.fields) {
    const key = localName(field.property);
    result[key] = fieldValueToResult(field.value);
  }

  return result;
}
