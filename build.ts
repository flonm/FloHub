const TARGETS = {
  chrome: "dist",
  firefox: "dist-firefox",
} as const;

type Target = keyof typeof TARGETS;

const GECKO = {
  id: "flohub@flonm.github.io",
  strict_min_version: "128.0",
  data_collection_permissions: { required: ["none"] },
};

const requested = process.argv[2] ?? "chrome";
if (!(requested in TARGETS)) {
  console.error(`Unknown target "${requested}". Use one of: ${Object.keys(TARGETS).join(", ")}.`);
  process.exit(1);
}
const target = requested as Target;
const OUT = TARGETS[target];

await Bun.$`rm -rf ${OUT}`;

const result = await Bun.build({
  entrypoints: ["src/background.ts", "src/content.ts", "src/options.ts"],
  outdir: OUT,
  target: "browser",
  format: "iife",
  minify: false,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

for (const file of new Bun.Glob("*").scanSync("static")) {
  if (file === "manifest.json") continue;
  await Bun.write(`${OUT}/${file}`, Bun.file(`static/${file}`));
}

const manifest = await Bun.file("static/manifest.json").json();
await Bun.write(`${OUT}/manifest.json`, `${JSON.stringify(target === "firefox" ? toFirefox(manifest) : manifest, null, 2)}\n`);

console.log(
  target === "firefox"
    ? `Built ${result.outputs.length} scripts into ${OUT}/. Load it via about:debugging → This Firefox → Load Temporary Add-on.`
    : `Built ${result.outputs.length} scripts into ${OUT}/. Load it via chrome://extensions → Load unpacked.`,
);

/**
 * Firefox runs Manifest V3 background code as an event page, not a service worker, and needs an add-on ID.
 * @param manifest The Chrome manifest.
 * @returns The same manifest for Firefox.
 */
function toFirefox(manifest: Record<string, unknown>): Record<string, unknown> {
  const { minimum_chrome_version: _, background: __, ...rest } = manifest;
  return {
    ...rest,
    background: { scripts: ["background.js"] },
    browser_specific_settings: { gecko: GECKO },
  };
}
