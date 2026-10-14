import type { Preview } from "@storybook/html-vite";
import { PRIMER_DARK } from "../src/stories/shadow";

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
      const dark = context.globals.theme === "dark";
      document.body.style.background = dark ? PRIMER_DARK["--bgColor-default"] : "#ffffff";
      const frame = document.createElement("div");
      frame.style.padding = "16px";
      if (dark) for (const [name, value] of Object.entries(PRIMER_DARK)) frame.style.setProperty(name, value);
      const content = story();
      if (typeof content === "string") frame.innerHTML = content;
      else frame.append(content);
      return frame;
    },
  ],
  parameters: { layout: "fullscreen" },
};

export default preview;
