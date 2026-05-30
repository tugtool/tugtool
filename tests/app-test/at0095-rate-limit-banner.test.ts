/**
 * at0095-rate-limit-banner.test.ts — the single, app-level rate-limit caution
 * banner surfaces only real quota trouble and is deduplicated across cards
 * ([AT0095], [#step-3.5]).
 *
 * ## Why this exists
 *
 * Subscription quota is **account-global**, so it gets ONE deck-wide banner
 * (modeled on the reconnection banner), never one per dev card. The banner is
 * fed by the app-level `RateLimitStore`; the trigger keys on the `status` enum
 * confirmed from the CLI v2.1.158 schema:
 *
 *   - `allowed` (incl. the benign `overageStatus: "rejected"` org-disabled
 *     default) → **hidden**.
 *   - `allowed_warning` → **one caution banner** (approaching).
 *   - `rejected` → **one danger banner** (hard-limited).
 *   - back to `allowed` → banner **clears**.
 *
 * The dedup case (two dev cards, still exactly one banner) is the bug this
 * step exists to prevent. Quota is injected via the app-level `ingestRateLimit`
 * surface seam — no live claude limit needed.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";
import type { RateLimitInfo } from "./_harness/client";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

// The rate-limit banner — distinguished from the always-mounted reconnection
// banner by its `rate-limit-banner` class (both are status-variant tug-banners).
const BANNER = ".rate-limit-banner";
const BANNER_MSG = `${BANNER} .tug-banner-message`;

/** Two dev cards in two panes — to prove the banner is deduped, not per-card. */
function twoCardDeck() {
  return {
    cards: [
      { id: "A", componentId: "dev", title: "Dev A", closable: true },
      { id: "B", componentId: "dev", title: "Dev B", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 720, height: 480 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"],
      },
      {
        id: "p2",
        position: { x: 800, y: 40 },
        size: { width: 720, height: 480 },
        cardIds: ["B"],
        activeCardId: "B",
        title: "",
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

function quota(status: string, overrides: Partial<RateLimitInfo> = {}): RateLimitInfo {
  return {
    status,
    resetsAt: Math.floor(Date.now() / 1000) + 30 * 60,
    rateLimitType: "five_hour",
    overageStatus: "rejected",
    isUsingOverage: false,
    ...overrides,
  };
}

/** Snapshot of the rate-limit banner: count, visibility, tone, message. */
async function bannerState(
  app: App,
): Promise<{ count: number; visible: boolean; tone: string | null; message: string }> {
  return await app.evalJS(
    `(function(){
      var els = document.querySelectorAll(${JSON.stringify(BANNER)});
      var el = els[0] || null;
      var msgEl = document.querySelector(${JSON.stringify(BANNER_MSG)});
      return {
        count: els.length,
        visible: el ? el.getAttribute("data-visible") === "true" : false,
        tone: el ? el.getAttribute("data-tone") : null,
        message: msgEl ? msgEl.textContent.trim() : "",
      };
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "AT0095: app-level rate-limit banner shows only on trouble, deduped across cards",
  () => {
    test(
      "benign=hidden; allowed_warning=one caution; rejected=one danger; recover=clears",
      async () => {
        const app = await launchTugApp({ testName: "at0095-rate-limit-banner" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: twoCardDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );

          // Exactly one rate-limit banner exists for the whole deck, hidden at
          // rest — even with two dev cards mounted (structural dedup).
          let s = await bannerState(app);
          expect(s.count, "exactly one rate-limit banner in the deck").toBe(1);
          expect(s.visible, "hidden before any quota signal").toBe(false);

          // Benign default (allowed + overageStatus rejected) — must stay hidden.
          await app.ingestRateLimit(quota("allowed"));
          await app.evalJS<void>(`void 0`);
          s = await bannerState(app);
          expect(s.visible, "the benign allowed default shows nothing").toBe(false);
          expect(s.count, "still exactly one banner element").toBe(1);

          // allowed_warning → one caution banner with a reset countdown.
          await app.ingestRateLimit(quota("allowed_warning"));
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(BANNER)}).getAttribute("data-visible") === "true"`,
            { timeoutMs: 4000 },
          );
          s = await bannerState(app);
          expect(s.count, "approaching: still ONE banner across two cards (dedup)").toBe(1);
          expect(s.tone, "approaching reads as caution").toBe("caution");
          expect(s.message.toLowerCase()).toContain("approaching usage limit");
          expect(s.message, "carries a reset countdown").toContain("resets in");

          // rejected → one danger banner.
          await app.ingestRateLimit(quota("rejected"));
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(BANNER)});
              return el !== null && el.getAttribute("data-tone") === "danger" && el.getAttribute("data-visible") === "true";
            })()`,
            { timeoutMs: 4000 },
          );
          s = await bannerState(app);
          expect(s.count, "limited: still exactly one banner").toBe(1);
          expect(s.tone).toBe("danger");
          expect(s.message.toLowerCase()).toContain("usage limit reached");

          // Recover → allowed hides the banner (gated by minMountedMs + exit).
          await app.ingestRateLimit(quota("allowed"));
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(BANNER)}).getAttribute("data-visible") === "false"`,
            { timeoutMs: 6000 },
          );
          s = await bannerState(app);
          expect(s.visible, "recovering to allowed clears the banner").toBe(false);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(`\n[at0095-rate-limit-banner] log tail:\n${tail}\n`);
          }
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
