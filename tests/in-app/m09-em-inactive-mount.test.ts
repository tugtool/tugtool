/**
 * m09-em-inactive-mount.test.ts — saved-state EM card mounted in
 * an inactive tab → activated via tab switch → engine focuses
 * correctly via the dispatch-activated path ([M09]).
 *
 * ## Scenario
 *
 * Seed P1=[A=FC active, B=EM] with pre-cooked `bag.content` for
 * B (engine state with text "saved-em" and a non-collapsed
 * selection). B mounts in display:none from the inactive tab;
 * its TugPromptInput layout effect creates the engine, and
 * onRestore applies the seeded state into the engine — though
 * the contenteditable is hidden, so visual paint is deferred
 * until activation. On tab-click:
 *
 *   - `transferFocusForActivation` resolves the target as
 *     `dispatch-activated` (B has bag.content).
 *   - `invokeActivationCallback(B, "transfer-for-activation")`
 *     records `engine-activation-dispatched` and fires the
 *     registered `onCardActivated`.
 *   - The callback focuses the engine root via the delegate /
 *     direct `engine.root.focus({ preventScroll: true })`.
 *   - Seeded text is restored.
 *
 * ## Coverage
 *
 * Two factories — `gallery-prompt-input` (TugPromptInput direct,
 * raw TugTextEditingState bag) and `gallery-prompt-entry`
 * (TugPromptEntry wrapper, what tide-card uses internally).
 *
 * ## Out of scope: fresh inactive-at-mount
 *
 * **Fresh inactive-at-mount** (no pre-seeded bag.content). For a
 * never-saved EM card, `resolveActivationTarget` falls through
 * to `default-focus` rather than `dispatch-activated` (the EM
 * discriminator is `bag.content !== undefined`). The default-
 * focus chain's contenteditable selector lands focus on the
 * engine root — UNLESS an earlier selector in the chain
 * (`button:not([disabled])` for `gallery-prompt-input`'s
 * toolbar buttons) wins first. That asymmetry is the same root
 * cause as the user-reported tide-card cold-boot selection gap;
 * see [M10] and related in-app tests.
 *
 * ## Gating
 *
 * `describe.skipIf(!SHOULD_RUN)`. CI and `bun x tsc --noEmit` runs
 * without `TUGAPP_IN_APP_TEST=1` skip every test.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

const PROMPT_INPUT_SELECTOR = '[data-tug-prompt-input-root] [contenteditable]';
const TUG_PROMPT_ENTRY_DEFAULT_ROUTE = "❯";

function tabSelectorFor(cardId: string): string {
  return `[data-testid="tug-tab-${cardId}"]`;
}

/**
 * Build a pre-cooked `bag.content` for the given EM factory's
 * persistence shape. `gallery-prompt-input` carries raw
 * TugTextEditingState; `gallery-prompt-entry` wraps it under
 * `{ currentRoute, perRoute, maximized }`.
 */
function preSeededContent(
  componentId: string,
  text: string,
): Record<string, unknown> {
  const engineState = {
    text,
    atoms: [],
    selection: { start: 0, end: text.length },
  };
  if (componentId === "gallery-prompt-entry") {
    return {
      currentRoute: TUG_PROMPT_ENTRY_DEFAULT_ROUTE,
      perRoute: { [TUG_PROMPT_ENTRY_DEFAULT_ROUTE]: engineState },
      maximized: false,
    };
  }
  return engineState;
}

async function runSavedStateInactiveMount(app: App, componentId: string): Promise<void> {
  await app.enableDeckTrace(true);

  const cardStates = {
    B: { content: preSeededContent(componentId, "saved-em") },
  };

  await app.seedDeckState({
    state: {
      cards: [
        { id: "A", componentId: "gallery-input", title: "FC A", closable: true },
        { id: "B", componentId, title: "EM B", closable: true },
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
    cardStates,
    focusCardId: "A",
  });

  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
  );
  await app.awaitEngineReady("B");

  // Activate B. With bag.content present, resolver returns
  // dispatch-activated → invokeActivationCallback fires →
  // engine-activation-dispatched event lands → onCardActivated
  // focuses the engine root.
  const markBeforeActivate = await app.markDeckTrace();
  await app.nativeClickAtElement(tabSelectorFor("B"));
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && (window.__tug.getActiveCardId() === "B")`,
  );

  await app.waitForCondition<boolean>(
    `(function(){
      var t = window.__tug.getDeckTrace({since: ${markBeforeActivate}});
      for (var i = 0; i < t.length; i++) {
        if (t[i].kind === "engine-activation-dispatched"
            && t[i].cardId === "B"
            && t[i].engine === ${JSON.stringify(componentId)}
            && t[i].dispatchedFrom === "transfer-for-activation") return true;
      }
      return false;
    })()`,
    { timeoutMs: 2000 },
  );

  // Focus lands inside B's engine root.
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)}) && document.activeElement.closest('[data-card-id="B"]') !== null`,
    { timeoutMs: 2000 },
  );

  // Seeded text restored.
  const state = await app.getEmCardState("B");
  expect(state).not.toBeNull();
  expect(state!.text).toBe("saved-em");
  expect(state!.engine).toBe(componentId);
}

describe.skipIf(!SHOULD_RUN)("m09: saved-state EM card inactive-at-mount activates via dispatch-activated", () => {
  test("gallery-prompt-input (TugPromptInput): dispatch-activated path fires + restores text", async () => {
    const app = await launchTugApp({ testName: "m09-em-inactive-input-saved" });
    try {
      await runSavedStateInactiveMount(app, "gallery-prompt-input");
    } finally {
      await app.close();
    }
  });

  test("gallery-prompt-entry (TugPromptEntry, tide-card's editor): dispatch-activated path fires + restores text", async () => {
    const app = await launchTugApp({ testName: "m09-em-inactive-entry-saved" });
    try {
      await runSavedStateInactiveMount(app, "gallery-prompt-entry");
    } finally {
      await app.close();
    }
  });
});
