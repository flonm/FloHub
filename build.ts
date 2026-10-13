const OUT = "dist";

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
  await Bun.write(`${OUT}/${file}`, Bun.file(`static/${file}`));
}

console.log(`Built ${result.outputs.length} scripts into ${OUT}/. Load it via chrome://extensions → Load unpacked.`);
