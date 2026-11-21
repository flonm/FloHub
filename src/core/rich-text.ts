/** Elements rebuilt as they are, each with the attributes it may keep. */
const ALLOWED: Record<string, readonly string[]> = {
  a: ["href", "title"],
  b: [],
  blockquote: [],
  br: [],
  code: [],
  del: [],
  details: ["open"],
  div: [],
  em: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  h5: [],
  h6: [],
  hr: [],
  i: [],
  img: ["src", "alt", "title"],
  input: ["type", "checked"],
  kbd: [],
  li: [],
  ol: ["start"],
  p: [],
  pre: [],
  s: [],
  span: [],
  strong: [],
  sub: [],
  summary: [],
  sup: [],
  table: [],
  tbody: [],
  td: ["align", "colspan", "rowspan"],
  th: ["align", "colspan", "rowspan"],
  thead: [],
  tr: [],
  ul: [],
};

/** Elements dropped with everything inside them. */
const DROPPED = new Set(["script", "style", "svg", "iframe", "object", "embed", "form", "button", "select", "textarea", "template", "noscript", "math", "video", "audio"]);

/** GitHub's alert boxes (`> [!WARNING]`) keep their class names, so they can be styled; every other class is dropped. */
const KEPT_CLASS = /^markdown-alert(-(note|tip|important|warning|caution|title))?$/u;

const SAFE_LINK = /^(https?:|mailto:)/iu;

/**
 * Hosts GitHub serves a comment's own images from (uploads, camo, avatars and objects). An image anywhere else
 * is a tracking pixel: loading it would tell a stranger when the viewer opened the pull request, and from where.
 */
const SAFE_IMAGE_HOST = /(^|\.)(github\.com|githubusercontent\.com)$/u;

/**
 * Rebuilds GitHub's rendering of a comment from an allowlist of elements and attributes. The HTML is parsed in an
 * inert document and never assigned to the page: unknown elements are unwrapped, scripts and embeds are dropped with
 * their content, a link that isn't http(s) or mailto becomes plain text, images must be https on GitHub's own hosts,
 * and task-list checkboxes stay read-only.
 * @param html GitHub's `bodyHTML`.
 * @returns The rebuilt content, or null when the HTML can't be parsed here.
 */
export function renderRichText(html: string): DocumentFragment | null {
  let parsed: Document;
  try {
    parsed = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
  const fragment = document.createDocumentFragment();
  for (const child of parsed.body.childNodes) appendSafe(fragment, child);
  return fragment;
}

function appendSafe(parent: ParentNode, node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    parent.append(document.createTextNode(node.textContent ?? ""));
    return;
  }
  if (!(node instanceof Element)) return;
  const tag = node.localName;
  if (DROPPED.has(tag)) return;
  const attributes = ALLOWED[tag];
  const href = node.getAttribute("href");
  const unsafeLink = tag === "a" && (href === null || safeLinkUrl(href) === null);
  if (!attributes || unsafeLink || (tag === "input" && node.getAttribute("type") !== "checkbox")) {
    for (const child of node.childNodes) appendSafe(parent, child);
    return;
  }

  const copy = document.createElement(tag);
  for (const name of attributes) {
    const value = node.getAttribute(name);
    if (value === null) continue;
    if (name === "href") {
      const url = safeLinkUrl(value);
      if (!url) continue;
      copy.setAttribute("href", url);
      copy.setAttribute("target", "_top");
      copy.setAttribute("rel", "noopener noreferrer");
    } else if (name === "src") {
      const url = safeImageUrl(value);
      if (url) copy.setAttribute("src", url);
    } else {
      copy.setAttribute(name, value);
    }
  }
  if (tag === "input") copy.setAttribute("disabled", "");
  else if (tag === "img") copy.setAttribute("loading", "lazy");
  const classes = [...node.classList].filter((name) => KEPT_CLASS.test(name));
  if (classes.length > 0) copy.className = classes.join(" ");

  for (const child of node.childNodes) appendSafe(copy, child);
  parent.append(copy);
}

/**
 * @param value A link from comment HTML.
 * @returns The absolute URL when it is an http(s) or mailto link, or null.
 */
export function safeLinkUrl(value: string): string | null {
  const url = resolve(value);
  if (!url || !SAFE_LINK.test(url.href)) return null;
  return url.href;
}

/**
 * @param value An image source from comment HTML.
 * @returns The absolute URL when it is an https image on one of GitHub's own hosts, or null.
 */
export function safeImageUrl(value: string): string | null {
  const url = resolve(value);
  if (url?.protocol !== "https:" || !SAFE_IMAGE_HOST.test(url.hostname)) return null;
  return url.href;
}

function resolve(value: string): URL | null {
  try {
    return new URL(value, "https://github.com");
  } catch {
    return null;
  }
}
