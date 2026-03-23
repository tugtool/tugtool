import { defineConfig } from "vite";
import type { Plugin as VitePlugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import os from "os";
import { execSync } from "child_process";
import { createHash } from "node:crypto";
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

/** Empty override — Brio default. */
const EMPTY_OVERRIDE = "/* empty - brio default */\n";

/**
 * Vite plugin: ensure `tug-theme-override.css` reflects the active theme at
 * startup, before Vite processes any CSS.
 *
 * - In build mode: always writes an empty override (Brio default).
 * - Reads the active theme name from tugbank via `tugbank read dev.tugtool.app theme`.
 * - If the theme is missing or set to `brio`: empty override.
 * - If the named theme JSON cannot be found: logs a warning and falls back to
 *   Brio (empty override).
 * - Falls back to Brio if tugbank is unavailable (e.g. not yet installed).
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

      // Read active theme name from tugbank. Falls back to "brio" on any failure
      // (tugbank not installed, key not set, tugcast not running, etc.).
      let activeTheme = "brio";
      try {
        const raw = execSync("tugbank read dev.tugtool.app theme", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
        if (raw) activeTheme = raw;
      } catch {
        // tugbank unavailable or key not set → default to brio.
      }

      if (!activeTheme || activeTheme === "brio") {
        fs.writeFileSync(THEME_OVERRIDE_CSS, EMPTY_OVERRIDE, "utf-8");
        return;
      }

      // Locate theme JSON: shipped dir first (by direct filename), then user dir (by name-scan).
      const shippedJsonPath = path.join(SHIPPED_THEMES_DIR, `${activeTheme}.json`);
      let jsonPath: string | null = null;
      if (fs.existsSync(shippedJsonPath)) {
        jsonPath = shippedJsonPath;
      } else {
        jsonPath = findUserThemeByName(activeTheme, fs as unknown as FsReadImpl, USER_THEMES_DIR);
      }

      if (!jsonPath) {
        console.warn(`[themeOverridePlugin] theme "${activeTheme}" not found, falling back to Brio`);
        fs.writeFileSync(THEME_OVERRIDE_CSS, EMPTY_OVERRIDE, "utf-8");
        return;
      }

      try {
        const raw = fs.readFileSync(jsonPath, "utf-8");
        let parsed = JSON.parse(raw) as import("./src/components/tugways/theme-engine").ThemeRecipe & { recipe: unknown };

        // Legacy migration guard: detect old format where recipe is a stringified JSON blob.
        if (typeof parsed.recipe === "string" && (parsed.recipe as string).startsWith("{")) {
          let unwrapped: import("./src/components/tugways/theme-engine").ThemeRecipe;
          try {
            unwrapped = JSON.parse(parsed.recipe as string) as import("./src/components/tugways/theme-engine").ThemeRecipe;
          } catch {
            throw new Error(`Theme '${activeTheme}' has corrupt recipe data`);
          }
          // Rewrite file in canonical format (best-effort, uses real fs).
          try {
            fs.writeFileSync(jsonPath, JSON.stringify(unwrapped, null, 2), "utf-8");
          } catch {
            // Rewrite failed — theme still works for this session.
          }
          parsed = unwrapped as typeof parsed;
        }

        const recipe = parsed as import("./src/components/tugways/theme-engine").ThemeRecipe;
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
 * After regeneration, if a non-Brio theme is active, the override CSS is
 * re-derived using activateThemeOverride so that the active theme reflects
 * the updated engine output. The write is serialized through writeMutex to
 * avoid racing with concurrent POST /__themes/activate requests.
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

  function reactivateActiveTheme() {
    // Read active theme from tugbank. Falls back to "brio" on any failure.
    let activeTheme = "brio";
    try {
      const raw = execSync("tugbank read dev.tugtool.app theme", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      if (raw) activeTheme = raw;
    } catch {
      // tugbank unavailable or key not set → default to brio.
    }

    if (!activeTheme || activeTheme === "brio") {
      // Brio: override file stays empty; no action needed.
      return;
    }

    // Non-Brio: re-derive override CSS through the write mutex to avoid races.
    withMutex(async () => {
      try {
        activateThemeOverride(
          activeTheme,
          fs as unknown as FsWriteImpl,
          SHIPPED_THEMES_DIR,
          USER_THEMES_DIR,
          THEME_OVERRIDE_CSS,
        );
      } catch (err) {
        console.error(`[control-token-hot-reload] failed to re-derive override for theme "${activeTheme}":`, err);
      }
    }).catch((err) => {
      console.error("[control-token-hot-reload] mutex error:", err);
    });
  }

  return {
    name: "control-token-hot-reload",
    buildStart() {
      regenerate();
    },
    handleHotUpdate({ file }) {
      if (file.endsWith("theme-engine.ts")) {
        regenerate();
        reactivateActiveTheme();
        return;
      }
      // Regenerate when any shipped theme JSON changes
      const themesJsonDir = path.resolve(__dirname, "themes");
      if (file.startsWith(themesJsonDir) && file.endsWith(".json")) {
        regenerate();
        reactivateActiveTheme();
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
  recipe: string; // "dark", "light", or future modes — NOT a JSON blob
  surface: {
    canvas: { hue: string; tone: number; intensity: number };
    grid: { hue: string; tone: number; intensity: number };
    frame: { hue: string; tone: number; intensity: number };
    card: { hue: string; tone: number; intensity: number };
  };
  text: { hue: string; intensity: number };
  display?: { hue: string; intensity: number };
  border?: { hue: string; intensity: number };
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
  unlinkSync?: (p: string) => void;
}

// ---------------------------------------------------------------------------
// findUserThemeByName — scan user theme directory for a theme by display name
//
// User themes are stored with hash-based filenames. To find a theme by display
// name, scan all JSON files in userDir and return the path of the first file
// whose JSON `name` field matches the given name (case-sensitive).
//
// Returns null if no matching file is found or if userDir cannot be read.
// ---------------------------------------------------------------------------

export function findUserThemeByName(name: string, fsImpl: FsReadImpl, userDir: string): string | null {
  let files: string[];
  try {
    files = fsImpl.readdirSync(userDir).filter((f) => f.endsWith(".json"));
  } catch {
    return null;
  }
  for (const file of files) {
    const filePath = path.join(userDir, file);
    try {
      const raw = fsImpl.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as { name?: string };
      if (parsed.name === name) {
        return filePath;
      }
    } catch {
      // Skip unreadable/malformed files
    }
  }
  return null;
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
    try {
      const raw = fsImpl.readFileSync(path.join(userDir, file), "utf-8");
      const parsed = JSON.parse(raw) as { name?: string; recipe?: string };
      // Use the JSON `name` field as the display name (hash-named files store the original display name)
      const displayName = parsed.name ?? file.slice(0, -5);
      entries.push({ name: displayName, recipe: parsed.recipe ?? "dark", source: "authored" });
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
  // Shipped themes use direct filename lookup
  const shippedPath = path.join(shippedDir, `${name}.json`);
  if (fsImpl.existsSync(shippedPath)) {
    try {
      const content = fsImpl.readFileSync(shippedPath, "utf-8");
      return { status: 200, body: content, contentType: "application/json" };
    } catch {
      // Fall through to user dir
    }
  }

  // User themes use name-scan lookup (hash-based filenames)
  const userPath = findUserThemeByName(name, fsImpl, userDir);
  if (userPath !== null) {
    try {
      const content = fsImpl.readFileSync(userPath, "utf-8");
      return { status: 200, body: content, contentType: "application/json" };
    } catch {
      // Fall through to 404
    }
  }

  return { status: 404, body: JSON.stringify({ error: `Theme '${name}' not found` }), contentType: "application/json" };
}

// ---------------------------------------------------------------------------
// handleThemesSave — POST /__themes/save
//
// Accepts full theme JSON, rejects names that collide with shipped themes,
// auto-creates ~/.tugtool/themes/ if missing, writes <hash>.json only.
//
// CSS generation has been removed: the middleware calls activateThemeOverride
// after a successful save so the override file is written through writeMutex
// (serialized with any concurrent activate requests).
//
// Returns { status, body, themeName } — themeName is the user's display name,
// exposed so the middleware can pass it directly to activateThemeOverride
// without re-parsing the body.
// ---------------------------------------------------------------------------

export function handleThemesSave(
  body: unknown,
  fsImpl: FsWriteImpl,
  shippedDir: string,
  userDir: string,
): { status: number; body: string; themeName: string | null } {
  if (!body || typeof body !== "object") {
    return { status: 400, body: JSON.stringify({ error: "invalid request body" }), themeName: null };
  }
  const b = body as Record<string, unknown>;
  const name = b.name;
  if (!name || typeof name !== "string" || name.trim() === "") {
    return { status: 400, body: JSON.stringify({ error: "name is required" }), themeName: null };
  }
  const displayName = name.trim();

  // Reject names that collide with shipped themes (compare lowercased display name against shipped filenames)
  const shippedJsonPath = path.join(shippedDir, `${displayName.toLowerCase()}.json`);
  if (fsImpl.existsSync(shippedJsonPath)) {
    return { status: 400, body: JSON.stringify({ error: `'${displayName}' is a shipped theme and cannot be overwritten` }), themeName: null };
  }

  // Auto-create user themes directory
  try {
    fsImpl.mkdirSync(userDir, { recursive: true });
  } catch (err) {
    return { status: 500, body: JSON.stringify({ error: `Failed to create themes directory: ${String(err)}` }), themeName: null };
  }

  // Validate minimum required fields
  const recipe = b as ThemeSaveBody;
  if (!recipe.recipe || typeof recipe.recipe !== "string") {
    return { status: 400, body: JSON.stringify({ error: "recipe field is required" }), themeName: null };
  }
  if (recipe.recipe.startsWith("{")) {
    return { status: 400, body: JSON.stringify({ error: "recipe must be a mode string (e.g. 'dark'), not a JSON object" }), themeName: null };
  }
  if (!recipe.surface || typeof recipe.surface !== "object") {
    return { status: 400, body: JSON.stringify({ error: "surface field is required" }), themeName: null };
  }

  // Delete any existing file for this display name (including legacy slug-named files)
  // to prevent duplicate theme entries after re-save.
  const existingPath = findUserThemeByName(displayName, fsImpl, userDir);
  if (existingPath !== null) {
    try {
      fsImpl.unlinkSync?.(existingPath);
    } catch {
      // Best-effort delete; if it fails the new file will still be written
    }
  }

  // Write JSON with hash-based filename; store the user's display name in the JSON
  const hash = createHash("sha256").update(displayName).digest("hex").slice(0, 8);
  try {
    const jsonPath = path.join(userDir, `${hash}.json`);
    const normalizedRecipe: ThemeSaveBody = { ...recipe, name: displayName };
    fsImpl.writeFileSync(jsonPath, JSON.stringify(normalizedRecipe, null, 2), "utf-8");
  } catch (err) {
    return { status: 500, body: JSON.stringify({ error: `Failed to write theme JSON: ${String(err)}` }), themeName: null };
  }

  // No CSS write here — the middleware calls activateThemeOverride(displayName) after this returns.
  return { status: 200, body: JSON.stringify({ ok: true, name: displayName }), themeName: displayName };
}

// ---------------------------------------------------------------------------
// activateThemeOverride — shared logic for startup plugin and activate endpoint
//
// Finds the theme JSON, derives CSS via generateThemeCSS(), writes the override
// file (empty for Brio), and returns
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
 * - For Brio: writes EMPTY_OVERRIDE to overrideCssPath.
 * - For non-Brio: derives CSS from the theme JSON and writes it to overrideCssPath.
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
  fsImpl: FsWriteImpl,
  shippedDir: string,
  userDir: string,
  overrideCssPath: string,
): ActivateResult {
  if (themeName === "brio") {
    fsImpl.writeFileSync(overrideCssPath, EMPTY_OVERRIDE, "utf-8");

    // Brio canvas params: derived from brio.json recipe.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { deriveTheme } = require("./src/components/tugways/theme-engine") as { deriveTheme: (r: import("./src/components/tugways/theme-engine").ThemeRecipe) => import("./src/components/tugways/theme-engine").ThemeOutput };
    const brioRaw = fsImpl.readFileSync(path.join(shippedDir, "brio.json"), "utf-8");
    const brioRecipe = JSON.parse(brioRaw) as import("./src/components/tugways/theme-engine").ThemeRecipe;
    const brioOutput = deriveTheme(brioRecipe);
    return {
      theme: "brio",
      canvasParams: {
        hue: brioRecipe.surface.canvas.hue,
        tone: brioOutput.formulas.surfaceCanvasTone,
        intensity: brioOutput.formulas.surfaceCanvasIntensity,
      },
    };
  }

  // Locate theme JSON: shipped dir first (by direct filename), then user dir (by name-scan).
  const shippedJsonPath = path.join(shippedDir, `${themeName}.json`);
  let jsonPath: string | null = null;
  if (fsImpl.existsSync(shippedJsonPath)) {
    jsonPath = shippedJsonPath;
  } else {
    jsonPath = findUserThemeByName(themeName, fsImpl, userDir);
  }

  if (!jsonPath) {
    throw new Error(`Theme '${themeName}' not found`);
  }

  const raw = fsImpl.readFileSync(jsonPath, "utf-8");
  let parsed = JSON.parse(raw) as import("./src/components/tugways/theme-engine").ThemeRecipe & { recipe: unknown };

  // Legacy migration guard: detect old format where recipe is a stringified JSON blob.
  // Old clients sent { name, recipe: JSON.stringify(fullRecipe) } to the save endpoint,
  // resulting in files where recipe is a JSON string starting with "{" instead of a mode string.
  if (typeof parsed.recipe === "string" && (parsed.recipe as string).startsWith("{")) {
    let unwrapped: import("./src/components/tugways/theme-engine").ThemeRecipe;
    try {
      unwrapped = JSON.parse(parsed.recipe as string) as import("./src/components/tugways/theme-engine").ThemeRecipe;
    } catch {
      throw new Error(`Theme '${themeName}' has corrupt recipe data`);
    }
    // Rewrite file in canonical format (best-effort).
    try {
      fsImpl.writeFileSync(jsonPath, JSON.stringify(unwrapped, null, 2), "utf-8");
    } catch {
      // Rewrite failed — theme still works for this session.
    }
    parsed = unwrapped as typeof parsed;
  }

  const recipe = parsed as import("./src/components/tugways/theme-engine").ThemeRecipe;

  // Lazy-require to avoid circular dependency at module parse time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { generateThemeCSS } = require("./src/theme-css-generator") as { generateThemeCSS: (r: import("./src/components/tugways/theme-engine").ThemeRecipe) => string };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { deriveTheme } = require("./src/components/tugways/theme-engine") as { deriveTheme: (r: import("./src/components/tugways/theme-engine").ThemeRecipe) => import("./src/components/tugways/theme-engine").ThemeOutput };

  const css = generateThemeCSS(recipe);
  fsImpl.writeFileSync(overrideCssPath, css, "utf-8");

  const themeOutput = deriveTheme(recipe);
  return {
    theme: themeName,
    canvasParams: {
      hue: recipe.surface.canvas.hue,
      tone: themeOutput.formulas.surfaceCanvasTone,
      intensity: themeOutput.formulas.surfaceCanvasIntensity,
    },
  };
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
//   userDir        — absolute path to user-authored theme directory
//   overrideCssPath — absolute path to tug-theme-override.css
// ---------------------------------------------------------------------------

export async function handleThemesActivate(
  body: unknown,
  fsImpl: FsWriteImpl,
  shippedDir: string,
  userDir: string,
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
        const result = activateThemeOverride(name, fsImpl, shippedDir, userDir, overrideCssPath);
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
 * Vite plugin: theme storage API endpoints for the dev server.
 * GET  /__themes/list         — list available themes (shipped + authored)
 * GET  /__themes/<name>.json  — load theme JSON (authored first, then shipped)
 * POST /__themes/save         — save a new authored theme to disk
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

          if (req.method === "GET" && url === "/list") {
            const result = handleThemesList(fs as unknown as FsReadImpl, SHIPPED_THEMES_DIR, USER_THEMES_DIR);
            res.writeHead(result.status, { "Content-Type": "application/json" });
            res.end(result.body);
            return;
          }

          if (req.method === "GET" && url.endsWith(".json")) {
            const name = decodeURIComponent(url.replace(/^\//, "").slice(0, -5));
            if (name && !name.includes("/")) {
              const result = handleThemesLoadJson(name, fs as unknown as FsReadImpl, SHIPPED_THEMES_DIR, USER_THEMES_DIR);
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
              const saveResult = handleThemesSave(body, fs as unknown as FsWriteImpl, SHIPPED_THEMES_DIR, USER_THEMES_DIR);
              if (saveResult.status !== 200 || saveResult.themeName === null) {
                res.writeHead(saveResult.status, { "Content-Type": "application/json" });
                res.end(saveResult.body);
                return;
              }
              // Activate the saved theme through the write mutex so the override
              // file write is serialized with any concurrent activate requests.
              withMutex(async () => {
                try {
                  const activateResult = activateThemeOverride(saveResult.themeName!, fs as unknown as FsWriteImpl, SHIPPED_THEMES_DIR, USER_THEMES_DIR, THEME_OVERRIDE_CSS);
                  const responseBody = JSON.stringify({ ok: true, name: saveResult.themeName, canvasParams: activateResult.canvasParams });
                  res.writeHead(200, { "Content-Type": "application/json" });
                  res.end(responseBody);
                } catch (err) {
                  res.writeHead(500, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ error: `Failed to activate saved theme: ${String(err)}` }));
                }
              }).catch((err) => {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: `Mutex error: ${String(err)}` }));
              });
            });
            return;
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
              handleThemesActivate(body, fs as unknown as FsWriteImpl, SHIPPED_THEMES_DIR, USER_THEMES_DIR, THEME_OVERRIDE_CSS).then((result) => {
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
