import { defineConfig } from "vite";
import type { Plugin as VitePlugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
// postcss-tug-color expands --tug-color(color, i: intensity, t: tone) to oklch() at build time.
import postcssTugColor from "./postcss-tug-color";

/**
 * Vite plugin: seamless CSS hot-reload when palette-engine.ts changes.
 *
 * Problem: palette-engine.ts is in vite.config.ts's import chain (via
 * postcss-tug-color.ts). Vite treats it as a config dependency and
 * auto-restarts the server on change, crashing the SharedWorker HMR client.
 *
 * Solution:
 *   1. Exclude palette-engine.ts from Vite's watcher (prevents auto-restart).
 *   2. Use fs.watchFile in our plugin to detect changes independently.
 *   3. Touch tug-base.css to trigger normal CSS HMR.
 *   4. PostCSS plugin re-reads presets from disk on mtime change.
 *
 * Result: edit palette-engine.ts → colors update seamlessly via CSS HMR.
 */
function paletteHotReload(): VitePlugin {
  const paletteEngine = path.resolve(__dirname, "src/components/tugways/palette-engine.ts");
  const tugBase = path.resolve(__dirname, "styles/tug-base.css");
  return {
    name: "palette-hot-reload",
    configureServer() {
      fs.watchFile(paletteEngine, { interval: 300 }, () => {
        // Touch tug-base.css so Vite sees a CSS change and re-runs PostCSS.
        // The PostCSS plugin re-reads presets from disk via mtime check.
        const now = new Date();
        fs.utimesSync(tugBase, now, now);
      });
    },
  };
}

/**
 * Vite plugin: regenerate control tokens when theme-derivation-engine.ts changes.
 *
 * The derivation engine is the single source of truth for control tokens.
 * When it changes, we re-run generate-tug-control-tokens.ts to update the
 * generated section of tug-base.css, then CSS HMR picks up the change.
 *
 * Uses Vite's built-in watcher via handleHotUpdate (no separate fs.watchFile).
 * Also runs once at buildStart to ensure tug-base.css is in sync.
 */
function controlTokenHotReload(): VitePlugin {
  const scriptPath = path.resolve(__dirname, "scripts/generate-tug-control-tokens.ts");

  function regenerate() {
    try {
      execSync(`bun run ${scriptPath}`, { cwd: __dirname, stdio: "pipe" });
    } catch (e) {
      console.error("[control-token-hot-reload] generation failed:", (e as Error).message);
    }
  }

  return {
    name: "control-token-hot-reload",
    buildStart() {
      regenerate();
    },
    handleHotUpdate({ file }) {
      if (file.endsWith("theme-derivation-engine.ts")) {
        regenerate();
      }
    },
  };
}

export default defineConfig(() => {
  const tugcastPort = process.env.TUGCAST_PORT || "55255";
  const proxyConfig = {
    "/auth": { target: `http://localhost:${tugcastPort}` },
    "/ws": { target: `ws://localhost:${tugcastPort}`, ws: true },
    "/api": { target: `http://localhost:${tugcastPort}` },
  };
  return {
    plugins: [react(), paletteHotReload(), controlTokenHotReload()],
    css: {
      postcss: {
        plugins: [postcssTugColor()],
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        // lucide@0.564 predates the exports field; point Vite at its ESM entry directly
        lucide: path.resolve(
          __dirname,
          "./node_modules/lucide/dist/esm/lucide/src/lucide.js",
        ),
      },
    },
    server: {
      host: "127.0.0.1",
      proxy: proxyConfig,
      watch: {
        // Exclude palette-engine.ts from Vite's watcher. It's in the config
        // import chain (vite.config → postcss-tug-color → palette-engine),
        // so changes would trigger an auto-restart that crashes SharedWorker.
        // The paletteHotReload plugin handles it via fs.watchFile instead.
        ignored: ["**/palette-engine.ts"],
      },
      hmr: {
        host: "127.0.0.1",
        port: 55155,
        protocol: "ws",
      },
    },
    preview: {
      proxy: proxyConfig,
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      // Shiki language grammars are large by nature; suppress the warning for
      // chunks that exceed 500 kB since we can't split them further without
      // restructuring the syntax-highlighting feature.
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: (id: string) => {
            if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
              return "vendor";
            }
            if (id.includes("node_modules/shiki")) {
              return "shiki";
            }
          },
        },
      },
    },
  };
});
