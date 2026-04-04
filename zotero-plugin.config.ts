import { defineConfig } from "zotero-plugin-scaffold";

export default defineConfig({
  source: "src/index.ts",
  dist: "build",
  name: "Clautero",
  id: "clautero@zotero-plugin",
  namespace: "clautero",
  updateURL: "https://raw.githubusercontent.com/waterwoods-ai/clautero/main/update.json",
  xpiDownloadLink:
    "https://github.com/waterwoods-ai/clautero/releases/download/v{version}/{xpiName}.xpi",
  build: {
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        bundle: true,
        target: "firefox115",
        outfile: "build/addon/content/clautero.js",
      },
    ],
  },
});
