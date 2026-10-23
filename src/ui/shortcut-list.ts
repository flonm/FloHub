import type { ShortcutHelp } from "../core/shortcuts";
import { el } from "./dom";

/**
 * @param rows The shortcuts, from shortcutHelp.
 * @returns A list of keys and what they do, as the options page and the bar's shortcut list show it.
 */
export function renderShortcutList(rows: ShortcutHelp[]): HTMLDListElement {
  const list = el("dl", { class: "keys" });
  for (const row of rows) {
    const keys = el("dt");
    for (const [index, key] of row.keys.entries()) {
      if (index > 0 && row.join) keys.append(el("span", { class: "then" }, row.join));
      keys.append(el("kbd", {}, key));
    }
    list.append(keys, el("dd", {}, row.action));
  }
  return list;
}
