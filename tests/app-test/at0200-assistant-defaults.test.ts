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
 *   4. **Bulletin.** A persisted per-card selector no catalog row could be
 *      raises the pane-modal alert at card mount, resets the card to Default,
 *      and its confirm opens the Settings card.
 *   5. **Respelling is not breakage.** A selector the catalog now offers under
 *      a different string (`claude-fable-5` → `claude-fable-5[1m]`) is
 *      migrated to the current spelling at mount: the card keeps the model
 *      the user picked and no bulletin is raised.
 *
 * Capabilities are injected via `ingestSessionMetadata` (the chip's
 * SESSION_SIDEBAND seam — no live claude needed); tugbank state is seeded
 * through the `setTugbankValue` surface, which drives the same local-cache +
 * onDomainChanged path a real write does.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/components/tugways/cards/settings-card.tsx
 * @covers tugdeck/src/lib/default-model-store.ts
 * @covers tugdeck/src/lib/default-effort-store.ts
 * @covers tugdeck/src/lib/model-catalog.ts
 * @covers tugdeck/src/lib/use-unavailable-model-bulletin.ts
 * @covers tugdeck/src/lib/model.ts
 * @covers tugdeck/src/lib/model-domains.ts
 * @covers tugdeck/src/lib/model-selector.ts
 * @covers tugdeck/src/components/tugways/cards/ai-chip.tsx
 * @covers tugdeck/src/lib/model-label.ts
 * @covers tugdeck/src/components/tugways/cards/ai-config-sheet.tsx
 * @covers tugdeck/src/components/tugways/cards/settings-session-card-body.tsx
 * @covers tugdeck/src/components/tugways/tug-alert-sheet.tsx
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

const SETTINGS = '[data-testid="settings-session-card"]';
// The Assistant box's one control — model, effort, and mode in a single chip
// over a single mixer sheet, the same pair the Z4B row uses.
const SETTINGS_AI_CHIP = `${SETTINGS} [data-slot="ai-chip"]`;
// The overlay's ACTIVE face only — the width stabilizer also renders hidden
// sizer alternates whose text would pollute a plain textContent read.
const SETTINGS_AI_VALUE = `${SETTINGS_AI_CHIP} [data-slot="ai-chip-value"] [data-tug-stable="active"]`;
// Sheets portal into their host PANE's frame and linger through the exit
// animation — scope every sheet read/click to the pane that owns it so a
// closing sheet in another pane can never swallow a click.
const SETTINGS_SHEET =
  '.tug-pane:has([data-testid="settings-card"]) [data-slot="tug-sheet"]';
const CARD_A_SHEET = '[data-pane-id="p1"] [data-slot="tug-sheet"]';

/** The mixer sheet's MODEL row and one of its segments. */
const MODEL_ROW = '[data-testid="ai-config-model"]';
const MODEL_SEGMENT = (value: string): string =>
  `${MODEL_ROW} [data-choice-value="${value}"]`;

const cardAiValue = (cardId: string): string =>
  `[data-card-id="${cardId}"] [data-slot="ai-chip"] [data-slot="ai-chip-value"] [data-tug-stable="active"]`;

/**
 * The MODEL the composite names — asserted as a prefix rather than a token
 * split, because a model label can itself contain the `·` separator
 * (`Opus 4.8 · 1M`), which makes splitting the composite ambiguous. The model
 * is always the composite's leading run, so a prefix match is exact about the
 * thing under test and silent about the effort/mode that follow it.
 */
async function waitForModel(
  app: App,
  selector: string,
  label: string,
): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      return el !== null && el.textContent.trim().indexOf(${JSON.stringify(label)}) === 0;
    })()`,
    { timeoutMs: 8000 },
  );
}

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

/**
 * Capability payload whose Fable row carries the fully-qualified `[1m]`
 * spelling — the catalog a card that saved the bare `claude-fable-5` meets
 * after claude respells its own selector.
 */
function fableCapabilities() {
  const base = capabilities();
  return {
    ...base,
    models: [
      base.models[0],
      {
        value: "claude-fable-5[1m]",
        displayName: "Fable",
        description: "Fable 5 · Most capable for your hardest tasks",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      },
      ...base.models.slice(1),
    ],
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

/**
 * Bring up the Settings card's **Session Card** section — where the Assistant
 * box lives. Only the selected section's body exists, so this clicks the
 * sidebar tab and waits for the panel.
 */
async function openSessionCardSection(app: App): Promise<void> {
  await app.waitForCondition<boolean>(
    `document.querySelector('[data-testid="settings-card"]') !== null`,
    { timeoutMs: 8000 },
  );
  await app.click('[data-testid="tug-tab-view-tab-sessionCard"]');
  await app.waitForCondition<boolean>(
    `document.querySelector(
      '[data-testid="settings-section-sessionCard"][data-state="open"]',
    ) !== null`,
    { timeoutMs: 8000 },
  );
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(SETTINGS)}) !== null`,
    { timeoutMs: 8000 },
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
      "the Settings AI chip opens the mixer; a picked default seeds a card with an identical label; per-card picks stay isolated",
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

          // ---- Open Settings (same control action as ⌘,) on its Assistant tab.
          await app.evalJS(
            `window.__tug.dispatchControlAction("show-card", { component: "settings" })`,
          );
          await openSessionCardSection(app);

          // ---- The Assistant control is the real Z4B chip, and the old
          //      Permission Mode dropdown is gone.
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(SETTINGS_AI_CHIP)}) !== null`,
            ),
            "Assistant renders the AI chip",
          ).toBe(true);
          expect(
            await app.evalJS<boolean>(
              `document.querySelector('.settings-session-card-popup-mode') === null`,
            ),
            "no TugPopupButton remains for the permission-mode default",
          ).toBe(true);

          // Deck default is the `default` zero-state and NO session has ever
          // reported capabilities → no catalog exists. The chip says exactly
          // what is known: "Default" — never a hardcoded model label.
          await waitForModel(app, SETTINGS_AI_VALUE, "Default");

          // ---- Fresh install, no catalog: the MODEL row offers the single
          //      honest Default segment, and the description line explains that
          //      the full list arrives after the first request — no invented
          //      models.
          await app.click(SETTINGS_AI_CHIP);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(`${SETTINGS_SHEET} ${MODEL_SEGMENT("default")}`)}) !== null`,
            { timeoutMs: 4000 },
          );
          expect(
            await app.evalJS<number>(
              `document.querySelectorAll(${JSON.stringify(`${SETTINGS_SHEET} ${MODEL_ROW} [data-choice-value]`)}).length`,
            ),
            "no catalog → exactly one Default segment, nothing invented",
          ).toBe(1);
          expect(
            await app.evalJS<string>(
              `(function(){
                var el = document.querySelector(${JSON.stringify(`${SETTINGS_SHEET} [data-description-layer="default"]`)});
                return el ? el.textContent : "";
              })()`,
            ),
            "the description line explains why the list is short",
          ).toContain("first request");
          await app.click(`${SETTINGS_SHEET} [data-slot="ai-config-cancel"]`);

          // ---- A session reports capabilities → the Session card persists the
          //      live catalog. Every chip now shows the account default's
          //      "name with version" title, derived from claude's own
          //      description wording via the one resolveModelLabel path.
          await app.ingestSessionMetadata("A", capabilities());
          await waitForModel(app, cardAiValue("A"), "Opus 4.8 · 1M");
          await waitForModel(app, SETTINGS_AI_VALUE, "Opus 4.8 · 1M");
          const settingsChipWidthBefore = await app.evalJS<number | null>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(SETTINGS_AI_CHIP)});
              return el ? Math.round(el.getBoundingClientRect().width * 100) / 100 : null;
            })()`,
          );

          // ---- The AI chip opens the mixer: the MODEL row carries one
          //      segment per catalog row, with the account default marked
          //      active for the zero-state.
          await app.click(SETTINGS_AI_CHIP);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(`${SETTINGS_SHEET} ${MODEL_SEGMENT("sonnet")}`)}) !== null`,
            { timeoutMs: 4000 },
          );
          const sheetState = await app.evalJS<{
            segments: number;
            active: string[];
          }>(
            `(function(){
              var segs = document.querySelectorAll(${JSON.stringify(`${SETTINGS_SHEET} ${MODEL_ROW} [data-choice-value]`)});
              var active = [];
              for (var i = 0; i < segs.length; i++) {
                if (segs[i].getAttribute('data-state') === 'active') {
                  active.push(segs[i].getAttribute('data-choice-value'));
                }
              }
              return { segments: segs.length, active: active };
            })()`,
          );
          expect(
            sheetState.segments,
            "the row offers the catalog's rows",
          ).toBeGreaterThanOrEqual(3);
          expect(
            sheetState.active,
            "the Default segment is active for the zero-state",
          ).toEqual(["default"]);

          // ---- Pick Sonnet as the deck default. Nothing is written until OK
          //      (the mixer is a transaction), and the chip then shows the
          //      row's name-with-version, from claude's own wording.
          await app.click(`${SETTINGS_SHEET} ${MODEL_SEGMENT("sonnet")}`);
          await app.click(`${SETTINGS_SHEET} [data-slot="ai-config-ok"]`);
          await waitForModel(app, SETTINGS_AI_VALUE, "Sonnet 4.6");

          // Width stability: the chip reserves every known row's title, so
          // changing the default never reflows it.
          expect(
            await app.evalJS<number | null>(
              `(function(){
                var el = document.querySelector(${JSON.stringify(SETTINGS_AI_CHIP)});
                return el ? Math.round(el.getBoundingClientRect().width * 100) / 100 : null;
              })()`,
            ),
            "the Settings AI chip must not reflow across default values",
          ).toBe(settingsChipWidthBefore);

          // ---- Card A's session is knowable (capabilities landed above), so
          //      the seed aligns it to the new deck default, and the Z4B label
          //      matches Settings byte-for-byte.
          await waitForModel(app, cardAiValue("A"), "Sonnet 4.6");

          // Card B seeds from the same default.
          await app.ingestSessionMetadata("B", capabilities());
          await waitForModel(app, cardAiValue("B"), "Sonnet 4.6");

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
            (await textAt(app, cardAiValue("B")))?.startsWith("Sonnet 4.6"),
            "a model-less metadata frame must not clobber the seeded pick",
          ).toBe(true);

          // ---- Isolation: change card A's model via its own Z4B mixer.
          //      The deck default and card B must not move.
          await app.click(`[data-card-id="A"] [data-slot="ai-chip"]`);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(`${CARD_A_SHEET} ${MODEL_SEGMENT("haiku")}`)}) !== null`,
            { timeoutMs: 4000 },
          );
          await app.click(`${CARD_A_SHEET} ${MODEL_SEGMENT("haiku")}`);
          await app.click(`${CARD_A_SHEET} [data-slot="ai-config-ok"]`);
          await waitForModel(app, cardAiValue("A"), "Haiku");

          expect(
            (await textAt(app, SETTINGS_AI_VALUE))?.startsWith("Sonnet 4.6"),
            "deck default unchanged by a per-card pick",
          ).toBe(true);
          expect(
            (await textAt(app, cardAiValue("B")))?.startsWith("Sonnet 4.6"),
            "other open cards unchanged by a per-card pick",
          ).toBe(true);
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
          await openSessionCardSection(app);

          // ---- The card was reset to the `default` selector: once its
          //      session reports capabilities, the seed is Default (no
          //      model_change to a concrete pick), so the chip shows the
          //      account default's name-with-version title.
          await app.ingestSessionMetadata("A", capabilities());
          await waitForModel(app, cardAiValue("A"), "Opus 4.8 · 1M");
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

    test(
      "a selector claude has merely respelled is migrated to the current spelling — model kept, no bulletin",
      async () => {
        const app = await launchTugApp({ testName: "at0200-model-respelled" });
        try {
          await app.enableDeckTrace(true);

          // Persist a catalog offering Fable under the `[1m]` spelling, and a
          // per-card selector saved under the OLD spelling — the shape that
          // shipped when the 1M variant became the offered form. Both name the
          // same model, so the card must keep it, silently.
          await app.waitForCondition<boolean>(
            `typeof window.__tug !== "undefined"`,
          );
          await app.evalJS(
            `window.__tug.setTugbankValue("dev.tugtool.models", "catalog", {
              kind: "json",
              value: ${JSON.stringify(fableCapabilities().models)},
            })`,
          );
          await app.evalJS(
            `window.__tug.setTugbankValue("dev.model", "A", { kind: "string", value: "claude-fable-5" })`,
          );

          await app.seedDeckState({ state: deckShape(["A"]), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindSession("A");
          await app.awaitEngineReady("A");
          await app.ingestSessionMetadata("A", fableCapabilities());

          // ---- The saved pick survives: the chip names Fable, not the
          //      account default it would have been reset to.
          await waitForModel(app, cardAiValue("A"), "Fable 5");

          // ---- And nothing was raised — a respelling is not a breakage.
          const alertPresent = await app.evalJS<boolean>(
            `document.querySelector('[data-testid="alert-confirm"]') !== null`,
          );
          expect(alertPresent, "a respelled selector must not raise the bulletin").toBe(
            false,
          );
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(`\n[at0200-model-respelled] log tail:\n${tail}\n`);
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
