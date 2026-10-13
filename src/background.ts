import {
  fetchOverview,
  fetchPendingComments,
  fetchViewedFiles,
  GitHubError,
  readToken,
  rerequestReview,
  setFileViewed,
  submitReview,
} from "./github";
import type { Message, Reply, ReplyByType } from "./messages";
import { clearOverviewCache, queueCacheWrite, writeCachedOverview } from "./overview-cache";

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  handle(message).then(sendResponse);
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "token" in changes) void queueCacheWrite(clearOverviewCache);
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

async function handle(message: Message): Promise<Reply<ReplyByType[Message["type"]]>> {
  try {
    switch (message.type) {
      case "overview": {
        const token = await readToken();
        const overview = await fetchOverview(message.ref);
        void queueCacheWrite(async () => {
          if ((await readToken()) === token) await writeCachedOverview(message.ref, overview);
        });
        return { ok: true, value: overview };
      }
      case "rerequest":
        await rerequestReview(message.ref, message.login);
        return { ok: true, value: null };
      case "viewed-files":
        return { ok: true, value: await fetchViewedFiles(message.ref) };
      case "set-viewed":
        await setFileViewed(message.pullRequestId, message.path, message.viewed);
        return { ok: true, value: null };
      case "pending-comments":
        return { ok: true, value: await fetchPendingComments(message.ref) };
      case "submit-review":
        await submitReview(message.ref, message.event, message.body);
        return { ok: true, value: null };
      case "open-options":
        await chrome.runtime.openOptionsPage();
        return { ok: true, value: null };
    }
  } catch (error) {
    if (error instanceof GitHubError) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: "failed", message: "Could not reach GitHub." };
  }
}
