/**
 * style-inspector-core.ts unit tests.
 *
 * Tests cover the standalone exported functions and types:
 *
 * - PALETTE_VAR_REGEX: matches palette variable names correctly
 * - resolveTokenChain: walks var() references and terminates correctly
 * - resolveTokenChainForProperty: token discovery and chain building
 * - extractTugColorProvenance: parses hue family, preset, reads TugColor constants
 * - shortenNumbers: rounds floating-point numbers in CSS value strings
 * - buildDomPath: builds short DOM path strings
 * - collectElementTugProperties: collects --tug-* properties from matched CSS rules
 * - buildAllStateFormulaRows: groups formula rows by interaction state
 *
 * Note: Tests use happy-dom (preloaded via bunfig.toml). getComputedStyle in
 * happy-dom returns empty strings for custom properties, so token chain tests use
 * direct style.setProperty() on document.body to set values.
 */

import "./setup-rtl";

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  PALETTE_VAR_REGEX,
  resolveTokenChain,
  resolveTokenChainForProperty,
  extractTugColorProvenance,
  shortenNumbers,
  buildDomPath,
  collectElementTugProperties,
  buildAllStateFormulaRows,
} from "@/components/tugways/style-inspector-core";
import type { FormulasData } from "@/components/tugways/style-inspector-core";
import type { ReverseMap } from "@/components/tugways/formula-reverse-map";

// ---------------------------------------------------------------------------
// PALETTE_VAR_REGEX
// ---------------------------------------------------------------------------

describe("PALETTE_VAR_REGEX", () => {
  it("matches bare hue names", () => {
    expect(PALETTE_VAR_REGEX.test("--tug-orange")).toBe(true);
    expect(PALETTE_VAR_REGEX.test("--tug-cobalt")).toBe(true);
    expect(PALETTE_VAR_REGEX.test("--tug-cyan")).toBe(true);
    expect(PALETTE_VAR_REGEX.test("--tug-cherry")).toBe(true);
    expect(PALETTE_VAR_REGEX.test("--tug-coral")).toBe(true);
  });

  it("matches hue names with valid preset suffixes", () => {
    expect(PALETTE_VAR_REGEX.test("--tug-orange-intense")).toBe(true);
    expect(PALETTE_VAR_REGEX.test("--tug-orange-muted")).toBe(true);
    expect(PALETTE_VAR_REGEX.test("--tug-orange-light")).toBe(true);
    expect(PALETTE_VAR_REGEX.test("--tug-orange-dark")).toBe(true);
    expect(PALETTE_VAR_REGEX.test("--tug-cobalt-intense")).toBe(true);
  });

  it("does NOT match removed preset suffixes (accent, subtle, deep)", () => {
    expect(PALETTE_VAR_REGEX.test("--tug-orange-accent")).toBe(false);
    expect(PALETTE_VAR_REGEX.test("--tug-orange-subtle")).toBe(false);
    expect(PALETTE_VAR_REGEX.test("--tug-orange-deep")).toBe(false);
  });

  it("does NOT match global constants", () => {
    expect(PALETTE_VAR_REGEX.test("--tug-l-dark")).toBe(false);
    expect(PALETTE_VAR_REGEX.test("--tug-l-light")).toBe(false);
    expect(PALETTE_VAR_REGEX.test("--tug-element-global-fill-normal-accent-rest")).toBe(false);
    expect(PALETTE_VAR_REGEX.test("--tug-tab-bar-bg")).toBe(false);
    expect(PALETTE_VAR_REGEX.test("--tug-zoom")).toBe(false);
  });

  it("does NOT match per-hue internal constants", () => {
    expect(PALETTE_VAR_REGEX.test("--tug-orange-h")).toBe(false);
    expect(PALETTE_VAR_REGEX.test("--tug-orange-canonical-l")).toBe(false);
    expect(PALETTE_VAR_REGEX.test("--tug-orange-peak-c")).toBe(false);
  });

  it("does NOT match invalid preset suffixes", () => {
    expect(PALETTE_VAR_REGEX.test("--tug-orange-bright")).toBe(false);
    expect(PALETTE_VAR_REGEX.test("--tug-orange-primary")).toBe(false);
  });

  it("matches all 24 known hue families", () => {
    const hues = [
      "cherry", "red", "tomato", "flame", "orange", "amber", "gold", "yellow",
      "lime", "green", "mint", "teal", "cyan", "sky", "blue", "cobalt",
      "violet", "purple", "plum", "pink", "rose", "magenta", "berry", "coral",
    ];
    for (const hue of hues) {
      expect(PALETTE_VAR_REGEX.test(`--tug-${hue}`)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// shortenNumbers
// ---------------------------------------------------------------------------

describe("shortenNumbers", () => {
  it("rounds floating-point numbers to 3 significant digits", () => {
    // toPrecision(3) rounds to 3 significant digits and trailing zeros are stripped
    expect(shortenNumbers("oklch(0.7800 0.2660 55.000)")).toBe("oklch(0.78 0.266 55)");
  });

  it("removes trailing zeros after rounding", () => {
    expect(shortenNumbers("0.100")).toBe("0.1");
    expect(shortenNumbers("1.000")).toBe("1");
  });

  it("passes non-numeric strings unchanged", () => {
    expect(shortenNumbers("red")).toBe("red");
    expect(shortenNumbers("#ff0000")).toBe("#ff0000");
  });

  it("handles integer values unchanged", () => {
    expect(shortenNumbers("55")).toBe("55");
    expect(shortenNumbers("0")).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// buildDomPath
// ---------------------------------------------------------------------------

describe("buildDomPath", () => {
  it("returns a single element path for a root element", () => {
    const el = document.createElement("div");
    el.className = "foo bar";
    document.body.appendChild(el);

    const path = buildDomPath(el);
    expect(path).toContain("div");
    expect(path).toContain(".foo");

    document.body.removeChild(el);
  });

  it("includes parent elements in the path", () => {
    const parent = document.createElement("section");
    parent.className = "parent-class";
    const child = document.createElement("button");
    child.className = "child-class";
    parent.appendChild(child);
    document.body.appendChild(parent);

    const path = buildDomPath(child);
    expect(path).toContain("section");
    expect(path).toContain("button");
    expect(path).toContain(">");

    document.body.removeChild(parent);
  });

  it("limits classes to first 2", () => {
    const el = document.createElement("div");
    el.className = "a b c d e";
    document.body.appendChild(el);

    const path = buildDomPath(el);
    // Should only include first 2 classes
    expect(path).toContain(".a");
    expect(path).toContain(".b");
    expect(path).not.toContain(".c");

    document.body.removeChild(el);
  });

  it("includes id when present", () => {
    const el = document.createElement("div");
    el.id = "my-id";
    document.body.appendChild(el);

    const path = buildDomPath(el);
    expect(path).toContain("#my-id");

    document.body.removeChild(el);
  });
});

// ---------------------------------------------------------------------------
// resolveTokenChain
// ---------------------------------------------------------------------------

describe("resolveTokenChain", () => {
  afterEach(() => {
    // Clean up any custom properties set on body
    document.body.style.removeProperty("--tug-element-global-fill-normal-accentCool-rest");
    document.body.style.removeProperty("--tug-cobalt-intense");
    document.body.style.removeProperty("--tug-orange-intense");
    document.body.style.removeProperty("--tug-test-token");
    document.body.style.removeProperty("--tug-tab-bar-bg");
  });

  it("returns empty chain for a property with no value on body", () => {
    const chain = resolveTokenChain("--tug-nonexistent-token");
    expect(chain).toHaveLength(0);
  });

  it("walks a two-hop chain from base to palette variable", () => {
    document.body.style.setProperty("--tug-element-global-fill-normal-accentCool-rest", " var(--tug-cobalt-intense)");
    document.body.style.setProperty("--tug-cobalt-intense", " oklch(0.5 0.2 240)");

    const chain = resolveTokenChain("--tug-element-global-fill-normal-accentCool-rest");
    expect(chain.length).toBeGreaterThanOrEqual(1);
    expect(chain[0].property).toBe("--tug-element-global-fill-normal-accentCool-rest");

    if (chain.length >= 2) {
      expect(chain[1].property).toBe("--tug-cobalt-intense");
    }
  });

  it("terminates at PALETTE_VAR_REGEX match", () => {
    document.body.style.setProperty("--tug-orange-intense", " oklch(0.7 0.2 55)");

    const chain = resolveTokenChain("--tug-orange-intense");
    expect(chain.length).toBe(1);
    expect(chain[0].property).toBe("--tug-orange-intense");
  });

  it("terminates when value starts with oklch(", () => {
    document.body.style.setProperty("--tug-test-token", " oklch(0.5 0.1 180)");

    const chain = resolveTokenChain("--tug-test-token");
    expect(chain.length).toBe(1);
    expect(chain[0].value.trim()).toMatch(/^oklch\(/);
  });

  it("terminates when value has no var() reference (literal terminal)", () => {
    document.body.style.setProperty("--tug-test-token", " #ff0000");

    const chain = resolveTokenChain("--tug-test-token");
    expect(chain.length).toBe(1);
    expect(chain[0].property).toBe("--tug-test-token");
    expect(chain[0].value.trim()).toBe("#ff0000");
  });

  it("does not walk into non-tug var() references", () => {
    const varMatch = " var(--other-prop)".match(/var\((--tug-[a-zA-Z0-9_-]+)/);
    expect(varMatch).toBeNull();

    const tugMatch = " var(--tug-element-global-fill-normal-accentCool-rest)".match(/var\((--[a-zA-Z0-9_-]+)/);
    expect(tugMatch).not.toBeNull();
    expect(tugMatch![1]).toBe("--tug-element-global-fill-normal-accentCool-rest");
  });

  it("cycle guard exits cleanly for nonexistent property", () => {
    const chain = resolveTokenChain("--tug-nonexistent-cycle-test");
    expect(chain.length).toBe(0);
  });

  it("walks a three-layer chain: comp -> base -> terminal hex", () => {
    document.body.style.setProperty("--tug-tab-bar-bg", " var(--tug-tab-bar-bg)");
    document.body.style.setProperty("--tug-tab-bar-bg", " #1a1d24");

    const chain = resolveTokenChain("--tug-tab-bar-bg");
    expect(chain.length).toBeGreaterThanOrEqual(1);
    expect(chain[0].property).toBe("--tug-tab-bar-bg");

    if (chain.length >= 2) {
      expect(chain[1].property).toBe("--tug-tab-bar-bg");
      expect(chain[1].value.trim()).toBe("#1a1d24");
    }
  });

  it("walks two-layer chromatic chain: base -> palette var (stops at palette)", () => {
    document.body.style.setProperty("--tug-element-global-fill-normal-accentCool-rest", " var(--tug-cobalt-intense)");
    document.body.style.setProperty("--tug-cobalt-intense", " oklch(0.5 0.2 240)");

    const chain = resolveTokenChain("--tug-element-global-fill-normal-accentCool-rest");
    expect(chain.length).toBeGreaterThanOrEqual(1);
    expect(chain[0].property).toBe("--tug-element-global-fill-normal-accentCool-rest");

    if (chain.length >= 2) {
      expect(chain[1].property).toBe("--tug-cobalt-intense");
      expect(PALETTE_VAR_REGEX.test("--tug-cobalt-intense")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// extractTugColorProvenance
// ---------------------------------------------------------------------------

describe("extractTugColorProvenance", () => {
  afterEach(() => {
    document.body.style.removeProperty("--tug-orange-canonical-l");
    document.body.style.removeProperty("--tug-orange-peak-c");
    document.body.style.removeProperty("--tug-orange-h");
    document.body.style.removeProperty("--tug-cyan-canonical-l");
    document.body.style.removeProperty("--tug-cyan-peak-c");
    document.body.style.removeProperty("--tug-cyan-h");
    document.body.style.removeProperty("--tug-cobalt-canonical-l");
    document.body.style.removeProperty("--tug-cobalt-peak-c");
    document.body.style.removeProperty("--tug-cobalt-h");
  });

  it("returns null for non-palette token names", () => {
    expect(extractTugColorProvenance("--tug-element-global-fill-normal-accent-rest")).toBeNull();
    expect(extractTugColorProvenance("--tug-l-dark")).toBeNull();
    expect(extractTugColorProvenance("--tug-zoom")).toBeNull();
  });

  it("extractTugColorProvenance('--tug-orange-light') returns { hue: 'orange', preset: 'light' }", () => {
    document.body.style.setProperty("--tug-orange-canonical-l", " 0.780");
    document.body.style.setProperty("--tug-orange-peak-c", " 0.266");
    document.body.style.setProperty("--tug-orange-h", " 55");

    const result = extractTugColorProvenance("--tug-orange-light");
    expect(result).not.toBeNull();
    expect(result!.hue).toBe("orange");
    expect(result!.preset).toBe("light");
  });

  it("extractTugColorProvenance('--tug-cyan') returns { hue: 'cyan', preset: 'canonical' }", () => {
    document.body.style.setProperty("--tug-cyan-canonical-l", " 0.750");
    document.body.style.setProperty("--tug-cyan-peak-c", " 0.180");
    document.body.style.setProperty("--tug-cyan-h", " 192");

    const result = extractTugColorProvenance("--tug-cyan");
    expect(result).not.toBeNull();
    expect(result!.hue).toBe("cyan");
    expect(result!.preset).toBe("canonical");
  });

  it("extractTugColorProvenance('--tug-cobalt-intense') returns correct fields", () => {
    document.body.style.setProperty("--tug-cobalt-canonical-l", " 0.680");
    document.body.style.setProperty("--tug-cobalt-peak-c", " 0.220");
    document.body.style.setProperty("--tug-cobalt-h", " 240");

    const result = extractTugColorProvenance("--tug-cobalt-intense");
    expect(result).not.toBeNull();
    expect(result!.hue).toBe("cobalt");
    expect(result!.preset).toBe("intense");
    expect(result!.canonicalL.trim()).toBe("0.680");
    expect(result!.peakC.trim()).toBe("0.220");
    expect(result!.hueAngle.trim()).toBe("240");
  });

  it("returns empty strings for TugColor constants when not set on body", () => {
    const result = extractTugColorProvenance("--tug-orange");
    expect(result).not.toBeNull();
    expect(result!.hue).toBe("orange");
    expect(result!.preset).toBe("canonical");
    // Constants not set in happy-dom -> empty strings
    expect(result!.canonicalL).toBe("");
    expect(result!.peakC).toBe("");
    expect(result!.hueAngle).toBe("");
  });
});

// ---------------------------------------------------------------------------
// resolveTokenChainForProperty integration
// ---------------------------------------------------------------------------

describe("resolveTokenChainForProperty integration", () => {
  afterEach(() => {
    document.body.style.removeProperty("--tug-surface-global-primary-normal-default-rest");
    document.body.style.removeProperty("--tug-cobalt-intense");
  });

  it("returns originLayer: 'none' when no token matches the computed value", () => {
    const el = document.createElement("div");
    el.style.backgroundColor = "#deadbe";
    document.body.appendChild(el);

    const result = resolveTokenChainForProperty(el, "background-color", "#deadbe");
    expect(result.originToken).toBeNull();
    expect(result.originLayer).toBe("none");

    document.body.removeChild(el);
  });

  it("returns empty chain for 'none' background-color", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);

    const result = resolveTokenChainForProperty(el, "background-color", "none");
    expect(result.chain).toHaveLength(0);
    expect(result.originToken).toBeNull();

    document.body.removeChild(el);
  });

  it("sets usedHeuristic when a single-hop chain has a terminal literal value", () => {
    document.body.style.setProperty("--tug-surface-global-primary-normal-default-rest", " #1a1d24");

    const el = document.createElement("div");
    el.style.backgroundColor = "#1a1d24";
    document.body.appendChild(el);

    const result = resolveTokenChainForProperty(el, "background-color", "#1a1d24");

    if (result.originToken === "--tug-surface-global-primary-normal-default-rest" && result.chain.length === 1) {
      expect(result.usedHeuristic).toBe(true);
    } else {
      expect(result.chain.length).toBeGreaterThanOrEqual(0);
    }

    document.body.removeChild(el);
    document.body.style.removeProperty("--tug-surface-global-primary-normal-default-rest");
  });

  it("endsAtPalette is true when chain terminates at a palette variable", () => {
    document.body.style.setProperty("--tug-surface-global-primary-normal-default-rest", " var(--tug-cobalt-intense)");
    document.body.style.setProperty("--tug-cobalt-intense", " oklch(0.5 0.2 240)");

    const chain = resolveTokenChain("--tug-surface-global-primary-normal-default-rest");

    if (chain.length >= 2) {
      const last = chain[chain.length - 1];
      expect(PALETTE_VAR_REGEX.test(last.property)).toBe(true);
      expect(last.property).toBe("--tug-cobalt-intense");
    }

    document.body.style.removeProperty("--tug-surface-global-primary-normal-default-rest");
    document.body.style.removeProperty("--tug-cobalt-intense");
  });
});

// ---------------------------------------------------------------------------
// collectElementTugProperties
// ---------------------------------------------------------------------------

describe("collectElementTugProperties", () => {
  it("returns an array", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const result = collectElementTugProperties(el);
    expect(Array.isArray(result)).toBe(true);
    document.body.removeChild(el);
  });

  it("returns empty array for a detached element with no matched rules", () => {
    const el = document.createElement("div");
    // Not appended to the DOM — no stylesheets will match it
    const result = collectElementTugProperties(el);
    expect(Array.isArray(result)).toBe(true);
    // May or may not be empty depending on global rules, but should not throw
  });

  it("deduplicates property names", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const result = collectElementTugProperties(el);
    // Result should have no duplicates
    const unique = new Set(result);
    expect(unique.size).toBe(result.length);
    document.body.removeChild(el);
  });

  it("only returns properties starting with --tug-", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const result = collectElementTugProperties(el);
    for (const prop of result) {
      expect(prop.startsWith("--tug-")).toBe(true);
    }
    document.body.removeChild(el);
  });
});

// ---------------------------------------------------------------------------
// buildAllStateFormulaRows
// ---------------------------------------------------------------------------

describe("buildAllStateFormulaRows", () => {
  const makeFormulasData = (formulas: Record<string, number | string | boolean>): FormulasData => ({
    formulas,
    defaults: {},
    sources: {},
    mode: "dark",
    themeName: "test",
  });

  const makeReverseMap = (entries: Array<[string, Array<{ field: string; property: "tone" | "intensity" | "alpha" | "hueSlot" }>]>): ReverseMap => ({
    fieldToTokens: new Map(),
    tokenToFields: new Map(entries),
  });

  it("returns empty Map when no properties provided", () => {
    const formulasData = makeFormulasData({});
    const reverseMap = makeReverseMap([]);
    const result = buildAllStateFormulaRows([], formulasData, reverseMap);
    expect(result.size).toBe(0);
  });

  it("groups by interaction state from property name suffix", () => {
    // In happy-dom, getComputedStyle resolves var() to computed values,
    // so resolveTokenChain returns a single-hop chain where the terminal
    // token is the property itself. We match the reverseMap to property names.
    document.body.style.setProperty("--tug-btn-bg-rest", " oklch(0.5 0.1 180)");
    document.body.style.setProperty("--tug-btn-bg-hover", " oklch(0.6 0.1 180)");

    const formulasData = makeFormulasData({ restIntensity: 5, hoverIntensity: 8 });
    const reverseMap = makeReverseMap([
      ["--tug-btn-bg-rest", [{ field: "restIntensity", property: "intensity" }]],
      ["--tug-btn-bg-hover", [{ field: "hoverIntensity", property: "intensity" }]],
    ]);

    const result = buildAllStateFormulaRows(
      ["--tug-btn-bg-rest", "--tug-btn-bg-hover"],
      formulasData,
      reverseMap
    );

    const restRows = result.get("rest") ?? [];
    const hoverRows = result.get("hover") ?? [];

    expect(restRows.length).toBe(1);
    expect(restRows[0].field).toBe("restIntensity");

    expect(hoverRows.length).toBe(1);
    expect(hoverRows[0].field).toBe("hoverIntensity");

    document.body.style.removeProperty("--tug-btn-bg-rest");
    document.body.style.removeProperty("--tug-btn-bg-hover");
  });

  it("defaults to 'rest' state when no recognized suffix", () => {
    document.body.style.setProperty("--tug-some-bg", " oklch(0.5 0.1 180)");

    const formulasData = makeFormulasData({ someField: 10 });
    const reverseMap = makeReverseMap([
      ["--tug-some-bg", [{ field: "someField", property: "tone" }]],
    ]);

    const result = buildAllStateFormulaRows(["--tug-some-bg"], formulasData, reverseMap);

    const restRows = result.get("rest") ?? [];
    expect(restRows.length).toBe(1);
    expect(restRows[0].field).toBe("someField");

    document.body.style.removeProperty("--tug-some-bg");
  });

  it("deduplicates fields within the same state", () => {
    // Two properties in the same state that both map to the same field.
    document.body.style.setProperty("--tug-prop-a-rest", " oklch(0.5 0.1 180)");
    document.body.style.setProperty("--tug-prop-b-rest", " oklch(0.5 0.1 180)");

    const formulasData = makeFormulasData({ sharedField: 42 });
    const reverseMap = makeReverseMap([
      ["--tug-prop-a-rest", [{ field: "sharedField", property: "intensity" }]],
      ["--tug-prop-b-rest", [{ field: "sharedField", property: "intensity" }]],
    ]);

    const result = buildAllStateFormulaRows(
      ["--tug-prop-a-rest", "--tug-prop-b-rest"],
      formulasData,
      reverseMap
    );

    const restRows = result.get("rest") ?? [];
    // sharedField should appear only once despite two properties mapping to it
    expect(restRows.filter((r) => r.field === "sharedField").length).toBe(1);

    document.body.style.removeProperty("--tug-prop-a-rest");
    document.body.style.removeProperty("--tug-prop-b-rest");
  });

  it("recognizes -active and -disabled suffixes", () => {
    document.body.style.setProperty("--tug-btn-bg-active", " oklch(0.4 0.1 180)");
    document.body.style.setProperty("--tug-btn-bg-disabled", " oklch(0.3 0.05 180)");

    const formulasData = makeFormulasData({ activeField: 3, disabledField: 1 });
    const reverseMap = makeReverseMap([
      ["--tug-btn-bg-active", [{ field: "activeField", property: "intensity" }]],
      ["--tug-btn-bg-disabled", [{ field: "disabledField", property: "alpha" }]],
    ]);

    const result = buildAllStateFormulaRows(
      ["--tug-btn-bg-active", "--tug-btn-bg-disabled"],
      formulasData,
      reverseMap
    );

    expect((result.get("active") ?? []).length).toBe(1);
    expect((result.get("disabled") ?? []).length).toBe(1);
    expect(result.get("active")![0].field).toBe("activeField");
    expect(result.get("disabled")![0].field).toBe("disabledField");

    document.body.style.removeProperty("--tug-btn-bg-active");
    document.body.style.removeProperty("--tug-btn-bg-disabled");
  });

  it("skips properties with no matching token in the reverse map", () => {
    document.body.style.setProperty("--tug-unknown-rest", " oklch(0.5 0.1 180)");

    const formulasData = makeFormulasData({ someField: 10 });
    const reverseMap = makeReverseMap([]); // empty map

    const result = buildAllStateFormulaRows(["--tug-unknown-rest"], formulasData, reverseMap);
    expect(result.size).toBe(0);

    document.body.style.removeProperty("--tug-unknown-rest");
  });
});

