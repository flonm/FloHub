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

## A folded review thread unfolds only through its own button

*Seen 2026-10-28 on the React Files changed page (`/pull/<n>/changes`), signed in. Changed by 2026-11-09.*

**What GitHub does.** GitHub draws some review threads folded on their line instead of in full: resolved ones always,
and ones the viewer collapsed. The thread (`div#r<first comment id>`) isn't drawn then. Until early November 2026 the
line showed the commenters' avatars, every thread was folded while the comments panel was open, and the only way to
unfold one was a "View comments" button GitHub rendered in the line's cell while the mouse was over it. Now open
threads stay drawn with the panel open, and a folded thread is a bar under its line ("Comment on lines R13 to R14",
with *Resolved* on a resolved one). The bar's button sits in the line's code cell
(`td.diff-text-cell button[aria-labelledby]`), is always there, and is named "Expand comment" by the element its
`aria-labelledby` points to. It toggles the thread.

**What FloHub does.** When <kbd>]</kbd> or <kbd>[</kbd> goes to a thread GitHub hasn't drawn, `unfoldThread` in
`src/content.ts` presses that button (`expandButton`) and waits for `#r<first comment id>`. Since the button toggles,
it does nothing to a thread already drawn. `markInPanel` then scrolls the comments panel
(`#docked-side-panel-content`) to the thread's card, the `article` around `#paneldiscussion_r<first comment id>`, and
outlines it.

**How to tell it's fixed.** Collapse an unresolved thread on a pull request's Files changed tab and reload. If GitHub
draws it in full again, threads <kbd>]</kbd> and <kbd>[</kbd> visit are never folded, and the unfolding can go.

## The count of a timeline filtered by type counts every item

*Seen 2026-11-09 in the GraphQL API, on every pull request tried.*

**What GitHub does.** `timelineItems(itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT])` returns only force pushes in `nodes`,
but its `totalCount` is about the count of every timeline item: commits, reviews, review requests, labels. A pull
request with one commit that was never force-pushed reported `totalCount: 6`, the number of its timeline items, and
one force-pushed 13 times, as its own timeline and the REST API show, reported 65.

**What FloHub does.** The bar's "Force-pushed N×" counts the force push events the overview returns
(`forcePushSummary` in `src/core/versions.ts`), the last 100 of them, rather than reading `totalCount`. The versions
were never affected: they come from the events themselves.

**How to tell it's fixed.** Ask for `timelineItems(itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT], first: 100) { totalCount
nodes { __typename } }` on a pull request with a few force pushes. If `totalCount` equals the number of nodes, it can be
read again, which also counts past 100.

## A push resets the Viewed marks of files whose change stayed the same

*Expected from how GitHub dismisses Viewed marks (`viewerViewedState: DISMISSED`), not yet observed on a real pull
request.*

**What GitHub does.** A file's Viewed mark turns into *changed since you viewed it* when a push changes the file at the
head. After a rebase, that includes files whose change the pull request makes is the same as before: their content
moved with the base branch, so GitHub asks to look at them again.

**What FloHub does.** The versions view knows which files make the same change in both compared versions. While **To**
is the current version and **From** the version the viewer last reviewed, a button in the summary under the toolbar, *Mark N unchanged files as viewed again* (`markUnchanged` in `renderResult`,
`src/ui/versions-view.ts`), marks those whose mark GitHub reset as viewed. It leaves files that were never viewed
alone (`viewedBeforeUnchanged` in `src/core/viewed.ts`).

**How to tell it's fixed.** Mark a file as viewed, rebase the pull request onto a newer base that doesn't touch that
file's lines, and push. If the file is still marked as viewed, GitHub compares the change rather than the content, and
the button never shows. It can then go.

## Safari offers a verification code in a comment box

*Seen 2026-11-04 in Safari on the Files changed page, in a FloHub reply box under a thread marked "Code changed since
the comment". Not a GitHub bug: Safari's AutoFill guessing, on a site it holds a saved verification code for.*

**What Safari does.** Safari's AutoFill guesses from a field and the words around it whether it wants a one-time code.
On github.com, where iCloud Passwords keeps a verification code, it offered that code under a focused FloHub comment
box, a `<textarea>` outside any form with nothing saying what it's for.

**What FloHub does.** Its comment boxes, the reply and new-comment box (`writeBox` in `src/ui/review-thread.ts`) and
the review dialog's comment (`src/ui/review-dialog.ts`), set `autocomplete="off"`. If Safari still offers the code,
the words nearby are the next suspect: the thread's "Code changed since the comment" badge.

**How to tell it's fixed.** Remove the attribute, and focus a reply box in Safari with a verification code saved for
github.com. If the popup no longer shows, Safari stopped guessing there and the attribute can go, though it costs
nothing to keep.
