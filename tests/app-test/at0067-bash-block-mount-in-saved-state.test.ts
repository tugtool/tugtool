/**
 * at0067-bash-block-mount-in-saved-state.test.ts — regression gate for
 * the fold-axis mount-in-saved-state contract.
 *
 * # What this proves
 *
 * A previous observer-channel design had the body kind mount in its
 * `useState` default (collapsed when over threshold), then fire a
 * post-mount `setLocalCollapsed` from an observer callback, then
 * re-render to the saved value. The user saw two paints: the
 * default-collapsed frame, then the saved-expanded frame. With the
 * inner scroller getting recreated on fold-toggle, the cascade became
 * three-to-five visible frames per body kind — Developer > Reload
 * looked like wild scrolling.
 *
 * AT0067 pins the contract: the very first paint after reload reflects
 * the saved fold state. No intermediate frame where the user observes
 * the `useState` default.
 *
 * # How
 *
 *   1. Mount the `gallery-bash-mount-in-saved-state` fixture — a
 *      BashToolBlock with 100 lines of stdout, so the
 *      TerminalBlock's uncontrolled fold default is "collapsed".
 *   2. Click the fold cue to expand. Assert
 *      `data-collapsed="false"` (synchronous prop on the React-owned
 *      outer block).
 *   3. `app.appReload()` — same code path as Developer > Reload.
 *      `prepareForReload` flushes the bag (with
 *      `bag.components[<key>-body].collapsed === false`) to tugbank.
 *   4. On the new page, install a `MutationObserver` against the
 *      cardhost as early as possible (immediately when
 *      `data-card-id="A"` appears). Record every value of
 *      `[data-tug-block-kind="terminal"]`'s `data-collapsed` attribute.
 *   5. Wait for the deck to settle.
 *   6. Assert the recorded sequence is non-empty, and the FIRST
 *      observed value is `"false"` — the saved state. If the
 *      `useState` default ever painted (`"true"`) before the saved
 *      value applied, the recorded sequence would lead with `"true"`
 *      and this assertion catches it.
 *
 * # Tuglaws referenced
 *
 *  - [L23] state preservation across teardown-and-replay. The primary
 *    contract: first paint after restore equals last save.
 *  - [L02] saved state enters React through `useSyncExternalStore`-
 *    backed accessors at render time; no post-mount setState.
 *  - [L19] component authoring guide — the "Restoring saved state at
 *    mount" pattern.
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

const TOOL_USE_ID = "toolu_mount_in_saved_state_e8";
const PRESERVATION_KEY = `${TOOL_USE_ID}-body`;

function cardSelector(cardId: string): string {
  return `[data-card-id="${cardId}"]`;
}

function terminalOuterSelector(cardId: string): string {
  // TerminalBlock's outer element carries `data-collapsed` at the
  // React layer — the fold state controls *what* is rendered (preview
  // vs full body), not just *how* a rendered element looks, so it
  // lives in React data not CSS.
  return `${cardSelector(cardId)} [data-slot="terminal-body"]`;
}

function foldCueSelector(cardId: string): string {
  // BashToolBlock uses `embedded={true}` on TerminalBlock, which
  // portals the fold cue into the wrapper chrome's actions slot —
  // so the cue lives at the card level, OUTSIDE the
  // `data-slot="terminal-body"` outer's subtree.
  return `${cardSelector(cardId)} [data-slot="terminal-fold-cue"]`;
}

describe.skipIf(!SHOULD_RUN)(
  "AT0067: BashToolBlock fold state mounts in its saved value on first paint",
  () => {
    test(
      "after Developer > Reload, data-collapsed is 'false' from the first DOM observation",
      async () => {
        const tugbankPath = mkTempTugbank();
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0067-bash-block-mount-in-saved-state",
          env: { TUGBANK_PATH: tugbankPath },
          persistInTestMode: true,
        });
        try {
          await app.enableDeckTrace(true);

          await app.seedDeckState({
            state: {
              cards: [
                {
                  id: "A",
                  componentId: "gallery-bash-mount-in-saved-state",
                  title: "Bash",
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
            focusCardId: "A",
          });

          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );

          // -------- Phase 1: pre-reload — confirm default-collapsed,
          // then expand.

          // Wait for the TerminalBlock to render with its uncontrolled
          // fold default applied.
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(terminalOuterSelector("A"))});
              return el !== null && el.getAttribute("data-collapsed") !== null;
            })()`,
            { timeoutMs: 5000 },
          );

          const initialCollapsed = await app.evalJS<string | null>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(terminalOuterSelector("A"))});
              return el ? el.getAttribute("data-collapsed") : null;
            })()`,
          );
          // 100 lines > FOLD_THRESHOLD_LINES (40), so uncontrolled
          // default is collapsed.
          expect(initialCollapsed).toBe("true");

          // Click the fold cue to expand. The cue is the "show more"
          // affordance in the TerminalBlock header; the simplest
          // robust selector is the [data-collapsed-cue] hook.
          await app.evalJS<unknown>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(foldCueSelector("A"))});
              if (el === null) {
                throw new Error("no terminal-fold-cue inside terminal outer");
              }
              el.click();
              return null;
            })()`,
          );

          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(terminalOuterSelector("A"))});
              return el !== null && el.getAttribute("data-collapsed") === "false";
            })()`,
            { timeoutMs: 2000 },
          );

          // -------- Phase 2: reload.

          await app.appReload();

          // Read the bag the previous session wrote to disk. Must
          // contain `bag.components[<preservationKey>].collapsed === false`.
          const onDiskBag = tugbankRead<{
            components?: Record<string, { collapsed?: boolean }>;
          }>(tugbankPath, "dev.tugtool.deck.cardstate", "A");
          expect(onDiskBag).not.toBeNull();
          if (onDiskBag === null) throw new Error("bag missing on disk");
          const bagValue = onDiskBag.value;
          expect(bagValue.components).toBeDefined();
          if (bagValue.components === undefined) {
            throw new Error("components axis missing on disk");
          }
          const savedFold = bagValue.components[PRESERVATION_KEY];
          expect(savedFold).toBeDefined();
          expect(savedFold.collapsed).toBe(false);

          const cardStates: Record<string, unknown> = { A: bagValue };

          // -------- Phase 3: install the MutationObserver BEFORE the
          // deck mounts. We poll for the card-host to register on the
          // new page, then immediately install an observer that
          // records every `data-collapsed` value on the
          // terminal-block outer. Recording into a window-level array
          // (`window.__at0067Observed`) so the test can read the
          // sequence back via evalJS.
          //
          // We seed the deck AFTER setting up the observer hook so
          // the very first paint of the TerminalBlock is captured.
          // Install a single MutationObserver against the document
          // subtree that watches for the terminal outer's appearance
          // and for any subsequent change to its `data-collapsed`
          // attribute. Records every observed value into a window-
          // level array. The observer is anchored on `window` so it
          // doesn't get GC'd between the install eval and the next
          // eval.
          const evalResult = await app.evalJS<string>(
            `(function(){
              if (typeof window.__at0067Observed !== "undefined") {
                throw new Error("observer state already exists");
              }
              var observed = [];
              window.__at0067Observed = observed;
              var targetEl = null;
              var observer = new MutationObserver(function(records) {
                // First, look for the terminal outer if we haven't
                // pinned it yet.
                if (targetEl === null) {
                  targetEl = document.querySelector(
                    ${JSON.stringify(terminalOuterSelector("A"))},
                  );
                  if (targetEl !== null) {
                    observed.push(targetEl.getAttribute("data-collapsed"));
                  }
                  return;
                }
                // Already pinned — scan records for attribute changes
                // on the target.
                for (var i = 0; i < records.length; i += 1) {
                  var r = records[i];
                  if (r.target === targetEl && r.attributeName === "data-collapsed") {
                    observed.push(targetEl.getAttribute("data-collapsed"));
                  }
                }
              });
              observer.observe(document.body, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ["data-collapsed"],
              });
              window.__at0067Observer = observer;
              return "ok";
            })()`,
          );
          expect(evalResult).toBe("ok");

          await app.seedDeckState({
            state: {
              cards: [
                {
                  id: "A",
                  componentId: "gallery-bash-mount-in-saved-state",
                  title: "Bash",
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

          // Wait for the card host to register, then for the
          // TerminalBlock to render its outer (which the observer
          // would have caught).
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5000 },
          );

          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(terminalOuterSelector("A"))});
              return el !== null && el.getAttribute("data-collapsed") !== null;
            })()`,
            { timeoutMs: 5000 },
          );

          // Settle: small grace so any post-mount re-renders have
          // time to push their values into the observer. If a
          // post-mount observer-channel apply path were back, we'd
          // see the default frame land first, then the saved value.
          // Bun-side sleep avoids round-tripping a Promise through
          // `evaluateJavaScript`, which doesn't await it (would
          // surface as "unsupported type").
          await new Promise<void>((resolve) => setTimeout(resolve, 100));

          // -------- Assertion: the very first observed
          // `data-collapsed` value matches the saved state.
          const observed = await app.evalJS<Array<string | null>>(
            `window.__at0067Observed || []`,
          );
          expect(observed.length).toBeGreaterThan(0);
          expect(observed[0]).toBe("false");
          // And the value never disagreed with the saved value (no
          // intermediate "true" frame anywhere in the sequence).
          const disagreed = observed.filter((v) => v !== "false");
          expect(disagreed).toEqual([]);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0067-bash-block-mount-in-saved-state] log tail:\n${tail}\n`,
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
