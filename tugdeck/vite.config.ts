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
 *   3. Touch tug.css to trigger normal CSS HMR.
 *   4. PostCSS plugin re-reads presets from disk on mtime change.
 *
 * Result: edit palette-engine.ts → colors update seamlessly via CSS HMR.
 */
function paletteHotReload(): VitePlugin {
  const paletteEngine = path.resolve(__dirname, "src/components/tugways/palette-engine.ts");
  const tugBase = path.resolve(__dirname, "styles/tug.css");
  return {
    name: "palette-hot-reload",
    configureServer() {
      fs.watchFile(paletteEngine, { interval: 300 }, () => {
        // Touch tug.css so Vite sees a CSS change and re-runs PostCSS.
        // The PostCSS plugin re-reads presets from disk via mtime check.
        const now = new Date();
        fs.utimesSync(tugBase, now, now);
      });
    },
  };
}

/** Absolute path to the active theme CSS file in the Vite module graph. */
const THEME_ACTIVE_CSS = path.resolve(__dirname, "styles/tug-active-theme.css");
/** Absolute path to the brio theme CSS file. */
const BASE_THEME_CSS = path.resolve(__dirname, "styles/themes/brio.css");
/** Absolute path to shipped override CSS files. */
export const SHIPPED_THEMES_CSS_DIR = path.resolve(__dirname, "styles/themes");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BASE_THEME_NAME } = require("./src/theme-constants") as { BASE_THEME_NAME: string };

/** Read active theme from tugbank, with base fallback on any error. */
function readActiveThemeFromTugbank(): string {
  try {
    const raw = execSync("tugbank read dev.tugtool.app theme", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return raw || BASE_THEME_NAME;
  } catch {
    return BASE_THEME_NAME;
  }
}

/** Resolve shipped theme CSS path by name. */
function findThemeCssPath(themeName: string, themesCssDir: string): string | null {
  const cssPath = path.join(themesCssDir, `${themeName}.css`);
  return fs.existsSync(cssPath) ? cssPath : null;
}

/** Tiny CSS metadata parser for --tugx-host-canvas-color (literal #rrggbb only). */
export function parseHostCanvasColor(cssText: string): string | null {
  // Strip block comments so commented declarations are ignored.
  const withoutComments = cssText.replace(/\/\*[\s\S]*?\*\//g, " ");
  const match = withoutComments.match(/--tugx-host-canvas-color\s*:\s*(#[0-9a-fA-F]{6})\s*;/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Copy the active theme's complete CSS into tug-active-theme.css.
 *
 * - For brio (or missing/default): copies styles/themes/brio.css.
 * - For any other theme: copies styles/themes/<name>.css.
 * - The file is always a complete theme; it is never empty.
 */
function copyActiveThemeToFile(themeName: string, activeCssPath: string): void {
  if (!themeName || themeName === BASE_THEME_NAME) {
    const css = fs.readFileSync(BASE_THEME_CSS, "utf-8");
    fs.writeFileSync(activeCssPath, css, "utf-8");
    return;
  }

  const sourceCssPath = findThemeCssPath(themeName, SHIPPED_THEMES_CSS_DIR);
  if (!sourceCssPath) {
    console.warn(`[themeLoaderPlugin] theme "${themeName}" not found, falling back to brio`);
    const css = fs.readFileSync(BASE_THEME_CSS, "utf-8");
    fs.writeFileSync(activeCssPath, css, "utf-8");
    return;
  }

  try {
    const css = fs.readFileSync(sourceCssPath, "utf-8");
    fs.writeFileSync(activeCssPath, css, "utf-8");
  } catch (err) {
    console.error(`[themeLoaderPlugin] failed to copy CSS for theme "${themeName}":`, err);
    const css = fs.readFileSync(BASE_THEME_CSS, "utf-8");
    fs.writeFileSync(activeCssPath, css, "utf-8");
  }
}

/**
 * Vite plugin: ensure `tug-active-theme.css` contains the active theme's
 * complete CSS at startup, before Vite processes any CSS.
 *
 * - Reads the active theme name from tugbank via `tugbank read dev.tugtool.app theme`.
 * - For brio (or missing/default): copies styles/themes/brio.css into tug-active-theme.css.
 * - For any other theme: copies styles/themes/<name>.css into tug-active-theme.css.
 * - The file is always a complete theme; it is never empty.
 * - Same logic for both dev and build modes — no special cases.
 */
function themeLoaderPlugin(): VitePlugin {
  return {
    name: "theme-loader",
    configResolved() {
      const activeTheme = readActiveThemeFromTugbank();
      copyActiveThemeToFile(activeTheme, THEME_ACTIVE_CSS);
    },
  };
}

/**
 * Vite plugin: when a theme source file changes, re-copy the active theme
 * into tug-active-theme.css so the app receives standard CSS HMR updates.
 *
 * Watches styles/themes/*.css (all themes including brio).
 */
function controlTokenHotReload(): VitePlugin {
  function reloadActiveTheme() {
    const activeTheme = readActiveThemeFromTugbank();
    copyActiveThemeToFile(activeTheme, THEME_ACTIVE_CSS);
  }

  return {
    name: "control-token-hot-reload",
    handleHotUpdate({ file }) {
      if (file.startsWith(SHIPPED_THEMES_CSS_DIR) && file.endsWith(".css")) {
        reloadActiveTheme();
        return [];
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Theme load middleware — handles /__themes/* endpoints
// Handler functions are exported for unit testing with mocked fs.
//
// Only shipped themes are supported:
//   Shipped theme CSS:  tugdeck/styles/themes (activation source of truth)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// activateTheme — shared logic for startup plugin and activate endpoint
//
// Copies the active theme's complete CSS into activeCssPath, parses the
// source CSS metadata token --tugx-host-canvas-color, and returns
// { theme, hostCanvasColor }.
// ---------------------------------------------------------------------------

/** Return value of activateTheme on success. */
export interface ActivateResult {
  theme: string;
  hostCanvasColor: string;
}

/**
 * Activate a theme by writing the complete theme CSS into activeCssPath.
 * Returns { theme, hostCanvasColor } on success.
 *
 * - For the base theme (brio): copies styles/themes/brio.css to activeCssPath.
 * - For non-base themes: copies CSS from styles/themes/<name>.css to activeCssPath.
 * - Parses --tugx-host-canvas-color from the source CSS file.
 * - Throws if source CSS is missing or host color metadata is missing/invalid.
 * - The active theme file is always a complete theme; it is never empty.
 *
 * The active theme name is persisted to tugbank by the client-side settings-api.ts
 * (putTheme), not by this function. This function only manages the active CSS file.
 */
export function activateTheme(
  themeName: string,
  themesCssDir: string,
  activeCssPath: string,
): ActivateResult {
  if (themeName === BASE_THEME_NAME) {
    const baseCss = fs.readFileSync(BASE_THEME_CSS, "utf-8");
    const hostCanvasColor = parseHostCanvasColor(baseCss);
    if (!hostCanvasColor) {
      throw new Error(`Missing or invalid --tugx-host-canvas-color in ${BASE_THEME_CSS}`);
    }
    fs.writeFileSync(activeCssPath, baseCss, "utf-8");
    return { theme: BASE_THEME_NAME, hostCanvasColor };
  }

  const cssPath = findThemeCssPath(themeName, themesCssDir);
  if (!cssPath) {
    throw new Error(`Theme '${themeName}' not found`);
  }

  const css = fs.readFileSync(cssPath, "utf-8");
  const hostCanvasColor = parseHostCanvasColor(css);
  if (!hostCanvasColor) {
    throw new Error(`Missing or invalid --tugx-host-canvas-color in ${cssPath}`);
  }
  fs.writeFileSync(activeCssPath, css, "utf-8");
  return { theme: themeName, hostCanvasColor };
}

// ---------------------------------------------------------------------------
// writeMutex — Promise chain that serializes all override file writes.
//
// Pattern: pending = pending.catch(() => {}).then(fn)
// The .catch(() => {}) swallows any previous rejection so fn always executes
// exactly once, regardless of whether the previous write succeeded or failed.
// The alternative .then(fn).catch(fn) would double-execute fn on rejection.
// ---------------------------------------------------------------------------

let pending: Promise<void> = Promise.resolve();

function withMutex(fn: () => Promise<void>): Promise<void> {
  pending = pending.catch(() => {}).then(fn);
  return pending;
}

// ---------------------------------------------------------------------------
// handleThemesActivate — POST /__themes/activate
//
// Parses the request body, validates the theme field, calls
// activateTheme inside the write mutex, and returns the response.
// Exported for unit testing with mocked fs.
//
// Parameters:
//   body           — parsed JSON request body (unknown)
//   themesCssDir   — absolute path to shipped theme CSS files
//   activeCssPath  — absolute path to tug-active-theme.css
// ---------------------------------------------------------------------------

export async function handleThemesActivate(
  body: unknown,
  themesCssDir: string,
  activeCssPath: string,
): Promise<{ status: number; body: string }> {
  if (!body || typeof body !== "object") {
    return { status: 400, body: JSON.stringify({ error: "invalid request body" }) };
  }
  const b = body as Record<string, unknown>;
  const themeName = b.theme;
  if (!themeName || typeof themeName !== "string" || themeName.trim() === "") {
    return { status: 400, body: JSON.stringify({ error: "theme field is required" }) };
  }
  const name = themeName.trim();

  return new Promise<{ status: number; body: string }>((resolve) => {
    withMutex(async () => {
      try {
        const result = activateTheme(name, themesCssDir, activeCssPath);
        resolve({ status: 200, body: JSON.stringify(result) });
      } catch (err) {
        const msg = String(err instanceof Error ? err.message : err);
        if (msg.includes("not found")) {
          resolve({ status: 404, body: JSON.stringify({ error: msg }) });
        } else {
          resolve({ status: 500, body: JSON.stringify({ error: msg }) });
        }
      }
    });
  });
}

/**
 * Vite plugin: theme API endpoints for the dev server.
 * POST /__themes/activate     — activate a theme by rewriting the override file
 */
function themeSaveLoadPlugin(): VitePlugin {
  return {
    name: "theme-save-load",
    configureServer(server) {
      server.middlewares.use(
        "/__themes",
        (req: import("http").IncomingMessage, res: import("http").ServerResponse, next: () => void) => {
          const url = req.url ?? "/";

          if (req.method === "POST" && url === "/activate") {
            let raw = "";
            req.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
            req.on("end", () => {
              let body: unknown;
              try {
                body = JSON.parse(raw);
              } catch {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "invalid JSON body" }));
                return;
              }
              handleThemesActivate(body, SHIPPED_THEMES_CSS_DIR, THEME_ACTIVE_CSS).then((result) => {
                res.writeHead(result.status, { "Content-Type": "application/json" });
                res.end(result.body);
              }).catch((err) => {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: String(err) }));
              });
            });
            return;
          }

          next();
        },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Discover shipped theme CSS files for production build inputs.
//
// Each styles/themes/<name>.css file is added as a separate Rollup entry
// so Vite processes it through PostCSS (expanding --tug-color() tokens)
// and emits it to dist/assets/themes/<name>.css. The production link swap
// in theme-provider.tsx targets these paths. [D08]
// ---------------------------------------------------------------------------

function discoverThemeCssInputs(): Record<string, string> {
  const themesDir = path.resolve(__dirname, "styles", "themes");
  const inputs: Record<string, string> = {};
  let files: string[] = [];
  try {
    files = fs.readdirSync(themesDir).filter((f) => f.endsWith(".css"));
  } catch {
    // themes dir may not exist yet during first run
  }
  for (const file of files) {
    const name = file.slice(0, -4); // strip .css
    inputs[`themes/${name}`] = path.join(themesDir, file);
  }
  return inputs;
}

export default defineConfig(() => {
  const tugcastPort = process.env.TUGCAST_PORT || "55255";
  const proxyConfig = {
    "/auth": { target: `http://localhost:${tugcastPort}` },
    "/ws": { target: `ws://localhost:${tugcastPort}`, ws: true },
    "/api": { target: `http://localhost:${tugcastPort}` },
  };

  const themeInputs = discoverThemeCssInputs();

  return {
    plugins: [react(), themeLoaderPlugin(), paletteHotReload(), controlTokenHotReload(), themeSaveLoadPlugin()],
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
      // Tauri app loads from local filesystem — chunk size is not a
      // performance concern. Disable the warning entirely.
      chunkSizeWarningLimit: Infinity,
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, "index.html"),
          ...themeInputs,
        },
        output: {
          // Emit per-theme CSS to assets/themes/<name>.css (no hash) so
          // the production link swap can target a stable path. [D08]
          assetFileNames: (assetInfo) => {
            const name = assetInfo.name ?? "";
            if (name.endsWith(".css")) {
              // Theme entry CSS files are named "themes/<themeName>" by discoverThemeCssInputs.
              // Rollup preserves the entry key as the asset name for extracted CSS.
              const names = assetInfo.names ?? [name];
              for (const n of names) {
                if (n.startsWith("themes/") || n.includes("/styles/themes/")) {
                  const themeName = path.basename(n, ".css");
                  return `assets/themes/${themeName}.css`;
                }
              }
            }
            return "assets/[name]-[hash][extname]";
          },
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
