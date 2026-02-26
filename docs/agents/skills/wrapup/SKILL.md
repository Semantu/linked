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
3. In the report doc, keep a higher-level overview of what changed and why; remove low-level implementation detail that is not needed for future context.
4. Consolidate remaining tradeoffs/choices into final decisions made and rationale.
5. Remove dead code related to the implemented scope.
6. Add clarifying comments in changed code where needed.
7. Verify documentation coverage for what changed.
8. Run a PR-readiness checklist and identify anything missing (for example: docs updates, tests/validation evidence, plan/report consistency, release notes).
9. If anything is missing, notify the user with a concrete checklist and ask whether to add/fix the missing items now.
10. Changeset handling:
    - If no package code or release behavior changed, changeset is not required (note this explicitly in plan/report).
    - Otherwise ask user for version bump level (patch/minor/major), then run `npx changesets/cli`.
11. Draft a PR title and PR message/body summarizing changes, validation, and follow-up notes.
12. After the report is reviewed and approved by the user, remove `docs/plans/<nnn>-<topic>.md`.

## Output

- Updated `docs/plans/<nnn>-<topic>.md` with `## REVIEW` section at end.
- Final report at `docs/reports/<nnn>-<topic>.md`.

## Exit criteria

- Cleanup and documentation checks are complete.
- PR readiness gaps (if any) were surfaced to the user and a decision was collected.
- Changeset requirement is resolved (prepared, or explicitly skipped for docs-only/no-code-change scope).
- PR title and message are ready.
- Final report is approved and the corresponding plan doc has been removed.
