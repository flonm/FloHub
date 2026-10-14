import type { StorybookConfig } from "@storybook/html-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.ts"],
  framework: "@storybook/html-vite",
  core: { disableTelemetry: true },
};

export default config;
