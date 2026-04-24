/**
 * matchers.test.ts — Pure-logic unit tests for the trace-assertion
 * matchers. Parent plan Step 10 test: "toContainOrderedSubset returns
 * true for an in-order subset, false for out-of-order or missing
 * entries."
 *
 * These tests run under bun:test with NO happy-dom (see
 * `tests/in-app/bunfig.toml` — root-scoped, no preload). The matcher
 * is pure logic, so no DOM is needed.
 */

import { describe, expect, test } from "bun:test";
import { toContainOrderedSubset } from "./matchers";

describe("toContainOrderedSubset — pass cases", () => {
  test("exact-match single-entry trace", () => {
    const result = toContainOrderedSubset(
      [{ kind: "fr-flip", trigger: "activateCard", to: "c2" }],
      [{ kind: "fr-flip", trigger: "activateCard" }],
    );
    expect(result.pass).toBe(true);
  });

  test("in-order subset with intervening entries", () => {
    const trace = [
      { kind: "fr-flip", trigger: "activateCard", to: "c2" },
      { kind: "card-host-mount", cardId: "c2", hostStackId: "s1" },
      { kind: "destination-flip", cardId: "c2", from: false, to: true },
      { kind: "focusin", el: "input#c2" },
      { kind: "focus-call", cardId: "c2", site: "a3" },
    ];
    const result = toContainOrderedSubset(trace, [
      { kind: "fr-flip", trigger: "activateCard", to: "c2" },
      { kind: "destination-flip", cardId: "c2", to: true },
      { kind: "focus-call", cardId: "c2" },
    ]);
    expect(result.pass).toBe(true);
  });

  test("partial match: unspecified keys are wildcards", () => {
    const result = toContainOrderedSubset(
      [
        {
          kind: "fr-flip",
          from: "c1",
          to: "c2",
          trigger: "activateCard",
          timestamp: 123.456,
          seq: 42,
        },
      ],
      [{ kind: "fr-flip", to: "c2" }],
    );
    expect(result.pass).toBe(true);
  });

  test("partial match: loc field on actual does not constrain expected", () => {
    // Step 0a adds `loc` to DeckTraceEvent. The matcher must continue
    // to ignore fields the expected subset does not name; otherwise
    // every existing test that asserts trace shape without `loc`
    // would suddenly fail once the deck-trace module starts stamping
    // it.
    const result = toContainOrderedSubset(
      [
        {
          kind: "fr-flip",
          to: "c2",
          trigger: "activateCard",
          timestamp: 123.456,
          seq: 42,
          loc: "deck-manager.ts:189:3",
        },
      ],
      [{ kind: "fr-flip", to: "c2" }],
    );
    expect(result.pass).toBe(true);
  });

  test("partial match: explicit loc in expected does enforce the match", () => {
    // If a test wants to assert that a specific emission site fired
    // (e.g. `deck-manager.ts:189:3` vs `:234:5`), it can name `loc`
    // in the expected entry and the matcher enforces it like any
    // other field.
    const result = toContainOrderedSubset(
      [
        {
          kind: "fr-flip",
          to: "c2",
          loc: "deck-manager.ts:234:5",
        },
      ],
      [{ kind: "fr-flip", to: "c2", loc: "deck-manager.ts:189:3" }],
    );
    expect(result.pass).toBe(false);
  });

  test("empty expected subset trivially matches any trace", () => {
    const result = toContainOrderedSubset(
      [{ kind: "fr-flip", trigger: "x" }],
      [],
    );
    expect(result.pass).toBe(true);
  });

  test("nested object partial-match recurses", () => {
    const result = toContainOrderedSubset(
      [
        {
          kind: "a3-fire",
          cardId: "c1",
          target: { kind: "selector", selector: "[data-x=y]", cardId: "c1" },
        },
      ],
      [{ kind: "a3-fire", target: { kind: "selector" } }],
    );
    expect(result.pass).toBe(true);
  });

  test("array values deep-equal", () => {
    const result = toContainOrderedSubset(
      [{ kind: "selection-restore", anchorPath: [0, 1, 2] }],
      [{ kind: "selection-restore", anchorPath: [0, 1, 2] }],
    );
    expect(result.pass).toBe(true);
  });
});

describe("toContainOrderedSubset — fail cases", () => {
  test("missing entry returns false with informative message", () => {
    const result = toContainOrderedSubset(
      [{ kind: "fr-flip", trigger: "activateCard" }],
      [
        { kind: "fr-flip", trigger: "activateCard" },
        { kind: "focus-call", cardId: "c2" },
      ],
    );
    expect(result.pass).toBe(false);
    const msg = result.message();
    expect(msg).toContain("entry #1");
    expect(msg).toContain("focus-call");
  });

  test("out-of-order sequence returns false", () => {
    const trace = [
      { kind: "focus-call", cardId: "c2" },
      { kind: "fr-flip", trigger: "activateCard", to: "c2" },
    ];
    const result = toContainOrderedSubset(trace, [
      { kind: "fr-flip", trigger: "activateCard" },
      { kind: "focus-call", cardId: "c2" },
    ]);
    expect(result.pass).toBe(false);
  });

  test("value mismatch returns false", () => {
    const result = toContainOrderedSubset(
      [{ kind: "fr-flip", trigger: "activateCard", to: "c2" }],
      [{ kind: "fr-flip", trigger: "activateCard", to: "c3" }],
    );
    expect(result.pass).toBe(false);
  });

  test("nested object key mismatch returns false", () => {
    const result = toContainOrderedSubset(
      [{ kind: "a3-fire", target: { kind: "selector", selector: "x" } }],
      [{ kind: "a3-fire", target: { kind: "focus-key" } }],
    );
    expect(result.pass).toBe(false);
  });

  test("array element mismatch returns false", () => {
    const result = toContainOrderedSubset(
      [{ kind: "selection-restore", anchorPath: [0, 1, 2] }],
      [{ kind: "selection-restore", anchorPath: [0, 1, 3] }],
    );
    expect(result.pass).toBe(false);
  });

  test("actual is not an array returns false", () => {
    const result = toContainOrderedSubset(
      null,
      [{ kind: "fr-flip" }],
    );
    expect(result.pass).toBe(false);
    expect(result.message()).toContain("array of trace entries");
  });

  test("reuses actual entries across expected positions only monotonically", () => {
    // If the same entry appears twice in `expected`, we must find it
    // at two distinct indices in `actual` (strictly increasing).
    // Trace below has exactly one `fr-flip`, so asking for two must fail.
    const trace = [{ kind: "fr-flip", trigger: "x" }];
    const result = toContainOrderedSubset(trace, [
      { kind: "fr-flip" },
      { kind: "fr-flip" },
    ]);
    expect(result.pass).toBe(false);
  });

  test("explicit undefined requires actual undefined (not missing)", () => {
    // An explicit undefined in expected is NOT a wildcard — that way
    // tests can assert absence of a field by setting it to null.
    // Missing keys in expected are the wildcard form.
    const result = toContainOrderedSubset(
      [{ kind: "fr-flip", from: "c1", to: null }],
      [{ kind: "fr-flip", from: undefined }],
    );
    expect(result.pass).toBe(false);
  });
});
