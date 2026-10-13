import { fetchViewerLogin, GitHubError, readToken, writeToken } from "./github";

const form = document.querySelector<HTMLFormElement>("#token-form");
const input = document.querySelector<HTMLInputElement>("#token");
const status = document.querySelector<HTMLParagraphElement>("#status");
const clear = document.querySelector<HTMLButtonElement>("#clear");
const access = document.querySelector<HTMLDivElement>("#access");
const grant = document.querySelector<HTMLButtonElement>("#grant");
const origins = requiredOrigins();

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
