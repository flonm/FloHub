---
name: tests-and-stories
description: 'Use whenever you change FloHub''s behaviour or UI (a feature, a fix, a refactor that moves logic), before calling the work done or committing: which unit tests, Storybook stories and e2e steps the change has to bring, and the checks a commit must pass. Triggers: "add a test", "write a story", "is this done", "commit", "open a PR", any edit under src/ or e2e/.'
---

# Tests and stories

A change to FloHub is done when it brings its own tests and stories and `bun run check` passes. Code without them is unfinished work, so finish it in the same change rather than leaving a follow-up.

## What each kind of change brings

| The change touches | It brings |
|---|---|
| Logic: deriving a status, parsing, diffing, ordering, anything with a return value | A unit test in `src/<module>.test.ts` beside the module, with `bun:test`. |
| A fix | A test that fails without the fix. Write it first and watch it fail. |
| DOM a user sees: a `*-view.ts`, a dialog, the bar, the popup, the options page | A story in `src/stories/<area>.stories.ts` for each state it can show. |
| A flow across GitHub's own page: anchoring, shortcuts, the file tree, the badge | A step in `e2e/smoke.ts` against the mocked API. |

These add up: a new status in the stack needs a test for `deriveStatus`, the new status in `status.stories.ts` and a layer in `stack-section.stories.ts`.

## Unit tests

- Test the pure function. If the logic sits inside a DOM builder, move it out into an exported function first (`inbox-view.ts` exports `problemFor`, `moveSelection` and `updatedLabel` for this reason) and test that.
- Name a test after the rule it holds ("only a failed request leaves the stored inbox visible"), not after the function. Use `test.each` for a table of inputs.
- Pass the clock in (`now`) instead of reading `Date.now()` in the function, so a test pins it.
- Cover the edge cases a reviewer would ask about: empty input, the one-element case, a missing field GitHub may leave out, the failure path.

## Stories

- Mount the UI the way the extension does: `inShadow()` from `src/stories/shadow.ts` gives the shadow root with the bar's styles, and `NOW` keeps ages fixed.
- One story per state the UI can be in: empty, loading, error, each status, collapsed and expanded, long text. A UI with `Loading`, `Empty` and error states ships a story for each.
- Interactive controls re-render the way the bar does (see `render` in `stack-section.stories.ts`), so a reviewer can click through in Storybook.
- Check both themes in the toolbar. Dark mode reads GitHub's Primer tokens from `PRIMER_DARK`; a colour that isn't a token won't follow the theme.
- `bun run storybook` serves it at http://localhost:6008.

## What enforces it

- `src/test-gaps.test.ts` fails when a module that builds DOM appears in no story, or another module has no `.test.ts`. Its two lists name the modules that already had the gap when the check came in. Close a gap and take the module off the list, which the third test there demands. Never add a module to either list.
- `bun run check` runs typecheck, oxlint, ESLint, knip and the unit tests. The pre-commit hook (husky with lint-staged) runs the same on what is staged, for `git commit` and `git commit --amend` alike. CI runs it on every pull request.
- Never commit with `--no-verify`. If the hook fails, fix the cause.

## Lint rules

- `.oxlintrc.json` decides every rule oxlint implements; `eslint.config.js` adds only the rules oxlint lacks. Each rule that's off has its reason beside it.
- `bun run lint:fix` applies the safe fixes. Read the diff afterwards: an autofix can leave odd formatting, and there's no formatter to tidy it.
- An inline disable names the rule and a reason: `// oxlint-disable-next-line <rule> -- <why this line is the exception>`. If you find yourself writing the same disable twice, the rule is the question, so raise it instead.
- knip reports unused files, exports and dependencies. Delete what it finds instead of ignoring it; drop `export` from what only its own module uses.
