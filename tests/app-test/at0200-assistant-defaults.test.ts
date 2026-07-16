/**
 * at0200-assistant-defaults.test.ts — Settings → Assistant edits the deck
 * defaults through the same rich chips + sheets as the Z4B row, per-card
 * changes never disturb the defaults or other cards, and a saved model the
 * catalog no longer offers raises the card bulletin ([AT0200]).
 *
 * ## What this pins
 *
 *   1. **One editor, honest data.** The Assistant box renders the actual
 *      `ModelChip` / `PermissionModeChip` / `EffortChip` (no `TugPopupButton`
 *      remains for these three), and pressing one opens the same rich sheet
 *      the Z4B chip opens — title + description rows, not a dropdown. Before
 *      any session has ever reported capabilities there is NO model catalog
 *      and NO hardcoded list: the picker offers the single Default row with
 *      an explanation, and fills with real rows once capabilities persist.
 *   2. **Label parity + seeding.** Picking a default (Sonnet) updates the
 *      Settings chip AND seeds a card whose session then reports readiness —
 *      the two chips show the byte-identical label.
 *   3. **Isolation.** Changing one card's model through its own Z4B picker
 *      leaves the deck default and every other open card unchanged.
 *   4. **Bulletin.** A persisted per-card selector absent from the persisted
 *      live catalog raises the pane-modal alert at card mount, resets the
 *      card to Default, and its confirm opens the Settings card.
 *
 * Capabilities are injected via `ingestSessionMetadata` (the chip's
 * SESSION_SIDEBAND seam — no live claude needed); tugbank state is seeded
 * through the `setTugbankValue` surface, which drives the same local-cache +
 * onDomainChanged path a real write does.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

const SETTINGS = '[data-testid="settings-general"]';
const SETTINGS_MODEL_CHIP = `${SETTINGS} [data-slot="model-chip"]`;
// The overlay's ACTIVE face only — the width stabilizer also renders hidden
// sizer alternates whose text would pollute a plain textContent read.
const SETTINGS_MODEL_VALUE = `${SETTINGS_MODEL_CHIP} [data-slot="model-value"] [data-tug-stable="active"]`;
const SETTINGS_MODE_CHIP = `${SETTINGS} [data-slot="permission-mode-chip"]`;
const SETTINGS_EFFORT_CHIP = `${SETTINGS} [data-slot="effort-chip"]`;
// Sheets portal into their host PANE's frame and linger through the exit
// animation — scope every sheet read/click to the pane that owns it so a
// closing sheet in another pane can never swallow a click.
const SETTINGS_SHEET =
  '.tug-pane:has([data-testid="settings-card"]) [data-slot="tug-sheet"]';
const CARD_A_SHEET = '[data-pane-id="p1"] [data-slot="tug-sheet"]';

const cardModelValue = (cardId: string): string =>
  `[data-card-id="${cardId}"] [data-slot="model-chip"] [data-slot="model-value"] [data-tug-stable="active"]`;

/** Capability payload matching the terminal's three-selector model list. */
function capabilities() {
  return {
    type: "session_capabilities",
    models: [
      {
        value: "default",
        displayName: "Default (recommended)",
        description: "Opus 4.8 with 1M context · Most capable for complex work",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      },
      {
        value: "sonnet",
        displayName: "Sonnet",
        description: "Sonnet 4.6 · Best for everyday tasks",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "max"],
      },
      { value: "haiku", displayName: "Haiku" },
    ],
    commands: [],
    agents: [],
    available_output_styles: [],
    output_style: "default",
    account: null,
    effort: null,
    ipc_version: 2,
  };
}

/** One pane per card, side by side, so every card's Z4B row stays visible. */
function deckShape(cardIds: string[]) {
  return {
    cards: cardIds.map((id) => ({
      id,
      componentId: "session",
      title: `Dev ${id}`,
      closable: true,
    })),
    panes: cardIds.map((id, i) => ({
      id: `p${i + 1}`,
      position: { x: 40 + i * 660, y: 40 },
      size: { width: 640, height: 560 },
      cardIds: [id],
      activeCardId: id,
      title: "",
      acceptsFamilies: ["maker"],
    })),
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** Trimmed text content at `selector`, or null when absent. */
async function textAt(app: App, selector: string): Promise<string | null> {
  return await app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      return el ? el.textContent.trim() : null;
    })()`,
  );
}

async function waitForText(
  app: App,
  selector: string,
  text: string,
): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      return el !== null && el.textContent.trim() === ${JSON.stringify(text)};
    })()`,
    { timeoutMs: 8000 },
  );
}

describe.skipIf(!SHOULD_RUN)(
  "AT0200: Assistant defaults are chip+sheet edited, isolated per card, and guarded by the bulletin",
  () => {
    test(
      "Settings chips open the rich sheets; a picked default seeds a card with an identical label; per-card picks stay isolated",
      async () => {
        const app = await launchTugApp({ testName: "at0200-assistant-defaults" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({
            state: deckShape(["A", "B"]),
            focusCardId: "A",
          });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
          );
          await app.bindSession("A");
          await app.awaitEngineReady("A");
          await app.bindSession("B");
          await app.awaitEngineReady("B");

          // ---- Open Settings (same control action as ⌘,).
          await app.evalJS(
            `window.__tug.dispatchControlAction("show-card", { component: "settings" })`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SETTINGS)}) !== null`,
          );

          // ---- All three Assistant controls are the real chips, and the old
          //      Permission Mode dropdown is gone.
          for (const chip of [
            SETTINGS_MODE_CHIP,
            SETTINGS_MODEL_CHIP,
            SETTINGS_EFFORT_CHIP,
          ]) {
            expect(
              await app.evalJS<boolean>(
                `document.querySelector(${JSON.stringify(chip)}) !== null`,
              ),
              `Assistant renders the chip ${chip}`,
            ).toBe(true);
          }
          expect(
            await app.evalJS<boolean>(
              `document.querySelector('.settings-general-popup-mode') === null`,
            ),
            "no TugPopupButton remains for the permission-mode default",
          ).toBe(true);

          // Deck default is the `default` zero-state and NO session has ever
          // reported capabilities → no catalog exists. The chip says exactly
          // what is known: "Default" — never a hardcoded model label.
          expect(await textAt(app, SETTINGS_MODEL_VALUE)).toBe("Default");

          // ---- Fresh install, no catalog: the picker offers the single
          //      honest Default row whose description explains that the full
          //      list arrives after the first request — no invented models.
          await app.click(SETTINGS_MODEL_CHIP);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(`${SETTINGS_SHEET} [data-model="default"]`)}) !== null`,
            { timeoutMs: 4000 },
          );
          const placeholderState = await app.evalJS<{
            rows: number;
            text: string;
          }>(
            `(function(){
              var rows = document.querySelectorAll(${JSON.stringify(`${SETTINGS_SHEET} [data-model]`)});
              return {
                rows: rows.length,
                text: rows.length === 1 ? rows[0].textContent : "",
              };
            })()`,
          );
          expect(
            placeholderState.rows,
            "no catalog → exactly one Default row, nothing invented",
          ).toBe(1);
          expect(
            placeholderState.text,
            "the placeholder row explains why the list is short",
          ).toContain("first request");
          await app.click(`${SETTINGS_SHEET} [data-slot="model-picker-cancel"]`);

          // ---- A session reports capabilities → the Session card persists the
          //      live catalog. Every chip now shows the account default's
          //      "name with version" title, derived from claude's own
          //      description wording via the one resolveModelLabel path.
          await app.ingestSessionMetadata("A", capabilities());
          await waitForText(app, cardModelValue("A"), "Opus 4.8 · 1M");
          await waitForText(app, SETTINGS_MODEL_VALUE, "Opus 4.8 · 1M");
          expect(
            await textAt(app, cardModelValue("A")),
            "Settings and Z4B render the identical title for the same state",
          ).toBe(await textAt(app, SETTINGS_MODEL_VALUE));
          const settingsChipWidthBefore = await app.evalJS<number | null>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(SETTINGS_MODEL_CHIP)});
              return el ? Math.round(el.getBoundingClientRect().width * 100) / 100 : null;
            })()`,
          );

          // ---- The model chip opens the rich picker sheet: title +
          //      description rows with the Default row checkmarked.
          await app.click(SETTINGS_MODEL_CHIP);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(`${SETTINGS_SHEET} [data-model="sonnet"]`)}) !== null`,
            { timeoutMs: 4000 },
          );
          const sheetState = await app.evalJS<{
            rows: number;
            subtitled: number;
            selected: string[];
          }>(
            `(function(){
              var rows = document.querySelectorAll(${JSON.stringify(`${SETTINGS_SHEET} [data-model]`)});
              var subtitled = 0;
              var selected = [];
              for (var i = 0; i < rows.length; i++) {
                // Rich row = a description line under the title (a second
                // label inside the row content) — a dropdown item has none.
                var content = rows[i].querySelector('.tug-list-row-content');
                if (content && content.children.length > 1) subtitled++;
                if (rows[i].getAttribute('data-selected') === 'true') {
                  var t = rows[i].querySelector('.tug-list-row-title');
                  selected.push((t ? t.textContent : rows[i].textContent).trim());
                }
              }
              return { rows: rows.length, subtitled: subtitled, selected: selected };
            })()`,
          );
          expect(sheetState.rows, "the sheet offers the catalog's rows").toBeGreaterThanOrEqual(3);
          expect(
            sheetState.subtitled,
            "rows are rich (title + description), not dropdown items",
          ).toBeGreaterThanOrEqual(2);
          expect(
            sheetState.selected,
            "the Default row is checkmarked for the zero-state",
          ).toEqual(["Default (recommended)"]);

          // ---- Pick Sonnet as the deck default. The chip title is the
          //      row's name-with-version, from claude's own wording.
          await app.click(`${SETTINGS_SHEET} [data-model="sonnet"]`);
          await app.click(`${SETTINGS_SHEET} [data-slot="model-picker-ok"]`);
          await waitForText(app, SETTINGS_MODEL_VALUE, "Sonnet 4.6");

          // Width stability: the chip reserves every known row's title, so
          // changing the default never reflows it.
          expect(
            await app.evalJS<number | null>(
              `(function(){
                var el = document.querySelector(${JSON.stringify(SETTINGS_MODEL_CHIP)});
                return el ? Math.round(el.getBoundingClientRect().width * 100) / 100 : null;
              })()`,
            ),
            "the Settings model chip must not reflow across default values",
          ).toBe(settingsChipWidthBefore);

          // ---- Card A's session is knowable (capabilities landed above), so
          //      the seed aligns it to the new deck default, and the Z4B label
          //      matches Settings byte-for-byte.
          await waitForText(app, cardModelValue("A"), "Sonnet 4.6");
          expect(await textAt(app, cardModelValue("A"))).toBe(
            await textAt(app, SETTINGS_MODEL_VALUE),
          );

          // Card B seeds from the same default.
          await app.ingestSessionMetadata("B", capabilities());
          await waitForText(app, cardModelValue("B"), "Sonnet 4.6");

          // The seed must STICK: a turn-free, model-less system_metadata
          // (the synthetic session_init emitted right after spawn) says
          // nothing about the model and must not clobber the just-seeded
          // optimistic pick back to the account default.
          await app.ingestSessionMetadata("B", {
            type: "system_metadata",
            cwd: "/tmp/x",
            ipc_version: 2,
          });
          expect(
            await textAt(app, cardModelValue("B")),
            "a model-less metadata frame must not clobber the seeded pick",
          ).toBe("Sonnet 4.6");

          // ---- Isolation: change card A's model via its own Z4B picker.
          //      The deck default and card B must not move.
          await app.click(`[data-card-id="A"] [data-slot="model-chip"]`);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(`${CARD_A_SHEET} [data-model="haiku"]`)}) !== null`,
            { timeoutMs: 4000 },
          );
          await app.click(`${CARD_A_SHEET} [data-model="haiku"]`);
          await app.click(`${CARD_A_SHEET} [data-slot="model-picker-ok"]`);
          await waitForText(app, cardModelValue("A"), "Haiku");

          expect(
            await textAt(app, SETTINGS_MODEL_VALUE),
            "deck default unchanged by a per-card pick",
          ).toBe("Sonnet 4.6");
          expect(
            await textAt(app, cardModelValue("B")),
            "other open cards unchanged by a per-card pick",
          ).toBe("Sonnet 4.6");
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(`\n[at0200-assistant-defaults] log tail:\n${tail}\n`);
          }
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "a persisted selector absent from the persisted catalog raises the bulletin, resets to Default, and opens Settings",
      async () => {
        const app = await launchTugApp({ testName: "at0200-model-bulletin" });
        try {
          await app.enableDeckTrace(true);

          // Persist the live catalog + a bogus per-card selector BEFORE the
          // card mounts — the bulletin evaluates once, at mount, and is gated
          // on a persisted (non-bootstrap) catalog existing ([Q02]).
          await app.waitForCondition<boolean>(
            `typeof window.__tug !== "undefined"`,
          );
          await app.evalJS(
            `window.__tug.setTugbankValue("dev.tugtool.models", "catalog", {
              kind: "json",
              value: [
                { value: "default", displayName: "Default (recommended)" },
                { value: "sonnet", displayName: "Sonnet" },
                { value: "haiku", displayName: "Haiku" },
              ],
            })`,
          );
          await app.evalJS(
            `window.__tug.setTugbankValue("dev.model", "A", { kind: "string", value: "fable-9" })`,
          );

          await app.seedDeckState({ state: deckShape(["A"]), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindSession("A");
          await app.awaitEngineReady("A");

          // ---- The bulletin presents, naming the missing selector.
          await app.waitForCondition<boolean>(
            `document.querySelector('[data-testid="alert-confirm"]') !== null`,
            { timeoutMs: 8000 },
          );
          const message = await textAt(app, ".tug-alert-message");
          expect(message, "the bulletin names the missing selector").toContain(
            "fable-9",
          );

          // ---- Confirm ("Review Defaults") opens the Settings card.
          await app.click('[data-testid="alert-confirm"]');
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SETTINGS)}) !== null`,
            { timeoutMs: 8000 },
          );

          // ---- The card was reset to the `default` selector: once its
          //      session reports capabilities, the seed is Default (no
          //      model_change to a concrete pick), so the chip shows the
          //      account default's name-with-version title.
          await app.ingestSessionMetadata("A", capabilities());
          await waitForText(app, cardModelValue("A"), "Opus 4.8 · 1M");
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(`\n[at0200-model-bulletin] log tail:\n${tail}\n`);
          }
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
