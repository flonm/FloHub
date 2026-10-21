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
- **In the current diff:** the versions view's, or GitHub's own thread when the view is closed (`div#r<comment id>`).

FloHub reads the comment's id from the card, never from the link.

**How to tell it's fixed.** Disable FloHub, open a pull request's Files changed tab with the comments panel open, and
click a current comment's file link. If the page scrolls to the thread, GitHub fixed the first half. "In the current
diff" with the view closed could then hand the click back to GitHub, but scrolling twice to the same thread is
harmless. The menu itself stays, since GitHub has no versions view to offer.
