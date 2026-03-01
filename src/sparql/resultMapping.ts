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

type FieldDescriptor = {
  key: string;
  sparqlVar: string;
  expression: IRExpression;
};

type NestedGroup = {
  key: string;
  traverseAlias: string;
  flatFields: FieldDescriptor[];
  nestedGroups: NestedGroup[];
};

type NestingDescriptor = {
  /** The root alias variable name (e.g. "a0") */
  rootVar: string;
  /** Flat fields: fields directly on the root entity */
  flatFields: FieldDescriptor[];
  /** Nested groups: fields that come from traversed entities (recursive) */
  nestedGroups: NestedGroup[];
};

/**
 * Builds the alias chain from sourceAlias back to rootAlias by walking the traverseMap.
 * Returns the chain from root outward, e.g. [{alias: "a1", property: "friends"}, {alias: "a2", property: "bestFriend"}].
 */
function buildAliasChain(
  sourceAlias: string,
  rootAlias: string,
  traverseMap: Map<string, {from: string; property: string}>,
): Array<{alias: string; property: string}> {
  const chain: Array<{alias: string; property: string}> = [];
  let current = sourceAlias;
  while (current !== rootAlias) {
    const info = traverseMap.get(current);
    if (!info) break;
    chain.unshift({alias: current, property: info.property});
    current = info.from;
  }
  return chain;
}

/**
 * Inserts a field into the nesting tree at the position described by the alias chain.
 * Creates intermediate NestedGroup nodes as needed.
 */
function insertIntoTree(
  root: {flatFields: FieldDescriptor[]; nestedGroups: NestedGroup[]},
  chain: Array<{alias: string; property: string}>,
  field: FieldDescriptor,
): void {
  if (chain.length === 0) {
    // Skip alias_expr fields that match the group's traverseAlias — the entity's
    // id is already captured by collectNestedGroup via binding[traverseAlias].
    if (
      field.expression.kind === 'alias_expr' &&
      'traverseAlias' in root &&
      field.expression.alias === (root as NestedGroup).traverseAlias
    ) {
      return;
    }
    root.flatFields.push(field);
    return;
  }

  const target = chain[0];
  let group = root.nestedGroups.find((g) => g.traverseAlias === target.alias);
  if (!group) {
    group = {
      key: localName(target.property),
      traverseAlias: target.alias,
      flatFields: [],
      nestedGroups: [],
    };
    root.nestedGroups.push(group);
  }

  // Recurse: remaining chain determines where the field sits within this group
  insertIntoTree(group, chain.slice(1), field);
}

/**
 * Analyzes the query structure to build a recursive nesting descriptor that guides
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

  const descriptor: NestingDescriptor = {
    rootVar: rootAlias,
    flatFields: [],
    nestedGroups: [],
  };

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

    const field: FieldDescriptor = {key: resultKey, sparqlVar, expression};

    if (sourceAlias === rootAlias) {
      descriptor.flatFields.push(field);
    } else {
      // Build the full chain from root to sourceAlias and insert into tree
      const chain = buildAliasChain(sourceAlias, rootAlias, traverseMap);
      insertIntoTree(descriptor, chain, field);
    }
  }

  // Validate: no duplicate keys at the flat level
  const flatKeys = descriptor.flatFields.map((f) => f.key);
  const dupFlat = flatKeys.find((k, i) => flatKeys.indexOf(k) !== i);
  if (dupFlat) {
    throw new Error(
      `Duplicate result key "${dupFlat}" in projection. ` +
      `Two properties with the same local name cannot appear in the same projection.`,
    );
  }

  return descriptor;
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
      } else if (isUriExpression(field.expression) && val.type === 'uri') {
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
 * Populates fields on a ResultRow from a single SPARQL binding.
 * Handles URI expressions (entity references) and literal coercion.
 */
function populateFields(row: ResultRow, fields: FieldDescriptor[], binding: SparqlBinding): void {
  for (const field of fields) {
    const val = binding[field.sparqlVar];
    if (!val) {
      row[field.key] = null;
    } else if (isUriExpression(field.expression) && val.type === 'uri') {
      row[field.key] = {id: val.value} as ResultRow;
    } else if (val.type === 'uri') {
      row[field.key] = {id: val.value} as ResultRow;
    } else {
      row[field.key] = coerceValue(val);
    }
  }
}

/**
 * Scans bindings to identify which nested groups represent literal property
 * traversals (e.g. `p.hobby.where(h => h.equals('Jogging'))`) vs entity
 * traversals. Returns a set of traverse aliases that resolve to literals.
 *
 * Scans ALL non-null bindings for each group to validate type consistency.
 * If mixed types are found (both URI and literal), defaults to literal
 * treatment — coerceValue handles both safely.
 */
function detectLiteralTraversals(
  groups: NestedGroup[],
  bindings: SparqlBinding[],
): Set<string> {
  const literalAliases = new Set<string>();
  for (const group of groups) {
    let seenUri = false;
    let seenLiteral = false;
    for (const binding of bindings) {
      const val = binding[group.traverseAlias];
      if (!val) continue;
      if (val.type === 'uri') seenUri = true;
      else seenLiteral = true;
    }
    // Literal-only or mixed types → treat as literal (safe fallback)
    if (seenLiteral) {
      literalAliases.add(group.traverseAlias);
    }
  }
  return literalAliases;
}

/**
 * Collects the coerced literal value from a nested group that traverses a
 * datatype property. Returns the first non-null value, or null if absent.
 */
function collectLiteralTraversalValue(
  nestedGroup: NestedGroup,
  bindings: SparqlBinding[],
): ResultFieldValue {
  for (const binding of bindings) {
    const val = binding[nestedGroup.traverseAlias];
    if (!val) continue;
    return coerceValue(val);
  }
  return null;
}

/**
 * Recursively collects entities for a nested group from a set of bindings.
 * Groups bindings by the nested entity's ID, populates fields, and recurses
 * into any deeper nested groups.
 */
function collectNestedGroup(
  nestedGroup: NestedGroup,
  bindings: SparqlBinding[],
): ResultRow[] {
  const entityMap = new Map<string, {row: ResultRow; bindings: SparqlBinding[]}>();

  for (const binding of bindings) {
    const idBinding = binding[nestedGroup.traverseAlias];
    if (!idBinding) continue;
    const entityId = idBinding.value;

    let entry = entityMap.get(entityId);
    if (!entry) {
      const nestedRow: ResultRow = {id: entityId};
      populateFields(nestedRow, nestedGroup.flatFields, binding);
      entry = {row: nestedRow, bindings: []};
      entityMap.set(entityId, entry);
    }
    entry.bindings.push(binding);
  }

  // Recurse into deeper nested groups
  const allNestedBindings = Array.from(entityMap.values()).flatMap((e) => e.bindings);
  const deepLiteralAliases = detectLiteralTraversals(nestedGroup.nestedGroups, allNestedBindings);
  for (const [, entry] of entityMap) {
    for (const deeperGroup of nestedGroup.nestedGroups) {
      if (deepLiteralAliases.has(deeperGroup.traverseAlias)) {
        entry.row[deeperGroup.key] = collectLiteralTraversalValue(deeperGroup, entry.bindings);
      } else {
        entry.row[deeperGroup.key] = collectNestedGroup(deeperGroup, entry.bindings);
      }
    }
  }

  return Array.from(entityMap.values()).map((e) => e.row);
}

/**
 * Maps nested result rows — groups flat SPARQL bindings by root entity,
 * then recursively collects traversed entities into nested arrays.
 */
function mapNestedRows(
  bindings: SparqlBinding[],
  descriptor: NestingDescriptor,
  query: IRSelectQuery,
): SelectResult {
  // Group bindings by root entity id
  const rootGroups = new Map<string, SparqlBinding[]>();

  for (const binding of bindings) {
    const rootBindingVal = binding[descriptor.rootVar];
    if (!rootBindingVal) continue;
    const rootId = rootBindingVal.value;

    let group = rootGroups.get(rootId);
    if (!group) {
      group = [];
      rootGroups.set(rootId, group);
    }
    group.push(binding);
  }

  // Pre-scan ALL bindings to determine which nested groups are literal traversals.
  // This must span all root groups because a specific root entity may have no
  // binding for the alias (OPTIONAL miss) — we need at least one bound value
  // to know the type.
  const literalAliases = detectLiteralTraversals(descriptor.nestedGroups, bindings);

  const rows: ResultRow[] = [];

  for (const [rootId, groupBindings] of rootGroups) {
    const row: ResultRow = {id: rootId};

    // Flat fields from the first binding (they're the same across all grouped rows)
    populateFields(row, descriptor.flatFields, groupBindings[0]);

    // Nested groups — recursively collect traversed entities (or literal values)
    for (const nestedGroup of descriptor.nestedGroups) {
      if (literalAliases.has(nestedGroup.traverseAlias)) {
        row[nestedGroup.key] = collectLiteralTraversalValue(nestedGroup, groupBindings);
      } else {
        row[nestedGroup.key] = collectNestedGroup(nestedGroup, groupBindings);
      }
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
