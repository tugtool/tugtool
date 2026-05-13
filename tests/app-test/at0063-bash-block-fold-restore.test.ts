/**
 * at0063-bash-block-fold-restore.test.ts — Phase E.7 regression gate.
 *
 * The user-reported failure that AT0062 did NOT catch: a real
 * `BashToolBlock` whose `TerminalBlock` body mounts AFTER `CardHost`'s
 * one-shot `restoreCardState` should still come back with its
 * USER-CHOSEN fold state after `Developer > Reload`. AT0062 used a
 * simplified `TugCheckbox` fixture and passed; the user reported the
 * same Bash block failure mode "exactly the same way" after E.7
 * landed, meaning the simplified fixture was not exercising the same
 * pipeline the real tide-card does.
 *
 * This test drives the realistic surrogate
 * (`gallery-late-mount-bash-tool-block`) which mounts the
 * production `BashToolBlock` (TerminalBlock inside it) behind a
 * microtask-then-state-flip gate. The componentStatePreservationKey
 * follows BashToolBlock's production shape — `${toolUseId}-body` — so
 * the round-trip exercises the SAME key plumbing as tide-card.
 *
 * ## What this test proves
 *
 *   1. The save side captures the fold state into
 *      `bag.components["${toolUseId}-body"]`.
 *   2. The bag survives the tugbank round-trip via `appReload`.
 *   3. On the new page, the orchestrator's `observeRegister`
 *      subscription fires when `TerminalBlock`'s `register()` call
 *      lands — late, after `CardHost`'s one-shot restore — and the
 *      saved value is applied to `setLocalCollapsed` in the same
 *      React commit as the registration, so first paint reflects
 *      the user's choice.
 *
 * Failure mode without Phase E.7 (and the symptom the user reports):
 * `bag.components["${toolUseId}-body"]` is dropped on the empty-
 * registry iteration; `TerminalBlock`'s `localCollapsed` falls back
 * to `overThreshold` (true for this 60-line fixture) and the block
 * comes back COLLAPSED regardless of the user's pre-reload choice.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * Tuglaws referenced:
 *   - [L23] state preservation across teardown-and-replay — this is
 *     the L23 gate for the real BashToolBlock body kind.
 *   - [L03] `useLayoutEffect` for registrations events depend on —
 *     `observeRegister` fires synchronously inside the registering
 *     hook's commit so first paint reflects the restore.
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

const CARD_ID = "A";
// Must match LATE_MOUNT_PROPS.toolUseId in
// `gallery-bash-tool-block.tsx`. BashToolBlock composes its body's
// `componentStatePreservationKey` as `${toolUseId}-body`.
const TOOL_USE_ID = "toolu_late_mount_e7";
const SCOPED_KEY = `${TOOL_USE_ID}-body`;

function lateMountSlotSelector(): string {
  return `[data-card-id="${CARD_ID}"] [data-testid="late-mount-bash-slot"]`;
}

function terminalRootSelector(): string {
  // TerminalBlock's root carries `data-slot="terminal-body"` (see
  // `DATA_SLOT_ROOT` in `terminal-block.tsx`) and `data-collapsed="true|false"`
  // when overThreshold. The fixture's 60-line stdout guarantees
  // overThreshold.
  return `[data-card-id="${CARD_ID}"] [data-slot="terminal-body"]`;
}

function foldCueSelector(): string {
  return `[data-card-id="${CARD_ID}"] [data-slot="terminal-fold-cue"]`;
}

async function waitForBashBodyMount(
  app: {
    waitForCondition: <T>(s: string, o?: { timeoutMs?: number }) => Promise<T>;
  },
  timeoutMs: number = 5000,
): Promise<void> {
  // Wait for the TerminalBlock root to appear inside the late-mount
  // slot. That root only renders when the wrapper's `status === "ready"`
  // branch has resolved — which is the late-mount transition.
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(terminalRootSelector())}) !== null`,
    { timeoutMs },
  );
  // And wait for the fold cue to be in the DOM (overThreshold path).
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(foldCueSelector())}) !== null`,
    { timeoutMs },
  );
}

async function readCollapsedAttr(
  app: { evalJS: <T>(s: string) => Promise<T> },
): Promise<string | null> {
  return app.evalJS<string | null>(
    `(function(){
       var el = document.querySelector(${JSON.stringify(terminalRootSelector())});
       return el === null ? null : el.getAttribute("data-collapsed");
     })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "AT0063: BashToolBlock fold state survives Developer > Reload (Phase E.7 regression)",
  () => {
    test(
      "TerminalBlock fold state survives reload through the real BashToolBlock pipeline",
      async () => {
        const tugbankPath = mkTempTugbank();
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0063-bash-block-fold-restore",
          env: { TUGBANK_PATH: tugbankPath },
          persistInTestMode: true,
        });
        try {
          await app.enableDeckTrace(true);

          await app.seedDeckState({
            state: {
              cards: [
                {
                  id: CARD_ID,
                  componentId: "gallery-late-mount-bash-tool-block",
                  title: "Late-mount BashToolBlock",
                  closable: true,
                },
              ],
              panes: [
                {
                  id: "p1",
                  position: { x: 40, y: 40 },
                  size: { width: 720, height: 520 },
                  cardIds: [CARD_ID],
                  activeCardId: CARD_ID,
                  title: "",
                  acceptsFamilies: ["developer"],
                },
              ],
              activePaneId: "p1",
              hasFocus: true,
            },
            focusCardId: CARD_ID,
          });

          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered(${JSON.stringify(CARD_ID)})`,
          );

          // -------- Phase 1: late-mount populates; toggle the fold.

          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(lateMountSlotSelector())}) !== null`,
          );

          await waitForBashBodyMount(app);

          // Default state for a 60-line fixture is COLLAPSED
          // (`overThreshold === true`, `localCollapsed` initializer
          // returns true). Verify before we click.
          const preToggleCollapsed = await readCollapsedAttr(app);
          expect(preToggleCollapsed).toBe("true");

          // EXPAND the block by clicking the fold cue. After this:
          // `localCollapsed === false`, `data-collapsed === "false"`.
          await app.evalJS<void>(
            `(function(){
               var btn = document.querySelector(${JSON.stringify(foldCueSelector())});
               if (btn === null) throw new Error("no fold cue to click");
               btn.click();
             })()`,
          );

          await app.waitForCondition<boolean>(
            `(function(){
               var el = document.querySelector(${JSON.stringify(terminalRootSelector())});
               return el !== null && el.getAttribute("data-collapsed") === "false";
             })()`,
            { timeoutMs: 2000 },
          );

          // -------- Phase 2: appReload — same path as Developer >
          // Reload. `prepareForReload` flushes the bag via the
          // orchestrator's captureCardState; the bag must now contain
          // bag.components[SCOPED_KEY] = {collapsed: false}.

          await app.appReload();

          const onDiskBag = tugbankRead<{
            components?: Record<string, unknown>;
          }>(tugbankPath, "dev.tugtool.deck.cardstate", CARD_ID);
          expect(onDiskBag).not.toBeNull();
          if (onDiskBag === null) throw new Error("bag missing on disk");
          const bagValue = onDiskBag.value;
          expect(bagValue.components).toBeDefined();
          if (bagValue.components === undefined) {
            throw new Error(
              "bag.components missing on disk — save side never captured the fold state",
            );
          }
          // The opt-in key must be present with `{collapsed: false}`.
          // If this assertion fails, the BashToolBlock body kind was
          // not registered with the per-card registry at save time —
          // a save-side problem, not a restore-side problem.
          expect(bagValue.components[SCOPED_KEY]).toEqual({ collapsed: false });

          // -------- Phase 3: re-seed deck shape AND feed the on-disk
          // bag back via `cardStates`. CardHost mounts → registry is
          // empty (TerminalBlock hasn't late-mounted yet) → orchestrator
          // caches bag.components + installs observeRegister → late
          // mount → TerminalBlock registers `${TOOL_USE_ID}-body` →
          // observer fires → setLocalCollapsed(false) → first paint
          // after late mount shows expanded.
          const cardStates: Record<string, unknown> = { [CARD_ID]: bagValue };

          await app.enableDeckTrace(true);
          await app.seedDeckState({
            state: {
              cards: [
                {
                  id: CARD_ID,
                  componentId: "gallery-late-mount-bash-tool-block",
                  title: "Late-mount BashToolBlock",
                  closable: true,
                },
              ],
              panes: [
                {
                  id: "p1",
                  position: { x: 40, y: 40 },
                  size: { width: 720, height: 520 },
                  cardIds: [CARD_ID],
                  activeCardId: CARD_ID,
                  title: "",
                  acceptsFamilies: ["developer"],
                },
              ],
              activePaneId: "p1",
              hasFocus: true,
            },
            cardStates,
            focusCardId: CARD_ID,
          });

          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered(${JSON.stringify(CARD_ID)})`,
            { timeoutMs: 5000 },
          );

          await waitForBashBodyMount(app);

          // -------- Assertion: fold state is EXPANDED from the very
          // first observation after late-mount. The framework
          // guarantee is that the registering layout effect's commit
          // IS the commit that applies the saved value — no
          // intermediate paint where the block flashes collapsed.
          const postReloadCollapsed = await readCollapsedAttr(app);
          expect(postReloadCollapsed).toBe("false");
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0063-bash-block-fold-restore] log tail:\n${tail}\n`,
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
