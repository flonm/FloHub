# FloHub

- Every change follows the `tests-and-stories` skill (`.claude/skills/tests-and-stories/SKILL.md`): it brings its unit tests and stories, and `bun run check` passes before you commit.
- The pre-commit hook runs that check on what is staged. Never bypass it with `--no-verify`.
