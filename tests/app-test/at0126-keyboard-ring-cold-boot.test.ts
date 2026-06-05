/**
 * at0126-keyboard-ring-cold-boot.test.ts — the keyboard focus ring survives a
 * full reload / relaunch, carried on the focus axis (`bag.focus`).
 *
 * Two-phase cold-boot round-trip, modeled on at0014-cold-boot-scroll:
 *
 * | Phase | Action                                        | Assertion                                                  |
 * |-------|-----------------------------------------------|------------------------------------------------------------|
 * | A     | seed radio card → Tab (ring on group) → quit  | tugbank disk holds `bag.focus = {kind:"dom", keyboard:true}`|
 * | B     | relaunch, re-inject bag → wait for ready      | the group wears the ring (`data-key-view-kbd`) after restore|
 *
 * Phase A failure ⇒ the ring was not captured onto the focus axis (focus left
 * the group before save, or the focus-key isn't emitted). Phase B failure ⇒
 * `applyBagFocus` didn't re-light the ring on restore.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
  tugbankRead,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const CARD_ID = "A";
const CARD = `[data-card-id="${CARD_ID}"]`;

// Two components exercise the two restore paths: the radio group is in the DOM
// at restore time (synchronous resolve); the Radix accordion late-mounts, so it
// resolves as `deferred-dom` and re-lights via the engine's `armKeyboardRestore`
// when its focusable finally registers.
const VARIANTS = [
  {
    name: "radio (synchronous resolve)",
    componentId: "gallery-radio-group",
    title: `${CARD} [data-testid="radio-focus-title"]`,
    group: `${CARD} [data-testid="radio-focus-demo"] [data-slot="tug-radio-group"]`,
    focusKey: "gallery-radio-focus:0",
  },
  {
    name: "accordion (late-mount resolve)",
    componentId: "gallery-accordion",
    title: `${CARD} [data-testid="accordion-focus-title"]`,
    group: `${CARD} [data-testid="accordion-focus-demo"] [data-slot="tug-accordion"]`,
    focusKey: "gallery-accordion-focus:0",
  },
] as const;

function deckShape(componentId: string) {
  return {
    cards: [{ id: CARD_ID, componentId, title: "Card", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 620 },
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

interface FocusBag {
  focus?: { kind: string; focusKey?: string; keyboard?: boolean } | null;
}

describe.skipIf(!SHOULD_RUN)("AT0126: keyboard ring survives cold boot", () => {
  for (const v of VARIANTS) {
    const ringOf = (sel: string) => `(function(){
      var el = document.querySelector(${JSON.stringify(sel)});
      return el ? el.hasAttribute("data-key-view-kbd") : false;
    })()`;

    test(
      `${v.name}: ring captured to bag.focus and restored on relaunch`,
      async () => {
        const tugbankPath = mkTempTugbank();
        seedTugbankForLaunch(tugbankPath);

        try {
          // ── Phase A: ring the group, then quit (save → disk). ──
          {
            const app = await launchTugApp({
              testName: "at0126-keyboard-ring-A",
              env: { TUGBANK_PATH: tugbankPath },
              skipAccessibilityPreflight: true,
              persistInTestMode: true,
            });

            await app.seedDeckState({ state: deckShape(v.componentId), focusCardId: CARD_ID });
            await app.waitForCondition<boolean>(
              `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered(${JSON.stringify(CARD_ID)})`,
            );
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(v.group)}) !== null`,
              { timeoutMs: 8000 },
            );

            await app.nativeClickAtElement(v.title);
            await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
            await new Promise((r) => setTimeout(r, 150));

            await app.nativeKey("Tab");
            await app.waitForCondition<boolean>(ringOf(v.group), { timeoutMs: 6000 });
            expect(await app.evalJS<boolean>(ringOf(v.group))).toBe(true);

            await app.quitGracefully();
          }

          // ── Phase A assertion: bag.focus on disk carries the ring. ──
          const onDisk = tugbankRead<FocusBag>(
            tugbankPath,
            "dev.tugtool.deck.cardstate",
            CARD_ID,
          );
          expect(onDisk).not.toBeNull();
          expect(onDisk?.type).toBe("json");
          expect(onDisk?.value?.focus?.kind).toBe("dom");
          expect(onDisk?.value?.focus?.focusKey).toBe(v.focusKey);
          expect(onDisk?.value?.focus?.keyboard).toBe(true);

          // ── Phase B: relaunch, re-inject bag, assert ring restored. ──
          {
            const app = await launchTugApp({
              testName: "at0126-keyboard-ring-B",
              env: { TUGBANK_PATH: tugbankPath },
              skipAccessibilityPreflight: true,
              persistInTestMode: true,
            });
            try {
              const bagRecord: Record<string, unknown> = {};
              bagRecord[CARD_ID] = onDisk!.value;

              await app.seedDeckState({
                state: deckShape(v.componentId),
                cardStates: bagRecord,
                focusCardId: CARD_ID,
              });
              await app.waitForCondition<boolean>(
                `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered(${JSON.stringify(CARD_ID)})`,
              );
              await app.waitForCondition<boolean>(
                `document.querySelector(${JSON.stringify(v.group)}) !== null`,
                { timeoutMs: 8000 },
              );

              // The ring should re-light on the group with no Tab.
              const restored = await app.waitForCondition<boolean>(ringOf(v.group), {
                timeoutMs: 6000,
              });
              expect(restored).toBe(true);
            } finally {
              await app.quitGracefully();
            }
          }
        } finally {
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );
  }
});
