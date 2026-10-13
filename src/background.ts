import { fetchOverview, GitHubError, rerequestReview } from "./github";
import type { Message, Reply, ReplyByType } from "./messages";

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  handle(message).then(sendResponse);
  return true;
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

async function handle(message: Message): Promise<Reply<ReplyByType[Message["type"]]>> {
  try {
    switch (message.type) {
      case "overview":
        return { ok: true, value: await fetchOverview(message.ref) };
      case "rerequest":
        await rerequestReview(message.ref, message.login);
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
