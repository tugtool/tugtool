import { defineConfig } from "vite";
import type { Plugin as VitePlugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import os from "os";
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

// ---------------------------------------------------------------------------
// Active-theme file location (written by activate endpoint, read by plugin)
// ---------------------------------------------------------------------------

/** Absolute path to the active-theme persistence file. */
const ACTIVE_THEME_FILE = path.resolve(__dirname, "..", ".tugtool", "active-theme");

/** Absolute path to the override CSS file in the Vite module graph. */
const THEME_OVERRIDE_CSS = path.resolve(__dirname, "styles/tug-theme-override.css");

/** Empty override — Brio default. */
const EMPTY_OVERRIDE = "/* empty - brio default */\n";

/**
 * Vite plugin: ensure `tug-theme-override.css` reflects the active theme at
 * startup, before Vite processes any CSS.
 *
 * - In build mode: always writes an empty override (Brio default).
 * - If `.tugtool/active-theme` is missing or set to `brio`: empty override.
 * - If `.tugtool/active-theme` names a non-Brio theme: derives CSS from the
 *   theme JSON and writes it to the override file so PostCSS can expand it.
 * - If the named theme JSON cannot be found: logs a warning and falls back to
 *   Brio (empty override).
 */
function themeOverridePlugin(): VitePlugin {
  return {
    name: "theme-override",
    async configResolved(config) {
      // In build mode always use Brio (empty override).
      if (config.command === "build") {
        fs.writeFileSync(THEME_OVERRIDE_CSS, EMPTY_OVERRIDE, "utf-8");
        return;
      }

      // Read active theme name.
      let activeTheme = "brio";
      try {
        activeTheme = fs.readFileSync(ACTIVE_THEME_FILE, "utf-8").trim();
      } catch {
        // File missing → default to brio.
      }

      if (!activeTheme || activeTheme === "brio") {
        fs.writeFileSync(THEME_OVERRIDE_CSS, EMPTY_OVERRIDE, "utf-8");
        return;
      }

      // Locate theme JSON: shipped dir first, then user dir.
      const shippedJsonPath = path.join(SHIPPED_THEMES_DIR, `${activeTheme}.json`);
      const userJsonPath = path.join(USER_THEMES_DIR, `${activeTheme}.json`);
      let jsonPath: string | null = null;
      if (fs.existsSync(shippedJsonPath)) {
        jsonPath = shippedJsonPath;
      } else if (fs.existsSync(userJsonPath)) {
        jsonPath = userJsonPath;
      }

      if (!jsonPath) {
        console.warn(`[themeOverridePlugin] theme "${activeTheme}" not found, falling back to Brio`);
        fs.writeFileSync(THEME_OVERRIDE_CSS, EMPTY_OVERRIDE, "utf-8");
        return;
      }

      try {
        const raw = fs.readFileSync(jsonPath, "utf-8");
        const recipe = JSON.parse(raw) as import("./src/components/tugways/theme-engine").ThemeRecipe;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { generateThemeCSS } = require("./src/theme-css-generator") as { generateThemeCSS: (r: typeof recipe) => string };
        const css = generateThemeCSS(recipe);
        fs.writeFileSync(THEME_OVERRIDE_CSS, css, "utf-8");
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
 * Uses Vite's built-in watcher via handleHotUpdate (no separate fs.watchFile).
 * Also runs once at buildStart to ensure tug-base.css is in sync.
 */
function controlTokenHotReload(): VitePlugin {
  const scriptPath = path.resolve(__dirname, "scripts/generate-tug-tokens.ts");

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
      if (file.endsWith("theme-engine.ts")) {
        regenerate();
        return;
      }
      // Regenerate when any shipped theme JSON changes
      const themesJsonDir = path.resolve(__dirname, "themes");
      if (file.startsWith(themesJsonDir) && file.endsWith(".json")) {
        regenerate();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Theme save/load middleware — handles /__themes/* endpoints
// Handler functions are exported for unit testing with mocked fs.
//
// Two-directory storage model:
//   Shipped themes: tugdeck/themes/       (read-only via middleware)
//   Authored themes: ~/.tugtool/themes/   (read/write)
// ---------------------------------------------------------------------------

/** Absolute path to the shipped theme JSON files. */
export const SHIPPED_THEMES_DIR = path.resolve(__dirname, "themes");

/** Absolute path to the shipped pre-generated theme CSS overrides. */
const SHIPPED_THEMES_CSS_DIR = path.resolve(__dirname, "styles/themes");

/** Absolute path to the user-authored theme directory. */
export const USER_THEMES_DIR = path.join(os.homedir(), ".tugtool", "themes");

export interface ThemeListEntry {
  name: string;
  recipe: string;
  source: "shipped" | "authored";
}

/** Full ThemeRecipe JSON body sent to POST /__themes/save (minus formulas). */
export interface ThemeSaveBody {
  name: string;
  recipe: string;
  surface: {
    canvas: { hue: string; tone: number; intensity: number };
    grid?: { hue: string; tone: number; intensity: number };
    frame?: { hue: string; tone: number; intensity: number };
    card?: { hue: string; tone: number; intensity: number };
  };
  text: { hue: string; intensity: number };
  display?: { hue: string; intensity: number };
  role: {
    tone: number;
    intensity: number;
    accent: string;
    action: string;
    agent: string;
    data: string;
    success: string;
    caution: string;
    danger: string;
  };
}

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
}

// ---------------------------------------------------------------------------
// handleThemesList — GET /__themes/list
//
// Returns all themes from both shipped and user directories, sorted:
//   1. brio first
//   2. other shipped themes (alphabetical)
//   3. authored themes (alphabetical)
// ---------------------------------------------------------------------------

export function handleThemesList(
  fsImpl: FsReadImpl,
  shippedDir: string,
  userDir: string,
): { status: number; body: string } {
  const entries: ThemeListEntry[] = [];

  // Read shipped themes
  let shippedFiles: string[] = [];
  try {
    shippedFiles = fsImpl.readdirSync(shippedDir).filter((f) => f.endsWith(".json"));
  } catch {
    shippedFiles = [];
  }
  for (const file of shippedFiles) {
    const name = file.slice(0, -5); // strip .json
    try {
      const raw = fsImpl.readFileSync(path.join(shippedDir, file), "utf-8");
      const parsed = JSON.parse(raw) as { recipe?: string };
      entries.push({ name, recipe: parsed.recipe ?? "dark", source: "shipped" });
    } catch {
      // Skip malformed files
    }
  }

  // Read authored themes (user dir may not exist yet)
  let authoredFiles: string[] = [];
  try {
    authoredFiles = fsImpl.readdirSync(userDir).filter((f) => f.endsWith(".json"));
  } catch {
    authoredFiles = [];
  }
  for (const file of authoredFiles) {
    const name = file.slice(0, -5);
    try {
      const raw = fsImpl.readFileSync(path.join(userDir, file), "utf-8");
      const parsed = JSON.parse(raw) as { recipe?: string };
      entries.push({ name, recipe: parsed.recipe ?? "dark", source: "authored" });
    } catch {
      // Skip malformed files
    }
  }

  // Sort: brio first, then shipped alphabetical, then authored alphabetical
  entries.sort((a, b) => {
    if (a.name === "brio") return -1;
    if (b.name === "brio") return 1;
    if (a.source !== b.source) {
      return a.source === "shipped" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return { status: 200, body: JSON.stringify({ themes: entries }) };
}

// ---------------------------------------------------------------------------
// handleThemesLoadJson — GET /__themes/<name>.json
//
// Checks authored dir first, then shipped dir. Returns 404 if neither exists.
// ---------------------------------------------------------------------------

export function handleThemesLoadJson(
  name: string,
  fsImpl: FsReadImpl,
  shippedDir: string,
  userDir: string,
): { status: number; body: string; contentType: string } {
  const authoredPath = path.join(userDir, `${name}.json`);
  const shippedPath = path.join(shippedDir, `${name}.json`);

  for (const filePath of [authoredPath, shippedPath]) {
    if (fsImpl.existsSync(filePath)) {
      try {
        const content = fsImpl.readFileSync(filePath, "utf-8");
        return { status: 200, body: content, contentType: "application/json" };
      } catch {
        // Try next
      }
    }
  }

  return { status: 404, body: JSON.stringify({ error: `Theme '${name}' not found` }), contentType: "application/json" };
}

// ---------------------------------------------------------------------------
// handleThemesLoadCss — GET /__themes/<name>.css
//
// - brio: always 404 (brio's CSS lives in tug-base-generated.css, not an override)
// - shipped (non-brio): serve pre-generated file from styles/themes/<name>.css
// - authored: serve from ~/.tugtool/themes/<name>.css; generate on-the-fly if missing
//   but JSON exists (fallback path; primary write path is POST /__themes/save)
// - Returns 404 if neither JSON nor CSS exists for the requested name.
// ---------------------------------------------------------------------------

export function handleThemesLoadCss(
  name: string,
  fsImpl: FsWriteImpl,
  shippedDir: string,
  shippedCssDir: string,
  userDir: string,
  generateCss: (jsonPath: string) => string,
): { status: number; body: string; contentType: string } {
  // brio always 404 — callers use the base stylesheet
  if (name === "brio") {
    return { status: 404, body: JSON.stringify({ error: "brio uses the base stylesheet, not an override" }), contentType: "application/json" };
  }

  // Check if it's a shipped theme (non-brio)
  const shippedJsonPath = path.join(shippedDir, `${name}.json`);
  if (fsImpl.existsSync(shippedJsonPath)) {
    const shippedCssPath = path.join(shippedCssDir, `${name}.css`);
    if (fsImpl.existsSync(shippedCssPath)) {
      try {
        const content = fsImpl.readFileSync(shippedCssPath, "utf-8");
        return { status: 200, body: content, contentType: "text/css" };
      } catch {
        return { status: 500, body: JSON.stringify({ error: "failed to read shipped CSS" }), contentType: "application/json" };
      }
    }
    return { status: 404, body: JSON.stringify({ error: `Shipped CSS for '${name}' not found` }), contentType: "application/json" };
  }

  // Check authored theme
  const authoredJsonPath = path.join(userDir, `${name}.json`);
  if (fsImpl.existsSync(authoredJsonPath)) {
    const authoredCssPath = path.join(userDir, `${name}.css`);
    // Serve existing CSS if present
    if (fsImpl.existsSync(authoredCssPath)) {
      try {
        const content = fsImpl.readFileSync(authoredCssPath, "utf-8");
        return { status: 200, body: content, contentType: "text/css" };
      } catch {
        return { status: 500, body: JSON.stringify({ error: "failed to read authored CSS" }), contentType: "application/json" };
      }
    }
    // On-the-fly generation fallback: JSON exists but CSS not yet written
    try {
      const css = generateCss(authoredJsonPath);
      fsImpl.writeFileSync(authoredCssPath, css, "utf-8");
      return { status: 200, body: css, contentType: "text/css" };
    } catch (err) {
      return { status: 500, body: JSON.stringify({ error: `CSS generation failed: ${String(err)}` }), contentType: "application/json" };
    }
  }

  return { status: 404, body: JSON.stringify({ error: `Theme '${name}' not found` }), contentType: "application/json" };
}

// ---------------------------------------------------------------------------
// handleThemesSave — POST /__themes/save
//
// Accepts full theme JSON, rejects names that collide with shipped themes,
// auto-creates ~/.tugtool/themes/ if missing, writes <name>.json and
// generates + writes <name>.css via generateThemeCSS().
// ---------------------------------------------------------------------------

export function handleThemesSave(
  body: unknown,
  fsImpl: FsWriteImpl,
  shippedDir: string,
  userDir: string,
  generateCss: (recipe: ThemeSaveBody) => string,
): { status: number; body: string } {
  if (!body || typeof body !== "object") {
    return { status: 400, body: JSON.stringify({ error: "invalid request body" }) };
  }
  const b = body as Record<string, unknown>;
  const name = b.name;
  if (!name || typeof name !== "string" || name.trim() === "") {
    return { status: 400, body: JSON.stringify({ error: "name is required" }) };
  }
  const safeName = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");

  // Reject names that collide with shipped themes
  const shippedJsonPath = path.join(shippedDir, `${safeName}.json`);
  if (fsImpl.existsSync(shippedJsonPath)) {
    return { status: 400, body: JSON.stringify({ error: `'${safeName}' is a shipped theme and cannot be overwritten` }) };
  }

  // Auto-create user themes directory
  try {
    fsImpl.mkdirSync(userDir, { recursive: true });
  } catch (err) {
    return { status: 500, body: JSON.stringify({ error: `Failed to create themes directory: ${String(err)}` }) };
  }

  // Validate minimum required fields
  const recipe = b as ThemeSaveBody;
  if (!recipe.recipe || typeof recipe.recipe !== "string") {
    return { status: 400, body: JSON.stringify({ error: "recipe field is required" }) };
  }

  // Write JSON
  try {
    const jsonPath = path.join(userDir, `${safeName}.json`);
    const normalizedRecipe: ThemeSaveBody = { ...recipe, name: safeName };
    fsImpl.writeFileSync(jsonPath, JSON.stringify(normalizedRecipe, null, 2), "utf-8");
  } catch (err) {
    return { status: 500, body: JSON.stringify({ error: `Failed to write theme JSON: ${String(err)}` }) };
  }

  // Generate and write CSS
  try {
    const css = generateCss({ ...recipe, name: safeName } as ThemeSaveBody);
    const cssPath = path.join(userDir, `${safeName}.css`);
    fsImpl.writeFileSync(cssPath, css, "utf-8");
  } catch (err) {
    return { status: 500, body: JSON.stringify({ error: `Failed to generate CSS: ${String(err)}` }) };
  }

  return { status: 200, body: JSON.stringify({ ok: true, name: safeName }) };
}

// ---------------------------------------------------------------------------
// Runtime CSS generator (wraps the shared theme-css-generator module)
// Lazy-loaded to avoid circular dependency at module parse time.
// ---------------------------------------------------------------------------

function makeRuntimeCssGenerator(): (recipe: ThemeSaveBody) => string {
  return (recipe: ThemeSaveBody): string => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { generateThemeCSS } = require("./src/theme-css-generator") as { generateThemeCSS: (r: ThemeSaveBody) => string };
    return generateThemeCSS(recipe);
  };
}

function makeRuntimeCssGeneratorFromPath(): (jsonPath: string) => string {
  return (jsonPath: string): string => {
    const raw = fs.readFileSync(jsonPath, "utf-8");
    const recipe = JSON.parse(raw) as ThemeSaveBody;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { generateThemeCSS } = require("./src/theme-css-generator") as { generateThemeCSS: (r: ThemeSaveBody) => string };
    return generateThemeCSS(recipe);
  };
}

/**
 * Vite plugin: theme storage API endpoints for the dev server.
 * GET  /__themes/list         — list available themes (shipped + authored)
 * GET  /__themes/<name>.json  — load theme JSON (authored first, then shipped)
 * GET  /__themes/<name>.css   — load theme CSS override
 * POST /__themes/save         — save a new authored theme to disk
 */
function themeSaveLoadPlugin(): VitePlugin {
  const generateCssFromRecipe = makeRuntimeCssGenerator();
  const generateCssFromPath = makeRuntimeCssGeneratorFromPath();
  return {
    name: "theme-save-load",
    configureServer(server) {
      server.middlewares.use(
        "/__themes",
        (req: import("http").IncomingMessage, res: import("http").ServerResponse, next: () => void) => {
          const url = req.url ?? "/";

          if (req.method === "GET" && url === "/list") {
            const result = handleThemesList(fs as unknown as FsReadImpl, SHIPPED_THEMES_DIR, USER_THEMES_DIR);
            res.writeHead(result.status, { "Content-Type": "application/json" });
            res.end(result.body);
            return;
          }

          if (req.method === "GET" && url.endsWith(".json")) {
            const name = url.replace(/^\//, "").slice(0, -5);
            if (name && !name.includes("/")) {
              const result = handleThemesLoadJson(name, fs as unknown as FsReadImpl, SHIPPED_THEMES_DIR, USER_THEMES_DIR);
              res.writeHead(result.status, { "Content-Type": result.contentType });
              res.end(result.body);
              return;
            }
          }

          if (req.method === "GET" && url.endsWith(".css")) {
            const name = url.replace(/^\//, "").slice(0, -4);
            if (name && !name.includes("/")) {
              const result = handleThemesLoadCss(name, fs as unknown as FsWriteImpl, SHIPPED_THEMES_DIR, SHIPPED_THEMES_CSS_DIR, USER_THEMES_DIR, generateCssFromPath);
              res.writeHead(result.status, { "Content-Type": result.contentType });
              res.end(result.body);
              return;
            }
          }

          if (req.method === "POST" && url === "/save") {
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
              const result = handleThemesSave(body, fs as unknown as FsWriteImpl, SHIPPED_THEMES_DIR, USER_THEMES_DIR, generateCssFromRecipe);
              res.writeHead(result.status, { "Content-Type": "application/json" });
              res.end(result.body);
            });
            return;
          }

          next();
        },
      );
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
