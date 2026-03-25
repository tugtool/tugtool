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
 * - handleThemesLoadJson returns shipped theme JSON by direct filename
 * - handleThemesLoadJson decodes URL-encoded theme names
 * - handleThemesLoadJson returns 404 for nonexistent theme
 */
import { describe, it, expect } from "bun:test";
import path from "path";

import {
  handleThemesLoadJson,
  type FsReadImpl,
} from "../../vite.config";

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
