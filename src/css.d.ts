/**
 * A stylesheet imported with the `?raw` suffix, so the shadow root can inject it as its style element. Vite (and so
 * Storybook) understands the suffix on its own; build.ts teaches Bun the same trick. See the declaration-file
 * override in .oxlintrc.json for why this file is a global script rather than a module.
 */
declare module "*.css?raw" {
  const content: string;
  export default content;
}
