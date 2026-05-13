/**
 * at0072-content-owning-focus-survives-card-switch.test.ts — find
 * input focus survives a card-switch round-trip for a content-owning
 * card.
 *
 * ## What this pins
 *
 * Two content-owning cards in the same pane. The user opens the find
 * row on Card A, types a query, switches to Card B, then switches
 * back. Phase E.10's `bag.focus` axis must capture A's `dom`-kind
 * snapshot when A is deactivated AND `resolveActivationTarget` must
 * resolve it back to the same element when A is reactivated — the
 * cross-card preservation case the framework axis is meant to cover.
 *
 * The card-switch path differs from app-switch (AT0071) in the entry
 * vector: instead of `simulateAppResign / simulateAppBecomeActive`,
 * the test calls `selectCard("B")` and then `selectCard("A")`.
 * Internally those route through `transferFocusForActivation` →
 * `resolveActivationTarget`, the same resolver function tested by
 * AT0071's `simulateAppBecomeActive`. Two activation vectors, one
 * resolver — both should resolve to the same focus-element branch.
 *
 * ## Why two distinct cards
 *
 * If the same card were re-selected, the activation would short-
 * circuit (no actual switch). Selecting B in between forces a real
 * deactivate-A → activate-B → deactivate-B → activate-A cycle, which
 * is the path that actually flushes A's save and walks the resolver
 * on the way back in.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 60_000;

const FIXTURE_COMPONENT_ID = "gallery-file-block-find-fixture";
const PRESERVATION_KEY = "file-block-find-fixture";
const FOCUS_KEY = `file-block-find/${PRESERVATION_KEY}`;

function cardSelector(cardId: string): string {
  return `[data-card-id="${cardId}"]`;
}

function tabSelectorFor(cardId: string): string {
  // `tug-tab-bar` stamps `data-testid="tug-tab-${cardId}"` on each tab.
  return `[data-testid="tug-tab-${cardId}"]`;
}

function searchTriggerSelector(cardId: string): string {
  return `${cardSelector(cardId)} [data-slot="file-search"]`;
}

function findInputSelector(cardId: string): string {
  return `${cardSelector(cardId)} [data-slot="tug-input"][data-tug-focus-key="${FOCUS_KEY}"]`;
}

describe.skipIf(!SHOULD_RUN)(
  "AT0072: content-owning card find input survives card-switch via bag.focus",
  () => {
    test(
      "switch A → B → A preserves focus on Card A's FileBlock find input",
      async () => {
        const app = await launchTugApp({
          testName: "at0072-content-owning-focus-survives-card-switch",
        });
        try {
          await app.enableDeckTrace(true);

          await app.seedDeckState({
            state: {
              cards: [
                {
                  id: "A",
                  componentId: FIXTURE_COMPONENT_ID,
                  title: "FileBlock Find A",
                  closable: true,
                },
                {
                  id: "B",
                  componentId: FIXTURE_COMPONENT_ID,
                  title: "FileBlock Find B",
                  closable: true,
                },
              ],
              panes: [
                {
                  id: "p1",
                  position: { x: 40, y: 40 },
                  size: { width: 720, height: 540 },
                  cardIds: ["A", "B"],
                  activeCardId: "A",
                  title: "",
                  acceptsFamilies: ["developer"],
                },
              ],
              activePaneId: "p1",
              hasFocus: true,
            },
            cardStates: {
              A: { content: { marker: "at0072-card-A" } },
              B: { content: { marker: "at0072-card-B" } },
            },
            focusCardId: "A",
          });

          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
          );

          // Phase 1: open find on A and type a query.
          await app.nativeClickAtElement(searchTriggerSelector("A"));
          await app.waitForCondition<boolean>(
            `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(
              findInputSelector("A"),
            )})`,
            { timeoutMs: 2000 },
          );
          await app.nativeType("lorem");
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(findInputSelector("A"))});
              return el !== null && el.value === "lorem";
            })()`,
            { timeoutMs: 2000 },
          );

          // Phase 2: switch to Card B by clicking its tab.
          // Deactivating A triggers the SAVE site to capture
          // `bag.focus` for A as `dom`-kind.
          await app.nativeClickAtElement(tabSelectorFor("B"));
          await app.expectFocusedCard("B");
          expect(await app.getActiveCardId()).toBe("B");

          // Read A's saved bag.focus to pin the captured shape.
          const aBag = await app.evalJS<{
            focus?: { kind: string; focusKey?: string };
          } | null>(`window.__tug.getCardStateBag("A")`);
          expect(aBag).not.toBeNull();
          expect(aBag!.focus).toBeDefined();
          expect(aBag!.focus!.kind).toBe("dom");
          expect(aBag!.focus!.focusKey).toBe(FOCUS_KEY);

          // Phase 3: switch back to A. Activation routes through
          // `resolveActivationTarget`, which sees A's
          // `bag.focus.kind === "dom"` and resolves the keyed
          // element. Focus should land on the find input.
          await app.nativeClickAtElement(tabSelectorFor("A"));
          await app.expectFocusedCard("A");
          expect(await app.getActiveCardId()).toBe("A");

          await app.waitForCondition<boolean>(
            `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(
              findInputSelector("A"),
            )})`,
            { timeoutMs: 2000 },
          );

          // The row's React state (query string) survives because
          // the find row component is conditionally mounted on
          // `session.state.open` — and `useBlockFindSession` saves
          // it through `useComponentStatePreservation`. Verify the
          // query is preserved.
          const queryAfterSwitch = await app.evalJS<string | null>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(findInputSelector("A"))});
              return el ? el.value : null;
            })()`,
          );
          expect(queryAfterSwitch).toBe("lorem");
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0072-content-owning-focus-survives-card-switch] log tail:\n${tail}\n`,
            );
          }
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
