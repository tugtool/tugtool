/**
 * m16-tab-close-handoff.test.ts — Closing the active tab hands focus to
 * its successor without saving the closed card's state (parent plan
 * #step-15, Phase 3 third test).
 *
 * Scenario (parent plan #phase-3-tests):
 *
 *   Seed a pane with three FC cards [c1, c2, c3], activate c2, click
 *   c2's close button. Verify c3 (the documented handoff target) becomes
 *   the deck's focused card. Verify via the trace that NO `save-callback`
 *   fired for the closed card (c2 is about to be destroyed; persisting
 *   its state is wasted work). Verify c3's caret lands at its declared
 *   `bag.focus` target via `expectCaret`.
 *
 * Probes
 * ------
 * Cards use `componentId: "gallery-input"`, which stamps
 * `data-tug-persist-value="gallery-input/size/sm"` on a persisted
 * `<TugInput>` — the same probe surface m01 and m03 use. Each closable
 * tab renders a close-button stamped `data-testid="tug-tab-close-${id}"`
 * (see `tugdeck/src/components/tugways/tug-tab-bar.tsx`). Clicking that
 * button dispatches `closeTab` through the pane controller, which is the
 * production close path.
 *
 * No-save assertion
 * -----------------
 * The plan's hard requirement is that `save-callback` for the closed
 * card (c2) must NOT appear between the close click and the resulting
 * `fr-flip` to c3. Positive trace assertions use the ordered-subset
 * matcher, but "did not happen" requires scanning the scoped trace
 * slice and asserting absence. We take a trace mark before the click,
 * pull the slice after the flip settles, and assert no entry has
 * `kind: "save-callback"` with `cardId: "c2"`.
 *
 * Handoff target
 * --------------
 * The plan specifies c3 as the handoff target. The production close
 * path (`dispatchCloseTab` in `tug-tab-bar.tsx` -> pane-controller
 * `closeTab`) picks the next tab after the closed index when the
 * closed card was active; for [c1, c2, c3] with c2 active, that is c3.
 *
 * Caret restore
 * -------------
 * Gallery-input cards' declared `bag.focus` target is the `sm` input's
 * start position (caret at offset 0 in an empty input). After handoff,
 * c3's `bag.focus` should place the caret at [0, 0] on the `sm` input.
 * `expectCaret` polls via `waitForCondition` so the restore path
 * settles inside the harness's structured timeout.
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
  type DeckTraceEvent,
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
 * disambiguates them even though all cards render the same persistKey
 * set. The `sm` variant is the first input in the gallery-input content
 * — the same target m01/m03 probe.
 */
const INPUT_PERSIST_KEY = "gallery-input/size/sm";

function inputSelectorFor(cardId: string): string {
  return `[data-card-id="${cardId}"] [data-tug-persist-value="${INPUT_PERSIST_KEY}"]`;
}

/**
 * Selector for a tab in the current pane's tab bar. `tug-tab-bar`
 * stamps `data-testid="tug-tab-${cardId}"` on each tab; this is the
 * canonical click target for tab-switch drivers.
 */
function tabSelectorFor(cardId: string): string {
  return `[data-testid="tug-tab-${cardId}"]`;
}

/**
 * Selector for a tab's close button. `tug-tab-bar` stamps
 * `data-testid="tug-tab-close-${cardId}"` on the × button rendered
 * when a tab is `closable: true`. Clicking this button dispatches
 * `closeTab` through the pane controller — the production close path.
 */
function tabCloseSelectorFor(cardId: string): string {
  return `[data-testid="tug-tab-close-${cardId}"]`;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe.skipIf(!SHOULD_RUN)("m16: closing active tab hands focus to successor without save", () => {
  test("seed [c1,c2,c3] active=c2, close c2, c3 focused, no save-callback for c2", async () => {
    // `app` is declared outside the try so the `catch` block can tail
    // the subprocess log before rethrowing.
    const app = await launchTugApp({ testName: "m16-tab-close-handoff" });
    try {
      // -----------------------------------------------------------------
      // Seed: one pane with three FC cards. `gallery-input` is the
      // gallery componentId that renders persisted TugInputs. `c2` is
      // the initially-active card so the close click targets an active
      // tab (the production handoff path). All three cards are
      // `closable: true` so the close-button renders.
      // -----------------------------------------------------------------
      await app.seedDeckState({
        state: {
          cards: [
            { id: "c1", componentId: "gallery-input", title: "Card c1", closable: true },
            { id: "c2", componentId: "gallery-input", title: "Card c2", closable: true },
            { id: "c3", componentId: "gallery-input", title: "Card c3", closable: true },
          ],
          panes: [
            {
              id: "p1",
              position: { x: 40, y: 40 },
              size: { width: 520, height: 360 },
              cardIds: ["c1", "c2", "c3"],
              activeCardId: "c2",
              title: "",
              acceptsFamilies: ["developer"],
            },
          ],
          activePaneId: "p1",
          hasFocus: true,
        },
        focusCardId: "c2",
      });

      // Mount may emit `card-host-mount` / `destination-flip` events on
      // the initial activation of c2; the successor (c3) does not mount
      // until the handoff runs, so only gate on c2's root here. The tabs
      // for c1/c2/c3 all live in the tab bar (not inside card hosts),
      // so they are click-targetable before the handoff.
      await app.waitForCondition<boolean>(
        `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("c2")`,
      );

      // Sanity: c2 is the deck's first-responder / focused card.
      await app.expectFocusedCard("c2");
      expect(await app.getActiveCardId()).toBe("c2");

      // -----------------------------------------------------------------
      // Gesture: click c2's close button. Take a trace mark first so the
      // ordered-subset and no-save assertions below scope to just the
      // close → handoff transition.
      // -----------------------------------------------------------------
      const markClose = await app.markDeckTrace();
      await app.click(tabCloseSelectorFor("c2"));

      // Waiting on `expectFocusedCard` rather than polling state reads
      // keeps the assertion inside the harness's structured timeout. c3
      // is the documented handoff target (next tab after the closed
      // index).
      await app.expectFocusedCard("c3");
      expect(await app.getActiveCardId()).toBe("c3");

      // c3 was not mounted before the close; wait for its host root to
      // register so the caret assertion below can read a real input
      // selection snapshot.
      await app.waitForCondition<boolean>(
        `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("c3")`,
      );

      // Core restore assertion: c3's caret should land at its declared
      // `bag.focus` target — the `sm` input start at offset 0 on an
      // empty input. `expectCaret` polls via `waitForCondition` so the
      // restore path (cold-boot-style `restoreCardDomSelection` /
      // `applyFocusSnapshot` sequencing) settles within the budget.
      const caretC3AfterHandoff: CaretState = {
        kind: "input",
        selectionStart: 0,
        selectionEnd: 0,
        selectionDirection: "none",
        value: "",
      };
      await app.expectCaret("c3", caretC3AfterHandoff);

      // -----------------------------------------------------------------
      // Trace assertions for the close → handoff transition.
      //
      // Positive: the composite first-responder bit must flip to c3,
      // c3 must become the destination, and a focus-call must land on
      // c3. Other events (focusout on c2's input, destination-flip on
      // c2→false, card-host-unmount for c2, card-host-mount for c3) may
      // interleave; the ordered-subset matcher is robust to that.
      // -----------------------------------------------------------------
      const traceClose = await app.getDeckTrace({ since: markClose });
      expect(traceClose).toContainOrderedSubset([
        { kind: "fr-flip", to: "c3" },
        { kind: "destination-flip", cardId: "c3", to: true },
        { kind: "focus-call", cardId: "c3" },
      ]);

      // Negative: NO `save-callback` event for the closed card (c2)
      // appeared in the close → handoff trace slice. c2 is about to be
      // destroyed; persisting its state is wasted work. This is the
      // plan's load-bearing contract for the tab-close handoff path —
      // if a save-callback fires here, a fix later in the M-series must
      // suppress it.
      const savesForClosedCard = traceClose.filter(
        (e: DeckTraceEvent) => e.kind === "save-callback" && e.cardId === "c2",
      );
      expect(savesForClosedCard).toEqual([]);
    } catch (err) {
      // On failure, dump the last 50 lines of the subprocess log to
      // stderr so CI output captures the same diagnostic tail that
      // List [#l03-lifecycle-behaviors] documents.
      const tail = app.tailLog(50);
      if (tail !== "") {
        process.stderr.write(`\n[m16-tab-close-handoff] tail of ${app.logPath}:\n${tail}\n`);
      }
      throw err;
    } finally {
      await app.close();
    }
  });
});

// Note: `tabSelectorFor` is exported-shaped but unused in this test —
// m16 exercises only the close-button click path, not tab selection.
// Retained for parity with m01/m03 helper shapes so future variants
// (e.g. "close the non-active tab" scenarios) can reuse the module.
void tabSelectorFor;
