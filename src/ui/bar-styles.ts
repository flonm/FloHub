import base from "../styles/base.css?raw";
import bar from "../styles/bar.css?raw";
import controls from "../styles/controls.css?raw";
import faces from "../styles/faces.css?raw";
import popup from "../styles/popup.css?raw";
import repoPulls from "../styles/repo-pulls.css?raw";
import tokens from "../styles/tokens.css?raw";

/**
 * The stylesheet the bar's shadow root injects. It is the same design system the popup and the options page link,
 * composed here because a shadow root takes its CSS as text. GitHub's Primer variables reach into the shadow root,
 * so the light/dark fallbacks in tokens.css only apply where GitHub provides no variable.
 */
export const BAR_STYLES = [tokens, base, controls, bar].join("\n");

/**
 * The stylesheet of FloHub's views on a repository's pull request list: the popup's rows without its imports, which a
 * shadow root can't follow and whose dark.css would follow the operating system instead of GitHub's theme.
 */
export const REPO_PULLS_STYLES = [tokens, base, faces, popup.replaceAll(/@import [^;]+;/gu, ""), repoPulls].join("\n");
