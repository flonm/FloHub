import {
  fetchOverview,
  fetchPendingComments,
  fetchViewedFiles,
  GitHubError,
  pokeReviewer,
  rerequestReview,
  setFileViewed,
  submitReview,
} from "./github";
import { clearInbox, INBOX_ALARM, INBOX_PERIOD_MINUTES, refreshInbox } from "./inbox-sync";
import type { Message, Reply, ReplyByType } from "./messages";

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  handle(message).then(sendResponse);
  return true;
});

chrome.alarms.create(INBOX_ALARM, { periodInMinutes: INBOX_PERIOD_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === INBOX_ALARM) void refreshInbox().catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => void refreshInbox().catch(() => undefined));
chrome.runtime.onInstalled.addListener(() => void refreshInbox().catch(() => undefined));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !("token" in changes)) return;
  void clearInbox().then(() => refreshInbox()).catch(() => undefined);
});

async function handle(message: Message): Promise<Reply<ReplyByType[Message["type"]]>> {
  try {
    switch (message.type) {
      case "inbox":
        return { ok: true, value: await refreshInbox() };
      case "overview":
        return { ok: true, value: await fetchOverview(message.ref) };
      case "poke":
        await pokeReviewer(message.ref, message.reviewer);
        return { ok: true, value: null };
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
