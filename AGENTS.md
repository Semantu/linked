# AGENTS.md — @_linked/core repository

## Repository structure

Single-package repository for `@_linked/core` (query DSL, SHACL shape decorators, package registration, LinkedStorage). No internal package dependencies.

Tests: `npm test`

## Agent docs (`docs/`)

Use this folder structure:

- `docs/ideas` — brainstorming and exploration notes
- `docs/plans` — architecture and implementation planning docs
- `docs/reports` — implementation status, deviations, and wrap-up reports
- `docs/agents/skills` — workflow and mode skill definitions

For `docs/ideas`, `docs/plans`, and `docs/reports`: files are numbered with a 3-digit prefix for ordering within each folder. Names should be explicit about contents (lowercase-dash format). Each file starts with YAML frontmatter:

```yaml
---
summary: One-line description of what this document covers
packages: [core, react]
---
```

```bash
ls docs/ideas docs/plans docs/reports
head -4 docs/ideas/*.md
head -4 docs/plans/*.md
head -4 docs/reports/*.md
find docs/agents/skills -name SKILL.md | sort
```

## Workflow skill

Prefer using the `workflow` skill for any task that touches code or changes plans/docs.
If the user requests a specific mode (e.g. “Review: …”), follow only that mode.
