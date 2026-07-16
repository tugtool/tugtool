/**
 * at0108-unknown-event-banner.test.ts — the session card surfaces tugcode's
 * forward-compat `unknown_event` frame as a soft, dismissible bulletin (NOT a
 * locking banner) ([AT0108]).
 *
 * ## Why this exists
 *
 * When claude streams a top-level event type this build doesn't translate,
 * tugcode's `routeTopLevelEvent` default branch emits an `unknown_event`
 * IPC frame (`original_type` + a hex payload preview) instead of silently
 * dropping it. The session card folds that into `snapshot.unknownEvent`. It is a
 * forward-compat FYI — the session keeps working — so it is an
 * acknowledge-sticky top-right bulletin (with an OK button), never a banner
 * that locks the pane.
 *
 * The pure halves — the tugcode emit (session.test.ts), the reducer fold,
 * and the projection (`transient-notice.test.ts`) — are unit-tested. This
 * drives the **live surface** end to end: it injects the already-translated
 * `unknown_event` frame through the store's real `frameToEvent → dispatch`
 * path (`driveSession`/`ingestFrame`) and asserts the bulletin's tone,
 * copy, that the pane stays interactive, OK-dismiss, and re-raise on a new
 * type.
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

const PANE_BODY = ".tug-pane-body";
const BULLETIN = ".tug-pane-bulletin";
const BULLETIN_TITLE = `${BULLETIN} [data-title]`;
const BULLETIN_DESC = `${BULLETIN} [data-description]`;
const BULLETIN_OK = `${BULLETIN} [data-button]`;
const CODE_OUTPUT_FEED = 0x40; // FeedId.CODE_OUTPUT
const TUG_SESSION_ID = "test-session-A"; // bindSession default

/** True iff `.tug-pane-body` is NOT inert — i.e. the prompt is interactive. */
const PANE_BODY_NOT_INERT = `(function(){var b=document.querySelector(${JSON.stringify(
  PANE_BODY,
)});return b!==null && !b.hasAttribute("inert");})()`;

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
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
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
  "AT0108: unknown_event bulletin — soft, non-blocking, dismissible, re-raising",
  () => {
    test(
      "injected unknown_event shows a non-locking ack bulletin naming the type; OK clears it; a new type re-raises",
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
          await app.bindSession("A", { projectDir });
          await app.awaitEngineReady("A", { timeoutMs: 30_000 });

          // ── inject a forward-incompatible event ──────────────────────
          await app.driveSession("A", unknownEventFrame("future_telemetry"));

          // A bulletin mounts (caution tone = Sonner data-type="warning").
          await app.waitForCondition<boolean>(
            `(function(){var b=document.querySelector(${JSON.stringify(BULLETIN)});return b!==null && b.getAttribute("data-type")==="warning";})()`,
            { timeoutMs: 6000 },
          );
          expect(
            await app.evalJS<string>(
              `(document.querySelector(${JSON.stringify(BULLETIN_TITLE)})||{}).textContent || ""`,
            ),
          ).toBe("Unsupported event");
          expect(
            await app.evalJS<string>(
              `(document.querySelector(${JSON.stringify(BULLETIN_DESC)})||{}).textContent || ""`,
            ),
          ).toContain("future_telemetry");
          // It's an FYI, not breakage — the pane stays interactive.
          expect(await app.evalJS<boolean>(PANE_BODY_NOT_INERT)).toBe(true);

          // ── the OK button (ack-sticky) clears it ─────────────────────
          await app.click(BULLETIN_OK);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(BULLETIN)}) === null`,
            { timeoutMs: 6000 },
          );

          // ── a different unknown type re-raises after the dismiss ──────
          await app.driveSession("A", unknownEventFrame("another_future_thing"));
          await app.waitForCondition<boolean>(
            `(function(){var d=document.querySelector(${JSON.stringify(BULLETIN_DESC)});return d!==null && d.textContent.indexOf("another_future_thing")!==-1;})()`,
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
