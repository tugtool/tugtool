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

  test("partial match: store field on actual does not constrain expected", () => {
    // Step 0c adds `store` to DeckTraceEvent. Same semantics as `loc`:
    // if the expected subset does not name `store`, the matcher must
    // ignore it on the actual entry.
    const result = toContainOrderedSubset(
      [
        {
          kind: "destination-flip",
          cardId: "c2",
          from: false,
          to: true,
          timestamp: 1,
          seq: 1,
          loc: "deck-manager.ts:234:5",
          store: { activePaneId: "p1", activeCardId: "c1", hasFocus: true },
        },
      ],
      [{ kind: "destination-flip", cardId: "c2", to: true }],
    );
    expect(result.pass).toBe(true);
  });

  test("partial match: explicit store in expected does enforce the match", () => {
    // A test can assert the store snapshot exactly the same way
    // it can assert `loc` — useful for ordering diagnoses where
    // the question is "was activeCardId already c2 when this
    // event fired, or still c1?"
    const result = toContainOrderedSubset(
      [
        {
          kind: "destination-flip",
          cardId: "c2",
          to: true,
          store: { activePaneId: "p1", activeCardId: "c1", hasFocus: true },
        },
      ],
      [
        {
          kind: "destination-flip",
          cardId: "c2",
          store: { activeCardId: "c2" },
        },
      ],
    );
    expect(result.pass).toBe(false);
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

  test("out-of-order match emits Order violation annotation citing both indices", () => {
    // M01-shaped scenario: the trace contains destination-flip BEFORE
    // fr-flip, but the test expects fr-flip → destination-flip. The
    // annotation should call this out explicitly so the reader
    // doesn't have to eyeball the JSON to reach the same conclusion.
    const trace = [
      { kind: "destination-flip", cardId: "B", from: false, to: true }, // idx 0
      { kind: "card-host-mount", cardId: "B", hostStackId: "s1" },       // idx 1
      { kind: "fr-flip", from: "A", to: "B", trigger: "activateCard" },  // idx 2
      { kind: "focus-call", cardId: "B", site: "a3" },                   // idx 3
    ];
    const result = toContainOrderedSubset(trace, [
      { kind: "fr-flip", to: "B" },
      { kind: "destination-flip", cardId: "B", to: true },
      { kind: "focus-call", cardId: "B" },
    ]);
    expect(result.pass).toBe(false);
    const msg = result.message();
    // Annotation banner present
    expect(msg).toContain("Order violation");
    // Cites the earlier-index for the failing expected entry (destination-flip at 0)
    expect(msg).toContain("actual[0]");
    // Cites the prior match's index (fr-flip at 2)
    expect(msg).toContain("actual[2]");
    // Cites the expected entry labels (terse summary)
    expect(msg).toContain("destination-flip");
    expect(msg).toContain("fr-flip");
    // The annotation appears BEFORE the existing JSON dump
    expect(msg.indexOf("Order violation")).toBeLessThan(msg.indexOf("full trace:"));
  });

  test("genuinely-absent entry omits Order violation annotation", () => {
    // When the failed entry does not exist anywhere in the trace,
    // the existing diagnostic should be unchanged — no spurious
    // "Order violation" banner.
    const trace = [
      { kind: "fr-flip", to: "B" },
      { kind: "focus-call", cardId: "B" },
    ];
    const result = toContainOrderedSubset(trace, [
      { kind: "fr-flip", to: "B" },
      { kind: "save-callback", cardId: "A", source: "manual" },
    ]);
    expect(result.pass).toBe(false);
    const msg = result.message();
    expect(msg).not.toContain("Order violation");
    // The existing message format is preserved.
    expect(msg).toContain("entry #1");
    expect(msg).toContain("save-callback");
  });

  test("multiple earlier matches list all indices", () => {
    // If the failed entry appears multiple times in the earlier
    // section, the annotation should list all of them so the reader
    // can see where the duplicate emissions live.
    const trace = [
      { kind: "save-callback", cardId: "A", source: "debounced" }, // idx 0
      { kind: "save-callback", cardId: "A", source: "manual" },    // idx 1
      { kind: "fr-flip", to: "B" },                                // idx 2
    ];
    const result = toContainOrderedSubset(trace, [
      { kind: "fr-flip", to: "B" },
      { kind: "save-callback", cardId: "A" },
    ]);
    expect(result.pass).toBe(false);
    const msg = result.message();
    expect(msg).toContain("Order violation");
    expect(msg).toContain("actual[0, 1]");
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
