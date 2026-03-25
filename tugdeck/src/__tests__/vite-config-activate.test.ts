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
// Paths (same constants as vite.config.ts)
// ---------------------------------------------------------------------------

const TUGDECK_ROOT = path.resolve(__dirname, "../..");
const SHIPPED_THEMES_DIR = path.join(TUGDECK_ROOT, "themes");

// Synthetic path used to capture writes — never written to real disk.
const OVERRIDE_CSS_PATH = "/mock/tug-theme-override.css";

// ---------------------------------------------------------------------------
// Mock FsWriteImpl factory
//
// - existsSync: returns true only for real shipped theme JSON files.
// - readFileSync: serves real shipped theme JSON from disk for valid paths;
//   throws for unknown paths.
// - writeFileSync: captures calls in an in-memory map (no disk I/O).
// - readdirSync: returns [].
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
      // Only shipped JSON files exist.
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
      OVERRIDE_CSS_PATH,
    );

    expect(result.theme).toBe("brio");

    // Override file must be empty (comment-only).
    const overrideContents = mockFs.written.get(OVERRIDE_CSS_PATH);
    expect(overrideContents).toBeDefined();
    // Must not contain CSS token declarations.
    expect(overrideContents).not.toContain("--tug-");
    // Typical empty override is a comment.
    expect(overrideContents).toContain("/*");

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
      OVERRIDE_CSS_PATH,
    );

    expect(result.theme).toBe("harmony");

    // Override file must contain CSS token declarations.
    const overrideContents = mockFs.written.get(OVERRIDE_CSS_PATH);
    expect(overrideContents).toBeDefined();
    expect(overrideContents).toContain("--tug-");
    expect(overrideContents).toContain("body {");

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
        OVERRIDE_CSS_PATH,
      );
    }).toThrow("not found");

    // No files should have been written.
    expect(mockFs.written.size).toBe(0);
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
      OVERRIDE_CSS_PATH,
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
      OVERRIDE_CSS_PATH,
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
      OVERRIDE_CSS_PATH,
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
      OVERRIDE_CSS_PATH,
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
      OVERRIDE_CSS_PATH,
    );

    expect(response.status).toBe(400);
    const parsed = JSON.parse(response.body) as { error: string };
    expect(parsed.error).toContain("invalid request body");
  });
});
