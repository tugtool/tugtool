/**
 * theme-middleware tests — Step 7.
 *
 * Unit tests for the Vite dev middleware handler functions.
 * Tests call handler functions directly with mocked fs implementations —
 * no running Vite server needed.
 *
 * Two-directory storage model:
 *   Shipped: tugdeck/themes/*.json  (read-only; names are blocked on save)
 *   Authored: ~/.tugtool/themes/    (read/write; auto-created on save)
 *
 * Tests cover:
 * - handleThemesList returns entries from both dirs with correct source fields
 * - handleThemesList sorts: brio first, other shipped, then authored
 * - handleThemesLoadJson checks authored dir first, then shipped; returns 404 if neither
 * - handleThemesSave rejects names that collide with shipped themes (400)
 * - handleThemesSave auto-creates the user themes directory
 * - handleThemesSave writes JSON only (no CSS file — activate handles override)
 * - handleThemesSave returns safeName on success
 * - handleThemesSave returns 400 when name is empty
 */
import { describe, it, expect } from "bun:test";
import path from "path";

import {
  handleThemesSave,
  handleThemesList,
  handleThemesLoadJson,
  type ThemeSaveBody,
  type FsReadImpl,
  type FsWriteImpl,
} from "../../vite.config";

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
    recipe: "dark",
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
    recipe: "light",
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
    recipe: "dark",
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
    recipe: "dark",
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

// ---------------------------------------------------------------------------
// handleThemesList
// ---------------------------------------------------------------------------

describe("handleThemesList", () => {
  it("returns entries from both directories with correct source fields", () => {
    const files: Record<string, string[]> = {
      [FAKE_SHIPPED_DIR]: ["brio.json", "harmony.json"],
      [FAKE_USER_DIR]: ["my-theme.json"],
    };
    const fileContents: Record<string, string> = {
      [path.join(FAKE_SHIPPED_DIR, "brio.json")]: makeBrioJson(),
      [path.join(FAKE_SHIPPED_DIR, "harmony.json")]: makeHarmonyJson(),
      [path.join(FAKE_USER_DIR, "my-theme.json")]: makeAuthoredJson("my-theme"),
    };
    const mockFs: FsReadImpl = {
      readdirSync: (p: string) => files[p] ?? [],
      readFileSync: (p: string) => fileContents[p] ?? "{}",
      existsSync: (p: string) => p in fileContents,
    };

    const result = handleThemesList(mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as { themes: Array<{ name: string; recipe: string; source: string }> };
    const themes = body.themes;

    // brio and harmony are shipped
    const brio = themes.find((t) => t.name === "brio");
    const harmony = themes.find((t) => t.name === "harmony");
    const myTheme = themes.find((t) => t.name === "my-theme");

    expect(brio).toBeDefined();
    expect(brio?.source).toBe("shipped");
    expect(brio?.recipe).toBe("dark");

    expect(harmony).toBeDefined();
    expect(harmony?.source).toBe("shipped");
    expect(harmony?.recipe).toBe("light");

    expect(myTheme).toBeDefined();
    expect(myTheme?.source).toBe("authored");
    expect(myTheme?.recipe).toBe("dark");
  });

  it("sorts brio first, then other shipped, then authored", () => {
    const files: Record<string, string[]> = {
      [FAKE_SHIPPED_DIR]: ["harmony.json", "brio.json"],
      [FAKE_USER_DIR]: ["zebra.json"],
    };
    const fileContents: Record<string, string> = {
      [path.join(FAKE_SHIPPED_DIR, "harmony.json")]: makeHarmonyJson(),
      [path.join(FAKE_SHIPPED_DIR, "brio.json")]: makeBrioJson(),
      [path.join(FAKE_USER_DIR, "zebra.json")]: makeAuthoredJson("zebra"),
    };
    const mockFs: FsReadImpl = {
      readdirSync: (p: string) => files[p] ?? [],
      readFileSync: (p: string) => fileContents[p] ?? "{}",
      existsSync: (p: string) => p in fileContents,
    };

    const result = handleThemesList(mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    const body = JSON.parse(result.body) as { themes: Array<{ name: string }> };
    const names = body.themes.map((t) => t.name);
    expect(names[0]).toBe("brio");
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
// handleThemesLoadJson
// ---------------------------------------------------------------------------

describe("handleThemesLoadJson", () => {
  it("returns authored theme JSON when present in user dir", () => {
    const content = makeAuthoredJson("my-theme");
    const mockFs: FsReadImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => content,
      existsSync: (p: string) => p === path.join(FAKE_USER_DIR, "my-theme.json"),
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
});

// ---------------------------------------------------------------------------
// handleThemesSave
// ---------------------------------------------------------------------------

describe("handleThemesSave", () => {
  it("writes JSON only (no CSS) for a valid authored theme", () => {
    const written: Record<string, string> = {};
    const created: string[] = [];
    const mockFs: FsWriteImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (p: string) => !p.includes(FAKE_SHIPPED_DIR),
      writeFileSync: (p: string, data: string) => { written[p] = data; },
      mkdirSync: (p: string) => { created.push(p); },
    };
    const body = makeMinimalSaveBody("My Theme");
    const result = handleThemesSave(body, mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);

    expect(result.status).toBe(200);
    const parsed = JSON.parse(result.body) as { ok: boolean; name: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.name).toBe("my-theme");

    // JSON was written
    const jsonPath = path.join(FAKE_USER_DIR, "my-theme.json");
    expect(jsonPath in written).toBe(true);

    // CSS file was NOT written — activate handles the override
    const cssPath = path.join(FAKE_USER_DIR, "my-theme.css");
    expect(cssPath in written).toBe(false);
  });

  it("returns safeName on success", () => {
    const mockFs: FsWriteImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (_p: string) => false,
      writeFileSync: () => {},
      mkdirSync: () => {},
    };
    const result = handleThemesSave(makeMinimalSaveBody("My Theme"), mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(200);
    expect(result.safeName).toBe("my-theme");
  });

  it("returns safeName null on validation failure", () => {
    const mockFs: FsWriteImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (_p: string) => false,
      writeFileSync: () => {},
      mkdirSync: () => {},
    };
    const result = handleThemesSave(makeMinimalSaveBody(""), mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    expect(result.status).toBe(400);
    expect(result.safeName).toBeNull();
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

  it("sanitizes name to safe kebab-case filename", () => {
    const written: Record<string, string> = {};
    const mockFs: FsWriteImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (_p: string) => false,
      writeFileSync: (p: string, data: string) => { written[path.basename(p)] = data; },
      mkdirSync: () => {},
    };
    handleThemesSave(makeMinimalSaveBody("My Cool Theme!"), mockFs, FAKE_SHIPPED_DIR, FAKE_USER_DIR);
    const keys = Object.keys(written);
    expect(keys.some((k) => k.startsWith("my-cool-theme"))).toBe(true);
    // Only JSON file written, no CSS
    expect(keys.every((k) => k.endsWith(".json"))).toBe(true);
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

  it("returns 400 when recipe is a JSON blob (old broken format)", () => {
    const mockFs: FsWriteImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (_p: string) => false,
      writeFileSync: () => {},
      mkdirSync: () => {},
    };
    const fullRecipe = makeMinimalSaveBody("My Theme");
    const brokenBody = { ...fullRecipe, recipe: JSON.stringify(fullRecipe) };
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
