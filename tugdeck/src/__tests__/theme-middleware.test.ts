/**
 * theme-middleware tests — Step 6.
 *
 * Unit tests for the Vite dev middleware handler functions.
 * Tests call handleThemesSave() and handleThemesList() directly
 * with mocked fs implementations — no running Vite server needed.
 *
 * Tests cover:
 * - POST /__themes/save with valid body writes .css and -recipe.json files
 * - POST /__themes/save with empty name returns 400
 * - GET /__themes/list reads directory and returns theme name array
 */
import { describe, it, expect } from "bun:test";
import path from "path";

// Import handler functions directly from vite.config.ts for unit testing.
// These are pure functions that accept a fs implementation, enabling mocking.
import { handleThemesSave, handleThemesList } from "../../vite.config";

const FAKE_THEMES_DIR = "/fake/styles/themes";

// ---------------------------------------------------------------------------
// POST /__themes/save
// ---------------------------------------------------------------------------

describe("handleThemesSave", () => {
  it("writes .css and -recipe.json files for a valid request", () => {
    const written: Record<string, string> = {};
    const mockFs = {
      writeFileSync(p: string, data: string, _enc: "utf-8") {
        written[path.basename(p)] = data;
      },
    };

    const result = handleThemesSave(
      { name: "My Theme", css: "body { --tug-bg: oklch(0.2 0 0); }", recipe: '{"name":"My Theme"}' },
      mockFs,
      FAKE_THEMES_DIR,
    );

    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as { ok: boolean; name: string };
    expect(body.ok).toBe(true);
    // Name is sanitized to kebab-case
    expect(body.name).toBe("my-theme");
    // Both files were written
    expect(written["my-theme.css"]).toBe("body { --tug-bg: oklch(0.2 0 0); }");
    expect(written["my-theme-recipe.json"]).toBe('{"name":"My Theme"}');
  });

  it("returns 400 when name is empty string", () => {
    const mockFs = {
      writeFileSync(_p: string, _data: string, _enc: "utf-8") {},
    };
    const result = handleThemesSave(
      { name: "", css: "body {}", recipe: "{}" },
      mockFs,
      FAKE_THEMES_DIR,
    );
    expect(result.status).toBe(400);
    const body = JSON.parse(result.body) as { error: string };
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 when name is whitespace only", () => {
    const mockFs = {
      writeFileSync(_p: string, _data: string, _enc: "utf-8") {},
    };
    const result = handleThemesSave(
      { name: "   ", css: "body {}", recipe: "{}" },
      mockFs,
      FAKE_THEMES_DIR,
    );
    expect(result.status).toBe(400);
  });

  it("sanitizes name to safe kebab-case filename", () => {
    const written: Record<string, string> = {};
    const mockFs = {
      writeFileSync(p: string, data: string, _enc: "utf-8") {
        written[path.basename(p)] = data;
      },
    };
    handleThemesSave(
      { name: "My Cool Theme!", css: "body {}", recipe: "{}" },
      mockFs,
      FAKE_THEMES_DIR,
    );
    expect("my-cool-theme-.css" in written || "my-cool-theme.css" in written).toBe(true);
  });

  it("returns 500 when fs.writeFileSync throws", () => {
    const mockFs = {
      writeFileSync(_p: string, _data: string, _enc: "utf-8"): void {
        throw new Error("disk full");
      },
    };
    const result = handleThemesSave(
      { name: "test", css: "body {}", recipe: "{}" },
      mockFs,
      FAKE_THEMES_DIR,
    );
    expect(result.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /__themes/list
// ---------------------------------------------------------------------------

describe("handleThemesList", () => {
  it("returns theme names derived from .css files in the directory", () => {
    const mockFs = {
      readdirSync(_p: string): string[] {
        return ["brio.css", "brio-recipe.json", "my-theme.css", "my-theme-recipe.json", "other.txt"];
      },
    };
    const result = handleThemesList(mockFs, FAKE_THEMES_DIR);
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as { themes: string[] };
    expect(body.themes).toContain("brio");
    expect(body.themes).toContain("my-theme");
    // Non-.css files are excluded
    expect(body.themes).not.toContain("brio-recipe");
    expect(body.themes).not.toContain("other");
  });

  it("returns empty array when directory does not exist", () => {
    const mockFs = {
      readdirSync(_p: string): string[] {
        throw new Error("ENOENT: no such file or directory");
      },
    };
    const result = handleThemesList(mockFs, FAKE_THEMES_DIR);
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as { themes: string[] };
    expect(body.themes).toEqual([]);
  });

  it("returns empty array when directory is empty", () => {
    const mockFs = {
      readdirSync(_p: string): string[] {
        return [];
      },
    };
    const result = handleThemesList(mockFs, FAKE_THEMES_DIR);
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as { themes: string[] };
    expect(body.themes).toEqual([]);
  });
});
