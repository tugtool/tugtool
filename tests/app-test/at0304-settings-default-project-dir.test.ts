/**
 * at0304-settings-default-project-dir.test.ts — the Settings card's General
 * tab persists the default project directory ([AT0304]).
 *
 * Scenario:
 *
 *   Open the Settings card via the same `show-card` control action the Swift
 *   Settings… (⌘,) menu item sends. Select the leading "General" tab, type a
 *   temp directory into the Default Project Directory field, and move focus
 *   off the field. Verify the value reached tugbank by reading it back over
 *   `GET /api/defaults/dev.tugtool.app/default-project-path` — the same HTTP
 *   surface the field's PUT went through, so the assertion covers the real
 *   write path rather than in-process store state.
 *
 *   The read is a fetch parked on a window global and polled by
 *   `waitForCondition`, because the harness's `evalJS` is synchronous and
 *   cannot await a promise.
 *
 * Gating
 * ------
 * `describe.skipIf(!SHOULD_RUN)`. CI and `bun x tsc --noEmit` runs without
 * `TUGAPP_APP_TEST=1` skip every test.
 *
 * @covers tugdeck/src/components/tugways/cards/settings-general-body.tsx
 * @covers tugdeck/src/components/tugways/cards/settings-card.tsx
 * @covers tugdeck/src/settings-api.ts
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const NO_AX = { skipAccessibilityPreflight: true } as const;

const GENERAL_TAB = '[data-testid="settings-card"] [role="tab"]';
const FIELD_INPUT =
  '[data-testid="settings-default-project-dir-field"] input';

describe.skipIf(!SHOULD_RUN)(
  "at0304: Settings ▸ General persists the default project directory",
  () => {
    test("typing a path and leaving the field writes it to tugbank", async () => {
      const dir = mkdtempSync(`${tmpdir()}/at0304-projects-`);
      const app = await launchTugApp({
        ...NO_AX,
        testName: "at0304-settings-default-project-dir",
      });
      try {
        await app.evalJS(
          `window.__tug.dispatchControlAction("show-card", { component: "settings" })`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-testid="settings-card"] [role="tablist"]') !== null`,
        );

        // "General" leads the strip; the card opens on "Session Card".
        expect(await app.getElementText(GENERAL_TAB)).toContain("General");
        await app.click(GENERAL_TAB);
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-testid="settings-general"]') !== null`,
        );

        // Type the path, then move focus to the tab bar. The field commits on
        // focus leaving it, so the write happens without an Enter press.
        await app.focusElement(FIELD_INPUT);
        await app.type(FIELD_INPUT, dir);
        expect(await app.getElementValue(FIELD_INPUT)).toBe(dir);
        await app.focusElement(GENERAL_TAB);

        // Read the value back over the defaults API. The field's write is a
        // fire-and-forget PUT, so a single GET can beat it to the server and
        // latch a 404 — poll until the key is there (or the poll times out and
        // the assertion below reports the last answer).
        await app.evalJS(`(() => {
          window.__at0304 = undefined;
          const poll = () => {
            fetch("/api/defaults/dev.tugtool.app/default-project-path")
              .then((r) => (r.ok ? r.json() : { kind: "error", value: r.status }))
              .then((j) => {
                if (j.kind === "string") { window.__at0304 = j; return; }
                window.setTimeout(poll, 100);
              })
              .catch((e) => { window.__at0304 = { kind: "error", value: String(e) }; });
          };
          poll();
        })()`);
        const stored = await app.waitForCondition<{
          kind: string;
          value: unknown;
        }>(
          `window.__at0304 === undefined ? false : window.__at0304`,
          { timeoutMs: 5000 },
        );
        expect(stored.kind).toBe("string");
        expect(stored.value).toBe(dir);
      } finally {
        await app.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  },
);
