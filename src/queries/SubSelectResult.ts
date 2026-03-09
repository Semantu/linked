import type {FieldSet} from './FieldSet.js';

/**
 * @deprecated Sub-selects now return FieldSet<R, Source> directly.
 * This type is kept as an alias for backward compatibility.
 */
export type SubSelectResult<
  _S = any,
  ResponseType = any,
  Source = any,
> = FieldSet<ResponseType, Source>;

/**
 * @deprecated Use FieldSet instead. Kept as alias for backward compatibility.
 */
export type SelectQueryFactory<
  _S = any,
  ResponseType = any,
  Source = any,
> = FieldSet<ResponseType, Source>;
