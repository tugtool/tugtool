/**
 * at0062-late-mount-component-restore.test.ts — Phase E.7 gate.
 *
 * End-to-end proof that the framework's [A9c] component-state restore
 * path delivers saved bag.components values to components that mount
 * AFTER `CardHost`'s one-shot `restoreCardState` effect has iterated
 * an empty registry.
 *
 * ## Why this test exists
 *
 * Before Phase E.7, `CardStateOrchestrator.restoreCardState` walked
 * `registry.entriesInTreeOrder()` exactly once per CardHost mount and
 * silently dropped any `bag.components` key whose component had not
 * yet registered. That assumption — every descendant has registered
 * before the parent's effect runs — holds for synchronous-mount trees
 * but breaks for content that mounts behind an async data-source gate.
 * Tide-card surfaced this acutely (transcript body kinds mount after
 * session-resume populates the feed, hours after CardHost's restore
 * has run); every component-state-preservation consumer behind an
 * async mount gate had the same hole.
 *
 * Phase E.7 closes the hole at the framework level by:
 *   1. Adding an `observeRegister` channel to
 *      `ComponentStatePreservationRegistry`.
 *   2. Having `CardStateOrchestrator` cache `bag.components` per card
 *      and subscribe to that channel so late registrations receive
 *      their saved value synchronously inside the registering
 *      component's own `useLayoutEffect`.
 *
 * This test drives the canonical late-mount fixture
 * (`gallery-late-mount-preservation`) which mounts its inner
 * `<TugCheckbox componentStatePreservationKey="late-mount-done">`
 * behind a microtask, so the checkbox lands strictly after CardHost's
 * one-shot restore has run.
 *
 * ## Phases
 *
 *   1. Mount → wait for the late-mount slot to populate → click the
 *      checkbox → assert `data-state="checked"`.
 *   2. `app.appReload()` — same code path as Developer > Reload.
 *      `prepareForReload` flushes the bag to tugbank; the page
 *      reloads.
 *   3. Re-seed the deck shape with the on-disk bag → wait for the
 *      card to register → wait for the late-mount slot to populate
 *      again → assert the checkbox is `data-state="checked"` from
 *      the very first observation (no flicker, no re-toggle).
 *
 * ## Failure mode without Phase E.7
 *
 * Without the `observeRegister` channel, phase 3 would observe the
 * checkbox come up `data-state="unchecked"` because at the moment of
 * `restoreCardState` the registry was empty and `bag.components`
 * was dropped.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * Tuglaws referenced:
 *   - [L23] Preserve user-visible state across teardown-and-replay —
 *     this test is the L23 gate for the late-mount class.
 *   - [L03] `useLayoutEffect` for registrations events depend on. The
 *     `observeRegister` callback fires synchronously inside the
 *     registering hook's layout effect, so first paint reflects the
 *     restore.
 *   - [L19] Component authoring guide. New behavior is documented in
 *     `state-preservation.md` → "Late-mounting components".
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
const SCOPED_KEY = "late-mount-done";

function lateMountSlotSelector(): string {
  return `[data-card-id="${CARD_ID}"] [data-testid="late-mount-slot"]`;
}

function checkboxSelector(): string {
  return `[data-card-id="${CARD_ID}"] [data-testid="late-mount-slot"] [data-slot="tug-checkbox"]`;
}

/**
 * Poll until the late-mount slot has produced a TugCheckbox child.
 * Returns when `[data-slot="tug-checkbox"]` exists inside the slot.
 */
async function waitForLateMount(
  app: {
    waitForCondition: <T>(s: string, o?: { timeoutMs?: number }) => Promise<T>;
  },
  timeoutMs: number = 5000,
): Promise<void> {
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(checkboxSelector())}) !== null`,
    { timeoutMs },
  );
}

async function readCheckboxState(
  app: { evalJS: <T>(s: string) => Promise<T> },
): Promise<string | null> {
  return app.evalJS<string | null>(
    `(function(){
       var el = document.querySelector(${JSON.stringify(checkboxSelector())});
       return el === null ? null : el.getAttribute("data-state");
     })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "AT0062: late-mounting component-state restore (registry observer channel)",
  () => {
    test(
      "a TugCheckbox that mounts AFTER CardHost's restore effect comes back checked across appReload",
      async () => {
        const tugbankPath = mkTempTugbank();
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0062-late-mount-component-restore",
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
                  componentId: "gallery-late-mount-preservation",
                  title: "Late-Mount Preservation",
                  closable: true,
                },
              ],
              panes: [
                {
                  id: "p1",
                  position: { x: 40, y: 40 },
                  size: { width: 500, height: 360 },
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

          // -------- Phase 1: late-mount populates; toggle the checkbox.

          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(lateMountSlotSelector())}) !== null`,
          );

          await waitForLateMount(app);

          const preToggleState = await readCheckboxState(app);
          expect(preToggleState).toBe("unchecked");

          // Click the checkbox via DOM (synthetic click on
          // CheckboxPrimitive.Root routes through Radix' handler ->
          // TugCheckbox handleCheckedChange -> internal/controlled
          // dispatch). The harness can't drive native pointer events
          // through the Swift bridge cleanly; a plain `.click()` on
          // the checkbox root is the canonical way for app-tests.
          await app.evalJS<void>(
            `(function(){
               var el = document.querySelector(${JSON.stringify(checkboxSelector())});
               if (el === null) throw new Error("no checkbox to click");
               el.click();
             })()`,
          );

          await app.waitForCondition<boolean>(
            `(function(){
               var el = document.querySelector(${JSON.stringify(checkboxSelector())});
               return el !== null && el.getAttribute("data-state") === "checked";
             })()`,
            { timeoutMs: 2000 },
          );

          // -------- Phase 2: appReload — same code path as Developer >
          // Reload. `prepareForReload` flushes the bag (which now has
          // bag.components["late-mount-done"] = {checked: true}) to
          // tugbank before `location.reload()`.

          await app.appReload();

          // Read what landed on disk — pin the bag's contents so a
          // failure on the apply side is distinguishable from a
          // failure on the capture side.
          const onDiskBag = tugbankRead<{
            components?: Record<string, unknown>;
          }>(tugbankPath, "dev.tugtool.deck.cardstate", CARD_ID);
          expect(onDiskBag).not.toBeNull();
          if (onDiskBag === null) throw new Error("bag missing on disk");
          const bagValue = onDiskBag.value;
          expect(bagValue.components).toBeDefined();
          if (bagValue.components === undefined) {
            throw new Error("bag.components missing on disk");
          }
          // The opt-in key must be present with `{checked: true}`. If
          // this assertion fails, the synchronous-mount save path
          // regressed — the checkbox was mounted by the time
          // captureCardState walked the registry, so it should have
          // appeared in bag.components.
          expect(bagValue.components[SCOPED_KEY]).toEqual({ checked: true });

          // -------- Phase 3: re-seed deck shape AND feed the on-disk
          // bag back via `cardStates` so CardHost's mount-restore
          // dispatches `bag.components` into the orchestrator's
          // late-mount cache + observer.
          //
          // Note: the harness's `cardStates` field is wire-typed as
          // `Record<string, unknown>`. JSON.stringify of a Map gives
          // `{}`; pass a plain object.
          const cardStates: Record<string, unknown> = { [CARD_ID]: bagValue };

          await app.enableDeckTrace(true);
          await app.seedDeckState({
            state: {
              cards: [
                {
                  id: CARD_ID,
                  componentId: "gallery-late-mount-preservation",
                  title: "Late-Mount Preservation",
                  closable: true,
                },
              ],
              panes: [
                {
                  id: "p1",
                  position: { x: 40, y: 40 },
                  size: { width: 500, height: 360 },
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

          // The card mounts → CardHost's one-shot restoreCardState runs
          // (registry empty — late mount hasn't fired yet) → orchestrator
          // caches bag.components and installs observeRegister → late
          // mount fires → TugCheckbox registers → observer applies
          // {checked: true} synchronously inside the registering
          // layout effect → first paint after late-mount shows checked.
          await waitForLateMount(app);

          // -------- Assertion: checkbox is checked from the very first
          // observation after late mount. Phase E.7's guarantee is that
          // the registering layout effect's commit IS the commit that
          // applies the saved value — there's no intermediate paint
          // with `data-state="unchecked"` to flicker through.
          const postReloadState = await readCheckboxState(app);
          expect(postReloadState).toBe("checked");
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0062-late-mount-component-restore] log tail:\n${tail}\n`,
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
