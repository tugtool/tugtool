/**
 * at0034-em-focus-after-move.test.ts — focus actually lands on the
 * engine's contenteditable after a cross-pane drag and a detach
 * (focus-after-move, [AT0034]).
 *
 * ## Why this exists
 *
 * The dispatch-wiring contract for cross-pane move was closed in
 * `engine-activation-dispatched` fires with
 * `dispatchedFrom: "transfer-after-move"`, proving the framework
 * called `onCardActivated` on the moved card. But at0006-em /
 * at0007-em deliberately omit the focus-actually-landing assertion
 * because empirically, `.focus()` on the freshly re-mounted
 * contenteditable no-ops, leaving `document.activeElement` on
 * BODY. This test is the regression gate for that fix — once
 * gap-3 is closed, focus must land inside the engine's
 * contenteditable after both the cross-pane drag (m06 shape) and
 * the detach-to-standalone (m07 shape).
 *
 * ## Two scenarios per factory
 *
 *   1. Cross-pane drag (m06 shape): drag A from P1 to P2's tab
 *      bar; assert activeElement is the contenteditable.
 *   2. Detach to canvas void (m07 shape): drag A's tab to empty
 *      space; assert activeElement is the contenteditable.
 *
 * Each runs against both `gallery-prompt-input` (TugPromptInput
 * direct) and `gallery-prompt-entry` (TugPromptEntry, what
 * tide-card uses internally).
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

async function runCrossPaneFocus(app: App, componentId: string): Promise<void> {
  await app.enableDeckTrace(true);

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

  // Click into A's contenteditable so we have a saved-bag content
  // for `transferFocusAfterMove` to resolve.
  await app.nativeClickAtElement(`[data-card-id="A"] ${PROMPT_INPUT_SELECTOR}`);
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)})`,
  );
  await app.nativeType("alpha");

  // Drag A from P1 into P2's tab bar.
  await app.nativeDragElement(tabSelectorFor("A"), {
    selector: tabBarSelectorFor("p2"),
  });

  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && (window.__tug.getActiveCardId() === "A")`,
  );

  // Focus must land on A's contenteditable (now in P2). The
  // engine root is preserved across the move via the CardPortal
  // slot mechanism, so `.focus()` from the dispatch-activated
  // path should land on the same node.
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)}) && document.activeElement.closest('[data-card-id="A"]') !== null`,
    { timeoutMs: 2000 },
  );

  // Sanity: A is in P2.
  const aPaneIdAfter = await app.evalJS<string | null>(
    `(document.querySelector(${JSON.stringify(tabSelectorFor("A"))})
        ?.closest('.tug-pane[data-pane-id]')
        ?.getAttribute('data-pane-id')) ?? null`,
  );
  expect(aPaneIdAfter).toBe("p2");
}

async function runDetachFocus(app: App, componentId: string): Promise<void> {
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

  await app.nativeClickAtElement(`[data-card-id="A"] ${PROMPT_INPUT_SELECTOR}`);
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)})`,
  );
  await app.nativeType("alpha");

  await app.nativeDragElement(tabSelectorFor("A"), { x: 700, y: 500 });

  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && (window.__tug.getActiveCardId() === "A")`,
  );

  // Focus must land on A's contenteditable in the new standalone
  // pane. Same regression-gate assertion as the cross-pane case.
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)}) && document.activeElement.closest('[data-card-id="A"]') !== null`,
    { timeoutMs: 2000 },
  );
}

describe.skipIf(!SHOULD_RUN)("at0034-em: focus actually lands on engine's contenteditable after cross-pane move + detach", () => {
  test("cross-pane (gallery-prompt-input): focus lands in P2's contenteditable", async () => {
    const app = await launchTugApp({ testName: "at0034-em-cross-input" });
    try {
      await runCrossPaneFocus(app, "gallery-prompt-input");
    } finally {
      await app.close();
    }
  });

  test("cross-pane (gallery-prompt-entry): focus lands in P2's contenteditable", async () => {
    const app = await launchTugApp({ testName: "at0034-em-cross-entry" });
    try {
      await runCrossPaneFocus(app, "gallery-prompt-entry");
    } finally {
      await app.close();
    }
  });

  test("detach (gallery-prompt-input): focus lands in new standalone pane's contenteditable", async () => {
    const app = await launchTugApp({ testName: "at0034-em-detach-input" });
    try {
      await runDetachFocus(app, "gallery-prompt-input");
    } finally {
      await app.close();
    }
  });

  test("detach (gallery-prompt-entry): focus lands in new standalone pane's contenteditable", async () => {
    const app = await launchTugApp({ testName: "at0034-em-detach-entry" });
    try {
      await runDetachFocus(app, "gallery-prompt-entry");
    } finally {
      await app.close();
    }
  });
});
