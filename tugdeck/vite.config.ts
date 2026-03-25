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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BASE_THEME_NAME } = require("./src/theme-constants") as { BASE_THEME_NAME: string };

/** Empty override — base theme default. */
const EMPTY_OVERRIDE = `/* empty - ${BASE_THEME_NAME} default */\n`;

/**
 * Vite plugin: ensure `tug-theme-override.css` reflects the active theme at
 * startup, before Vite processes any CSS.
 *
 * - In build mode: always writes an empty override (base theme default).
 * - Reads the active theme name from tugbank via `tugbank read dev.tugtool.app theme`.
 * - If the theme is missing or set to the base theme: empty override.
 * - If the named theme JSON cannot be found: logs a warning and falls back to
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

      // Read active theme name from tugbank. Falls back to the base theme on any failure
      // (tugbank not installed, key not set, tugcast not running, etc.).
      let activeTheme = BASE_THEME_NAME;
      try {
        const raw = execSync("tugbank read dev.tugtool.app theme", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
        if (raw) activeTheme = raw;
      } catch {
        // tugbank unavailable or key not set → default to base theme.
      }

      if (!activeTheme || activeTheme === BASE_THEME_NAME) {
        fs.writeFileSync(THEME_OVERRIDE_CSS, EMPTY_OVERRIDE, "utf-8");
        return;
      }

      const jsonPath = findThemeJsonPath(activeTheme);
      if (!jsonPath) {
        console.warn(`[themeOverridePlugin] theme "${activeTheme}" not found, falling back to base theme`);
        fs.writeFileSync(THEME_OVERRIDE_CSS, EMPTY_OVERRIDE, "utf-8");
        return;
      }

      // Generate the override CSS via a subprocess to avoid require()'ing
      // theme-engine (and its transitive recipe imports) during config loading.
      // If theme-engine is require()'d here, Vite treats the entire dependency
      // chain (including recipes/dark.ts, recipes/light.ts) as config deps and
      // auto-restarts the server whenever any of them change.
      try {
        const script = path.resolve(__dirname, "scripts/generate-theme-override.ts");
        execSync(`bun run ${script} ${JSON.stringify(jsonPath)} ${JSON.stringify(THEME_OVERRIDE_CSS)}`, {
          cwd: __dirname,
          stdio: "pipe",
        });
      } catch (err) {
        console.error(`[themeOverridePlugin] failed to generate CSS for theme "${activeTheme}":`, err);
        fs.writeFileSync(THEME_OVERRIDE_CSS, EMPTY_OVERRIDE, "utf-8");
      }
    },
  };
}

/**
 * Vite plugin: regenerate tokens when theme-engine.ts changes.
 *
 * The derivation engine is the single source of truth for all --tug-* tokens.
 * When it changes, we re-run generate-tug-tokens.ts to update the
 * generated section of tug-base.css, then CSS HMR picks up the change.
 *
 * After regeneration, if a non-base theme is active, the override CSS is
 * re-derived using activateThemeOverride so that the active theme reflects
 * the updated engine output. The write is serialized through writeMutex to
 * avoid racing with concurrent POST /__themes/activate requests.
 *
 * Uses Vite's built-in watcher via handleHotUpdate (no separate fs.watchFile).
 * Also runs once at buildStart to ensure tug-base.css is in sync.
 */
/** Locate theme JSON path by name: shipped dir only. */
function findThemeJsonPath(themeName: string): string | null {
  const shippedJsonPath = path.join(SHIPPED_THEMES_DIR, `${themeName}.json`);
  if (fs.existsSync(shippedJsonPath)) return shippedJsonPath;
  return null;
}

function controlTokenHotReload(): VitePlugin {
  const scriptPath = path.resolve(__dirname, "scripts/generate-tug-tokens.ts");

  function regenerate() {
    try {
      execSync(`bun run ${scriptPath}`, { cwd: __dirname, stdio: "pipe" });
    } catch (e) {
      console.error("[control-token-hot-reload] generation failed:", (e as Error).message);
    }
  }

  function reactivateActiveTheme() {
    // Read active theme from tugbank. Falls back to the base theme on any failure.
    let activeTheme = BASE_THEME_NAME;
    try {
      const raw = execSync("tugbank read dev.tugtool.app theme", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      if (raw) activeTheme = raw;
    } catch {
      // tugbank unavailable or key not set → default to base theme.
    }

    if (!activeTheme || activeTheme === BASE_THEME_NAME) {
      fs.writeFileSync(THEME_OVERRIDE_CSS, EMPTY_OVERRIDE, "utf-8");
      return;
    }

    // Re-derive override CSS via subprocess to avoid require()'ing theme-engine
    // in the Vite process. If theme-engine is loaded here, its transitive recipe
    // imports become config deps and Vite auto-restarts on recipe file edits.
    const jsonPath = findThemeJsonPath(activeTheme);
    if (!jsonPath) {
      console.warn(`[control-token-hot-reload] theme "${activeTheme}" not found, falling back to base theme`);
      return;
    }
    try {
      const script = path.resolve(__dirname, "scripts/generate-theme-override.ts");
      execSync(`bun run ${script} ${JSON.stringify(jsonPath)} ${JSON.stringify(THEME_OVERRIDE_CSS)}`, {
        cwd: __dirname,
        stdio: "pipe",
      });
    } catch (err) {
      console.error(`[control-token-hot-reload] failed to re-derive override for theme "${activeTheme}":`, err);
    }
  }

  return {
    name: "control-token-hot-reload",
    buildStart() {
      regenerate();
    },
    handleHotUpdate({ file }) {
      // Generated .ts files written by regenerate() — suppress module-graph HMR.
      // Their effects are delivered via CSS HMR from the .css files in the same pass.
      const generatedDir = path.resolve(__dirname, "src/generated");
      if (file.startsWith(generatedDir) && file.endsWith(".ts")) {
        return [];
      }
      if (file.endsWith("theme-engine.ts")) {
        regenerate();
        reactivateActiveTheme();
        return [];
      }
      // Regenerate when any shipped theme JSON changes
      const themesJsonDir = path.resolve(__dirname, "themes");
      if (file.startsWith(themesJsonDir) && file.endsWith(".json")) {
        regenerate();
        reactivateActiveTheme();
        return [];
      }
      // Regenerate when recipe files change. Both regenerate() and
      // reactivateActiveTheme() use subprocesses so they get fresh module state.
      const recipesDir = path.resolve(__dirname, "src/components/tugways/recipes");
      if (file.startsWith(recipesDir) && file.endsWith(".ts")) {
        regenerate();
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
//   Shipped themes: tugdeck/themes/       (read-only via middleware)
// ---------------------------------------------------------------------------

/** Absolute path to the shipped theme JSON files. */
export const SHIPPED_THEMES_DIR = path.resolve(__dirname, "themes");

// ---------------------------------------------------------------------------
// Filesystem abstraction for testability
// ---------------------------------------------------------------------------

export interface FsReadImpl {
  readdirSync: (p: string) => string[];
  readFileSync: (p: string, enc: "utf-8") => string;
  existsSync: (p: string) => boolean;
}

export interface FsWriteImpl extends FsReadImpl {
  writeFileSync: (p: string, data: string, enc: "utf-8") => void;
  mkdirSync: (p: string, opts: { recursive: boolean }) => void;
  unlinkSync?: (p: string) => void;
}

// ---------------------------------------------------------------------------
// handleThemesLoadJson — GET /__themes/<name>.json
//
// Looks only in shipped dir. Returns 404 if not found.
// ---------------------------------------------------------------------------

export function handleThemesLoadJson(
  name: string,
  fsImpl: FsReadImpl,
  shippedDir: string,
): { status: number; body: string; contentType: string } {
  // Shipped themes use direct filename lookup
  const shippedPath = path.join(shippedDir, `${name}.json`);
  if (fsImpl.existsSync(shippedPath)) {
    try {
      const content = fsImpl.readFileSync(shippedPath, "utf-8");
      return { status: 200, body: content, contentType: "application/json" };
    } catch {
      // Fall through to 404
    }
  }

  return { status: 404, body: JSON.stringify({ error: `Theme '${name}' not found` }), contentType: "application/json" };
}

// ---------------------------------------------------------------------------
// activateThemeOverride — shared logic for startup plugin and activate endpoint
//
// Finds the theme JSON, derives CSS via generateThemeCSS(), writes the override
// file (empty for the base theme), and returns
// { theme, canvasParams }. Both the startup plugin and the POST /activate
// handler call this function; tests can inject a mock fsImpl.
//
// The lazy require() pattern is used to avoid circular dependencies at module
// parse time. This matches the existing pattern in the startup plugin.
// ---------------------------------------------------------------------------

/** Canvas color params returned alongside the theme name by activateThemeOverride. */
export interface ActivateCanvasParams {
  hue: string;
  tone: number;
  intensity: number;
}

/** Return value of activateThemeOverride on success. */
export interface ActivateResult {
  theme: string;
  canvasParams: ActivateCanvasParams;
}

/**
 * Activate a theme by rewriting the override CSS file.
 * Returns { theme, canvasParams } on success.
 *
 * - For the base theme: writes EMPTY_OVERRIDE to overrideCssPath.
 * - For non-base themes: derives CSS from the theme JSON and writes it to overrideCssPath.
 * - Throws if the theme JSON cannot be found or CSS generation fails.
 *
 * The active theme name is persisted to tugbank by the client-side settings-api.ts
 * (putTheme), not by this function. This function only manages the CSS override file.
 *
 * Both generateThemeCSS and deriveTheme are lazy-required to avoid circular
 * dependency at module parse time.
 */
export function activateThemeOverride(
  themeName: string,
  shippedDir: string,
  overrideCssPath: string,
): ActivateResult {
  if (themeName === BASE_THEME_NAME) {
    fs.writeFileSync(overrideCssPath, EMPTY_OVERRIDE, "utf-8");
    // For base theme, run the subprocess to get canvasParams.
    const jsonPath = path.join(shippedDir, `${BASE_THEME_NAME}.json`);
    const script = path.resolve(__dirname, "scripts/generate-theme-override.ts");
    // The subprocess writes CSS and outputs canvasParams JSON to stdout.
    // For base theme, the CSS will be overwritten with EMPTY_OVERRIDE above,
    // but we need the subprocess to derive canvasParams.
    const stdout = execSync(`bun run ${script} ${JSON.stringify(jsonPath)} ${JSON.stringify(overrideCssPath)}`, {
      cwd: __dirname,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Restore empty override (subprocess wrote the full CSS)
    fs.writeFileSync(overrideCssPath, EMPTY_OVERRIDE, "utf-8");
    try {
      return JSON.parse(stdout.trim()) as ActivateResult;
    } catch {
      return { theme: BASE_THEME_NAME, canvasParams: { hue: "indigo", tone: 95, intensity: 3 } };
    }
  }

  const jsonPath = path.join(shippedDir, `${themeName}.json`);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Theme '${themeName}' not found`);
  }

  const script = path.resolve(__dirname, "scripts/generate-theme-override.ts");
  const stdout = execSync(`bun run ${script} ${JSON.stringify(jsonPath)} ${JSON.stringify(overrideCssPath)}`, {
    cwd: __dirname,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    return JSON.parse(stdout.trim()) as ActivateResult;
  } catch {
    return { theme: themeName, canvasParams: { hue: "orange", tone: 45, intensity: 50 } };
  }
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
//   shippedDir     — absolute path to shipped theme JSON files
//   overrideCssPath — absolute path to tug-theme-override.css
// ---------------------------------------------------------------------------

export async function handleThemesActivate(
  body: unknown,
  shippedDir: string,
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
        const result = activateThemeOverride(name, shippedDir, overrideCssPath);
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
 * GET  /__themes/<name>.json  — load shipped theme JSON
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

          if (req.method === "GET" && url.endsWith(".json")) {
            const name = decodeURIComponent(url.replace(/^\//, "").slice(0, -5));
            if (name && !name.includes("/")) {
              const result = handleThemesLoadJson(name, fs as unknown as FsReadImpl, SHIPPED_THEMES_DIR);
              res.writeHead(result.status, { "Content-Type": result.contentType });
              res.end(result.body);
              return;
            }
          }

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
              handleThemesActivate(body, SHIPPED_THEMES_DIR, THEME_OVERRIDE_CSS).then((result) => {
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
