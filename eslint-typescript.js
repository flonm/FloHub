// typescript-eslint needs TypeScript's JavaScript API, which TypeScript 7 no longer ships.
// Inside the ESLint process, every import of "typescript" resolves to TypeScript 6 instead.
import { registerHooks } from "node:module";

registerHooks({
  resolve: (specifier, context, nextResolve) =>
    nextResolve(specifier.replace(/^typescript(?=\/|$)/u, "typescript-eslint-ts"), context),
});
