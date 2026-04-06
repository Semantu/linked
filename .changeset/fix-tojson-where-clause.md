---
"@_linked/core": patch
---

Fix QueryBuilder.toJSON() to serialize where clauses, sort keys, minus entries, preloads, and other missing fields

`QueryBuilder.toJSON()` was silently dropping several fields during serialization, making JSON round-trips lossy. The following are now correctly serialized and restored via `fromJSON()`:

- **Where clauses** (`.where(p => p.name.equals('Bob'))`) — previously lost entirely
- **Sort keys** (`.orderBy(p => p.name, 'DESC')`) — previously only the direction was preserved, not the sort key
- **Minus entries** (`.minus(Employee)`, `.minus(p => p.hobby.equals('Chess'))`) — previously lost entirely
- **Preloads** (`.preload('bestFriend', component)`) — merged into the FieldSet as subSelect entries
- **Null subject flag** (`.for(null)`) and **pending context name** — previously lost

All callback-based fields are evaluated through the proxy at serialization time and stored as plain data structures. On deserialization, they are restored as pre-evaluated data and used directly during query building.
