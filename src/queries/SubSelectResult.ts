import type {Shape, ShapeType} from '../shapes/Shape.js';
import type {QueryPath, CustomQueryObject} from './SelectQuery.js';

/**
 * Type-only interface representing a sub-select result — a nested property path selection
 * within a query. This is NOT a SPARQL sub-query; it represents selecting multiple continued
 * paths from the same root (e.g. `p.friends.select(f => ({name: f.name, age: f.age}))`).
 *
 * At runtime, sub-selects produce FieldSets. This interface exists so that conditional types
 * (GetQueryResponseType, QueryResponseToResultType, etc.) can pattern-match on
 * `SubSelectResult<S, ResponseType, Source>` for sub-select result type inference.
 */
export interface SubSelectResult<
  S extends Shape = Shape,
  ResponseType = any,
  Source = any,
> {
  traceResponse: ResponseType;
  parentQueryPath: QueryPath;
  shape: ShapeType<S>;
  getQueryPaths(): CustomQueryObject | QueryPath[];
  /** Phantom field to preserve Source type for conditional type inference */
  readonly __source?: Source;
}

/**
 * @deprecated Use SubSelectResult instead. Kept as alias for backward compatibility.
 */
export type SelectQueryFactory<
  S extends Shape = Shape,
  ResponseType = any,
  Source = any,
> = SubSelectResult<S, ResponseType, Source>;
