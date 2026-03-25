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

/** Absolute path to the override CSS file in the Vite module graph. */
const THEME_OVERRIDE_CSS = path.resolve(__dirname, "styles/tug-theme-override.css");
/** Absolute path to the base theme CSS file. */
const BASE_THEME_CSS = path.resolve(__dirname, "styles/tug-base-generated.css");
/** Absolute path to shipped override CSS files. */
export const SHIPPED_THEMES_CSS_DIR = path.resolve(__dirname, "styles/themes");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BASE_THEME_NAME } = require("./src/theme-constants") as { BASE_THEME_NAME: string };

/** Empty override — base theme default. */
const EMPTY_OVERRIDE = `/* empty - ${BASE_THEME_NAME} default */\n`;

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

/** Tiny CSS metadata parser for --tug-host-canvas-color (literal #rrggbb only). */
export function parseHostCanvasColor(cssText: string): string | null {
  // Strip block comments so commented declarations are ignored.
  const withoutComments = cssText.replace(/\/\*[\s\S]*?\*\//g, " ");
  const match = withoutComments.match(/--tug-host-canvas-color\s*:\s*(#[0-9a-fA-F]{6})\s*;/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Vite plugin: ensure `tug-theme-override.css` reflects the active theme at
 * startup, before Vite processes any CSS.
 *
 * - In build mode: always writes an empty override (base theme default).
 * - Reads the active theme name from tugbank via `tugbank read dev.tugtool.app theme`.
 * - If the theme is missing or set to the base theme: empty override.
 * - If the named theme CSS cannot be found: logs a warning and falls back to
 *   the base theme (empty override).
 * - Falls back to the base theme if tugbank is unavailable (e.g. not yet installed).
 */
function themeOverridePlugin(): VitePlugin {
  return {
    name: "theme-override",
    async configResolved(config) {
      // In build mode always use the base theme (empty override).
      if (config.command === "build") {
        fs.writeFileSync(THEME_OVERRIDE_CSS, EMPTY_OVERRIDE, "utf-8");
        return;
      }

      const activeTheme = readActiveThemeFromTugbank();

      if (!activeTheme || activeTheme === BASE_THEME_NAME) {
        fs.writeFileSync(THEME_OVERRIDE_CSS, EMPTY_OVERRIDE, "utf-8");
        return;
      }

      const sourceCssPath = findThemeCssPath(activeTheme, SHIPPED_THEMES_CSS_DIR);
      if (!sourceCssPath) {
        console.warn(`[themeOverridePlugin] theme "${activeTheme}" not found, falling back to base theme`);
        fs.writeFileSync(THEME_OVERRIDE_CSS, EMPTY_OVERRIDE, "utf-8");
        return;
      }

      try {
        const css = fs.readFileSync(sourceCssPath, "utf-8");
        fs.writeFileSync(THEME_OVERRIDE_CSS, css, "utf-8");
      } catch (err) {
        console.error(`[themeOverridePlugin] failed to copy CSS for theme "${activeTheme}":`, err);
        fs.writeFileSync(THEME_OVERRIDE_CSS, EMPTY_OVERRIDE, "utf-8");
      }
    },
  };
}

/**
 * Vite plugin: when an active override theme file changes, re-copy it into the
 * dev override CSS so the app receives standard CSS HMR updates.
 */
function controlTokenHotReload(): VitePlugin {
  function reactivateActiveTheme() {
    const activeTheme = readActiveThemeFromTugbank();

    if (!activeTheme || activeTheme === BASE_THEME_NAME) {
      fs.writeFileSync(THEME_OVERRIDE_CSS, EMPTY_OVERRIDE, "utf-8");
      return;
    }

    const sourceCssPath = findThemeCssPath(activeTheme, SHIPPED_THEMES_CSS_DIR);
    if (!sourceCssPath) {
      console.warn(`[control-token-hot-reload] theme "${activeTheme}" not found, falling back to base theme`);
      fs.writeFileSync(THEME_OVERRIDE_CSS, EMPTY_OVERRIDE, "utf-8");
      return;
    }
    try {
      const css = fs.readFileSync(sourceCssPath, "utf-8");
      fs.writeFileSync(THEME_OVERRIDE_CSS, css, "utf-8");
    } catch (err) {
      console.error(`[control-token-hot-reload] failed to re-copy override for theme "${activeTheme}":`, err);
    }
  }

  return {
    name: "control-token-hot-reload",
    handleHotUpdate({ file }) {
      if (file.startsWith(SHIPPED_THEMES_CSS_DIR) && file.endsWith(".css")) {
        reactivateActiveTheme();
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
// Filesystem abstraction for testability
// ---------------------------------------------------------------------------

// activateThemeOverride — shared logic for startup plugin and activate endpoint
//
// Copies shipped CSS into the override file (empty for base theme), parses the
// source CSS metadata token --tug-host-canvas-color, and returns
// { theme, hostCanvasColor }.
// ---------------------------------------------------------------------------

/** Return value of activateThemeOverride on success. */
export interface ActivateResult {
  theme: string;
  hostCanvasColor: string;
}

/**
 * Activate a theme by rewriting the override CSS file.
 * Returns { theme, hostCanvasColor } on success.
 *
 * - For the base theme: writes EMPTY_OVERRIDE to overrideCssPath.
 * - For non-base themes: copies CSS from styles/themes/<name>.css to overrideCssPath.
 * - Parses --tug-host-canvas-color from the source CSS file.
 * - Throws if source CSS is missing or host color metadata is missing/invalid.
 *
 * The active theme name is persisted to tugbank by the client-side settings-api.ts
 * (putTheme), not by this function. This function only manages the CSS override file.
 */
export function activateThemeOverride(
  themeName: string,
  themesCssDir: string,
  overrideCssPath: string,
): ActivateResult {
  if (themeName === BASE_THEME_NAME) {
    fs.writeFileSync(overrideCssPath, EMPTY_OVERRIDE, "utf-8");
    const baseCss = fs.readFileSync(BASE_THEME_CSS, "utf-8");
    const hostCanvasColor = parseHostCanvasColor(baseCss);
    if (!hostCanvasColor) {
      throw new Error(`Missing or invalid --tug-host-canvas-color in ${BASE_THEME_CSS}`);
    }
    return { theme: BASE_THEME_NAME, hostCanvasColor };
  }

  const cssPath = findThemeCssPath(themeName, themesCssDir);
  if (!cssPath) {
    throw new Error(`Theme '${themeName}' not found`);
  }

  const css = fs.readFileSync(cssPath, "utf-8");
  const hostCanvasColor = parseHostCanvasColor(css);
  if (!hostCanvasColor) {
    throw new Error(`Missing or invalid --tug-host-canvas-color in ${cssPath}`);
  }
  fs.writeFileSync(overrideCssPath, css, "utf-8");
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
// activateThemeOverride inside the write mutex, and returns the response.
// Exported for unit testing with mocked fs.
//
// Parameters:
//   body           — parsed JSON request body (unknown)
//   fsImpl         — fs implementation (real or mock)
//   themesCssDir   — absolute path to shipped theme CSS files
//   overrideCssPath — absolute path to tug-theme-override.css
// ---------------------------------------------------------------------------

export async function handleThemesActivate(
  body: unknown,
  themesCssDir: string,
  overrideCssPath: string,
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
        const result = activateThemeOverride(name, themesCssDir, overrideCssPath);
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
              handleThemesActivate(body, SHIPPED_THEMES_CSS_DIR, THEME_OVERRIDE_CSS).then((result) => {
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
    plugins: [react(), themeOverridePlugin(), paletteHotReload(), controlTokenHotReload(), themeSaveLoadPlugin()],
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
