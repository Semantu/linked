import {Prefix} from './Prefix.js';

export type NodeReferenceValue = {id: string};

export type NodeReferenceInput = NodeReferenceValue | string;

/**
 * Resolve a string that looks like a prefixed name (e.g. 'foaf:knows') to its full IRI.
 * - Strings containing '://' are full IRIs — returned as-is.
 * - Strings without ':' are plain IDs — returned as-is.
 * - Strings matching 'prefix:local' are resolved via Prefix.toFullIfPossible()
 *   (returns original string if prefix is not registered).
 */
export function resolvePrefixedUri(str: string): string {
  if (str.includes('://')) return str;
  if (!str.includes(':')) return str;
  return Prefix.toFullIfPossible(str);
}

export function toNodeReference(value: NodeReferenceInput): NodeReferenceValue {
  if (typeof value === 'string') {
    return {id: resolvePrefixedUri(value)};
  }
  return {id: resolvePrefixedUri(value.id)};
}

export function isNodeReferenceValue(value: unknown): value is NodeReferenceValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof (value as NodeReferenceValue).id === 'string'
  );
}
