import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds the whole app into one self-contained, offline-capable HTML file
// (dist/index.html). No server, no external requests — a show file dropped
// into the page never leaves the browser.
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  build: {
    target: "es2022",
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    reportCompressedSize: false,
  },
  test: {
    globals: true,
    environment: "node",
  },
});
