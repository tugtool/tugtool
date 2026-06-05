/**
 * at0136-stale-reapply-clobber.test.ts — a live edit must never be clobbered by
 * a saved form-control snapshot when the user clicks back into the field.
 *
 * User-reported: in TugInput, type text, delete it, right-click — the deleted
 * text REAPPEARS. The empty-TugTextarea "paste does nothing on the second use"
 * report shared the same cause. Root cause was a now-removed mechanism
 * (`installFormControlReapplyOnNextMousedown` in focus-transfer.ts): after a
 * cross-card activation it armed a one-shot capture-phase mousedown handler
 * that re-wrote the saved snapshot's value+selection into whatever field the
 * next click landed on. When the live value had diverged from the snapshot,
 * that re-write clobbered the live edit.
 *
 * Saved values are still preserved across remount (cold boot / reload / HMR /
 * tab unmount-remount) by the ONE mount-time restore in card-host.tsx — that
 * path is untouched (see at0001). What is gone is any re-write of a live,
 * mounted field on a mouse interaction. The live DOM is the sole authority once
 * the field is mounted.
 *
 * Repro: two visible gallery-input cards. Seed a saved snapshot for card A,
 * diverge A's live value to empty, then click back into A (cross-card B→A
 * activation). Pre-fix this snapped A's value back to the stale snapshot;
 * now the live empty value survives.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const KEY = "gallery-input/size/sm";
const inputSel = (id: string): string =>
  `[data-card-id="${id}"] [data-tug-state-key="${KEY}"]`;

describe.skipIf(!SHOULD_RUN)("at0136-stale-reapply-clobber", () => {
  test("clicking back into a diverged field leaves the live value untouched", async () => {
    const app = await launchTugApp({ testName: "at0136-stale-reapply-clobber" });
    try {
      await app.enableDeckTrace(true);
      await app.seedDeckState({
        state: {
          cards: [
            { id: "A", componentId: "gallery-input", title: "A", closable: true },
            { id: "B", componentId: "gallery-input", title: "B", closable: true },
          ],
          panes: [
            {
              id: "p1",
              position: { x: 20, y: 20 },
              size: { width: 460, height: 320 },
              cardIds: ["A"],
              activeCardId: "A",
              title: "",
              acceptsFamilies: ["developer"],
            },
            {
              id: "p2",
              position: { x: 520, y: 20 },
              size: { width: 460, height: 320 },
              cardIds: ["B"],
              activeCardId: "B",
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

      // Put "abc" in A's input and click into it so A is the active card.
      await app.evalJS(
        `(() => { const el = document.querySelector(${JSON.stringify(inputSel("A"))}); el.value = "abc"; el.dispatchEvent(new Event("input", { bubbles: true })); })()`,
      );
      await app.nativeClickAtElement(inputSel("A"));

      // Force a save so A's form-control snapshot captures "abc".
      const mark = await app.markDeckTrace();
      await app.simulateAppResign().catch(() => {});
      await app
        .waitForCondition<boolean>(
          `(() => { const t = window.__tug.getDeckTrace({ since: ${mark} }); return t.some(e => e.kind === "save-callback"); })()`,
          { timeoutMs: 3000 },
        )
        .catch(() => {});
      await app.simulateAppBecomeActive().catch(() => {});

      // Activate B (cross-card), then diverge A's live value to empty WITHOUT a
      // save (direct .value, no input event that would re-capture).
      await app.nativeClickAtElement(inputSel("B"));
      await app.evalJS(`(() => { document.querySelector(${JSON.stringify(inputSel("A"))}).value = ""; })()`);

      const beforeClickBack = await app.getFormControlValue("A", KEY);

      // Click back into A (cross-card B→A activation). The live empty value
      // must survive — no stale-snapshot re-write.
      await app.nativeClickAtElement(inputSel("A"));
      await app.waitForCondition<boolean>(`true`).catch(() => {});

      const afterClickBack = await app.getFormControlValue("A", KEY);
      process.stderr.write(
        `\n[at0136] before="${beforeClickBack}" after="${afterClickBack}"\n`,
      );

      expect(beforeClickBack).toBe("");
      expect(afterClickBack).toBe("");
    } finally {
      await app.close();
    }
  });
});
