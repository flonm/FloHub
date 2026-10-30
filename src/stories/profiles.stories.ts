import type { Meta, StoryObj } from "@storybook/html-vite";
import { assignEntry, DEFAULT_PROFILES, type ProfileIndex, type Profiles } from "../core/profiles";
import { el } from "../ui/dom";
import { type ProfileActions, renderProfileEditor, renderProfileSwitch } from "../ui/profile-view";
import { inOptions, inPopup } from "./shadow";

const SET_UP: Profiles = { names: ["Work", "Personal"], active: 0, entries: { "octo-org": 0, mona: 1, "octo-org/party": 1 } };
const ENTRIES = ["hubot", "mona", "octo-org", "octo-org/party"];

/**
 * @param initial The profiles to start from.
 * @param draw Draws the controls from the current profiles.
 * @returns A root that redraws whenever a control changes them, as the pages do after storage changes.
 */
function live(initial: Profiles, draw: (profiles: Profiles, actions: ProfileActions) => Node): HTMLElement {
  const root = el("div");
  let profiles = initial;
  const actions: ProfileActions = {
    pick: (active: ProfileIndex | null) => update({ ...profiles, active }),
    rename: (index, name) => {
      const names: Profiles["names"] = [...profiles.names];
      names[index] = name.trim() || names[index];
      update({ ...profiles, names });
    },
    assign: (entry, profile) => update(assignEntry(profiles, entry, profile)),
  };
  function update(next: Profiles): void {
    profiles = next;
    root.replaceChildren(draw(profiles, actions));
  }
  update(initial);
  return root;
}

function header(profiles: Profiles, actions: ProfileActions): Node {
  const bar = el("header");
  const toggle = renderProfileSwitch(profiles, actions.pick);
  bar.append(el("h1", {}, "Inbox"), ...(toggle ? [toggle] : []), el("span", { class: "updated" }, "Updated just now"));
  return bar;
}

const meta: Meta = { title: "Popup/Profiles" };
export default meta;

/** The popup's header with a profile active. */
export const Switch: StoryObj = { render: () => inPopup(live(SET_UP, header)) };

/** All repositories: the switch says so. */
export const SwitchShowingAll: StoryObj = { render: () => inPopup(live({ ...SET_UP, active: null }, header)) };

/** No owner on either profile: nothing to switch between, so the header has no switch. */
export const NoSwitch: StoryObj = { render: () => inPopup(live(DEFAULT_PROFILES, header)) };

/** The options page's profile settings: one owner on each profile, one on both, and a repository that goes elsewhere than its owner. */
export const Editor: StoryObj = {
  render: () => inOptions(live(SET_UP, (profiles, actions) => renderProfileEditor(profiles, ENTRIES, actions))),
};

/** The options page before any owner is put on a profile. */
export const EditorUnset: StoryObj = {
  render: () => inOptions(live(DEFAULT_PROFILES, (profiles, actions) => renderProfileEditor(profiles, ENTRIES, actions))),
};

/** No inbox yet and no owners: only the names and the active profile. */
export const EditorEmpty: StoryObj = {
  render: () => inOptions(live(DEFAULT_PROFILES, (profiles, actions) => renderProfileEditor(profiles, [], actions))),
};
