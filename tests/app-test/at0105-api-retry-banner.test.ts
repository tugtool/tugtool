/**
 * at0105-api-retry-banner.test.ts — the dev card surfaces claude's
 * `api_retry` backoff as a card banner, classified by error category,
 * with a live countdown, and clears it at the next turn boundary
 * ([AT0105]).
 *
 * ## Why this exists
 *
 * Claude's SDK retries retryable API failures itself and announces each
 * attempt as a `system`/`api_retry` event. Tugcode forwards it; the dev
 * card mirrors it as a `TugPaneBanner` (never decides to retry). The pure
 * halves — `classifyApiRetry`, `formatRetryCountdown`,
 * `deriveDevCardBannerSpec`, and the reducer clear — are unit-tested. This
 * drives the **live surface** end to end without a real (rare) API
 * failure: it injects synthetic `api_retry` frames through the store's
 * real `frameToEvent → dispatch` path (`driveDevSession`/`ingestFrame`)
 * and asserts the banner's tone, copy, ticking countdown, and that a
 * `cost_update` clears it.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const BANNER = '[data-slot="tug-pane-banner"]';
const BANNER_MSG = `${BANNER} .tug-pane-banner-message`;
const BANNER_LABEL = `${BANNER} .tug-pane-banner-label`;
const COUNTDOWN = `${BANNER} .dev-card-retry-countdown`;
const CODE_OUTPUT_FEED = 0x40; // FeedId.CODE_OUTPUT
const TUG_SESSION_ID = "test-session-A"; // bindDevSession default

let projectDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0105-api-retry-"));
});
afterAll(() => {
  if (projectDir !== "" && existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
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

function apiRetryFrame(fields: {
  attempt: number;
  max_retries: number;
  retry_delay_ms: number;
  error: string;
  error_status: number | null;
}) {
  return {
    op: "ingestFrame" as const,
    feedId: CODE_OUTPUT_FEED,
    decoded: {
      type: "api_retry",
      tug_session_id: TUG_SESSION_ID,
      ...fields,
    },
  };
}

describe.skipIf(!SHOULD_RUN)(
  "AT0105: api_retry banner — classified, ticking, self-clearing",
  () => {
    test(
      "transient retry shows caution banner + countdown; fatal shows danger; cost_update clears",
      async () => {
        const app = await launchTugApp({ testName: "at0105-api-retry-banner" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            // Generous: a cold single-file run pays the tugdeck Vite
            // first-compile cost, which can exceed the 10s default.
            { timeoutMs: 30_000 },
          );
          await app.bindDevSession("A", { projectDir });
          // Generous: the cold-compile penalty (above) also delays the
          // first engine-ready signal on a single-file run.
          await app.awaitEngineReady("A", { timeoutMs: 30_000 });

          // ── transient category (rate_limit) ──────────────────────────
          await app.driveDevSession(
            "A",
            apiRetryFrame({
              attempt: 3,
              max_retries: 10,
              retry_delay_ms: 8000,
              error: "rate_limit",
              error_status: 429,
            }),
          );

          // Banner mounts with caution tone.
          await app.waitForCondition<boolean>(
            `(function(){var b=document.querySelector(${JSON.stringify(BANNER)});return b!==null && b.getAttribute("data-tone")==="caution";})()`,
            { timeoutMs: 6000 },
          );
          // Message carries the classified label + attempt count.
          const msg = await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(BANNER_MSG)})||{}).textContent || ""`,
          );
          expect(msg).toContain("Rate limited");
          expect(msg).toContain("attempt 3/10");
          // The countdown span ticks a whole-seconds value (or "now").
          const countdown = await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(COUNTDOWN)})||{}).textContent || ""`,
          );
          expect(countdown).toMatch(/^(\d+s|now)$/);

          // ── likely-fatal category (authentication_failed) ────────────
          await app.driveDevSession(
            "A",
            apiRetryFrame({
              attempt: 4,
              max_retries: 10,
              retry_delay_ms: 6000,
              error: "authentication_failed",
              error_status: 401,
            }),
          );
          await app.waitForCondition<boolean>(
            `(function(){var b=document.querySelector(${JSON.stringify(BANNER)});return b!==null && b.getAttribute("data-tone")==="danger";})()`,
            { timeoutMs: 6000 },
          );
          const fatalLabel = await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(BANNER_LABEL)})||{}).textContent || ""`,
          );
          expect(fatalLabel).toBe("Authentication failed");
          const fatalMsg = await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(BANNER_MSG)})||{}).textContent || ""`,
          );
          expect(fatalMsg).toContain("may not recover");

          // ── a cost_update lands → banner clears ──────────────────────
          await app.driveDevSession("A", {
            op: "ingestFrame",
            feedId: CODE_OUTPUT_FEED,
            decoded: {
              type: "cost_update",
              tug_session_id: TUG_SESSION_ID,
              total_cost_usd: 0.01,
            },
          });
          // The banner runs its exit animation (min-mount + slide) then
          // unmounts; wait for it to be gone.
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(BANNER)}) === null`,
            { timeoutMs: 6000 },
          );

          process.stdout.write("VERDICT: PASS\n");
        } catch (err) {
          process.stdout.write("VERDICT: FAIL\n");
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0105] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
