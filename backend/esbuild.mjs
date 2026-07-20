import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

mkdirSync("dist", { recursive: true });

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outExtension: { ".js": ".mjs" },
  banner: {
    // Some CJS deps use require(); provide it under ESM output.
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  minify: true,
  sourcemap: false,
};

await build({
  ...shared,
  entryPoints: ["src/api/handler.ts"],
  outfile: "dist/api/index.mjs",
});

await build({
  ...shared,
  entryPoints: ["src/reminders/handler.ts"],
  outfile: "dist/reminders/index.mjs",
});

for (const name of ["api", "reminders"]) {
  execSync(`cd dist/${name} && zip -q -X -r ../${name}.zip index.mjs`, { stdio: "inherit" });
}
console.log("Built dist/api.zip and dist/reminders.zip");
