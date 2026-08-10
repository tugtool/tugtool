/**
 * at0392-sheet-over-tall-entry.test.ts — a bottom-anchored sheet outgrows its
 * anchor downward, never upward into the title bar.
 *
 * The Z4B picker sheets (the AI mixer is the tall one) bottom-anchor above the
 * Session card's view slot so they rise near the chips that open them. That
 * anchor is a resting preference. When the prompt entry is grown tall the view
 * slot is left a sliver, and pinning the sheet's bottom to it squeezed the
 * whole panel into that sliver: the title bar cut its header off and the only
 * way to reach the top of the model list was to scroll a surface that is
 * supposed to be one glance.
 *
 * So the geometry pinned here, with the entry grown until the view slot cannot
 * hold the mixer:
 *
 *  1. **The title bar is a floor.** The panel's top stays at or below the pane
 *     chrome's bottom edge — it is never clipped by it.
 *  2. **It grows over the composer instead.** The panel's bottom passes the
 *     view slot's bottom edge, painting over the prompt entry, and still
 *     clears the card's own bottom edge.
 *  3. **And therefore it does not scroll.** The panel shows its full content —
 *     header included — rather than a scrolled window onto it.
 *
 * The short-entry case is checked first in the same launch, so the fix is
 * shown to be conditional: with room above the anchor the panel still rests on
 * it and paints nothing over the composer.
 *
 * Capabilities are injected through `ingestSessionMetadata` (the same seam
 * at0372 uses); no live claude handshake is needed.
 *
 * @covers tugdeck/src/components/tugways/tug-sheet.tsx
 * @covers tugdeck/src/components/tugways/tug-sheet.css
 * @covers tugdeck/src/components/tugways/cards/picker-sheet-anchor.ts
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const CHIP = `${CARD} [data-slot="ai-chip"]`;
const CHIP_VALUE = `${CHIP} [data-slot="ai-chip-value"]`;
const EDITOR = `${CARD} .tug-prompt-entry .tug-text-editor .cm-content`;
const SHEET = '[data-slot="ai-config-sheet"]';
const PANEL = ".tug-sheet-content";
const CANCEL = `${SHEET} [data-slot="ai-config-cancel"]`;

const SHEET_OPEN = `document.querySelector(${JSON.stringify(SHEET)}) !== null`;
const SHEET_CLOSED = `document.querySelector(${JSON.stringify(SHEET)}) === null`;

/** The full catalog — five models with descriptions, the tall mixer. */
const ALL_MODELS = [
  {
    value: "default",
    displayName: "Default (recommended)",
    description: "Opus 5 · 1M · Best for everyday, complex tasks",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "opus[1m]",
    displayName: "Opus (1M context)",
    description: "Opus 5 · 1M · Best for everyday, complex tasks",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "fable",
    displayName: "Fable",
    description: "Fable 5 · Most capable for your hardest tasks",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "sonnet",
    displayName: "Sonnet",
    description: "Sonnet 5 · Efficient for routine tasks",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "max"],
  },
  {
    value: "haiku",
    displayName: "Haiku 4.5",
    description: "Haiku 4.5 · Fastest for quick answers",
  },
];

function capabilities(models: unknown[]) {
  return {
    type: "session_capabilities",
    models,
    commands: [],
    agents: [],
    available_output_styles: [],
    output_style: "default",
    account: null,
    effort: null,
    ipc_version: 2,
  };
}

/** One tall, narrow pane — the shape the squeeze shows up in. */
function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 20 },
        size: { width: 760, height: 1180 },
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

interface Geometry {
  /** Panel box, viewport coordinates. */
  panelTop: number;
  panelBottom: number;
  /** The pane chrome's bottom edge — the floor the panel must stay below. */
  chromeBottom: number;
  /** The anchor's bottom edge, and the card frame's. */
  slotBottom: number;
  frameBottom: number;
  /** The window, for a pane that runs past the bottom of it. */
  viewportHeight: number;
  /** Whether the panel is showing all of itself. */
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Read every edge the assertions compare, in one round trip.
 *
 * The panel's own rect is off-limits here: the `rise` presentation carries an
 * enter transform, and a background app-test window runs no rAF, so a live
 * rect can report the panel mid-flight. The LAID-OUT box is what this file is
 * about, so it is derived from the clip (never transformed) and the panel's
 * untransformed `offsetHeight` — the panel is bottom-aligned in the clip, one
 * bottom margin up from its edge.
 */
async function geometry(app: App): Promise<Geometry | null> {
  return await app.evalJS<Geometry | null>(
    `(function(){
      var sheet = document.querySelector(${JSON.stringify(SHEET)});
      if (sheet === null) return null;
      var panel = sheet.closest(${JSON.stringify(PANEL)});
      var card = document.querySelector(${JSON.stringify(CARD)});
      if (panel === null || card === null) return null;
      var clip = panel.closest(".tug-sheet-clip");
      var frame = card.closest(".tug-pane");
      var chrome =
        frame === null ? null : frame.querySelector('[data-slot="tug-pane-title-bar"]');
      var slot = card.querySelector(".session-view-slot");
      if (clip === null || frame === null || chrome === null || slot === null) return null;
      var marginBottom =
        parseFloat(getComputedStyle(panel).marginBottom) || 0;
      var bottom = clip.getBoundingClientRect().bottom - marginBottom;
      return {
        panelTop: bottom - panel.offsetHeight,
        panelBottom: bottom,
        chromeBottom: chrome.getBoundingClientRect().bottom,
        slotBottom: slot.getBoundingClientRect().bottom,
        frameBottom: frame.getBoundingClientRect().bottom,
        viewportHeight: window.innerHeight,
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
      };
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "AT0392: a bottom-anchored sheet grows over the composer, not under the title bar",
  () => {
    test(
      "the mixer rests on the view slot when it fits, and slides down over a tall prompt entry when it does not",
      async () => {
        const app = await launchTugApp({ testName: "at0392-sheet-over-tall-entry" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindSession("A");
          await app.awaitEngineReady("A");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CHIP_VALUE)}) !== null`,
            { timeoutMs: 8000 },
          );
          // A two-model catalog first: a mixer short enough that the band
          // above the anchor holds it even in this card.
          await app.ingestSessionMetadata("A", capabilities(ALL_MODELS.slice(0, 2)));
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(CHIP_VALUE)});
              return el !== null && el.textContent.trim().length > 0;
            })()`,
            { timeoutMs: 6000 },
          );

          // ---- 1. A mixer that fits rests on its anchor ------------------
          await app.click(CHIP);
          await app.waitForCondition<boolean>(SHEET_OPEN, { timeoutMs: 4000 });
          const resting = await geometry(app);
          note("resting", resting);
          expect(resting, "the sheet must be measurable").not.toBeNull();
          if (resting === null) return;
          expect(
            resting.panelBottom,
            "with room above it, the panel rests on the view slot and covers no composer",
          ).toBeLessThanOrEqual(resting.slotBottom + 1);
          await app.click(CANCEL);
          await app.waitForCondition<boolean>(SHEET_CLOSED, { timeoutMs: 4000 });

          // ---- 2. The full catalog, and a composer grown tall ------------
          //
          // Either alone would still fit; together the band above the anchor
          // cannot hold the mixer.
          await app.ingestSessionMetadata("A", capabilities(ALL_MODELS));
          //
          // One long line, typed for real: the editor wraps it into enough
          // visual lines that the entry region takes nearly the whole card.
          await app.click(EDITOR);
          for (let round = 0; round < 2; round += 1) {
            await app.nativeType(
              "grow the composer until the view slot is a sliver ".repeat(30),
            );
          }
          note(
            "after typing",
            await app.evalJS<unknown>(
              `(function(){
                var card = document.querySelector(${JSON.stringify(CARD)});
                var slot = card === null ? null : card.querySelector(".session-view-slot");
                var ed = document.querySelector(${JSON.stringify(EDITOR)});
                return {
                  slotHeight: slot === null ? null : slot.getBoundingClientRect().height,
                  editorHeight: ed === null ? null : ed.getBoundingClientRect().height,
                  chars: ed === null ? null : ed.textContent.length,
                };
              })()`,
            ),
          );
          // The entry has taken height from the view slot: the slot is now
          // smaller than the panel measured at rest above, so the band above
          // the anchor cannot hold the mixer — the squeeze this file is about.
          await app.waitForCondition<boolean>(
            `(function(){
              var card = document.querySelector(${JSON.stringify(CARD)});
              var slot = card === null ? null : card.querySelector(".session-view-slot");
              if (slot === null) return false;
              return slot.getBoundingClientRect().height < ${resting.clientHeight};
            })()`,
            { timeoutMs: 8000 },
          );

          // ---- 3. The squeeze case --------------------------------------
          await app.click(CHIP);
          await app.waitForCondition<boolean>(SHEET_OPEN, { timeoutMs: 4000 });
          const squeezed = await geometry(app);
          expect(squeezed, "the sheet must be measurable").not.toBeNull();
          if (squeezed === null) return;

          expect(
            squeezed.panelTop,
            "the title bar is a floor — the panel is never cut off by it",
          ).toBeGreaterThanOrEqual(squeezed.chromeBottom - 1);
          expect(
            squeezed.panelBottom,
            "it takes the height it needs from the composer below the anchor",
          ).toBeGreaterThan(squeezed.slotBottom + 1);
          expect(
            squeezed.panelBottom,
            "and still clears the card's bottom edge (and the window's)",
          ).toBeLessThanOrEqual(
            Math.min(squeezed.frameBottom, squeezed.viewportHeight) - 1,
          );
          expect(
            squeezed.scrollHeight - squeezed.clientHeight,
            "having grown, the panel shows all of itself — no scrolled header",
          ).toBeLessThanOrEqual(1);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
