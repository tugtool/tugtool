/**
 * at0155-settings-propagation.test.ts — Settings card edits propagate
 * to open Dev cards ([AT0155]).
 *
 * Scenario:
 *
 *   Seed a Session card, bind a fake session so the prompt editor mounts,
 *   and read its CodeMirror line-wrap state (the `cm-lineWrapping`
 *   class on `.cm-content`). Open the Settings card via the same
 *   `show-card` control action the Swift Settings… (⌘,) menu item
 *   sends, click the **Line wrap** switch in the Session Card tab, and
 *   verify the Session card's editor flips its wrap state.
 *
 *   This exercises the full cross-instance path: the Settings card's
 *   own `EditorSettingsStore` persists to the global tugbank domain
 *   (`dev.tugtool.editor`), tugcast pushes the DEFAULTS frame, and the
 *   Session card's store instance picks it up via `onDomainChanged` — no
 *   shared store instance anywhere.
 *
 *   The initial wrap state is read, not assumed: the test tugbank may
 *   carry persisted settings from earlier runs, so the assertion is
 *   "the state flips", not "it becomes false". A second click flips it
 *   back, restoring whatever state the run started with.
 *
 * Gating
 * ------
 * `describe.skipIf(!SHOULD_RUN)`. CI and `bun x tsc --noEmit` runs
 * without `TUGAPP_APP_TEST=1` skip every test.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const SESSION_CM_CONTENT = '[data-card-id="A"] [data-slot="tug-text-editor"] .cm-content';
const LINE_WRAP_SWITCH =
  '[data-testid="settings-general"] [data-slot="tug-switch"]';

/** Expression: whether the Dev editor's CodeMirror content wraps lines. */
const SESSION_WRAP_STATE = `(() => {
  const el = document.querySelector(${JSON.stringify(SESSION_CM_CONTENT)});
  return el !== null && el.classList.contains("cm-lineWrapping");
})()`;

describe.skipIf(!SHOULD_RUN)("at0155: Settings Session Card edits reach open Dev cards", () => {
  test("toggling Line wrap in Settings flips the Dev editor's wrap state", async () => {
    const app = await launchTugApp({ testName: "at0155-settings-propagation" });
    try {
      // `awaitEngineReady` reads the deck-trace ring; recording is off
      // by default, so enable it before the engine mounts.
      await app.enableDeckTrace(true);

      // ---- Seed a Session card and bind a fake session so the editor mounts.
      await app.seedDeckState({
        state: {
          cards: [
            { id: "A", componentId: "session", title: "Session A", closable: true },
          ],
          panes: [
            {
              id: "p1",
              position: { x: 40, y: 40 },
              size: { width: 820, height: 540 },
              cardIds: ["A"],
              activeCardId: "A",
              title: "",
              acceptsFamilies: ["maker"],
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
      await app.bindSession("A");
      await app.awaitEngineReady("A");
      await app.waitForCondition<boolean>(
        `document.querySelector(${JSON.stringify(SESSION_CM_CONTENT)}) !== null`,
      );
      const initialWrap = await app.evalJS<boolean>(SESSION_WRAP_STATE);

      // ---- Open the Settings card (same control action as ⌘,).
      await app.evalJS(
        `window.__tug.dispatchControlAction("show-card", { component: "settings" })`,
      );
      await app.waitForCondition<boolean>(
        `document.querySelector('[data-testid="settings-card"]') !== null`,
      );
      await app.waitForCondition<boolean>(
        `document.querySelector('[data-testid="settings-general"]') !== null`,
      );
      await app.waitForCondition<boolean>(
        `document.querySelector(${JSON.stringify(LINE_WRAP_SWITCH)}) !== null`,
      );

      // ---- Click Line wrap (the first switch in the Session Card tab) and
      //      wait for the Dev editor to flip.
      await app.nativeClickAtElement(LINE_WRAP_SWITCH);
      await app.waitForCondition<boolean>(`${SESSION_WRAP_STATE} === ${!initialWrap}`);
      expect(await app.evalJS<boolean>(SESSION_WRAP_STATE)).toBe(!initialWrap);

      // ---- Flip back, restoring the run's starting state.
      await app.nativeClickAtElement(LINE_WRAP_SWITCH);
      await app.waitForCondition<boolean>(`${SESSION_WRAP_STATE} === ${initialWrap}`);
    } finally {
      await app.close();
    }
  });
});
