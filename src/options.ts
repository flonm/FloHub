import { el } from "./dom";
import { fetchViewerLogin, GitHubError, readToken, writeToken } from "./github";
import type { Inbox } from "./inbox";
import { parseRepo, readDirectRepos, REVIEW_SCOPES_KEY, type ReviewScope, writeReviewScope } from "./review-scope";

const form = document.querySelector<HTMLFormElement>("#token-form");
const input = document.querySelector<HTMLInputElement>("#token");
const status = document.querySelector<HTMLParagraphElement>("#status");
const clear = document.querySelector<HTMLButtonElement>("#clear");
const access = document.querySelector<HTMLDivElement>("#access");
const grant = document.querySelector<HTMLButtonElement>("#grant");
const repoList = document.querySelector<HTMLUListElement>("#repos");
const addRepo = document.querySelector<HTMLFormElement>("#add-repo");
const repoInput = document.querySelector<HTMLInputElement>("#repo");
const scopeStatus = document.querySelector<HTMLParagraphElement>("#scope-status");
const origins = requiredOrigins();
/** Repositories added on this page, kept in the list after they go back to the default. */
const added = new Map<string, string>();

if (access && grant) {
  void showAccess(access);
  grant.addEventListener("click", () => {
    void chrome.permissions.request({ origins }).then(() => showAccess(access));
  });
}

if (form && input && status && clear) {
  void readToken().then(async (token) => {
    if (!token) return;
    input.value = token;
    await check(token);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = input.value.trim();
    if (!token) {
      show("Paste a token first.", "error");
      return;
    }
    if (await check(token)) await writeToken(token);
  });

  clear.addEventListener("click", async () => {
    await writeToken("");
    input.value = "";
    show("Token removed.", "info");
  });
}

if (repoList && addRepo && repoInput && scopeStatus) {
  void renderRepos(repoList);
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === "sync" && REVIEW_SCOPES_KEY in changes) || (area === "local" && "inbox" in changes)) void renderRepos(repoList);
  });
  addRepo.addEventListener("submit", async (event) => {
    event.preventDefault();
    const repo = parseRepo(repoInput.value);
    if (!repo) {
      scopeStatus.textContent = "Enter a repository as owner/repo.";
      scopeStatus.dataset.tone = "error";
      return;
    }
    added.set(repo.toLowerCase(), repo);
    await writeReviewScope(repo, "direct");
    repoInput.value = "";
    scopeStatus.textContent = `Showing only direct requests in ${repo}.`;
    scopeStatus.dataset.tone = "info";
  });
}

/**
 * Lists the repositories in the inbox and the ones set to count only direct requests, each with its setting.
 * @param list The list to fill.
 */
async function renderRepos(list: HTMLUListElement): Promise<void> {
  const [direct, stored] = await Promise.all([readDirectRepos(), chrome.storage.local.get("inbox")]);
  const inbox = stored.inbox as Inbox | undefined;
  const names = new Map(added);
  for (const repo of direct) if (!names.has(repo)) names.set(repo, repo);
  for (const entry of [...(inbox?.review ?? []), ...(inbox?.mine ?? [])]) names.set(entry.repo.toLowerCase(), entry.repo);
  const rows = [...names.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const focused = list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.repo : undefined;
  list.replaceChildren(...rows.map((repo) => renderRepo(repo, direct.has(repo.toLowerCase()) ? "direct" : "teams")));
  if (focused) list.querySelector<HTMLSelectElement>(`select[data-repo="${CSS.escape(focused)}"]`)?.focus();
}

function renderRepo(repo: string, scope: ReviewScope): HTMLLIElement {
  const item = el("li");
  const select = el("select", { "aria-label": `Review requests in ${repo}`, "data-repo": repo.toLowerCase() });
  select.append(el("option", { value: "teams" }, "Me and my teams"), el("option", { value: "direct" }, "Only me"));
  select.value = scope;
  select.addEventListener("change", () => void writeReviewScope(repo, select.value as ReviewScope));
  item.append(el("span", { class: "name", title: repo }, repo), select);
  return item;
}

async function check(token: string): Promise<boolean> {
  show("Checking the token…", "info");
  try {
    const login = await fetchViewerLogin(token);
    show(`Saved. Signed in as ${login}. Reload open pull request tabs to pick it up.`, "success");
    return true;
  } catch (error) {
    show(error instanceof GitHubError ? error.message : "Could not reach GitHub.", "error");
    return false;
  }
}

function show(message: string, tone: "info" | "success" | "error"): void {
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

/** @returns Every origin the content script and the GitHub API calls need. */
function requiredOrigins(): string[] {
  const manifest = chrome.runtime.getManifest();
  const matches = manifest.content_scripts?.flatMap((script) => script.matches ?? []) ?? [];
  return [...new Set([...matches, ...(manifest.host_permissions ?? [])])];
}

async function showAccess(notice: HTMLElement): Promise<void> {
  notice.hidden = await chrome.permissions.contains({ origins });
}
