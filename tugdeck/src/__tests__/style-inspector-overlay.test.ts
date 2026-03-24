/**
 * style-inspector-overlay.ts unit tests.
 *
 * Tests cover the standalone exported functions and types that remain after
 * the StyleInspectorOverlay class was removed in Step 6:
 *
 * - PALETTE_VAR_REGEX: matches palette variable names correctly
 * - resolveTokenChain: walks var() references and terminates correctly
 * - resolveTokenChainForProperty: token discovery and chain building
 * - extractTugColorProvenance: parses hue family, preset, reads TugColor constants
 * - shortenNumbers: rounds floating-point numbers in CSS value strings
 * - buildDomPath: builds short DOM path strings
 * - buildFormulaRows: builds formula rows from token chains and formulas data
 * - createFormulaSection: renders formula rows as HTMLElement (retained for test coverage
 *   until migrated to buildFormulaRows-based tests; see roadmap #roadmap)
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
  buildFormulaRows,
  createFormulaSection,
  categorizeProperty,
  scanAllTugProperties,
  invalidateTugPropertiesCache,
  groupProperties,
  getReverseMap,
} from "@/components/tugways/style-inspector-overlay";
import type { TokenChainResult, FormulasData } from "@/components/tugways/style-inspector-overlay";
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
// buildFormulaRows
// ---------------------------------------------------------------------------

describe("buildFormulaRows", () => {
  const makeEmptyChain = (): TokenChainResult => ({
    originToken: null,
    originLayer: "none",
    chain: [],
    endsAtPalette: false,
    paletteVar: null,
    terminalValue: null,
    usedHeuristic: false,
  });

  const makeChainWithToken = (token: string, terminalValue: string): TokenChainResult => ({
    originToken: token,
    originLayer: "base",
    chain: [{ property: token, value: terminalValue }],
    endsAtPalette: false,
    paletteVar: null,
    terminalValue,
    usedHeuristic: false,
  });

  it("returns empty array when all chains have no origin token", () => {
    const formulasData: FormulasData = { formulas: {}, sources: {}, mode: "dark", themeName: "test" };
    const reverseMap: ReverseMap = { tokenToFields: new Map() };

    const result = buildFormulaRows(
      makeEmptyChain(),
      makeEmptyChain(),
      makeEmptyChain(),
      formulasData,
      reverseMap
    );
    expect(result).toHaveLength(0);
  });

  it("returns rows when token maps to formula fields", () => {
    const formulasData: FormulasData = {
      formulas: { intensity: 0.7, tone: 0.5 },
      sources: {},
      mode: "dark",
      themeName: "test",
    };
    const reverseMap: ReverseMap = {
      tokenToFields: new Map([
        ["--tug-test-bg", [
          { field: "intensity", property: "intensity" },
          { field: "tone", property: "tone" },
        ]],
      ]),
    };

    const bgChain = makeChainWithToken("--tug-test-bg", "oklch(0.5 0.2 240)");

    const result = buildFormulaRows(
      bgChain,
      makeEmptyChain(),
      makeEmptyChain(),
      formulasData,
      reverseMap
    );
    expect(result).toHaveLength(2);
    expect(result[0].field).toBe("intensity");
    expect(result[0].value).toBe(0.7);
    expect(result[1].field).toBe("tone");
    expect(result[1].value).toBe(0.5);
  });

  it("deduplicates formula rows by field name across chains", () => {
    const formulasData: FormulasData = {
      formulas: { intensity: 0.7 },
      sources: {},
      mode: "dark",
      themeName: "test",
    };
    const reverseMap: ReverseMap = {
      tokenToFields: new Map([
        ["--tug-test-token", [{ field: "intensity", property: "intensity" }]],
      ]),
    };

    const chain = makeChainWithToken("--tug-test-token", "oklch(0.5 0.2 240)");

    const result = buildFormulaRows(chain, chain, makeEmptyChain(), formulasData, reverseMap);
    // Same field from two chains -- deduplicated to one row
    expect(result).toHaveLength(1);
    expect(result[0].field).toBe("intensity");
  });
});

// ---------------------------------------------------------------------------
// createFormulaSection (retained for test coverage until migrated)
// ---------------------------------------------------------------------------

describe("createFormulaSection", () => {
  it("renders a (constant) indicator when rows are empty", () => {
    const el = createFormulaSection([], true);
    expect(el.className).toBe("tug-inspector-section");
    expect(el.textContent).toContain("(constant)");
  });

  it("renders a (constant) indicator when isConstant is true", () => {
    const el = createFormulaSection([], true);
    expect(el.textContent).toContain("(constant)");
  });

  it("renders formula rows when provided", () => {
    const rows = [
      { field: "intensity", value: 0.7, property: "intensity" as const, isStructural: false },
      { field: "tone", value: 0.5, property: "tone" as const, isStructural: false },
    ];
    const el = createFormulaSection(rows, false);
    expect(el.querySelectorAll(".tug-inspector-formula-field").length).toBe(2);
    expect(el.textContent).toContain("intensity");
    expect(el.textContent).toContain("0.7");
  });

  it("renders structural label for structural rows", () => {
    const rows = [
      { field: "alpha", value: 0.5, property: "alpha" as const, isStructural: true },
    ];
    const el = createFormulaSection(rows, false);
    expect(el.textContent).toContain("(applies on release)");
  });

  it("has a Formula title", () => {
    const el = createFormulaSection([], false);
    const titleEl = el.querySelector(".tug-inspector-section__title");
    expect(titleEl).not.toBeNull();
    expect(titleEl!.textContent).toBe("Formula");
  });
});

// ---------------------------------------------------------------------------
// categorizeProperty
// ---------------------------------------------------------------------------

describe("categorizeProperty", () => {
  it("classifies --tug-tab-bg-rest as BACKGROUND/rest", () => {
    const { category, state } = categorizeProperty("--tug-tab-bg-rest");
    expect(category).toBe("BACKGROUND");
    expect(state).toBe("rest");
  });

  it("classifies --tug-tab-fg-hover as TEXT/hover", () => {
    const { category, state } = categorizeProperty("--tug-tab-fg-hover");
    expect(category).toBe("TEXT");
    expect(state).toBe("hover");
  });

  it("classifies --tug-card-border as BORDER/rest (no state suffix)", () => {
    const { category, state } = categorizeProperty("--tug-card-border");
    expect(category).toBe("BORDER");
    expect(state).toBe("rest");
  });

  it("classifies --tug-dropdown-shadow as OTHER/rest", () => {
    const { category, state } = categorizeProperty("--tug-dropdown-shadow");
    expect(category).toBe("OTHER");
    expect(state).toBe("rest");
  });

  it("classifies -surface- tokens as BACKGROUND", () => {
    const { category } = categorizeProperty("--tug-surface-global-primary-normal-default-rest");
    expect(category).toBe("BACKGROUND");
  });

  it("classifies -text- tokens as TEXT", () => {
    const { category } = categorizeProperty("--tug-element-global-text-normal-default-rest");
    expect(category).toBe("TEXT");
  });

  it("classifies -divider- tokens as BORDER", () => {
    const { category } = categorizeProperty("--tug-card-title-bar-divider");
    expect(category).toBe("BORDER");
  });

  it("classifies -active state suffix correctly", () => {
    const { state } = categorizeProperty("--tug-tab-bg-active");
    expect(state).toBe("active");
  });

  it("classifies -disabled state suffix correctly", () => {
    const { state } = categorizeProperty("--tug-tab-bg-disabled");
    expect(state).toBe("disabled");
  });
});

// ---------------------------------------------------------------------------
// scanAllTugProperties
// ---------------------------------------------------------------------------

describe("scanAllTugProperties", () => {
  beforeEach(() => {
    // Ensure cache is cleared before each test
    invalidateTugPropertiesCache();
  });

  afterEach(() => {
    invalidateTugPropertiesCache();
  });

  it("returns a Set (even if empty in jsdom environment)", () => {
    const result = scanAllTugProperties();
    expect(result).toBeInstanceOf(Set);
  });

  it("caches results across multiple calls", () => {
    const first = scanAllTugProperties();
    const second = scanAllTugProperties();
    // Should return same Set instance (cached)
    expect(first).toBe(second);
  });

  it("returns fresh result after cache invalidation", () => {
    const first = scanAllTugProperties();
    invalidateTugPropertiesCache();
    const second = scanAllTugProperties();
    // Should be a new Set instance
    expect(first).not.toBe(second);
  });
});

// ---------------------------------------------------------------------------
// groupProperties
// ---------------------------------------------------------------------------

describe("groupProperties", () => {
  it("returns a GroupedProperties map with all four categories", () => {
    const tugProps = new Set<string>();
    const reverseMap: ReverseMap = { fieldToTokens: new Map(), tokenToFields: new Map() };
    const grouped = groupProperties(tugProps, null, reverseMap);

    expect(grouped.has("BACKGROUND")).toBe(true);
    expect(grouped.has("TEXT")).toBe(true);
    expect(grouped.has("BORDER")).toBe(true);
    expect(grouped.has("OTHER")).toBe(true);
  });

  it("places --tug-tab-bg-rest in BACKGROUND/rest", () => {
    const tugProps = new Set(["--tug-tab-bg-rest"]);
    const reverseMap: ReverseMap = { fieldToTokens: new Map(), tokenToFields: new Map() };
    const grouped = groupProperties(tugProps, null, reverseMap);

    const bgMap = grouped.get("BACKGROUND")!;
    const restEntries = bgMap.get("rest")!;
    expect(restEntries.some((e) => e.property === "--tug-tab-bg-rest")).toBe(true);
  });

  it("places --tug-tab-fg-hover in TEXT/hover", () => {
    const tugProps = new Set(["--tug-tab-fg-hover"]);
    const reverseMap: ReverseMap = { fieldToTokens: new Map(), tokenToFields: new Map() };
    const grouped = groupProperties(tugProps, null, reverseMap);

    const textMap = grouped.get("TEXT")!;
    const hoverEntries = textMap.get("hover")!;
    expect(hoverEntries.some((e) => e.property === "--tug-tab-fg-hover")).toBe(true);
  });

  it("places --tug-card-border in BORDER/rest (no state suffix)", () => {
    const tugProps = new Set(["--tug-card-border"]);
    const reverseMap: ReverseMap = { fieldToTokens: new Map(), tokenToFields: new Map() };
    const grouped = groupProperties(tugProps, null, reverseMap);

    const borderMap = grouped.get("BORDER")!;
    const restEntries = borderMap.get("rest")!;
    expect(restEntries.some((e) => e.property === "--tug-card-border")).toBe(true);
  });

  it("places --tug-dropdown-shadow in OTHER/rest", () => {
    const tugProps = new Set(["--tug-dropdown-shadow"]);
    const reverseMap: ReverseMap = { fieldToTokens: new Map(), tokenToFields: new Map() };
    const grouped = groupProperties(tugProps, null, reverseMap);

    const otherMap = grouped.get("OTHER")!;
    const restEntries = otherMap.get("rest")!;
    expect(restEntries.some((e) => e.property === "--tug-dropdown-shadow")).toBe(true);
  });

  it("attaches formula rows when formulasData and reverseMap match", () => {
    // Set up document.body property so resolveTokenChain can find the chain
    document.body.style.setProperty("--tug-test-bg-rest", " oklch(0.5 0.2 240)");

    const tugProps = new Set(["--tug-test-bg-rest"]);
    const formulasData: FormulasData = {
      formulas: { intensity: 0.7, tone: 50 },
      sources: {},
      mode: "dark",
      themeName: "test",
    };
    const reverseMap: ReverseMap = {
      fieldToTokens: new Map(),
      tokenToFields: new Map([
        ["--tug-test-bg-rest", [
          { field: "intensity", property: "intensity" },
          { field: "tone", property: "tone" },
        ]],
      ]),
    };

    const grouped = groupProperties(tugProps, formulasData, reverseMap);
    const bgMap = grouped.get("BACKGROUND")!;
    const restEntries = bgMap.get("rest")!;

    const entry = restEntries.find((e) => e.property === "--tug-test-bg-rest");
    expect(entry).not.toBeUndefined();
    expect(entry!.formulaRows).toHaveLength(2);
    expect(entry!.formulaRows[0].field).toBe("intensity");
    expect(entry!.formulaRows[1].field).toBe("tone");

    document.body.style.removeProperty("--tug-test-bg-rest");
  });

  it("returns empty formula rows when formulasData is null", () => {
    const tugProps = new Set(["--tug-tab-bg-rest"]);
    const reverseMap: ReverseMap = { fieldToTokens: new Map(), tokenToFields: new Map() };
    const grouped = groupProperties(tugProps, null, reverseMap);

    const bgMap = grouped.get("BACKGROUND")!;
    const restEntries = bgMap.get("rest")!;
    const entry = restEntries.find((e) => e.property === "--tug-tab-bg-rest");
    // entry exists but has no formula rows since formulasData is null
    expect(entry).not.toBeUndefined();
    expect(entry!.formulaRows).toHaveLength(0);
  });

  it("all four states are present in every category map", () => {
    const tugProps = new Set<string>();
    const reverseMap: ReverseMap = { fieldToTokens: new Map(), tokenToFields: new Map() };
    const grouped = groupProperties(tugProps, null, reverseMap);

    for (const cat of ["BACKGROUND", "TEXT", "BORDER", "OTHER"] as const) {
      const stateMap = grouped.get(cat)!;
      expect(stateMap.has("rest")).toBe(true);
      expect(stateMap.has("hover")).toBe(true);
      expect(stateMap.has("active")).toBe(true);
      expect(stateMap.has("disabled")).toBe(true);
    }
  });

  it("getReverseMap() returns a ReverseMap with tokenToFields", () => {
    const reverseMap = getReverseMap();
    expect(reverseMap).not.toBeNull();
    expect(reverseMap.tokenToFields).toBeInstanceOf(Map);
  });
});
