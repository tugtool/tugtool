/**
 * m01-rapid-cadence.test.ts — Three rapid back-to-back tab switches
 * preserve the same caret-restore behavior as the slow-cadence
 * `m01-tab-switch-fc.test.ts`. Regression gate for the [A3]
 * sibling-effect ordering race that selection plan
 * #step-23-execution-strategy Pass 2 lifts from a manual ritual to
 * an automated check (#step-23b checkpoint).
 *
 * Scenario
 * --------
 * Seed a pane with two FC cards [A, B], active=A. Click into A's
 * input and type "alpha". Then issue four back-to-back tab clicks
 * with NO inter-click waits — B → A → B → A — and assert the final
 * state: A focused, caret at offset 5, value still "alpha".
 *
 * Forward regression gate (pre-Step-23B baseline)
 * -----------------------------------------------
 * Plan Pass 2 was authored expecting this test to fail today
 * against the current [A3] `useLayoutEffect` in `CardHost`
 * (sibling-effect ordering race between two card-host instances
 * inside React's commit cycle). In practice it passes
 * deterministically — Step 3b's `pane-focus-controller` mousedown
 * preventDefault appears to have already closed the user-visible
 * symptom: WebKit no longer blurs focus during pane-chrome / tab
 * clicks, so the [A3] restore lands on a stable target. The
 * architectural problem remains — DOM writes routed through
 * React's render cycle violate [L22] — and Step 23B still retires
 * the React effect on those grounds, but as cleanup, not a bug
 * fix. This file locks in current passing behavior so the helper
 * migration cannot reintroduce a regression at this cadence.
 *
 * Probes and gating mirror `m01-tab-switch-fc.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type CaretState } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

const INPUT_PERSIST_KEY = "gallery-input/size/sm";

function inputSelectorFor(cardId: string): string {
  return `[data-card-id="${cardId}"] [data-tug-persist-value="${INPUT_PERSIST_KEY}"]`;
}

function tabSelectorFor(cardId: string): string {
  return `[data-testid="tug-tab-${cardId}"]`;
}

describe.skipIf(!SHOULD_RUN)(
  "m01-rapid-cadence: four back-to-back tab clicks preserve caret",
  () => {
    test("type 'alpha' in A, rapid B→A→B→A, A focused with caret at 5", async () => {
      const app = await launchTugApp({ testName: "m01-rapid-cadence" });
      try {
        await app.enableDeckTrace(true);

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

        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
        );

        // Setup: focus A's input and type so A carries a non-trivial
        // caret position. The restore assertion at the end is only
        // meaningful with a non-zero offset.
        await app.nativeClickAtElement(inputSelectorFor("A"));
        await app.waitForCondition<boolean>(
          `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(inputSelectorFor("A"))})`,
        );
        await app.type(inputSelectorFor("A"), "alpha");
        expect(await app.getFormControlValue("A", INPUT_PERSIST_KEY)).toBe("alpha");

        // Rapid four-click sequence: B → A → B → A. Inter-click wall
        // time is dominated by the RPC round-trip
        // (centerOfElement + nativeClick), well under the
        // plan's <100ms gate. No `expectFocusedCard` /
        // `getActiveCardId` polls between clicks — those would let
        // each transition settle and defeat the cadence. After
        // Step 23B, settling is synchronous inside the gesture
        // handler, so polls between clicks are not load-bearing
        // anyway; this version just asserts that.
        await app.nativeClickAtElement(tabSelectorFor("B"));
        await app.nativeClickAtElement(tabSelectorFor("A"));
        await app.nativeClickAtElement(tabSelectorFor("B"));
        await app.nativeClickAtElement(tabSelectorFor("A"));

        // Settle once at the end. After Step 23B this poll is a
        // no-op (the last gesture's handler already committed
        // before the RPC returned); pre-Step-23B it gives React
        // a chance to flush whichever effect order it chose.
        await app.expectFocusedCard("A");
        expect(await app.getActiveCardId()).toBe("A");

        // The regression gate: caret restored to offset 5 of "alpha".
        const caretAExpected: CaretState = {
          kind: "input",
          selectionStart: 5,
          selectionEnd: 5,
          selectionDirection: "none",
          value: "alpha",
        };
        await app.expectCaret("A", caretAExpected);
        expect(await app.getFormControlValue("A", INPUT_PERSIST_KEY)).toBe("alpha");
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(
            `\n[m01-rapid-cadence] Tug.app log tail (last 200 lines):\n${tail}\n`,
          );
        }
        const tracePath = await app.dumpTraceToFile(
          "logs/m01-rapid-cadence-trace.json",
        );
        if (tracePath !== null) {
          process.stderr.write(`[m01-rapid-cadence] trace dumped to ${tracePath}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    });
  },
);
