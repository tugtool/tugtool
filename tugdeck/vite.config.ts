import { defineConfig } from "vite";
import type { Plugin as VitePlugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
// postcss-tug-color expands --tug-color(color, i: intensity, t: tone) to oklch() at build time.
import postcssTugColor from "./postcss-tug-color";
// theme-editor-core re-hues a theme's Key/Accent axes; shared with
// scripts/apply-theme-editor.ts.
import {
  applyDuet,
  deriveTheme,
  diffMergeBaseline,
  extractBaseline,
  identitySeed,
  isKnownHue,
  type DuetSeed,
} from "./theme-editor-core";

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

/**
 * The dev server's authoritative record of which theme is currently active.
 *
 * Seeded at server boot from a best-effort `tugbank read` (see
 * `themeLoaderPlugin`), then driven by the client: every successful
 * POST `/__themes/activate` updates it. This — NOT a fresh `tugbank read` —
 * is what `controlTokenHotReload` re-bakes when a theme's CSS is edited.
 *
 * Why not re-read tugbank on every token edit: the dev server resolves its
 * tugbank db from its OWN process environment (`TUG_INSTANCE_ID` /
 * `TUGBANK_PATH`, falling back to legacy `~/.tugbank.db`). The running
 * Tug.app variant writes its theme over HTTP to its own per-instance db —
 * a different file. So a `tugbank read` here returns whatever theme the
 * dev server's (often empty/legacy) db holds, not what the app is actually
 * showing. Re-reading it on each edit was the cause of the "edit a theme
 * css → snaps back to brio" bug: the read returned the base fallback and
 * we baked it over the live theme. The client is the source of truth, and
 * it tells us via `/__themes/activate`.
 */
let activeThemeName: string = BASE_THEME_NAME;

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

/**
 * Write `content` to `filePath` only if it differs from what's already there.
 * Returns true when a write happened. Skipping no-op writes keeps Vite's file
 * watcher quiet — the client's startup theme sync re-bakes the active theme on
 * every load, and without this guard each load would fire a spurious CSS HMR
 * even when the baked theme already matches.
 */
function writeIfChanged(filePath: string, content: string): boolean {
  try {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf-8") === content) {
      return false;
    }
  } catch {
    // Fall through to write — an unreadable target should be overwritten.
  }
  fs.writeFileSync(filePath, content, "utf-8");
  return true;
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
 *
 * Returns true when the active file actually changed on disk (so callers can
 * skip broadcasting a theme-changed HMR event for a no-op re-bake).
 */
function copyActiveThemeToFile(themeName: string, activeCssPath: string): boolean {
  if (!themeName || themeName === BASE_THEME_NAME) {
    const css = fs.readFileSync(BASE_THEME_CSS, "utf-8");
    return writeIfChanged(activeCssPath, css);
  }

  const sourceCssPath = findThemeCssPath(themeName, SHIPPED_THEMES_CSS_DIR);
  if (!sourceCssPath) {
    console.warn(`[themeLoaderPlugin] theme "${themeName}" not found, falling back to brio`);
    const css = fs.readFileSync(BASE_THEME_CSS, "utf-8");
    return writeIfChanged(activeCssPath, css);
  }

  try {
    const css = fs.readFileSync(sourceCssPath, "utf-8");
    return writeIfChanged(activeCssPath, css);
  } catch (err) {
    console.error(`[themeLoaderPlugin] failed to copy CSS for theme "${themeName}":`, err);
    const css = fs.readFileSync(BASE_THEME_CSS, "utf-8");
    return writeIfChanged(activeCssPath, css);
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
      // Best-effort boot seed. Correct when the dev server shares the
      // running app's tugbank instance; otherwise the client corrects it on
      // startup via `/__themes/activate` (see `syncDevActiveTheme`). Either
      // way, `activeThemeName` — not a fresh read — drives later re-bakes.
      activeThemeName = readActiveThemeFromTugbank();
      copyActiveThemeToFile(activeThemeName, THEME_ACTIVE_CSS);
    },
  };
}

/**
 * Vite plugin: when a theme source file changes, re-copy the active theme
 * into tug-active-theme.css so the app receives standard CSS HMR updates.
 *
 * Watches styles/themes/*.css (all themes including brio).
 *
 * Also broadcasts a `tug:theme-changed` custom HMR event to the client
 * so the `installHmrBridge` consumer can skip per-card state-preservation
 * flush on the incoming CSS-only update — see `hmr-bridge.ts` for the
 * skip protocol.
 */
function controlTokenHotReload(): VitePlugin {
  return {
    name: "control-token-hot-reload",
    handleHotUpdate({ file, server }) {
      if (file.startsWith(SHIPPED_THEMES_CSS_DIR) && file.endsWith(".css")) {
        // Only the active theme's own CSS feeds the live stylesheet.
        // Editing any other theme's file changes nothing on screen, so
        // leave the active file untouched and emit no update — re-baking
        // here is exactly what used to flip the live theme back to the
        // base. Re-bake from `activeThemeName` (the client's truth), never
        // a fresh `tugbank read` (wrong db — see `activeThemeName`).
        const editedTheme = path.basename(file, ".css");
        if (editedTheme !== activeThemeName) {
          return [];
        }
        const changed = copyActiveThemeToFile(activeThemeName, THEME_ACTIVE_CSS);
        if (changed) {
          // Fire BEFORE returning so the client receives the custom
          // event ahead of the HMR payload Vite emits for the
          // resulting tug-active-theme.css change. WebSocket messages
          // are TCP-ordered; chokidar detects the file change after
          // this send call, so the event lands first.
          server.ws.send({ type: "custom", event: "tug:theme-changed" });
        }
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
  /** True when the active CSS file actually changed on disk. */
  changed: boolean;
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
    const changed = writeIfChanged(activeCssPath, baseCss);
    return { theme: BASE_THEME_NAME, hostCanvasColor, changed };
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
  const changed = writeIfChanged(activeCssPath, css);
  return { theme: themeName, hostCanvasColor, changed };
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

// ---------------------------------------------------------------------------
// handleThemeEditApply — POST /__theme-editor/apply
//
// Re-hues a theme's Key/Accent axes from the clean baseline recipe and writes
// the theme CSS, then re-copies the active theme so HMR repaints. Drives the
// Theme Editor card's Apply button. Dev-only.
// ---------------------------------------------------------------------------

// Per-theme editor state — the living identity-space baseline, the seed last
// applied, and the editor's own last CSS output. Lets the next Apply diff-merge
// hand edits (made directly to the .css) apart from the editor's own writes.
// Dev-local cache (gitignored): rebuilt from the committed .css on first use.
interface ThemeEditorEntry {
  identityBaseline: Record<string, string>;
  appliedSeed: DuetSeed;
  lastGenCss: string;
}
type ThemeEditorState = Record<string, ThemeEditorEntry>;

function themeEditorStatePath(themesCssDir: string): string {
  return path.join(themesCssDir, "theme-editor-state.json");
}

function loadThemeEditorState(themesCssDir: string): ThemeEditorState {
  try {
    return JSON.parse(fs.readFileSync(themeEditorStatePath(themesCssDir), "utf-8")) as ThemeEditorState;
  } catch {
    return {};
  }
}

function saveThemeEditorState(themesCssDir: string, state: ThemeEditorState): void {
  fs.writeFileSync(themeEditorStatePath(themesCssDir), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

// First Apply for a theme with no cached state: adopt the committed .css as the
// identity origin (appliedSeed = identity, lastGenCss = current). Pre-existing
// hand edits are preserved verbatim because they ARE the baseline; the editor's
// scale/shift simply re-origin to the current file from here on.
function bootstrapThemeState(currentCss: string): ThemeEditorEntry {
  return {
    identityBaseline: extractBaseline(currentCss),
    appliedSeed: identitySeed(),
    lastGenCss: currentCss,
  };
}

export async function handleThemeEditApply(
  body: unknown,
  themesCssDir: string,
  activeCssPath: string,
): Promise<{ status: number; body: string }> {
  if (!body || typeof body !== "object") {
    return { status: 400, body: JSON.stringify({ error: "invalid request body" }) };
  }
  const b = body as Record<string, unknown>;
  const theme = typeof b.theme === "string" ? b.theme.trim() : "";
  const keyHue = typeof b.keyHue === "string" ? b.keyHue.trim() : "";
  const accentHue = typeof b.accentHue === "string" ? b.accentHue.trim() : "";
  // Additive intensity/tone/alpha deltas off each rung's base (tug-color units).
  const num = (v: unknown): number => (v === undefined ? 0 : Number(v));
  const parseAdjust = (v: unknown): { iDelta: number; tDelta: number; aDelta?: number } => {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    return { iDelta: num(o.iDelta), tDelta: num(o.tDelta), aDelta: num(o.aDelta) };
  };
  const key = parseAdjust(b.key);
  const accent = parseAdjust(b.accent);
  if (!theme || !isKnownHue(keyHue) || !isKnownHue(accentHue) ||
      !Number.isFinite(key.iDelta) || !Number.isFinite(key.tDelta) ||
      !Number.isFinite(accent.iDelta) || !Number.isFinite(accent.tDelta)) {
    return { status: 400, body: JSON.stringify({ error: "theme + valid keyHue/accentHue + numeric key/accent {iDelta,tDelta,aDelta} required" }) };
  }

  const parseTreatment = (v: unknown): { i: number; t: number; a?: number } | undefined => {
    if (!v || typeof v !== "object") return undefined;
    const o = v as Record<string, unknown>;
    const i = Number(o.i);
    const t = Number(o.t);
    if (!Number.isFinite(i) || !Number.isFinite(t)) return undefined;
    const a = o.a === undefined ? undefined : Number(o.a);
    return { i, t, a: a !== undefined && Number.isFinite(a) ? a : undefined };
  };
  const titlebar = parseTreatment(b.titlebar);
  const filled = parseTreatment(b.filled);
  const tinted = parseTreatment(b.tinted);
  const textsel = parseTreatment(b.textsel);

  const themeFile = findThemeCssPath(theme, themesCssDir);
  if (!themeFile) {
    return { status: 404, body: JSON.stringify({ error: `theme '${theme}' not found` }) };
  }

  return new Promise<{ status: number; body: string }>((resolve) => {
    withMutex(async () => {
      try {
        const newSeed: DuetSeed = {
          keyHue, key, accentHue, accent,
          titlebar, filled, tinted, textsel,
        };
        const current = fs.readFileSync(themeFile, "utf-8");

        // Recover the identity-space baseline by folding hand edits made directly
        // to the .css back in (diff-merge against the editor's own last output),
        // so hand tuning survives Apply and the .css stays the source of truth.
        const state = loadThemeEditorState(themesCssDir);
        const prior = state[theme] ?? bootstrapThemeState(current);
        const baseline = diffMergeBaseline(
          current, prior.lastGenCss, prior.identityBaseline, prior.appliedSeed,
        );

        const { css, keyCount, accentCount } = applyDuet(current, baseline, newSeed);
        fs.writeFileSync(themeFile, css, "utf-8");

        // Persist the merged baseline + this apply so the next diff-merge can tell
        // future hand edits apart from this output.
        state[theme] = { identityBaseline: baseline, appliedSeed: newSeed, lastGenCss: css };
        saveThemeEditorState(themesCssDir, state);

        // Push the change into the active-theme file so the running card repaints.
        const activeTheme = readActiveThemeFromTugbank();
        copyActiveThemeToFile(activeTheme, activeCssPath);
        resolve({ status: 200, body: JSON.stringify({ theme, keyHue, accentHue, keyCount, accentCount }) });
      } catch (err) {
        resolve({ status: 500, body: JSON.stringify({ error: String(err instanceof Error ? err.message : err) }) });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// handleThemeDerive — POST /__theme-editor/derive
//
// Generate a family-member theme from a canonical base (brio/harmony) by
// rotating its brand hues, holding perceived chroma + lightness. Writes the
// derived theme CSS. Drives the Theme Deriver card's Generate button. Dev-only.
// ---------------------------------------------------------------------------

export async function handleThemeDerive(
  body: unknown,
  themesCssDir: string,
  activeCssPath: string,
): Promise<{ status: number; body: string }> {
  if (!body || typeof body !== "object") {
    return { status: 400, body: JSON.stringify({ error: "invalid request body" }) };
  }
  const b = body as Record<string, unknown>;
  const base = typeof b.base === "string" ? b.base.trim() : "";
  const out = typeof b.out === "string" ? b.out.trim() : "";
  const keyHue = typeof b.keyHue === "string" ? b.keyHue.trim() : "";
  const accentHue = typeof b.accentHue === "string" ? b.accentHue.trim() : undefined;
  if (!base || !out || !isKnownHue(keyHue) || (accentHue && !isKnownHue(accentHue))) {
    return { status: 400, body: JSON.stringify({ error: "base + out + valid keyHue (+optional accentHue) required" }) };
  }

  const baseFile = findThemeCssPath(base, themesCssDir);
  const outFile = path.join(themesCssDir, `${out}.css`);
  if (!baseFile) {
    return { status: 404, body: JSON.stringify({ error: `base theme '${base}' not found` }) };
  }

  return new Promise<{ status: number; body: string }>((resolve) => {
    withMutex(async () => {
      try {
        const baseCss = fs.readFileSync(baseFile, "utf-8");
        const { css, count } = deriveTheme(baseCss, keyHue, accentHue);
        fs.writeFileSync(outFile, css, "utf-8");
        // If the derived theme is the active one, repaint the running app.
        const activeTheme = readActiveThemeFromTugbank();
        if (activeTheme === out) copyActiveThemeToFile(activeTheme, activeCssPath);
        resolve({ status: 200, body: JSON.stringify({ base, out, keyHue, accentHue, count }) });
      } catch (err) {
        resolve({ status: 500, body: JSON.stringify({ error: String(err instanceof Error ? err.message : err) }) });
      }
    });
  });
}

/**
 * Vite plugin: duet API endpoint for the dev server.
 * POST /__theme-editor/apply  — re-hue a theme's Key/Accent axes (legacy).
 * POST /__theme-editor/derive — generate a family member from a base theme.
 */
function themeEditApplyPlugin(): VitePlugin {
  return {
    name: "theme-editor-apply",
    configureServer(server) {
      server.middlewares.use(
        "/__theme-editor",
        (req: import("http").IncomingMessage, res: import("http").ServerResponse, next: () => void) => {
          const url = req.url ?? "/";
          if (req.method === "POST" && url === "/apply") {
            let raw = "";
            req.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
            req.on("end", () => {
              let parsed: unknown;
              try {
                parsed = JSON.parse(raw);
              } catch {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "invalid JSON body" }));
                return;
              }
              handleThemeEditApply(parsed, SHIPPED_THEMES_CSS_DIR, THEME_ACTIVE_CSS).then((result) => {
                if (result.status === 200) {
                  server.ws.send({ type: "custom", event: "tug:theme-changed" });
                }
                res.writeHead(result.status, { "Content-Type": "application/json" });
                res.end(result.body);
              }).catch((err) => {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: String(err) }));
              });
            });
            return;
          }
          if (req.method === "POST" && url === "/derive") {
            let raw = "";
            req.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
            req.on("end", () => {
              let parsed: unknown;
              try {
                parsed = JSON.parse(raw);
              } catch {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "invalid JSON body" }));
                return;
              }
              handleThemeDerive(parsed, SHIPPED_THEMES_CSS_DIR, THEME_ACTIVE_CSS).then((result) => {
                if (result.status === 200) {
                  server.ws.send({ type: "custom", event: "tug:theme-changed" });
                }
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
                if (result.status === 200) {
                  // The client is the source of truth for the active theme.
                  // Record what it just activated so later theme-css edits
                  // re-bake THIS theme (see `activeThemeName`) — including
                  // the startup sync, which corrects a stale boot seed.
                  let changed = true;
                  try {
                    const parsed = JSON.parse(result.body) as { theme?: string; changed?: boolean };
                    if (typeof parsed.theme === "string") activeThemeName = parsed.theme;
                    if (typeof parsed.changed === "boolean") changed = parsed.changed;
                  } catch {
                    // Keep the prior active theme; default to broadcasting.
                  }
                  // Tell the client a theme change is coming via the
                  // forthcoming `vite:beforeUpdate`. The `hmr-bridge`
                  // consumes this to skip the per-card state-preservation
                  // flush on the CSS-only update. WS messages are
                  // TCP-ordered; this send precedes Vite's automatic
                  // file-watcher-triggered HMR payload, so the client
                  // sees it first. Skip it when nothing changed on disk —
                  // a no-op re-bake (e.g. startup sync of an already-correct
                  // theme) emits no HMR, so there is no update to herald.
                  if (changed) {
                    server.ws.send({ type: "custom", event: "tug:theme-changed" });
                  }
                }
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
// Capabilities virtual module (D6.c).
//
// Resolves `import "virtual:capabilities/system-metadata"` to the raw JSONL
// contents of `<repo-root>/capabilities/<LATEST>/system-metadata.jsonl`. The
// artifact is produced by the tugcast capture binary (D6.a) and consumed by
// tugdeck's SessionMetadata fixture (D5) as the source of truth for slash
// commands / skills / agents available to the UI.
//
// HMR: watches the pointer + snapshot files so dev-server reloads pick up
// a new version bump without a manual restart.
// ---------------------------------------------------------------------------

export const CAPABILITIES_VIRTUAL_ID = "virtual:capabilities/system-metadata";
export const CAPABILITIES_RESOLVED_ID = "\0" + CAPABILITIES_VIRTUAL_ID;
const CAPABILITIES_ROOT = path.resolve(__dirname, "..", "capabilities");

export function loadCapabilitiesSnapshot(
  root: string = CAPABILITIES_ROOT,
): { content: string; snapshotPath: string; version: string } {
  const latestPath = path.join(root, "LATEST");
  if (!fs.existsSync(latestPath)) {
    throw new Error(
      `capabilities plugin: ${latestPath} not found — capabilities snapshot is missing`,
    );
  }
  const version = fs.readFileSync(latestPath, "utf-8").trim();
  if (!version) {
    throw new Error(`capabilities plugin: ${latestPath} is empty`);
  }
  const snapshotPath = path.join(root, version, "system-metadata.jsonl");
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(
      `capabilities plugin: ${snapshotPath} not found — LATEST points at missing version ${version}`,
    );
  }
  const content = fs.readFileSync(snapshotPath, "utf-8");
  return { content, snapshotPath, version };
}

function capabilitiesVirtualModulePlugin(): VitePlugin {
  let snapshotPath: string | null = null;
  return {
    name: "capabilities-virtual-module",
    resolveId(id) {
      if (id === CAPABILITIES_VIRTUAL_ID) return CAPABILITIES_RESOLVED_ID;
    },
    load(id) {
      if (id === CAPABILITIES_RESOLVED_ID) {
        const { content, snapshotPath: p } = loadCapabilitiesSnapshot();
        snapshotPath = p;
        return `export default ${JSON.stringify(content)};\n`;
      }
    },
    configureServer(server) {
      // The capabilities tree lives outside tugdeck's root, so Vite's watcher
      // doesn't include it by default — add it explicitly.
      const latestPath = path.join(CAPABILITIES_ROOT, "LATEST");
      server.watcher.add(latestPath);
      if (snapshotPath) server.watcher.add(snapshotPath);
    },
    handleHotUpdate({ file, server }) {
      const latestPath = path.join(CAPABILITIES_ROOT, "LATEST");
      if (file === latestPath || (snapshotPath && file === snapshotPath)) {
        const mod = server.moduleGraph.getModuleById(CAPABILITIES_RESOLVED_ID);
        if (mod) {
          server.moduleGraph.invalidateModule(mod);
          // Re-prime snapshotPath in case LATEST rolled to a different version.
          try {
            snapshotPath = loadCapabilitiesSnapshot().snapshotPath;
            server.watcher.add(snapshotPath);
          } catch {
            // Surface at next request via load() error; don't crash HMR.
          }
          return [mod];
        }
      }
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default (defineConfig as any)(() => {
  const tugcastPort = process.env.TUGCAST_PORT || "55255";
  const proxyConfig = {
    "/auth": { target: `http://localhost:${tugcastPort}` },
    "/ws": { target: `ws://localhost:${tugcastPort}`, ws: true },
    "/api": { target: `http://localhost:${tugcastPort}` },
  };

  const themeInputs = discoverThemeCssInputs();

  return {
    plugins: [
      react(),
      themeLoaderPlugin(),
      paletteHotReload(),
      controlTokenHotReload(),
      themeSaveLoadPlugin(),
      themeEditApplyPlugin(),
      capabilitiesVirtualModulePlugin(),
    ],
    css: {
      postcss: {
        plugins: [postcssTugColor()],
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        // Shared client→tugcode message contract ([#step-13c1]). Lives at the
        // repo root (sibling of tugdeck); Vite's default `server.fs.allow`
        // covers it via the `.git` workspace-root detection, so only the alias
        // is needed.
        "@tugproto": path.resolve(__dirname, "../tugproto/src"),
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
        // The crates/*/pkg glob auto-covers every WASM crate's built
        // artifacts; new crates need no edit here.
        ignored: ["**/palette-engine.ts", "**/tugdeck/crates/*/pkg/**"],
      },
      // Pin the HMR host/protocol explicitly. Vite would otherwise
      // infer them from the loaded page's URL — under WKWebView the
      // inference has historically been flaky enough to silently
      // break CSS hot updates without any visible error. `port` is
      // omitted on purpose: Vite mirrors it from the dev server's
      // own port, which is per-instance (derived from
      // TUG_INSTANCE_ID via tugcore::ports::vite_port_default) and
      // not known at config-load time.
      hmr: {
        host: "127.0.0.1",
        protocol: "ws",
        // Suppress Vite's built-in `vite-error-overlay`. Its shadow-DOM
        // window grows unbounded with the babel/rollup stack trace and
        // overflows the laptop viewport with no internal scroll, so the
        // message and code frame scroll off-screen. We render our own
        // viewport-fitting overlay from the same `vite:error` payload —
        // see `src/dev-error-overlay.ts`.
        overlay: false,
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          assetFileNames: (assetInfo: any) => {
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
