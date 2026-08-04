/**
 * at0341-lens-cross-section-arrows.test.ts — arrows carry the Lens ring across
 * section boundaries, and an empty filter field is transparent to them.
 *
 * The Lens is one column of sections, each a focus group running band → filter
 * → the section's own controls → fold chevron → list, and it declares no
 * spatial order — its linear walk order IS its visual column. Before the
 * universal liveliness net, an arrow off a list's last row clamped there: Down
 * from the bottom of Cards dead-ended instead of continuing into Snippets. This
 * pins the traversal end to end on the real Lens with real keystrokes, reading
 * the ENGINE key view (`data-key-view-kbd`).
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
 * is — the band itself, one of the band's controls (the fold chevron, a
 * section's own `+`), its filter field, or its list.
 */
const RING_ADDRESS = `(function(){
  var el = document.querySelector('[data-key-view-kbd]');
  if (el === null) return null;
  var section = el.closest('.lens-section');
  var kind = section === null ? "?" : (section.getAttribute("data-lens-section") || "?");
  var part = el.closest('[data-slot="tug-filter-field"]') !== null
    ? "filter"
    : el.closest(".tug-list-view") !== null
      ? "list"
      : el.matches(".tool-call-header")
        ? "band"
        : el.closest(".tool-call-header") !== null
          ? "band-control"
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

describe.skipIf(!SHOULD_RUN)("at0341 — Lens arrows cross section boundaries", () => {
  test(
    "Down off a list's last row continues into the next section, and an empty filter field passes arrows through",
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

          // The Cards list holds a single row, so its cursor is already at the
          // bottom: Down runs off the list's edge. Before the net this clamped
          // and the ring never left the section. Now it walks on to the next
          // stop in the Lens's column — the Snippets BAND, which is where that
          // section starts.
          await app.nativeKey("ArrowDown");
          await waitRing(app, "snippets:band");

          // Down along the band, in the order it reads: the filter field, then
          // the band's controls (the `+`, then the fold chevron).
          await app.nativeKey("ArrowDown");
          await waitRing(app, "snippets:filter");

          // The field is empty, so it spends the arrow on movement rather than
          // holding it for a caret that has nothing to move: Down passes
          // straight through to the controls beside it.
          await app.nativeKey("ArrowDown");
          await waitRing(app, "snippets:band-control");
          await app.nativeKey("ArrowDown");
          await waitRing(app, "snippets:band-control");

          // Off the band's last control and into the rows.
          await app.nativeKey("ArrowDown");
          await waitRing(app, "snippets:list");

          // Interior arrows still belong to the list's cursor — the ring stays.
          await app.nativeKey("ArrowDown");
          await waitRing(app, "snippets:list");
          expect(
            await app.evalJS<string>(
              `(document.querySelector('${SNIPPETS_LIST} [data-key-cursor]')?.textContent || "")`,
            ),
          ).toContain("row-1");

          // Up retraces exactly: back to the list's first row, then off its top
          // edge back along the band — controls, field, band — and into Cards.
          await app.nativeKey("ArrowUp");
          await waitRing(app, "snippets:list");
          await app.nativeKey("ArrowUp");
          await waitRing(app, "snippets:band-control");
          await app.nativeKey("ArrowUp");
          await waitRing(app, "snippets:band-control");
          await app.nativeKey("ArrowUp");
          await waitRing(app, "snippets:filter");
          await app.nativeKey("ArrowUp");
          await waitRing(app, "snippets:band");
          await app.nativeKey("ArrowUp");
          await waitRing(app, "cards:list");

          // A filter field with a query is a different animal: the caret owns
          // the arrows again. Land on the field and type.
          await app.nativeKey("ArrowDown");
          await waitRing(app, "snippets:band");
          await app.nativeKey("ArrowDown");
          await waitRing(app, "snippets:filter");
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
