/**
 * at0341-lens-cross-section-arrows.test.ts — the Lens's arrows point where they
 * say: Down goes down the column, Right goes along a band, and the ring crosses
 * section boundaries in both.
 *
 * The Lens is a stack of sections, each a band (the band, its filter field, its
 * own controls, its fold cue — a ROW, read left to right) over a body (a COLUMN
 * of rows). It used to declare no spatial order at all and ride the liveliness
 * net, which is a linear walk: Down and Right both meant "next stop", so Down on
 * a band stepped sideways into that band's filter field instead of dropping into
 * the rows underneath it. The Lens now declares a plane
 * (`lens-spatial-order.ts`), and this pins what the four arrows do on it, end to
 * end on the real Lens with real keystrokes, reading the ENGINE key view
 * (`data-key-view-kbd`).
 *
 * It also pins the empty-input release: an empty `TugFilterField` spends its
 * arrows on movement (a field is not a wall), while a field holding a query
 * keeps them for its caret.
 *
 * @covers tugdeck/src/components/tugways/focus-manager.ts
 * @covers tugdeck/src/components/tugways/responder-chain-provider.tsx
 * @covers tugdeck/src/components/tugways/arrow-release.ts
 * @covers tugdeck/src/components/tugways/tug-list-view.tsx
 * @covers tugdeck/src/components/tugways/tug-filter-field.tsx
 * @covers tugdeck/src/components/lens/lens-spatial-order.ts
 * @covers tugdeck/src/components/lens/
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const SNIPPETS_LIST = ".lens-content .lens-snippets-list";
const ROWS = 4;

function priorCardDeck() {
  return {
    cards: [
      { id: "A", componentId: "gallery-accordion", title: "Accordion", closable: true },
    ],
    panes: [
      {
        id: "pA",
        position: { x: 60, y: 60 },
        size: { width: 520, height: 420 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "pA",
    hasFocus: true,
  };
}

/**
 * Where the keyboard ring rests, as a short address a failure can be read
 * from: the Lens section that contains it, and which of that section's stops it
 * is — the band itself, its filter field, one of its own controls, its fold
 * cue, or its body. The fold cue is named apart from the section's other
 * controls because it is the band's last stop, and several assertions here are
 * about reaching exactly it.
 */
const RING_ADDRESS = `(function(){
  var el = document.querySelector('[data-key-view-kbd]');
  if (el === null) return null;
  var section = el.closest('.lens-section');
  var kind = section === null ? "?" : (section.getAttribute("data-lens-section") || "?");
  var part = el.closest('[data-slot="tug-filter-field"]') !== null
    ? "filter"
    : el.closest('[data-slot="block-fold-cue"]') !== null
      ? "fold"
      : el.closest(".tug-list-view") !== null
        ? "list"
        : el.matches(".tool-call-header")
          ? "band"
          : el.closest(".tool-call-header") !== null
            ? "action"
            : "other";
  return kind + ":" + part;
})()`;

async function ringAddress(app: App): Promise<string | null> {
  return app.evalJS<string | null>(RING_ADDRESS);
}

async function waitRing(app: App, address: string): Promise<void> {
  await app.waitForCondition<boolean>(
    `${RING_ADDRESS} === ${JSON.stringify(address)}`,
    { timeoutMs: 3_000 },
  );
}

/** Press `key`, then assert where the ring came to rest. */
async function step(app: App, key: string, address: string): Promise<void> {
  await app.nativeKey(key);
  await waitRing(app, address);
}

describe.skipIf(!SHOULD_RUN)("at0341 — Lens arrows point where they say", () => {
  test(
    "Down runs the column and crosses sections, Right runs the band, and an empty filter field passes arrows through",
    async () => {
      const tugbankPath = mkTempTugbank();
      const filesDir = mkdtempSync(join(tmpdir(), "tug-at0341-"));
      const snippetsPath = join(filesDir, "snippets.json");
      writeFileSync(
        snippetsPath,
        `${JSON.stringify(
          {
            version: 1,
            snippets: Array.from({ length: ROWS }, (_, i) => ({
              id: `s${i}`,
              text: `row-${i} snippet handle`,
            })),
          },
          null,
          2,
        )}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0341-lens-cross-section-arrows",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
        });
        try {
          await app.seedDeckState({ state: priorCardDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5_000 },
          );

          // ⌘L seeds the first expanded section with navigable content — Cards,
          // which holds the one open card.
          await app.dispatchControlAction("focus-lens");
          await waitRing(app, "cards:list");

          // The Cards list's cursor sits on its one pane row, which is also its
          // last, so Down runs off the list's edge. Before the liveliness net
          // this clamped and the ring never left the section; now it crosses to
          // the next section's BAND, which is where that section starts.
          await step(app, "ArrowDown", "snippets:band");

          // ---- The headline: Down on a band means DOWN. ----
          //
          // The band's controls are to its right, so Down passes them and lands
          // in the section's rows — the thing the band is a header for. Under
          // the linear net this landed on the filter field, one step to the
          // right, which is the complaint the declared plane answers.
          await step(app, "ArrowDown", "snippets:list");

          // Interior Downs belong to the list's cursor — the ring stays.
          await app.nativeKey("ArrowDown");
          await waitRing(app, "snippets:list");
          expect(
            await app.evalJS<string>(
              `(document.querySelector('${SNIPPETS_LIST} [data-key-cursor]')?.textContent || "")`,
            ),
          ).toContain("row-1");

          // ---- Left off a body returns to its own band. ----
          //
          // Declared as a seam rather than an override, so it fires only where
          // nothing else claims the arrow: a vertical-axis list declines
          // horizontal arrows, while a horizontal group (the Layouts tiles)
          // keeps them for its own cursor and never sees it.
          await step(app, "ArrowLeft", "snippets:band");

          // ---- Right runs the band, in the order it reads. ----
          await step(app, "ArrowRight", "snippets:filter");
          // The field is empty, so it spends the arrow on movement rather than
          // holding it for a caret with nothing to move.
          await step(app, "ArrowRight", "snippets:action");
          await step(app, "ArrowRight", "snippets:fold");
          // The band is a closed ring: off its last stop, Right wraps back to
          // the band itself rather than dead-ending or spilling into the rows.
          await step(app, "ArrowRight", "snippets:band");
          await step(app, "ArrowLeft", "snippets:fold");

          // Down from anywhere on the band reaches the same body — the whole
          // band is a header for one thing.
          await step(app, "ArrowDown", "snippets:list");

          // ---- Up retraces the column. ----
          //
          // Up is the list's while its cursor has somewhere to go, then crosses
          // to the band above it — the band, not the fold cue it was last on,
          // because a vertical arrow enters a row at its leading member.
          await app.nativeKey("ArrowUp");
          await waitRing(app, "snippets:list");
          await step(app, "ArrowUp", "snippets:band");
          // And on into the section above, at its BODY rather than its band:
          // the Cards list is the row directly over the Snippets band.
          await step(app, "ArrowUp", "cards:list");

          // A filter field with a query is a different animal: the caret owns
          // the arrows again. Land on the field and type.
          await step(app, "ArrowDown", "snippets:band");
          await step(app, "ArrowRight", "snippets:filter");
          await app.nativeType("row");
          await app.waitForCondition<boolean>(
            `document.querySelector('.lens-section[data-lens-section="snippets"] .tug-filter-field-input')?.value === "row"`,
            { timeoutMs: 3_000 },
          );

          // Up is the field's now — the ring does not leave.
          await app.nativeKey("ArrowUp");
          await new Promise<void>((r) => setTimeout(r, 250));
          expect(await ringAddress(app)).toBe("snippets:filter");

          // The whole tour is keyboard-only: every landing came through the
          // engine, with no raw focus write behind its back.
          const report = await app.evalJS<{
            violations: number;
            steals: Record<string, number>;
          } | null>(`window.__tug.getFocusInvariantReport()`);
          expect(report).not.toBeNull();
          expect(report!.violations).toBe(0);
          expect(Object.keys(report!.steals)).toEqual([]);
        } finally {
          await app.close();
        }
      } finally {
        rmSync(filesDir, { recursive: true, force: true });
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
