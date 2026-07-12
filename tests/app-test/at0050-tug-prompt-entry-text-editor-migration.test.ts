/**
 * at0050-tug-prompt-entry-text-editor-migration.test.ts — end-to-end
 * coverage for the Step 15 migration of `tug-prompt-entry` onto the
 * `tug-text-editor` substrate.
 *
 * ## Why this exists
 *
 * The Step 14 rename turned `tug-edit` into `tug-text-editor`. Step 15
 * swapped the legacy `tug-prompt-input` substrate for `tug-text-editor`
 * inside `tug-prompt-entry` and dropped per-route drafts and the
 * route-atom-in-doc model. (First-character route detection existed
 * here for a while and was later removed entirely — route characters
 * are ordinary text.) The unit tests cover the pure helpers
 * (`coerceRestorePayload` et al.); this app-test exercises the full
 * user-visible flow inside Tug.app:
 *
 *   1. Mount a `gallery-prompt-entry` card.
 *   2. Switch to Shell (`$`), type `> hello` — assert the route stays
 *      `$` and the doc holds the text verbatim.
 *   3. Delete the leading `>` — no route side effect.
 *   4. Reload the app, re-seed from disk, assert the doc text and
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
        acceptsFamilies: ["maker"],
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

// The route control is the Z4A POPUP (a trigger button + a portaled
// TugPopupMenu), not the retired segment control — the helpers below mirror
// at0085's popup mechanics.

const ROUTE_TRIGGER_SELECTOR =
  '[data-card-id="A"] .tug-prompt-entry-toolbar button[aria-label="Route"]';
const ROUTE_LABEL_SELECTOR = `${ROUTE_TRIGGER_SELECTOR} [data-tug-stable="active"]`;

const LABEL_BY_ROUTE: Record<string, string> = {
  "❯": "Code",
  $: "Shell",
};

/** `"active"` when the live route (the trigger's label) is `routeValue`. */
async function readSegmentState(
  app: App,
  routeValue: string,
): Promise<string | null> {
  const label = LABEL_BY_ROUTE[routeValue];
  if (label === undefined) return null;
  const current = await app.evalJS<string | null>(
    `(function(){
      var lbl = document.querySelector(${JSON.stringify(ROUTE_LABEL_SELECTOR)});
      return lbl ? lbl.textContent.trim() : null;
    })()`,
  );
  return current === label ? "active" : "inactive";
}

/** Open the route popup and pick `routeValue`, waiting until it takes. */
async function clickSegment(app: App, routeValue: string): Promise<void> {
  const label = LABEL_BY_ROUTE[routeValue];
  expect(label, `unknown route value ${routeValue}`).toBeDefined();
  await app.click(ROUTE_TRIGGER_SELECTOR);
  await app.click(`.tug-menu-item[data-item-id="${routeValue}"]`);
  await app.waitForCondition<boolean>(
    `(function(){
      var lbl = document.querySelector(${JSON.stringify(ROUTE_LABEL_SELECTOR)});
      return lbl !== null && lbl.textContent.trim() === ${JSON.stringify(label!)};
    })()`,
    { timeoutMs: 4000 },
  );
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

            // The default route is `❯` (Prompt). Switch to Shell so
            // the `>` keystroke below has a flip to NOT perform —
            // route characters are ordinary text (first-character
            // route switching was removed).
            await clickSegment(app, "$");
            expect(await readSegmentState(app, "$")).toBe("active");

            // Type `> hello`. The characters land in the doc as plain
            // text; the route stays on `$`.
            await typeChunked(app, "> hello");

            await app.waitForCondition<boolean>(
              `(function(){
                var s = window.__tug.getEmCardState("A");
                return s !== null && s.text === "> hello";
              })()`,
              { timeoutMs: 4000 },
            );
            const routeAfterTyping = await readActiveRoute(app);
            expect(routeAfterTyping).toBe("$");

            // Delete the leading `>`. Deletion, like insertion, has no
            // route side effect. The route stays on `$`.
            //
            // Drive this through real keystrokes rather than a
            // synthetic CM6 transaction: refocus the editor, Home to
            // put the caret at the line start (offset 0, before the
            // `>`), then a forward Delete to remove the `>` — the same
            // CM6 input path the user hits.
            await focusEditor(app);
            await app.nativeKey("Home");
            await new Promise((r) => setTimeout(r, 100));
            await app.nativeKey("Delete");
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
