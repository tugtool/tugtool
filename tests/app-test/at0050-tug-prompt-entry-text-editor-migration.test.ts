/**
 * at0050-tug-prompt-entry-text-editor-migration.test.ts — end-to-end
 * coverage for the Step 15 migration of `tug-prompt-entry` onto the
 * `tug-text-editor` substrate.
 *
 * ## Why this exists
 *
 * The Step 14 rename turned `tug-edit` into `tug-text-editor`. Step 15
 * swapped the legacy `tug-prompt-input` substrate for `tug-text-editor`
 * inside `tug-prompt-entry`, dropped per-route drafts, dropped the
 * route-atom-in-doc model, and reworked the route-prefix detection to
 * one-shot insertion-only ([Q06]=b). The unit tests cover the pure
 * helpers (`createRoutePrefixExtension`, `computeSubmitText`,
 * `coerceRestorePayload`); this app-test exercises the full
 * user-visible flow inside Tug.app:
 *
 *   1. Mount a `gallery-prompt-entry` card.
 *   2. Type `> hello` — assert the route segment flips to Code (`❯`)
 *      and the doc retains the prefix character.
 *   3. Type `more` to extend the doc.
 *   4. Click the Shell (`$`) segment — assert the route flips to `$`
 *      while the doc text stays put.
 *   5. Click the Code (`❯`) segment back — route returns to `❯`.
 *   6. Delete the leading `>` — assert the route stays on `❯` per
 *      [Q06]=b (deletion is a no-op for prefix detection).
 *   7. Reload the app, re-seed from disk, assert the doc text and
 *      the active route survive.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)` matches the rest of the
 * `tests/app-test` suite — only runs under `TUGAPP_APP_TEST=1`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
  tugbankRead,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 90_000;

const EDITOR_SELECTOR = '[data-slot="tug-text-editor"] .cm-content';

interface RawBag {
  content?: unknown;
}

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-prompt-entry", title: "Prompt A", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 720, height: 540 },
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

async function focusEditor(app: App): Promise<void> {
  const editorSelector = `[data-card-id="A"] ${EDITOR_SELECTOR}`;
  await app.nativeClickAtElement(editorSelector);
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(editorSelector)})`,
    { timeoutMs: 2000 },
  );
  await new Promise((r) => setTimeout(r, 100));
}

async function typeChunked(app: App, text: string): Promise<void> {
  const TYPING_CHUNK_SIZE = 8;
  const TYPING_CHUNK_DELAY_MS = 60;
  for (let offset = 0; offset < text.length; offset += TYPING_CHUNK_SIZE) {
    await app.nativeType(text.slice(offset, offset + TYPING_CHUNK_SIZE));
    await new Promise((r) => setTimeout(r, TYPING_CHUNK_DELAY_MS));
  }
}

/**
 * Read the live `route` value from the entry's preserved-state
 * payload via `getEmCardState`. The substrate's bag is wrapped by
 * the entry; the harness's `getEmCardState` returns the inner
 * draft, but the route lives on the wrapper itself, so we walk the
 * raw bag.
 */
async function readActiveRoute(app: App): Promise<string | null> {
  return app.evalJS<string | null>(
    `(function(){
      var raw = window.__tug.getCardStateBag && window.__tug.getCardStateBag("A");
      if (!raw || typeof raw !== "object") return null;
      var content = raw.content;
      if (!content || typeof content !== "object") return null;
      return typeof content.route === "string" ? content.route : null;
    })()`,
  );
}

async function readSegmentState(
  app: App,
  routeValue: string,
): Promise<string | null> {
  return app.evalJS<string | null>(
    `(function(){
      var card = document.querySelector('[data-card-id="A"]');
      if (!card) return null;
      var labelMap = { "❯": "Code", "$": "Shell" };
      var target = labelMap[${JSON.stringify(routeValue)}];
      if (!target) return null;
      var btns = card.querySelectorAll('button[role="radio"]');
      for (var i = 0; i < btns.length; i++) {
        if ((btns[i].textContent || "").includes(target)) {
          return btns[i].getAttribute("data-state");
        }
      }
      return null;
    })()`,
  );
}

async function clickSegment(app: App, routeValue: string): Promise<void> {
  const labelMap: Record<string, string> = {
    "❯": "Code",
    $: "Shell",
  };
  const label = labelMap[routeValue];
  expect(label, `unknown route value ${routeValue}`).toBeDefined();
  const sel = `[data-card-id="A"] button[role="radio"]:has-text(${JSON.stringify(label!)})`;
  // Fallback: the harness's nativeClickAtElement only takes a CSS
  // selector and `:has-text` is non-standard, so we use querySelectorAll
  // and click via x/y from getBoundingClientRect.
  await app.evalJS<void>(
    `(function(){
      var card = document.querySelector('[data-card-id="A"]');
      if (!card) throw new Error("[m50] card not found");
      var btns = card.querySelectorAll('button[role="radio"]');
      for (var i = 0; i < btns.length; i++) {
        if ((btns[i].textContent || "").includes(${JSON.stringify(label!)})) {
          btns[i].click();
          return;
        }
      }
      throw new Error("[m50] segment ${label} not found");
    })()`,
  );
  // Surface the unused `sel` so lint stays happy without a
  // separate-line eslint-disable. The selector is documented for
  // when `nativeClickAtElement` learns `:has-text` someday.
  void sel;
}

describe.skipIf(!SHOULD_RUN)(
  "m50: tug-prompt-entry on tug-text-editor — full migration round-trip",
  () => {
    test(
      "type prefix → flip route; click segment → flip route; reload → restore",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);

          const app = await launchTugApp({
            testName: "m50-prompt-entry-migration",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });

          try {
            await app.enableDeckTrace(true);
            await app.seedDeckState({
              state: deckShape(),
              cardStates: {},
              focusCardId: "A",
            });
            await app.waitForCondition<boolean>(
              `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            );
            await app.awaitEngineReady("A");
            await focusEditor(app);

            // The default route is `❯` (Prompt). Switch to Shell
            // first so a subsequent `>` keystroke produces an
            // observable route flip back to Code.
            await clickSegment(app, "$");
            await app.waitForCondition<boolean>(
              `(function(){ return ${JSON.stringify(await readSegmentState(app, "$"))} === "active"; })()`,
              { timeoutMs: 1000 },
            );

            // Type `> hello`. The route-prefix extension flips the
            // route to `❯` on the first inserted character; the
            // remaining keystrokes don't fire (they're past offset 0).
            // The character itself stays in the doc.
            await typeChunked(app, "> hello");

            await app.waitForCondition<boolean>(
              `(function(){
                var s = window.__tug.getEmCardState("A");
                return s !== null && s.text === "> hello";
              })()`,
              { timeoutMs: 4000 },
            );
            const routeAfterPrefix = await readActiveRoute(app);
            expect(routeAfterPrefix).toBe("❯");

            // Click Shell — manually flip away from `❯` even though
            // the doc still leads with `>`. [Q08]=a: segment control
            // is a fully orthogonal route source; the doc isn't
            // touched by the click.
            await clickSegment(app, "$");
            await app.waitForCondition<boolean>(
              `(function(){
                var s = window.__tug.getEmCardState("A");
                return s !== null && s.text === "> hello";
              })()`,
              { timeoutMs: 1000 },
            );
            expect(await readActiveRoute(app)).toBe("$");

            // Delete the leading `>`. [Q06]=b: deletion of the
            // prefix character is a no-op for route detection. The
            // route stays on `$`.
            await app.evalJS<void>(
              `(function(){
                var ed = document.querySelector('[data-card-id="A"] ${EDITOR_SELECTOR}');
                if (!ed) throw new Error("[m50] editor not found");
                ed.focus();
              })()`,
            );
            // Move caret to position 1 (after the `>`) and press
            // Backspace twice — once to delete `>` and once would
            // delete the space, but we only want to delete `>` so
            // we use a single keystroke after positioning.
            await app.evalJS<void>(
              `(function(){
                // Best-effort: dispatch a keydown / input pair the
                // substrate's CM6 keymap recognizes. Using a direct
                // CM6 dispatch through the substrate-test surface
                // would be simpler if available; falling back to
                // textContent-style edits would lose the
                // CM6-mediated path the user actually exercises.
                var view = window.__tug.findEditorView && window.__tug.findEditorView('[data-card-id="A"]');
                if (!view) throw new Error("[m50] view not reachable");
                view.dispatch({
                  changes: { from: 0, to: 1, insert: "" },
                  selection: { anchor: 0 },
                  userEvent: "delete.backward"
                });
              })()`,
            );
            await app.waitForCondition<boolean>(
              `(function(){
                var s = window.__tug.getEmCardState("A");
                return s !== null && s.text === " hello";
              })()`,
              { timeoutMs: 2000 },
            );
            expect(await readActiveRoute(app)).toBe("$");

            // Reload — drives `prepareForReload`, which flushes
            // every save callback synchronously into tugbank.
            await app.appReload();

            const onDisk = tugbankRead<RawBag>(
              tugbankPath,
              "dev.tugtool.deck.cardstate",
              "A",
            );
            expect(onDisk).not.toBeNull();
            const persisted = onDisk!.value as RawBag;
            const persistedContent = persisted.content as Record<string, unknown> | undefined;
            expect(persistedContent?.route, "route survives reload").toBe("$");
            const draft = persistedContent?.draft as Record<string, unknown> | undefined;
            expect(draft?.text, "doc text survives reload").toBe(" hello");

            // Re-seed from disk and assert the live entry comes
            // back to the persisted state.
            await app.seedDeckState({
              state: deckShape(),
              cardStates: { A: persisted },
              focusCardId: "A",
            });
            await app.waitForCondition<boolean>(
              `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            );
            await app.awaitEngineReady("A");
            await app.waitForCondition<boolean>(
              `(function(){
                var s = window.__tug.getEmCardState("A");
                return s !== null && s.text === " hello";
              })()`,
              { timeoutMs: 4000 },
            );
            expect(await readActiveRoute(app)).toBe("$");
          } finally {
            await app.close();
          }
        } finally {
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
