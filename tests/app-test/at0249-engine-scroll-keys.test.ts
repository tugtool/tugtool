/**
 * at0249-engine-scroll-keys.test.ts — the engine scroll-key route ([Q02] of
 * the keyboard-as-engine-state plan).
 *
 * Bare PageDown / PageUp / End / Home in engine-routed mode must scroll the
 * key card's scroll region WITHOUT DOM focus sitting inside the scroll
 * container. Element-attached scroll handling and the browser's native
 * focus-driven key scrolling both require in-container focus, which the
 * engine no longer grants to non-text surfaces; the provider's
 * `engineScrollKeyListener` routes the intent instead — through the key
 * card's paging actions when registered, else a generic
 * `tug-region-scroll-set` page of the card's live scroll region.
 *
 * Pinned on a markdown card (the generic branch): focus never enters the
 * scroll container, yet the scroll keys page it.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const CARD_ID = "A";
const SCROLL_SELECTOR = `[data-card-id="${CARD_ID}"] [data-tug-scroll-key="markdown-view"]`;

function deckShape() {
  return {
    cards: [
      { id: CARD_ID, componentId: "gallery-markdown-50kb", title: "MD A", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 720, height: 480 },
        cardIds: [CARD_ID],
        activeCardId: CARD_ID,
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

async function scrollTop(app: App): Promise<number> {
  return app.evalJS<number>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(SCROLL_SELECTOR)});
      return el ? el.scrollTop : -1;
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)("at0249 — engine scroll-key route", () => {
  test(
    "PageDown/End/Home page the key card's region with no in-container focus",
    async () => {
      const tugbankPath = mkTempTugbank();
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0249-engine-scroll-keys",
          env: { TUGBANK_PATH: tugbankPath },
        });
        try {
          await app.seedDeckState({ state: deckShape(), focusCardId: CARD_ID });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered(${JSON.stringify(CARD_ID)})`,
          );
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(SCROLL_SELECTOR)});
              return el !== null && el.scrollHeight > el.clientHeight + 200;
            })()`,
            { timeoutMs: 6_000 },
          );
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });

          // Precondition: DOM focus is NOT inside the scroll container.
          const focusInContainer = await app.evalJS<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(SCROLL_SELECTOR)});
              return el !== null && el.contains(document.activeElement);
            })()`,
          );
          expect(focusInContainer).toBe(false);

          // PageDown pages the region forward.
          const t0 = await scrollTop(app);
          await app.nativeKey("PageDown");
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(SCROLL_SELECTOR)});
              return el !== null && el.scrollTop > ${t0} + 100;
            })()`,
            { timeoutMs: 3_000 },
          );

          // End lands the bottom.
          await app.nativeKey("End");
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(SCROLL_SELECTOR)});
              return el !== null && Math.abs(el.scrollTop - (el.scrollHeight - el.clientHeight)) <= 8;
            })()`,
            { timeoutMs: 3_000 },
          );

          // Home returns to the top; PageUp from a paged position moves up.
          await app.nativeKey("Home");
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(SCROLL_SELECTOR)});
              return el !== null && el.scrollTop <= 8;
            })()`,
            { timeoutMs: 3_000 },
          );
          await app.nativeKey("PageDown");
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(SCROLL_SELECTOR)});
              return el !== null && el.scrollTop > 100;
            })()`,
            { timeoutMs: 3_000 },
          );
          const paged = await scrollTop(app);
          await app.nativeKey("PageUp");
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(SCROLL_SELECTOR)});
              return el !== null && el.scrollTop < ${paged} - 100;
            })()`,
            { timeoutMs: 3_000 },
          );
        } finally {
          await app.close();
        }
      } finally {
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
