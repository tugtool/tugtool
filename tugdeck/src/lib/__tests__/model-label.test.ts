/**
 * model-label.test.ts — pure-logic coverage for the Z4B model-chip label
 * formatter ([#step-2]).
 *
 * No store, no DOM — the chip rendering and the live `model_change`
 * round-trip are covered by the real-app test; this pins the id → label
 * mapping, mirroring `model-context-max.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { formatModelLabel } from "@/lib/model-label";

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
