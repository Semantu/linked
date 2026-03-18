import {Prefix} from './Prefix.js';

export type NodeReferenceValue = {id: string};

export type NodeReferenceInput = NodeReferenceValue | string;

/**
 * Resolve a string that looks like a prefixed name (e.g. 'foaf:knows') to its full IRI.
 * - Strings containing '://' are full IRIs — returned as-is.
 * - Strings without ':' are plain IDs — returned as-is.
 * - Strings matching 'prefix:local' are resolved via Prefix.toFullIfPossible()
 *   (returns original string if prefix is not registered).
 *
 * @example
 * resolvePrefixedUri('foaf:Person')         // 'http://xmlns.com/foaf/0.1/Person'
 * resolvePrefixedUri('http://example.org/x') // 'http://example.org/x' (unchanged)
 * resolvePrefixedUri('my-id')                // 'my-id' (unchanged, no colon)
 */
export function resolvePrefixedUri(str: string): string {
  if (str.includes('://')) return str;
  if (!str.includes(':')) return str;
  return Prefix.toFullIfPossible(str);
}

/**
 * Convert a NodeReferenceInput to a NodeReferenceValue.
 * Simple wrap — no prefix resolution. Use resolvePrefixedUri() for that.
 */
export function toNodeReference(value: NodeReferenceInput): NodeReferenceValue {
  if (typeof value === 'string') {
    return {id: value};
  }
  return {id: value.id};
}

export function isNodeReferenceValue(value: unknown): value is NodeReferenceValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof (value as NodeReferenceValue).id === 'string'
  );
}
