import { el } from "./ui/dom";
import { fetchViewerLogin, GitHubError, readToken, writeToken } from "./api/github";
import type { Inbox } from "./core/inbox";
import { parseRepo, readDirectRepos, REVIEW_SCOPES_KEY, type ReviewScope, writeReviewScope } from "./core/review-scope";
import { isMac, shortcutHelp } from "./core/shortcuts";
import { renderShortcutList } from "./ui/shortcut-list";
import { assignEntry, knownEntries, loadProfiles, PROFILES_KEY, type Profiles, saveProfiles } from "./core/profiles";
import { type ProfileActions, renderProfileEditor } from "./ui/profile-view";

const form = document.querySelector<HTMLFormElement>("#token-form");
const input = document.querySelector<HTMLInputElement>("#token");
const status = document.querySelector<HTMLParagraphElement>("#status");
const clear = document.querySelector<HTMLButtonElement>("#clear");
const access = document.querySelector<HTMLDivElement>("#access");
const grant = document.querySelector<HTMLButtonElement>("#grant");
const repoList = document.querySelector<HTMLUListElement>("#repos");
const repoForm = document.querySelector<HTMLFormElement>("#add-repo");
const repoInput = document.querySelector<HTMLInputElement>("#repo");
const scopeStatus = document.querySelector<HTMLParagraphElement>("#scope-status");
const profileBox = document.querySelector<HTMLDivElement>("#profiles");
const entryForm = document.querySelector<HTMLFormElement>("#add-entry");
const entryInput = document.querySelector<HTMLInputElement>("#entry");
const entryStatus = document.querySelector<HTMLParagraphElement>("#entry-status");
const origins = requiredOrigins();

const shortcuts = shortcutHelp(isMac(navigator.platform));
document.querySelector("#keys")?.replaceWith(Object.assign(renderShortcutList(shortcuts), { id: "keys" }));
/** Repositories added on this page, kept in the list after they go back to the default. */
const added = new Map<string, string>();

if (access && grant) {
  void showAccess(access);
  grant.addEventListener("click", () => void requestAccess(access));
}

if (form && input && status && clear) {
  void showToken(input);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveToken(input.value.trim());
  });
  clear.addEventListener("click", () => void removeToken(input));
}

if (repoList && repoForm && repoInput && scopeStatus) {
  void renderRepos(repoList);
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === "sync" && Object.hasOwn(changes, REVIEW_SCOPES_KEY)) || (area === "local" && "inbox" in changes)) void renderRepos(repoList);
  });
  repoForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void addDirectRepo(repoInput, scopeStatus);
  });
}

if (profileBox && entryForm && entryInput && entryStatus) {
  void renderProfiles(profileBox);
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === "sync" && Object.hasOwn(changes, PROFILES_KEY)) || (area === "local" && "inbox" in changes)) void renderProfiles(profileBox);
  });
  entryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void addEntry(entryInput, entryStatus);
  });
}

/** Every change reads the profiles afresh, so one made in the popup meanwhile isn't undone. */
const profileActions: ProfileActions = {
  pick: (active) => void changeProfiles((profiles) => ({ ...profiles, active })),
  rename: (index, name) =>
    void changeProfiles((profiles) => {
      const names: Profiles["names"] = [...profiles.names];
      names[index] = name.trim() || names[index];
      return { ...profiles, names };
    }),
  assign: (entry, profile) => void changeProfiles((profiles) => assignEntry(profiles, entry, profile)),
};

async function changeProfiles(change: (profiles: Profiles) => Profiles): Promise<void> {
  await saveProfiles(change(await loadProfiles()));
}

/**
 * Lists every owner the inbox or the profiles know, and every repository listed on its own, each with its profile.
 * @param box The element to fill.
 */
async function renderProfiles(box: HTMLElement): Promise<void> {
  const [profiles, stored] = await Promise.all([loadProfiles(), chrome.storage.local.get("inbox")]);
  const focused = box.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
  const key = focused?.dataset.entry ?? focused?.dataset.profile ?? focused?.dataset.focusKey;
  box.replaceChildren(renderProfileEditor(profiles, knownEntries(stored.inbox as Inbox | undefined, profiles), profileActions));
  if (key) box.querySelector<HTMLElement>(`[data-entry="${CSS.escape(key)}"], [data-profile="${CSS.escape(key)}"], [data-focus-key="${CSS.escape(key)}"]`)?.focus();
}

const OWNER_PATTERN = /^[\w-]+$/u;

/** Adds an owner, or a repository that should go elsewhere than its owner, to the first profile. */
async function addEntry(field: HTMLInputElement, notice: HTMLElement): Promise<void> {
  const typed = field.value.trim().replace(/^(https?:\/\/)?github\.com\//iu, "").replace(/\/$/u, "");
  const owner = OWNER_PATTERN.test(typed) ? typed : null;
  const entry = typed.includes("/") ? parseRepo(typed) : owner;
  if (!entry) {
    notice.textContent = "Enter an owner, like octo-org, or a repository, like octo-org/api.";
    notice.dataset.tone = "error";
    return;
  }
  const profiles = await loadProfiles();
  await saveProfiles(assignEntry(profiles, entry, 0));
  field.value = "";
  notice.textContent = `Added ${entry} to ${profiles.names[0]}. Change its profile in the list.`;
  notice.dataset.tone = "info";
}

async function requestAccess(notice: HTMLElement): Promise<void> {
  await chrome.permissions.request({ origins });
  await showAccess(notice);
}

async function showToken(field: HTMLInputElement): Promise<void> {
  const token = await readToken();
  if (!token) return;
  field.value = token;
  await check(token);
}

async function saveToken(token: string): Promise<void> {
  if (!token) {
    show("Paste a token first.", "error");
    return;
  }
  if (await check(token)) await writeToken(token);
}

async function removeToken(field: HTMLInputElement): Promise<void> {
  await writeToken("");
  field.value = "";
  show("Token removed.", "info");
}

async function addDirectRepo(field: HTMLInputElement, notice: HTMLElement): Promise<void> {
  const repo = parseRepo(field.value);
  if (!repo) {
    notice.textContent = "Enter a repository as owner/repo.";
    notice.dataset.tone = "error";
    return;
  }
  added.set(repo.toLowerCase(), repo);
  await writeReviewScope(repo, "direct");
  field.value = "";
  notice.textContent = `Showing only direct requests in ${repo}.`;
  notice.dataset.tone = "info";
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
  const rows = [...names.values()].toSorted((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
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
  return [...new Set([...matches, ...((manifest.host_permissions as string[] | undefined) ?? [])])];
}

async function showAccess(notice: HTMLElement): Promise<void> {
  notice.hidden = await chrome.permissions.contains({ origins });
}
