---
summary: Design utilities for dynamically building IR queries — variable shapes, variable property paths, shared path endpoints, and programmatic query construction.
packages: [core]
---

# Dynamic IR Construction

## Status: placeholder

This ideation doc is a placeholder for future design work on building IR queries programmatically, beyond the static Shape DSL.

## Key areas to explore

1. **Variable shapes**: Build queries where the target shape is determined at runtime, not compile time.
2. **Variable property paths**: Construct traversal paths dynamically (e.g. from a configuration or user input).
3. **Shared path endpoints (variables in DSL)**: When the result of one path needs to be referenced in another path — e.g. "find persons whose best friend's hobby matches any of their own friends' hobbies". This requires introducing variable-like references into the DSL.
4. **Programmatic IR building**: Utility functions to construct `SelectQuery`, `CreateQuery`, etc. directly without going through the Shape DSL pipeline. Useful for generated queries, migration scripts, admin tools.
5. **IR composition**: Combining partial IR fragments into larger queries.

## Relationship to SPARQL conversion (001)

These dynamic IR features produce the same IR types (`SelectQuery`, etc.) that the SPARQL conversion layer consumes. No changes needed on the SPARQL side — the conversion is IR-in, SPARQL-out regardless of how the IR was built.

## Relationship to DSL expansion

The Shape DSL will also expand to cover more SPARQL features (FILTER NOT EXISTS, MINUS, proper subqueries, advanced property paths). Some of those may be better expressed through dynamic construction rather than chained method calls.
