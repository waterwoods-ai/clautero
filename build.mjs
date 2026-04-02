import * as esbuild from "esbuild";
import { execFileSync } from "child_process";
import { mkdirSync, cpSync, existsSync, rmSync } from "fs";
import { join } from "path";

const outDir = "build";
const addonDir = join(outDir, "addon");

// Clean and create output directory
mkdirSync(join(addonDir, "content"), { recursive: true });

// Bundle TypeScript source
await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "iife",
  target: "firefox115",
  outfile: join(addonDir, "content/clautero.js"),
  external: [],
  minify: false,
  sourcemap: false,
});

// Copy addon files (manifest, bootstrap, prefs, locale, content)
cpSync("addon", addonDir, { recursive: true });

// Build .xpi (just a zip)
const xpiName = "clautero-0.2.0.xpi";
const xpiPath = join(outDir, xpiName);
if (existsSync(xpiPath)) {
  rmSync(xpiPath);
}
execFileSync("zip", ["-r", join("..", xpiName), "."], { cwd: addonDir });

console.log(`Built: ${xpiPath}`);
