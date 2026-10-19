import {
  fetchOverview,
  fetchPendingComments,
  fetchVersionPatch,
  fetchVersions,
  fetchViewedFiles,
  GitHubError,
  pokeReviewer,
  readToken,
  rerequestReview,
  setFileViewed,
  submitReview,
} from "./api/github";
import { clearInbox, ensureInboxAlarm, INBOX_ALARM, refreshInbox, refreshInboxAgain } from "./api/inbox-sync";
import type { Message, Reply, ReplyByType } from "./api/messages";
import { clearOverviewCache, queueCacheWrite, writeCachedOverview } from "./api/overview-cache";
import { REVIEW_SCOPES_KEY } from "./core/review-scope";

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  void handle(message).then(sendResponse);
  return true;
});

void ensureInboxAlarm();
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === INBOX_ALARM) void refreshInbox().catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => void refreshInbox().catch(() => undefined));
chrome.runtime.onInstalled.addListener(() => void refreshInbox().catch(() => undefined));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && Object.hasOwn(changes, REVIEW_SCOPES_KEY)) void refreshInboxAgain().catch(() => undefined);
  if (area !== "local" || !("token" in changes)) return;
  void queueCacheWrite(clearOverviewCache);
  void clearInbox().then(async () => refreshInbox()).catch(() => undefined);
});

async function handle(message: Message): Promise<Reply<ReplyByType[Message["type"]]>> {
  try {
    switch (message.type) {
      case "inbox": {
        return { ok: true, value: await refreshInbox() };
      }
      case "overview": {
        const token = await readToken();
        const overview = await fetchOverview(message.ref);
        void queueCacheWrite(async () => {
          if ((await readToken()) === token) await writeCachedOverview(message.ref, overview);
        });
        return { ok: true, value: overview };
      }
      case "poke": {
        await pokeReviewer(message.ref, message.reviewer);
        return { ok: true, value: null };
      }
      case "rerequest": {
        await rerequestReview(message.ref, message.login);
        return { ok: true, value: null };
      }
      case "viewed-files": {
        return { ok: true, value: await fetchViewedFiles(message.ref) };
      }
      case "set-viewed": {
        await setFileViewed(message.pullRequestId, message.path, message.viewed);
        return { ok: true, value: null };
      }
      case "pending-comments": {
        return { ok: true, value: await fetchPendingComments(message.ref) };
      }
      case "submit-review": {
        await submitReview(message.ref, message.event, message.body);
        return { ok: true, value: null };
      }
      case "versions": {
        return { ok: true, value: await fetchVersions(message.ref) };
      }
      case "version-patch": {
        return { ok: true, value: await fetchVersionPatch(message.ref, message.head, message.bases) };
      }
      case "open-options": {
        await chrome.runtime.openOptionsPage();
        return { ok: true, value: null };
      }
    }
  } catch (error) {
    if (error instanceof GitHubError) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: "failed", message: "Could not reach GitHub." };
  }
}
