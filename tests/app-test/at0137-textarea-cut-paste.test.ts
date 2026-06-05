/**
 * at0137-textarea-cut-paste.test.ts — Cut then Paste round-trips in TugTextarea,
 * driven entirely by TRUSTED native gestures.
 *
 * User-reported: type text, select-all + right-click + Cut, then right-click +
 * Paste — paste fails (text does not come back).
 *
 * Faithfulness note: every input here is a trusted CGEvent path — real typing
 * via `nativeType`, real menu "Select All" / Cut / Paste clicks via
 * `nativeRightClick` + `nativeClick`. No `evalJS .value=` / `setSelectionRange`
 * (those are isTrusted:false and bypass the AppKit field editor's real input /
 * undo / selection pipeline, which is exactly where this bug lives).
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const KEY = "gallery-textarea/size/md";
const taSel = (id: string): string =>
  `[data-card-id="${id}"] [data-tug-state-key="${KEY}"]`;

/** Settle pause between gestures — real users don't blast input. */
function pause(ms: number): Promise<void> {
  return new Promise<void>((resolve) =>
    (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => unknown }).setTimeout(
      () => resolve(),
      ms,
    ),
  );
}

async function clickMenuItem(
  app: Awaited<ReturnType<typeof launchTugApp>>,
  sel: string,
  label: string,
): Promise<boolean> {
  // Ensure no stale menu is open before opening a fresh one.
  await app.waitForCondition<boolean>(
    `document.querySelectorAll('.tug-menu-item').length === 0`,
  ).catch(() => {});
  await app.nativeRightClickAtElement(sel);
  await app.waitForCondition<boolean>(
    `!!Array.from(document.querySelectorAll('.tug-menu-item')).find(n => n.textContent && n.textContent.includes(${JSON.stringify(label)}))`,
  ).catch(() => {});
  await pause(200); // let the menu settle / highlight before clicking
  const pt = await app.evalJS<{ x: number; y: number; disabled: boolean } | null>(
    `(() => {
      const items = Array.from(document.querySelectorAll('.tug-menu-item'));
      const item = items.find(n => n.textContent && n.textContent.includes(${JSON.stringify(label)}));
      if (!item) return null;
      const r = item.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
               disabled: item.hasAttribute('data-disabled') };
    })()`,
  );
  if (!pt) {
    const seen = await app.evalJS<string[]>(
      `Array.from(document.querySelectorAll('.tug-menu-item')).map(n => n.textContent)`,
    );
    throw new Error(`menu item ${label} not found; items seen: ${JSON.stringify(seen)}`);
  }
  process.stderr.write(`\n[at0137] ${label} disabled=${pt.disabled}\n`);
  await app.nativeClick({ x: pt.x, y: pt.y });
  // Wait for the menu to dismiss so the next right-click opens a clean one.
  await app.waitForCondition<boolean>(
    `document.querySelectorAll('.tug-menu-item').length === 0`,
    { timeoutMs: 2000 },
  ).catch(() => {});
  return pt.disabled;
}

describe.skipIf(!SHOULD_RUN)("at0137-textarea-cut-paste", () => {
  test("type → menu Select All → menu Cut → menu Paste restores the text (trusted)", async () => {
    const app = await launchTugApp({ testName: "at0137-textarea-cut-paste" });
    try {
      await app.seedDeckState({
        state: {
          cards: [{ id: "A", componentId: "gallery-textarea", title: "A", closable: true }],
          panes: [
            {
              id: "p1",
              position: { x: 40, y: 40 },
              size: { width: 600, height: 500 },
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

      const sel = taSel("A");
      await app.waitForCondition<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`);

      // Trusted focus + trusted typing.
      await app.nativeClickAtElement(sel);
      await app.waitForCondition<boolean>(
        `document.activeElement && document.activeElement.matches(${JSON.stringify(sel)})`,
        { timeoutMs: 2000 },
      );
      await pause(200);
      await app.nativeType("hello");
      await app.waitForCondition<boolean>(
        `document.querySelector(${JSON.stringify(sel)}).value === "hello"`,
        { timeoutMs: 2000 },
      );
      await pause(250); // let typing settle before opening the menu

      // Select all via the trusted menu item (a native CGEvent ⌘A chord is
      // routed through windowserver and is unreliable per the harness README;
      // for a native textarea ⌘A is an AppKit field-editor command anyway).
      await clickMenuItem(app, sel, "Select All");
      await pause(200);
      const selAll = await app.evalJS<{ start: number; end: number; value: string }>(
        `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return { start: el.selectionStart, end: el.selectionEnd, value: el.value }; })()`,
      );
      process.stderr.write(`\n[at0137] afterSelectAll=${JSON.stringify(selAll)}\n`);

      // Menu Cut → field empties.
      await clickMenuItem(app, sel, "Cut");
      await app
        .waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(sel)}).value === ""`,
          { timeoutMs: 3000 },
        )
        .catch(() => {});
      const afterCut = await app.getFormControlValue("A", KEY);
      process.stderr.write(`\n[at0137] afterCut="${afterCut}"\n`);
      await pause(300); // user pause between cut and the next right-click

      // Menu Paste → text must come back.
      await clickMenuItem(app, sel, "Paste");
      await app
        .waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(sel)}).value === "hello"`,
          { timeoutMs: 4000 },
        )
        .catch(() => {});
      const afterPaste = await app.getFormControlValue("A", KEY);
      process.stderr.write(`\n[at0137] afterPaste="${afterPaste}"\n`);

      expect(afterCut).toBe("");
      expect(afterPaste).toBe("hello");
    } finally {
      await app.close();
    }
  });
});
