/**
 * theme-middleware tests — Step 4 (hash-based filenames, name-scan lookup).
 *
 * Unit tests for the Vite dev middleware handler functions.
 * Tests call handler functions directly with mocked fs implementations —
 * no running Vite server needed.
 *
 * Two-directory storage model:
 *   Shipped: tugdeck/themes/*.json  (read-only; names are blocked on save)
 *   Authored: ~/.tugtool/themes/    (read/write; auto-created on save; hash-named files)
 *
 * Tests cover:
 * - handleThemesList returns entries from both dirs with correct source fields
 * - handleThemesList sorts: base theme first, other shipped, then authored
 * - handleThemesList reads display name from JSON `name` field for authored themes
 * - handleThemesLoadJson checks shipped dir by direct filename; user dir by name-scan
 * - handleThemesLoadJson decodes URL-encoded theme names
 * - handleThemesSave rejects names that collide with shipped themes (400)
 * - handleThemesSave auto-creates the user themes directory
 * - handleThemesSave writes JSON only (no CSS file — activate handles override)
 * - handleThemesSave returns themeName on success
 * - handleThemesSave returns 400 when name is empty
 * - handleThemesSave writes hash-named file with display name in JSON
 * - handleThemesSave deletes existing file before writing new hash-named file
 * - findUserThemeByName returns correct path by scanning JSON name fields
 */
import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import path from "path";

import {
  handleThemesSave,
  handleThemesList,
  handleThemesLoadJson,
  findUserThemeByName,
  type ThemeSaveBody,
  type FsReadImpl,
  type FsWriteImpl,
} from "../../vite.config";
import { BASE_THEME_NAME } from "../theme-constants";

const FAKE_SHIPPED_DIR = "/fake/tugdeck/themes";
const FAKE_USER_DIR = "/fake/home/.tugtool/themes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SURFACE_GRID = { hue: "indigo-violet", tone: 8, intensity: 4 };
const SURFACE_FRAME = { hue: "indigo-violet", tone: 12, intensity: 4 };
const SURFACE_CARD = { hue: "indigo-violet", tone: 15, intensity: 3 };

function makeBrioJson(): string {
  return JSON.stringify({
    name: "brio",
    mode: "dark",
    surface: {
      canvas: { hue: "indigo-violet", tone: 5, intensity: 5 },
      grid: SURFACE_GRID,
      frame: SURFACE_FRAME,
      card: SURFACE_CARD,
    },
    text: { hue: "cobalt", intensity: 3 },
    role: { tone: 50, intensity: 50, accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
  });
}

function makeHarmonyJson(): string {
  return JSON.stringify({
    name: "harmony",
    mode: "light",
    surface: {
      canvas: { hue: "indigo-violet", tone: 95, intensity: 6 },
      grid: { hue: "indigo-violet", tone: 92, intensity: 4 },
      frame: { hue: "indigo-violet", tone: 88, intensity: 4 },
      card: { hue: "indigo-violet", tone: 85, intensity: 3 },
    },
    text: { hue: "cobalt", intensity: 4 },
    role: { tone: 55, intensity: 60, accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
  });
}

function makeAuthoredJson(name: string): string {
  return JSON.stringify({
    name,
    mode: "dark",
    surface: {
      canvas: { hue: "orange", tone: 10, intensity: 3 },
      grid: { hue: "orange", tone: 13, intensity: 3 },
      frame: { hue: "orange", tone: 17, intensity: 3 },
      card: { hue: "orange", tone: 20, intensity: 2 },
    },
    text: { hue: "orange", intensity: 2 },
    role: { tone: 50, intensity: 50, accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
  });
}

function makeMinimalSaveBody(name: string): ThemeSaveBody {
  return {
    name,
    mode: "dark",
    surface: {
      canvas: { hue: "orange", tone: 10, intensity: 3 },
      grid: { hue: "orange", tone: 13, intensity: 3 },
      frame: { hue: "orange", tone: 17, intensity: 3 },
      card: { hue: "orange", tone: 20, intensity: 2 },
    },
    text: { hue: "orange", intensity: 2 },
    role: { tone: 50, intensity: 50, accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
  };
}

/** Compute the 8-char SHA-256 hash used for theme filenames. */
function themeHash(name: string): string {
  return createHash("sha256").update(name).digest("hex").slice(0, 8);
}

// ---------------------------------------------------------------------------
// handleThemesList
// ---------------------------------------------------------------------------

describe("handleThemesList", () => {
  it("returns entries from both directories with correct source fields", () => {
    const myThemeHash = themeHash("my-theme");
    const files: Record<string, string[]> = {
      [FAKE_SHIPPED_DIR]: ["brio.json", "harmony.json"],
      [FAKE_USER_DIR]: [`${myThemeHash}.json`],
    };
    const fileContents: Record<string, string> = {
      [path.join(FAKE_SHIPPED_DIR, "brio.json")]: makeBrioJson(),
      [path.join(FAKE_SHIPPED_DIR, "harmony.json")]: makeHarmonyJson(),
      [path.join(FAKE_USER_DIR, `${myThemeHash}.json`)]: makeAuthoredJson("my-theme"),
    };
    const mockFs: FsReadImpl = {
      readdirSync: (p: string) => files[p] ?? [],
      readFileSync: (p: string) => fileContents[p] ?? "{}",
      existsSync: (p: string) => p in fileContents,
    };

    const result = handleThemesList(mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as { themes: Array<{ name: string; mode: string; source: string }> };
    const themes = body.themes;

    // brio and harmony are shipped
    const brio = themes.find((t) => t.name === "brio");
    const harmony = themes.find((t) => t.name === "harmony");
    const myTheme = themes.find((t) => t.name === "my-theme");

    expect(brio).toBeDefined();
    expect(brio?.source).toBe("shipped");
    expect(brio?.mode).toBe("dark");

    expect(harmony).toBeDefined();
    expect(harmony?.source).toBe("shipped");
    expect(harmony?.mode).toBe("light");

    expect(myTheme).toBeDefined();
    expect(myTheme?.source).toBe("authored");
    expect(myTheme?.mode).toBe("dark");
  });

  it("reads display name from JSON name field for authored themes", () => {
    const hash = themeHash("My Cool Theme");
    const files: Record<string, string[]> = {
      [FAKE_SHIPPED_DIR]: [],
      [FAKE_USER_DIR]: [`${hash}.json`],
    };
    const fileContents: Record<string, string> = {
      [path.join(FAKE_USER_DIR, `${hash}.json`)]: makeAuthoredJson("My Cool Theme"),
    };
    const mockFs: FsReadImpl = {
      readdirSync: (p: string) => files[p] ?? [],
      readFileSync: (p: string) => fileContents[p] ?? "{}",
      existsSync: (p: string) => p in fileContents,
    };

    const result = handleThemesList(mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    const body = JSON.parse(result.body) as { themes: Array<{ name: string; source: string }> };
    const entry = body.themes.find((t) => t.source === "authored");
    expect(entry).toBeDefined();
    // Display name must be the original mixed-case name from JSON, not the hash filename
    expect(entry?.name).toBe("My Cool Theme");
  });

  it("sorts base theme first, then other shipped, then authored", () => {
    const zebraHash = themeHash("zebra");
    const files: Record<string, string[]> = {
      [FAKE_SHIPPED_DIR]: ["harmony.json", "brio.json"],
      [FAKE_USER_DIR]: [`${zebraHash}.json`],
    };
    const fileContents: Record<string, string> = {
      [path.join(FAKE_SHIPPED_DIR, "harmony.json")]: makeHarmonyJson(),
      [path.join(FAKE_SHIPPED_DIR, "brio.json")]: makeBrioJson(),
      [path.join(FAKE_USER_DIR, `${zebraHash}.json`)]: makeAuthoredJson("zebra"),
    };
    const mockFs: FsReadImpl = {
      readdirSync: (p: string) => files[p] ?? [],
      readFileSync: (p: string) => fileContents[p] ?? "{}",
      existsSync: (p: string) => p in fileContents,
    };

    const result = handleThemesList(mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    const body = JSON.parse(result.body) as { themes: Array<{ name: string }> };
    const names = body.themes.map((t) => t.name);
    expect(names[0]).toBe(BASE_THEME_NAME);
    expect(names[1]).toBe("harmony");
    expect(names[2]).toBe("zebra");
  });

  it("returns empty array when both directories are empty", () => {
    const mockFs: FsReadImpl = {
      readdirSync: (_p: string) => [],
      readFileSync: (_p: string) => "{}",
      existsSync: (_p: string) => false,
    };
    const result = handleThemesList(mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as { themes: unknown[] };
    expect(body.themes).toEqual([]);
  });

  it("returns empty array when user directory does not exist", () => {
    const mockFs: FsReadImpl = {
      readdirSync: (p: string) => {
        if (p === FAKE_USER_DIR) throw new Error("ENOENT");
        return ["brio.json"];
      },
      readFileSync: (_p: string) => makeBrioJson(),
      existsSync: (_p: string) => true,
    };
    const result = handleThemesList(mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    const body = JSON.parse(result.body) as { themes: Array<{ name: string }> };
    expect(body.themes.length).toBe(1);
    expect(body.themes[0].name).toBe("brio");
  });
});

// ---------------------------------------------------------------------------
// findUserThemeByName
// ---------------------------------------------------------------------------

describe("findUserThemeByName", () => {
  it("returns path when a user theme with matching name is found", () => {
    const hash = themeHash("My Cool Theme");
    const hashFile = `${hash}.json`;
    const files: Record<string, string[]> = {
      [FAKE_USER_DIR]: [hashFile],
    };
    const fileContents: Record<string, string> = {
      [path.join(FAKE_USER_DIR, hashFile)]: makeAuthoredJson("My Cool Theme"),
    };
    const mockFs: FsReadImpl = {
      readdirSync: (p: string) => files[p] ?? [],
      readFileSync: (p: string) => fileContents[p] ?? "{}",
      existsSync: (p: string) => p in fileContents,
    };

    const result = findUserThemeByName("My Cool Theme", mockFs, FAKE_USER_DIR);
    expect(result).toBe(path.join(FAKE_USER_DIR, hashFile));
  });

  it("returns null when no theme with matching name exists", () => {
    const mockFs: FsReadImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "{}",
      existsSync: (_p: string) => false,
    };

    const result = findUserThemeByName("Nonexistent Theme", mockFs, FAKE_USER_DIR);
    expect(result).toBeNull();
  });

  it("returns null when user directory does not exist", () => {
    const mockFs: FsReadImpl = {
      readdirSync: (_p: string) => { throw new Error("ENOENT"); },
      readFileSync: (_p: string) => "{}",
      existsSync: (_p: string) => false,
    };

    const result = findUserThemeByName("My Theme", mockFs, FAKE_USER_DIR);
    expect(result).toBeNull();
  });

  it("skips files with different name field", () => {
    const hash1 = themeHash("Theme One");
    const hash2 = themeHash("Theme Two");
    const files: Record<string, string[]> = {
      [FAKE_USER_DIR]: [`${hash1}.json`, `${hash2}.json`],
    };
    const fileContents: Record<string, string> = {
      [path.join(FAKE_USER_DIR, `${hash1}.json`)]: makeAuthoredJson("Theme One"),
      [path.join(FAKE_USER_DIR, `${hash2}.json`)]: makeAuthoredJson("Theme Two"),
    };
    const mockFs: FsReadImpl = {
      readdirSync: (p: string) => files[p] ?? [],
      readFileSync: (p: string) => fileContents[p] ?? "{}",
      existsSync: (p: string) => p in fileContents,
    };

    const result = findUserThemeByName("Theme Two", mockFs, FAKE_USER_DIR);
    expect(result).toBe(path.join(FAKE_USER_DIR, `${hash2}.json`));
  });
});

// ---------------------------------------------------------------------------
// handleThemesLoadJson
// ---------------------------------------------------------------------------

describe("handleThemesLoadJson", () => {
  it("returns authored theme JSON when present in user dir (name-scan lookup)", () => {
    const hash = themeHash("my-theme");
    const hashFile = `${hash}.json`;
    const content = makeAuthoredJson("my-theme");
    const mockFs: FsReadImpl = {
      readdirSync: (p: string) => p === FAKE_USER_DIR ? [hashFile] : [],
      readFileSync: (_p: string) => content,
      existsSync: (p: string) => p === path.join(FAKE_SHIPPED_DIR, "my-theme.json") ? false : true,
    };
    const result = handleThemesLoadJson("my-theme", mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("application/json");
    expect(result.body).toBe(content);
  });

  it("falls back to shipped theme JSON when not in user dir", () => {
    const content = makeBrioJson();
    const mockFs: FsReadImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => content,
      existsSync: (p: string) => p === path.join(FAKE_SHIPPED_DIR, "brio.json"),
    };
    const result = handleThemesLoadJson("brio", mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(200);
    expect(result.body).toBe(content);
  });

  it("returns 404 when theme is not found in either directory", () => {
    const mockFs: FsReadImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (_p: string) => false,
    };
    const result = handleThemesLoadJson("nonexistent", mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(404);
  });

  it("decodes URL-encoded theme name for name-scan lookup", () => {
    // Theme named "My Cool Theme" — client sends "My%20Cool%20Theme" in the URL
    const decodedName = "My Cool Theme";
    const hash = themeHash(decodedName);
    const hashFile = `${hash}.json`;
    const content = makeAuthoredJson(decodedName);
    const mockFs: FsReadImpl = {
      readdirSync: (p: string) => p === FAKE_USER_DIR ? [hashFile] : [],
      readFileSync: (p: string) => {
        if (p === path.join(FAKE_USER_DIR, hashFile)) return content;
        return "{}";
      },
      existsSync: (p: string) => p === path.join(FAKE_SHIPPED_DIR, "My Cool Theme.json") ? false : false,
    };
    // The middleware decodes "My%20Cool%20Theme" to "My Cool Theme" before calling this function
    const result = handleThemesLoadJson(decodedName, mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(200);
    expect(result.body).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// handleThemesSave
// ---------------------------------------------------------------------------

describe("handleThemesSave", () => {
  it("writes hash-named JSON for a valid authored theme with display name in JSON", () => {
    const written: Record<string, string> = {};
    const created: string[] = [];
    const mockFs: FsWriteImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (_p: string) => false,
      writeFileSync: (p: string, data: string) => { written[p] = data; },
      mkdirSync: (p: string) => { created.push(p); },
    };
    const body = makeMinimalSaveBody("My Theme");
    const result = handleThemesSave(body, mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);

    expect(result.status).toBe(200);
    const parsed = JSON.parse(result.body) as { ok: boolean; name: string };
    expect(parsed.ok).toBe(true);
    // Response `name` is the display name (not a hash)
    expect(parsed.name).toBe("My Theme");

    // JSON was written with hash-based filename
    const expectedHash = themeHash("My Theme");
    const jsonPath = path.join(FAKE_USER_DIR, `${expectedHash}.json`);
    expect(jsonPath in written).toBe(true);

    // JSON content has the original display name, not the hash
    const storedJson = JSON.parse(written[jsonPath]) as { name: string };
    expect(storedJson.name).toBe("My Theme");

    // CSS file was NOT written — activate handles the override
    const cssPath = path.join(FAKE_USER_DIR, "my-theme.css");
    expect(cssPath in written).toBe(false);
  });

  it("returns themeName on success", () => {
    const mockFs: FsWriteImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (_p: string) => false,
      writeFileSync: () => {},
      mkdirSync: () => {},
    };
    const result = handleThemesSave(makeMinimalSaveBody("My Theme"), mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(200);
    expect(result.themeName).toBe("My Theme");
  });

  it("returns themeName null on validation failure", () => {
    const mockFs: FsWriteImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (_p: string) => false,
      writeFileSync: () => {},
      mkdirSync: () => {},
    };
    const result = handleThemesSave(makeMinimalSaveBody(""), mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(400);
    expect(result.themeName).toBeNull();
  });

  it("rejects names that collide with shipped themes (400)", () => {
    const mockFs: FsWriteImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (p: string) => p === path.join(FAKE_SHIPPED_DIR, "brio.json"),
      writeFileSync: () => {},
      mkdirSync: () => {},
    };
    const body = makeMinimalSaveBody("brio");
    const result = handleThemesSave(body, mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(400);
    const parsed = JSON.parse(result.body) as { error: string };
    expect(parsed.error).toContain("shipped");
  });

  it("auto-creates the user themes directory", () => {
    const created: string[] = [];
    const mockFs: FsWriteImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (_p: string) => false,
      writeFileSync: () => {},
      mkdirSync: (p: string) => { created.push(p); },
    };
    handleThemesSave(makeMinimalSaveBody("new-theme"), mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(created).toContain(FAKE_USER_DIR);
  });

  it("returns 400 when name is empty string", () => {
    const mockFs: FsWriteImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (_p: string) => false,
      writeFileSync: () => {},
      mkdirSync: () => {},
    };
    const body = makeMinimalSaveBody("");
    const result = handleThemesSave(body, mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(400);
    const parsed = JSON.parse(result.body) as { error: string };
    expect(typeof parsed.error).toBe("string");
  });

  it("returns 400 when name is whitespace only", () => {
    const mockFs: FsWriteImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (_p: string) => false,
      writeFileSync: () => {},
      mkdirSync: () => {},
    };
    const body = makeMinimalSaveBody("   ");
    const result = handleThemesSave(body, mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(400);
  });

  it("writes hash-named file for theme with display name 'My Cool Theme'", () => {
    const written: Record<string, string> = {};
    const mockFs: FsWriteImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (_p: string) => false,
      writeFileSync: (p: string, data: string) => { written[path.basename(p)] = data; },
      mkdirSync: () => {},
    };
    handleThemesSave(makeMinimalSaveBody("My Cool Theme"), mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    const keys = Object.keys(written);
    // Filename is the 8-char hash, not kebab-case
    const expectedHash = themeHash("My Cool Theme");
    expect(keys).toContain(`${expectedHash}.json`);
    // Only JSON file written, no CSS
    expect(keys.every((k) => k.endsWith(".json"))).toBe(true);
    // JSON content preserves the original display name
    const storedJson = JSON.parse(written[`${expectedHash}.json`]) as { name: string };
    expect(storedJson.name).toBe("My Cool Theme");
  });

  it("deletes existing theme file before writing new hash-named file (no duplicate entries)", () => {
    const legacyName = "my-cool-theme";
    const legacyFile = `${legacyName}.json`;
    const legacyContent = makeAuthoredJson("My Cool Theme");
    const deleted: string[] = [];
    const written: Record<string, string> = {};

    const mockFs: FsWriteImpl = {
      readdirSync: (p: string) => p === FAKE_USER_DIR ? [legacyFile] : [],
      readFileSync: (p: string) => {
        if (p === path.join(FAKE_USER_DIR, legacyFile)) return legacyContent;
        return "";
      },
      existsSync: (_p: string) => false,
      writeFileSync: (p: string, data: string) => { written[p] = data; },
      mkdirSync: () => {},
      unlinkSync: (p: string) => { deleted.push(p); },
    };

    handleThemesSave(makeMinimalSaveBody("My Cool Theme"), mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);

    // The legacy slug-named file was deleted
    expect(deleted).toContain(path.join(FAKE_USER_DIR, legacyFile));

    // The new hash-named file was written
    const expectedHash = themeHash("My Cool Theme");
    const newPath = path.join(FAKE_USER_DIR, `${expectedHash}.json`);
    expect(newPath in written).toBe(true);
  });

  it("returns 500 when fs.writeFileSync throws", () => {
    const mockFs: FsWriteImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (_p: string) => false,
      writeFileSync: () => { throw new Error("disk full"); },
      mkdirSync: () => {},
    };
    const result = handleThemesSave(makeMinimalSaveBody("test"), mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(500);
  });

  it("returns 400 when body is null", () => {
    const mockFs: FsWriteImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (_p: string) => false,
      writeFileSync: () => {},
      mkdirSync: () => {},
    };
    const result = handleThemesSave(null, mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(400);
  });

  it("returns 400 when mode is a JSON blob (old broken format)", () => {
    const mockFs: FsWriteImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (_p: string) => false,
      writeFileSync: () => {},
      mkdirSync: () => {},
    };
    const fullRecipe = makeMinimalSaveBody("My Theme");
    const brokenBody = { ...fullRecipe, mode: JSON.stringify(fullRecipe) };
    const result = handleThemesSave(brokenBody, mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(400);
    const parsed = JSON.parse(result.body) as { error: string };
    expect(parsed.error).toContain("mode string");
  });

  it("returns 400 when surface field is missing", () => {
    const mockFs: FsWriteImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (_p: string) => false,
      writeFileSync: () => {},
      mkdirSync: () => {},
    };
    const body = makeMinimalSaveBody("My Theme");
    const { surface: _surface, ...bodyWithoutSurface } = body;
    const result = handleThemesSave(bodyWithoutSurface, mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(400);
    const parsed = JSON.parse(result.body) as { error: string };
    expect(parsed.error).toContain("surface");
  });
});
