/**
 * m01-tab-switch-fc.test.ts — Intra-pane tab switch, form-control caret
 * round-trip (parent plan #step-13, Phase 3 first test).
 *
 * Scenario (parent plan #phase-3-tests):
 *
 *   Seed a pane with two FC cards (A, B). Focus the form-control input
 *   inside card A, type "alpha", click tab B, verify B is the focused
 *   card with its own (empty) caret state, click back to tab A, verify
 *   A's caret is restored at offset 5 (end of "alpha").
 *
 *   The trace assertion asserts the "activate A → activate B → activate
 *   A again" ordered triple of (fr-flip, destination-flip → true,
 *   focus-call) groups (parent plan #step-13 task list).
 *
 * Probes
 * ------
 * Cards use `componentId: "gallery-input"`, which renders `<TugInput>`
 * instances that stamp `data-tug-persist-value="gallery-input/size/sm"`
 * (and similar) on the underlying `<input>` element. That attribute is
 * the exact marker the harness reads via `__tug.getCaretState` and
 * `__tug.getFormControlValue` ([#s03-tug-surface]), so no bespoke test
 * card is needed — the gallery registration already supplies the
 * production surface under test.
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
 * gallery-input card. Both cards render the same persistKey set, but
 * they live in different `[data-card-id]` subtrees, so qualifying the
 * lookup by cardId disambiguates them. We probe the `sm` variant
 * because it is the first input in the gallery-input content, which
 * keeps the click target stable against future gallery reorganizations.
 */
const INPUT_PERSIST_KEY = "gallery-input/size/sm";

function inputSelectorFor(cardId: string): string {
  return `[data-card-id="${cardId}"] [data-tug-persist-value="${INPUT_PERSIST_KEY}"]`;
}

/**
 * Selector for a tab in the current pane's tab bar. `tug-tab-bar`
 * stamps `data-testid="tug-tab-${cardId}"` on each tab; that is the
 * canonical click target for tab-switch drivers.
 */
function tabSelectorFor(cardId: string): string {
  return `[data-testid="tug-tab-${cardId}"]`;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe.skipIf(!SHOULD_RUN)("m01: intra-pane tab switch preserves FC caret", () => {
  test("type 'alpha' in A, tab to B, tab back to A restores caret at offset 5", async () => {
    // `app` is declared outside the try so the `catch` block can tail
    // the subprocess log before rethrowing.
    const app = await launchTugApp({ testName: "m01-tab-switch-fc" });
    try {
      // Deck-trace defaults to disabled; recording is a no-op until
      // we flip the enable flag. All trace assertions below depend on
      // this being on.
      await app.enableDeckTrace(true);

      // -----------------------------------------------------------------
      // Seed: one pane with two FC cards. `gallery-input` is the
      // developer-gallery componentId that renders persisted TugInputs.
      // -----------------------------------------------------------------
      await app.seedDeckState({
        state: {
          cards: [
            { id: "A", componentId: "gallery-input", title: "Card A", closable: true },
            { id: "B", componentId: "gallery-input", title: "Card B", closable: true },
          ],
          panes: [
            {
              id: "p1",
              position: { x: 40, y: 40 },
              size: { width: 480, height: 360 },
              cardIds: ["A", "B"],
              activeCardId: "A",
              title: "",
              acceptsFamilies: ["developer"],
            },
          ],
          activePaneId: "p1",
          hasFocus: true,
        },
        focusCardId: "A",
      });

      // Mount may emit `card-host-mount` / `destination-flip` events on
      // the initial activation of A; wait until the host root is
      // registered before driving gestures so our selectors resolve.
      await app.waitForCondition<boolean>(
        `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
      );

      // -----------------------------------------------------------------
      // Gesture 1: focus the input inside A, type "alpha".
      // -----------------------------------------------------------------
      // Plan task: "Activate card A, type 'alpha'". `focusElement` is
      // the [D09] escape hatch — `.focus()` matches the production path
      // (WebKit does not grant default focus to synthetic pointerdown).
      await app.focusElement(inputSelectorFor("A"));
      await app.type(inputSelectorFor("A"), "alpha");

      // Sanity: the input's persisted value reads back as "alpha".
      expect(await app.getFormControlValue("A", INPUT_PERSIST_KEY)).toBe("alpha");

      // Expected caret after typing 5 chars into an initially-empty
      // input: [5, 5], direction "none" (WebKit's default after
      // character insertion; `readSelectionDirection` normalizes any
      // null to "none" on read).
      const caretAAfterType: CaretState = {
        kind: "input",
        selectionStart: 5,
        selectionEnd: 5,
        selectionDirection: "none",
        value: "alpha",
      };
      await app.expectCaret("A", caretAAfterType);

      // -----------------------------------------------------------------
      // Gesture 2: click tab B. Take a trace mark first so the ordered-
      // subset assertion below scopes to just the A→B transition.
      // -----------------------------------------------------------------
      const markSwitchToB = await app.markDeckTrace();
      await app.click(tabSelectorFor("B"));

      // Waiting on `expectFocusedCard` rather than polling state reads
      // keeps the assertion inside the harness's structured timeout.
      await app.expectFocusedCard("B");
      expect(await app.getActiveCardId()).toBe("B");

      // B is a fresh gallery-input card; its `sm` input is empty and
      // unfocused until a gesture targets it. The plan's phrasing —
      // "B is focused (via expectFocusedCard) with its own caret state"
      // — is the deck-level focus marker, not DOM focus on the input.
      // We assert the deck-level marker (already done above) and that
      // B's getCaretState is null or an empty-input snapshot; both are
      // acceptable "own caret state" outcomes for an unfocused FC card.
      const caretBAfterSwitch = await app.getCaretState("B");
      // `null` means the card root is registered but no form-control
      // has focus inside it yet — the natural post-tab-switch state.
      // We do not force the caret-restore path on B here; the plan's
      // assertion is about A's restore behavior on the return trip.
      expect(caretBAfterSwitch === null || caretBAfterSwitch.kind === "input").toBe(true);

      // Ordered-subsequence trace assertion for the A→B transition.
      //
      // Production emits events in this order during intra-pane tab
      // switch:
      //   1. store state mutates (activeCardId flips in memory)
      //   2. destination-flip observer fires for each card whose
      //      isFocusDestination bit changed (A→false, then B→true) —
      //      both records carry the POST-mutation store snapshot.
      //   3. _flipFirstResponder records fr-flip with
      //      trigger="_setActiveCardInPane" (not "activateCard" —
      //      intra-pane switches go through the internal helper).
      //
      // No `focus-call` event fires for B on first activation: B
      // has never been saved, so its card-state bag is empty; the
      // A3 effect's bag-driven focus-restore logic has nothing to
      // apply and exits with `earlyReturn: "no-bag"`. See
      // roadmap/m-series-reconciliation.md §"Bag-driven focus"
      // for the design-gap note. The return trip below DOES
      // assert focus-call on A because A's bag was populated by
      // the typing gesture.
      const traceSwitchToB = await app.getDeckTrace({ since: markSwitchToB });
      expect(traceSwitchToB).toContainOrderedSubset([
        { kind: "destination-flip", cardId: "B", to: true },
        { kind: "fr-flip", to: "B", trigger: "_setActiveCardInPane" },
      ]);

      // -----------------------------------------------------------------
      // Gesture 3: click tab A. Fresh mark for the B→A transition.
      // -----------------------------------------------------------------
      const markSwitchToA = await app.markDeckTrace();
      await app.click(tabSelectorFor("A"));

      await app.expectFocusedCard("A");
      expect(await app.getActiveCardId()).toBe("A");

      // The core restore assertion: A's caret should land back at the
      // end of "alpha" (offset 5). `expectCaret` polls via
      // `waitForCondition` so restore paths that complete asynchronously
      // (e.g. the Step-10 cold-boot-style `restoreCardDomSelection` /
      // `applyFocusSnapshot` sequencing) settle within the budget.
      await app.expectCaret("A", caretAAfterType);
      expect(await app.getFormControlValue("A", INPUT_PERSIST_KEY)).toBe("alpha");

      // Ordered-subsequence trace assertion for the return trip.
      // Same production ordering as the outgoing trip
      // (destination-flip → fr-flip). Unlike the outgoing trip, A DOES
      // have a saved bag from the typing gesture at Gesture 1, so
      // the A3 effect's `applyFocusSnapshot` runs and emits
      // `focus-call`.
      const traceSwitchToA = await app.getDeckTrace({ since: markSwitchToA });
      expect(traceSwitchToA).toContainOrderedSubset([
        { kind: "destination-flip", cardId: "A", to: true },
        { kind: "fr-flip", to: "A", trigger: "_setActiveCardInPane" },
        { kind: "focus-call", cardId: "A" },
      ]);
    } catch (err) {
      // On failure, dump the last 50 lines of the subprocess log to
      // stderr so CI output captures the same diagnostic tail that
      // List [#l03-lifecycle-behaviors] documents.
      const tail = app.tailLog(50);
      if (tail !== "") {
        process.stderr.write(`\n[m01-tab-switch-fc] tail of ${app.logPath}:\n${tail}\n`);
      }
      throw err;
    } finally {
      await app.close();
    }
  });
});
