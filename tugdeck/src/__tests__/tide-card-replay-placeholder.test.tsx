/**
 * TideCardServicesGate — replay placeholder rendering (Step 4 of
 * tugplan-tide-transcript-resume).
 *
 * Drives a real `CodeSessionStore` through the JSONL replay window
 * via `replay_started` / `turn_complete` / `replay_complete`
 * CODE_OUTPUT events on a `TestFrameChannel`, then asserts the gate
 * routes between `TideCardBody` and the `TideRestoring` placeholder
 * with the right variant + copy at each beat:
 *
 *   - Phase enters `replaying` → "Loading conversation…" placeholder.
 *   - After REPLAY_SOFT_BUDGET_MS held in `replaying` →
 *     "Loading conversation… (N turns)" with the live transcript count.
 *   - `replay_complete` (success) → placeholder dismisses, body mounts.
 *   - `replay_complete` with `error.kind === "replay_timeout"` →
 *     timeout copy briefly, then dismisses after
 *     REPLAY_TIMEOUT_DWELL_MS.
 *
 * Mirrors the harness setup in `tide-card-transport-state.test.tsx`:
 * connection-singleton + connection-lifecycle mocked so the
 * module-scope `cardServicesStore` constructs real services against a
 * TestFrameChannel we can drive directly.
 */
import "./setup-rtl";

import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect, afterEach, beforeAll, mock } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { initSync } from "../../crates/tugmark-wasm/pkg/tugmark_wasm.js";
import { TestFrameChannel } from "@/lib/code-session-store/testing/mock-feed-store";

// `TugMarkdownBlock` (rendered in the committed transcript when the
// gate flips back to `TideCardBody`) uses the markdown pipeline
// backed by `tugmark-wasm`. The synchronous init must run before the
// first render, otherwise calls into the wasm exports throw.
const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const wasmPath = join(
  __dir,
  "../../crates/tugmark-wasm/pkg/tugmark_wasm_bg.wasm",
);
beforeAll(() => {
  const wasmBytes = readFileSync(wasmPath);
  initSync({ module: wasmBytes });
});

const mockConnection = new TestFrameChannel();

mock.module("@/lib/connection-singleton", () => ({
  getConnection: () => mockConnection,
  setConnection: () => {},
}));

import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
const sharedLifecycle = new ConnectionLifecycle();
mock.module("@/lib/connection-lifecycle", () => ({
  ConnectionLifecycle,
  getConnectionLifecycle: () => sharedLifecycle,
  registerConnectionLifecycle: () => {},
}));

const fakeTugbank = {
  get(_domain: string, _key: string) {
    return undefined;
  },
  readDomain(_domain: string) {
    return undefined;
  },
  onDomainChanged(_cb: (domain: string) => void) {
    return () => {};
  },
};
mock.module("@/lib/tugbank-singleton", () => ({
  getTugbankClient: () => fakeTugbank,
  setTugbankClient: () => {},
}));

import * as actualSettingsApi from "@/settings-api";
mock.module("@/settings-api", () => ({
  ...actualSettingsApi,
  putTideRecentProjects: () => {},
}));

import { TideCardContent } from "@/components/tugways/cards/tide-card";
import {
  cardSessionBindingStore,
  type CardSessionBinding,
} from "@/lib/card-session-binding-store";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { TugPanePortalContext } from "@/components/chrome/tug-pane";
import { cardServicesStore } from "@/lib/card-services-store";
import { FeedId } from "@/protocol";

const CARD_ID = "tide-replay-placeholder-test";
const SESSION_ID = "sess-replay-placeholder-1";
const PROJECT_DIR = "/work/replay-fixture";
const IPC_VERSION = 2;

function makeBinding(overrides: Partial<CardSessionBinding> = {}): CardSessionBinding {
  return {
    tugSessionId: SESSION_ID,
    workspaceKey: PROJECT_DIR,
    projectDir: PROJECT_DIR,
    sessionMode: "resume",
    ...overrides,
  };
}

function renderTideCard(cardId: string) {
  const cardEl = document.createElement("div");
  cardEl.className = "tug-pane-chrome";
  const cardBody = document.createElement("div");
  cardBody.className = "tug-pane-body";
  cardEl.appendChild(cardBody);
  document.body.appendChild(cardEl);

  return render(
    <ResponderChainProvider>
      <TugPanePortalContext value={cardEl}>
        <TideCardContent cardId={cardId} />
      </TugPanePortalContext>
    </ResponderChainProvider>,
  );
}

/** Dispatch a decoded CODE_OUTPUT event with `tug_session_id`
 * stamped on. The store filters by session id so the stamp must
 * match the binding's `tugSessionId`. */
function emitCodeOutput(evt: Record<string, unknown>): void {
  mockConnection.dispatchDecoded(FeedId.CODE_OUTPUT, {
    ...evt,
    tug_session_id: SESSION_ID,
  });
}

function replayStarted(): Record<string, unknown> {
  return { type: "replay_started", ipc_version: IPC_VERSION };
}
function userMessageReplay(msgId: string, text: string): Record<string, unknown> {
  return {
    type: "user_message_replay",
    msg_id: msgId,
    text,
    attachments: [],
    ipc_version: IPC_VERSION,
  };
}
function assistantText(msgId: string, text: string): Record<string, unknown> {
  return {
    type: "assistant_text",
    msg_id: msgId,
    seq: 0,
    rev: 0,
    text,
    is_partial: false,
    status: "complete",
    ipc_version: IPC_VERSION,
  };
}
function turnComplete(msgId: string, result: "success" | "error" = "success"): Record<string, unknown> {
  return {
    type: "turn_complete",
    msg_id: msgId,
    seq: 0,
    result,
    ipc_version: IPC_VERSION,
  };
}
function replayComplete(
  count: number,
  error?: {
    kind: "jsonl_missing" | "jsonl_unreadable" | "jsonl_malformed" | "replay_timeout";
    message: string;
  },
): Record<string, unknown> {
  return error
    ? { type: "replay_complete", count, error, ipc_version: IPC_VERSION }
    : { type: "replay_complete", count, ipc_version: IPC_VERSION };
}

/** Commit one whole replayed turn end-to-end. */
function commitReplayedTurn(msgId: string, text: string): void {
  emitCodeOutput(userMessageReplay(msgId, text));
  emitCodeOutput(assistantText(msgId, `reply for ${text}`));
  emitCodeOutput(turnComplete(msgId, "success"));
}

afterEach(() => {
  cleanup();
  cardSessionBindingStore.clearBinding(CARD_ID);
  document.querySelectorAll(".tug-pane-chrome").forEach((el) => el.remove());
});

describe("TideCardServicesGate — replay placeholder", () => {
  it("phase=replaying renders TideRestoring with the loading copy and no count", () => {
    const { queryByTestId } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });
    expect(queryByTestId("tide-card")).not.toBeNull();

    act(() => {
      emitCodeOutput(replayStarted());
    });

    const placeholder = queryByTestId("tide-card-restoring");
    expect(placeholder).not.toBeNull();
    expect(placeholder!.getAttribute("data-variant")).toBe("replay-loading");
    // Pre soft-budget: the title shows the plain loading copy without
    // a count suffix.
    expect(queryByTestId("tide-card-restoring-title")?.textContent).toBe(
      "Loading conversation…",
    );
    // No Cancel button on the replay variant.
    expect(queryByTestId("tide-card-restoring-cancel")).toBeNull();
    // Project label rides through.
    expect(queryByTestId("tide-card-restoring-project")?.textContent).toBe(
      PROJECT_DIR,
    );
    // The body is hidden while replaying.
    expect(queryByTestId("tide-card")).toBeNull();

    const services = cardServicesStore.getServices(CARD_ID);
    expect(services?.codeSessionStore.getSnapshot().phase).toBe("replaying");
  });

  it("after the soft-budget elapses, the title gains a '(N turns)' count", async () => {
    const { queryByTestId } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });

    // Enter `replaying` and commit a few turns. The reducer commits
    // each replayed `turn_complete` to `transcript`, so by the time
    // the soft-budget timer fires, transcript.length is the count
    // the placeholder should surface.
    act(() => {
      emitCodeOutput(replayStarted());
      commitReplayedTurn("msg-1", "first user prompt");
      commitReplayedTurn("msg-2", "second user prompt");
      commitReplayedTurn("msg-3", "third user prompt");
    });

    // Soft budget is REPLAY_SOFT_BUDGET_MS = 2000ms. Wait a bit past
    // it to let the timer fire and the gate re-render.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2100));
    });

    expect(queryByTestId("tide-card-restoring")).not.toBeNull();
    expect(queryByTestId("tide-card-restoring-title")?.textContent).toBe(
      "Loading conversation… (3 turns)",
    );
  }, 8_000);

  it("singular '(1 turn)' is grammatical", async () => {
    const { queryByTestId } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });
    act(() => {
      emitCodeOutput(replayStarted());
      commitReplayedTurn("msg-only", "the one prompt");
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 2100));
    });

    expect(queryByTestId("tide-card-restoring-title")?.textContent).toBe(
      "Loading conversation… (1 turn)",
    );
  }, 8_000);

  it("replay_complete (success) dismisses the placeholder; body mounts in the same render", () => {
    const { queryByTestId } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });
    act(() => {
      emitCodeOutput(replayStarted());
      commitReplayedTurn("msg-1", "first prompt");
    });
    expect(queryByTestId("tide-card-restoring")).not.toBeNull();
    expect(queryByTestId("tide-card")).toBeNull();

    act(() => {
      emitCodeOutput(replayComplete(1));
    });

    expect(queryByTestId("tide-card-restoring")).toBeNull();
    expect(queryByTestId("tide-card")).not.toBeNull();

    const services = cardServicesStore.getServices(CARD_ID);
    expect(services?.codeSessionStore.getSnapshot().phase).toBe("idle");
    expect(services?.codeSessionStore.getSnapshot().lastReplayResult?.kind).toBe(
      "success",
    );
  });

  it("replay_complete with replay_timeout shows the timeout copy briefly, then dismisses", async () => {
    const { queryByTestId } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });
    act(() => {
      emitCodeOutput(replayStarted());
      // Some turns may have committed before timeout — they stay in
      // transcript but the card surfaces the timeout copy on top.
      commitReplayedTurn("msg-partial", "early prompt");
    });
    expect(queryByTestId("tide-card-restoring")).not.toBeNull();

    act(() => {
      emitCodeOutput(
        replayComplete(1, {
          kind: "replay_timeout",
          message: "replay exceeded budget",
        }),
      );
    });

    // Phase is now `idle` but the dwell timer holds the placeholder
    // in the timeout-copy variant.
    const placeholder = queryByTestId("tide-card-restoring");
    expect(placeholder).not.toBeNull();
    expect(placeholder!.getAttribute("data-variant")).toBe("replay-timeout");
    expect(queryByTestId("tide-card-restoring-title")?.textContent).toBe(
      "Conversation history unavailable; resuming with empty transcript",
    );
    // No spinner or Cancel button on the timeout variant.
    expect(queryByTestId("tide-card-restoring-cancel")).toBeNull();
    expect(
      placeholder!.querySelector(".tide-card-restoring-spinner"),
    ).toBeNull();

    // Dwell is REPLAY_TIMEOUT_DWELL_MS = 1500ms.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1700));
    });

    expect(queryByTestId("tide-card-restoring")).toBeNull();
    expect(queryByTestId("tide-card")).not.toBeNull();
  }, 8_000);

  it("replay_complete with non-timeout error skips the dwell and dismisses immediately", () => {
    // jsonl_missing / jsonl_unreadable shouldn't hold the user on a
    // "Loading…" screen — the bracket dismisses to the empty live
    // transcript right away. Only `replay_timeout` gets the dwell.
    const { queryByTestId } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });
    act(() => {
      emitCodeOutput(replayStarted());
    });
    expect(queryByTestId("tide-card-restoring")).not.toBeNull();

    act(() => {
      emitCodeOutput(
        replayComplete(0, {
          kind: "jsonl_missing",
          message: "JSONL not found",
        }),
      );
    });

    expect(queryByTestId("tide-card-restoring")).toBeNull();
    expect(queryByTestId("tide-card")).not.toBeNull();
  });
});
