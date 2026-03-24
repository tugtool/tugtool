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

/**
 * Cached formulas data from the most recently activated theme.
 * Served via GET /__themes/formulas for the style inspector.
 *
 * Note: sources are NOT cached here — they are read fresh from the recipe file
 * on each GET request so they are always in sync with the current file on disk.
 */
export interface FormulasCache {
  formulas: Record<string, number | string | boolean>;
  /** Default formula values from initial theme activation, before any recipe edits. */
  defaults: Record<string, number | string | boolean>;
  mode: "dark" | "light";
  themeName: string;
}
let formulasCache: FormulasCache | null = null;

/**
 * Handle GET /__themes/formulas.
 * Returns formulas data for the active theme, or 404 if none.
 *
 * Sources are read directly from the recipe file at request time so they are
 * always fresh (no sidecar file, no caching of source expressions). [D07]
 *
 * @param cache - Current FormulasCache (may be null)
 * @param recipesDir - Absolute path to the recipes directory
 * @param fsImpl - fs implementation (real or mock)
 */
export function handleFormulasGet(
  cache: FormulasCache | null,
  recipesDir: string,
  fsImpl: { readFileSync: (p: string, enc: "utf-8") => string }
): { status: number; body: string } {
  if (cache === null) {
    return { status: 404, body: JSON.stringify({ error: "no active theme" }) };
  }

  // Extract source expressions from the recipe file directly at request time.
  const sources: Record<string, string> = {};
  try {
    const recipeFilePath = path.resolve(recipesDir, `${cache.mode}.ts`);
    const recipeContent = fsImpl.readFileSync(recipeFilePath, "utf-8");
    const assignmentRegex = /^\s*(\w+)\s*:\s*(.+?)[\s,]*$/gm;
    let match: RegExpExecArray | null;
    while ((match = assignmentRegex.exec(recipeContent)) !== null) {
      const field = match[1];
      const rhs = match[2].trim().replace(/,\s*$/, "");
      if (field && rhs && Object.prototype.hasOwnProperty.call(cache.formulas, field)) {
        sources[field] = rhs;
      }
    }
  } catch {
    // Recipe source extraction failed — sources will be empty, fields will be read-only.
  }

  return {
    status: 200,
    body: JSON.stringify({ formulas: cache.formulas, defaults: cache.defaults, sources, mode: cache.mode, themeName: cache.themeName }),
  };
}

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
      // The subprocess outputs formulas JSON to stdout; capture it to populate formulasCache.
      try {
        const script = path.resolve(__dirname, "scripts/generate-theme-override.ts");
        const output = execSync(`bun run ${script} ${JSON.stringify(jsonPath)} ${JSON.stringify(THEME_OVERRIDE_CSS)}`, {
          cwd: __dirname,
          stdio: "pipe",
        });
        try {
          const parsed = JSON.parse(output.toString().trim());
          formulasCache = { ...parsed, defaults: { ...parsed.formulas } };
        } catch {
          // Formulas parse failed — inspector will show without formula section.
        }
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
/** Locate theme JSON path by name: shipped dir first, then user dir. */
function findThemeJsonPath(themeName: string): string | null {
  const shippedJsonPath = path.join(SHIPPED_THEMES_DIR, `${themeName}.json`);
  if (fs.existsSync(shippedJsonPath)) return shippedJsonPath;
  return findUserThemeByName(themeName, fs as unknown as FsReadImpl, USER_THEMES_DIR);
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
      console.error(`[control-token-hot-reload] theme "${activeTheme}" not found`);
      return;
    }
    // The subprocess outputs formulas JSON to stdout; capture it to populate formulasCache.
    try {
      const script = path.resolve(__dirname, "scripts/generate-theme-override.ts");
      const output = execSync(`bun run ${script} ${JSON.stringify(jsonPath)} ${JSON.stringify(THEME_OVERRIDE_CSS)}`, {
        cwd: __dirname,
        stdio: "pipe",
      });
      try {
        const parsed = JSON.parse(output.toString().trim());
        const prevDefaults = formulasCache?.defaults ?? parsed.formulas;
        formulasCache = { ...parsed, defaults: { ...prevDefaults } };
      } catch {
        // Formulas parse failed — inspector will show without formula section.
      }
    } catch (err) {
      console.error(`[control-token-hot-reload] failed to re-derive override for theme "${activeTheme}":`, err);
    }
  }

  return {
    name: "control-token-hot-reload",
    buildStart() {
      regenerate();
    },
    handleHotUpdate({ file, server }) {
      // Generated .ts files written by regenerate() — suppress module-graph HMR.
      // Their effects are delivered via CSS HMR from the .css files in the same pass.
      const generatedDir = path.resolve(__dirname, "src/generated");
      if (file.startsWith(generatedDir) && file.endsWith(".ts")) {
        return [];
      }
      if (file.endsWith("theme-engine.ts")) {
        regenerate();
        reactivateActiveTheme();
        server.hot.send({ type: "custom", event: "tug:formulas-updated" });
        return [];
      }
      // Regenerate when any shipped theme JSON changes
      const themesJsonDir = path.resolve(__dirname, "themes");
      if (file.startsWith(themesJsonDir) && file.endsWith(".json")) {
        regenerate();
        reactivateActiveTheme();
        server.hot.send({ type: "custom", event: "tug:formulas-updated" });
        return [];
      }
      // Regenerate when recipe files change. Both regenerate() and
      // reactivateActiveTheme() use subprocesses so they get fresh module state.
      // After reactivation, notify the client that formulas have been updated. [D04]
      const recipesDir = path.resolve(__dirname, "src/components/tugways/recipes");
      if (file.startsWith(recipesDir) && file.endsWith(".ts")) {
        regenerate();
        reactivateActiveTheme();
        server.hot.send({ type: "custom", event: "tug:formulas-updated" });
        return [];
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
  formulas: Record<string, number | string | boolean>;
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
    // Dynamic path construction prevents Vite's static config-dep scanner from
    // tracing through theme-engine → recipes/* and registering them as config deps.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { deriveTheme } = require([".", "src", "components", "tugways", "theme-engine"].join("/")) as { deriveTheme: (r: import("./src/components/tugways/theme-engine").ThemeSpec) => import("./src/components/tugways/theme-engine").ThemeOutput };
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
      formulas: baseOutput.formulas as Record<string, number | string | boolean>,
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

  // Dynamic path construction prevents Vite's static config-dep scanner from
  // tracing through theme-engine → recipes/* and registering them as config deps.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { generateThemeCSS } = require([".", "src", "theme-css-generator"].join("/")) as { generateThemeCSS: (r: import("./src/components/tugways/theme-engine").ThemeSpec) => string };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { deriveTheme } = require([".", "src", "components", "tugways", "theme-engine"].join("/")) as { deriveTheme: (r: import("./src/components/tugways/theme-engine").ThemeSpec) => import("./src/components/tugways/theme-engine").ThemeOutput };

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
    formulas: themeOutput.formulas as Record<string, number | string | boolean>,
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
        formulasCache = { formulas: result.formulas, defaults: { ...result.formulas }, mode: result.mode, themeName: name };
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

// ---------------------------------------------------------------------------
// findAndEditNumericLiteral — targeted numeric literal replacement in recipe files
//
// Finds the line containing `field:` and replaces the appropriate numeric
// literal with `newValue`. The replacement strategy depends on expression form:
//
//   Clamp wrapper:  Math.max(N, Math.min(N, innerExpr))
//     → if innerExpr contains an arithmetic operator (+/-) followed by a numeric
//       literal, replace that literal.
//     → if innerExpr is a bare variable (no arithmetic literal), return null —
//       the 0 and 100 are clamp bounds, not user-authored offsets.
//
//   Non-clamped line:
//     → replace the LAST numeric literal on the line (covers bare literals,
//       variable ± offset, Math.round(expr ± N), etc.)
//     → if the line has NO numeric literal to replace (bare variable ref,
//       shorthand property reference, spec path reference), return null.
//
// The replace-last-literal strategy is intentional: for `primaryTextTone - 28`
// the last literal is 28 (the editable offset), not any implicit ones.
// For `Math.round(primaryTextTone - 57)` the last literal inside the round is 57.
//
// Returns the modified file content, or null if the field is not found or is
// non-editable (no numeric literal to target). [D02, R03]
// ---------------------------------------------------------------------------

export function findAndEditNumericLiteral(
  fileContent: string,
  field: string,
  newValue: number | string,
): string | null {
  const lines = fileContent.split("\n");
  const fieldPattern = new RegExp(`^(\\s*${field}:\\s*)(.+?)([,;]?\\s*)$`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = fieldPattern.exec(line);
    if (!match) continue;

    const prefix = match[1]; // "  fieldName: "
    const rhs = match[2];    // expression value
    const suffix = match[3]; // trailing comma/semicolon

    // Detect Math.max(N, Math.min(N, innerExpr)) clamp wrapper.
    // The pattern matches the full clamped expression with any whitespace.
    const clampMatch = /^Math\.max\(\s*[\d.]+\s*,\s*Math\.min\(\s*[\d.]+\s*,\s*(.+?)\s*\)\s*\)$/.exec(rhs.trim());

    if (clampMatch) {
      const innerExpr = clampMatch[1].trim();
      // Check if innerExpr has an arithmetic operator followed by a numeric literal.
      // Pattern: <variable> [+|-] <numericLiteral>
      const innerArithMatch = /^(.+?)\s*([+\-])\s*([\d.]+)\s*$/.exec(innerExpr);
      if (innerArithMatch) {
        // Replace the numeric literal after the operator.
        const varPart = innerArithMatch[1];
        const op = innerArithMatch[2];
        const newRhs = rhs.replace(
          new RegExp(`(Math\\.max\\(\\s*[\\d.]+\\s*,\\s*Math\\.min\\(\\s*[\\d.]+\\s*,\\s*${escapeRegex(varPart)}\\s*[${escapeRegex(op)}]\\s*)[\\d.]+`),
          `$1${newValue}`,
        );
        if (newRhs === rhs) {
          // Fallback: replace last numeric literal in the full line
          const replaced = replaceLast(rhs, newValue);
          if (replaced === null) return null;
          lines[i] = prefix + replaced + suffix;
        } else {
          lines[i] = prefix + newRhs + suffix;
        }
        return lines.join("\n");
      }
      // innerExpr has no arithmetic literal (bare variable inside clamp) — non-editable.
      return null;
    }

    // Non-clamped: replace the LAST numeric literal on the line.
    // If no literal exists, fall back to replacing the entire RHS with newValue.
    const replaced = replaceLast(rhs, newValue);
    if (replaced === null) {
      // Fallback: whole-RHS replacement (e.g., spec.role.tone → 45, Math.round(x) → 60)
      lines[i] = prefix + String(newValue) + suffix;
    } else {
      lines[i] = prefix + replaced + suffix;
    }
    return lines.join("\n");
  }

  // Field not found.
  return null;
}

/** Escape a string for use inside a RegExp character class or pattern. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace the LAST numeric literal (integer or decimal) in `expr` with
 * `newValue`. Returns null if no numeric literal exists in the expression.
 */
function replaceLast(expr: string, newValue: number | string): string | null {
  // Find all numeric literals in the expression.
  // We use a global regex and track the last match.
  const numericPattern = /\d+(?:\.\d+)?/g;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = numericPattern.exec(expr)) !== null) {
    lastMatch = m;
  }
  if (lastMatch === null) return null;

  const before = expr.slice(0, lastMatch.index);
  const after = expr.slice(lastMatch.index + lastMatch[0].length);
  return before + String(newValue) + after;
}

// ---------------------------------------------------------------------------
// handleFormulaEdit — POST /__themes/formula
//
// Validates the request body (field: string, value: number | string),
// resolves the recipe file path from formulasCache.mode, reads the file,
// calls findAndEditNumericLiteral, and writes the modified content back.
//
// Returns:
//   200 { ok: true }            on success
//   400 { error: ... }          for invalid body
//   404 { error: ... }          if field not found or not editable
//   500 { error: ... }          on I/O failure
//
// Parameters:
//   body             — parsed JSON request body (unknown)
//   fsImpl           — fs implementation (real or mock)
//   formulasCacheRef — current FormulasCache (may be null)
//   recipesDir       — absolute path to the recipes directory (injected for testability)
// ---------------------------------------------------------------------------

/** Request body shape for POST /__themes/formula */
export interface FormulaEditBody {
  field: string;
  value: number | string;
}

export function handleFormulaEdit(
  body: unknown,
  fsImpl: FsWriteImpl,
  formulasCacheRef: FormulasCache | null,
  recipesDir: string,
): { status: number; body: string } {
  if (!body || typeof body !== "object") {
    return { status: 400, body: JSON.stringify({ error: "invalid request body" }) };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.field !== "string" || b.field.trim() === "") {
    return { status: 400, body: JSON.stringify({ error: "field is required" }) };
  }
  if (b.value === undefined || b.value === null || (typeof b.value !== "number" && typeof b.value !== "string")) {
    return { status: 400, body: JSON.stringify({ error: "value must be a number or string" }) };
  }

  const field = b.field.trim();
  const value = b.value as number | string;

  if (!formulasCacheRef) {
    return { status: 404, body: JSON.stringify({ error: "no active theme" }) };
  }

  const mode = formulasCacheRef.mode;
  const recipeFilePath = path.resolve(recipesDir, `${mode}.ts`);

  let fileContent: string;
  try {
    fileContent = fsImpl.readFileSync(recipeFilePath, "utf-8");
  } catch (err) {
    return { status: 500, body: JSON.stringify({ error: `Failed to read recipe file: ${String(err)}` }) };
  }

  const modified = findAndEditNumericLiteral(fileContent, field, value);
  if (modified === null) {
    return { status: 404, body: JSON.stringify({ error: `Field '${field}' not found or not editable` }) };
  }

  try {
    fsImpl.writeFileSync(recipeFilePath, modified, "utf-8");
  } catch (err) {
    return { status: 500, body: JSON.stringify({ error: `Failed to write recipe file: ${String(err)}` }) };
  }

  return { status: 200, body: JSON.stringify({ ok: true }) };
}

/**
 * Vite plugin: theme storage API endpoints for the dev server.
 * GET  /__themes/list         — list available themes (shipped + authored)
 * GET  /__themes/<name>.json  — load theme JSON (authored first, then shipped)
 * POST /__themes/save         — save a new authored theme to disk
 * POST /__themes/activate     — activate a theme by rewriting the override file
 * POST /__themes/formula      — edit a numeric literal in the active recipe file
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

          if (req.method === "GET" && url === "/formulas") {
            const recipesDir = path.resolve(__dirname, "src/components/tugways/recipes");
            const result = handleFormulasGet(formulasCache, recipesDir, fs as unknown as { readFileSync: (p: string, enc: "utf-8") => string });
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
                  formulasCache = { formulas: activateResult.formulas, defaults: { ...activateResult.formulas }, mode: activateResult.mode, themeName: saveResult.themeName! };
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

          if (req.method === "POST" && url === "/formula") {
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
              const recipesDir = path.resolve(__dirname, "src/components/tugways/recipes");
              const result = handleFormulaEdit(body, fs as unknown as FsWriteImpl, formulasCache, recipesDir);
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
