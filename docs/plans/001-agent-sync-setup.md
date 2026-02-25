---
summary: Plan to add an explicit setup script that syncs docs/agents into local Claude/Codex directories
packages: [core]
---

# Main architecture decisions

- Use a small Node script (`scripts/sync-agents.mjs`) for cross-platform directory copy.
- Keep setup explicit via npm scripts, no git hooks.
- Copy source `docs/agents` to:
  - `.claude/agents`
  - `.agents/agents`
- Replace target directories on each sync to avoid stale files.

# Files expected to change

- `scripts/sync-agents.mjs` (new)
- `package.json`
- `.gitignore`
- `README.md`
- `docs/plans/001-agent-sync-setup.md` (phase tracking)

# Small code examples

```js
rmSync(targetDir, { recursive: true, force: true });
cpSync(sourceDir, targetDir, { recursive: true });
```

```json
{
  "scripts": {
    "sync:agents": "node ./scripts/sync-agents.mjs",
    "setup": "npm run sync:agents"
  }
}
```

# Potential pitfalls

- If `docs/agents` is missing, script should fail clearly.
- Hidden destination directories should stay gitignored.

# Remaining unclear areas

- None for this scope; destination paths are fixed per requested behavior.

# Tasks / phases

## Phase 1: Add explicit sync setup and docs

Tasks:
- Implement sync script.
- Wire npm scripts.
- Update `.gitignore`.
- Document setup usage in README.

Validation:
- `npm run sync:agents` completes successfully.
- `find .claude/agents -name SKILL.md` returns skill files.
- `find .agents/agents -name SKILL.md` returns skill files.

Validation results:
- Pass: `npm run sync:agents`
- Pass: `find .claude/agents -name SKILL.md | sort` (7 files)
- Pass: `find .agents/agents -name SKILL.md | sort` (7 files)

Status: completed
