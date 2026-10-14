// Runs on every `git commit` and `git commit --amend` through .husky/pre-commit. lint-staged hides unstaged changes
// first, so the checks see what is about to be committed. They check the whole project, since a type-aware rule or
// an unused export can break in a file the commit didn't touch.
const config = {
  "*": () => ["bun run typecheck", "bun run lint", "bun run knip", "bun run test"],
};

export default config;
