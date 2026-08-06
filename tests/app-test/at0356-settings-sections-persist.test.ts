/**
 * at0356-settings-sections-persist.test.ts — the Settings card remembers
 * which sections you closed ([AT0356]).
 *
 * Two claims, and the second is the one with teeth.
 *
 * **Nothing is collapsed until you collapse something.** What is persisted is
 * the collapsed set, not the open set, so a profile that has never stored
 * anything opens with every section expanded — and so does a profile that
 * predates a section being added. The test starts from a genuinely absent key
 * (DELETE, not "set to empty") because those are different states and only
 * the absent one is what a new user has.
 *
 * **A collapse outlives the card.** Settings is a singleton that is closed
 * and reopened constantly, and its card state is pruned along with it, so the
 * arrangement is kept in a standalone tugbank domain instead. Closing the
 * card and opening a new one has to bring the reader's arrangement back, or
 * the setting is only a setting until the next ⌘W.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/components/tugways/cards/settings-card.tsx
 * @covers tugdeck/src/lib/settings-sections-pref.ts
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const NO_AX = { skipAccessibilityPreflight: true } as const;

const DOMAIN = "dev.tugtool.settings-card";
const KEY = "collapsedSections";

const SETTINGS_CARD = '[data-testid="settings-card"]';
const SECTION = '[data-testid^="settings-section-"]';

/** Expression: the section ids currently rendered open, in document order. */
const OPEN_SECTION_IDS = `Array.from(
  document.querySelectorAll(${JSON.stringify(`${SETTINGS_CARD} ${SECTION}[data-state="open"]`)}),
).map((el) => el.getAttribute("data-testid").replace("settings-section-", ""))`;

/** Expression: how many section items the card renders at all. */
const SECTION_COUNT = `document.querySelectorAll(
  ${JSON.stringify(`${SETTINGS_CARD} ${SECTION}`)},
).length`;

const SHOW_SETTINGS = `window.__tug.dispatchControlAction("show-card", { component: "settings" })`;

describe.skipIf(!SHOULD_RUN)("at0356: Settings remembers collapsed sections", () => {
  test("opens all-expanded with no stored value, and a collapse survives close and reopen", async () => {
    const app = await launchTugApp({
      ...NO_AX,
      testName: "at0356-settings-sections-persist",
    });
    try {
      await app.waitForCondition<boolean>(
        `typeof window.__tug !== "undefined" && typeof window.tugdeck !== "undefined"`,
      );

      // ---- Start from "never set" — not "set to empty", which is a state a
      //      reader can reach but a new profile cannot.
      await app.evalJS(`(() => {
        window.__at0356_cleared = false;
        fetch("/api/defaults/${DOMAIN}/${KEY}", { method: "DELETE" })
          .then(() => { window.__at0356_cleared = true; })
          .catch(() => { window.__at0356_cleared = true; });
      })()`);
      await app.waitForCondition<boolean>(`window.__at0356_cleared === true`);

      // ---- First open: every section expanded.
      await app.evalJS(SHOW_SETTINGS);
      await app.waitForCondition<boolean>(`${SECTION_COUNT} === 4`, {
        timeoutMs: 8000,
      });
      await app.waitForCondition<boolean>(`${OPEN_SECTION_IDS}.length === 4`, {
        timeoutMs: 8000,
      });
      expect(await app.evalJS<string[]>(OPEN_SECTION_IDS)).toEqual([
        "general",
        "sessionCard",
        "textCard",
        "app",
      ]);

      // ---- Collapse one, by the gesture a reader makes: clicking its header.
      //      The testid is on the item, so the clickable node is the trigger
      //      inside it.
      await app.click(
        '[data-testid="settings-section-textCard"] .tug-accordion-trigger',
      );
      await app.waitForCondition<boolean>(
        `${OPEN_SECTION_IDS}.length === 3`,
        { timeoutMs: 8000 },
      );

      // The write landed in tugbank as the collapsed set — one id, the one
      // that was closed.
      await app.evalJS(`(() => {
        window.__at0356_stored = undefined;
        const poll = () => {
          fetch("/api/defaults/${DOMAIN}/${KEY}")
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => {
              if (j && j.kind === "json") { window.__at0356_stored = j; return; }
              window.setTimeout(poll, 100);
            })
            .catch((e) => {
              window.__at0356_stored = { kind: "error", value: String(e) };
            });
        };
        poll();
      })()`);
      const stored = await app.waitForCondition<{ kind: string; value: unknown }>(
        `window.__at0356_stored === undefined ? false : window.__at0356_stored`,
        { timeoutMs: 8000 },
      );
      expect(stored.kind).toBe("json");
      expect(stored.value).toEqual(["textCard"]);

      // ---- Close the card, then open a fresh one.
      const settingsPaneId = await app.evalJS<string>(
        `(() => {
          const s = window.tugdeck.diag.getDeckState();
          const card = s.cards.find((c) => c.componentId === "settings");
          return s.panes.find((p) => p.cardIds.includes(card.id)).id;
        })()`,
      );
      await app.evalJS(
        `window.__tug.closePane(${JSON.stringify(settingsPaneId)})`,
      );
      await app.waitForCondition<boolean>(
        `document.querySelector(${JSON.stringify(SETTINGS_CARD)}) === null`,
        { timeoutMs: 8000 },
      );

      await app.evalJS(SHOW_SETTINGS);
      await app.waitForCondition<boolean>(`${SECTION_COUNT} === 4`, {
        timeoutMs: 8000,
      });

      // ---- The reader's arrangement came back: three open, and the one they
      //      closed is still closed.
      await app.waitForCondition<boolean>(`${OPEN_SECTION_IDS}.length === 3`, {
        timeoutMs: 8000,
      });
      expect(await app.evalJS<string[]>(OPEN_SECTION_IDS)).toEqual([
        "general",
        "sessionCard",
        "app",
      ]);
      expect(
        await app.evalJS<string | null>(
          `document.querySelector(
            '[data-testid="settings-section-textCard"]',
          ).getAttribute("data-state")`,
        ),
      ).toBe("closed");
    } finally {
      await app.close();
    }
  });
});
