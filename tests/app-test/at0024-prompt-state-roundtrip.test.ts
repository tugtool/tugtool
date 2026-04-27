/**
 * at0024-prompt-state-roundtrip.test.ts — comprehensive prompt-state
 * round-trip matrix across reload + relaunch ([AT0024]).
 *
 * ## Why this exists
 *
 * The user-reported regression: a Tide card with multi-line text,
 * a non-collapsed selection, and an editor scroll position loses
 * those axes on `Developer > Reload` AND on quit + relaunch. The
 * gallery cards `gallery-prompt-input` and `gallery-prompt-entry`
 * exhibit the same shape because they ride the same persistence
 * pipeline as Tide.
 *
 * Two fault classes exist today:
 *
 *   1. **Outright omission ([L23]).** `TugTextEditingState`
 *      (the engine's persisted shape) carries `text`, `atoms`,
 *      `selection`. It does not carry `scrollTop`. The current
 *      persistence interface cannot express the user's scroll
 *      position at all — every reload destroys it without an
 *      attempt at recovery.
 *
 *   2. **Engine-creation race in the entry's restore path.**
 *      `TugPromptEntry.onRestore` calls
 *      `promptInputRef.current?.restoreState(saved)`. The
 *      imperative handle is bound at child mount, but the
 *      underlying `TugTextEngine` is only created inside the
 *      input's own `useLayoutEffect` — and the `pendingRestoreRef`
 *      buffer that catches engine-not-ready is gated on the input
 *      OWNING persistence, which the entry disables via
 *      `preserveState={false}`. The result: cold-boot restores
 *      that fire while the engine is still being constructed
 *      silently no-op.
 *
 * ## Test matrix
 *
 *   3 cards × 2 reload triggers = 6 test cases. Each case asserts
 *   four axes: text, atoms, selection, scrollTop. Cards are
 *   `gallery-prompt-input` (raw `TugTextEditingState` bag),
 *   `gallery-prompt-entry` (`{ currentRoute, perRoute, maximized }`
 *   wrapper), and `tide` (production card; same wrapper as the
 *   entry, mounted after a fake-session bind via
 *   {@link App.bindTideSession}).
 *
 *   Triggers are `app.appReload()` (Layer 1 primitive — same
 *   Tug.app + tugcast process, fresh WKWebView) and
 *   `app.quitGracefully()` + relaunch (existing primitive — fresh
 *   Tug.app process, same temp tugbank file).
 *
 * ## Phase A → Phase B contract
 *
 *   **Phase A** seeds `bag.content` with a pre-cooked engine state
 *   (text + atoms + selection), waits for the engine to apply the
 *   restore, programmatically sets the editor's `scrollTop` (the
 *   axis the bag shape can't express today), then triggers the
 *   reload. The save chain runs synchronously through
 *   `prepareForReload` / `applicationShouldTerminate`, so by the
 *   time the trigger resolves the bag is on tugbank disk.
 *
 *   **Phase A disk assertion** reads the on-disk bag via
 *   `tugbankRead` and asserts each axis. Today: text + atoms +
 *   selection round-trip through capture-then-save (the engine
 *   captured what we seeded back, then save flushed it). The
 *   `scrollTop` axis fails universally because the bag has no
 *   slot for it — that's the load-bearing fault Layer 3 fixes.
 *
 *   **Phase B** test-mode boot ignores tugbank reads (per
 *   {@link DeckManager} test-mode contract; harness re-seeds via
 *   `seedDeckState`), so we re-feed the on-disk bag back into
 *   `seedDeckState` and wait for the engine to apply it. Live
 *   assertions then read the engine state directly — text via
 *   the contenteditable, selection via `__tug.getEmCardState`,
 *   scroll via `editor.scrollTop`.
 *
 *   Phase B is unreachable today on every test because Phase A's
 *   `scrollTop` assertion bails first. After Layer 3 lands, Phase
 *   A passes and Phase B runs to its own four-axis check — at
 *   which point the entry-restore race ([Layer 4]) may or may not
 *   show up as a `selection` regression on the wrapper-shape
 *   cards. The test is structured so a Layer 4 regression would
 *   surface there, not in Phase A.
 *
 * ## Status: FAILING by design (Layer 2 commit)
 *
 * Layer 2 ships exactly when this file ships and exactly when
 * every test is FAILING in the expected way: running to the
 * assertion phase, exercising every Phase A axis assertion in
 * order, and failing on `scrollTop` (the missing axis) after
 * `text` / `atoms` / `selection` have already passed on disk.
 * That's the load-bearing gating shape — text + atoms + selection
 * tap pass on disk for all three cards (60 of 66 expects pass);
 * the six `scrollTop` assertions are the universal failure.
 *
 * If a test errors out BEFORE reaching the four-axis assertion
 * phase, that's a harness bug to fix in Layer 2 itself, not a
 * green light to advance.
 *
 * Layer 3 extends `TugTextEditingState` to carry `scrollTop`;
 * Layer 4 (conditional, gated by Phase B's post-Layer-3 results)
 * closes any remaining engine-creation race in the entry's
 * restore path. After both, every test in this file passes.
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

// ---------------------------------------------------------------------------
// Card targets
// ---------------------------------------------------------------------------

type PromptComponentId =
  | "gallery-prompt-input"
  | "gallery-prompt-entry"
  | "tide";

const PROMPT_INPUT_SELECTOR =
  '[data-tug-prompt-input-root] [contenteditable]';

/** TUG_ATOM_CHAR — the U+FFFC placeholder atom character (engine internal). */
const TUG_ATOM_CHAR = "￼";

/** Default route for `TugPromptEntry`. */
const TUG_PROMPT_ENTRY_DEFAULT_ROUTE = "❯";

/**
 * Inactive route seeded alongside the active route for `entry` and
 * `tide`. Its presence in `bag.content.perRoute` rides the same
 * persistence pipe; we assert on disk that it survives the round-trip.
 */
const SECONDARY_ROUTE = "$";

// ---------------------------------------------------------------------------
// Seed payload
// ---------------------------------------------------------------------------

/**
 * 50 short lines of text — enough to overflow the editor's content
 * box on every target card. `gallery-prompt-input`'s standalone
 * editor caps at `maxRows=8` (~206px); the wrapper cards
 * (`gallery-prompt-entry`, `tide`) ride content-driven panel growth
 * to a 90% pane max (~486px on a 540px card) but cap there. 50 lines
 * × 24px = 1200px, which overflows both ceilings comfortably, so
 * `editor.scrollTop = 80` always sticks regardless of which sizing
 * regime is in effect.
 *
 * The single atom (one TUG_ATOM_CHAR char) sits inside line 1 at
 * offset 10. Selection spans offsets 50..100 — a non-collapsed range
 * straddling the atom.
 */
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
// Pad with monotonically-numbered filler lines up to 50 total so the
// editor overflows even after content-driven panel growth peggs the
// entry pane at its 90% max.
const FILLER_LINES: ReadonlyArray<string> = Array.from(
  { length: 50 - ACTIVE_LINES_AFTER_ATOM.length },
  (_, i) => `line ${(17 + i).toString().padStart(2)}: filler text padding for scroll overflow`,
);
const TEXT_AFTER_ATOM = [...ACTIVE_LINES_AFTER_ATOM, ...FILLER_LINES].join("\n");
const SEED_TEXT = TEXT_BEFORE_ATOM + TUG_ATOM_CHAR + TEXT_AFTER_ATOM;

const SEED_ATOM = {
  position: TEXT_BEFORE_ATOM.length, // = 10
  type: "file",
  label: "filename.ts",
  value: "/path/to/filename.ts",
};

const SEED_SELECTION = { start: 50, end: 100 };

const SEED_SCROLL_TOP = 80;

const SECONDARY_ROUTE_TEXT = "shell command draft\nsecond line";
const SECONDARY_ROUTE_SELECTION = { start: 4, end: 11 };

interface EngineState {
  text: string;
  atoms: ReadonlyArray<{
    position: number;
    type: string;
    label: string;
    value: string;
  }>;
  selection: { start: number; end: number } | null;
}

const ACTIVE_ENGINE_STATE: EngineState = {
  text: SEED_TEXT,
  atoms: [SEED_ATOM],
  selection: SEED_SELECTION,
};

const SECONDARY_ENGINE_STATE: EngineState = {
  text: SECONDARY_ROUTE_TEXT,
  atoms: [],
  selection: SECONDARY_ROUTE_SELECTION,
};

// ---------------------------------------------------------------------------
// Bag construction
// ---------------------------------------------------------------------------

/**
 * Build the `bag.content` payload for a given card. `gallery-prompt-input`
 * uses the raw `TugTextEditingState` shape; `gallery-prompt-entry` and
 * `tide` use the wrapper shape `{ currentRoute, perRoute, maximized }`.
 *
 * The wrapper-shape cards also seed a secondary `$` route entry so the
 * full per-route map is exercised, not just the active slot.
 */
function makeContentBag(componentId: PromptComponentId): Record<string, unknown> {
  if (componentId === "gallery-prompt-input") {
    return ACTIVE_ENGINE_STATE as unknown as Record<string, unknown>;
  }
  return {
    currentRoute: TUG_PROMPT_ENTRY_DEFAULT_ROUTE,
    perRoute: {
      [TUG_PROMPT_ENTRY_DEFAULT_ROUTE]: ACTIVE_ENGINE_STATE,
      [SECONDARY_ROUTE]: SECONDARY_ENGINE_STATE,
    },
    maximized: false,
  };
}

function deckShape(componentId: PromptComponentId) {
  return {
    cards: [
      { id: "A", componentId, title: "Prompt A", closable: true },
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

// ---------------------------------------------------------------------------
// Phase A: seed → drive scroll → trigger reload
// ---------------------------------------------------------------------------

/**
 * Phase A workhorse. Seeds the deck with a pre-cooked `bag.content`,
 * waits for the engine to apply the restore, sets the editor scrollTop
 * programmatically (the axis the bag can't express today), and returns
 * once everything has settled. The caller drives the reload trigger.
 *
 * The bag is pre-seeded rather than driven through `nativeType` so the
 * test exercises the persistence pipeline (capture → save → load →
 * restore) deterministically. The save fires when the caller's reload
 * trigger runs.
 */
async function setupPhaseA(
  app: App,
  componentId: PromptComponentId,
): Promise<void> {
  await app.enableDeckTrace(true);

  const bag = { content: makeContentBag(componentId) };

  await app.seedDeckState({
    state: deckShape(componentId),
    cardStates: { A: bag },
    focusCardId: "A",
  });

  if (componentId === "tide") {
    // Tide-card mounts its picker by default. Bind a fake session
    // so `TideCardBody` (which embeds `TugPromptEntry`) renders.
    await app.bindTideSession("A");
  }

  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );

  await app.awaitEngineReady("A");

  // Wait for the engine's restore to commit the seeded text.
  // `getEmCardState` invokes the save callback synchronously and
  // returns the persisted shape — for the wrapper cards it
  // unwraps `perRoute[currentRoute]`.
  await app.waitForCondition<boolean>(
    `(function(){
      var s = window.__tug.getEmCardState("A");
      return s !== null && s.text === ${JSON.stringify(SEED_TEXT)};
    })()`,
    { timeoutMs: 4000 },
  );

  // Drive the editor's scrollTop. Today no axis carries this — it's
  // appearance state from the engine's perspective and the bag has
  // no slot for it. Layer 3 extends `TugTextEditingState` with a
  // `scrollTop` field; until then this assignment lives only on the
  // DOM and is destroyed by every reload.
  await app.evalJS<void>(
    `(function(){
      var el = document.querySelector('[data-card-id="A"] ${PROMPT_INPUT_SELECTOR}');
      if (!el) throw new Error("[m24] phaseA: editor not found for cardId=A");
      el.scrollTop = ${SEED_SCROLL_TOP};
    })()`,
  );

  await app.waitForCondition<boolean>(
    `(function(){
      var el = document.querySelector('[data-card-id="A"] ${PROMPT_INPUT_SELECTOR}');
      return el !== null && Math.abs(el.scrollTop - ${SEED_SCROLL_TOP}) < 2;
    })()`,
    { timeoutMs: 2000 },
  );
}

// ---------------------------------------------------------------------------
// Disk-side bag introspection (Phase A assertion)
// ---------------------------------------------------------------------------

interface RawBag {
  content?: unknown;
}

/**
 * Reach into the raw `bag.content` and return the engine state that
 * `bag.content` claims for the active route. Mirrors the unwrap
 * `__tug.getEmCardState` does, but operates on the on-disk JSON shape
 * so the test can name each axis explicitly in its `expect()` calls.
 */
function readActiveEngineState(
  bag: RawBag,
  componentId: PromptComponentId,
): Record<string, unknown> | null {
  const content = bag.content;
  if (typeof content !== "object" || content === null) return null;
  if (componentId === "gallery-prompt-input") {
    return content as Record<string, unknown>;
  }
  const wrapper = content as Record<string, unknown>;
  const currentRoute = wrapper.currentRoute;
  const perRoute = wrapper.perRoute;
  if (
    typeof currentRoute !== "string" ||
    typeof perRoute !== "object" ||
    perRoute === null
  ) {
    return null;
  }
  const inner = (perRoute as Record<string, unknown>)[currentRoute];
  if (typeof inner !== "object" || inner === null) return null;
  return inner as Record<string, unknown>;
}

/**
 * Assert all four state axes are present on the disk bag. Each axis is
 * called out by name so a failure says exactly which axis didn't
 * round-trip.
 */
function assertBagOnDisk(
  tugbankPath: string,
  componentId: PromptComponentId,
): void {
  const onDisk = tugbankRead<RawBag>(
    tugbankPath,
    "dev.tugtool.deck.cardstate",
    "A",
  );
  expect(
    onDisk,
    "expected bag for card A to exist on tugbank disk",
  ).not.toBeNull();
  expect(onDisk?.type).toBe("json");
  const bag = onDisk?.value;
  expect(bag, "expected on-disk bag value to be present").toBeDefined();

  const engineState = readActiveEngineState(bag as RawBag, componentId);
  expect(
    engineState,
    "expected on-disk bag.content to carry an engine state for the active route",
  ).not.toBeNull();

  // Axis 1: text.
  expect(
    engineState!.text,
    "axis text: on-disk bag.content text must match seeded value",
  ).toBe(SEED_TEXT);

  // Axis 2: atoms — exactly one entry, with the seeded label.
  expect(
    Array.isArray(engineState!.atoms),
    "axis atoms: bag.content.atoms must be an array",
  ).toBe(true);
  const atoms = engineState!.atoms as ReadonlyArray<Record<string, unknown>>;
  expect(
    atoms.length,
    "axis atoms: expected exactly one persisted atom",
  ).toBe(1);
  expect(
    atoms[0]?.label,
    "axis atoms: persisted atom label must match seed",
  ).toBe(SEED_ATOM.label);
  expect(atoms[0]?.position).toBe(SEED_ATOM.position);

  // Axis 3: selection — non-collapsed range mid-text.
  expect(
    engineState!.selection,
    "axis selection: bag.content.selection must round-trip the seeded range",
  ).toEqual(SEED_SELECTION);

  // Axis 4: scrollTop — FAILS today. `TugTextEditingState` has no
  // slot for `scrollTop`, so the engine's `captureState` never
  // writes it. Future engine work adds this field.
  expect(
    (engineState as Record<string, unknown>).scrollTop,
    "axis scrollTop: bag.content.scrollTop must carry the seeded editor offset",
  ).toBe(SEED_SCROLL_TOP);

  // Bonus: wrapper-shape cards persist their full per-route map.
  // Asserts the secondary route survived the capture-and-save round
  // trip — the route the user wasn't looking at when the reload
  // fired must come back too.
  if (componentId !== "gallery-prompt-input") {
    const wrapper = bag as Record<string, unknown> | undefined;
    const content = wrapper?.content as Record<string, unknown> | undefined;
    const perRoute = content?.perRoute as
      | Record<string, Record<string, unknown>>
      | undefined;
    const secondary = perRoute?.[SECONDARY_ROUTE];
    expect(
      secondary,
      "axis secondary-route: $ route must be preserved on disk",
    ).toBeDefined();
    expect(secondary?.text).toBe(SECONDARY_ROUTE_TEXT);
    expect(secondary?.selection).toEqual(SECONDARY_ROUTE_SELECTION);
  }
}

// ---------------------------------------------------------------------------
// Phase B: re-seed bag from disk + assert live state
// ---------------------------------------------------------------------------

/**
 * Re-seed the deck with the on-disk bag and wait for the engine to
 * apply it. Test mode skips boot-time tugbank reads, so this re-seed
 * is required even on the appReload path (same Tug.app process, but
 * the WKWebView reload tore down the in-memory `cardStateCache`).
 */
async function reseedFromDisk(
  app: App,
  componentId: PromptComponentId,
  tugbankPath: string,
): Promise<void> {
  const onDisk = tugbankRead<RawBag>(
    tugbankPath,
    "dev.tugtool.deck.cardstate",
    "A",
  );
  expect(onDisk).not.toBeNull();
  const cardStates: Record<string, RawBag> = {};
  cardStates.A = onDisk!.value as RawBag;

  await app.enableDeckTrace(true);

  await app.seedDeckState({
    state: deckShape(componentId),
    cardStates,
    focusCardId: "A",
  });

  if (componentId === "tide") {
    await app.bindTideSession("A");
  }

  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );

  await app.awaitEngineReady("A");
}

/**
 * Assert the live engine state matches what we seeded. Each axis is
 * its own `expect()` so a failure reports which axis regressed
 * specifically. Today every axis except text fails on at least one
 * of the three target cards.
 */
async function assertLiveState(app: App): Promise<void> {
  // Axis 1: live text equals seed.
  await app.waitForCondition<boolean>(
    `(function(){
      var s = window.__tug.getEmCardState("A");
      return s !== null && s.text === ${JSON.stringify(SEED_TEXT)};
    })()`,
    { timeoutMs: 4000 },
  );
  const liveText = await app.evalJS<string>(
    `window.__tug.getEmCardState("A").text`,
  );
  expect(liveText, "axis text: live engine text must match seed").toBe(
    SEED_TEXT,
  );

  // Axis 2: live atoms — engine reflects the persisted atom.
  // Reading via the contenteditable's `<img data-atom-label>` count is
  // robust against engine internals; the engine always renders one
  // image per atom.
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
  expect(
    atomLabels.length,
    "axis atoms: live editor must render one atom per persisted entry",
  ).toBe(1);
  expect(atomLabels[0]).toBe(SEED_ATOM.label);

  // Axis 3: selection — `__tug.getEmCardState`'s `engineSelection`
  // reads the engine's selection directly (not the DOM range), so
  // it's the canonical surface for the persisted selection axis.
  const live = await app.getEmCardState("A");
  expect(live, "expected live EM card state").not.toBeNull();
  expect(
    live!.engineSelection,
    "axis selection: live engine selection must match seeded range",
  ).toEqual(SEED_SELECTION);

  // Axis 4: scrollTop — FAILS today. The bag has no `scrollTop`
  // axis, so on restore the editor mounts at its bake-in default
  // (typically 0). These layers close this.
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

// ---------------------------------------------------------------------------
// Trigger drivers
// ---------------------------------------------------------------------------

/**
 * Run the full round-trip against the `appReload` trigger. Same Tug.app
 * process, fresh WKWebView. The temp tugbank persists the bag across
 * the reload because `prepareForReload` flushes synchronously.
 */
async function runAppReloadScenario(
  componentId: PromptComponentId,
): Promise<void> {
  const tugbankPath = mkTempTugbank();
  try {
    seedTugbankForLaunch(tugbankPath);

    const app = await launchTugApp({
      testName: `m24-${componentId}-app-reload`,
      env: { TUGBANK_PATH: tugbankPath },
      persistInTestMode: true,
    });

    try {
      await setupPhaseA(app, componentId);
      await app.appReload();
      assertBagOnDisk(tugbankPath, componentId);
      await reseedFromDisk(app, componentId, tugbankPath);
      await assertLiveState(app);
    } finally {
      await app.close();
    }
  } finally {
    rmTempTugbank(tugbankPath);
  }
}

/**
 * Run the full round-trip against the `quitGracefully` + relaunch
 * trigger. Two separate Tug.app processes, same temp tugbank.
 */
async function runRelaunchScenario(
  componentId: PromptComponentId,
): Promise<void> {
  const tugbankPath = mkTempTugbank();
  try {
    seedTugbankForLaunch(tugbankPath);

    // Phase A app: setup, drive, quit.
    {
      const appA = await launchTugApp({
        testName: `m24-${componentId}-relaunch-A`,
        env: { TUGBANK_PATH: tugbankPath },
        persistInTestMode: true,
      });
      try {
        await setupPhaseA(appA, componentId);
        await appA.quitGracefully();
      } finally {
        // quitGracefully tears down the App handle internally on
        // success; an explicit close() here is a safe no-op on
        // the closed path and a fallback on timeout.
      }
    }

    // Phase A disk assertion (between processes).
    assertBagOnDisk(tugbankPath, componentId);

    // Phase B app: re-seed from disk, assert live.
    {
      const appB = await launchTugApp({
        testName: `m24-${componentId}-relaunch-B`,
        env: { TUGBANK_PATH: tugbankPath },
        persistInTestMode: true,
      });
      try {
        await reseedFromDisk(appB, componentId, tugbankPath);
        await assertLiveState(appB);
      } finally {
        await appB.close();
      }
    }
  } finally {
    rmTempTugbank(tugbankPath);
  }
}

// ---------------------------------------------------------------------------
// Test cases — 3 cards × 2 triggers
// ---------------------------------------------------------------------------

describe.skipIf(!SHOULD_RUN)(
  "m24: prompt-state round-trip across reload + relaunch",
  () => {
    test(
      "gallery-prompt-input × appReload",
      () => runAppReloadScenario("gallery-prompt-input"),
      TEST_TIMEOUT_MS,
    );

    test(
      "gallery-prompt-input × relaunch",
      () => runRelaunchScenario("gallery-prompt-input"),
      TEST_TIMEOUT_MS,
    );

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
      "tide × appReload",
      () => runAppReloadScenario("tide"),
      TEST_TIMEOUT_MS,
    );

    test(
      "tide × relaunch",
      () => runRelaunchScenario("tide"),
      TEST_TIMEOUT_MS,
    );
  },
);
