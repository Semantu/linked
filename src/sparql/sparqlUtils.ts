import {Prefix} from '../utils/Prefix.js';
import {ulid} from 'ulid';

export interface SparqlOptions {
  dataRoot?: string;
  prefixes?: Record<string, string>;
}

/**
 * Format a URI for SPARQL output.
 * Returns prefixed form (e.g. `rdf:type`) if a prefix is registered and the
 * suffix doesn't contain `/`. Otherwise returns `<full-uri>`.
 */
export function formatUri(uri: string): string {
  const prefixed = Prefix.toPrefixed(uri);
  if (prefixed) return prefixed;
  return `<${uri}>`;
}

/**
 * Escapes special characters in a string for use inside SPARQL double-quoted literals.
 * Per SPARQL 1.1 §19.7 (Escape sequences in strings).
 */
export function escapeSparqlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Format a literal value for SPARQL output.
 * Returns a quoted string with optional `^^<datatype>` suffix.
 * Special characters in the value are escaped per SPARQL spec.
 */
export function formatLiteral(
  value: string | number | boolean | Date,
  datatype?: string,
): string {
  let lexical: string;
  if (value instanceof Date) {
    lexical = value.toISOString();
  } else {
    lexical = String(value);
  }

  const escaped = escapeSparqlString(lexical);

  if (datatype) {
    return `"${escaped}"^^${formatUri(datatype)}`;
  }
  return `"${escaped}"`;
}

/**
 * Collect the minimal set of prefix→URI mappings needed for a set of URIs.
 * Only includes prefixes that are actually used (i.e. `Prefix.toPrefixed`
 * returns a value for at least one URI in the list).
 */
export function collectPrefixes(usedUris: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const uri of usedUris) {
    const match = Prefix.findMatch(uri);
    if (match.length > 0) {
      const [ontologyUri, prefix, postFix] = match;
      // Only include if the postfix is actually prefixable (no `/`)
      if (!postFix.includes('/')) {
        result[prefix] = ontologyUri;
      }
    }
  }
  return result;
}

/**
 * Generate a new entity URI for a create mutation.
 * Format: `{dataRoot}/{lowercaseShapeLabel}_{ulid}`
 */
export function generateEntityUri(
  shape: string,
  options?: SparqlOptions,
): string {
  const dataRoot =
    options?.dataRoot || process.env.DATA_ROOT || 'http://example.org/data';

  // Extract the shape label from the full URI (last segment after # or /)
  let label: string;
  const hashIdx = shape.lastIndexOf('#');
  if (hashIdx >= 0) {
    label = shape.substring(hashIdx + 1);
  } else {
    const slashIdx = shape.lastIndexOf('/');
    label = slashIdx >= 0 ? shape.substring(slashIdx + 1) : shape;
  }

  return `${dataRoot}/${label.toLowerCase()}_${ulid()}`;
}
