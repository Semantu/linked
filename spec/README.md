# Linked IR Specification

This directory contains the **language-agnostic specification** for the Linked query IR (Intermediate Representation) and a conformance test suite for validating implementations across languages (TypeScript, Python, PHP, Rust, etc.).

## Structure

```
spec/
  ir/
    schema.json              JSON Schema for all IR types (select, create, update, delete)
  conformance/
    shapes.json              Test shape definitions (Person, Employee, Pet, Dog)
    select/
      basic-select.json      Basic property selection
      subject-targeting.json Subject ID targeting and .one()
      nested-traversal.json  Property path traversals (friends.name, etc.)
      inline-where.json      Inline where filters on traversals
      outer-where.json       Query-level WHERE, some(), every()
      aggregation.json       COUNT, GROUP BY, HAVING
      ordering.json          ORDER BY ASC/DESC
      sub-select.json        Nested sub-selects with custom objects
      shape-casting.json     .as(Dog) type casting
      inheritance.json       Employee extends Person
      minus.json             MINUS exclusion patterns
    mutations/
      mutations.json         Create, update, delete mutations
  README.md                  This file
```

## Conformance test format

Each fixture file is a JSON array of test cases:

```json
[
  {
    "name": "selectName",
    "description": "Select name property from Person",
    "ir": {
      "kind": "select",
      "root": {"kind": "shape_scan", "shape": "...", "alias": "a0"},
      "patterns": [],
      "projection": [
        {
          "alias": "a1",
          "expression": {"kind": "property_expr", "sourceAlias": "a0", "property": "..."}
        }
      ],
      "singleResult": false,
      "resultMap": [{"key": "...", "alias": "a1"}]
    },
    "expectedSparql": "PREFIX rdf: ...\nSELECT DISTINCT ..."
  }
]
```

Each test case has:

| Field | Required | Description |
|---|---|---|
| `name` | yes | Unique test identifier |
| `description` | yes | Human-readable description |
| `ir` | yes | The canonical IR object (validated against `ir/schema.json`) |
| `expectedSparql` | no | Expected SPARQL output (for SPARQL-targeting implementations) |

## How to use these tests

### Level 1: IR-to-SPARQL conformance

The simplest starting point. Your implementation reads the `ir` field and compiles it to SPARQL, then compares against `expectedSparql`.

```python
# Python example
import json

with open("spec/conformance/select/basic-select.json") as f:
    fixtures = json.load(f)

for fixture in fixtures:
    ir = fixture["ir"]
    expected = fixture["expectedSparql"]
    actual = ir_to_sparql(ir)  # your implementation
    assert actual == expected, f"{fixture['name']}: mismatch"
```

```rust
// Rust example
let fixtures: Vec<Fixture> = serde_json::from_str(&std::fs::read_to_string(
    "spec/conformance/select/basic-select.json"
)?)?;

for fixture in &fixtures {
    let actual = ir_to_sparql(&fixture.ir);
    assert_eq!(actual, fixture.expected_sparql.as_ref().unwrap());
}
```

### Level 2: Query builder JSON-to-IR conformance

If your port includes a query builder, verify it produces the same IR from the same `QueryBuilderJSON` input (see `ir/schema.json` for `QueryBuilderJSON` format).

### Level 3: Full DSL conformance

If your port has a native DSL (e.g., Python dataclass-based query builder), verify the DSL produces identical IR to the TypeScript reference implementation for equivalent queries.

## Test shapes

The `conformance/shapes.json` file defines the shapes used in all test cases:

- **Person** - name, hobby, nickNames, birthDate, isRealPerson, bestFriend, friends, pets, firstPet
- **Employee** (extends Person) - name (override), bestFriend (override), department
- **Pet** - bestFriend
- **Dog** (extends Pet) - guardDogLevel

Implementations must register these shapes before running conformance tests.

## Updating fixtures

Fixtures are extracted from the TypeScript reference implementation using:

```bash
npx jest --runInBand src/tests/extract-conformance-fixtures.test.ts
```

This captures the IR and SPARQL output from each query factory and writes them to `spec/conformance/`.

## IR Schema

The `ir/schema.json` file is a JSON Schema (draft 2020-12) covering all IR types:

- **Select queries**: `IRSelectQuery` with patterns, projection, where, orderBy, limit/offset
- **Graph patterns**: shape_scan, traverse, join, optional, union, exists, minus
- **Expressions**: literal, reference, alias, property, binary, logical, not, function, aggregate, exists
- **Mutations**: create, update, delete, delete_all, delete_where, update_where

Use it to validate IR output in any language:

```bash
# Validate with ajv-cli
npx ajv validate -s spec/ir/schema.json -d spec/conformance/select/basic-select.json
```

## Versioning

This spec follows semantic versioning. Each language port declares which spec version it conforms to:

- **spec-1.0**: Initial release with select queries, mutations, and SPARQL target
- Future versions may add new expression types, graph patterns, or target languages (SQL, GraphQL)

Breaking changes (removing/renaming IR fields) require a major version bump. Additive changes (new expression kinds, new pattern types) are minor versions.
