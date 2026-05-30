/**
 * at0096-effort-chip.test.ts — the Z4B reasoning-effort chip mounts only when
 * the active model supports effort, shows the current level, and sets a new
 * level through its picker ([AT0096], [#step-4]).
 *
 * ## Why this exists
 *
 * The effort chip is a two-line `TugPushButton`, like the model + permission
 * chips, with two parity-critical differences this test pins:
 *
 *   1. **Always present, value-or-`-`.** The Z4B cluster is a stable row, so
 *      the chip never appears/disappears with data — reasoning effort is
 *      per-model (opus supports five levels, sonnet four, haiku none), and when
 *      the active model has no level to show (unsupported, or none set) the
 *      chip shows the `-` placeholder rather than hiding. Inject
 *      `session_capabilities` with effort support + a level → the chip shows
 *      it; inject one without support → the chip falls back to `-`.
 *   2. **No live set verb.** Picking a level sends `effort_change` (tugcode
 *      respawns claude with `--effort` + `--resume`, [R07]); there is no
 *      `system_metadata` round-trip, so the chip reflects the pick
 *      optimistically via `SessionMetadataStore.applyEffort`. This test
 *      asserts that optimistic update (the observable effect of the set path).
 *
 * The chip reads its own `SESSION_METADATA` FeedStore — unreachable by the
 * `driveDevSession`/`ingestFrame` (CodeSessionStore) path — so capabilities are
 * injected via the `ingestSessionMetadata` surface seam; no live claude
 * handshake needed. The respawn-with-resume round-trip itself ([R07]) is an
 * integration concern (live tugcode), out of this UI test's reach.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const CHIP = `${CARD} [data-slot="effort-chip"]`;
// The shown value only — the width-stabilizer sizers also live under the
// button content, so read the dedicated shown span.
const CHIP_CONTENT = `${CHIP} [data-slot="effort-value"]`;
const SHEET = '[data-slot="tug-sheet"]';
const OK_BUTTON = `${SHEET} [data-slot="effort-picker-ok"]`;

/** Capability payload whose active (default → opus) model supports all five levels. */
function effortCapabilities(effort: string | null) {
  return {
    type: "session_capabilities",
    models: [
      {
        value: "default",
        displayName: "Default (recommended)",
        description: "Opus 4.8 (1M context)",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      },
      {
        value: "sonnet",
        displayName: "Sonnet",
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
    effort,
    ipc_version: 2,
  };
}

/** Capability payload whose only model (haiku) does NOT support effort. */
function noEffortCapabilities() {
  return {
    type: "session_capabilities",
    models: [{ value: "haiku", displayName: "Haiku" }],
    commands: [],
    agents: [],
    available_output_styles: [],
    output_style: "default",
    account: null,
    effort: null,
    ipc_version: 2,
  };
}

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 560 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** Trimmed text of the chip's value line. `null` if the chip is absent. */
async function chipLevel(app: App): Promise<string | null> {
  return await app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(CHIP_CONTENT)});
      return el ? el.textContent.trim() : null;
    })()`,
  );
}

/** Outer width of the chip, rounded to 1/100 px. `null` if absent. */
async function chipWidth(app: App): Promise<number | null> {
  return await app.evalJS<number | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(CHIP)});
      return el ? Math.round(el.getBoundingClientRect().width * 100) / 100 : null;
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "AT0096: effort chip is always present, shows the level, and sets it via the picker",
  () => {
    test(
      "supported model → picker sets level; unsupported → `-` placeholder, chip stays",
      async () => {
        const app = await launchTugApp({ testName: "at0096-effort-chip" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindDevSession("A");
          await app.awaitEngineReady("A");

          // The effort chip is a permanent Z4B fixture (like Mode / Model), so
          // it is present from mount. Before any capability lands the active
          // model's effort support is unknown → the chip shows the `-`
          // placeholder, never hides.
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(CHIP_CONTENT)});
              return el !== null && el.textContent.trim() === "-";
            })()`,
            { timeoutMs: 8000 },
          );
          expect(await chipLevel(app), "chip present showing `-` before caps").toBe("-");

          // Capabilities whose active model (default → opus) supports effort,
          // with NO explicit override (`effort: null`) → the chip shows the
          // session's effective default, "High" (claude runs a fresh session at
          // high effort). A supported session is never blank — only an
          // unsupported model shows `-`.
          await app.ingestSessionMetadata("A", effortCapabilities(null));
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(CHIP_CONTENT)});
              return el !== null && el.textContent.trim() === "High";
            })()`,
            { timeoutMs: 6000 },
          );
          expect(await chipLevel(app), "supported + unset → default High").toBe("High");
          const widthAtHigh = await chipWidth(app);

          // Open the picker (synthetic click — the chip sits at the card's
          // bottom-right edge, below the window's clickable region for a
          // CGEvent, so we drive its real `onClick` directly; at0095 set the
          // precedent of DOM-driven chip/banner app-tests). Opus supports
          // exactly five levels, and the effective default ("high") is
          // pre-selected.
          await app.click(CHIP);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(`${SHEET} [data-effort="max"]`)}) !== null`,
            { timeoutMs: 4000 },
          );
          const sheetState = await app.evalJS<{ total: number; selected: string[] }>(
            `(function(){
              var opts = document.querySelectorAll(${JSON.stringify(`${SHEET} [data-effort]`)});
              var selected = [];
              for (var i = 0; i < opts.length; i++) {
                if (opts[i].getAttribute('data-selected') === 'true') {
                  var t = opts[i].querySelector('.tug-list-row-title');
                  selected.push((t ? t.textContent : opts[i].textContent).trim());
                }
              }
              return { total: opts.length, selected: selected };
            })()`,
          );
          expect(sheetState.total, "opus picker lists exactly five levels").toBe(5);
          expect(sheetState.selected, "the current level is selected").toEqual(["High"]);

          // Pick "Max", then OK (confirm-style sheet, like the model picker).
          // The chip reflects the new level optimistically (no metadata
          // round-trip on an effort change — [R07]).
          await app.click(`${SHEET} [data-effort="max"]`);
          await app.click(OK_BUTTON);
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(CHIP_CONTENT)});
              return el !== null && el.textContent.trim() === "Max";
            })()`,
            { timeoutMs: 4000 },
          );
          expect(await chipLevel(app), "picking a level updates the chip").toBe("Max");

          // Width stabilization: the chip reserves its widest label, so the
          // level change (a different-length value) does not reflow it.
          const widthAtMax = await chipWidth(app);
          expect(widthAtHigh, "chip width must be measurable").not.toBeNull();
          expect(
            widthAtMax,
            "effort chip must not reflow across level values ([R01], this chip)",
          ).toBe(widthAtHigh);

          // Model gate: capabilities whose active model does NOT support effort
          // fall back to the `-` placeholder — the chip stays present (a stable
          // row), it just has no level to show.
          await app.ingestSessionMetadata("A", noEffortCapabilities());
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(CHIP_CONTENT)});
              return el !== null && el.textContent.trim() === "-";
            })()`,
            { timeoutMs: 4000 },
          );
          expect(await chipLevel(app), "unsupported model → chip shows `-`").toBe("-");
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(CHIP)}) !== null`,
            ),
            "chip stays present (never hides)",
          ).toBe(true);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(`\n[at0096-effort-chip] log tail:\n${tail}\n`);
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
