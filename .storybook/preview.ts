import type { Preview } from "@storybook/html-vite";
import { PRIMER_DARK, PRIMER_LIGHT } from "../src/stories/shadow";

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "GitHub color mode",
      toolbar: { title: "Theme", icon: "mirror", items: ["light", "dark"], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: "light" },
  decorators: [
    (story, context) => {
      const tokens = context.globals.theme === "dark" ? PRIMER_DARK : PRIMER_LIGHT;
      document.body.style.background = tokens["--bgColor-default"] ?? "#ffffff";
      const frame = document.createElement("div");
      frame.style.padding = "16px";
      // The root too, for what mounts on <body> itself, like the versions dialog.
      for (const target of [frame, document.documentElement]) {
        for (const [name, value] of Object.entries(tokens)) target.style.setProperty(name, value);
      }
      const content = story();
      // eslint-disable-next-line no-unsanitized/property -- a story's own markup, written in this repository
      if (typeof content === "string") frame.innerHTML = content;
      else frame.append(content);
      return frame;
    },
  ],
  parameters: { layout: "fullscreen" },
};

export default preview;
