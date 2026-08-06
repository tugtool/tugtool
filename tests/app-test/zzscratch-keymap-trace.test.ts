/**
 * zzscratch-keymap-trace.test.ts — nothing moves when a row arms.
 *
 * @covers tugdeck/src/components/tugways/cards/settings-keymap-body.tsx
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

describe.skipIf(!SHOULD_RUN)("scratch keymap scroll trace", () => {
  test(
    "arming holds the position",
    async () => {
      const app = await launchTugApp({ testName: "zzscratch-trace" });
      try {
        await app.waitForCondition<boolean>(
          `typeof window.__tug !== "undefined" && typeof window.tugdeck !== "undefined"`,
        );
        await app.evalJS(`window.__tug.dispatchControlAction("show-keyboard-shortcuts", {})`);
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-testid="settings-keymap"]') !== null`,
          { timeoutMs: 8000 },
        );

        const SCROLLER = `document.querySelector('[data-testid="settings-keymap"] .tug-list-view')`;
        const probe = async (id: string) =>
          await app.evalJS<{ top: number; rowTop: number }>(`(() => {
            const s = ${SCROLLER};
            const a = document.querySelector('[data-testid="${id}"]');
            return { top: s.scrollTop, rowTop: Math.round(a.getBoundingClientRect().top) };
          })()`);

        for (const where of ["max", "half"] as const) {
          await app.evalJS(
            `(() => { const s = ${SCROLLER};
              s.scrollTop = ${where === "max" ? "s.scrollHeight" : "Math.round(s.scrollHeight / 2)"};
            })()`,
          );
          await new Promise((r) => setTimeout(r, 600));

          // Every row currently on screen, one at a time.
          const ids = await app.evalJS<string[]>(`(() => {
            const s = ${SCROLLER};
            const r = s.getBoundingClientRect();
            return [...document.querySelectorAll('[data-testid^="keymap-arm-"]')]
              .filter((a) => { const b = a.getBoundingClientRect();
                               return b.top >= r.top && b.bottom <= r.bottom; })
              .map((a) => a.getAttribute("data-testid"));
          })()`);

          const moved: string[] = [];
          for (const id of ids) {
            const before = await probe(id);
            await app.click(`[data-testid="${id}"]`);
            await new Promise((r) => setTimeout(r, 250));
            const after = await probe(id);
            if (after.top !== before.top || after.rowTop !== before.rowTop) {
              moved.push(`${id} top ${before.top}->${after.top} rowTop ${before.rowTop}->${after.rowTop}`);
            }
            await app.click('[data-testid="keymap-capture-cancel"]');
            await new Promise((r) => setTimeout(r, 200));
          }
          console.log(`${where.toUpperCase()}: ${ids.length} rows, moved =`, JSON.stringify(moved));
          expect(moved, `${where}: nothing moves when a row arms`).toEqual([]);
        }
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
