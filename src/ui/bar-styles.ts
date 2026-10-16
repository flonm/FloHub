import base from "../styles/base.css?raw";
import bar from "../styles/bar.css?raw";
import tokens from "../styles/tokens.css?raw";

/**
 * The stylesheet the bar's shadow root injects. It is the same design system the popup and the options page link,
 * composed here because a shadow root takes its CSS as text. GitHub's Primer variables reach into the shadow root,
 * so the light/dark fallbacks in tokens.css only apply where GitHub provides no variable.
 */
export const BAR_STYLES = [tokens, base, bar].join("\n");
