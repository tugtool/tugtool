/**
 * at0071-content-owning-focus-survives-app-switch.test.ts — find input
 * focus survives the cmd-tab away + back round-trip for a
 * content-owning card.
 *
 * ## What this pins
 *
 * Phase E.10 lifted the `bag.focus` axis to capture / restore `dom`
 * and `form-control` focus targets for content-owning cards. AT0071
 * is the canonical app-switch case:
 *
 *   1. Seed a content-owning card hosting a `FileBlock` with a stable
 *      `componentStatePreservationKey`. (The card factory itself is
 *      DOM-authority; the test seeds `bag.content` to flip
 *      `isContentOwning` in `focus-transfer.ts`.)
 *   2. Click the Search affordance to open the find row; focus lands
 *      on the find input (the hook's first-open useLayoutEffect).
 *   3. Type a query so the row has user state worth preserving.
 *   4. `simulateAppResign` → save fires → assert `bag.focus.kind` is
 *      `"dom"` and `bag.focus.focusKey` is the composed key
 *      `"file-block-find/<componentStatePreservationKey>"`.
 *   5. `simulateAppBecomeActive` → resolver branch (the new
 *      precondition above the engine-managed branch) resolves the
 *      focus-key against the card root and calls `.focus()` on the
 *      live input. Assert `document.activeElement` is the find input.
 *
 * ## Why the find input is the fixture
 *
 * The find input is the simplest convenient `[data-tug-focus-key]`
 * target inside a content-owning card. The contract being tested is
 * general — any focusable element in a content-owning card that
 * stamps a focus key should survive activation paths. Future widgets
 * (inline parameter editor, question widget) follow the same playbook
 * without re-testing the framework axis.
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

function searchTriggerSelector(cardId: string): string {
  return `${cardSelector(cardId)} [data-slot="file-search"]`;
}

function findInputSelector(cardId: string): string {
  return `${cardSelector(cardId)} [data-slot="tug-input"][data-tug-focus-key="${FOCUS_KEY}"]`;
}

describe.skipIf(!SHOULD_RUN)(
  "AT0071: content-owning card find input survives app-switch via bag.focus",
  () => {
    test(
      "cmd-tab away + back preserves focus on the FileBlock find input",
      async () => {
        const app = await launchTugApp({
          testName: "at0071-content-owning-focus-survives-app-switch",
        });
        try {
          await app.enableDeckTrace(true);

          // Seed a card with `bag.content` populated so
          // `isContentOwning` flips true in focus-transfer.ts. The
          // factory ignores the seeded value; we just need the
          // classification.
          await app.seedDeckState({
            state: {
              cards: [
                {
                  id: "A",
                  componentId: FIXTURE_COMPONENT_ID,
                  title: "FileBlock Find",
                  closable: true,
                },
              ],
              panes: [
                {
                  id: "p1",
                  position: { x: 40, y: 40 },
                  size: { width: 720, height: 540 },
                  cardIds: ["A"],
                  activeCardId: "A",
                  title: "",
                  acceptsFamilies: ["developer"],
                },
              ],
              activePaneId: "p1",
              hasFocus: true,
            },
            cardStates: {
              A: { content: { marker: "at0071-content-owning" } },
            },
            focusCardId: "A",
          });

          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );

          // Open the find row via a click on the Search affordance.
          // The hook's useLayoutEffect lands focus on the input
          // synchronously with the open commit.
          await app.nativeClickAtElement(searchTriggerSelector("A"));
          await app.waitForCondition<boolean>(
            `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(
              findInputSelector("A"),
            )})`,
            { timeoutMs: 2000 },
          );

          // Type a short query so the saved state has something
          // worth preserving across the round-trip.
          await app.nativeType("lorem");
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(findInputSelector("A"))});
              return el !== null && el.value === "lorem";
            })()`,
            { timeoutMs: 2000 },
          );

          // Trigger save via window-blur (the standard
          // simulateAppResign path). Wait for the deck trace's
          // save-callback marker to confirm the save flushed.
          const markBeforeResign = await app.markDeckTrace();
          await app.simulateAppResign();
          await app.waitForCondition<boolean>(
            `(function(){
              var t = window.__tug.getDeckTrace({since: ${markBeforeResign}});
              for (var i = 0; i < t.length; i++) {
                if (t[i].kind === "save-callback" && t[i].source === "window-blur" && t[i].cardId === "A") return true;
              }
              return false;
            })()`,
            { timeoutMs: 2000 },
          );

          // Pin the captured shape: `bag.focus.kind === "dom"` and
          // `focusKey` is the composed `<scope>/<key>` value. This
          // is the Phase E.10 contract — the SAVE site captures
          // `dom` / `form-control` kinds for content-owning cards.
          const bag = await app.evalJS<{
            focus?: { kind: string; focusKey?: string };
          } | null>(`window.__tug.getCardStateBag("A")`);
          expect(bag).not.toBeNull();
          expect(bag!.focus).toBeDefined();
          expect(bag!.focus!.kind).toBe("dom");
          expect(bag!.focus!.focusKey).toBe(FOCUS_KEY);

          // Brief blur dwell mirroring sibling tests (at0035-tide).
          await new Promise<void>((resolve) =>
            (
              globalThis as unknown as {
                setTimeout: (fn: () => void, ms: number) => unknown;
              }
            ).setTimeout(() => resolve(), 300),
          );

          await app.simulateAppBecomeActive();

          // resolveActivationTarget's new precondition: with
          // `bag.focus.kind === "dom"` and the keyed element in the
          // card host, resolve to the element directly (before the
          // engine-managed / dispatch-activated fallback). Assert
          // focus is back on the input.
          await app.waitForCondition<boolean>(
            `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(
              findInputSelector("A"),
            )})`,
            { timeoutMs: 2000 },
          );
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0071-content-owning-focus-survives-app-switch] log tail:\n${tail}\n`,
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
