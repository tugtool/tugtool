/**
 * at0081-dev-focus-reload.test.ts — a tide card's activation focus
 * lands on the prompt entry after Developer > Reload [AT0081].
 *
 * ## Why this exists
 *
 * Phase E.12's rule: a tide card has exactly one text-entry surface
 * (`tug-prompt-entry`), so its activation focus has exactly one
 * destination. AT0081 gates the cold-boot source: a Developer >
 * Reload tears the DOM down and rebuilds it from the saved bag, and
 * focus must still land on the prompt-entry contenteditable.
 *
 * The cold-boot path exercises the `deferred-engine` settle: when
 * `seedDeckState` re-seeds the reloaded page, CardHost's RESTORE
 * effect runs `applyBagFocus` before the tide engine has registered
 * its hooks, so the resolver returns `deferred-engine`. Re-binding
 * the session and awaiting engine-ready bumps `engineHooksVersion`,
 * which re-fires the RESTORE effect — `applyBagFocus` now resolves
 * `engine` and the hook lands `view.focus()`. This is the one
 * remaining late-mount focus path after Phase E.12 retired the
 * `deferred-dom` MutationObserver focus-retry branch.
 *
 * A content-owning tide card does not persist a `bag.focus` field —
 * `resolveBagFocus` infers the engine destination from the card's
 * engine-managed `componentId` when `bag.focus` is absent. So the
 * test does not assert anything about the on-disk `bag.focus`; the
 * load-bearing assertion is purely "focus lands on the prompt
 * entry."
 *
 * ## Shape
 *
 *   1. Seed a tide card; bind a fake session; await engine ready.
 *   2. Click into the contenteditable; type "hello".
 *   3. `appReload` — `prepareForReload` flushes the bag to tugbank.
 *   4. Re-seed the reloaded page with the persisted bag; re-bind
 *      the session; await engine ready. (`enableDeckTrace` persists
 *      across `appReload`, so `engine-ready` is recorded on the
 *      reloaded page and `awaitEngineReady` resolves normally.)
 *   5. Assert `document.activeElement` is the dev-card's
 *      `tug-prompt-entry` contenteditable.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, test } from "bun:test";
import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
  tugbankRead,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 60_000;

const PROMPT_INPUT_SELECTOR = '[data-slot="tug-text-editor"] .cm-content';

const SEED_STATE = {
  cards: [
    { id: "A", componentId: "tide", title: "Dev A", closable: true },
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
} as const;

describe.skipIf(!SHOULD_RUN)(
  "AT0081: dev-card focus lands on the prompt entry after Developer > Reload",
  () => {
    test(
      "after appReload, focus restores to the prompt-entry contenteditable",
      async () => {
        const tugbankPath = mkTempTugbank();
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0081-dev-focus-reload",
          env: { TUGBANK_PATH: tugbankPath },
          persistInTestMode: true,
        });
        try {
          await app.enableDeckTrace(true);

          // Phase 1: seed, bind a session, type into the prompt.
          await app.seedDeckState({
            state: { ...SEED_STATE },
            focusCardId: "A",
          });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindDevSession("A");
          await app.awaitEngineReady("A");

          await app.nativeClickAtElement(`[data-card-id="A"] ${PROMPT_INPUT_SELECTOR}`);
          await app.waitForCondition<boolean>(
            `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)})`,
          );
          await app.nativeType("hello");
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && (window.__tug.getEmCardState("A")?.text === "hello")`,
            { timeoutMs: 2000 },
          );

          // Phase 2: reload. `prepareForReload` flushes the bag.
          await app.appReload();

          // Read whatever the previous session persisted so the
          // re-seed echoes the on-disk shape (a content-owning tide
          // card does not persist a `bag.focus` field — the resolver
          // infers the engine destination from the componentId).
          const onDiskBag = tugbankRead<Record<string, unknown>>(
            tugbankPath,
            "dev.tugtool.deck.cardstate",
            "A",
          );
          const bagValue = onDiskBag?.value ?? {};

          // Phase 3: re-seed the reloaded page with the disk bag,
          // re-bind the session, await engine ready. The cold-boot
          // RESTORE → deferred-engine → engineHooksVersion re-run
          // path lands focus on the contenteditable.
          await app.seedDeckState({
            state: { ...SEED_STATE },
            cardStates: { A: { ...bagValue } },
            focusCardId: "A",
          });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 8000 },
          );
          await app.bindDevSession("A");
          await app.awaitEngineReady("A");

          await app.waitForCondition<boolean>(
            `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)}) && document.activeElement.closest('[data-card-id="A"]') !== null`,
            { timeoutMs: 5000 },
          );
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0081-dev-focus-reload] log tail:\n${tail}\n`,
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
