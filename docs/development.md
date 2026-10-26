# Developing FloHub

## Develop

| Command | What it does |
|---|---|
| `bun run test` | Unit tests: reviewer states, stack status precedence, last activity, ages, URL parsing, file tree path matching, line counts, versions and their bases, the line diff and interdiff |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | oxlint, then ESLint. `.oxlintrc.json` decides every rule oxlint implements, with every category but nursery on; `eslint.config.js` adds typescript-eslint's remaining type-checked rules, unicorn, Storybook and Mozilla's no-unsanitized. `bun run lint:fix` applies the safe fixes. |
| `bun run knip` | Unused files, exports and dependencies |
| `bun run check` | Typecheck, lint, knip and unit tests. The pre-commit hook runs it on what's staged, for `git commit --amend` too, and CI runs it on every pull request. |
| `bun run lint:firefox` | Builds `dist-firefox/` and runs Mozilla's `web-ext lint` on it |
| `bun run sign:firefox` | Builds `dist-firefox/` and has addons.mozilla.org sign it as an unlisted add-on. The signed `.xpi` lands in `web-ext-artifacts/`. Needs `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` from [your AMO API keys](https://addons.mozilla.org/developers/addon/api/key/). |
| `bun run build:safari:app` | Builds `dist-safari/` and wraps it in `FloHub.app` with Xcode, signed for local use only, in `safari/build/`. `bun run install:safari` also copies it to `~/Applications` and opens it. The Xcode project in `safari/FloHub/` came from Apple's `safari-web-extension-converter` and reads `dist-safari/` in place. |
| `bun run storybook` | Storybook at http://localhost:6008: the bar, the inbox, the status badge, the stack section, the discussion, the review and versions dialogs, the toast and the viewed file tree, each with its own Docs page (`@storybook/addon-docs`). Use the **Theme** toolbar item for GitHub light and dark. `bun run build-storybook` builds it into `storybook-static/`. |
| `bun run e2e` | Builds, loads `dist/` into Playwright's Chromium, mocks `api.github.com`, and drives a public PR (`PULL_URL` overrides it). Screenshots go to `e2e/screenshots/`. |
| `bun run screenshots` | Runs the e2e and saves the README's pictures to `docs/screenshots/`: FloHub's own UI, cut out of GitHub's page, in light and dark. Run it after a visible change and commit the pictures that changed. |

Every change brings its unit tests and stories, as the `tests-and-stories` skill in `.claude/skills/` spells out. `src/test-gaps.test.ts` fails when a module that builds DOM appears in no story, or another module has no test of its own.

ESLint runs typescript-eslint, which needs TypeScript's JavaScript API. TypeScript 7 no longer ships one, so inside ESLint `eslint-typescript.js` resolves `typescript` to TypeScript 6 (the `typescript-eslint-ts` alias). `tsc` and oxlint's type-aware rules use TypeScript 7.

The smoke test runs logged out, so it exercises GitHub's classic PR markup. The bar anchors to the first page heading containing `#<number>` (see `src/ui/anchor.ts`). If a GitHub redesign breaks that, the floating pill still works. Fix the anchor there.


## Release

Firefox only installs signed add-ons for good. FloHub is signed as an *unlisted* add-on: Mozilla signs it automatically, and it doesn't appear on addons.mozilla.org.

To release, tag any commit on `main` as `v<version>` and push the tag, for example `git tag v0.2.0 && git push origin v0.2.0`. The version comes from the tag: one to four dot-separated numbers, higher than the latest release, since AMO never signs the same version twice. `static/manifest.json` stays at `0.0.0`, which marks local builds; `FLOHUB_VERSION=0.2.0 bun run build:firefox` sets a version by hand. A release includes every commit up to the tagged one.

`.github/workflows/release.yaml` then checks the version, signs the Firefox build and builds the Safari app on a macOS runner. Once both succeed, it attaches `flohub-<version>.xpi`, `flohub-safari-<version>.zip` and `updates.json` to the tag's GitHub release: to the one you drafted on GitHub's release page if it exists, otherwise to a new one. The Firefox job runs in the `amo` environment, which holds the `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` secrets, accepts only `v*` tags and waits for a required reviewer's approval. The Safari app is signed for local use only, since a Developer ID signature needs a paid Apple developer account.

The first signature ties the add-on ID in `build.ts` to the AMO account that owns the keys, so every later release must be signed with that account's keys.

Firefox updates FloHub on its own, starting with the first release that includes this update setup (the releases after 0.1.1). The Firefox manifest's `update_url` points at `releases/latest/download/updates.json`, which always resolves to the newest release's `updates.json`. Firefox checks it once a day; **Check for Updates** in `about:addons` checks right away. Installed copies keep that URL for good, so the repository must keep its name and the release assets their names. 0.1.0 and 0.1.1 have no `update_url`: install the next release's `.xpi` once by hand, and later versions arrive on their own.


## Layout

`src/` is split by what a module may touch:

- `src/background.ts`, `src/content.ts`, `src/options.ts`, `src/popup.ts`: the four entry points `build.ts` bundles. They stay at the top, so the manifest and the built file names don't move.
- `src/core/`: pure logic with a return value, no browser API and no DOM: reviewer states, layer statuses, ages, diff marks, the interdiff, version bases, URL parsing, review scope, the raw-tree inbox.
- `src/api/`: everything that talks to GitHub or to the extension's own storage: the service worker's client, the typed messages, the overview cache, the inbox alarm.
- `src/ui/`: the DOM the user sees, in the page, the shadow root and the popup: the bar, the stack, discussion, inbox, review, versions and toast views, and the page helpers (anchor, file tree, diff highlights, favicon).
- `src/styles/`: the design system. `tokens.css` holds every color, font, radius and shadow once (each reading GitHub's Primer variable with a fallback), `base.css` the primitives and the tone palette, `controls.css` the tool buttons, switches and tooltip the bar and the versions view share, `faces.css` a reviewer's face with their verdict, and one file per surface: `bar.css`, `popup.css`, `options.css`. `dark.css` adds the pages' dark fallbacks and is deliberately not part of the bar, which follows GitHub's own theme rather than the machine's.
- `src/stories/`: the Storybook stories. `src/test-gaps.test.ts` walks every folder and fails when a module that builds DOM appears in no story, or another module has no test of its own.

By feature:

- `build.ts`: bundles `src/` and copies `static/` into `dist/` (Chrome) or, with `firefox`, into `dist-firefox/`. The Firefox manifest runs the background script as an event page and adds the add-on ID under `browser_specific_settings.gecko`. Both browsers run the same `chrome.*` code.
- `src/background.ts`: the service worker (an event page in Firefox). It holds the token and makes every API call: one GraphQL query for reviewers and the stack (`PullRequest.stack.entries`), and REST `POST …/requested_reviewers` to re-request, which adds to the existing requests.
- `src/core/versions.ts`, `src/core/interdiff.ts`, `src/ui/versions-dialog.ts`: Compare versions. The versions come from `HeadRefForcePushedEvent`s and reviews' commits, and the base branch's earlier heads from the same-repository pull requests whose head it is, or was (`BaseRefChangedEvent`, `AutomaticBaseChangeSucceededEvent`). Each version is compared (`GET …/compare/<base>...<head>`) with the current base and each candidate, and diffed against the closest one: of the candidates it descends from and its merge base with the current base, the one with the fewest commits in between (`ahead_by`). So an old ancestor, like a release pull request's head in a git-flow repository, can't beat the merge base. `interdiff.ts` pairs the files, strips line numbers from hunk headers, and runs a Myers diff over the two patches. It keeps each line's numbers from the version it comes from, and pairs each removed line with the most similar added one after it for the word highlights. `src/core/diff-marks.ts` maps that diff back to the current diff's lines (`L`/`R` plus line number, as GitHub's line anchors name them), and `src/ui/diff-highlights.ts` marks them on the page. It handles both diffs GitHub serves: the classic one, whose line number cells have `id="diff-<hash>R12"`, and the React one (signed in), whose line number cells have `data-diff-side` and `data-line-number`. In both, the code cell follows its line number cell.
- `src/ui/file-tree.ts`, `src/core/viewed.ts`: the Viewed checkboxes in the file tree. A tree item is matched to its file by the `#diff-<sha256(path)>` anchor or, failing that, by its labels from the root down. Viewed marks and line counts come from `PullRequest.files` (`viewerViewedState`, `additions`, `deletions`), and marks change through `markFileAsViewed`/`unmarkFileAsViewed`.
- `src/content.ts`: follows GitHub's in-page navigation, mounts the bars, and refreshes on focus and on visibility changes.
- `src/core/reviewers.ts`, `src/core/stack.ts`, `src/core/age.ts`: pure derivation of reviewer states, layer statuses and ages from the raw query.
- `src/ui/bar.ts`, `src/ui/stack-view.ts`, `src/ui/dom.ts`, `src/ui/bar-styles.ts`: the Shadow DOM UI. `bar-styles.ts` composes the design system's `tokens.css`, `base.css` and `bar.css` into the style the shadow root injects, themed through GitHub's Primer CSS variables.
- `src/core/shortcuts.ts`, `src/ui/review-dialog.ts`, `src/ui/toast.ts`: the key sequences, the review dialog, and the feedback toast.
