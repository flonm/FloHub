import nodePath from "node:path";
import type { BunPlugin } from "bun";

const TARGETS = {
  chrome: "dist",
  firefox: "dist-firefox",
} as const;

type Target = keyof typeof TARGETS;

const GECKO = {
  id: "flohub@flonm.github.io",
  strict_min_version: "128.0",
  data_collection_permissions: { required: ["none"] },
  update_url: "https://github.com/flonm/FloHub/releases/latest/download/updates.json",
};

const requested = process.argv[2] ?? "chrome";
if (!Object.hasOwn(TARGETS, requested)) {
  console.error(`Unknown target "${requested}". Use one of: ${Object.keys(TARGETS).join(", ")}.`);
  process.exit(1);
}
const target = requested as Target;
const OUT = TARGETS[target];

/**
 * Lets `import css from "./x.css?raw"` give the file's text, the way Vite already does. Both bundlers then share the
 * one design system: the popup and the options page link it, the bar's shadow root injects it as a style element.
 */
const rawCss: BunPlugin = {
  name: "raw-css",
  setup(build) {
    build.onResolve({ filter: /\.css\?raw$/u }, (args) => ({
      path: nodePath.resolve(args.resolveDir, args.path.replace(/\?raw$/u, "")),
      namespace: "raw-css",
    }));
    build.onLoad({ filter: /.*/u, namespace: "raw-css" }, async (args) => ({
      contents: await Bun.file(args.path).text(),
      loader: "text",
    }));
  },
};

await Bun.$`rm -rf ${OUT}`;

const result = await Bun.build({
  entrypoints: ["src/background.ts", "src/content.ts", "src/options.ts", "src/popup.ts"],
  outdir: OUT,
  target: "browser",
  format: "iife",
  minify: false,
  plugins: [rawCss],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// The popup and the options page link their stylesheet; the bar's shadow root gets the same CSS as text at runtime.
const styles = await Bun.build({
  entrypoints: ["src/styles/popup.css", "src/styles/options.css"],
  outdir: OUT,
  target: "browser",
});
if (!styles.success) {
  for (const log of styles.logs) console.error(log);
  process.exit(1);
}

const staticFiles = new Bun.Glob("**/*").scanSync("static");
for (const file of staticFiles) {
  if (file === "manifest.json") continue;
  await Bun.write(`${OUT}/${file}`, Bun.file(`static/${file}`));
}

const manifest = (await Bun.file("static/manifest.json").json()) as { version: string } & Record<string, unknown>;
const version = process.env.FLOHUB_VERSION ?? manifest.version;
const VERSION_FORMAT = /^\d+(\.\d+){0,3}$/u;
if (!VERSION_FORMAT.test(version)) {
  console.error(`Version "${version}" must be one to four dot-separated numbers, like 1.2.3.`);
  process.exit(1);
}
manifest.version = version;
await Bun.write(`${OUT}/manifest.json`, `${JSON.stringify(target === "firefox" ? toFirefox(manifest) : manifest, null, 2)}\n`);

console.log(
  target === "firefox"
    ? `Built ${result.outputs.length} scripts into ${OUT}/. Load it via about:debugging → This Firefox → Load Temporary Add-on.`
    : `Built ${result.outputs.length} scripts into ${OUT}/. Load it via chrome://extensions → Load unpacked.`,
);

/**
 * Firefox runs Manifest V3 background code as an event page, not a service worker, and needs an add-on ID.
 * Installed copies keep checking the `update_url` they shipped with, so it must stay valid for good.
 * @param chromeManifest The Chrome manifest.
 * @returns The same manifest for Firefox.
 */
function toFirefox(chromeManifest: Record<string, unknown>): Record<string, unknown> {
  const { minimum_chrome_version: _, background: __, ...rest } = chromeManifest;
  return {
    ...rest,
    background: { scripts: ["background.js"] },
    browser_specific_settings: { gecko: GECKO },
  };
}
