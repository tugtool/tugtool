/**
 * at0095-rate-limit-chip.test.ts — the Z4B rate-limit chip surfaces
 * subscription-quota state and ticks its countdown via direct DOM
 * mutation, never React ([AT0095], [#step-3]).
 *
 * ## Why this exists
 *
 * The rate-limit chip is a pure indicator ([D13]) that reads
 * `SessionMetadataStore.rateLimit` (sourced from claude's per-turn
 * `rate_limit_event`, rewrapped onto SESSION_METADATA by the tugcast
 * supervisor). It must:
 *
 *   1. **Mount on a quota that has something to say** — a `warning`
 *      status renders the chip with a countdown.
 *   2. **Stay out of the way otherwise** — an `allowed` status whose
 *      reset is more than 60 min out renders no chip.
 *   3. **Show the exhausted face** — a non-allowed/non-warning status
 *      reads `Rate-limited` and escalates to the `danger` role.
 *   4. **Tick via the DOM, not React ([L22])** — the per-minute countdown
 *      rewrite mutates the span's `textContent` directly; it must not
 *      trigger a React commit. Verified by firing one tick through the
 *      `__atRateLimitTick` test hook and asserting the render counter is
 *      unchanged while the text was rewritten.
 *
 * Frames are injected via `driveDevSession`'s `ingestFrame` op on the
 * SESSION_METADATA feed (0x51) — no live claude round-trip needed.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

// SESSION_METADATA feed id (see tugdeck/src/protocol.ts `FeedId`).
const SESSION_METADATA_FEED = 0x51;

const CARD = '[data-card-id="A"]';
const CHIP = `${CARD} [data-slot="rate-limit-chip"]`;
const CHIP_VALUE = `${CHIP} [data-slot="rate-limit-value"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 560 },
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

/** Build a `rate_limit_event` frame payload for the bound session. */
function rateLimitFrame(
  status: string,
  resetsAtSec: number,
  extra: Record<string, unknown> = {},
): { op: "ingestFrame"; feedId: number; decoded: unknown } {
  return {
    op: "ingestFrame",
    feedId: SESSION_METADATA_FEED,
    decoded: {
      type: "rate_limit_event",
      tug_session_id: "test-session-A",
      rate_limit_info: {
        status,
        resetsAt: resetsAtSec,
        rateLimitType: "five_hour",
        overageStatus: "accepted",
        isUsingOverage: false,
        ...extra,
      },
      ipc_version: 2,
    },
  };
}

/** Trimmed text of the chip's value line, or `null` if the chip is absent. */
async function chipValue(app: App): Promise<string | null> {
  return await app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(CHIP_VALUE)});
      return el ? el.textContent.trim() : null;
    })()`,
  );
}

async function chipPresent(app: App): Promise<boolean> {
  return await app.evalJS<boolean>(
    `document.querySelector(${JSON.stringify(CHIP)}) !== null`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "AT0095: rate-limit chip mounts on quota state and ticks via the DOM",
  () => {
    test(
      "warning mounts a countdown; allowed+far unmounts; tick is DOM-only",
      async () => {
        const app = await launchTugApp({ testName: "at0095-rate-limit-chip" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindDevSession("A");
          await app.awaitEngineReady("A");

          // Baseline: a fresh session has reported no quota, so the chip is
          // absent (it hides when there is nothing to say).
          expect(await chipPresent(app), "chip is absent before any quota").toBe(
            false,
          );

          // 1. A `warning` quota with a reset ~30 min out mounts the chip
          //    with a live countdown.
          const nowSec = Math.floor(Date.now() / 1000);
          await app.driveDevSession("A", rateLimitFrame("warning", nowSec + 30 * 60));
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CHIP_VALUE)}) !== null`,
            { timeoutMs: 4000 },
          );
          const warnText = await chipValue(app);
          expect(warnText, "warning chip shows a countdown").not.toBeNull();
          expect(warnText!.length, "countdown text is non-empty").toBeGreaterThan(0);
          expect(
            await app.evalJS<string | null>(
              `(function(){
                var el = document.querySelector(${JSON.stringify(CHIP)});
                return el ? el.getAttribute('data-status') : null;
              })()`,
            ),
            "chip reflects the status via data-status",
          ).toBe("warning");

          // 2. The [L22] tick rewrites the countdown via the DOM without a
          //    React commit. Read the render counter, scribble a sentinel
          //    into the span, fire one tick through the test hook, and
          //    assert the text was rewritten while the counter held steady.
          const rendersBefore = await app.evalJS<number>(
            `(window.__atRateLimitRenderCount || 0)`,
          );
          await app.evalJS<void>(
            `(function(){
              document.querySelector(${JSON.stringify(CHIP_VALUE)}).textContent = "SENTINEL";
              window.__atRateLimitTick();
            })()`,
          );
          const afterTickText = await chipValue(app);
          expect(
            afterTickText,
            "the tick rewrote the span's textContent (DOM mutation, [L22])",
          ).not.toBe("SENTINEL");
          const rendersAfter = await app.evalJS<number>(
            `(window.__atRateLimitRenderCount || 0)`,
          );
          expect(
            rendersAfter,
            "the tick did NOT re-render through React ([L22])",
          ).toBe(rendersBefore);

          // 3. An `exceeded` quota shows the static `Rate-limited` face and
          //    escalates to the danger role.
          await app.driveDevSession(
            "A",
            rateLimitFrame("exceeded", nowSec + 30 * 60),
          );
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(CHIP_VALUE)});
              return el !== null && el.textContent.trim() === "Rate-limited";
            })()`,
            { timeoutMs: 4000 },
          );
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(CHIP)}).classList.contains("tug-badge-tinted-danger")`,
            ),
            "an exhausted quota escalates to the danger role",
          ).toBe(true);

          // 4. An `allowed` quota whose reset is far off (5 h) unmounts the
          //    chip entirely — there is nothing to surface.
          await app.driveDevSession(
            "A",
            rateLimitFrame("allowed", nowSec + 5 * 3600),
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CHIP)}) === null`,
            { timeoutMs: 4000 },
          );
          expect(
            await chipPresent(app),
            "an allowed quota with a far reset hides the chip",
          ).toBe(false);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(`\n[at0095-rate-limit-chip] log tail:\n${tail}\n`);
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
