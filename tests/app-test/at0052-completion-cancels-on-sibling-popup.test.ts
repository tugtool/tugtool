/**
 * at0052-completion-cancels-on-sibling-popup.test.ts —
 * The image-5 bug-reproducer.
 *
 * Per `tugplan-dev-popup-bindings.md` Step 4 / [D05] / (#companion-binding).
 * Original report: in a gallery-text-editor card, opening `@`/`/`
 * completion and then clicking the font-family `TugPopupButton`
 * (a sibling of the editor inside the card's toolbar) left the
 * completion popup visible — the typeahead state stayed active and
 * the menu painted on top of the just-opened font picker.
 *
 * The fix wires `<CompletionOverlay>` to `useCompanionPopupBinding`,
 * which observes DOM focus on the editor's `view.contentDOM`. When
 * Radix's `FocusScope.onMountAutoFocus` grabs DOM focus into the
 * font picker's content, contentDOM blurs; the binding queues a
 * microtask, observes the was-inside → now-outside transition, and
 * dispatches `cancelCompletion(view)`. The completion popup paints
 * `display: none` on the next state cycle.
 *
 * Why the `/` trigger (not `@` from the bug report): `gallery-text-
 * editor`'s `/` provider is fixture-backed by `system-metadata-fixture`
 * and yields deterministic items under app-test launch. The `@`
 * provider depends on a bound workspace's file-tree, which is harder
 * to make deterministic. The bug class — DOM focus leaving contentDOM
 * cancels the typeahead — is identical across triggers, so `/`
 * exercises the load-bearing invariant without the file-tree
 * dependency.
 *
 * What this test asserts:
 *   - Pre-condition: `/` popup is visible (display: block) with
 *     items, and `view.contentDOM` is the focused element.
 *   - After native click on the font-family popup-button:
 *       - completion popup transitions to `display: none`,
 *       - typeahead state is inactive (`getCompletionState(view).active === false`).
 *
 * What this test does NOT assert:
 *   - The font-picker menu opens. That's the popup-button's job
 *     and is covered by other tests.
 *   - Focus eventually returns to the editor on close. That's
 *     Step 5's service-binding territory and is gated by AT-tag
 *     allocated in Step 5.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const TUG_EDIT_CONTENT_SELECTOR = '[data-slot="tug-text-editor"] .cm-content';
const COMPLETION_MENU_SELECTOR = '[data-slot="tug-completion-menu"]';
// First [aria-haspopup="menu"] button inside the gallery toolbar — the
// font-family TugPopupButton. Three other TugPopupButton siblings
// follow (font-size, line-height, letter-spacing); any of them would
// trigger the same Radix `FocusScope` handoff. We pick the first to
// match the bug report's "font picker" wording.
const FONT_PICKER_BUTTON_SELECTOR =
  '[data-card-id="A"] .gallery-text-editor-toolbar [data-slot="tug-button"][aria-haspopup="menu"]';

function deckShape() {
  return {
    cards: [
      {
        id: "A",
        componentId: "gallery-text-editor",
        title: "TugTextEditor A",
        closable: true,
      },
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

async function setupGallery(app: App): Promise<void> {
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
  const editorSelector = `[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}`;
  await app.nativeClickAtElement(editorSelector);
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(editorSelector)})`,
    { timeoutMs: 2000 },
  );
}

interface TypeaheadProbe {
  /** True iff the popup `<div>` is `display: block`. */
  popupVisible: boolean;
  /** Number of menu items currently in the popup. */
  itemCount: number;
  /** Tag of the currently focused element, for diagnostic dumps. */
  activeElementTag: string;
}

async function probeTypeahead(app: App): Promise<TypeaheadProbe> {
  return app.evalJS<TypeaheadProbe>(
    `(function(){
      var popup = document.querySelector(${JSON.stringify(COMPLETION_MENU_SELECTOR)});
      var items = popup ? popup.querySelectorAll(".tug-completion-menu-item") : [];
      var display = popup
        ? (popup.style.display || getComputedStyle(popup).display)
        : "";
      var ae = document.activeElement;
      var aeTag = ae ? ae.tagName + (ae.className ? "." + ae.className : "") : "(none)";
      return {
        popupVisible: display === "block",
        itemCount: items.length,
        activeElementTag: aeTag,
      };
    })()`,
  );
}

async function waitForPopupVisible(app: App, timeoutMs = 4000): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var popup = document.querySelector(${JSON.stringify(COMPLETION_MENU_SELECTOR)});
      if (!popup) return false;
      var display = popup.style.display || getComputedStyle(popup).display;
      var items = popup.querySelectorAll(".tug-completion-menu-item");
      return display === "block" && items.length > 0;
    })()`,
    { timeoutMs },
  );
}

async function waitForPopupHidden(app: App, timeoutMs = 4000): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var popup = document.querySelector(${JSON.stringify(COMPLETION_MENU_SELECTOR)});
      if (!popup) return true;
      var display = popup.style.display || getComputedStyle(popup).display;
      return display === "none";
    })()`,
    { timeoutMs },
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0052 — completion popup cancels when sibling TugPopupButton grabs focus",
  () => {
    test(
      "image 5 bug-reproducer: open `/` typeahead, click font-family popup-button, popup vanishes",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0052-completion-cancels-on-sibling-popup",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);

            // Trigger `/` completion in the editor. Fixture-backed
            // provider populates deterministic items.
            await app.nativeType("/");
            await waitForPopupVisible(app);

            const before = await probeTypeahead(app);
            expect(before.popupVisible, "completion popup is visible").toBe(true);
            expect(before.itemCount, "completion popup has at least one item").toBeGreaterThan(0);

            // Native click on the font-family popup-button. This is
            // the EXACT sequence the bug surfaced under: trigger click
            // → Radix `Popover/DropdownMenu` mounts content → Radix
            // `FocusScope.onMountAutoFocus` programmatically focuses
            // the first menu item → focusout fires on the editor's
            // contentDOM. With the companion-binding wired,
            // `useCompanionPopupBinding` observes that focusout, queues
            // a microtask, reads `document.activeElement` (now inside
            // the picker's menu), sees `nowInside === false`, and
            // dispatches `cancelCompletion(view)`.
            await app.nativeClickAtElement(FONT_PICKER_BUTTON_SELECTOR);

            // Wait for the completion popup to hide. The sequence
            // (focusout → microtask → cancelCompletion → state field
            // update → painter → display:none) is asynchronous from
            // the test's perspective, but bounded; 2s is generous.
            await waitForPopupHidden(app, 2000);

            const after = await probeTypeahead(app);
            expect(after.popupVisible, "completion popup is hidden after font-picker click").toBe(false);
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
