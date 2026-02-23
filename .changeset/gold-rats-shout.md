---
"@_linked/core": minor
---

Introduce canonical Intermediate Representation (IR) support for query and mutation objects.

- Add select-query IR pipeline stages (desugar, canonicalize, projection, alias scope, pipeline helpers) and expose `getCanonicalIR()` on select factories.
- Add canonical mutation IR conversion for create/update/delete query objects.
- Add IR documentation and parity/golden test coverage for select and mutation conversion behavior.
