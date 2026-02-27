/**
 * ConversationCard React component tests — Step 8.3
 *
 * Covers:
 * - Renders message input area with send button
 * - Typing a message and clicking send dispatches the correct event
 * - Incoming assistant text messages render in the message list
 * - Tool use/result events render tool cards inline
 * - Approval requests render the approval prompt
 * - Questions render the question card
 * - Streaming indicator shows during active turns
 * - Session cache restores messages on mount
 * - Live meta update: conversation title change triggers immediate CardHeader title update
 */

// fake-indexeddb MUST be imported before setup-test-dom so global.indexedDB is
// available when the SessionCache module initialises on first import.
// Also assign fakeIndexedDB directly to global in case another test file in
// the same bun worker already set global.window before this file runs, which
// causes fake-indexeddb/auto to target window instead of global.
import fakeIndexedDB from "fake-indexeddb";
import "fake-indexeddb/auto";

(global as unknown as Record<string, unknown>).indexedDB = fakeIndexedDB;

import "./setup-test-dom";

import { describe, it, expect } from "bun:test";
import { render, fireEvent, act, waitFor } from "@testing-library/react";
import React from "react";
import { ConversationCard } from "./conversation-card";
import { CardContext, type CardContextValue } from "../../../cards/card-context";
import { FeedId } from "../../../protocol";
import type { IDragState } from "../../../drag-state";
import type { TugCardMeta } from "../../../cards/card";
import type {
  AssistantText,
  ToolUse,
  ToolApprovalRequest,
  Question,
} from "../../../cards/conversation/types";

// ---- Helpers ----

function encodeEvent(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

interface MockContextOptions {
  feedPayload?: Uint8Array;
  onDispatch?: (feedId: number, payload: Uint8Array) => void;
  onUpdateMeta?: (meta: TugCardMeta) => void;
}

function makeMockContext(opts: MockContextOptions = {}): CardContextValue {
  const feedData = new Map<number, Uint8Array>();
  if (opts.feedPayload) {
    feedData.set(FeedId.CODE_OUTPUT, opts.feedPayload);
  }

  return {
    connection: null,
    feedData,
    dimensions: { width: 800, height: 600 },
    dragState: null,
    dispatch: opts.onDispatch ?? (() => {}),
    updateMeta: opts.onUpdateMeta ?? (() => {}),
  };
}

function renderCard(ctx: CardContextValue) {
  const result = render(
    <CardContext.Provider value={ctx}>
      <ConversationCard />
    </CardContext.Provider>
  );
  return result;
}

// ---- Tests ----

describe("ConversationCard – renders input area", () => {
  it("renders message input textarea", async () => {
    const { container, unmount } = renderCard(makeMockContext());
    await act(async () => {});

    const input = container.querySelector("[data-testid='message-input']");
    expect(input).not.toBeNull();
    unmount();
  });

  it("renders send button", async () => {
    const { container, unmount } = renderCard(makeMockContext());
    await act(async () => {});

    const sendBtn = container.querySelector("[data-testid='send-button']");
    expect(sendBtn).not.toBeNull();
    expect(sendBtn?.getAttribute("aria-label")).toBe("Send message");
    unmount();
  });

  it("send button shows 'Stop generation' label when turn is active", async () => {
    const { container, unmount } = renderCard(makeMockContext());
    await act(async () => {});

    const input = container.querySelector(
      "[data-testid='message-input']"
    ) as HTMLTextAreaElement;
    const sendBtn = container.querySelector(
      "[data-testid='send-button']"
    ) as HTMLButtonElement;

    // Set value directly on uncontrolled textarea, then click send
    input.value = "Hello";
    await act(async () => { fireEvent.click(sendBtn); });

    expect(sendBtn.getAttribute("aria-label")).toBe("Stop generation");
    unmount();
  });
});

describe("ConversationCard – sending messages", () => {
  it("dispatches user_message event when send is clicked", async () => {
    const dispatched: { feedId: number; payload: Uint8Array }[] = [];
    const ctx = makeMockContext({
      onDispatch: (feedId, payload) => dispatched.push({ feedId, payload }),
    });

    const { container, unmount } = renderCard(ctx);
    await act(async () => {});

    const input = container.querySelector(
      "[data-testid='message-input']"
    ) as HTMLTextAreaElement;
    const sendBtn = container.querySelector(
      "[data-testid='send-button']"
    ) as HTMLButtonElement;

    // Set value directly on uncontrolled textarea
    input.value = "Hello assistant";
    await act(async () => { fireEvent.click(sendBtn); });

    expect(dispatched.length).toBe(1);
    expect(dispatched[0].feedId).toBe(FeedId.CODE_INPUT);
    const msg = JSON.parse(new TextDecoder().decode(dispatched[0].payload));
    expect(msg.type).toBe("user_message");
    expect(msg.text).toBe("Hello assistant");
    unmount();
  });

  it("clears input after sending", async () => {
    const { container, unmount } = renderCard(makeMockContext());
    await act(async () => {});

    const input = container.querySelector(
      "[data-testid='message-input']"
    ) as HTMLTextAreaElement;
    const sendBtn = container.querySelector(
      "[data-testid='send-button']"
    ) as HTMLButtonElement;

    // Set value directly on uncontrolled textarea
    input.value = "My message";
    await act(async () => { fireEvent.click(sendBtn); });

    expect(input.value).toBe("");
    unmount();
  });

  it("adds user message to the message list", async () => {
    const { container, unmount } = renderCard(makeMockContext());
    await act(async () => {});

    const input = container.querySelector(
      "[data-testid='message-input']"
    ) as HTMLTextAreaElement;
    const sendBtn = container.querySelector(
      "[data-testid='send-button']"
    ) as HTMLButtonElement;

    // Set value directly on uncontrolled textarea
    input.value = "Test message";
    await act(async () => { fireEvent.click(sendBtn); });

    const userMsg = container.querySelector("[data-testid='user-message']");
    expect(userMsg).not.toBeNull();
    expect(userMsg?.textContent).toContain("Test message");
    unmount();
  });
});

describe("ConversationCard – incoming assistant messages", () => {
  it("renders assistant text from feed payload", async () => {
    const event: AssistantText = {
      type: "assistant_text",
      msg_id: "msg-1",
      seq: 0,
      rev: 0,
      text: "Hello from assistant",
      is_partial: false,
      status: "complete",
    };

    const ctx = makeMockContext({ feedPayload: encodeEvent(event) });
    const { container, unmount } = renderCard(ctx);
    await act(async () => {});

    await waitFor(() => {
      expect(container.querySelector("[data-testid='assistant-message']")).not.toBeNull();
    });

    expect(container.textContent).toContain("Hello from assistant");
    unmount();
  });

  it("shows streaming indicator for partial messages", async () => {
    const event: AssistantText = {
      type: "assistant_text",
      msg_id: "msg-stream",
      seq: 0,
      rev: 0,
      text: "Partial...",
      is_partial: true,
      status: "partial",
    };

    const ctx = makeMockContext({ feedPayload: encodeEvent(event) });
    const { container, unmount } = renderCard(ctx);
    await act(async () => {});

    await waitFor(() => {
      const indicator = container.querySelector("[data-testid='streaming-indicator']");
      expect(indicator).not.toBeNull();
    });
    unmount();
  });
});

describe("ConversationCard – tool cards", () => {
  it("renders a tool card when tool_use event arrives", async () => {
    const event: ToolUse = {
      type: "tool_use",
      msg_id: "msg-2",
      seq: 0,
      tool_name: "Bash",
      tool_use_id: "tu-001",
      input: { command: "ls" },
    };

    const ctx = makeMockContext({ feedPayload: encodeEvent(event) });
    const { container, unmount } = renderCard(ctx);
    await act(async () => {});

    await waitFor(() => {
      const toolCard = container.querySelector("[data-testid='tool-card']");
      expect(toolCard).not.toBeNull();
    });

    expect(container.textContent).toContain("Bash");
    unmount();
  });
});

describe("ConversationCard – approval prompt", () => {
  it("renders approval prompt for tool_approval_request event", async () => {
    const event: ToolApprovalRequest = {
      type: "tool_approval_request",
      request_id: "req-001",
      tool_name: "Write",
      input: { file_path: "/tmp/test.txt", content: "hello" },
    };

    const ctx = makeMockContext({ feedPayload: encodeEvent(event) });
    const { container, unmount } = renderCard(ctx);
    await act(async () => {});

    await waitFor(() => {
      expect(container.textContent).toContain("requires approval");
    });

    expect(container.textContent).toContain("Write");
    unmount();
  });
});

describe("ConversationCard – question card", () => {
  it("renders question card for question event", async () => {
    const event: Question = {
      type: "question",
      request_id: "qr-001",
      questions: [
        {
          id: "q1",
          text: "What framework?",
          type: "single_choice",
          options: [{ label: "React" }, { label: "Vue" }],
        },
      ],
    };

    const ctx = makeMockContext({ feedPayload: encodeEvent(event) });
    const { container, unmount } = renderCard(ctx);
    await act(async () => {});

    await waitFor(() => {
      expect(container.textContent).toContain("What framework?");
    });
    unmount();
  });
});

describe("ConversationCard – streaming indicator", () => {
  it("shows streaming indicator when a partial assistant_text message arrives", async () => {
    const event: AssistantText = {
      type: "assistant_text",
      msg_id: "msg-stream",
      seq: 0,
      rev: 0,
      text: "Working...",
      is_partial: true,
      status: "partial",
    };

    const ctx = makeMockContext({ feedPayload: encodeEvent(event) });
    const { container, unmount } = renderCard(ctx);
    await act(async () => {});

    await waitFor(() => {
      const indicator = container.querySelector("[data-testid='streaming-indicator']");
      expect(indicator).not.toBeNull();
    });

    unmount();
  });

  it("shows streaming indicator when user sends a message (turn starts)", async () => {
    const { container, unmount } = renderCard(makeMockContext());
    await act(async () => {});

    const input = container.querySelector(
      "[data-testid='message-input']"
    ) as HTMLTextAreaElement;
    const sendBtn = container.querySelector(
      "[data-testid='send-button']"
    ) as HTMLButtonElement;

    input.value = "Hello";
    await act(async () => { fireEvent.click(sendBtn); });

    // Streaming indicator should appear since turn is active
    const indicator = container.querySelector("[data-testid='streaming-indicator']");
    expect(indicator).not.toBeNull();

    unmount();
  });
});

describe("ConversationCard – meta update", () => {
  it("calls updateMeta with project title when project_info arrives", async () => {
    const metaUpdates: TugCardMeta[] = [];
    const event = {
      type: "project_info",
      project_dir: "/home/user/myproject",
    };

    const ctx = makeMockContext({
      feedPayload: encodeEvent(event),
      onUpdateMeta: (meta) => metaUpdates.push(meta),
    });

    const { unmount } = renderCard(ctx);
    await act(async () => {});

    // Give time for async hash computation
    await waitFor(() => {
      const hasTitleUpdate = metaUpdates.some(
        (m) => typeof m.title === "string" && m.title.includes("CODE:")
      );
      expect(hasTitleUpdate).toBe(true);
    }, { timeout: 3000 });

    unmount();
  });
});
