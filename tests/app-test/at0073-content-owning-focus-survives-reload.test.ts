/**
 * at0073-content-owning-focus-survives-reload.test.ts — find input
 * focus survives Developer > Reload for a content-owning card.
 *
 * ## What this pins
 *
 * The most demanding case of Phase E.10's `bag.focus` axis. The find
 * input is **conditionally mounted** — it only renders while
 * `findSession.state.open` is true. After reload the row's open state
 * must restore synchronously-before-paint via
 * `useSavedComponentState` so the input exists by the time
 * `applyFocusSnapshot` runs in the COLD-BOOT RESTORE site
 * (`card-host.tsx:984-1014`).
 *
 * The full contract under test:
 *
 *   1. The find row's open flag survives reload via
 *      `useComponentStatePreservation` (the hook registers
 *      `<key>/file-block-find` in `bag.components`).
 *   2. The framework's `bag.focus = { kind: "dom", focusKey: ... }`
 *      flushes to disk on `appReload`'s prepareForReload save.
 *   3. On the next page, mount-in-saved-state seeds `useState` from
 *      the saved bag during `useState` init (the [A9] pattern), so
 *      the find row is `open` on first paint and the input is in the
 *      DOM by the time the cold-boot focus apply runs.
 *   4. CardHost's COLD-BOOT RESTORE site resolves the focusKey
 *      against the live card host root and calls `.focus()`.
 *   5. `document.activeElement` is the find input on the first post-
 *      reload tick.
 *
 * If ANY of those steps fail (open flag drops, bag.focus not flushed,
 * mount-in-saved-state runs late, COLD-BOOT RESTORE gated wrong), the
 * input has no focus after reload. AT0073 is the canary that gates
 * regressions against the full path.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
  tugbankRead,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 60_000;

const FIXTURE_COMPONENT_ID = "gallery-file-block-find-fixture";
const PRESERVATION_KEY = "file-block-find-fixture";
const FIND_SLOT_KEY = `${PRESERVATION_KEY}/file-block-find`;
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
  "AT0073: content-owning card find input survives Developer > Reload",
  () => {
    test(
      "after appReload, the conditionally-mounted find input re-mounts open and focused",
      async () => {
        const tugbankPath = mkTempTugbank();
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0073-content-owning-focus-survives-reload",
          env: { TUGBANK_PATH: tugbankPath },
          persistInTestMode: true,
        });
        try {
          await app.enableDeckTrace(true);

          // Phase 1: seed, open the find row, type a query.
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
              A: { content: { marker: "at0073-content-owning" } },
            },
            focusCardId: "A",
          });

          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );

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

          // Phase 2: reload. `prepareForReload` flushes the bag to
          // tugbank synchronously before the page unloads.
          await app.appReload();

          // Read the bag the previous session wrote to disk. Must
          // carry the find session's open flag + query through
          // `bag.components[<key>/file-block-find]` AND the
          // framework axis through `bag.focus`.
          const onDiskBag = tugbankRead<{
            components?: Record<
              string,
              { open?: boolean; query?: string }
            >;
            focus?: { kind: string; focusKey?: string };
          }>(tugbankPath, "dev.tugtool.deck.cardstate", "A");
          expect(onDiskBag).not.toBeNull();
          if (onDiskBag === null) throw new Error("bag missing on disk");
          const bagValue = onDiskBag.value;

          expect(bagValue.components).toBeDefined();
          if (bagValue.components === undefined) {
            throw new Error("components axis missing on disk");
          }
          const savedFind = bagValue.components[FIND_SLOT_KEY];
          expect(savedFind).toBeDefined();
          expect(savedFind.open).toBe(true);
          expect(savedFind.query).toBe("lorem");

          expect(bagValue.focus).toBeDefined();
          expect(bagValue.focus!.kind).toBe("dom");
          expect(bagValue.focus!.focusKey).toBe(FOCUS_KEY);

          // The card-state-bag we re-seed must echo the disk shape so
          // that mount-in-saved-state has something to read on the
          // re-loaded page.
          const cardStates: Record<string, unknown> = {
            A: {
              ...bagValue,
              // Keep `content` populated so the card stays
              // content-owning after reload.
              content: { marker: "at0073-content-owning" },
            },
          };

          // Phase 3: seed the deck on the reloaded page. The
          // `seedDeckState` call's `focusCardId: "A"` triggers the
          // cold-boot focus restore path that consumes `bag.focus`
          // via `applyFocusSnapshot`.
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
            cardStates,
            focusCardId: "A",
          });

          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5000 },
          );

          // The find row must be present on first paint (mount-in-
          // saved-state). `useSavedComponentState` seeds the hook's
          // `useState` initializer with `open: true`, so the row's
          // `findOpen && !collapsed` gate renders.
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(findInputSelector("A"))}) !== null`,
            { timeoutMs: 5000 },
          );

          // The query string from the saved slot is on the input.
          const queryAfterReload = await app.evalJS<string | null>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(findInputSelector("A"))});
              return el ? el.value : null;
            })()`,
          );
          expect(queryAfterReload).toBe("lorem");

          // Focus lands on the input via the COLD-BOOT RESTORE site.
          await app.waitForCondition<boolean>(
            `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(
              findInputSelector("A"),
            )})`,
            { timeoutMs: 5000 },
          );
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0073-content-owning-focus-survives-reload] log tail:\n${tail}\n`,
            );
          }
          throw err;
        } finally {
          await app.close();
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
