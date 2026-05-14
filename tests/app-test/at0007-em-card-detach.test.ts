/**
 * at0007-em-card-detach.test.ts — EM-card detach to a new standalone
 * pane preserves engine state and dispatches `onCardActivated`
 * on the moved card ([AT0007] EM-half).
 *
 * Mirrors `at0007-card-detach.test.ts` (the FC-half) but with EM
 * cards. After detach, `transferFocusAfterMove` resolves the
 * dragged card as `dispatch-activated` (EM has bag.content from
 * the drag-start save) and dispatches via
 * `invokeActivationCallback(cardId, "transfer-after-move")`.
 *
 * Coverage: `gallery-prompt-entry` (TugPromptEntry, what tide-card
 * uses internally). The legacy `gallery-prompt-input` was retired.
 *
 * ## Focus-actually-landing assertion
 *
 * Intentionally omitted, same rationale as `at0006-em-cross-pane`:
 * focus on the engine root after a re-mount is timing-dependent
 * and tracked as a related gap in focus timing; the
 * deliverable here is the dispatch wiring, verified by the
 * trace event firing.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const PROMPT_INPUT_SELECTOR = '[data-slot="tug-text-editor"] .cm-content';

function tabSelectorFor(cardId: string): string {
  return `[data-testid="tug-tab-${cardId}"]`;
}

async function runDetach(app: App, componentId: string): Promise<void> {
  await app.enableDeckTrace(true);

  // Seed P1=[A=EM, B=FC] active=A. P1 needs at least two cards
  // since `_detachCard` rejects detaching the last card.
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
          size: { width: 400, height: 320 },
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
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.awaitEngineReady("A");

  // Type "alpha" so we have saved engine state to verify
  // post-detach.
  await app.nativeClickAtElement(`[data-card-id="A"] ${PROMPT_INPUT_SELECTOR}`);
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)})`,
  );
  await app.nativeType("alpha");
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && (window.__tug.getEmCardState("A")?.text === "alpha")`,
    { timeoutMs: 2000 },
  );

  // Drag A's tab to clearly-empty canvas space (700, 500). Drop
  // resolves to detach-mode → new standalone pane carrying A.
  const markBeforeDetach = await app.markDeckTrace();
  await app.nativeDragElement(tabSelectorFor("A"), { x: 700, y: 500 });

  // A re-registers its host root in the new pane.
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && (window.__tug.getActiveCardId() === "A")`,
  );

  // Two panes after detach.
  const paneCount = await app.evalJS<number>(
    `document.querySelectorAll('.tug-pane[data-pane-id]').length`,
  );
  expect(paneCount).toBe(2);

  // The detach routes through `transferFocusAfterMove` → the
  // single-channel `applyBagFocus` dispatcher (Phase E.11), which
  // invokes A's registered engine hook — recorded as
  // `engine-paint-mirror-active` with `caller: "via-engine-hook"`.
  // (Pre-E.11 the equivalent gate was `engine-activation-dispatched`
  // with `dispatchedFrom: "transfer-after-move"`; that path is retired.)
  await app.waitForCondition<boolean>(
    `(function(){
      var t = window.__tug.getDeckTrace({since: ${markBeforeDetach}});
      for (var i = 0; i < t.length; i++) {
        if (t[i].kind === "engine-paint-mirror-active"
            && t[i].cardId === "A"
            && t[i].caller === "via-engine-hook") return true;
      }
      return false;
    })()`,
    { timeoutMs: 2000 },
  );

  // Engine state preserved across the detach.
  const state = await app.getEmCardState("A");
  expect(state).not.toBeNull();
  expect(state!.text).toBe("alpha");
  expect(state!.engine).toBe(componentId);
}

describe.skipIf(!SHOULD_RUN)("at0007-em: EM card detach to new standalone pane preserves engine state + dispatches onCardActivated", () => {
  test("gallery-prompt-entry (TugPromptEntry, tide-card's editor): drag A out of P1 to canvas void", async () => {
    const app = await launchTugApp({ testName: "at0007-em-detach-entry" });
    try {
      await runDetach(app, "gallery-prompt-entry");
    } finally {
      await app.close();
    }
  });
});
