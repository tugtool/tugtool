/**
 * at0224-card-active-keyboard.test.ts — active-card keyboard contract
 * ([AT0224]).
 *
 * ## Why this exists
 *
 * The active-card keyboard INVARIANT ([P21], responder-chain.md): while a
 * card is the key card, the chain's first responder is a responder that
 * serves that card, so first-responder-routed accelerators (find, clipboard)
 * land on its content — no matter HOW the card became key (editor click,
 * title-bar click, pane cycle, Open Quickly / programmatic open) and no
 * matter WHEN its content finished mounting. The engine maintains this by
 * continuous reconciliation (key-card changes + chain registration changes),
 * with the default-focus chain supplying the target for never-focused cards
 * — uniformly, for every card type. Each scenario here is an activation path
 * that once dropped the invariant.
 *
 * ## How this states the invariant
 *
 * Two assertion shapes, both engine facts rather than `document.activeElement`
 * containment (the engine parks the sink OUTSIDE every card on the
 * `engine-routed` route, so card containment is a test for a `dom-granted`
 * text surface, not for keyboard location):
 *
 *  - **Directly** — `getActiveCardId()` (the composite first-responder bit,
 *    which is the card the engine follows as its key card) names the card and
 *    `[data-first-responder]` resolves inside that card's host. This is the
 *    invariant itself, with no accelerator in the middle.
 *  - **Through an accelerator** — a live first-responder-routed chord (⌘F,
 *    ⌘G) produces its effect. This is the invariant's consequence, and the
 *    thing a user would notice breaking.
 *
 * Scenarios 1 and 2 previously drove ⇧⌘S / SELECT_ROUTE on a prompt-entry
 * card. That action no longer exists in the product, so those two scenarios
 * now assert the invariant directly; the prompt-entry activation paths they
 * cover are unchanged.
 *
 * ## Test matrix
 *
 *   1. Prompt-entry card: a click on the pane TITLE BAR (an activation/drag
 *      surface, `data-tug-fr-preserve`) leaves the first responder serving
 *      the entry.
 *   2. Two panes: reactivating a DEACTIVATED card by its title bar restores
 *      that card's first responder, and the neighbor is untouched.
 *   3. Text card: click the pane title bar, then ⌘F — the find bar must
 *      open (FIND reaches the editor's responder).
 *   4. A text card opened via the `open-file` control action (Open Quickly's
 *      commit path) owns ⌘F immediately: the created-and-activated card
 *      completes its activation focus claim at mount / engine-hook
 *      registration; typing then shows the RESULTS badge.
 *   5. Cycle (Ctrl-`) to a NEVER-FOCUSED text card: ⌘F works immediately
 *      (the reconciler resolves the card's default-focus target), and a
 *      subsequent title-bar click does not wedge the keyboard (⌘G still
 *      routes).
 *   6. Text card: with the find FIELD focused (the bar just opened), ⌘G /
 *      ⇧⌘G must advance / retreat the match (FIND_NEXT walks field → bar).
 *
 * Every scenario also asserts `getFocusInvariantReport().violations === 0`
 * at its end: the keyboard landing in the right place while the watchdog is
 * busy re-parking a steal is a different, weaker contract.
 *
 * Chords are dispatched as synthetic keydowns at the active element — the
 * Stage-1 keybinding path keys on code+modifiers, not isTrusted (see
 * at0085 / at0221 precedent).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/components/tugways/focus-manager.ts
 * @covers tugdeck/src/components/tugways/responder-chain.ts
 * @covers tugdeck/src/card-state-orchestrator.ts
 * @covers tugdeck/src/deck-manager.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp, type App } from "./_harness";
import { cardHost, FIRST_RESPONDER } from "./_harness/selectors";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const TITLE_BAR_SELECTOR = '[data-slot="tug-pane-title-bar"]';

// ---------------------------------------------------------------------------
// Shared drive helpers
// ---------------------------------------------------------------------------

async function dispatchChord(
  app: App,
  code: string,
  key: string,
  modifiers: { meta?: boolean; shift?: boolean; ctrl?: boolean },
): Promise<void> {
  await app.evalJS<boolean>(
    `(function(){
      var target = document.activeElement || document;
      return target.dispatchEvent(new KeyboardEvent("keydown", {
        code: ${JSON.stringify(code)},
        key: ${JSON.stringify(key)},
        metaKey: ${modifiers.meta === true},
        shiftKey: ${modifiers.shift === true},
        ctrlKey: ${modifiers.ctrl === true},
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    })()`,
  );
}

/** The current first responder id — diagnostic for failure messages. */
async function readFirstResponder(app: App): Promise<string> {
  return await app.evalJS<string>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(FIRST_RESPONDER)});
      return el ? String(el.getAttribute('data-first-responder')) : '(none)';
    })()`,
  );
}

/**
 * [P21] stated directly: `cardId` is the key card AND the chain's first
 * responder resolves inside that card's host. Both halves matter — a key card
 * whose first responder serves a sibling is exactly the failure this test
 * exists to catch.
 */
function invariantHolds(cardId: string): string {
  return `(function(){
    if (typeof window.__tug === "undefined") return false;
    if (window.__tug.getActiveCardId() !== ${JSON.stringify(cardId)}) return false;
    var host = document.querySelector(${JSON.stringify(cardHost(cardId))});
    var fr = document.querySelector(${JSON.stringify(FIRST_RESPONDER)});
    return host !== null && fr !== null && host.contains(fr);
  })()`;
}

async function expectInvariant(app: App, cardId: string, when: string): Promise<void> {
  try {
    await app.waitForCondition<boolean>(invariantHolds(cardId), { timeoutMs: 5000 });
  } catch (err) {
    const fr = await readFirstResponder(app);
    const key = await app.getActiveCardId();
    throw new Error(
      `[P21] broken ${when}: key card "${String(key)}", first responder "${fr}" (expected a responder inside card ${cardId}): ${String(err)}`,
    );
  }
}

/** The watchdog saw no illegal keyboard register across the scenario. */
async function expectNoViolations(app: App): Promise<void> {
  const report = await app.evalJS<{ violations: number }>(
    `window.__tug.getFocusInvariantReport()`,
  );
  expect(report.violations).toBe(0);
}

// ---------------------------------------------------------------------------
// Deck fixtures
// ---------------------------------------------------------------------------

const PROMPT_EDITOR_SELECTOR =
  '[data-card-id="A"] [data-slot="tug-text-editor"] .cm-content';

function promptDeckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-prompt-entry", title: "Prompt", closable: true },
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

/** Two panes: prompt card A (pane p1) beside prompt card B (pane p2). */
function twoPaneDeckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-prompt-entry", title: "Prompt A", closable: true },
      { id: "B", componentId: "gallery-prompt-entry", title: "Prompt B", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 20, y: 40 },
        size: { width: 560, height: 480 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
      {
        id: "p2",
        position: { x: 600, y: 40 },
        size: { width: 560, height: 480 },
        cardIds: ["B"],
        activeCardId: "B",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p2",
    hasFocus: true,
  };
}

function promptEditorSelector(cardId: string): string {
  return `[data-card-id="${cardId}"] [data-slot="tug-text-editor"] .cm-content`;
}

async function mountPromptDeck(app: App, shape: object, focusCardId: string): Promise<void> {
  await app.enableDeckTrace(true);
  await app.seedDeckState({ state: shape, focusCardId });
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(promptEditorSelector(focusCardId))}) !== null`,
    { timeoutMs: 15_000 },
  );
}

// ---------------------------------------------------------------------------
// Text card fixture
// ---------------------------------------------------------------------------

let dir = "";
let filePath = "";

const FILE_BODY = [
  "alpha meridian line one",
  "beta line two",
  "gamma Meridian line three",
  "delta meridian line four",
  "epsilon closing line",
].join("\n");

beforeAll(() => {
  if (!SHOULD_RUN) return;
  dir = mkdtempSync(join(tmpdir(), "at0224-"));
  filePath = join(dir, "fixture.txt");
  writeFileSync(filePath, FILE_BODY);
});

afterAll(() => {
  if (dir !== "" && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function textDeckShape() {
  return {
    cards: [{ id: "A", componentId: "text", title: "File", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 30, y: 30 },
        size: { width: 780, height: 560 },
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

const TEXT_EDITOR_CONTENT =
  '[data-card-id="A"] [data-slot="tug-text-card-editor"] .cm-content';
const BAR_SELECTOR = '[data-card-id="A"] [data-slot="text-card-find-bar"]';
const FIND_INPUT_CONTENT = `${BAR_SELECTOR} [data-testid="text-card-find-input"] .cm-content`;
const CHIP_SELECTOR = `${BAR_SELECTOR} [data-slot="find-count"] [data-slot="find-count-value"]`;

async function mountTextCard(app: App): Promise<void> {
  await app.enableDeckTrace(true);
  await app.seedDeckState({
    state: textDeckShape(),
    cardStates: {
      A: { content: { path: filePath, anchor: { line: 1, ch: 0 }, scrollTop: 0 } },
    },
    focusCardId: "A",
  });
  await app.waitForCondition<boolean>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(TEXT_EDITOR_CONTENT)});
      return el !== null && el.innerText.indexOf("alpha meridian") !== -1;
    })()`,
    { timeoutMs: 15_000 },
  );
}

async function waitForChip(app: App, expected: string): Promise<void> {
  await app.waitForCondition<boolean>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(CHIP_SELECTOR)});
      return el !== null && (el.textContent || '').trim() === ${JSON.stringify(expected)};
    })()`,
    { timeoutMs: 6000 },
  );
}

/**
 * The find field is a `dom-granted` text surface, so `document.activeElement`
 * IS the truth for it — this is the exception the engine route carves out, not
 * a violation of it.
 */
function findFieldHasCaret(scope: string): string {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(scope)});
    return input !== null && document.activeElement !== null &&
      (input.contains(document.activeElement) || input === document.activeElement);
  })()`;
}

// ---------------------------------------------------------------------------

describe.skipIf(!SHOULD_RUN)("AT0224: active-card keyboard contract", () => {
  test(
    "a title-bar click leaves the first responder serving the entry",
    async () => {
      const app = await launchTugApp({ testName: "at0224-title-bar" });
      try {
        await mountPromptDeck(app, promptDeckShape(), "A");

        // The user was working in the card: caret in the entry.
        await app.nativeClickAtElement(PROMPT_EDITOR_SELECTOR);
        await expectInvariant(app, "A", "after clicking into the entry");

        // The gesture under test: a click on the pane's TITLE BAR — chrome,
        // an activation/drag surface — must NOT steal first responder from
        // the entry.
        await app.nativeClickAtElement(TITLE_BAR_SELECTOR);
        await expectInvariant(app, "A", "after the title-bar click");
        await expectNoViolations(app);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "activating a DEACTIVATED card via its title bar restores its first responder",
    async () => {
      const app = await launchTugApp({ testName: "at0224-deactivated" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: twoPaneDeckShape(), focusCardId: "B" });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(promptEditorSelector("A"))}) !== null &&
           document.querySelector(${JSON.stringify(promptEditorSelector("B"))}) !== null`,
          { timeoutMs: 15_000 },
        );

        // Work in card A first (its key view is the entry), then move to B —
        // card A is now DEACTIVATED with a resting caret.
        await app.nativeClickAtElement(promptEditorSelector("A"));
        await expectInvariant(app, "A", "after clicking into card A");
        await app.nativeClickAtElement(promptEditorSelector("B"));
        await expectInvariant(app, "B", "after moving to card B");

        // Reactivate card A by its TITLE BAR — the engine must restore A's
        // first responder ([P21]'s finer-restore), and B must give it up.
        await app.nativeClickAtElement(
          `.tug-pane:has([data-card-id="A"]) ${TITLE_BAR_SELECTOR}`,
        );
        await expectInvariant(app, "A", "after reactivating card A by its title bar");

        // The chain holds exactly one first responder, and it is A's — B is
        // not left holding a stale one.
        const responderCount = await app.evalJS<number>(
          `document.querySelectorAll(${JSON.stringify(FIRST_RESPONDER)}).length`,
        );
        expect(responderCount).toBe(1);
        await expectNoViolations(app);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "title-bar click then ⌘F opens the text card's find bar (FIND reaches the editor)",
    async () => {
      const app = await launchTugApp({ testName: "at0224-find" });
      try {
        await mountTextCard(app);

        await app.nativeClickAtElement(TITLE_BAR_SELECTOR);
        await expectInvariant(app, "A", "after the title-bar click");

        const fr = await readFirstResponder(app);
        await dispatchChord(app, "KeyF", "f", { meta: true });
        try {
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(BAR_SELECTOR)}) !== null`,
            { timeoutMs: 5000 },
          );
        } catch (err) {
          throw new Error(
            `find bar did not open after title-bar click (first responder was "${fr}"): ${String(err)}`,
          );
        }
        // And the query field took the caret.
        await app.waitForCondition<boolean>(findFieldHasCaret(FIND_INPUT_CONTENT), {
          timeoutMs: 5000,
        });
        await expectNoViolations(app);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a text card opened via the open-file action (Open Quickly's commit path) owns ⌘F immediately",
    async () => {
      const app = await launchTugApp({ testName: "at0224-open-quickly" });
      try {
        // Start from a deck whose focus is elsewhere (a prompt card), then
        // open the file programmatically — the same entry Open Quickly's
        // Return commits through (also File ▸ Open…).
        await mountPromptDeck(app, promptDeckShape(), "A");
        await app.nativeClickAtElement(PROMPT_EDITOR_SELECTOR);
        await expectInvariant(app, "A", "after clicking into the prompt entry");

        await app.evalJS<null>(
          `(window.__tug.dispatchControlAction("open-file", { path: ${JSON.stringify(filePath)} }), null)`,
        );
        // The text card mounts and binds the file.
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector('[data-slot="tug-text-card-editor"] .cm-content');
            return el !== null && el.innerText.indexOf("alpha meridian") !== -1;
          })()`,
          { timeoutMs: 15_000 },
        );

        // The created-and-activated card owns the keyboard without a click —
        // the invariant holds on the fresh card id, whatever it is.
        const openedCardId = await app.waitForCondition<string>(
          `(function(){
            var el = document.querySelector('[data-slot="tug-text-card-editor"]');
            var host = el === null ? null : el.closest('[data-card-host][data-card-id]');
            return host === null ? "" : host.getAttribute('data-card-id');
          })()`,
          { timeoutMs: 5000 },
        );
        expect(openedCardId).not.toBe("");
        await expectInvariant(app, openedCardId, "on the freshly opened text card");

        // ⌘F must open the freshly-opened card's find bar — no click first.
        const fr = await readFirstResponder(app);
        await dispatchChord(app, "KeyF", "f", { meta: true });
        try {
          await app.waitForCondition<boolean>(
            `document.querySelector('[data-slot="text-card-find-bar"]') !== null`,
            { timeoutMs: 5000 },
          );
        } catch (err) {
          throw new Error(
            `find bar did not open on the freshly-opened card (first responder "${fr}"): ${String(err)}`,
          );
        }
        // Typing lands in the query field and the RESULTS badge shows.
        await app.waitForCondition<boolean>(
          findFieldHasCaret(
            '[data-slot="text-card-find-bar"] [data-testid="text-card-find-input"] .cm-content',
          ),
          { timeoutMs: 5000 },
        );
        await app.nativeType("meridian");
        await app.waitForCondition<boolean>(
          `(() => {
            const badge = document.querySelector('[data-slot="text-card-find-bar"] [data-slot="find-count"]');
            if (!badge) return false;
            const value = badge.querySelector('[data-slot="find-count-value"]');
            return getComputedStyle(badge).visibility === 'visible' &&
              badge.getBoundingClientRect().width > 0 &&
              value !== null && (value.textContent || '').trim() === '1 of 3';
          })()`,
          { timeoutMs: 6000 },
        );
        await expectNoViolations(app);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "cycling to a never-focused text card gives it ⌘F, and a title-bar click doesn't wedge it",
    async () => {
      const app = await launchTugApp({ testName: "at0224-cycle" });
      try {
        // Text card (never focused) in p1; prompt card focused in p2.
        await app.enableDeckTrace(true);
        await app.seedDeckState({
          state: {
            cards: [
              { id: "T", componentId: "text", title: "File", closable: true },
              { id: "B", componentId: "gallery-prompt-entry", title: "Prompt", closable: true },
            ],
            panes: [
              {
                id: "p1",
                position: { x: 20, y: 40 },
                size: { width: 620, height: 500 },
                cardIds: ["T"],
                activeCardId: "T",
                title: "",
                acceptsFamilies: ["maker"],
              },
              {
                id: "p2",
                position: { x: 660, y: 40 },
                size: { width: 560, height: 480 },
                cardIds: ["B"],
                activeCardId: "B",
                title: "",
                acceptsFamilies: ["maker"],
              },
            ],
            activePaneId: "p2",
            hasFocus: true,
          },
          cardStates: {
            T: { content: { path: filePath, anchor: { line: 1, ch: 0 }, scrollTop: 0 } },
          },
          focusCardId: "B",
        });
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector('[data-card-id="T"] [data-slot="tug-text-card-editor"] .cm-content');
            return el !== null && el.innerText.indexOf("alpha meridian") !== -1;
          })()`,
          { timeoutMs: 15_000 },
        );
        // Work in the prompt card so first responder rests in pane p2.
        await app.nativeClickAtElement(promptEditorSelector("B"));
        await expectInvariant(app, "B", "after clicking into the prompt card");

        // Cycle (Ctrl-`) to the text card's pane — an activation with no
        // click and no focusin, on a card that has never been focused.
        await dispatchChord(app, "Backquote", "`", { ctrl: true });
        await expectInvariant(app, "T", "after cycling to the never-focused text card");

        // ⌘F must open the cycled-to card's find bar.
        const fr = await readFirstResponder(app);
        await dispatchChord(app, "KeyF", "f", { meta: true });
        try {
          await app.waitForCondition<boolean>(
            `document.querySelector('[data-card-id="T"] [data-slot="text-card-find-bar"]') !== null`,
            { timeoutMs: 5000 },
          );
        } catch (err) {
          throw new Error(
            `find bar did not open on the cycled-to card (first responder "${fr}"): ${String(err)}`,
          );
        }

        // A title-bar click on the SAME pane must not wedge the keyboard:
        // ⌘G still routes (the bar owns find navigation).
        await app.waitForCondition<boolean>(
          findFieldHasCaret(
            '[data-card-id="T"] [data-testid="text-card-find-input"] .cm-content',
          ),
          { timeoutMs: 5000 },
        );
        await app.nativeType("meridian");
        await app.waitForCondition<boolean>(
          `(() => {
            const el = document.querySelector('[data-card-id="T"] [data-slot="find-count"] [data-slot="find-count-value"]');
            return el !== null && (el.textContent || '').trim() === '1 of 3';
          })()`,
          { timeoutMs: 6000 },
        );
        await app.nativeClickAtElement(
          '.tug-pane:has([data-card-id="T"]) [data-slot="tug-pane-title-bar"]',
        );
        await expectInvariant(app, "T", "after the title-bar click on the cycled card");
        const fr2 = await readFirstResponder(app);
        await dispatchChord(app, "KeyG", "g", { meta: true });
        try {
          await app.waitForCondition<boolean>(
            `(() => {
              const el = document.querySelector('[data-card-id="T"] [data-slot="find-count"] [data-slot="find-count-value"]');
              return el !== null && (el.textContent || '').trim() === '2 of 3';
            })()`,
            { timeoutMs: 5000 },
          );
        } catch (err) {
          throw new Error(
            `⌘G dead after title-bar click on the cycled card (first responder "${fr2}"): ${String(err)}`,
          );
        }
        await expectNoViolations(app);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "⌘G / ⇧⌘G advance and retreat the match while the find FIELD is focused",
    async () => {
      const app = await launchTugApp({ testName: "at0224-cmdg" });
      try {
        await mountTextCard(app);
        // Open the bar from the editor (the known-good path).
        await app.nativeClickAtElement(TEXT_EDITOR_CONTENT);
        await dispatchChord(app, "KeyF", "f", { meta: true });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(BAR_SELECTOR)}) !== null`,
          { timeoutMs: 5000 },
        );
        await app.waitForCondition<boolean>(findFieldHasCaret(FIND_INPUT_CONTENT), {
          timeoutMs: 5000,
        });
        await app.nativeType("meridian");
        await waitForChip(app, "1 of 3");

        // ⌘G with focus still in the FIND FIELD must advance…
        const fr = await readFirstResponder(app);
        await dispatchChord(app, "KeyG", "g", { meta: true });
        try {
          await waitForChip(app, "2 of 3");
        } catch (err) {
          throw new Error(
            `⌘G did not advance from the find field (first responder was "${fr}"): ${String(err)}`,
          );
        }
        // …and ⇧⌘G retreats.
        await dispatchChord(app, "KeyG", "g", { meta: true, shift: true });
        await waitForChip(app, "1 of 3");
        await expectNoViolations(app);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
