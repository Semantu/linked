# AGENTS.md — @_linked/core repository

## Repository structure

Single-package repository for `@_linked/core` (query DSL, SHACL shape decorators, package registration, LinkedStorage). No internal package dependencies.

Tests: `npm test`

## Agent docs (`docs/`)

Use this folder structure:

- `docs/ideas` — brainstorming and exploration notes
- `docs/plans` — architecture and implementation planning docs
- `docs/reports` — implementation status, deviations, and wrap-up reports

Files are numbered with a 3-digit prefix for ordering within each folder. Names should be explicit about contents (lowercase-dash format). Every file starts with YAML frontmatter:

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
```

## Planning and implementation workflow

### When to ideate/plan

Any task that changes package code requires ideation and planning before implementation. Simple checks, info gathering, and discussions do not.

### Ideation / brainstorming

1. **Inspect the relevant code thoroughly** before writing anything. Read the source files, tests, and existing docs that relate to the task.
2. Create or update an ideas doc in `docs/ideas` with the next 3-digit prefix (e.g. `005-add-filter-support.md`) **for new feature/PR scope**. For follow-ups in the same thread/PR scope, update the existing ideas doc. Start with YAML frontmatter.
3. Use ideation to explore potential implementation routes. There may be multiple architecture decisions, each with multiple possible approaches.
4. Capture exploration details with:
   - **Key considerations and choices** — tradeoffs, open questions, alternatives
   - **Potential problems** — what could go wrong, edge cases
   - **Pros and cons per route** — clear comparison of approaches
5. During ideation, incorporate user feedback to narrow and choose approaches.

### Writing the initial plan (on user request)

1. Convert the ideation doc into a plan **only on user request**.
2. Create or update a plan doc in `docs/plans` with the next 3-digit prefix for the feature/PR scope.
3. The initial plan should focus on the **chosen route(s)**, not all explored routes. Include:
   - Main architecture decisions
   - Files expected to change
   - Small code examples where useful
   - Potential pitfalls
   - Remaining unclear areas or decisions still to be made
4. Tradeoffs may be included only to explain why the chosen path was selected.
5. **Do not include phases/tasks yet** in the initial plan.
6. Ask the user to review the plan, then keep updating it from user feedback until scope and decisions are clear.

### Breaking the plan into phases/tasks (on user request)

1. Expand the existing plan doc in `docs/plans` with ordered implementation phases/tasks.
2. Each phase must have clear validation criteria (for example: unit tests, integration tests, build/typecheck commands).
3. Implementation begins only on explicit user request.

### Implementing phases

- **One commit per phase.** Include the plan doc update (marking the phase complete) in the same commit.
- **Every phase must be validated** — at minimum one relevant passing test.
- If there are **no deviations and no major problems**, continue into the next phase without pausing for approval.
- If there are **deviations from the plan or major problems**, pause and report to the user before continuing. Include questions when a decision is needed.
- When reporting after a pause, include:
  - What was done
  - Any deviations from the plan
  - Problems encountered
  - Validation results (pass/fail counts and what was tested)
  - What you plan to do next

### Wrapping up

Before committing final changes or preparing a PR:

1. **Consolidate the plan doc** — collapse alternatives into the choices that were made, summarize implementation details and breaking changes, keep a brief problems section if relevant, remove anything redundant for future readers.
2. **Review implementation thoroughly** — remove dead code related to the feature, add clarifying comments in changed code where needed, and note any remaining work required to fully achieve the main goal.
3. **Run changesets** Ask the user if this is a patch/minor/major change, then run `npx changesets/cli` and provide an appropriate changelog message covering behavior changes, new APIs, breaking changes, and migration steps.
