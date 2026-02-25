---
name: wrapup
description: Finalize cleanup and release prep by removing dead code, improving comments/docs, running changesets, and drafting PR title/message.
---

# Instructions

## Trigger

Run when the user requests wrapup mode, typically after review.

## Steps

1. Convert `docs/plans/<nnn>-<topic>.md` into a report doc in `docs/reports/<nnn>-<topic>.md`.
2. In the report doc, keep a higher-level overview of what changed and why; remove low-level implementation detail that is not needed for future context.
3. Consolidate remaining tradeoffs/choices into final decisions made and rationale.
4. Remove dead code related to the implemented scope.
5. Add clarifying comments in changed code where needed.
6. Verify documentation coverage for what changed.
7. Ask user for version bump level (patch/minor/major), then run `npx changesets/cli`.
8. Draft a PR title and PR message/body summarizing changes, validation, and follow-up notes.
9. After the report is reviewed and approved by the user, remove `docs/plans/<nnn>-<topic>.md`.

## Output

Create/update wrapup notes in `docs/reports` including:

- Cleanup done
- Docs/comments updates
- Changeset summary
- Proposed PR title
- Proposed PR body
- Final report path
- Whether the plan file has been removed after approval

## Exit criteria

- Cleanup and documentation checks are complete.
- Changeset is prepared.
- PR title and message are ready.
- Final report is approved and the corresponding plan doc has been removed.
