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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BASE_THEME_NAME } = require("./src/theme-constants") as { BASE_THEME_NAME: string };

/** Empty override — base theme default. */
const EMPTY_OVERRIDE = `/* empty - ${BASE_THEME_NAME} default */\n`;

// ---------------------------------------------------------------------------
// formulasCache — in-memory cache of latest DerivationFormulas + ThemeSpec
//
// Populated by all activateThemeOverride call sites from the returned
// ActivateResult. The GET /__themes/formulas endpoint reads from this cache.
// ---------------------------------------------------------------------------

/** Cached derivation state served by GET /__themes/formulas. */
export interface FormulasCache {
  formulas: Record<string, number | string | boolean>;
  mode: "dark" | "light";
  themeName: string;
}

/** In-memory cache. Null until a theme has been activated. */
let formulasCache: FormulasCache | null = null;

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

      // Locate theme JSON: shipped dir first (by direct filename), then user dir (by name-scan).
      const shippedJsonPath = path.join(SHIPPED_THEMES_DIR, `${activeTheme}.json`);
      let jsonPath: string | null = null;
      if (fs.existsSync(shippedJsonPath)) {
        jsonPath = shippedJsonPath;
      } else {
        jsonPath = findUserThemeByName(activeTheme, fs as unknown as FsReadImpl, USER_THEMES_DIR);
      }

      if (!jsonPath) {
        console.warn(`[themeOverridePlugin] theme "${activeTheme}" not found, falling back to base theme`);
        fs.writeFileSync(THEME_OVERRIDE_CSS, EMPTY_OVERRIDE, "utf-8");
        return;
      }

      try {
        const raw = fs.readFileSync(jsonPath, "utf-8");
        let parsed = JSON.parse(raw) as import("./src/components/tugways/theme-engine").ThemeSpec & { mode: unknown };

        // Legacy migration guard: detect old format where mode is a stringified JSON blob.
        if (typeof parsed.mode === "string" && (parsed.mode as string).startsWith("{")) {
          let unwrapped: import("./src/components/tugways/theme-engine").ThemeSpec;
          try {
            unwrapped = JSON.parse(parsed.mode as string) as import("./src/components/tugways/theme-engine").ThemeSpec;
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

        const spec = parsed as import("./src/components/tugways/theme-engine").ThemeSpec;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { generateThemeCSS } = require("./src/theme-css-generator") as { generateThemeCSS: (r: typeof spec) => string };
        const css = generateThemeCSS(spec);
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
 * After regeneration, if a non-base theme is active, the override CSS is
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
    // Read active theme from tugbank. Falls back to the base theme on any failure.
    let activeTheme = BASE_THEME_NAME;
    try {
      const raw = execSync("tugbank read dev.tugtool.app theme", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      if (raw) activeTheme = raw;
    } catch {
      // tugbank unavailable or key not set → default to base theme.
    }

    if (!activeTheme || activeTheme === BASE_THEME_NAME) {
      // Base theme: override file stays empty; no action needed.
      return;
    }

    // Non-base theme: re-derive override CSS through the write mutex to avoid races.
    withMutex(async () => {
      try {
        const result = activateThemeOverride(
          activeTheme,
          fs as unknown as FsWriteImpl,
          SHIPPED_THEMES_DIR,
          USER_THEMES_DIR,
          THEME_OVERRIDE_CSS,
        );
        formulasCache = { formulas: result.formulas, mode: result.mode, themeName: result.theme };
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
        return;
      }
      // Regenerate when any recipe file changes (supports formula write-back hot-reload, [D07])
      const recipesDir = path.resolve(__dirname, "src/components/tugways/recipes");
      if (file.startsWith(recipesDir) && file.endsWith(".ts")) {
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
  mode: string;
  source: "shipped" | "authored";
}

/** Full ThemeSpec JSON body sent to POST /__themes/save (minus formulas). */
export interface ThemeSaveBody {
  name: string;
  mode: string; // "dark", "light", or future modes — NOT a JSON blob
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
//   1. base theme first
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
      const parsed = JSON.parse(raw) as { mode?: string };
      entries.push({ name, mode: parsed.mode ?? "dark", source: "shipped" });
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
      const parsed = JSON.parse(raw) as { name?: string; mode?: string };
      // Use the JSON `name` field as the display name (hash-named files store the original display name)
      const displayName = parsed.name ?? file.slice(0, -5);
      entries.push({ name: displayName, mode: parsed.mode ?? "dark", source: "authored" });
    } catch {
      // Skip malformed files
    }
  }

  // Sort: base theme first, then shipped alphabetical, then authored alphabetical
  entries.sort((a, b) => {
    if (a.name === BASE_THEME_NAME) return -1;
    if (b.name === BASE_THEME_NAME) return 1;
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
  const spec = b as ThemeSaveBody;
  if (!spec.mode || typeof spec.mode !== "string") {
    return { status: 400, body: JSON.stringify({ error: "mode field is required" }), themeName: null };
  }
  if (spec.mode.startsWith("{")) {
    return { status: 400, body: JSON.stringify({ error: "mode must be a mode string (e.g. 'dark'), not a JSON object" }), themeName: null };
  }
  if (!spec.surface || typeof spec.surface !== "object") {
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
    const normalizedSpec: ThemeSaveBody = { ...spec, name: displayName };
    fsImpl.writeFileSync(jsonPath, JSON.stringify(normalizedSpec, null, 2), "utf-8");
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
  /** DerivationFormulas produced by the active theme recipe. */
  formulas: Record<string, number | string | boolean>;
  /** Mode of the active theme ("dark" | "light"). */
  mode: "dark" | "light";
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
  fsImpl: FsWriteImpl,
  shippedDir: string,
  userDir: string,
  overrideCssPath: string,
): ActivateResult {
  if (themeName === BASE_THEME_NAME) {
    fsImpl.writeFileSync(overrideCssPath, EMPTY_OVERRIDE, "utf-8");

    // Base theme canvas params: derived from the base theme's JSON recipe.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { deriveTheme } = require("./src/components/tugways/theme-engine") as { deriveTheme: (r: import("./src/components/tugways/theme-engine").ThemeSpec) => import("./src/components/tugways/theme-engine").ThemeOutput };
    const baseRaw = fsImpl.readFileSync(path.join(shippedDir, `${BASE_THEME_NAME}.json`), "utf-8");
    const baseSpec = JSON.parse(baseRaw) as import("./src/components/tugways/theme-engine").ThemeSpec;
    const baseOutput = deriveTheme(baseSpec);
    return {
      theme: BASE_THEME_NAME,
      canvasParams: {
        hue: baseSpec.surface.canvas.hue,
        tone: baseOutput.formulas.surfaceCanvasTone,
        intensity: baseOutput.formulas.surfaceCanvasIntensity,
      },
      formulas: baseOutput.formulas as unknown as Record<string, number | string | boolean>,
      mode: baseSpec.mode,
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
  let parsed = JSON.parse(raw) as import("./src/components/tugways/theme-engine").ThemeSpec & { mode: unknown };

  // Legacy migration guard: detect old format where mode is a stringified JSON blob.
  // Old clients sent { name, mode: JSON.stringify(fullSpec) } to the save endpoint,
  // resulting in files where mode is a JSON string starting with "{" instead of a mode string.
  if (typeof parsed.mode === "string" && (parsed.mode as string).startsWith("{")) {
    let unwrapped: import("./src/components/tugways/theme-engine").ThemeSpec;
    try {
      unwrapped = JSON.parse(parsed.mode as string) as import("./src/components/tugways/theme-engine").ThemeSpec;
    } catch {
      throw new Error(`Theme '${themeName}' has corrupt mode data`);
    }
    // Rewrite file in canonical format (best-effort).
    try {
      fsImpl.writeFileSync(jsonPath, JSON.stringify(unwrapped, null, 2), "utf-8");
    } catch {
      // Rewrite failed — theme still works for this session.
    }
    parsed = unwrapped as typeof parsed;
  }

  const spec = parsed as import("./src/components/tugways/theme-engine").ThemeSpec;

  // Lazy-require to avoid circular dependency at module parse time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { generateThemeCSS } = require("./src/theme-css-generator") as { generateThemeCSS: (r: import("./src/components/tugways/theme-engine").ThemeSpec) => string };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { deriveTheme } = require("./src/components/tugways/theme-engine") as { deriveTheme: (r: import("./src/components/tugways/theme-engine").ThemeSpec) => import("./src/components/tugways/theme-engine").ThemeOutput };

  const css = generateThemeCSS(spec);
  fsImpl.writeFileSync(overrideCssPath, css, "utf-8");

  const themeOutput = deriveTheme(spec);
  return {
    theme: themeName,
    canvasParams: {
      hue: spec.surface.canvas.hue,
      tone: themeOutput.formulas.surfaceCanvasTone,
      intensity: themeOutput.formulas.surfaceCanvasIntensity,
    },
    formulas: themeOutput.formulas as unknown as Record<string, number | string | boolean>,
    mode: spec.mode,
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
// handleFormulasGet — GET /__themes/formulas
//
// Returns the cached DerivationFormulas and ThemeSpec mode as JSON per Spec S03.
// Returns 404 if no theme has been activated yet.
//
// Exported for unit testing.
// ---------------------------------------------------------------------------

/**
 * Handle GET /__themes/formulas.
 *
 * @param cache - Current formulas cache (null if no theme activated yet).
 * @returns HTTP response with status and body.
 */
export function handleFormulasGet(cache: FormulasCache | null): { status: number; body: string } {
  if (cache === null) {
    return { status: 404, body: JSON.stringify({ error: "no active theme" }) };
  }
  const response = {
    formulas: cache.formulas,
    mode: cache.mode,
    themeName: cache.themeName,
  };
  return { status: 200, body: JSON.stringify(response) };
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
        formulasCache = { formulas: result.formulas, mode: result.mode, themeName: result.theme };
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
 * GET  /__themes/formulas     — current DerivationFormulas cache (Spec S03)
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

          if (req.method === "GET" && url === "/formulas") {
            const result = handleFormulasGet(formulasCache);
            res.writeHead(result.status, { "Content-Type": "application/json" });
            res.end(result.body);
            return;
          }

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
                  formulasCache = { formulas: activateResult.formulas, mode: activateResult.mode, themeName: activateResult.theme };
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
