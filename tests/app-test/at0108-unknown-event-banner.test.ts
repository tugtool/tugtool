/**
 * at0108-unknown-event-banner.test.ts — the dev card surfaces tugcode's
 * forward-compat `unknown_event` frame as a soft, dismissible warn banner
 * ([AT0108]).
 *
 * ## Why this exists
 *
 * When claude streams a top-level event type this build doesn't translate,
 * tugcode's `routeTopLevelEvent` default branch emits an `unknown_event`
 * IPC frame (`original_type` + a hex payload preview) instead of silently
 * dropping it. The dev card folds that into `snapshot.unknownEvent` and
 * renders the lowest-precedence `TugPaneBanner` — a caution-tone status
 * strip with a Dismiss row, naming the untranslated event.
 *
 * The pure halves — the tugcode emit (session.test.ts), the reducer fold
 * (reducer.unknown-event.test.ts), and the precedence/dismiss derivation
 * (dev-card-banner-spec.test.ts) — are unit-tested. This drives the **live
 * surface** end to end: it injects the already-translated `unknown_event`
 * frame (as tugcode would emit it) through the store's real
 * `frameToEvent → dispatch` path (`driveDevSession`/`ingestFrame`) and
 * asserts the banner's tone, copy, dismiss, and at-keyed re-raise.
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

const BANNER = '[data-slot="tug-pane-banner"]';
const BANNER_MSG = `${BANNER} .tug-pane-banner-message`;
const BANNER_LABEL = `${BANNER} .tug-pane-banner-label`;
const DISMISS = `${BANNER} .tug-pane-banner-status-actions .tug-button`;
const CODE_OUTPUT_FEED = 0x40; // FeedId.CODE_OUTPUT
const TUG_SESSION_ID = "test-session-A"; // bindDevSession default

let projectDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0108-unknown-event-"));
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

function unknownEventFrame(originalType: string) {
  return {
    op: "ingestFrame" as const,
    feedId: CODE_OUTPUT_FEED,
    decoded: {
      type: "unknown_event",
      tug_session_id: TUG_SESSION_ID,
      original_type: originalType,
      payload_hex_preview: "7b7d",
      ipc_version: 2,
    },
  };
}

describe.skipIf(!SHOULD_RUN)(
  "AT0108: unknown_event banner — soft, dismissible, re-raising",
  () => {
    test(
      "injected unknown_event shows a caution banner naming the type; Dismiss clears it; a new type re-raises",
      async () => {
        const app = await launchTugApp({ testName: "at0108-unknown-event-banner" });
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
          await app.awaitEngineReady("A", { timeoutMs: 30_000 });

          // ── inject a forward-incompatible event ──────────────────────
          await app.driveDevSession("A", unknownEventFrame("future_telemetry"));

          // Banner mounts with caution tone.
          await app.waitForCondition<boolean>(
            `(function(){var b=document.querySelector(${JSON.stringify(BANNER)});return b!==null && b.getAttribute("data-tone")==="caution";})()`,
            { timeoutMs: 6000 },
          );
          const label = await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(BANNER_LABEL)})||{}).textContent || ""`,
          );
          expect(label).toBe("Unsupported event");
          const msg = await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(BANNER_MSG)})||{}).textContent || ""`,
          );
          expect(msg).toContain("future_telemetry");

          // ── Dismiss clears it ────────────────────────────────────────
          await app.click(DISMISS);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(BANNER)}) === null`,
            { timeoutMs: 6000 },
          );

          // ── a different unknown type re-raises after the dismiss ──────
          await app.driveDevSession("A", unknownEventFrame("another_future_thing"));
          await app.waitForCondition<boolean>(
            `(function(){var m=document.querySelector(${JSON.stringify(BANNER_MSG)});return m!==null && m.textContent.indexOf("another_future_thing")!==-1;})()`,
            { timeoutMs: 6000 },
          );

          process.stdout.write("VERDICT: PASS\n");
        } catch (err) {
          process.stdout.write("VERDICT: FAIL\n");
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0108] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
