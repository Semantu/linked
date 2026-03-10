import type {PropertyPath} from './PropertyPath.js';

/**
 * Represents a filter condition attached to a property path.
 *
 * Used by FieldSet scoped filters and QueryBuilder .where() clauses
 * to express conditions like `path.equals(value)` or `path.gt(value)`.
 *
 * This is a data-oriented representation — the actual condition objects
 * used by the current DSL (Evaluation, WhereEvaluationPath, etc.) remain
 * in SelectQuery.ts. This type will become the canonical representation
 * when QueryBuilder replaces the DSL internals in Phase 2.
 */
export type WhereOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'some' | 'every';

export type WhereCondition = {
  path: PropertyPath;
  operator: WhereOperator;
  value: unknown;
};
