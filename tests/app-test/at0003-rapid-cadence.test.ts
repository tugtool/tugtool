/**
 * at0003-rapid-cadence.test.ts — Three rapid back-to-back pane-chrome
 * clicks preserve the same caret-restore behavior as the slow-cadence
 * `at0003-pane-activation.test.ts`. Regression gate for the [A3]
 * sibling-effect ordering race (behavior previously checked manually,
 * now covered by this test).
 *
 * Scenario
 * --------
 * Seed two panes, one FC card each (A1 in p1, A2 in p2). Click into
 * A1's input and type "hello". Then issue four back-to-back pane-
 * title clicks with NO inter-click waits — p2 → p1 → p2 → p1 — and
 * assert the final state: A1 focused, caret at offset 5, value still
 * "hello".
 *
 * Forward regression note
 * -----------------------
 * This was originally expected to fail on the [A3] race (cross-
 * pane activation: every trusted click on pane chrome triggers
 * `store.activateCard`, scheduling a fresh React commit). In practice
 * it passes across four back-to-back pane-title clicks:
 * `pane-focus-controller` mousedown `preventDefault` closed the
 * user-visible symptom, so the [A3] restore lands on a stable target. The
 * architectural problem remains — DOM writes through React's render
 * cycle violate [L22] — and the effect may still be retired as
 * cleanup. This file locks in current behavior.
 *
 * Probes and gating mirror `at0003-pane-activation.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type CaretState } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const INPUT_PERSIST_KEY = "gallery-input/size/sm";

function inputSelectorFor(cardId: string): string {
  return `[data-card-id="${cardId}"] [data-tug-state-key="${INPUT_PERSIST_KEY}"]`;
}

function paneTitleSelectorFor(paneId: string): string {
  return `[data-pane-id="${paneId}"] [data-testid="tug-pane-title"]`;
}

describe.skipIf(!SHOULD_RUN)(
  "at0003-rapid-cadence: four back-to-back pane-title clicks preserve caret",
  () => {
    test("type 'hello' in A1, rapid p2→p1→p2→p1, A1 focused with caret at 5", async () => {
      const app = await launchTugApp({ testName: "at0003-rapid-cadence" });
      try {
        await app.enableDeckTrace(true);

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

        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A1") && window.__tug.assertHostRootRegistered("A2")`,
        );

        // Setup: focus A1's input and type so A1 carries a non-trivial
        // caret position. The restore assertion at the end is only
        // meaningful with a non-zero offset.
        await app.nativeClickAtElement(inputSelectorFor("A1"));
        await app.waitForCondition<boolean>(
          `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(inputSelectorFor("A1"))})`,
        );
        await app.type(inputSelectorFor("A1"), "hello");
        expect(await app.getFormControlValue("A1", INPUT_PERSIST_KEY)).toBe("hello");
        await app.expectFocusedCard("A1");

        // Rapid four-click sequence on pane title bars:
        // p2 → p1 → p2 → p1. No mid-flight `expectFocusedCard` /
        // `getActiveCardId` polls; the only awaits are the RPC
        // round-trips inside `nativeClickAtElement`. Wall time
        // between clicks is well under the plan's <100ms gate.
        await app.nativeClickAtElement(paneTitleSelectorFor("p2"));
        await app.nativeClickAtElement(paneTitleSelectorFor("p1"));
        await app.nativeClickAtElement(paneTitleSelectorFor("p2"));
        await app.nativeClickAtElement(paneTitleSelectorFor("p1"));

        // Settle once at the end: gives React a chance to finish the
        // sibling-effect order before assertions.
        await app.expectFocusedCard("A1");
        expect(await app.getActiveCardId()).toBe("A1");

        // The regression gate: A1's caret restored to offset 5 of
        // "hello". This is the assertion that fails today
        // (sibling-effect race causes restore to abort or be
        // immediately blurred by WebKit's mousedown default — the
        // same family of bug the slow-cadence test covers).
        const caretA1Expected: CaretState = {
          kind: "input",
          selectionStart: 5,
          selectionEnd: 5,
          selectionDirection: "none",
          value: "hello",
        };
        await app.expectCaret("A1", caretA1Expected);
        expect(await app.getFormControlValue("A1", INPUT_PERSIST_KEY)).toBe("hello");
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(
            `\n[at0003-rapid-cadence] Tug.app log tail (last 200 lines):\n${tail}\n`,
          );
        }
        const tracePath = await app.dumpTraceToFile(
          "logs/at0003-rapid-cadence-trace.json",
        );
        if (tracePath !== null) {
          process.stderr.write(`[at0003-rapid-cadence] trace dumped to ${tracePath}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    });
  },
);
