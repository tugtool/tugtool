/**
 * at0084-tide-lifecycle-coordination.test.ts — end-to-end verification
 * of the tide-card lifecycle state-to-zone coordination matrix.
 *
 * The capstone of the tide-card lifecycle-coordination work. The
 * lifecycle matrix says what each zone (Z1 transcript trailing, Z2
 * status row, Z5 submit button) paints in each lifecycle state; the
 * pure projection (`deriveLifecycleSnapshot`) is unit-tested
 * exhaustively elsewhere.
 * This test closes the loop: it drives a *real* `CodeSessionStore`
 * inside a *real* tide card through every distinct matrix row and
 * asserts the rendered DOM — no mock store, no fake DOM.
 *
 * It drives the store through the `driveTideSession` harness verb:
 *   - `send` — a user submission (mid-turn `send` queues).
 *   - `ingestFrame` — a decoded `CODE_OUTPUT` frame fed through the
 *     store's real `frameToEvent` → `dispatch` path.
 *   - `interrupt` / `transportClose` — the cancel + transport overlays.
 *
 * One card per scenario, one pane each, all mounted at once:
 *   - A: the clean turn lifecycle — IDLE → STREAMING → TOOL_WORK →
 *        COMPLETE.
 *   - B: AWAITING_USER (a permission forward).
 *   - C: QUEUED_NEXT_TURN (a mid-turn submit → a transcript ghost row).
 *   - D: ERRORED (a wire error frame).
 *   - E: REPLAYING (a replay window).
 *   - F: TRANSPORT_DOWN (the wire goes offline).
 *
 * The matrix is the contract; a regression against any asserted cell
 * is a bug.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 120_000;

/**
 * `FeedId.CODE_OUTPUT` — the wire feed every tide stream frame
 * (`assistant_text` / `tool_use` / `turn_complete` / …) arrives on.
 * Hardcoded rather than imported: the app-test graph does not couple
 * to tugdeck's `protocol.ts`. See `tugdeck/src/protocol.ts`.
 */
const FEED_CODE_OUTPUT = 0x40;

/** Card ids — one per matrix scenario; `tug_session_id` is `test-session-<id>`. */
const CARD_IDS = ["A", "B", "C", "D", "E", "F"] as const;
type CardId = (typeof CARD_IDS)[number];

function sessionIdFor(cardId: CardId): string {
  return `test-session-${cardId}`;
}

// ---------------------------------------------------------------------------
// Deck seed — one tide card per pane so every card mounts at once.
// ---------------------------------------------------------------------------

function deckShape() {
  return {
    cards: CARD_IDS.map((id) => ({
      id,
      componentId: "tide",
      title: `Tide ${id}`,
      closable: true,
    })),
    panes: CARD_IDS.map((id, i) => ({
      id: `p-${id}`,
      // Offset positions so the panes don't fully stack; irrelevant to
      // DOM inspection (selectors key off `data-card-id`), but keeps
      // every card's pane independently active.
      position: { x: 40 + i * 24, y: 40 + i * 24 },
      size: { width: 640, height: 460 },
      cardIds: [id],
      activeCardId: id,
      title: "",
      acceptsFamilies: ["developer"],
    })),
    activePaneId: "p-A",
    hasFocus: true,
  };
}

// ---------------------------------------------------------------------------
// Frame builders — decoded CODE_OUTPUT payloads for a card's session.
// ---------------------------------------------------------------------------

function assistantText(
  cardId: CardId,
  msgId: string,
  text: string,
  rev: number,
): Record<string, unknown> {
  return {
    type: "assistant_text",
    tug_session_id: sessionIdFor(cardId),
    msg_id: msgId,
    text,
    is_partial: true,
    rev,
    seq: 0,
  };
}

function toolUse(
  cardId: CardId,
  msgId: string,
  toolName: string,
): Record<string, unknown> {
  return {
    type: "tool_use",
    tug_session_id: sessionIdFor(cardId),
    msg_id: msgId,
    tool_use_id: `${msgId}-tool-1`,
    tool_name: toolName,
    input: {},
    seq: 1,
  };
}

function turnCompleteSuccess(
  cardId: CardId,
  msgId: string,
): Record<string, unknown> {
  return {
    type: "turn_complete",
    tug_session_id: sessionIdFor(cardId),
    msg_id: msgId,
    result: "success",
  };
}

function controlRequestForward(cardId: CardId): Record<string, unknown> {
  return {
    type: "control_request_forward",
    tug_session_id: sessionIdFor(cardId),
    request_id: `${cardId}-perm-1`,
    is_question: false,
    tool_name: "Bash",
  };
}

function wireError(cardId: CardId): Record<string, unknown> {
  return {
    type: "error",
    tug_session_id: sessionIdFor(cardId),
    message: "synthetic wire error",
    recoverable: false,
  };
}

function replayStarted(cardId: CardId): Record<string, unknown> {
  return { type: "replay_started", tug_session_id: sessionIdFor(cardId) };
}

// ---------------------------------------------------------------------------
// Zone readers — scoped to one card's DOM subtree.
// ---------------------------------------------------------------------------

/** Z5 — the submit button's `data-mode` (the matrix's Z5 column). */
function submitButtonMode(app: App, cardId: CardId): Promise<string | null> {
  return app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(
        '[data-card-id="${cardId}"] .tug-prompt-entry-submit-button');
      return el ? el.getAttribute("data-mode") : null;
    })()`,
  );
}

/** Z2 — the status row's STATE-cell value text (the human-readable phase). */
function stateCellLabel(app: App, cardId: CardId): Promise<string | null> {
  return app.evalJS<string | null>(
    `(function(){
      var cell = document.querySelector(
        '[data-card-id="${cardId}"] [data-priority="state"] .tide-telemetry-status-value');
      return cell ? cell.textContent : null;
    })()`,
  );
}

/** Count of transcript ghost rows (queued, not-yet-sent user rows). */
function ghostRowCount(app: App, cardId: CardId): Promise<number> {
  return app.evalJS<number>(
    `document.querySelectorAll(
      '[data-card-id="${cardId}"] [data-slot="tide-transcript-ghost-row"]').length`,
  );
}

/** Count of committed transcript user rows. */
function committedUserRowCount(app: App, cardId: CardId): Promise<number> {
  return app.evalJS<number>(
    `document.querySelectorAll(
      '[data-card-id="${cardId}"] [data-testid="tide-card-transcript-user-body"]').length`,
  );
}

/** Wait until card `cardId`'s submit button reaches `mode`. */
async function waitForSubmitMode(
  app: App,
  cardId: CardId,
  mode: string,
): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var el = document.querySelector(
        '[data-card-id="${cardId}"] .tug-prompt-entry-submit-button');
      return el !== null && el.getAttribute("data-mode") === ${JSON.stringify(mode)};
    })()`,
    { timeoutMs: 5000 },
  );
}

// ---------------------------------------------------------------------------
// Mount — seed the deck, bind every card's session, wait for the
// status rows to paint.
// ---------------------------------------------------------------------------

async function mountAllCards(app: App): Promise<void> {
  await app.enableDeckTrace(true);
  await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
  for (const id of CARD_IDS) {
    await app.waitForCondition<boolean>(
      `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("${id}")`,
    );
    await app.bindTideSession(id, { tugSessionId: sessionIdFor(id) });
  }
  // Each card's Z2 status row paints once `TideCardBody` mounts.
  for (const id of CARD_IDS) {
    await app.waitForCondition<boolean>(
      `document.querySelector(
        '[data-card-id="${id}"] [data-slot="tide-telemetry-status-row"]') !== null`,
      { timeoutMs: 8000 },
    );
  }
}

// ---------------------------------------------------------------------------
// The matrix sweep
// ---------------------------------------------------------------------------

describe.skipIf(!SHOULD_RUN)(
  "AT0084: tide-card lifecycle state-to-zone matrix",
  () => {
    test(
      "every distinct matrix row paints the zones the matrix specifies",
      async () => {
        const app = await launchTugApp({
          testName: "at0084-tide-lifecycle-coordination",
        });
        try {
          await mountAllCards(app);

          // --- Card A: IDLE → STREAMING → TOOL_WORK → COMPLETE -------
          // IDLE — a freshly-bound card, no turn, empty transcript.
          expect(
            await submitButtonMode(app, "A"),
            "IDLE: Z5 is an enabled Submit",
          ).toBe("submit");
          expect(
            await stateCellLabel(app, "A"),
            "IDLE: Z2 STATE cell reads Idle",
          ).toBe("Idle");

          // STREAMING — a submit plus two text deltas (the count ladder
          // `submitting → awaiting_first_token → streaming`).
          await app.driveTideSession("A", { op: "send", text: "hello" });
          await app.driveTideSession("A", {
            op: "ingestFrame",
            feedId: FEED_CODE_OUTPUT,
            decoded: assistantText("A", "msg-A", "Hel", 0),
          });
          await app.driveTideSession("A", {
            op: "ingestFrame",
            feedId: FEED_CODE_OUTPUT,
            decoded: assistantText("A", "msg-A", "Hello", 1),
          });
          await waitForSubmitMode(app, "A", "stop");
          expect(
            await stateCellLabel(app, "A"),
            "STREAMING: Z2 STATE cell reads Streaming",
          ).toBe("Streaming");

          // TOOL_WORK — a tool_use on the running turn.
          await app.driveTideSession("A", {
            op: "ingestFrame",
            feedId: FEED_CODE_OUTPUT,
            decoded: toolUse("A", "msg-A", "Bash"),
          });
          await app.waitForCondition<boolean>(
            `(function(){
              var c = document.querySelector(
                '[data-card-id="A"] [data-priority="state"] .tide-telemetry-status-value');
              return c !== null && c.textContent === "Working";
            })()`,
            { timeoutMs: 5000 },
          );
          expect(
            await submitButtonMode(app, "A"),
            "TOOL_WORK: Z5 is still Stop",
          ).toBe("stop");

          // COMPLETE — turn_complete(success) commits the turn.
          await app.driveTideSession("A", {
            op: "ingestFrame",
            feedId: FEED_CODE_OUTPUT,
            decoded: turnCompleteSuccess("A", "msg-A"),
          });
          await waitForSubmitMode(app, "A", "submit");
          expect(
            await stateCellLabel(app, "A"),
            "COMPLETE: Z2 STATE cell returns to Idle",
          ).toBe("Idle");
          expect(
            await committedUserRowCount(app, "A"),
            "COMPLETE: Z1 — one committed turn in the transcript",
          ).toBe(1);

          // --- Card B: AWAITING_USER --------------------------------
          await app.driveTideSession("B", { op: "send", text: "run a tool" });
          await app.driveTideSession("B", {
            op: "ingestFrame",
            feedId: FEED_CODE_OUTPUT,
            decoded: controlRequestForward("B"),
          });
          await waitForSubmitMode(app, "B", "awaiting-user");
          expect(
            await stateCellLabel(app, "B"),
            "AWAITING_USER: Z2 STATE cell reads Awaiting",
          ).toBe("Awaiting");

          // --- Card C: QUEUED_NEXT_TURN -----------------------------
          // A submit, one delta to reach a live phase, then a mid-turn
          // submit — which queues and paints a transcript ghost row.
          await app.driveTideSession("C", { op: "send", text: "first" });
          await app.driveTideSession("C", {
            op: "ingestFrame",
            feedId: FEED_CODE_OUTPUT,
            decoded: assistantText("C", "msg-C", "working", 0),
          });
          await app.driveTideSession("C", {
            op: "send",
            text: "queued follow-up",
          });
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(
              '[data-card-id="C"] [data-slot="tide-transcript-ghost-row"]').length === 1`,
            { timeoutMs: 5000 },
          );
          expect(
            await ghostRowCount(app, "C"),
            "QUEUED_NEXT_TURN: one ghost row for the queued send",
          ).toBe(1);
          expect(
            await submitButtonMode(app, "C"),
            "QUEUED_NEXT_TURN: the primary Z5 button stays Stop",
          ).toBe("stop");

          // --- Card D: ERRORED --------------------------------------
          await app.driveTideSession("D", {
            op: "ingestFrame",
            feedId: FEED_CODE_OUTPUT,
            decoded: wireError("D"),
          });
          await app.waitForCondition<boolean>(
            `(function(){
              var c = document.querySelector(
                '[data-card-id="D"] [data-priority="state"] .tide-telemetry-status-value');
              return c !== null && c.textContent === "Error";
            })()`,
            { timeoutMs: 5000 },
          );
          expect(
            await submitButtonMode(app, "D"),
            "ERRORED: Z5 is an enabled Submit (the user may retry)",
          ).toBe("submit");

          // --- Card E: REPLAYING ------------------------------------
          await app.driveTideSession("E", {
            op: "ingestFrame",
            feedId: FEED_CODE_OUTPUT,
            decoded: replayStarted("E"),
          });
          await waitForSubmitMode(app, "E", "restoring");
          expect(
            await stateCellLabel(app, "E"),
            "REPLAYING: Z2 STATE cell reads Replaying",
          ).toBe("Replaying");

          // --- Card F: TRANSPORT_DOWN -------------------------------
          // The wire goes offline on an idle card: Z5 becomes the inert
          // Reconnecting mode, overriding the base state.
          await app.driveTideSession("F", { op: "transportClose" });
          await waitForSubmitMode(app, "F", "reconnecting");
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
