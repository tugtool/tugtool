/**
 * at0010-cold-boot-selection.test.ts — DOM selection restore across
 * full Tug.app process restart on a `tug-markdown-view` card.
 *
 * ## Two-phase contract
 *
 * | Phase | Tugbank state at launch | Action                        | Assertion                                            |
 * |-------|-------------------------|-------------------------------|------------------------------------------------------|
 * | A     | empty (fresh temp DB)   | seed deck → anchor a 20-char  | tugbank disk has a populated `domSelection` with     |
 * |       |                         | range in card → quitGracefully | non-empty anchor/focus paths                        |
 * | B     | populated (from A)      | re-seed deck with bag from    | `__tug.getCaretState("A")` returns the saved range  |
 * |       |                         | disk → wait for ready         | AND native `::selection` paints it                   |
 *
 * Phase A failure ⇒ selection capture didn't reach disk on quit.
 * Phase B failure ⇒ load + apply at fresh mount didn't re-anchor
 * the selection.
 *
 * ## Why `gallery-markdown-1kb`, not `gallery-markdown-50kb`
 *
 * 1KB of static markdown fits in one viewport at the gallery card's
 * default size, so all blocks render fully on mount and
 * `block-container` children are stable across re-mount. The saved
 * `domSelection` paths (which are child-index sequences rooted at
 * the card boundary) reference DOM nodes that exist in both Phase
 * A and Phase B. The 50KB variant exercises the virtualization
 * path separately — content-relative selection encoding may be
 * needed there as a follow-up if
 * Phase B's 1KB variant passes after the Layer 4 fix.
 *
 * ## Why seedDeckState in Phase B
 *
 * See the matching note in `at0014-cold-boot-scroll.test.ts`. Test
 * mode skips main.tsx's tugbank-driven rehydrate; the harness
 * reads the bag back via the `tugbank` CLI and re-injects it.
 *
 * ## Status: PASSING (in the default Justfile sweep)
 *
 * Layer 3 commit verified this passes end-to-end on the 1KB
 * fixture: with all blocks rendered, the saved `domSelection`
 * paths resolve to the same DOM nodes on re-mount and selectionGuard
 * re-anchors the range correctly. The bug the user reported on the
 * 50KB card is virtualization-specific and out of scope for the
 * current Layer 4 fix; if a 50KB-cold-boot variant is added later,
 * it will need content-relative selection encoding (per the Step
 * 25C.2 plan's "Selection re-anchor" / "Content-relative selection
 * encoding" branches).
 *
 * Run individually via:
 *
 *     just test-in-app-fast at0010-cold-boot-selection.test.ts
 *
 * ## Closes
 *
 * [AT0010] cold-boot variant. The existing `at0010-markdown-selection.test.ts`
 * gates tab-switch + cmd-tab round-trips inside one Tug.app
 * process; this file adds the cross-process variant.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
  tugbankRead,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

const TEST_TIMEOUT_MS = 60_000;

const SELECTION_LENGTH = 20;

const CARD_ID = "A";

interface SeededSelection {
  text: string;
  startOffset: number;
  endOffset: number;
}

function deckShape() {
  return {
    cards: [
      { id: CARD_ID, componentId: "gallery-markdown-1kb", title: "MD A", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 720, height: 480 },
        cardIds: [CARD_ID],
        activeCardId: CARD_ID,
        title: "",
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)("m10: selection cold-boot across full process restart", () => {
  test(
    "DOM selection survives quitGracefully + relaunch",
    async () => {
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath);

      try {
        let seeded: SeededSelection;

        // ── Phase A: seed deck, anchor selection, quitGracefully. ──
        {
          const app = await launchTugApp({
            testName: "at0010-cold-boot-selection-A",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });

          await app.seedDeckState({
            state: deckShape(),
            focusCardId: CARD_ID,
          });

          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered(${JSON.stringify(CARD_ID)})`,
          );

          // Wait for at least one block to render (1KB renders fully
          // in one viewport — no virtualization indeterminism).
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector('[data-card-id=${JSON.stringify(CARD_ID)}] .tugx-md-block');
              return el !== null && el.textContent !== null && el.textContent.length > ${SELECTION_LENGTH};
            })()`,
            { timeoutMs: 4000 },
          );

          // Anchor focus on the card before driving the selection
          // gesture (mirrors at0010-markdown-selection's preflight).
          await app.nativeClickAtElement(`[data-card-id="${CARD_ID}"] [data-tug-scroll-key="markdown-view"]`);
          await app.waitForCondition<boolean>(
            `window.__tug.getHasFocus() === true`,
            { timeoutMs: 2000 },
          );

          // Programmatically anchor a 20-char range inside the first
          // block's first text node. Same primitive as
          // at0010-markdown-selection — the selectionchange listener
          // installed by tug-markdown-view (persistKey="markdown-view")
          // publishes the Range to selectionGuard.cardRanges["A"].
          const seededOpt = await app.evalJS<SeededSelection | null>(
            `(function(){
              var blockEls = document.querySelectorAll('[data-card-id=${JSON.stringify(CARD_ID)}] .tugx-md-block');
              if (blockEls.length === 0) return null;
              var firstBlock = blockEls[0];
              var walker = document.createTreeWalker(firstBlock, NodeFilter.SHOW_TEXT);
              var first = walker.nextNode();
              if (!first || first.textContent === null) return null;
              var len = Math.min(${SELECTION_LENGTH}, first.textContent.length);
              if (len < 4) return null;
              var range = document.createRange();
              range.setStart(first, 0);
              range.setEnd(first, len);
              var sel = window.getSelection();
              if (!sel) return null;
              sel.removeAllRanges();
              sel.addRange(range);
              return {
                text: range.toString(),
                startOffset: 0,
                endOffset: len,
              };
            })()`,
          );
          if (seededOpt === null) {
            throw new Error("[at0010-cold-boot] could not seed a selection — first block had no usable text node");
          }
          seeded = seededOpt;

          // Wait for the publish to land in selectionGuard.
          await app.waitForCondition<boolean>(
            `(function(){
              var s = window.__tug.getCaretState(${JSON.stringify(CARD_ID)});
              return s !== null && s.kind === "range" && s.text === ${JSON.stringify(seeded.text)};
            })()`,
            { timeoutMs: 2000 },
          );

          await app.quitGracefully();
        }

        // ── Phase A assertion: bag has populated domSelection. ──
        const onDisk = tugbankRead<{
          domSelection?: {
            anchorPath?: number[];
            anchorOffset?: number;
            focusPath?: number[];
            focusOffset?: number;
          } | null;
        }>(
          tugbankPath,
          "dev.tugtool.deck.cardstate",
          CARD_ID,
        );
        expect(onDisk).not.toBeNull();
        expect(onDisk?.type).toBe("json");
        const domSelection = onDisk?.value?.domSelection;
        expect(domSelection).toBeTruthy();
        expect(Array.isArray(domSelection?.anchorPath)).toBe(true);
        expect((domSelection?.anchorPath ?? []).length).toBeGreaterThan(0);
        expect(Array.isArray(domSelection?.focusPath)).toBe(true);
        expect((domSelection?.focusPath ?? []).length).toBeGreaterThan(0);

        // ── Phase B: relaunch, re-seed bag, assert restore. ──
        {
          const app = await launchTugApp({
            testName: "at0010-cold-boot-selection-B",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            const bagRecord: Record<string, unknown> = {};
            bagRecord[CARD_ID] = onDisk!.value;

            await app.seedDeckState({
              state: deckShape(),
              cardStates: bagRecord,
              focusCardId: CARD_ID,
            });

            await app.waitForCondition<boolean>(
              `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered(${JSON.stringify(CARD_ID)})`,
            );

            await app.waitForCondition<boolean>(
              `(function(){
                var el = document.querySelector('[data-card-id=${JSON.stringify(CARD_ID)}] .tugx-md-block');
                return el !== null && el.textContent !== null && el.textContent.length > ${SELECTION_LENGTH};
              })()`,
              { timeoutMs: 4000 },
            );

            // Wait for the restore to land the saved range in
            // selectionGuard.cardRanges["A"]. getCaretState reads
            // from there.
            await app.waitForCondition<boolean>(
              `(function(){
                var s = window.__tug.getCaretState(${JSON.stringify(CARD_ID)});
                return s !== null && s.kind === "range" && s.text === ${JSON.stringify(seeded.text)};
              })()`,
              { timeoutMs: 4000 },
            );

            const restoredCaret = await app.getCaretState(CARD_ID);
            expect(restoredCaret).not.toBeNull();
            expect(restoredCaret?.kind).toBe("range");
            if (restoredCaret?.kind === "range") {
              expect(restoredCaret.text).toBe(seeded.text);
            }

            // Native `::selection` should also carry the restored
            // range on the focused card. selectionGuard's
            // updatePaint runs synchronously inside the deck-store
            // notify, but the seed flow may queue a selectionchange
            // we need to wait for.
            await app.waitForCondition<boolean>(
              `(function(){
                var sel = window.getSelection();
                if (!sel || sel.rangeCount === 0) return false;
                return sel.getRangeAt(0).toString() === ${JSON.stringify(seeded.text)};
              })()`,
              { timeoutMs: 2000 },
            );

            const nativeText = await app.evalJS<string>(
              `(function(){
                var sel = window.getSelection();
                if (!sel || sel.rangeCount === 0) return "";
                return sel.getRangeAt(0).toString();
              })()`,
            );
            expect(nativeText).toBe(seeded.text);
          } finally {
            // Use quitGracefully (NOT close) so tugcast shuts down via
            // UDS and doesn't linger past the next test's launch.
            // close() sends SIGTERM which bypasses
            // applicationShouldTerminate's processManager.stop, leaving
            // tugcast alive until parent_watch notices — which can take
            // longer than the recipe's inter-file sleep, causing
            // port-55255 collisions on the next launch.
            await app.quitGracefully();
          }
        }
      } finally {
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
