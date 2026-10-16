/**
 * A stylesheet a story mounts in a shadow root. Vite returns the compiled CSS, `@import`s and all, so a story carries
 * the very styles the popup page links. See the declaration-file override in .oxlintrc.json for the file's shape.
 */
declare module "*.css?inline" {
  const content: string;
  export default content;
}

/**
 * A stylesheet imported with the `?raw` suffix, so the shadow root can inject it as its style element. Vite (and so
 * Storybook) understands the suffix on its own; build.ts teaches Bun the same trick.
 */
declare module "*.css?raw" {
  const content: string;
  export default content;
}
