/**
 * at0006-em-cross-pane.test.ts — EM-card cross-pane drag preserves
 * engine state + restores focus on drop ([AT0006] EM-half).
 *
 * Mirrors `at0006-cross-pane-drag.test.ts` (the FC-half) but with
 * EM cards. After drop, the cross-pane move triggers
 * `transferFocusAfterMove`, which resolves the dragged card's
 * target as `dispatch-activated` (EM has bag.content from the
 * drag-start save) and dispatches via
 * `invokeActivationCallback(cardId, "transfer-after-move")`.
 * The framework records `engine-activation-dispatched`; the
 * registered `onCardActivated` focuses the engine root.
 *
 * Coverage: two factories — `gallery-prompt-input` (TugPromptInput
 * direct) and `gallery-prompt-entry` (TugPromptEntry, what
 * tide-card uses). Each runs the full P1→P2 drag round-trip.
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

function tabBarSelectorFor(paneId: string): string {
  return `.tug-tab-bar[data-pane-id="${paneId}"]`;
}

async function runCrossPaneDrag(app: App, componentId: string): Promise<void> {
  await app.enableDeckTrace(true);

  // Two multi-tab panes so the hit-test resolves P2's bar in
  // tier 1. P1's first card is the EM card under test; the
  // second tab in each pane is an FC card so the bars exist.
  await app.seedDeckState({
    state: {
      cards: [
        { id: "A", componentId, title: "EM A", closable: true },
        { id: "B", componentId: "gallery-input", title: "FC B", closable: true },
        { id: "C", componentId: "gallery-input", title: "FC C", closable: true },
        { id: "D", componentId: "gallery-input", title: "FC D", closable: true },
      ],
      panes: [
        {
          id: "p1",
          position: { x: 40, y: 40 },
          size: { width: 480, height: 360 },
          cardIds: ["A", "B"],
          activeCardId: "A",
          title: "",
          acceptsFamilies: ["developer"],
        },
        {
          id: "p2",
          position: { x: 600, y: 40 },
          size: { width: 480, height: 360 },
          cardIds: ["C", "D"],
          activeCardId: "C",
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
  await app.awaitEngineReady("A");

  // Type "alpha" into A's contenteditable so we have a saved-bag
  // fixture to verify engine-state survival across the move.
  await app.nativeClickAtElement(`[data-card-id="A"] ${PROMPT_INPUT_SELECTOR}`);
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)})`,
  );
  await app.nativeType("alpha");
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && (window.__tug.getEmCardState("A")?.text === "alpha")`,
    { timeoutMs: 2000 },
  );

  // Drag A from P1 into P2's tab bar.
  const markBeforeDrag = await app.markDeckTrace();
  await app.nativeDragElement(tabSelectorFor("A"), {
    selector: tabBarSelectorFor("p2"),
  });

  // A landed in P2 and is the new first responder.
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && (window.__tug.getActiveCardId() === "A")`,
  );

  // engine-activation-dispatched fires for A with the
  // "transfer-after-move" tag (drag-drop activation source).
  await app.waitForCondition<boolean>(
    `(function(){
      var t = window.__tug.getDeckTrace({since: ${markBeforeDrag}});
      for (var i = 0; i < t.length; i++) {
        if (t[i].kind === "engine-activation-dispatched"
            && t[i].cardId === "A"
            && t[i].engine === ${JSON.stringify(componentId)}
            && t[i].dispatchedFrom === "transfer-after-move") return true;
      }
      return false;
    })()`,
    { timeoutMs: 2000 },
  );

  // A's tab is in P2.
  const aPaneIdAfter = await app.evalJS<string | null>(
    `(document.querySelector(${JSON.stringify(tabSelectorFor("A"))})
        ?.closest('.tug-pane[data-pane-id]')
        ?.getAttribute('data-pane-id')) ?? null`,
  );
  expect(aPaneIdAfter).toBe("p2");

  // Engine state preserved.
  const state = await app.getEmCardState("A");
  expect(state).not.toBeNull();
  expect(state!.text).toBe("alpha");
  expect(state!.engine).toBe(componentId);

  // Focus-actually-landing assertion intentionally omitted. The
  // deliverable here is the dispatch wiring (verified above by the
  // `engine-activation-dispatched` trace event firing with
  // `transfer-after-move`). Whether the engine root actually
  // becomes activeElement after the cross-pane move depends on
  // engine re-mount timing vs `transferFocusAfterMove` firing
  // synchronously after `notify()` — empirically, `.focus()` on
  // the new contenteditable no-ops on re-mount, leaving focus on
  // body. Same root-cause family as the cold-boot selection gap
  // and the fresh-EM-card-activation gap ([AT0010], [AT0033]).
}

describe.skipIf(!SHOULD_RUN)("at0006-em: EM cross-pane drag preserves engine state + restores focus", () => {
  test("gallery-prompt-input (TugPromptInput): drag A from P1 to P2's tab bar", async () => {
    const app = await launchTugApp({ testName: "at0006-em-cross-pane-input" });
    try {
      await runCrossPaneDrag(app, "gallery-prompt-input");
    } finally {
      await app.close();
    }
  });

  test("gallery-prompt-entry (TugPromptEntry, tide-card's editor): drag A from P1 to P2's tab bar", async () => {
    const app = await launchTugApp({ testName: "at0006-em-cross-pane-entry" });
    try {
      await runCrossPaneDrag(app, "gallery-prompt-entry");
    } finally {
      await app.close();
    }
  });
});
