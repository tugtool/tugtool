/**
 * at0085-prompt-entry-route.test.ts — TugPromptEntry's route survives a
 * reload and flips on each of its triggers, now that the route is
 * owned by a per-prompt-entry `RouteLifecycle` ([AT0085]).
 *
 * ## Why this exists
 *
 * Step 4 of the dev-prompt-entry-zones plan moved route ownership out
 * of `TugPromptEntry`'s `useState` into a `RouteLifecycle` instance
 * ([D02]). The component now reads the route via `useSyncExternalStore`
 * and every route trigger funnels through `routeLifecycle.setRoute`.
 *
 * Two regression surfaces:
 *
 *   1. **Risk R02 — persistence.** The route rides `bag.content.route`.
 *      `onSave` reads `routeLifecycle.getRoute()`; `onRestore` calls
 *      `routeLifecycle.setRoute(restored)`. A non-default route must
 *      survive close → reopen.
 *
 *   2. **The two triggers.** The route popup pick (SELECT_VALUE) and
 *      the SELECT_ROUTE keybinding both call `routeLifecycle.setRoute`.
 *      Each must still flip the route. Typing a route character (`$`,
 *      `?`, `>`) is deliberately NOT a trigger — first-character route
 *      switching was removed; those characters are ordinary text.
 *
 * ## Test matrix
 *
 *   4 tests, one card (`gallery-prompt-entry` — the same wrapper Dev
 *   uses, exercised by [AT0024]):
 *
 *   1. A non-default route (`$` Shell) survives `appReload` — Risk R02.
 *   2. A route popup pick flips `❯` Code → `$` Shell.
 *   3. The ⇧⌘C SELECT_ROUTE keybinding flips `$` Shell → `❯` Code.
 *   4. Typing `$` at offset 0 stays text — the route does NOT flip.
 *
 * The live route is read off the popup trigger's label text: the trigger
 * paints the current route (a direct projection of
 * `routeLifecycle.getRoute()` through `useSyncExternalStore`).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
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

// Route values, mirroring `ROUTE_ITEMS` / `DEFAULT_ROUTE` in
// `tug-prompt-entry.tsx`. The popup lists these in this order.
const ROUTE_CODE = "❯";
const ROUTE_SHELL = "$";

/** Segment label rendered for each route value. */
const LABEL_BY_ROUTE: Readonly<Record<string, string>> = {
  [ROUTE_CODE]: "Code",
  [ROUTE_SHELL]: "Shell",
};

const EDITOR_SELECTOR =
  '[data-card-id="A"] [data-slot="tug-text-editor"] .cm-content';
/** The Z4A route popup trigger — a filled button whose text is the current
 *  route's label. */
const ROUTE_TRIGGER_SELECTOR =
  '[data-card-id="A"] .tug-prompt-entry-toolbar button[aria-label="Route"]';
/** The trigger is width-stabilized, so it holds BOTH the active label and a
 *  hidden alternate; read the active variant to get the live route label. */
const ROUTE_LABEL_SELECTOR = `${ROUTE_TRIGGER_SELECTOR} [data-tug-stable="active"]`;
/** A route item inside the open popup menu (portaled), keyed by route char. */
function routeMenuItemSelector(route: string): string {
  return `.tug-menu-item[data-item-id="${route}"]`;
}

// ---------------------------------------------------------------------------
// Deck shape + mount
// ---------------------------------------------------------------------------

function deckShape() {
  return {
    cards: [
      {
        id: "A",
        componentId: "gallery-prompt-entry",
        title: "Prompt",
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
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** A `bag.content` carrying just a route — no draft. */
function routeContentBag(route: string): Record<string, unknown> {
  return { content: { route, draft: null, maximized: false } };
}

async function mountCard(
  app: App,
  cardStates: Record<string, unknown>,
): Promise<void> {
  await app.enableDeckTrace(true);
  await app.seedDeckState({
    state: deckShape(),
    cardStates,
    focusCardId: "A",
  });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.awaitEngineReady("A");
}

// ---------------------------------------------------------------------------
// Route readout — the live route is the popup trigger's label text
// ---------------------------------------------------------------------------

/** The label painted on the route popup trigger, e.g. `"Code"`; `null` if
 *  the trigger is not mounted. */
async function readActiveRouteLabel(app: App): Promise<string | null> {
  return await app.evalJS<string | null>(
    `(function(){
      var lbl = document.querySelector(${JSON.stringify(ROUTE_LABEL_SELECTOR)});
      return lbl ? lbl.textContent.trim() : null;
    })()`,
  );
}

/** Block until the route popup trigger reads `LABEL_BY_ROUTE[route]`. */
async function waitForRoute(app: App, route: string): Promise<void> {
  const label = LABEL_BY_ROUTE[route];
  await app.waitForCondition<boolean>(
    `(function(){
      var lbl = document.querySelector(${JSON.stringify(ROUTE_LABEL_SELECTOR)});
      return lbl !== null && lbl.textContent.trim() === ${JSON.stringify(label)};
    })()`,
    { timeoutMs: 4000 },
  );
}

/** Open the route popup and pick `route`, then block until it takes. The
 *  menu applies the selection after its blink animation, so `waitForRoute`
 *  absorbs that latency. */
async function selectRouteViaPopup(app: App, route: string): Promise<void> {
  await app.click(ROUTE_TRIGGER_SELECTOR);
  await app.click(routeMenuItemSelector(route));
  await waitForRoute(app, route);
}

/** Focus the embedded editor and wait until it is `document.activeElement`. */
async function focusEditor(app: App): Promise<void> {
  await app.nativeClickAtElement(EDITOR_SELECTOR);
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(EDITOR_SELECTOR)})`,
    { timeoutMs: 2000 },
  );
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/**
 * Test 1 — Risk R02. Seed a non-default route, reload, and confirm it
 * round-trips through `bag.content.route` to disk and back.
 */
async function runRoundtripScenario(): Promise<void> {
  const tugbankPath = mkTempTugbank();
  try {
    seedTugbankForLaunch(tugbankPath);
    const app = await launchTugApp({
      testName: "m85-route-roundtrip",
      env: { TUGBANK_PATH: tugbankPath },
      persistInTestMode: true,
    });
    try {
      await mountCard(app, { A: routeContentBag(ROUTE_SHELL) });
      // `onRestore` applied the seeded route through the lifecycle.
      await waitForRoute(app, ROUTE_SHELL);

      await app.appReload();

      // Disk gate — the reload's save chain wrote the live route.
      const onDisk = tugbankRead<{ content?: { route?: string } }>(
        tugbankPath,
        "dev.tugtool.deck.cardstate",
        "A",
      );
      expect(onDisk, "expected an on-disk cardstate bag after reload").not.toBeNull();
      expect(
        onDisk!.value.content?.route,
        "Risk R02: appReload must persist the non-default route to disk",
      ).toBe(ROUTE_SHELL);

      // Re-seed from disk and confirm the live route restores.
      await mountCard(app, { A: onDisk!.value as Record<string, unknown> });
      await waitForRoute(app, ROUTE_SHELL);
      expect(
        await readActiveRouteLabel(app),
        "Risk R02: the restored route must be Shell after reload",
      ).toBe(LABEL_BY_ROUTE[ROUTE_SHELL]);
    } finally {
      await app.close();
    }
  } finally {
    rmTempTugbank(tugbankPath);
  }
}

/**
 * Test 2 — the popup click trigger. Opening the route popup and picking
 * Shell dispatches SELECT_VALUE, which the entry's handler turns into
 * `routeLifecycle.setRoute`.
 */
async function runClickTriggerScenario(): Promise<void> {
  const app = await launchTugApp({ testName: "m85-route-click" });
  try {
    await mountCard(app, {});
    await waitForRoute(app, ROUTE_CODE);

    await selectRouteViaPopup(app, ROUTE_SHELL);

    expect(
      await readActiveRouteLabel(app),
      "a route popup pick must flip the route to Shell",
    ).toBe(LABEL_BY_ROUTE[ROUTE_SHELL]);
  } finally {
    await app.close();
  }
}

/**
 * Test 3 — the SELECT_ROUTE keybinding trigger. ⇧⌘C dispatches
 * SELECT_ROUTE with `value: "❯"`; the entry's handler routes it through
 * `routeLifecycle.setRoute`.
 */
async function runKeybindingTriggerScenario(): Promise<void> {
  const app = await launchTugApp({ testName: "m85-route-keybinding" });
  try {
    await mountCard(app, { A: routeContentBag(ROUTE_SHELL) });
    await waitForRoute(app, ROUTE_SHELL);

    // Focus the editor so the prompt entry's responder node is the
    // first responder the keybinding dispatches to.
    await focusEditor(app);
    // Drive the ⇧⌘C keydown the Stage-1 capture listener matches.
    // `matchKeybinding` keys purely on `event.code` + modifiers and
    // does not check `isTrusted`, so a synthetic event exercises the
    // exact keybinding → SELECT_ROUTE → handler path a real keystroke
    // would — without the OS input stack between.
    await app.evalJS<boolean>(
      `(function(){
        var target = document.activeElement || document;
        return target.dispatchEvent(new KeyboardEvent("keydown", {
          code: "KeyC",
          key: "C",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
          composed: true,
        }));
      })()`,
    );

    await waitForRoute(app, ROUTE_CODE);
    expect(
      await readActiveRouteLabel(app),
      "the ⇧⌘C SELECT_ROUTE keybinding must flip the route to Code",
    ).toBe(LABEL_BY_ROUTE[ROUTE_CODE]);
  } finally {
    await app.close();
  }
}

/**
 * Test 4 — route characters are ordinary text. Typing `$` at offset 0 of
 * the editor inserts the character and leaves the route alone
 * (first-character route switching was removed).
 */
async function runPrefixIsTextScenario(): Promise<void> {
  const app = await launchTugApp({ testName: "m85-route-prefix-is-text" });
  try {
    await mountCard(app, {});
    await waitForRoute(app, ROUTE_CODE);

    await focusEditor(app);
    await app.nativeType("$HOME");

    // The typed text landed in the doc — the positive signal that input
    // settled before the negative route assertion below.
    await app.waitForCondition<boolean>(
      `(function(){
        var el = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
        return el !== null && el.textContent.indexOf("$HOME") !== -1;
      })()`,
      { timeoutMs: 4000 },
    );
    expect(
      await readActiveRouteLabel(app),
      "typing `$` at offset 0 must NOT flip the route — it is ordinary text",
    ).toBe(LABEL_BY_ROUTE[ROUTE_CODE]);
  } finally {
    await app.close();
  }
}

// ---------------------------------------------------------------------------

describe.skipIf(!SHOULD_RUN)(
  "m85: TugPromptEntry route through RouteLifecycle",
  () => {
    test(
      "a non-default route survives appReload (Risk R02)",
      runRoundtripScenario,
      TEST_TIMEOUT_MS,
    );
    test(
      "a route popup pick flips the route",
      runClickTriggerScenario,
      TEST_TIMEOUT_MS,
    );
    test(
      "the SELECT_ROUTE keybinding flips the route",
      runKeybindingTriggerScenario,
      TEST_TIMEOUT_MS,
    );
    test(
      "typing a route character stays text and does not flip the route",
      runPrefixIsTextScenario,
      TEST_TIMEOUT_MS,
    );
  },
);
