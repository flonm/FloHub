import type { ProfileIndex, Profiles } from "../core/profiles";
import { el } from "./dom";

/** What the profile controls do when the user changes them. */
export interface ProfileActions {
  /** Shows a profile in the inbox, or every repository with null. */
  pick: (active: ProfileIndex | null) => void;
  rename: (index: ProfileIndex, name: string) => void;
  /** Puts an owner or a repository on a profile's list, or on neither with null. */
  assign: (entry: string, profile: ProfileIndex | null) => void;
}

const ALL = "all";

/**
 * @param profiles The profiles.
 * @param pick What choosing one does.
 * @returns The popup header's switch between the profiles, or null while nothing is on either list, since then
 *   both profiles show the same.
 */
export function renderProfileSwitch(profiles: Profiles, pick: ProfileActions["pick"]): HTMLSelectElement | null {
  if (Object.keys(profiles.entries).length === 0) return null;
  const select = el("select", {
    class: "profile-switch",
    "aria-label": "Profile",
    title: "The repositories the inbox shows. Set up profiles in the settings.",
    "data-focus-key": "profile",
  });
  select.append(el("option", { value: ALL }, "All repositories"), ...profileOptions(profiles));
  select.value = profiles.active === null ? ALL : String(profiles.active);
  select.addEventListener("change", () => pick(select.value === ALL ? null : (Number(select.value) as ProfileIndex)));
  return select;
}

function profileOptions(profiles: Profiles): HTMLOptionElement[] {
  return profiles.names.map((name, index) => el("option", { value: String(index) }, name));
}

/**
 * The options page's profile settings: which profile the inbox shows, the profiles' names, and the profile of each
 * owner and of each repository listed on its own.
 * @param profiles The profiles.
 * @param entries Every owner and repository to list, lowercase, a repository after its owner.
 * @param actions What changing them does.
 * @returns The controls, for the profiles card.
 */
export function renderProfileEditor(profiles: Profiles, entries: string[], actions: ProfileActions): HTMLElement {
  const box = el("div", { class: "profiles" });
  const names = el("div", { class: "profile-names" });
  for (const index of [0, 1] as const) {
    const label = el("label", {}, `Profile ${index + 1}`);
    const input = el("input", { autocomplete: "off", spellcheck: "false", "data-profile": String(index) });
    input.value = profiles.names[index];
    input.addEventListener("change", () => actions.rename(index, input.value));
    label.append(input);
    names.append(label);
  }
  const showing = el("label", { class: "profile-active" }, "The inbox shows ");
  const active = el("select", { "data-focus-key": "profile-active" });
  active.append(el("option", { value: ALL }, "All repositories"), ...profileOptions(profiles));
  active.value = profiles.active === null ? ALL : String(profiles.active);
  active.addEventListener("change", () => actions.pick(active.value === ALL ? null : (Number(active.value) as ProfileIndex)));
  showing.append(active);
  const list = el("ul", { class: "repos owners", "aria-label": "Owners and repositories" });
  list.append(...entries.map((entry) => renderEntry(entry, profiles, actions)));
  box.append(names, showing, list);
  return box;
}

/** A repository listed on its own follows its owner until it's put on a profile, so its first choice says so. */
function renderEntry(entry: string, profiles: Profiles, actions: ProfileActions): HTMLLIElement {
  const repo = entry.includes("/");
  const item = el("li", repo ? { class: "repo-entry" } : {});
  const select = el("select", { "aria-label": `Profile of ${entry}`, "data-entry": entry });
  select.append(el("option", { value: ALL }, repo ? "Like its owner" : "Both profiles"), ...profileOptions(profiles));
  const profile = profiles.entries[entry];
  select.value = profile === undefined ? ALL : String(profile);
  select.addEventListener("change", () => actions.assign(entry, select.value === ALL ? null : (Number(select.value) as ProfileIndex)));
  item.append(el("span", { class: "name", title: entry }, entry), select);
  return item;
}
