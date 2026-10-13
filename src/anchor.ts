const HEADER_CONTAINERS = '[class*="PageHeader"], header';
const USER_CONTENT = ".markdown-body, .comment-body, .js-comment-body";

/**
 * Finds the element the inline bar goes right after: the header around the first rendered page
 * heading that names the pull request's number, or the heading's own row.
 * @param root The document to search.
 * @param number The pull request number.
 * @returns The element to insert after, or null when the page has no recognizable header.
 */
export function findInlineAnchor(root: ParentNode, number: number): Element | null {
  const numberPattern = new RegExp(`#${number}(?!\\d)`);
  const heading = [...root.querySelectorAll("main h1, main h2, [role='main'] h1")].find(
    (candidate) =>
      !candidate.closest(USER_CONTENT) &&
      numberPattern.test(candidate.textContent ?? "") &&
      candidate.getClientRects().length > 0,
  );
  if (!heading) return null;
  return heading.closest(HEADER_CONTAINERS) ?? heading.parentElement;
}
