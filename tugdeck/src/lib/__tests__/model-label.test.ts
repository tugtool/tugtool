/**
 * model-label.test.ts — pure-logic coverage for the Z4B model-chip label
 * formatter ([#step-2]).
 *
 * No store, no DOM — the chip rendering and the live `model_change`
 * round-trip are covered by the real-app test; this pins the id → label
 * mapping, mirroring `model-context-max.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import type { CapabilityModel } from "@/lib/session-metadata-store";
import {
  compressContextPhrase,
  findModelRow,
  formatModelLabel,
  knownModelRows,
  modelRowTitle,
  resolveModelLabel,
} from "@/lib/model-label";

describe("formatModelLabel", () => {
  test("formats the base family + version", () => {
    expect(formatModelLabel("claude-opus-4-8")).toBe("Opus 4.8");
    expect(formatModelLabel("claude-sonnet-4-6")).toBe("Sonnet 4.6");
    expect(formatModelLabel("claude-haiku-4-5")).toBe("Haiku 4.5");
  });

  test("appends · 1M for the extended-context [1m] variant", () => {
    expect(formatModelLabel("claude-opus-4-8[1m]")).toBe("Opus 4.8 · 1M");
    expect(formatModelLabel("claude-sonnet-4-6[1m]")).toBe("Sonnet 4.6 · 1M");
  });

  test("drops a trailing release-date segment", () => {
    expect(formatModelLabel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(formatModelLabel("claude-opus-4-8-20260115[1m]")).toBe(
      "Opus 4.8 · 1M",
    );
  });

  test("a family with no version segment renders just the family", () => {
    expect(formatModelLabel("claude-opus")).toBe("Opus");
  });

  test("an unparseable id falls back to its raw string", () => {
    expect(formatModelLabel("gpt-4o")).toBe("gpt-4o");
    expect(formatModelLabel("claude-3-5-sonnet-20241022")).toBe(
      "claude-3-5-sonnet-20241022",
    );
    expect(formatModelLabel("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// The unified label path — the ONE code path every model chip renders through
// ---------------------------------------------------------------------------

const ROWS: CapabilityModel[] = [
  {
    value: "default",
    displayName: "Default (recommended)",
    description: "Opus 4.8 with 1M context · Best for everyday, complex work",
  },
  {
    value: "opus",
    displayName: "Opus",
    description: "Opus 4.8 with 1M context · Best for everyday, complex work",
  },
  {
    value: "fable",
    displayName: "Fable",
    description: "Fable 5 · Most capable for your hardest problems",
  },
  {
    value: "sonnet",
    displayName: "Sonnet",
    description: "Sonnet 5 · Efficient for routine tasks",
  },
  { value: "haiku", displayName: "Haiku" }, // no description
];

describe("compressContextPhrase", () => {
  test("compresses the verbose context phrase to the · 1M idiom", () => {
    expect(compressContextPhrase("Opus 4.8 with 1M context")).toBe(
      "Opus 4.8 · 1M",
    );
    expect(
      compressContextPhrase("Opus 4.8 with 1M context · Best for everyday"),
    ).toBe("Opus 4.8 · 1M · Best for everyday");
  });

  test("passes text without the phrase through unchanged", () => {
    expect(compressContextPhrase("Fable 5 · Most capable")).toBe(
      "Fable 5 · Most capable",
    );
  });
});

describe("modelRowTitle", () => {
  test("takes the name-with-version from the description's leading segment", () => {
    expect(modelRowTitle(ROWS[0])).toBe("Opus 4.8 · 1M"); // default
    expect(modelRowTitle(ROWS[2])).toBe("Fable 5");
    expect(modelRowTitle(ROWS[3])).toBe("Sonnet 5");
  });

  test("falls back to the stripped display name without a description", () => {
    expect(modelRowTitle(ROWS[4])).toBe("Haiku");
    expect(
      modelRowTitle({ value: "default", displayName: "Default (recommended)" }),
    ).toBe("Default");
  });
});

describe("findModelRow", () => {
  test("matches a bare selector exactly", () => {
    expect(findModelRow("fable", ROWS)?.value).toBe("fable");
    expect(findModelRow("default", ROWS)?.value).toBe("default");
  });

  test("matches a resolved id or label by containment", () => {
    expect(findModelRow("claude-fable-5", ROWS)?.value).toBe("fable");
    expect(findModelRow("claude-sonnet-4-6", ROWS)?.value).toBe("sonnet");
    expect(findModelRow("Sonnet 5", ROWS)?.value).toBe("sonnet");
  });

  test("never containment-matches the default row; unknowns are null", () => {
    expect(findModelRow("gpt-4o", ROWS)).toBeNull();
  });
});

describe("knownModelRows", () => {
  test("live list wins, catalog is the fallback, nothing means empty", () => {
    const live = [ROWS[0]];
    expect(knownModelRows(live, ROWS)).toBe(live);
    expect(knownModelRows([], ROWS)).toBe(ROWS);
    expect(knownModelRows([], null)).toEqual([]);
  });
});

describe("resolveModelLabel", () => {
  test("null model → the first row's title (the account default)", () => {
    expect(resolveModelLabel(null, ROWS)).toBe("Opus 4.8 · 1M");
  });

  test("null model with no rows → null (caller shows ?)", () => {
    expect(resolveModelLabel(null, [])).toBeNull();
  });

  test("selector, resolved id, and optimistic label all land on one title", () => {
    // The consistency-by-construction property: every way a surface can
    // name the same model yields the identical chip content.
    expect(resolveModelLabel("fable", ROWS)).toBe("Fable 5");
    expect(resolveModelLabel("claude-fable-5", ROWS)).toBe("Fable 5");
    expect(resolveModelLabel("Fable 5", ROWS)).toBe("Fable 5");
  });

  test("the default selector reads Default with no rows, row title with", () => {
    expect(resolveModelLabel("default", [])).toBe("Default");
    expect(resolveModelLabel("default", ROWS)).toBe("Opus 4.8 · 1M");
  });

  test("an unmatched resolved id parses through formatModelLabel", () => {
    expect(resolveModelLabel("claude-opus-4-8[1m]", [])).toBe("Opus 4.8 · 1M");
    expect(resolveModelLabel("gpt-4o", ROWS)).toBe("gpt-4o");
  });
});
