# 014 — Fix flat multi-value literal field collection

## Problem

`populateFlatFields` in `resultMapping.ts` filters multi-value collected values with `typeof extracted === 'object' && 'id' in extracted`, silently dropping literal values (strings, numbers, booleans, dates). Multi-value literal properties like `nickNames: string[]` return empty arrays.

## Decision 1: ResultFieldValue type widening

Add primitive array types (`string[]`, `number[]`, `boolean[]`, `Date[]`) to `ResultFieldValue` union. This is explicit and type-safe.

## Decision 2: Filter logic

Remove the object/id guard in `populateFlatFields`. Collect all non-null `extractFieldValue` results into the array.
