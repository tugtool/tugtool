/**
 * tide-card-resume.test.tsx — Step 5 of tugplan-tide-transcript-resume.
 *
 * End-to-end integration of the resume → replay → live-submit
 * pipeline at the tugdeck side: a real `CodeSessionStore` driven via
 * a `TestFrameChannel`, mounted under a real `TideCardContent`.
 * Replay frames flow through the store; the gate routes to the
 * replay placeholder; the placeholder dismisses on `replay_complete`;
 * the transcript renders the committed turns; a live submit after
 * replay flows through the normal turn lifecycle.
 *
 * Coverage:
 *   - Full resume: replay 3-turn fixture; transcript renders all three.
 *   - Missing JSONL: bracket pair with `error.kind = "jsonl_missing"`;
 *     transcript stays empty; card remains interactive.
 *   - Orphan turn synthesis ([D08]): a `turn_complete(error)` lands
 *     during replay; transcript carries the orphan as
 *     `result === "interrupted"`.
 *   - Live submit after replay: `phase` returns to `idle`,
 *     `canSubmit === true`, the new turn flows through `send` and
 *     commits with the live wire shape.
 *   - Submit gating during replay: while `phase === "replaying"`,
 *     `canSubmit === false` and the prompt entry's submit button is
 *     `disabled` ([D11]).
 *
 * Harness mirrors `tide-card-replay-placeholder.test.tsx` and
 * `tide-card-transport-state.test.tsx`: connection + lifecycle +
 * tugbank singletons mocked so the module-scope `cardServicesStore`
 * constructs real services we can drive directly. Markdown rendering
 * inside committed transcript rows uses `tugmark-wasm`, which must
 * be `initSync`'d before the first render.
 */
import "./setup-rtl";

import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect, afterEach, beforeAll, mock } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { initSync } from "../../crates/tugmark-wasm/pkg/tugmark_wasm.js";
import { TestFrameChannel } from "@/lib/code-session-store/testing/mock-feed-store";

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
  get(_d: string, _k: string) {
    return undefined;
  },
  readDomain(_d: string) {
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

const CARD_ID = "tide-card-resume-test";
const SESSION_ID = "sess-resume-test-1";
const PROJECT_DIR = "/work/resume-fixture";
const IPC_VERSION = 2;

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
function turnComplete(
  msgId: string,
  result: "success" | "error" = "success",
): Record<string, unknown> {
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

function commitReplayedTurn(msgId: string, userText: string, replyText: string): void {
  emitCodeOutput(userMessageReplay(msgId, userText));
  emitCodeOutput(assistantText(msgId, replyText));
  emitCodeOutput(turnComplete(msgId, "success"));
}

afterEach(() => {
  cleanup();
  cardSessionBindingStore.clearBinding(CARD_ID);
  document.querySelectorAll(".tug-pane-chrome").forEach((el) => el.remove());
});

describe("Tide card — resume integration", () => {
  it("full resume → 3-turn transcript renders after replay_complete", () => {
    const { queryByTestId } = renderTideCard(CARD_ID);
    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });

    act(() => {
      emitCodeOutput(replayStarted());
      commitReplayedTurn("msg-r1", "first user prompt", "first assistant reply");
      commitReplayedTurn("msg-r2", "second user prompt", "second assistant reply");
      commitReplayedTurn("msg-r3", "third user prompt", "third assistant reply");
      emitCodeOutput(replayComplete(3));
    });

    // Placeholder dismissed; body mounted.
    expect(queryByTestId("tide-card-restoring")).toBeNull();
    expect(queryByTestId("tide-card")).not.toBeNull();

    const services = cardServicesStore.getServices(CARD_ID);
    const snap = services!.codeSessionStore.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.transcript).toHaveLength(3);
    expect(snap.transcript.map((t) => t.msgId)).toEqual([
      "msg-r1",
      "msg-r2",
      "msg-r3",
    ]);
    expect(snap.transcript.every((t) => t.result === "success")).toBe(true);
    expect(snap.lastReplayResult?.kind).toBe("success");
  });

  it("missing JSONL → empty transcript, lastReplayResult.kind=jsonl_missing, card stays functional", () => {
    const { queryByTestId } = renderTideCard(CARD_ID);
    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });

    act(() => {
      emitCodeOutput(replayStarted());
      emitCodeOutput(
        replayComplete(0, {
          kind: "jsonl_missing",
          message: "JSONL not found",
        }),
      );
    });

    expect(queryByTestId("tide-card-restoring")).toBeNull();
    expect(queryByTestId("tide-card")).not.toBeNull();

    const services = cardServicesStore.getServices(CARD_ID);
    const snap = services!.codeSessionStore.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.transcript).toHaveLength(0);
    expect(snap.lastReplayResult?.kind).toBe("jsonl_missing");
    // Card is interactive: canSubmit gated only by online + idle.
    expect(snap.transportState).toBe("online");
    expect(snap.canSubmit).toBe(true);
  });

  it("orphan-turn JSONL → transcript carries the orphan as result='interrupted' [D08]", () => {
    renderTideCard(CARD_ID);
    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });

    // Two clean turns, then a third that the JSONL translator
    // synthesized as an orphan because the JSONL ended mid-turn.
    // The reducer treats a `turn_complete(error)` during replay the
    // same as a live interrupt — `TurnEntry.result === "interrupted"`.
    act(() => {
      emitCodeOutput(replayStarted());
      commitReplayedTurn("msg-ok-1", "hello", "hi back");
      commitReplayedTurn("msg-ok-2", "follow up", "more reply");
      // Orphan: user submission preserved, partial assistant text,
      // terminal turn_complete carries result=error.
      emitCodeOutput(userMessageReplay("msg-orphan", "long question…"));
      emitCodeOutput(
        assistantText(
          "msg-orphan",
          "starting on it but reload truncated",
        ),
      );
      emitCodeOutput(turnComplete("msg-orphan", "error"));
      emitCodeOutput(replayComplete(3));
    });

    const services = cardServicesStore.getServices(CARD_ID);
    const snap = services!.codeSessionStore.getSnapshot();
    expect(snap.transcript).toHaveLength(3);
    expect(snap.transcript[0].result).toBe("success");
    expect(snap.transcript[1].result).toBe("success");
    expect(snap.transcript[2].result).toBe("interrupted");
    expect(snap.transcript[2].userMessage.text).toBe("long question…");
    expect(snap.transcript[2].assistant).toBe(
      "starting on it but reload truncated",
    );
  });

  it("live submit after replay_complete flows through the normal turn lifecycle", () => {
    renderTideCard(CARD_ID);
    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });

    act(() => {
      emitCodeOutput(replayStarted());
      commitReplayedTurn("msg-r1", "prior prompt", "prior reply");
      emitCodeOutput(replayComplete(1));
    });

    const services = cardServicesStore.getServices(CARD_ID);
    const store = services!.codeSessionStore;
    expect(store.getSnapshot().phase).toBe("idle");
    expect(store.getSnapshot().canSubmit).toBe(true);

    // Live submit. The store transitions out of `idle`, mirrors the
    // submission to `pendingUserMessage`, and waits for the wire to
    // deliver the assistant's `msg_id` on the first text frame.
    act(() => {
      store.send("a brand new prompt", []);
    });
    expect(store.getSnapshot().phase).not.toBe("idle");
    expect(store.getSnapshot().inflightUserMessage?.text).toBe(
      "a brand new prompt",
    );
    expect(store.getSnapshot().inflightUserMessage?.atoms).toEqual([]);

    // Drive the live wire response with a fresh msg id (claude mints
    // these per turn). The reducer binds `activeMsgId` on the first
    // assistant_text and commits a transcript entry on turn_complete.
    const liveMsgId = "msg-live-1";
    act(() => {
      emitCodeOutput(assistantText(liveMsgId, "the live reply"));
      emitCodeOutput(turnComplete(liveMsgId, "success"));
    });
    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.transcript).toHaveLength(2);
    expect(snap.transcript[1].msgId).toBe(liveMsgId);
    expect(snap.transcript[1].userMessage.text).toBe("a brand new prompt");
    expect(snap.transcript[1].assistant).toBe("the live reply");
    expect(snap.transcript[1].result).toBe("success");
  });

  it("submit button is disabled during replay (canSubmit=false on phase=replaying)", () => {
    const { container } = renderTideCard(CARD_ID);
    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });

    // Pre-replay sanity: idle + online, button is enabled.
    {
      const button = container.querySelector<HTMLButtonElement>(
        ".tug-prompt-entry-submit-button",
      );
      expect(button).not.toBeNull();
      expect(button!.disabled).toBe(false);
    }

    act(() => {
      emitCodeOutput(replayStarted());
    });

    const services = cardServicesStore.getServices(CARD_ID);
    const snap = services!.codeSessionStore.getSnapshot();
    expect(snap.phase).toBe("replaying");
    expect(snap.canSubmit).toBe(false);
    expect(snap.canInterrupt).toBe(false);

    // While `replaying` the gate routes to the placeholder, so the
    // prompt-entry submit button is unmounted entirely. Either form
    // of "user can't submit" is acceptable per the plan; assert both:
    // the button is absent in the DOM, and the snapshot says so.
    expect(
      container.querySelector(".tug-prompt-entry-submit-button"),
    ).toBeNull();
  });
});
