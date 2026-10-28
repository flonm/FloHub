# GitHub quirks FloHub works around

GitHub changes its pages without notice. Each entry says what GitHub does, what FloHub does about it, and how to tell
that GitHub has fixed it, so the workaround can go.

## The comments panel's jump to the code doesn't scroll

*Seen 2026-10-21 on the React Files changed page (`/pull/<n>/changes`), signed in.*

**What GitHub does.** A comment in the comments panel (`?panel=comments`) links its file path and its icon to the code:

- **A current comment** links to `…/changes#r<comment id>`. Clicking it puts the fragment in the URL and marks the file in
  the file tree, but the page doesn't scroll. The thread is drawn in the diff (`div#r<comment id>`), and loading the
  same URL with the panel closed scrolls to it. Only the click from the panel fails.
- **An outdated comment** links to the single-commit view, `…/changes/<commit>?new_files_changed=true#r<thread id>`,
  which shows only that commit's changes and doesn't scroll either. The `#r` there is the thread's id, not the
  comment's.

**What FloHub does.** `onCommentLink` in `src/content.ts` catches a plain click on any link in a panel comment
(`div#paneldiscussion_r<comment id>`), before GitHub sees it. It opens the jump menu (`src/ui/jump-menu.ts`):

- **Changes since vX:** the versions view, from the comment's version to the head.
- **Code at vX:** the comment's version against the base branch.
- **In the current diff:** the versions view's, or GitHub's own diff when the view is closed. GitHub draws a thread
  as `div#r<first comment id>` only while it is expanded; a collapsed one, a resolved one for instance, is only an
  avatar on its line, with no id to find, and a reply's number is never a thread's. So FloHub scrolls to the expanded
  thread when it finds one, and else to the commented line, `table[aria-label="Diff for: <path>"]
  td.diff-text-cell[data-diff-side][data-line-number]`, or failing that to the file, `#diff-<SHA-256 of the path>`.

FloHub reads the comment's id from the link. The link's shape alone also tells whether the comment is outdated, so "In
the current diff" is offered, and with the view closed works, before the comment is fetched (`commentIsCurrent` in
`src/core/comment-jump.ts`). If GitHub ever links outdated comments like current ones, that check has to wait for the
fetched comment instead.

**How to tell it's fixed.** Disable FloHub, open a pull request's Files changed tab with the comments panel open, and
click a current comment's file link. If the page scrolls to the thread, GitHub fixed the first half. "In the current
diff" with the view closed could then hand the click back to GitHub, but scrolling twice to the same thread is
harmless. The menu itself stays, since GitHub has no versions view to offer.

## A folded review thread only unfolds through a button that needs the mouse

*Seen 2026-10-28 on the React Files changed page (`/pull/<n>/changes`), signed in.*

**What GitHub does.** GitHub folds review threads on their line, resolved ones always and every one while the comments
panel is open: the line shows the commenters' avatars and a count, and the thread (`div#r<first comment id>`) isn't
drawn. The avatars themselves take no click. A "View comments" button
(`td.diff-text-cell button[aria-label="View comments"]`) sits under them, and GitHub only renders it in the line's cell
while the mouse is over the cell. It toggles the thread. Its `aria-expanded` stays `false` either way.

**What FloHub does.** When <kbd>]</kbd> or <kbd>[</kbd> goes to a thread GitHub hasn't drawn, `unfoldThread` in
`src/content.ts` sends the cell a `mouseover`, presses the button once it appears, sends a `mouseout`, and waits for
`#r<first comment id>`. Since the button toggles, it does nothing to a thread already drawn. `markInPanel` then
scrolls the comments panel (`#docked-side-panel-content`) to the thread's card, the `article` around
`#paneldiscussion_r<first comment id>`, and outlines it.

**How to tell it's fixed.** Open a pull request's Files changed tab with the comments panel open. If the avatars on a
commented line unfold the thread when clicked, or the button is there without the mouse over the line, the hover can go,
and FloHub can press GitHub's control directly.
