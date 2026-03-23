/**
 * Unit tests for handleThemesActivate and activateThemeOverride
 * from vite.config.ts.
 *
 * Tests use a mock FsWriteImpl that serves shipped theme JSON by path
 * and captures writeFileSync calls in an in-memory map, so the real
 * filesystem is never touched.
 *
 * The lazy require() calls inside activateThemeOverride load the real
 * theme-engine and theme-css-generator modules — only fs I/O is mocked.
 *
 * Note: setup-rtl MUST be the first import (required for DOM globals).
 */
import "./setup-rtl";

import { describe, it, expect, beforeEach } from "bun:test";
import path from "path";
import fs from "fs";

import {
  handleThemesActivate,
  activateThemeOverride,
  type FsWriteImpl,
  type ActivateResult,
} from "../../vite.config";

// ---------------------------------------------------------------------------
// Minimal valid ThemeRecipe used for legacy migration tests
// ---------------------------------------------------------------------------

const MINIMAL_RECIPE = {
  name: "my-cool-theme",
  recipe: "dark",
  surface: {
    canvas: { hue: "indigo-violet", tone: 5, intensity: 5 },
    grid: { hue: "indigo-violet", tone: 12, intensity: 4 },
    frame: { hue: "indigo-violet", tone: 16, intensity: 12 },
    card: { hue: "indigo-violet", tone: 12, intensity: 5 },
  },
  text: { hue: "cobalt", intensity: 3 },
  role: {
    tone: 50,
    intensity: 50,
    accent: "orange",
    action: "blue",
    agent: "violet",
    data: "teal",
    success: "green",
    caution: "yellow",
    danger: "red",
  },
} as const;

// ---------------------------------------------------------------------------
// Paths (same constants as vite.config.ts)
// ---------------------------------------------------------------------------

const TUGDECK_ROOT = path.resolve(__dirname, "../..");
const SHIPPED_THEMES_DIR = path.join(TUGDECK_ROOT, "themes");
// User dir doesn't exist in tests — mock fs returns empty for it.
const USER_THEMES_DIR = path.join(TUGDECK_ROOT, "test-user-themes-does-not-exist");

// Synthetic paths used to capture writes — never written to real disk.
const OVERRIDE_CSS_PATH = "/mock/tug-theme-override.css";
const ACTIVE_THEME_PATH = "/mock/.tugtool/active-theme";

// ---------------------------------------------------------------------------
// Mock FsWriteImpl factory
//
// - existsSync: returns true only for real shipped theme JSON files
//   and false for the user dir and any path under USER_THEMES_DIR.
// - readFileSync: serves real shipped theme JSON from disk for valid paths;
//   throws for unknown paths.
// - writeFileSync: captures calls in an in-memory map (no disk I/O).
// - readdirSync: returns [] (not needed for activate tests).
// - mkdirSync: no-op.
// ---------------------------------------------------------------------------

interface MockFs extends FsWriteImpl {
  written: Map<string, string>;
}

function makeMockFs(): MockFs {
  const written = new Map<string, string>();

  return {
    written,

    existsSync(p: string): boolean {
      // Only shipped JSON files exist; user dir and override files do not.
      if (p.startsWith(SHIPPED_THEMES_DIR) && p.endsWith(".json")) {
        return fs.existsSync(p);
      }
      return false;
    },

    readFileSync(p: string, _enc: "utf-8"): string {
      // Serve real shipped JSON from disk.
      if (p.startsWith(SHIPPED_THEMES_DIR) && p.endsWith(".json")) {
        return fs.readFileSync(p, "utf-8");
      }
      throw new Error(`readFileSync: unexpected path in mock: ${p}`);
    },

    writeFileSync(p: string, data: string, _enc: "utf-8"): void {
      written.set(p, data);
    },

    readdirSync(_p: string): string[] {
      return [];
    },

    mkdirSync(_p: string, _opts: { recursive: boolean }): void {
      // no-op
    },
  };
}

// ---------------------------------------------------------------------------
// Mock factory for user-authored legacy files
//
// Extends makeMockFs to serve a synthetic user-authored theme file from
// an in-memory map. The mock supports both legacy-format files (recipe is
// a stringified blob) and canonical-format files.
// ---------------------------------------------------------------------------

interface MockFsWithUserFiles extends MockFs {
  userFiles: Map<string, string>;
}

function makeMockFsWithUserFile(fileName: string, content: string): MockFsWithUserFiles {
  const base = makeMockFs();
  const userFiles = new Map<string, string>([[path.join(USER_THEMES_DIR, fileName), content]]);

  return {
    ...base,
    userFiles,

    existsSync(p: string): boolean {
      if (userFiles.has(p)) return true;
      return base.existsSync(p);
    },

    readFileSync(p: string, enc: "utf-8"): string {
      const userContent = userFiles.get(p);
      if (userContent !== undefined) return userContent;
      return base.readFileSync(p, enc);
    },

    readdirSync(p: string): string[] {
      if (p === USER_THEMES_DIR) {
        return Array.from(userFiles.keys()).map((fp) => path.basename(fp));
      }
      return base.readdirSync(p);
    },

    writeFileSync(p: string, data: string, enc: "utf-8"): void {
      // Capture rewrites of user files in the userFiles map too.
      if (userFiles.has(p)) {
        userFiles.set(p, data);
      }
      base.writeFileSync(p, data, enc);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("activateThemeOverride", () => {
  let mockFs: MockFs;

  beforeEach(() => {
    mockFs = makeMockFs();
  });

  it("TC1: Brio activation writes empty override", () => {
    const result: ActivateResult = activateThemeOverride(
      "brio",
      mockFs,
      SHIPPED_THEMES_DIR,
      USER_THEMES_DIR,
      OVERRIDE_CSS_PATH,
      ACTIVE_THEME_PATH,
    );

    expect(result.theme).toBe("brio");

    // Override file must be empty (comment-only).
    const overrideContents = mockFs.written.get(OVERRIDE_CSS_PATH);
    expect(overrideContents).toBeDefined();
    // Must not contain CSS token declarations.
    expect(overrideContents).not.toContain("--tug-");
    // Typical empty override is a comment.
    expect(overrideContents).toContain("/*");

    // active-theme file must be written.
    expect(mockFs.written.get(ACTIVE_THEME_PATH)).toBe("brio");

    // canvasParams must be a valid structure.
    expect(typeof result.canvasParams.hue).toBe("string");
    expect(result.canvasParams.hue.length).toBeGreaterThan(0);
    expect(typeof result.canvasParams.tone).toBe("number");
    expect(typeof result.canvasParams.intensity).toBe("number");
  });

  it("TC2: Harmony activation writes CSS content to override file", () => {
    const result: ActivateResult = activateThemeOverride(
      "harmony",
      mockFs,
      SHIPPED_THEMES_DIR,
      USER_THEMES_DIR,
      OVERRIDE_CSS_PATH,
      ACTIVE_THEME_PATH,
    );

    expect(result.theme).toBe("harmony");

    // Override file must contain CSS token declarations.
    const overrideContents = mockFs.written.get(OVERRIDE_CSS_PATH);
    expect(overrideContents).toBeDefined();
    expect(overrideContents).toContain("--tug-");
    expect(overrideContents).toContain("body {");

    // active-theme file must be written.
    expect(mockFs.written.get(ACTIVE_THEME_PATH)).toBe("harmony");

    // canvasParams must be a valid structure for a light theme.
    expect(result.canvasParams.hue).toBe("indigo-violet");
    expect(result.canvasParams.tone).toBe(95);
    expect(typeof result.canvasParams.intensity).toBe("number");
    expect(result.canvasParams.intensity).toBeGreaterThan(0);
  });

  it("TC3: Unknown theme throws with 'not found' message", () => {
    expect(() => {
      activateThemeOverride(
        "nonexistent-theme-xyz",
        mockFs,
        SHIPPED_THEMES_DIR,
        USER_THEMES_DIR,
        OVERRIDE_CSS_PATH,
        ACTIVE_THEME_PATH,
      );
    }).toThrow("not found");

    // No files should have been written.
    expect(mockFs.written.size).toBe(0);
  });
});

describe("activateThemeOverride — legacy migration", () => {
  it("TC-LM1: legacy file with stringified recipe is migrated and activates correctly", () => {
    // Build a legacy-format file: the old client wrote { name, recipe: JSON.stringify(fullRecipe) }.
    // The inner recipe blob is the full ThemeRecipe fields minus name (the old client used safeName).
    const innerRecipe = { ...MINIMAL_RECIPE };
    const legacyFile = JSON.stringify({
      name: "my-cool-theme",
      recipe: JSON.stringify(innerRecipe),
      // Old format had no surface/text/role at top level — they were inside the stringified blob.
    });

    const mockFsLegacy = makeMockFsWithUserFile("abcd1234.json", legacyFile);

    const result: ActivateResult = activateThemeOverride(
      "my-cool-theme",
      mockFsLegacy,
      SHIPPED_THEMES_DIR,
      USER_THEMES_DIR,
      OVERRIDE_CSS_PATH,
      ACTIVE_THEME_PATH,
    );

    // Activation must succeed and return correct canvasParams.
    expect(result.theme).toBe("my-cool-theme");
    expect(result.canvasParams.hue).toBe("indigo-violet");
    expect(typeof result.canvasParams.tone).toBe("number");
    expect(typeof result.canvasParams.intensity).toBe("number");

    // Override CSS must contain token declarations (non-Brio theme).
    const overrideContents = mockFsLegacy.written.get(OVERRIDE_CSS_PATH);
    expect(overrideContents).toBeDefined();
    expect(overrideContents).toContain("--tug-");
  });

  it("TC-LM2: legacy file is rewritten in canonical format after migration", () => {
    const innerRecipe = { ...MINIMAL_RECIPE };
    const legacyFile = JSON.stringify({
      name: "my-cool-theme",
      recipe: JSON.stringify(innerRecipe),
    });

    const userFilePath = path.join(USER_THEMES_DIR, "abcd1234.json");
    const mockFsLegacy = makeMockFsWithUserFile("abcd1234.json", legacyFile);

    activateThemeOverride(
      "my-cool-theme",
      mockFsLegacy,
      SHIPPED_THEMES_DIR,
      USER_THEMES_DIR,
      OVERRIDE_CSS_PATH,
      ACTIVE_THEME_PATH,
    );

    // The user file must have been rewritten.
    const rewrittenContent = mockFsLegacy.written.get(userFilePath);
    expect(rewrittenContent).toBeDefined();

    // The rewritten content must be valid JSON with recipe as a mode string (not a blob).
    const rewritten = JSON.parse(rewrittenContent!) as { recipe: string; surface?: object };
    expect(typeof rewritten.recipe).toBe("string");
    expect(rewritten.recipe).not.toContain("{");
    expect(rewritten.recipe).toBe("dark");

    // surface must be a top-level object in the rewritten file.
    expect(typeof rewritten.surface).toBe("object");
    expect(rewritten.surface).not.toBeNull();
  });

  it("TC-LM3: corrupt legacy file throws clear error message", () => {
    const corruptFile = JSON.stringify({
      name: "broken-theme",
      recipe: '{"this is not valid json because it is truncated...',
    });

    const mockFsCorrupt = makeMockFsWithUserFile("deadbeef.json", corruptFile);

    expect(() => {
      activateThemeOverride(
        "broken-theme",
        mockFsCorrupt,
        SHIPPED_THEMES_DIR,
        USER_THEMES_DIR,
        OVERRIDE_CSS_PATH,
        ACTIVE_THEME_PATH,
      );
    }).toThrow("corrupt recipe data");
  });
});

describe("handleThemesActivate", () => {
  let mockFs: MockFs;

  beforeEach(() => {
    mockFs = makeMockFs();
  });

  it("TC4: Brio activation returns 200 with theme and canvasParams, override is empty", async () => {
    const response = await handleThemesActivate(
      { theme: "brio" },
      mockFs,
      SHIPPED_THEMES_DIR,
      USER_THEMES_DIR,
      OVERRIDE_CSS_PATH,
      ACTIVE_THEME_PATH,
    );

    expect(response.status).toBe(200);
    const parsed = JSON.parse(response.body) as ActivateResult;
    expect(parsed.theme).toBe("brio");
    expect(typeof parsed.canvasParams).toBe("object");
    expect(typeof parsed.canvasParams.hue).toBe("string");
    expect(typeof parsed.canvasParams.tone).toBe("number");
    expect(typeof parsed.canvasParams.intensity).toBe("number");

    // Override file must be empty (comment-only, no --tug- tokens).
    const overrideContents = mockFs.written.get(OVERRIDE_CSS_PATH);
    expect(overrideContents).toBeDefined();
    expect(overrideContents).not.toContain("--tug-");
  });

  it("TC5: Non-Brio (harmony) activation returns 200 with CSS in override file", async () => {
    const response = await handleThemesActivate(
      { theme: "harmony" },
      mockFs,
      SHIPPED_THEMES_DIR,
      USER_THEMES_DIR,
      OVERRIDE_CSS_PATH,
      ACTIVE_THEME_PATH,
    );

    expect(response.status).toBe(200);
    const parsed = JSON.parse(response.body) as ActivateResult;
    expect(parsed.theme).toBe("harmony");
    expect(typeof parsed.canvasParams).toBe("object");
    expect(parsed.canvasParams.hue).toBe("indigo-violet");
    expect(parsed.canvasParams.tone).toBe(95);

    // Override file must contain token declarations.
    const overrideContents = mockFs.written.get(OVERRIDE_CSS_PATH);
    expect(overrideContents).toBeDefined();
    expect(overrideContents).toContain("--tug-");
  });

  it("TC6: Unknown theme returns 404", async () => {
    const response = await handleThemesActivate(
      { theme: "nonexistent-theme-xyz" },
      mockFs,
      SHIPPED_THEMES_DIR,
      USER_THEMES_DIR,
      OVERRIDE_CSS_PATH,
      ACTIVE_THEME_PATH,
    );

    expect(response.status).toBe(404);
    const parsed = JSON.parse(response.body) as { error: string };
    expect(parsed.error).toContain("not found");

    // No override file written on 404.
    expect(mockFs.written.get(OVERRIDE_CSS_PATH)).toBeUndefined();
  });

  it("TC7: Missing theme field returns 400", async () => {
    const response = await handleThemesActivate(
      { notTheme: "harmony" },
      mockFs,
      SHIPPED_THEMES_DIR,
      USER_THEMES_DIR,
      OVERRIDE_CSS_PATH,
      ACTIVE_THEME_PATH,
    );

    expect(response.status).toBe(400);
    const parsed = JSON.parse(response.body) as { error: string };
    expect(parsed.error).toContain("theme field is required");
  });

  it("TC8: Invalid body (non-object) returns 400", async () => {
    const response = await handleThemesActivate(
      "not-an-object",
      mockFs,
      SHIPPED_THEMES_DIR,
      USER_THEMES_DIR,
      OVERRIDE_CSS_PATH,
      ACTIVE_THEME_PATH,
    );

    expect(response.status).toBe(400);
    const parsed = JSON.parse(response.body) as { error: string };
    expect(parsed.error).toContain("invalid request body");
  });
});
