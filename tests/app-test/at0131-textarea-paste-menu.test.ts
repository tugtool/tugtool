/**
 * at0131-textarea-paste-menu.test.ts — Reproduce the real menu-paste flow on
 * an EMPTY TugTextarea vs a NON-EMPTY one.
 *
 * User report: "Paste does not work in an empty tug-textarea. The other
 * components seem fine." Raw `execCommand("insertText")` works on an empty
 * textarea (at0130), so the defect is in the tug paste path, not WebKit. This
 * drives the actual gesture: set the system clipboard (pbcopy → NSPasteboard,
 * read by the native bridge), right-click the textarea to open the context
 * menu, click Paste, and assert the value updated.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const taSel = (id: string, key: string): string =>
  `[data-card-id="${id}"] [data-tug-state-key="${key}"]`;

function setClipboard(text: string): void {
  Bun.spawnSync(["pbcopy"], { stdin: Buffer.from(text) });
}

async function pasteViaMenu(
  app: Awaited<ReturnType<typeof launchTugApp>>,
  sel: string,
  cardId: string,
  key: string,
  pasted: string,
): Promise<string | null> {
  // Bring the target into the visible frame so native gestures land.
  await app.evalJS(
    `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.scrollIntoView({ block: "center" }); })()`,
  );
  await app.nativeRightClickAtElement(sel);
  await app.waitForCondition<boolean>(
    `!!Array.from(document.querySelectorAll('.tug-menu-item')).find(n => n.textContent && n.textContent.includes('Paste'))`,
  );
  const pastePoint = await app.evalJS<{ x: number; y: number } | null>(
    `(() => {
      const item = Array.from(document.querySelectorAll('.tug-menu-item'))
        .find(n => n.textContent && n.textContent.includes('Paste'));
      if (!item) return null;
      const r = item.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`,
  );
  if (!pastePoint) throw new Error("Paste item not found");
  await app.nativeClick({ x: pastePoint.x, y: pastePoint.y });
  await app
    .waitForCondition<boolean>(
      `window.__tug.getFormControlValue(${JSON.stringify(cardId)}, ${JSON.stringify(key)}) === ${JSON.stringify(pasted)}`,
      { timeoutMs: 4000 },
    )
    .catch(() => {});
  return app.getFormControlValue(cardId, key);
}

describe.skipIf(!SHOULD_RUN)("at0131-textarea-paste-menu", () => {
  // Each case: [label, persistKey, preFocus?]
  const CASES: Array<[string, string, boolean]> = [
    ["empty / no pre-focus", "gallery-textarea/size/sm", false],
    ["empty / pre-focused (caret blinking)", "gallery-textarea/size/md", true],
    ["empty / autoResize", "gallery-textarea/auto-resize/unbounded", false],
    ["empty / autoResize pre-focused", "gallery-textarea/auto-resize/max-rows-5", true],
  ];

  for (const [label, KEY, preFocus] of CASES) {
    test(`right-click → Paste fills: ${label}`, async () => {
      const PASTED = "PASTED-FROM-CLIPBOARD";
      setClipboard(PASTED);

      const app = await launchTugApp({ testName: "at0131-textarea-paste-menu" });
      try {
        await app.seedDeckState({
          state: {
            cards: [
              { id: "A", componentId: "gallery-textarea", title: "Card A", closable: true },
            ],
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

        const sel = taSel("A", KEY);
        await app.waitForCondition<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`);

        if (preFocus) {
          await app.evalJS(
            `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.scrollIntoView({ block: "center" }); })()`,
          );
          await app.nativeClickAtElement(sel);
          await app.waitForCondition<boolean>(
            `document.activeElement && document.activeElement.matches(${JSON.stringify(sel)})`,
          );
        }

        const before = await app.getFormControlValue("A", KEY);
        const after = await pasteViaMenu(app, sel, "A", KEY, PASTED);
        process.stderr.write(`\n[at0131] ${label}: before="${before}" after="${after}"\n`);

        expect(after).toBe(PASTED);
      } finally {
        await app.close();
      }
    });
  }
});
