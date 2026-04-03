# 013 — Fix flat multi-value property projection

## Problem

Both `mapFlatRows` and `mapNestedRows` in `resultMapping.ts` discard duplicate SPARQL bindings for multi-value flat fields. `mapFlatRows` deduplicates by root ID and takes only the first binding. `mapNestedRows` takes `groupBindings[0]` for flat fields. This means queries like `Person.select(p => p.friends)` return a single entity reference for `friends` instead of an array.

## Decision 1: Where to store maxCount for flat property projections

### Alternatives

1. **Add `maxCount` to `IRPropertyExpression`** — Natural placement. Consistent with `IRTraversePattern.maxCount`. Lowering code already has `step.maxCount` available.
2. **Add `maxCount` to `FieldDescriptor` only** — Localized, but no source for the data since flat fields have no pattern to look up.
3. **Add `maxCount` to `IRResultMapEntry`** — Minimal change, but semantically wrong location.

### Selected: Option 1

Add `maxCount?: number` to `IRPropertyExpression`. Propagate from `step.maxCount` in `IRProjection.ts` when building property_expr for last steps. In result mapping, propagate to `FieldDescriptor` and use to decide single vs multi-value collection.

## Decision 2: How to collect multi-value flat fields

### Alternatives

1. **Refactor both `mapFlatRows` and `mapNestedRows`** to group by root ID, then collect multi-value fields into arrays.
2. **Merge both into a single group-based path** — over-engineering.

### Selected: Option 1

- `mapFlatRows`: change from dedup-first to group-first. For each root, iterate all bindings and collect multi-value field values into arrays.
- `mapNestedRows`: update flat field population at line 551 to iterate all `groupBindings` for multi-value fields.
