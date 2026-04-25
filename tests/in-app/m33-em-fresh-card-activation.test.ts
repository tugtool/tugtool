/**
 * m33-em-fresh-card-activation.test.ts — fresh, never-saved EM
 * card mounted in an inactive tab → activated via tab click →
 * focus lands on the engine's contenteditable, NOT a sibling
 * toolbar button (parent plan #step-23f gap 2).
 *
 * ## Why this exists
 *
 * Before Step 23F's resolver fix, `resolveActivationTarget`
 * discriminated EM vs FC cards by `bag.content !== undefined`.
 * That worked for saved EM cards (m09) but mis-classified fresh,
 * never-saved EM cards: with no bag, the resolver fell through
 * to the `default-focus` branch, which walks
 * `DEFAULT_FOCUS_SELECTORS` where `button:not([disabled])`
 * matches before `[contenteditable="true"]` — landing focus on
 * the prompt-input toolbar's first button (e.g. "Insert Atom"
 * for `gallery-prompt-input`) instead of the engine root.
 *
 * Step 23F adds `engineKind: "em"` to the card registry shape;
 * `gallery-prompt-input`, `gallery-prompt-entry`, and `tide`
 * declare it. The resolver now returns `dispatch-activated` for
 * registry-tagged EM cards regardless of `bag.content` presence,
 * so `onCardActivated` fires for both saved and fresh EM cards
 * uniformly.
 *
 * ## Coverage
 *
 * Two factories — `gallery-prompt-input` (TugPromptInput direct)
 * and `gallery-prompt-entry` (TugPromptEntry wrapper, what
 * tide-card uses internally). Each runs the fresh-card
 * inactive-at-mount → tab-activate path with no bag seeding.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

const PROMPT_INPUT_SELECTOR = '[data-tug-prompt-input-root] [contenteditable]';

function tabSelectorFor(cardId: string): string {
  return `[data-testid="tug-tab-${cardId}"]`;
}

async function runFreshCardActivation(app: App, componentId: string): Promise<void> {
  await app.enableDeckTrace(true);

  // Seed P1=[A=FC active, B=EM fresh] — no `cardStates` entry for
  // B, so it has no bag at all. The resolver must classify B as
  // EM by registry tag and route through dispatch-activated.
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
    focusCardId: "A",
  });

  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
  );
  await app.awaitEngineReady("B");

  // Activate B. The resolver should return dispatch-activated by
  // registry-tag classification (no bag, fresh card).
  const markBeforeActivate = await app.markDeckTrace();
  await app.nativeClickAtElement(tabSelectorFor("B"));
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && (window.__tug.getActiveCardId() === "B")`,
  );

  // engine-activation-dispatched fires for B with the
  // "transfer-for-activation" tag — proves the dispatch-activated
  // branch ran rather than the default-focus branch.
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

  // Focus lands on B's contenteditable, not a sibling toolbar
  // button. This is the user-visible regression-gate assertion:
  // pre-fix, focus would have landed on the first toolbar button
  // matching `button:not([disabled])` because the default-focus
  // chain ran in place of dispatch-activated.
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)}) && document.activeElement.closest('[data-card-id="B"]') !== null`,
    { timeoutMs: 2000 },
  );

  // Belt-and-suspenders: confirm activeElement is NOT a button
  // anywhere inside B's card subtree. The pre-fix failure mode
  // landed focus on `gallery-prompt-input`'s "Insert Atom"
  // toolbar button.
  const isButton = await app.evalJS<boolean>(
    `document.activeElement !== null && document.activeElement.tagName === "BUTTON"`,
  );
  expect(isButton).toBe(false);
}

describe.skipIf(!SHOULD_RUN)("m33-em: fresh EM card inactive-at-mount activates via dispatch-activated (registry-tag path)", () => {
  test("gallery-prompt-input (TugPromptInput): focus lands on contenteditable, not toolbar button", async () => {
    const app = await launchTugApp({ testName: "m33-em-fresh-input" });
    try {
      await runFreshCardActivation(app, "gallery-prompt-input");
    } finally {
      await app.close();
    }
  });

  test("gallery-prompt-entry (TugPromptEntry, tide-card's editor): focus lands on contenteditable, not toolbar button", async () => {
    const app = await launchTugApp({ testName: "m33-em-fresh-entry" });
    try {
      await runFreshCardActivation(app, "gallery-prompt-entry");
    } finally {
      await app.close();
    }
  });
});
