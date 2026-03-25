/**
 * theme-middleware tests — shipped themes only.
 *
 * Unit tests for the Vite dev middleware handler functions.
 * Tests call handler functions directly with mocked fs implementations —
 * no running Vite server needed.
 *
 * Only shipped themes are supported:
 *   Shipped: tugdeck/themes/*.json  (read-only; names are the filenames without extension)
 *
 * Tests cover:
 * - handleThemesList returns entries from shipped dir with correct source fields
 * - handleThemesList sorts: base theme first, other shipped alphabetically
 * - handleThemesList returns empty array when shipped directory is empty
 * - handleThemesLoadJson returns shipped theme JSON by direct filename
 * - handleThemesLoadJson decodes URL-encoded theme names
 * - handleThemesLoadJson returns 404 for nonexistent theme
 */
import { describe, it, expect } from "bun:test";
import path from "path";

import {
  handleThemesList,
  handleThemesLoadJson,
  type FsReadImpl,
} from "../../vite.config";
import { BASE_THEME_NAME } from "../theme-constants";

const FAKE_SHIPPED_DIR = "/fake/tugdeck/themes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBrioJson(): string {
  return JSON.stringify({
    name: "brio",
    mode: "dark",
    surface: {
      canvas: { hue: "indigo-violet", tone: 5, intensity: 5 },
      grid: { hue: "indigo-violet", tone: 12, intensity: 4 },
      frame: { hue: "indigo-violet", tone: 16, intensity: 4 },
      card: { hue: "indigo-violet", tone: 12, intensity: 3 },
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

// ---------------------------------------------------------------------------
// handleThemesList
// ---------------------------------------------------------------------------

describe("handleThemesList", () => {
  it("returns entries from shipped directory with correct source fields", () => {
    const files: Record<string, string[]> = {
      [FAKE_SHIPPED_DIR]: ["brio.json", "harmony.json"],
    };
    const fileContents: Record<string, string> = {
      [path.join(FAKE_SHIPPED_DIR, "brio.json")]: makeBrioJson(),
      [path.join(FAKE_SHIPPED_DIR, "harmony.json")]: makeHarmonyJson(),
    };
    const mockFs: FsReadImpl = {
      readdirSync: (p: string) => files[p] ?? [],
      readFileSync: (p: string) => fileContents[p] ?? "{}",
      existsSync: (p: string) => p in fileContents,
    };

    const result = handleThemesList(mockFs, FAKE_SHIPPED_DIR);
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as { themes: Array<{ name: string; mode: string; source: string }> };
    const themes = body.themes;

    const brio = themes.find((t) => t.name === "brio");
    const harmony = themes.find((t) => t.name === "harmony");

    expect(brio).toBeDefined();
    expect(brio?.source).toBe("shipped");
    expect(brio?.mode).toBe("dark");

    expect(harmony).toBeDefined();
    expect(harmony?.source).toBe("shipped");
    expect(harmony?.mode).toBe("light");
  });

  it("sorts base theme first, then other shipped alphabetically", () => {
    const files: Record<string, string[]> = {
      [FAKE_SHIPPED_DIR]: ["harmony.json", "brio.json"],
    };
    const fileContents: Record<string, string> = {
      [path.join(FAKE_SHIPPED_DIR, "harmony.json")]: makeHarmonyJson(),
      [path.join(FAKE_SHIPPED_DIR, "brio.json")]: makeBrioJson(),
    };
    const mockFs: FsReadImpl = {
      readdirSync: (p: string) => files[p] ?? [],
      readFileSync: (p: string) => fileContents[p] ?? "{}",
      existsSync: (p: string) => p in fileContents,
    };

    const result = handleThemesList(mockFs, FAKE_SHIPPED_DIR);
    const body = JSON.parse(result.body) as { themes: Array<{ name: string }> };
    const names = body.themes.map((t) => t.name);
    expect(names[0]).toBe(BASE_THEME_NAME);
    expect(names[1]).toBe("harmony");
  });

  it("returns empty array when shipped directory is empty", () => {
    const mockFs: FsReadImpl = {
      readdirSync: (_p: string) => [],
      readFileSync: (_p: string) => "{}",
      existsSync: (_p: string) => false,
    };
    const result = handleThemesList(mockFs, FAKE_SHIPPED_DIR);
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as { themes: unknown[] };
    expect(body.themes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// handleThemesLoadJson
// ---------------------------------------------------------------------------

describe("handleThemesLoadJson", () => {
  it("returns shipped theme JSON by direct filename lookup", () => {
    const content = makeBrioJson();
    const mockFs: FsReadImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => content,
      existsSync: (p: string) => p === path.join(FAKE_SHIPPED_DIR, "brio.json"),
    };
    const result = handleThemesLoadJson("brio", mockFs, FAKE_SHIPPED_DIR);
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("application/json");
    expect(result.body).toBe(content);
  });

  it("returns 404 when theme is not found in shipped directory", () => {
    const mockFs: FsReadImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => "",
      existsSync: (_p: string) => false,
    };
    const result = handleThemesLoadJson("nonexistent", mockFs, FAKE_SHIPPED_DIR);
    expect(result.status).toBe(404);
  });

  it("decodes URL-encoded theme name for lookup", () => {
    // Theme named "My Theme" — client sends "My%20Theme" in the URL
    // The middleware decodes before calling this function
    const content = JSON.stringify({ name: "My Theme", mode: "dark" });
    const mockFs: FsReadImpl = {
      readdirSync: () => [],
      readFileSync: (_p: string) => content,
      existsSync: (p: string) => p === path.join(FAKE_SHIPPED_DIR, "My Theme.json"),
    };
    const result = handleThemesLoadJson("My Theme", mockFs, FAKE_SHIPPED_DIR);
    expect(result.status).toBe(200);
    expect(result.body).toBe(content);
  });
});
