/**
 * Pure-logic tests for `resolveModelContextMax`. Pins the lookup
 * contract documented in `model-context-max.ts`:
 *
 *   - `undefined` / `null` / `""` → DEFAULT_CONTEXT_MAX_TOKENS (200k).
 *   - `[1m]` suffix → EXTENDED_CONTEXT_MAX_TOKENS (1M).
 *   - Unknown model names → DEFAULT.
 *   - The `[1m]` check fires BEFORE the override lookup.
 */

import { describe, it, expect } from "bun:test";

import {
  DEFAULT_CONTEXT_MAX_TOKENS,
  EXTENDED_CONTEXT_MAX_TOKENS,
  resolveModelContextMax,
} from "@/lib/model-context-max";

describe("resolveModelContextMax — defaults", () => {
  it("returns DEFAULT for undefined model", () => {
    expect(resolveModelContextMax(undefined)).toBe(DEFAULT_CONTEXT_MAX_TOKENS);
  });

  it("returns DEFAULT for null model", () => {
    expect(resolveModelContextMax(null)).toBe(DEFAULT_CONTEXT_MAX_TOKENS);
  });

  it("returns DEFAULT for empty-string model", () => {
    expect(resolveModelContextMax("")).toBe(DEFAULT_CONTEXT_MAX_TOKENS);
  });

  it("returns DEFAULT (200k) for an unknown model name", () => {
    expect(resolveModelContextMax("nonexistent-model-xyz")).toBe(
      DEFAULT_CONTEXT_MAX_TOKENS,
    );
  });

  it("DEFAULT is 200,000 tokens", () => {
    expect(DEFAULT_CONTEXT_MAX_TOKENS).toBe(200_000);
  });
});

describe("resolveModelContextMax — [1m] extended context", () => {
  it("returns EXTENDED for a model with the [1m] suffix", () => {
    expect(resolveModelContextMax("claude-opus-4-7[1m]")).toBe(
      EXTENDED_CONTEXT_MAX_TOKENS,
    );
    expect(resolveModelContextMax("claude-sonnet-4-6[1m]")).toBe(
      EXTENDED_CONTEXT_MAX_TOKENS,
    );
  });

  it("returns DEFAULT for the base (non-[1m]) variant of the same model", () => {
    expect(resolveModelContextMax("claude-opus-4-7")).toBe(
      DEFAULT_CONTEXT_MAX_TOKENS,
    );
    expect(resolveModelContextMax("claude-sonnet-4-6")).toBe(
      DEFAULT_CONTEXT_MAX_TOKENS,
    );
  });

  it("EXTENDED is 1,000,000 tokens", () => {
    expect(EXTENDED_CONTEXT_MAX_TOKENS).toBe(1_000_000);
  });

  it("matches the [1m] suffix only at the END of the name", () => {
    // Defensive: a literal `[1m]` somewhere in the middle of a name
    // (which Anthropic would never emit) should not trigger the
    // extended branch.
    expect(resolveModelContextMax("[1m]-model-prefix")).toBe(
      DEFAULT_CONTEXT_MAX_TOKENS,
    );
  });
});
