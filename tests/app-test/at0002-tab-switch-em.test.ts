/**
 * at0002-tab-switch-em.test.ts — EM intra-pane tab switch (parent
 * [AT0002]). The EM-half of the [AT0001]/[AT0002] pair: typing
 * inside an EM-flavored card survives a tab-away / tab-back
 * gesture, including the engine root reacquiring focus via the
 * registered `onCardActivated` callback (the framework records
 * `engine-activation-dispatched` on dispatch).
 *
 * ## Coverage
 *
 * One realistic EM factory:
 *
 *   - `gallery-prompt-entry` — TugPromptEntry wrapper. This is
 *      what dev-card uses internally. Bag.content shape is
 *      `{ currentRoute, perRoute, maximized }`. Real-world
 *      relevance: every Dev AI session card and every full-on
 *      dev-card mounts a TugPromptEntry as its primary editor.
 *      (The legacy `gallery-prompt-input` TugPromptInput-direct
 *      surface was retired; only the wrapper remains as a gallery
 *      fixture.)
 *
 * dev-card itself is registered (`componentId: "tide"`) but
 * requires session-machinery setup (project-picker bind, code
 * feeds) that's outside this smoke's envelope. `gallery-prompt-entry`
 * is the practical proxy — same `TugPromptEntry`, same
 * `useCardStatePreservation` registration site, same activation path.
 *
 * ## Probes
 *
 * Each test types into the EM card's contenteditable, switches
 * tabs to a sibling FC card, switches back. After typing, the
 * debounced save fires (tab-switch flushes synchronously via
 * `transferFocusForActivation` → `invokeSaveCallback`); the
 * card's `bag.content` is now non-undefined. On return the
 * resolver returns `dispatch-activated` →
 * `invokeActivationCallback(cardId, "transfer-for-activation")`
 * → the registered `onCardActivated` focuses the engine root.
 * The trace assertion proves we went through that path.
 *
 * ## Gating
 *
 * `describe.skipIf(!SHOULD_RUN)`. CI and `bun x tsc --noEmit` runs
 * without `TUGAPP_APP_TEST=1` skip every test.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const PROMPT_INPUT_SELECTOR = '[data-slot="tug-text-editor"] .cm-content';

function tabSelectorFor(cardId: string): string {
  return `[data-testid="tug-tab-${cardId}"]`;
}

/**
 * Run the round-trip: seed P1=[A=EM, B=FC], type into A, tab to
 * B, tab back, assert text + focus + the trace event for A on
 * the return. Parameterized over `componentId` for forward
 * compatibility with future EM gallery fixtures.
 */
async function runRoundTrip(app: App, componentId: string): Promise<void> {
  await app.enableDeckTrace(true);

  await app.seedDeckState({
    state: {
      cards: [
        { id: "A", componentId, title: "EM A", closable: true },
        { id: "B", componentId: "gallery-input", title: "FC B", closable: true },
      ],
      panes: [
        {
          id: "p1",
          position: { x: 40, y: 40 },
          size: { width: 480, height: 320 },
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
  await app.awaitEngineReady("A");

  // Click into A's contenteditable, type "alpha". Typing into
  // an EM card writes through to the engine; bag.content fills
  // in once the next save fires (tab-switch's outgoing-save
  // does that synchronously).
  await app.nativeClickAtElement(`[data-card-id="A"] ${PROMPT_INPUT_SELECTOR}`);
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)})`,
  );
  await app.nativeType("alpha");
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && (window.__tug.getEmCardState("A")?.text === "alpha")`,
    { timeoutMs: 2000 },
  );

  // Tab away to B, then tab back to A. The return-tap dispatches
  // through `transferFocusForActivation` which resolves to
  // `dispatch-activated` (A has bag.content from the save fired
  // on tab-out) and calls `invokeActivationCallback` with the
  // "transfer-for-activation" tag.
  const markBeforeReturn = await app.markDeckTrace();
  await app.nativeClickAtElement(tabSelectorFor("B"));
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && (window.__tug.getActiveCardId() === "B")`,
  );
  await app.nativeClickAtElement(tabSelectorFor("A"));
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && (window.__tug.getActiveCardId() === "A")`,
  );

  // The framework's single-channel `applyBagFocus` dispatcher
  // (Phase E.11) resolves A to its engine and invokes the
  // registered engine hook, which records `engine-paint-mirror-active`
  // with `caller: "via-engine-hook"`. Wait for it. (Pre-E.11 the
  // equivalent gate was `engine-activation-dispatched` from
  // `invokeActivationCallback`; that path is retired.)
  await app.waitForCondition<boolean>(
    `(function(){
      var t = window.__tug.getDeckTrace({since: ${markBeforeReturn}});
      for (var i = 0; i < t.length; i++) {
        if (t[i].kind === "engine-paint-mirror-active"
            && t[i].cardId === "A"
            && t[i].caller === "via-engine-hook") return true;
      }
      return false;
    })()`,
    { timeoutMs: 2000 },
  );

  // The engine hook focuses the engine root.
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)}) && document.activeElement.closest('[data-card-id="A"]') !== null`,
    { timeoutMs: 2000 },
  );

  // Text preserved across the tab cycle.
  const state = await app.getEmCardState("A");
  expect(state).not.toBeNull();
  expect(state!.text).toBe("alpha");
  expect(state!.engine).toBe(componentId);
}

describe.skipIf(!SHOULD_RUN)("m02: EM intra-pane tab switch preserves text + restores engine focus", () => {
  test("gallery-prompt-entry (TugPromptEntry, dev-card's editor): tab-away + tab-back round-trip", async () => {
    const app = await launchTugApp({ testName: "at0002-tab-switch-em-entry" });
    try {
      await runRoundTrip(app, "gallery-prompt-entry");
    } finally {
      await app.close();
    }
  });
});
