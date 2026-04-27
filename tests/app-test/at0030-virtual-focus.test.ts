/**
 * at0030-virtual-focus.test.ts — composite-component user-visible value
 * survives cmd-tab + reload via the Component Persistence Protocol
 * [A9] ([AT0030] / [AT0027] composite-components
 * subset).
 *
 * ## Why this exists
 *
 * Pre-25E, `tug-switch` / `tug-radio-group` / `tug-choice-group` /
 * `tug-option-group` / `tug-slider` / `tug-value-input` had no
 * persistence at all — the user's selection / numeric value was lost
 * on every reload, every cmd-tab. [L23] violation: internal
 * implementation operations (mount-time React state init) destroyed
 * user-visible state.
 *
 * Uses `componentStatePreservationKey` + `useComponentPersistence` to each
 * component. Two patterns coexist:
 *
 *   - **Uncontrolled-friendly** (`tug-switch`, `tug-radio-group`):
 *     have `defaultValue`/`defaultChecked`, mirror Radix in
 *     `useState`, capture/restore the mirror.
 *   - **Controlled-only** (`tug-choice-group`, `tug-option-group`,
 *     `tug-slider`, `tug-value-input`): `value` is required, parent
 *     owns truth. Restore re-dispatches `selectValue` / `setValue`
 *     through the responder chain so the parent updates its state.
 *
 * Both patterns produce the same on-disk shape under
 * `bag.components[componentStatePreservationKey]`.
 *
 * ## Scope
 *
 * `tug-popup-button` and `tug-tab-bar` are intentionally not in this matrix.
 * Popup-button is a command surface (each item dispatches a one-shot
 * action; no persistent value to capture). Tab-bar's "active tab" is
 * already the deck's `paneState.activeCardId` — adding a
 * `bag.components` axis would duplicate that state ([L23] violation).
 * Both are documented as deferred.
 *
 * ## Test matrix
 *
 *   6 components × 1 trigger = 6 tests.
 *
 *   - Components: switch, radio-group, choice-group, option-group,
 *     slider, value-input. Each gallery card wires `componentStatePreservationKey` + a
 *     `data-testid` on a single instance for the harness to scope.
 *   - Trigger: `appReload` (fresh WKWebView, disk round-trip). This
 *     gates the full persistence pipeline: capture → save → flush →
 *     load → restore.
 *
 * The `simulateAppResign+Become` (cmd-tab) and
 * `quitGracefully+relaunch` triggers are not added in 25E.
 * The resign / become-active transition is already covered for
 * persistence by the framework-level tests (m04 app-resign-return,
 * m05 app-hide-unhide, m17 saveState RPC parity), which exercise
 * the same will-phase save → cardStateCache write path that
 * `useComponentPersistence` rides on. Component-specific cmd-tab
 * coverage can be added as a follow-up if a regression surfaces.
 *
 * Each test seeds `bag.components.{componentStatePreservationKey}` with a non-default
 * value, drives the trigger, and asserts the value survives via a
 * component-specific live-state probe.
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

const TEST_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Per-component fixtures: componentId, componentStatePreservationKey, seed payload, live probe.
// ---------------------------------------------------------------------------

interface ComponentFixture {
  /** Stable test name. */
  label: string;
  /** Gallery componentId for the seedDeckState card row. */
  componentId: string;
  /** componentStatePreservationKey used by the gallery instance. */
  componentStatePreservationKey: string;
  /** Bag.components payload to seed under `componentStatePreservationKey`. */
  seedPayload: Record<string, unknown>;
  /**
   * Live-state assertion: throws if the component's user-visible state
   * does not reflect the seeded value. Run after restore to verify the
   * payload reached the live UI.
   */
  assertLive: (app: App) => Promise<void>;
}

const FIXTURES: ReadonlyArray<ComponentFixture> = [
  {
    label: "switch",
    componentId: "gallery-switch",
    componentStatePreservationKey: "switch-md",
    seedPayload: { checked: false }, // gallery default is `defaultChecked`
    assertLive: async (app) => {
      // Radix switch surfaces data-state="checked" / "unchecked".
      await app.waitForCondition<boolean>(
        `(function(){
          var el = document.querySelector('[data-card-id="A"] [data-testid="gallery-switch-persistent"]');
          return el !== null && el.getAttribute("data-state") === "unchecked";
        })()`,
        { timeoutMs: 4000 },
      );
      const state = await app.evalJS<string | null>(
        `(function(){
          var el = document.querySelector('[data-card-id="A"] [data-testid="gallery-switch-persistent"]');
          return el ? el.getAttribute("data-state") : null;
        })()`,
      );
      expect(state, "switch data-state must reflect restored unchecked").toBe("unchecked");
    },
  },
  {
    label: "radio-group",
    componentId: "gallery-radio-group",
    componentStatePreservationKey: "radio-md",
    seedPayload: { value: "c" }, // gallery defaults to "b"
    assertLive: async (app) => {
      // Radix radio item with value="c" gets data-state="checked".
      await app.waitForCondition<boolean>(
        `(function(){
          var group = document.querySelector('[data-card-id="A"] [data-testid="gallery-radio-persistent"]');
          if (!group) return false;
          var checked = group.querySelector('[data-state="checked"]');
          return checked !== null && checked.getAttribute("value") === "c";
        })()`,
        { timeoutMs: 4000 },
      );
    },
  },
  {
    label: "choice-group",
    componentId: "gallery-choice-group",
    componentStatePreservationKey: "choice-md",
    seedPayload: { value: "gamma" }, // gallery typically defaults to "alpha"/"beta"
    assertLive: async (app) => {
      // The active segment carries data-state="active".
      await app.waitForCondition<boolean>(
        `(function(){
          var group = document.querySelector('[data-card-id="A"] [data-testid="gallery-choice-persistent"]');
          if (!group) return false;
          var radios = group.querySelectorAll('[role="radio"]');
          for (var i = 0; i < radios.length; i++) {
            if (radios[i].getAttribute("data-state") === "active") {
              var icon = radios[i].querySelector('.tug-group-item-icon');
              var label = radios[i].querySelector('.tug-group-item-label');
              var t = (label ? label.textContent : (icon ? icon.textContent : ""));
              return (t || "").trim() === "Gamma";
            }
          }
          return false;
        })()`,
        { timeoutMs: 4000 },
      );
    },
  },
  {
    label: "option-group",
    componentId: "gallery-option-group",
    componentStatePreservationKey: "option-format",
    seedPayload: { value: ["bold", "underline"] },
    assertLive: async (app) => {
      // Each toggled option button has aria-pressed="true".
      await app.waitForCondition<boolean>(
        `(function(){
          var group = document.querySelector('[data-card-id="A"] [data-testid="gallery-option-persistent"]');
          if (!group) return false;
          var pressed = [];
          var btns = group.querySelectorAll('button[aria-pressed]');
          for (var i = 0; i < btns.length; i++) {
            if (btns[i].getAttribute("aria-pressed") === "true") {
              pressed.push(btns[i].getAttribute("aria-label") || "");
            }
          }
          pressed.sort();
          return pressed.length === 2 && pressed[0] === "Bold" && pressed[1] === "Underline";
        })()`,
        { timeoutMs: 4000 },
      );
    },
  },
  {
    label: "slider",
    componentId: "gallery-slider",
    componentStatePreservationKey: "slider-md",
    seedPayload: { value: 73 }, // arbitrary non-default
    assertLive: async (app) => {
      // Radix slider surfaces aria-valuenow on the thumb. The gallery
      // also renders a "Value: N" label that updates as state flows.
      // Use the label's textContent for a stable probe.
      await app.waitForCondition<boolean>(
        `(function(){
          var card = document.querySelector('[data-card-id="A"]');
          if (!card) return false;
          var labels = card.querySelectorAll('.cg-section, .gs-size-row, *');
          for (var i = 0; i < labels.length; i++) {
            var t = labels[i].textContent || "";
            if (t.indexOf("Value: 73") !== -1) return true;
          }
          return false;
        })()`,
        { timeoutMs: 4000 },
      );
    },
  },
  {
    label: "value-input",
    componentId: "gallery-value-input",
    componentStatePreservationKey: "value-input-md",
    seedPayload: { value: 42 },
    assertLive: async (app) => {
      // The gallery renders "Value: N" alongside each input, sourced
      // from the same React state the input reflects.
      await app.waitForCondition<boolean>(
        `(function(){
          var card = document.querySelector('[data-card-id="A"]');
          if (!card) return false;
          var t = card.textContent || "";
          return t.indexOf("Value: 42") !== -1;
        })()`,
        { timeoutMs: 4000 },
      );
    },
  },
];

function deckShape(componentId: string) {
  return {
    cards: [
      { id: "A", componentId, title: "Card A", closable: true },
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

function makeBag(fixture: ComponentFixture): Record<string, unknown> {
  return {
    components: {
      [fixture.componentStatePreservationKey]: fixture.seedPayload,
    },
  };
}

async function seedAndMount(app: App, fixture: ComponentFixture): Promise<void> {
  await app.enableDeckTrace(true);
  await app.seedDeckState({
    state: deckShape(fixture.componentId),
    cardStates: { A: makeBag(fixture) },
    focusCardId: "A",
  });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
}

interface DiskBag {
  components?: Record<string, unknown>;
}

function readDiskValue(tugbankPath: string, key: string): unknown {
  const onDisk = tugbankRead<DiskBag>(
    tugbankPath,
    "dev.tugtool.deck.cardstate",
    "A",
  );
  if (!onDisk) return undefined;
  const bag = onDisk.value as DiskBag | undefined;
  return bag?.components?.[key];
}

async function reseedFromDisk(
  app: App,
  fixture: ComponentFixture,
  tugbankPath: string,
): Promise<void> {
  const onDisk = tugbankRead<unknown>(
    tugbankPath,
    "dev.tugtool.deck.cardstate",
    "A",
  );
  expect(onDisk).not.toBeNull();
  await app.enableDeckTrace(true);
  await app.seedDeckState({
    state: deckShape(fixture.componentId),
    cardStates: { A: onDisk!.value as Record<string, unknown> },
    focusCardId: "A",
  });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
}

// ---------------------------------------------------------------------------
// Trigger drivers
// ---------------------------------------------------------------------------

async function runAppReloadScenario(fixture: ComponentFixture): Promise<void> {
  const tugbankPath = mkTempTugbank();
  try {
    seedTugbankForLaunch(tugbankPath);
    const app = await launchTugApp({
      testName: `m30-${fixture.label}-app-reload`,
      env: { TUGBANK_PATH: tugbankPath },
      persistInTestMode: true,
    });
    try {
      await seedAndMount(app, fixture);
      await app.appReload();

      const onDisk = readDiskValue(tugbankPath, fixture.componentStatePreservationKey);
      expect(
        onDisk,
        `axis bag.components[${fixture.componentStatePreservationKey}]: appReload must round-trip seeded payload to disk`,
      ).toEqual(fixture.seedPayload);

      await reseedFromDisk(app, fixture, tugbankPath);
      await fixture.assertLive(app);
    } finally {
      await app.close();
    }
  } finally {
    rmTempTugbank(tugbankPath);
  }
}

describe.skipIf(!SHOULD_RUN)("m30: composite-component value survives transitions", () => {
  for (const fixture of FIXTURES) {
    test(
      `${fixture.label} × appReload`,
      () => runAppReloadScenario(fixture),
      TEST_TIMEOUT_MS,
    );
  }
});
