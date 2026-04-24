/**
 * m03-pane-activation.test.ts — Cross-pane activation via title-bar click
 * (parent plan #step-14, Phase 3 second test).
 *
 * Scenario (parent plan #phase-3-tests):
 *
 *   Seed two panes each with one FC card (A1 in p1, A2 in p2). Focus
 *   the form-control input inside A1 and type a short string so A1
 *   carries a non-trivial caret position. Click pane 2's title bar;
 *   the pane-focus-controller's capture-phase pointerdown handler
 *   classifies this as a Branch-A activation and calls
 *   `store.activateCard(A2)`. Verify A2 becomes the deck's focused
 *   card. Verify A1's state was saved between the click and the
 *   `fr-flip` (ordered-subset trace assertion). Click pane 1's title
 *   bar to return; verify A1's caret is restored at the typed offset.
 *
 * Probes
 * ------
 * Cards use `componentId: "gallery-input"`, which stamps
 * `data-tug-persist-value="gallery-input/size/sm"` on a persisted
 * `<TugInput>` — the same probe surface m01 uses. Each pane's root
 * element carries `data-pane-id={id}`, and the title text inside the
 * `CardTitleBar` stamps `data-testid="tug-pane-title"` (see
 * `tugdeck/src/components/chrome/tug-pane.tsx`). That span sits inside
 * the pane's `.tug-pane[data-pane-id]` frame, so clicks on it reach
 * `pane-focus-controller`'s document-level capture pointerdown —
 * exactly the production activation path.
 *
 * Save-callback source
 * --------------------
 * The plan phrases the save-callback assertion with `source: "..."`
 * because the production source tag for cross-pane activation is not
 * fixed by the plan (it might be `"manual"`, `"debounced"`, or a new
 * tag the M-series fix introduces). The ordered-subset matcher matches
 * on the fields we specify, so omitting `source` from the expected
 * entry accepts any source — that is the correct contract here.
 *
 * Gating
 * ------
 * The whole describe block is wrapped in `describe.skipIf(!SHOULD_RUN)`.
 * CI and local `bun x tsc --noEmit` runs without `TUGAPP_IN_APP_TEST=1`
 * skip every test, matching the README recipe (`tests/in-app/README.md`).
 */

import { describe, expect, test } from "bun:test";
import {
  launchTugApp,
  registerSubsetMatcher,
  type CaretState,
} from "./_harness";

// ---------------------------------------------------------------------------
// Matcher registration (once per module load)
// ---------------------------------------------------------------------------

// Enables `expect(trace).toContainOrderedSubset([...])` below. The
// pure-predicate form remains available on the named import for test
// authors who prefer not to extend `expect`.
registerSubsetMatcher();

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

// ---------------------------------------------------------------------------
// Seed fixtures
// ---------------------------------------------------------------------------

/**
 * Shared selector for the first-size (`sm`) TugInput inside a given
 * gallery-input card. Each seeded card lives under its own
 * `[data-card-id]` subtree, so qualifying the lookup by cardId
 * disambiguates them even though both cards render the same persistKey
 * set. The `sm` variant is the first input in the gallery-input content
 * — the same target m01 probes.
 */
const INPUT_PERSIST_KEY = "gallery-input/size/sm";

function inputSelectorFor(cardId: string): string {
  return `[data-card-id="${cardId}"] [data-tug-persist-value="${INPUT_PERSIST_KEY}"]`;
}

/**
 * Selector for a pane's title text. `CardTitleBar` stamps
 * `data-testid="tug-pane-title"` on the span that holds the pane's
 * title; the enclosing `.tug-pane` frame stamps `data-pane-id={id}`.
 * The combined selector picks out the title span of a specific pane,
 * which is the click target `pane-focus-controller`'s capture-phase
 * pointerdown listener classifies as an activation gesture.
 */
function paneTitleSelectorFor(paneId: string): string {
  return `[data-pane-id="${paneId}"] [data-testid="tug-pane-title"]`;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe.skipIf(!SHOULD_RUN)("m03: pane-chrome click activates other pane and saves outgoing card", () => {
  test("focus A1, click pane 2 title, A2 focused; click pane 1 title, A1's caret restored", async () => {
    // `app` is declared outside the try so the `catch` block can tail
    // the subprocess log before rethrowing.
    const app = await launchTugApp({ testName: "m03-pane-activation" });
    try {
      // -----------------------------------------------------------------
      // Seed: two panes, one card each. `gallery-input` is the gallery
      // componentId that renders persisted TugInputs; the two panes are
      // placed with non-overlapping positions so the title bars are both
      // hit-testable without one occluding the other.
      // -----------------------------------------------------------------
      await app.seedDeckState({
        state: {
          cards: [
            { id: "A1", componentId: "gallery-input", title: "Card A1", closable: true },
            { id: "A2", componentId: "gallery-input", title: "Card A2", closable: true },
          ],
          panes: [
            {
              id: "p1",
              position: { x: 40, y: 40 },
              size: { width: 420, height: 320 },
              cardIds: ["A1"],
              activeCardId: "A1",
              title: "",
              acceptsFamilies: ["developer"],
            },
            {
              id: "p2",
              position: { x: 520, y: 40 },
              size: { width: 420, height: 320 },
              cardIds: ["A2"],
              activeCardId: "A2",
              title: "",
              acceptsFamilies: ["developer"],
            },
          ],
          activePaneId: "p1",
          hasFocus: true,
        },
        focusCardId: "A1",
      });

      // Mount may emit `card-host-mount` / `destination-flip` events on
      // the initial activation of A1; wait until both host roots are
      // registered before driving gestures so our selectors resolve.
      await app.waitForCondition<boolean>(
        `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A1") && window.__tug.assertHostRootRegistered("A2")`,
      );

      // -----------------------------------------------------------------
      // Gesture 1: focus A1's input and type "hello" so A1 carries a
      // non-trivial caret position. The plan's final assertion — "A1's
      // caret restored at its saved offset" — requires a saved offset
      // distinct from 0 to be meaningful. Typing 5 chars gives us a
      // caret at offset 5 after insertion; the restore assertion below
      // checks that same offset lands back on the return trip.
      // -----------------------------------------------------------------
      await app.focusElement(inputSelectorFor("A1"));
      await app.type(inputSelectorFor("A1"), "hello");

      // Sanity: the input's persisted value reads back as "hello" and
      // the caret is at offset 5.
      expect(await app.getFormControlValue("A1", INPUT_PERSIST_KEY)).toBe("hello");
      const caretA1AfterType: CaretState = {
        kind: "input",
        selectionStart: 5,
        selectionEnd: 5,
        selectionDirection: "none",
        value: "hello",
      };
      await app.expectCaret("A1", caretA1AfterType);

      // Sanity: A1 is the deck's first-responder / focused card.
      await app.expectFocusedCard("A1");

      // -----------------------------------------------------------------
      // Gesture 2: click pane 2's title bar. Take a trace mark first so
      // the ordered-subset assertion below scopes to just the p1→p2
      // activation transition.
      // -----------------------------------------------------------------
      const markSwitchToP2 = await app.markDeckTrace();
      await app.click(paneTitleSelectorFor("p2"));

      // Waiting on `expectFocusedCard` rather than polling state reads
      // keeps the assertion inside the harness's structured timeout.
      await app.expectFocusedCard("A2");
      expect(await app.getActiveCardId()).toBe("A2");

      // Ordered-subsequence trace assertion for the p1→p2 transition.
      // Per parent plan #step-14 task list and #phase-3-tests: A1's
      // state must be saved (a `save-callback` with `cardId: "A1"`)
      // before the composite first-responder bit flips to A2. The
      // `source` tag is omitted from the expected entry so any source
      // tag matches — the contract is "a save happened," not "the save
      // happened with a specific tag." Other events (focusout, a3-fire,
      // destination-flip on A1→false) may appear between these; the
      // ordered-subset matcher is robust to interleaving.
      const traceSwitchToP2 = await app.getDeckTrace({ since: markSwitchToP2 });
      expect(traceSwitchToP2).toContainOrderedSubset([
        { kind: "save-callback", cardId: "A1" },
        { kind: "fr-flip", to: "A2" },
        { kind: "destination-flip", cardId: "A2", to: true },
        { kind: "focus-call", cardId: "A2" },
      ]);

      // -----------------------------------------------------------------
      // Gesture 3: click pane 1's title bar to return. Fresh mark for
      // the p2→p1 transition; the restore-caret assertion below is the
      // plan's core correctness check.
      // -----------------------------------------------------------------
      const markSwitchToP1 = await app.markDeckTrace();
      await app.click(paneTitleSelectorFor("p1"));

      await app.expectFocusedCard("A1");
      expect(await app.getActiveCardId()).toBe("A1");

      // Core restore assertion: A1's caret should land back at offset 5
      // (end of "hello"). `expectCaret` polls via `waitForCondition` so
      // restore paths that complete asynchronously (cold-boot-style
      // `restoreCardDomSelection` / `applyFocusSnapshot` sequencing)
      // settle within the budget.
      await app.expectCaret("A1", caretA1AfterType);
      expect(await app.getFormControlValue("A1", INPUT_PERSIST_KEY)).toBe("hello");

      // Ordered-subsequence trace assertion for the return trip: the
      // composite bit flips to A1, A1 becomes the destination, and a
      // focus-call on A1 lands. (No save-callback assertion here — the
      // plan only requires the save on the outgoing p1→p2 transition.)
      const traceSwitchToP1 = await app.getDeckTrace({ since: markSwitchToP1 });
      expect(traceSwitchToP1).toContainOrderedSubset([
        { kind: "fr-flip", to: "A1" },
        { kind: "destination-flip", cardId: "A1", to: true },
        { kind: "focus-call", cardId: "A1" },
      ]);
    } catch (err) {
      // On failure, dump the last 50 lines of the subprocess log to
      // stderr so CI output captures the same diagnostic tail that
      // List [#l03-lifecycle-behaviors] documents.
      const tail = app.tailLog(50);
      if (tail !== "") {
        process.stderr.write(`\n[m03-pane-activation] tail of ${app.logPath}:\n${tail}\n`);
      }
      throw err;
    } finally {
      await app.close();
    }
  });
});
