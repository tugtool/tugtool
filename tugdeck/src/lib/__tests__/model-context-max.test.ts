/**
 * Pure-logic tests for `resolveModelContextMax`. Pins the resolution
 * order documented in `model-context-max.ts`:
 *
 *   - `undefined` / `null` / `""` → DEFAULT_CONTEXT_MAX_TOKENS (200k).
 *   - `[1m]` suffix → EXTENDED_CONTEXT_MAX_TOKENS (1M), ahead of everything.
 *   - Claude's own catalog wording next — including for a model this build
 *     has never heard of.
 *   - Then the family/version floor, for when no catalog has landed.
 *   - Unknown family → DEFAULT.
 */

import { describe, it, expect } from "bun:test";

import type { CapabilityModel } from "@/lib/session-metadata-store";
import {
  DEFAULT_CONTEXT_MAX_TOKENS,
  EXTENDED_CONTEXT_MAX_TOKENS,
  parseContextAnnotation,
  resolveModelContextMax,
} from "@/lib/model-context-max";

/** The live catalog shape claude reports today. */
const ROWS: CapabilityModel[] = [
  {
    value: "default",
    displayName: "Default (recommended)",
    description: "Opus 5 · 1M · Best for everyday, complex tasks",
  },
  {
    value: "opus[1m]",
    displayName: "Opus (1M context)",
    description: "Opus 5 · 1M · Best for everyday, complex tasks",
  },
  {
    value: "claude-fable-5[1m]",
    displayName: "Fable",
    description: "Fable 5 · Most capable for your hardest tasks",
  },
  {
    value: "sonnet",
    displayName: "Sonnet",
    description: "Sonnet 5 · Efficient for routine tasks",
  },
  {
    value: "haiku",
    displayName: "Haiku",
    description: "Haiku 4.5 · Fastest for quick answers",
  },
];

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

  it("returns DEFAULT (200k) for Haiku 4.5 (a genuinely 200k model)", () => {
    expect(resolveModelContextMax("claude-haiku-4-5")).toBe(
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

  it("resolves the bare (non-[1m]) name of a native-1M model to EXTENDED", () => {
    // Opus 4.6/4.7/4.8, Sonnet 4.6, and Fable 5 are 1M-context models
    // natively — the bare id (as the replayed JSONL records it) must
    // resolve to 1M, not the 200k default.
    expect(resolveModelContextMax("claude-opus-4-8")).toBe(
      EXTENDED_CONTEXT_MAX_TOKENS,
    );
    expect(resolveModelContextMax("claude-opus-4-7")).toBe(
      EXTENDED_CONTEXT_MAX_TOKENS,
    );
    expect(resolveModelContextMax("claude-sonnet-4-6")).toBe(
      EXTENDED_CONTEXT_MAX_TOKENS,
    );
    expect(resolveModelContextMax("claude-fable-5")).toBe(
      EXTENDED_CONTEXT_MAX_TOKENS,
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

describe("resolveModelContextMax — the resumed-session bare name", () => {
  // The defect this tier exists for: claude's JSONL records the BARE
  // `claude-opus-5` on every assistant message — the `[1m]` spelling lives
  // only on the live `system/init`. A resumed session whose ledger has no
  // live row to merge against therefore reports the bare name, and the old
  // exact-id table sized its window at 200k the moment a new model shipped.
  it("sizes a bare current-generation name from the live catalog", () => {
    expect(resolveModelContextMax("claude-opus-5", ROWS)).toBe(
      EXTENDED_CONTEXT_MAX_TOKENS,
    );
  });

  it("sizes it from the family floor when no catalog has landed", () => {
    expect(resolveModelContextMax("claude-opus-5")).toBe(
      EXTENDED_CONTEXT_MAX_TOKENS,
    );
    expect(resolveModelContextMax("claude-sonnet-5")).toBe(
      EXTENDED_CONTEXT_MAX_TOKENS,
    );
  });

  it("sizes a family release this build has never heard of", () => {
    // The point of reading claude's wording: a model that ships after this
    // build resolves from what the catalog says, with no edit here.
    const future: CapabilityModel[] = [
      {
        value: "opus[1m]",
        displayName: "Opus (1M context)",
        description: "Opus 9 · 1M · Best for everyday, complex tasks",
      },
    ];
    expect(resolveModelContextMax("claude-opus-9", future)).toBe(
      EXTENDED_CONTEXT_MAX_TOKENS,
    );
  });

  it("takes a smaller window from the catalog over the family floor", () => {
    // Claude's word beats ours in BOTH directions — a family that goes back
    // to 200k must not keep reading 1M off our floor.
    const shrunk: CapabilityModel[] = [
      {
        value: "opus",
        displayName: "Opus",
        description: "Opus 9 · 200K · Best for everyday, complex tasks",
      },
    ];
    expect(resolveModelContextMax("claude-opus-9", shrunk)).toBe(
      DEFAULT_CONTEXT_MAX_TOKENS,
    );
  });

  it("keeps 200k for a row that states no window", () => {
    expect(resolveModelContextMax("claude-haiku-4-5", ROWS)).toBe(
      DEFAULT_CONTEXT_MAX_TOKENS,
    );
    expect(resolveModelContextMax("claude-haiku-4-5-20251001", ROWS)).toBe(
      DEFAULT_CONTEXT_MAX_TOKENS,
    );
  });

  it("keeps 200k below a family's crossover version", () => {
    expect(resolveModelContextMax("claude-opus-4-5")).toBe(
      DEFAULT_CONTEXT_MAX_TOKENS,
    );
    // An id naming no version is not evidence of a new one.
    expect(resolveModelContextMax("claude-opus")).toBe(
      DEFAULT_CONTEXT_MAX_TOKENS,
    );
  });
});

describe("parseContextAnnotation", () => {
  it("reads claude's M / K idiom", () => {
    expect(parseContextAnnotation("1M")).toBe(1_000_000);
    expect(parseContextAnnotation("200K")).toBe(200_000);
    expect(parseContextAnnotation("1.5M")).toBe(1_500_000);
    expect(parseContextAnnotation("1 M")).toBe(1_000_000);
  });

  it("returns null for text carrying no annotation", () => {
    expect(parseContextAnnotation("Efficient for routine tasks")).toBeNull();
    expect(parseContextAnnotation("")).toBeNull();
  });
});
