/**
 * at0031-prompt-entry-chrome.test.ts — TugPromptEntry's tools popover
 * open/closed flag survives cmd-tab + reload via the Component
 * Persistence Protocol [A9] ([AT0031]).
 *
 * ## Why this exists (and what it does NOT cover)
 *
 * Pre-25G, the entry's tools popover open flag was plain
 * `useState` — no persistence. Open the popover, cmd-tab away,
 * come back: closed. Reload: closed. The active route + per-route
 * engine drafts already persisted via `bag.content`
 * (`{ currentRoute, perRoute, maximized }`) and are gated by [AT0024].
 *
 * Uses `useComponentPersistence` registered with
 * `persistKey="entry-chrome"` that captures `{ toolsOpen }` into
 * `bag.components[persistKey]`. The active route stays in
 * `bag.content.currentRoute` because it is the index into
 * `bag.content.perRoute` — splitting them across two bags would
 * require a two-phase restore that violates [L23].
 *
 * What m31 covers, that m24 doesn't:
 *
 *   - **`toolsOpen` axis** — wholly new. m24 doesn't know the
 *     popover exists.
 *   - **`bag.components` pipeline for the entry** — exercises the
 *     [A9] orchestrator's component-restore phase, distinct from
 *     `useCardPersistence`'s content path.
 *   - **cmd-tab transition for the entry's chrome** — m24 covers
 *     `appReload` + `quitGracefully+relaunch` but not
 *     `simulateAppResign+Become`.
 *
 * Engine content + route survival across the same triggers is
 * covered by m24 (full-content seed, four-axis assertion). m31
 * focuses on the chrome axis 25G adds — but seeds full content
 * alongside it so a regression that loses content while persisting
 * chrome (or vice versa) surfaces here too.
 *
 * ## Test matrix
 *
 *   1 card × 3 triggers = 3 tests.
 *
 *   - Card: `gallery-prompt-entry` (the showcase).
 *   - Triggers: `appReload`, `quitGracefully+relaunch`, `cmd-tab`
 *     (`simulateAppResign+Become`). The first two persist to
 *     tugbank disk and re-mount on a fresh WKWebView; the third
 *     keeps the same WebView but exercises the will-phase save.
 *
 * ## Why tide is not covered
 *
 * Tide-card mounts its `TugPromptEntry` lazily — it renders a
 * project-picker until `bindTideSession` succeeds, then swaps in
 * the editor. CardHost's component-restore effect is one-shot at
 * card mount (gated by `hasRestoredComponentsRef`), so it fires
 * before tide's `TugPromptEntry` exists and registers via
 * `useComponentPersistence`. The seeded `bag.components.entry-chrome`
 * payload is dropped as an orphan. This is a gap in the [A9c]
 * orchestrator's lazy-mount handling, not in 25G's wiring; closing
 * it requires either re-firing component-restore on registry
 * changes or surfacing a per-component restore primitive that runs
 * at hook-register time. Tracked as follow-up scope outside [AT0031].
 * `gallery-prompt-entry` exercises every code path in 25G.
 *
 * Each test seeds full engine content + `toolsOpen=true` via
 * `bag.components.entry-chrome`, drives the trigger, and asserts:
 *
 *   1. Tools popover is open after restore (the new axis 25G adds).
 *   2. Engine text + atoms + selection + scrollTop survived (m24
 *      regression gate — proves chrome persistence didn't break
 *      content persistence).
 *   3. Active route is the seeded route.
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

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

const TEST_TIMEOUT_MS = 90_000;

const PERSIST_KEY = "entry-chrome";
const TUG_PROMPT_ENTRY_DEFAULT_ROUTE = "❯";
const SECONDARY_ROUTE = "$";

const PROMPT_INPUT_SELECTOR = '[data-tug-prompt-input-root] [contenteditable]';
const TOOLS_TOGGLE_SELECTOR =
  '[data-card-id="A"] .tug-prompt-entry-tools-toggle';
const TUG_ATOM_CHAR = "￼";

// ---------------------------------------------------------------------------
// Seed content matches m24's shape so a content regression here would
// surface alongside the chrome assertions. 50 lines × 24px = 1200px,
// enough to overflow the entry's content box at any panel size.
// ---------------------------------------------------------------------------

const TEXT_BEFORE_ATOM = "line  1: x";
const ACTIVE_LINES_AFTER_ATOM: ReadonlyArray<string> = [
  "yz alpha",
  "line  2: beta gamma delta",
  "line  3: epsilon zeta eta theta",
  "line  4: iota kappa lambda mu",
  "line  5: nu xi omicron pi",
  "line  6: rho sigma tau upsilon",
  "line  7: phi chi psi omega",
  "line  8: aaa bbb ccc ddd eee",
  "line  9: 1234 5678 9012 3456",
  "line 10: red orange yellow",
  "line 11: green blue indigo",
  "line 12: violet pink brown",
  "line 13: forest sky ocean",
  "line 14: mountain valley canyon",
  "line 15: desert tundra grassland",
  "line 16: rainforest mangrove savanna",
];
const FILLER_LINES: ReadonlyArray<string> = Array.from(
  { length: 50 - ACTIVE_LINES_AFTER_ATOM.length },
  (_, i) => `line ${(17 + i).toString().padStart(2)}: filler text padding for scroll overflow`,
);
const TEXT_AFTER_ATOM = [...ACTIVE_LINES_AFTER_ATOM, ...FILLER_LINES].join("\n");
const SEED_TEXT = TEXT_BEFORE_ATOM + TUG_ATOM_CHAR + TEXT_AFTER_ATOM;

const SEED_ATOM = {
  position: TEXT_BEFORE_ATOM.length,
  type: "file",
  label: "filename.ts",
  value: "/path/to/filename.ts",
};

const SEED_SELECTION = { start: 50, end: 100 };
const SEED_SCROLL_TOP = 80;

interface EngineState {
  text: string;
  atoms: ReadonlyArray<{
    position: number;
    type: string;
    label: string;
    value: string;
  }>;
  selection: { start: number; end: number } | null;
  scrollTop?: number;
}

const ACTIVE_ENGINE_STATE: EngineState = {
  text: SEED_TEXT,
  atoms: [SEED_ATOM],
  selection: SEED_SELECTION,
  scrollTop: SEED_SCROLL_TOP,
};

const SECONDARY_ENGINE_STATE: EngineState = {
  text: "shell command draft\nsecond line",
  atoms: [],
  selection: { start: 4, end: 11 },
};

type WrapperComponentId = "gallery-prompt-entry";

function makeContentBag(): Record<string, unknown> {
  return {
    currentRoute: TUG_PROMPT_ENTRY_DEFAULT_ROUTE,
    perRoute: {
      [TUG_PROMPT_ENTRY_DEFAULT_ROUTE]: ACTIVE_ENGINE_STATE,
      [SECONDARY_ROUTE]: SECONDARY_ENGINE_STATE,
    },
    maximized: false,
  };
}

function makeCardBag(toolsOpen: boolean): Record<string, unknown> {
  return {
    content: makeContentBag(),
    components: {
      [PERSIST_KEY]: { toolsOpen },
    },
  };
}

function deckShape(componentId: WrapperComponentId) {
  return {
    cards: [
      { id: "A", componentId, title: "Prompt", closable: true },
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

async function seedAndMount(app: App, componentId: WrapperComponentId, toolsOpen: boolean): Promise<void> {
  await app.enableDeckTrace(true);
  await app.seedDeckState({
    state: deckShape(componentId),
    cardStates: { A: makeCardBag(toolsOpen) },
    focusCardId: "A",
  });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.awaitEngineReady("A");
  // Wait for the engine to apply the seeded text — same gate m24 uses.
  await app.waitForCondition<boolean>(
    `(function(){
      var s = window.__tug.getEmCardState("A");
      return s !== null && s.text === ${JSON.stringify(SEED_TEXT)};
    })()`,
    { timeoutMs: 4000 },
  );
}

async function readToolsToggleState(app: App): Promise<string | null> {
  return await app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(TOOLS_TOGGLE_SELECTOR)});
      return el ? el.getAttribute("data-state") : null;
    })()`,
  );
}

async function assertLiveContent(app: App): Promise<void> {
  // Engine text matches seed.
  const liveText = await app.evalJS<string>(
    `window.__tug.getEmCardState("A").text`,
  );
  expect(liveText, "axis text: live engine text must match seed").toBe(SEED_TEXT);

  // Engine selection matches seed.
  const live = await app.getEmCardState("A");
  expect(live, "expected live EM card state").not.toBeNull();
  expect(
    live!.engineSelection,
    "axis selection: live engine selection must match seeded range",
  ).toEqual(SEED_SELECTION);

  // Atoms — exactly one image rendered.
  const atomLabels = await app.evalJS<string[]>(
    `(function(){
      var ed = document.querySelector('[data-card-id="A"] ${PROMPT_INPUT_SELECTOR}');
      if (!ed) return [];
      var imgs = ed.querySelectorAll('img[data-atom-label]');
      var labels = [];
      for (var i = 0; i < imgs.length; i++) {
        labels.push(imgs[i].getAttribute('data-atom-label'));
      }
      return labels;
    })()`,
  );
  expect(atomLabels.length, "axis atoms: one persisted atom must render").toBe(1);
  expect(atomLabels[0]).toBe(SEED_ATOM.label);

  // ScrollTop within tolerance.
  const liveScroll = await app.evalJS<number>(
    `(function(){
      var ed = document.querySelector('[data-card-id="A"] ${PROMPT_INPUT_SELECTOR}');
      return ed ? ed.scrollTop : -1;
    })()`,
  );
  expect(
    Math.abs(liveScroll - SEED_SCROLL_TOP),
    `axis scrollTop: live editor scrollTop must be within 8px of seeded ${SEED_SCROLL_TOP} (got ${liveScroll})`,
  ).toBeLessThanOrEqual(8);
}

async function assertToolsOpen(app: App): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(TOOLS_TOGGLE_SELECTOR)});
      return el !== null && el.getAttribute("data-state") === "open";
    })()`,
    { timeoutMs: 4000 },
  );
  expect(
    await readToolsToggleState(app),
    "axis toolsOpen: tools popover must be open after restore",
  ).toBe("open");
}

interface DiskBag {
  components?: Record<string, { toolsOpen?: boolean }>;
}

function readDiskToolsOpen(tugbankPath: string): boolean | undefined {
  const onDisk = tugbankRead<DiskBag>(
    tugbankPath,
    "dev.tugtool.deck.cardstate",
    "A",
  );
  if (!onDisk) return undefined;
  const bag = onDisk.value as DiskBag | undefined;
  return bag?.components?.[PERSIST_KEY]?.toolsOpen;
}

async function reseedFromDisk(app: App, componentId: WrapperComponentId, tugbankPath: string): Promise<void> {
  const onDisk = tugbankRead<unknown>(
    tugbankPath,
    "dev.tugtool.deck.cardstate",
    "A",
  );
  expect(onDisk).not.toBeNull();
  await app.enableDeckTrace(true);
  await app.seedDeckState({
    state: deckShape(componentId),
    cardStates: { A: onDisk!.value as Record<string, unknown> },
    focusCardId: "A",
  });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.awaitEngineReady("A");
}

// ---------------------------------------------------------------------------
// Trigger drivers — full round-trip including disk introspection
// ---------------------------------------------------------------------------

async function runAppReloadScenario(componentId: WrapperComponentId): Promise<void> {
  const tugbankPath = mkTempTugbank();
  try {
    seedTugbankForLaunch(tugbankPath);
    const app = await launchTugApp({
      testName: `m31-${componentId}-app-reload`,
      env: { TUGBANK_PATH: tugbankPath },
      persistInTestMode: true,
    });
    try {
      await seedAndMount(app, componentId, /*toolsOpen=*/ true);
      await app.appReload();

      // Disk gate — bag.components.entry-chrome.toolsOpen=true on disk.
      expect(
        readDiskToolsOpen(tugbankPath),
        "axis bag.components: appReload must write toolsOpen=true to disk",
      ).toBe(true);

      await reseedFromDisk(app, componentId, tugbankPath);

      // Live gate — popover open + engine content survived.
      await assertToolsOpen(app);
      await assertLiveContent(app);
    } finally {
      await app.close();
    }
  } finally {
    rmTempTugbank(tugbankPath);
  }
}

async function runRelaunchScenario(componentId: WrapperComponentId): Promise<void> {
  const tugbankPath = mkTempTugbank();
  try {
    seedTugbankForLaunch(tugbankPath);
    const app1 = await launchTugApp({
      testName: `m31-${componentId}-relaunch-phase-a`,
      env: { TUGBANK_PATH: tugbankPath },
      persistInTestMode: true,
    });
    try {
      await seedAndMount(app1, componentId, /*toolsOpen=*/ true);
      await app1.quitGracefully();
    } finally {
      await app1.close();
    }
    expect(
      readDiskToolsOpen(tugbankPath),
      "axis bag.components: relaunch must persist toolsOpen=true across processes",
    ).toBe(true);

    const app2 = await launchTugApp({
      testName: `m31-${componentId}-relaunch-phase-b`,
      env: { TUGBANK_PATH: tugbankPath },
      persistInTestMode: true,
    });
    try {
      await reseedFromDisk(app2, componentId, tugbankPath);
      await assertToolsOpen(app2);
      await assertLiveContent(app2);
    } finally {
      await app2.close();
    }
  } finally {
    rmTempTugbank(tugbankPath);
  }
}

async function runCmdTabScenario(componentId: WrapperComponentId): Promise<void> {
  const app = await launchTugApp({ testName: `m31-${componentId}-cmd-tab` });
  try {
    await seedAndMount(app, componentId, /*toolsOpen=*/ true);
    // Cold-mount restore should already have toolsOpen=true.
    await assertToolsOpen(app);

    await app.simulateAppResign();
    await app.simulateAppBecomeActive();

    // After cmd-tab cycle, popover stays open.
    await assertToolsOpen(app);
    await assertLiveContent(app);
  } finally {
    await app.close();
  }
}

describe.skipIf(!SHOULD_RUN)("m31: TugPromptEntry chrome state survives transitions", () => {
  test(
    "gallery-prompt-entry × appReload",
    () => runAppReloadScenario("gallery-prompt-entry"),
    TEST_TIMEOUT_MS,
  );
  test(
    "gallery-prompt-entry × relaunch",
    () => runRelaunchScenario("gallery-prompt-entry"),
    TEST_TIMEOUT_MS,
  );
  test(
    "gallery-prompt-entry × cmd-tab",
    () => runCmdTabScenario("gallery-prompt-entry"),
    TEST_TIMEOUT_MS,
  );
});
