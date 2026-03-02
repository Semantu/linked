---
name: wrapup
description: Finalize cleanup and release prep by removing dead code, improving comments/docs, running changesets, and drafting PR title/message.
---

# Instructions

## Trigger

Run only when the user explicitly confirms wrapup mode.
Also treat any user request to prepare/open/update a PR, or draft PR title/body/message, as an explicit wrapup request.

## Steps

1. Update `docs/plans/<nnn>-<topic>.md` by appending a `## REVIEW` section at the end with wrapup outcomes and PR-readiness status.
2. Convert `docs/plans/<nnn>-<topic>.md` into a report doc in `docs/reports/<nnn>-<topic>.md`.
   - For this conversion, the report `<nnn>` MUST be the next available 3-digit prefix in `docs/reports` (do not reuse the plan prefix when it conflicts).
   - Update any references to the report path after conversion.
3. **Report quality** — see the dedicated section below. The report is a condensed but comprehensive record of everything that was done. It is NOT a brief summary.
4. Consolidate remaining tradeoffs/choices into final decisions made and rationale.
5. Remove dead code related to the implemented scope.
6. Add clarifying comments in changed code where needed.
7. Verify documentation coverage for what changed.
8. Run a PR-readiness checklist and identify anything missing (for example: docs updates, tests/validation evidence, plan/report consistency, release notes).
9. If anything is missing, notify the user with a concrete checklist and ask whether to add/fix the missing items now.
10. Changeset handling — see the dedicated section below.
11. Draft a PR title and PR message/body summarizing changes, validation, and follow-up notes.
12. After the report is reviewed and approved by the user, remove `docs/plans/<nnn>-<topic>.md`.

## Report quality

The report replaces the plan as the permanent record. Any agent working on code that interacts with the changed code must be able to understand from this document what was built, how it works, and what decisions were made. The report should be proportional to the scope of the plan — a large plan produces a substantial report.

**What to keep from the plan (condense but do NOT drop):**
- Architecture overview and pipeline description
- All key design decisions with rationale (e.g., why OPTIONAL wrapping, why VariableRegistry, why DELETE/INSERT/WHERE over DELETE WHERE)
- File structure with each file's responsibility
- Public API surface (exported functions, classes, types) with usage examples
- Conversion/mapping rules (e.g., IR node → algebra node mapping tables)
- All resolved gaps, bugs, and edge cases with their chosen approach
- Test coverage summary (which test files, what they cover, total counts)
- Known limitations and remaining test gaps
- Deferred work with pointers to ideation docs
- Links to relevant documentation files (e.g., `documentation/sparql-algebra.md`)
- PR reference (number and URL) when a PR was created during this scope
- Anything that affects future work or that future agents need to know

**What to remove from the plan:**
- Alternative approaches that were NOT chosen (unless the rationale for rejection informs future decisions)
- Per-phase task checklists and status markers (the work is done)
- Detailed per-test assertions (keep test file names and what they cover, drop individual assertion lists)
- Inline code snippets that duplicate what's in the actual source files (keep small illustrative examples)
- Validation command logs

**Sizing guideline:** If the plan was 500+ lines, the report should be at least 150-300 lines. A 10-line report for a 3000-line plan means critical information was lost.

## Changeset handling

**Always create a changeset** when package code changed, even if other changesets already exist. Each changeset becomes a separate entry in the public changelog via CI/CD, so it should describe what users of the library need to know about THIS set of changes.

A changeset is only skippable when the scope is purely internal (docs, CI config, dev tooling) with zero impact on the published package.

**Changeset content must be user-facing and actionable:**
- List new exports, classes, functions, and types that users can now import
- Describe new capabilities and how to use them (brief code examples)
- Note any breaking changes or behavioral differences
- Reference documentation files where users can learn more
- Do NOT write vague summaries like "added SPARQL support" — be specific about what was added and how to use it

**Process:**
- Ask the user for the version bump level (patch/minor/major) unless they already specified it.
- The `npx @changesets/cli add` command requires interactive TTY input, which is not available in agent environments. Instead, write the changeset file directly to `.changeset/` — this is the standard approach for CI/automation and produces identical results. Use the standard format: YAML frontmatter with package name and bump level, followed by markdown description. Use a descriptive kebab-case filename (e.g., `sparql-conversion-layer.md`).

## Output

- Updated `docs/plans/<nnn>-<topic>.md` with `## REVIEW` section at end.
- Final report at `docs/reports/<nnn>-<topic>.md`.
- Changeset file in `.changeset/` (when applicable).

## Exit criteria

- Cleanup and documentation checks are complete.
- PR readiness gaps (if any) were surfaced to the user and a decision was collected.
- Changeset requirement is resolved (prepared, or explicitly skipped for docs-only/no-code-change scope).
- PR title and message are ready.
- Final report is approved and the corresponding plan doc has been removed.
