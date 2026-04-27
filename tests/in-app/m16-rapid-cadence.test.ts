/**
 * m16-rapid-cadence.test.ts — Three rapid back-to-back tab-close
 * handoffs preserve the same focus-handoff behavior as the slow-
 * cadence `m16-tab-close-handoff.test.ts`. Regression gate for the
 * [A3] sibling-effect ordering race; automation that
 * lifts from a manual ritual to
 * an automated check.
 *
 * Scenario
 * --------
 * Seed a pane with five FC cards [c1, c2, c3, c4, c5], active=c3.
 * Issue three back-to-back close-button clicks with NO inter-click
 * waits — close c3, then close c2, then close c1.
 *
 * Production handoff chain (`spliceCardFromStack` in
 * `tugdeck/src/deck-manager.ts`):
 *   1. Close c3 (index 2 > 0): active = post-splice cardIds[1] = c2.
 *      Remaining: [c1, c2, c4, c5].
 *   2. Close c2 (index 1 > 0): active = post-splice cardIds[0] = c1.
 *      Remaining: [c1, c4, c5].
 *   3. Close c1 (index 0, NOT > 0): active = post-splice cardIds[0]
 *      = c4. Remaining: [c4, c5].
 *
 * Assert the final state — c4 focused and active, only [c4, c5]
 * remain in the pane.
 *
 * Forward regression note
 * -----------------------
 * This was originally expected to fail on the [A3] race during the
 * rapid-handoff chain (each close → `_removeCard` →
 * `_flipFirstResponder` → useLayoutEffect on the new incoming card).
 * In practice it passes: each close commits inside the click handler
 * before the next click's pointerdown. DOM writes through React's
 * render cycle still violate [L22]; the effect may be retired as
 * cleanup later. This file locks in current behavior.
 *
 * Probes and gating mirror `m16-tab-close-handoff.test.ts`. Cards
 * use `gallery-input`; close-button selectors are
 * `data-testid="tug-tab-close-${cardId}"`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

function tabCloseSelectorFor(cardId: string): string {
  return `[data-testid="tug-tab-close-${cardId}"]`;
}

describe.skipIf(!SHOULD_RUN)(
  "m16-rapid-cadence: three back-to-back closes hand focus correctly",
  () => {
    test("seed [c1..c5] active=c3, close c3→c2→c1, c4 focused", async () => {
      const app = await launchTugApp({ testName: "m16-rapid-cadence" });
      try {
        await app.enableDeckTrace(true);

        await app.seedDeckState({
          state: {
            cards: [
              { id: "c1", componentId: "gallery-input", title: "Card c1", closable: true },
              { id: "c2", componentId: "gallery-input", title: "Card c2", closable: true },
              { id: "c3", componentId: "gallery-input", title: "Card c3", closable: true },
              { id: "c4", componentId: "gallery-input", title: "Card c4", closable: true },
              { id: "c5", componentId: "gallery-input", title: "Card c5", closable: true },
            ],
            panes: [
              {
                id: "p1",
                position: { x: 40, y: 40 },
                size: { width: 600, height: 360 },
                cardIds: ["c1", "c2", "c3", "c4", "c5"],
                activeCardId: "c3",
                title: "",
                acceptsFamilies: ["developer"],
              },
            ],
            activePaneId: "p1",
            hasFocus: true,
          },
          focusCardId: "c3",
        });

        // Only c3 is mounted at seed time (the others are inactive
        // tabs rendered with `display: none`); their tab-bar buttons
        // are click-targetable because the tab bar lives in pane
        // chrome, not inside card hosts.
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("c3")`,
        );

        await app.expectFocusedCard("c3");
        expect(await app.getActiveCardId()).toBe("c3");

        // Rapid three-click sequence on close buttons:
        // close c3 → close c2 → close c1. No mid-flight
        // `expectFocusedCard` polls; the only awaits are RPC
        // round-trips inside `nativeClickAtElement`. Wall time
        // between clicks is well under the <100ms gate.
        await app.nativeClickAtElement(tabCloseSelectorFor("c3"));
        await app.nativeClickAtElement(tabCloseSelectorFor("c2"));
        await app.nativeClickAtElement(tabCloseSelectorFor("c1"));

        // Final state per `spliceCardFromStack` chain documented at
        // the top of this file: c4 focused. The handoff-to-c4
        // assertion is the regression gate — the sibling-effect race
        // surfaces here as either focused-card
        // ≠ c4 or focused-card === c4 but `document.activeElement`
        // is on `body` (no caret).
        await app.expectFocusedCard("c4");
        expect(await app.getActiveCardId()).toBe("c4");

        // Bonus: confirm the closed cards' tabs are gone from the
        // DOM. Each closable tab stamps a `tug-tab-close-${cardId}`
        // close button; a stale tab would still match. We probe via
        // `evalJS` because the harness has no direct store reader.
        const remainingCloseButtons = await app.evalJS<string[]>(
          `Array.from(document.querySelectorAll('[data-pane-id="p1"] [data-testid^="tug-tab-close-"]'))
              .map(el => el.getAttribute('data-testid'))
              .filter(s => s !== null)`,
        );
        expect(remainingCloseButtons).toEqual([
          "tug-tab-close-c4",
          "tug-tab-close-c5",
        ]);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(
            `\n[m16-rapid-cadence] Tug.app log tail (last 200 lines):\n${tail}\n`,
          );
        }
        const tracePath = await app.dumpTraceToFile(
          "logs/m16-rapid-cadence-trace.json",
        );
        if (tracePath !== null) {
          process.stderr.write(`[m16-rapid-cadence] trace dumped to ${tracePath}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    });
  },
);
