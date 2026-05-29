/**
 * at0089-slash-permissions.test.ts — typing `/permissions` and submitting
 * opens the permission sheet locally and never sends a message to claude
 * ([AT0089], Step 1c / [D23]).
 *
 * ## Why this exists
 *
 * Step 1c adds the local slash-command dispatch layer. A typed `/command`
 * matching the registry (`lib/slash-commands.ts`) is intercepted at submit
 * (`performSubmit`), dispatched key-card-scoped as `RUN_SLASH_COMMAND`, and
 * handled by the dev card's card-content responder — which opens the
 * command's graphical surface. It must NOT reach claude. This drives the
 * real submit path end-to-end:
 *
 *   1. Type `/permissions`, submit → the permission sheet opens AND the
 *      transcript gains no user / optimistic row (nothing was sent). The
 *      editor clears.
 *   2. Pick a mode in the sheet → the chip reflects it; the sheet closes.
 *   3. Type `/commit` (a claude-owned command, not local), submit → it IS
 *      sent (an optimistic row appears) and no sheet opens — proving the
 *      matcher discriminates local from pass-through.
 *
 * "Nothing was sent" is asserted via transcript DOM state (no user / ghost
 * row), never a `send()` spy (per `feedback_no_mock_store_tests`).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const EDITOR = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const CHIP = `${CARD} [data-slot="permission-mode-chip"]`;
const CHIP_VALUE = `${CHIP} [data-slot="permission-mode-value"]`;
const SHEET = '[data-slot="tug-sheet"]';
const MODE_OPTION = `${SHEET} [data-mode]`;
const AUTO_OPTION = `${SHEET} [data-mode="auto"]`;
// Both the optimistic pending row and the committed user body count as
// "a message was sent to claude."
const SENT_ROWS =
  `${CARD} [data-testid="dev-card-transcript-user-body"], ` +
  `${CARD} [data-slot="dev-transcript-ghost-row"]`;

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

/** The engine's current draft text for card A, or `null` if unavailable. */
async function editorText(app: App): Promise<string | null> {
  return await app.evalJS<string | null>(
    `(function(){ var s = window.__tug.getEmCardState("A"); return s ? s.text : null; })()`,
  );
}

/** Count of elements matching `selector`. */
async function count(app: App, selector: string): Promise<number> {
  return await app.evalJS<number>(
    `document.querySelectorAll(${JSON.stringify(selector)}).length`,
  );
}

/** Trimmed text of the chip's value line. */
async function chipMode(app: App): Promise<string | null> {
  return await app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(CHIP_VALUE)});
      return el ? el.textContent.trim() : null;
    })()`,
  );
}

/** Wait until card A's engine text equals `text`. */
async function waitForEditorText(app: App, text: string): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){ var s = window.__tug.getEmCardState("A"); return !!s && s.text === ${JSON.stringify(text)}; })()`,
    { timeoutMs: 4000 },
  );
}

/**
 * Type `text`, dismiss the `/` popup with Escape (so nothing is accepted),
 * then submit the raw text. Exercises the no-atom branch of the matcher.
 */
async function rawSubmit(app: App, text: string): Promise<void> {
  await app.nativeClickAtElement(EDITOR);
  await app.nativeType(text);
  await waitForEditorText(app, text);
  await app.nativeKey("Escape");
  await app.nativeKey("Return", ["shift"]);
}

describe.skipIf(!SHOULD_RUN)(
  "AT0089: typed /permissions opens the sheet locally; /commit is sent",
  () => {
    test(
      "/permissions opens the sheet and sends nothing; /commit passes through",
      async () => {
        const app = await launchTugApp({ testName: "at0089-slash-permissions" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindDevSession("A");
          await app.awaitEngineReady("A");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CHIP)}) !== null`,
            { timeoutMs: 8000 },
          );

          // ── Phase 1a: accepting /permissions from the popup inserts a
          //    command atom and dismisses the popup — uniform completion
          //    behavior; accepting does NOT open the sheet. ──
          expect(await count(app, SENT_ROWS)).toBe(0);
          await app.nativeClickAtElement(EDITOR);
          await app.nativeType("/permi");
          await waitForEditorText(app, "/permi"); // popup open on "permissions"
          await app.nativeKey("Tab"); // accept → command atom + dismiss popup
          await app.waitForCondition<boolean>(
            // The accepted atom replaces the typed text with the U+FFFC
            // placeholder (the atom occupies one position in the doc text).
            `(function(){
              var s = window.__tug.getEmCardState("A");
              return !!s && s.text.indexOf("\\uFFFC") !== -1 &&
                s.text.indexOf("permi") === -1;
            })()`,
            { timeoutMs: 4000 },
          );
          expect(
            await count(app, SHEET),
            "accepting a suggestion inserts an atom — it must NOT open the sheet",
          ).toBe(0);

          // ── Phase 1b: submitting the command atom RUNS it (local command)
          //    — the sheet opens, nothing is sent, and the line clears. ──
          await app.nativeKey("Return", ["shift"]); // submit (❯-route chord)
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(AUTO_OPTION)}) !== null`,
            { timeoutMs: 4000 },
          );
          expect(
            await count(app, MODE_OPTION),
            "sheet lists every behavior option",
          ).toBe(5);
          expect(
            await count(app, SENT_ROWS),
            "/permissions must not be sent to claude (no transcript row)",
          ).toBe(0);
          expect(
            await editorText(app),
            "running a local command clears the line",
          ).toBe("");

          // The sheet must STAY open — not flash and dismiss. Wait a real
          // beat, then assert it's still there. (Regression guard: a stray
          // Enter used to bubble to the keyboard pipeline's
          // Enter→default-button activation and click the sheet's primary
          // button on the spot.)
          await new Promise((r) => setTimeout(r, 400));
          expect(
            await count(app, AUTO_OPTION),
            "the sheet stays open (no flash-and-dismiss)",
          ).toBe(1);

          // ── Phase 2: pick a mode → chip reflects it; sheet closes. ──
          await app.nativeClickAtElement(AUTO_OPTION);
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(CHIP_VALUE)});
              return el !== null && el.textContent.trim() === "Auto";
            })()`,
            { timeoutMs: 4000 },
          );
          expect(await chipMode(app), "sheet pick sets the chip mode").toBe("Auto");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SHEET)}) === null`,
            { timeoutMs: 4000 },
          );

          // The sheet restores focus to the prompt editor on dismiss
          // ([L23] / single text-entry destination). The local-command
          // interception deliberately does not refocus the editor itself —
          // the sheet held focus and hands it back here.
          await app.waitForCondition<boolean>(
            `(function(){
              var ae = document.activeElement;
              return ae !== null &&
                ae.closest(${JSON.stringify(`${CARD} [data-slot="tug-text-editor"]`)}) !== null;
            })()`,
            { timeoutMs: 4000 },
          );

          // ── Phase 3: /commit is NOT local → sent to claude, no sheet.
          //    (No local completion matches `/commit` in this fixture, so
          //    the raw text submits — the matcher returns null → send.) ──
          await rawSubmit(app, "/commit");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(SENT_ROWS)}).length >= 1`,
            { timeoutMs: 4000 },
          );
          expect(
            await count(app, SENT_ROWS),
            "/commit must be sent to claude (unmatched pass-through)",
          ).toBeGreaterThanOrEqual(1);
          expect(
            await count(app, SHEET),
            "/commit opens no sheet",
          ).toBe(0);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(`\n[at0089-slash-permissions] log tail:\n${tail}\n`);
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
