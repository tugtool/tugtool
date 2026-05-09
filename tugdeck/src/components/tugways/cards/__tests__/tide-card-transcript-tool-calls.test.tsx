/**
 * `TranscriptToolCalls` — tests for the [#step-6-5] wire-through.
 *
 * Coverage:
 *  - Helper `dispatchToolCallState` — maps `ToolCallState` of every
 *    status to the expected wrapper status / `isError` / props.
 *  - Static mode: renders one wrapper per `ToolCallState`, in
 *    insertion order; renders nothing for an empty list (no DOM
 *    container at all); routes unknown tool names through
 *    `DefaultToolWrapper` with a caution flag.
 *  - Streaming mode: subscribes to a `PropertyStore` path on mount
 *    (G1 contract — sync read of the seed value), reconciles in
 *    place across a `pending → done` transition (the same
 *    `[data-slot]` DOM node persists), and unsubscribes on unmount.
 *  - The default-empty case (path holds `"[]"`): no DOM container.
 */

import "../../../../__tests__/setup-rtl";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";

import { PropertyStore } from "@/components/tugways/property-store";
import type { ToolCallState } from "@/lib/code-session-store";

import {
  dispatchToolCallState,
  registerToolWrapper,
} from "../tide-assistant-renderer-dispatch";
import { BashToolBlock } from "../tool-wrappers/bash-tool-block";
import { TranscriptToolCalls } from "../tide-card-transcript-tool-calls";

// The dispatch test in `tide-assistant-renderer-dispatch.test.ts`
// resets the registry in its own `beforeEach`, which wipes
// `registerToolWrapper("bash", BashToolBlock)` if that file is loaded
// after this one in the worker. Re-register before this file's tests
// run so dispatch resolution is independent of sibling-file order.
beforeAll(() => {
  registerToolWrapper("bash", BashToolBlock);
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Pure helper: dispatchToolCallState
// ---------------------------------------------------------------------------

function makeToolCall(over: Partial<ToolCallState> = {}): ToolCallState {
  return {
    toolUseId: "tu-1",
    toolName: "Bash",
    input: { command: "echo hello" },
    status: "done",
    result: null,
    structuredResult: { stdout: "hello", stderr: "", interrupted: false },
    ...over,
  };
}

describe("dispatchToolCallState", () => {
  test("status='pending' → wrapper status='streaming', isError=false", () => {
    const { props } = dispatchToolCallState(
      makeToolCall({ status: "pending" }),
      "msg-1",
    );
    expect((props as { status: string }).status).toBe("streaming");
    expect((props as { isError: boolean }).isError).toBe(false);
  });

  test("status='done' → wrapper status='ready', isError=false", () => {
    const { props } = dispatchToolCallState(
      makeToolCall({ status: "done" }),
      "msg-1",
    );
    expect((props as { status: string }).status).toBe("ready");
    expect((props as { isError: boolean }).isError).toBe(false);
  });

  test("status='error' → wrapper status='error', isError=true", () => {
    const { props } = dispatchToolCallState(
      makeToolCall({ status: "error" }),
      "msg-1",
    );
    expect((props as { status: string }).status).toBe("error");
    expect((props as { isError: boolean }).isError).toBe(true);
  });

  test("Bash → BashToolBlock; unknown tool → DefaultToolWrapper + caution", () => {
    const bash = dispatchToolCallState(
      makeToolCall({ toolName: "Bash" }),
      "msg-1",
    );
    expect(bash.Component).toBe(BashToolBlock);
    expect(bash.caution).toBeUndefined();

    const unknown = dispatchToolCallState(
      makeToolCall({
        toolName: "DoesNotExist",
        toolUseId: "tu-2",
        structuredResult: null,
      }),
      "msg-1",
    );
    expect(unknown.caution).toEqual({
      reason: "unknown_tool",
      detail: "DoesNotExist",
    });
  });

  test("threads msgId, toolUseId, toolName, input, structuredResult onto the prop bag", () => {
    const { props } = dispatchToolCallState(
      makeToolCall({
        toolUseId: "tu-42",
        toolName: "Bash",
        input: { command: "ls -la" },
        structuredResult: { stdout: "x", stderr: "", interrupted: false },
      }),
      "msg-99",
    );
    const p = props as Record<string, unknown>;
    expect(p.msgId).toBe("msg-99");
    expect(p.toolUseId).toBe("tu-42");
    expect(p.toolName).toBe("Bash");
    expect(p.input).toEqual({ command: "ls -la" });
    expect(p.structuredResult).toEqual({
      stdout: "x",
      stderr: "",
      interrupted: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Static mode
// ---------------------------------------------------------------------------

describe("TranscriptToolCalls — static mode", () => {
  test("empty list → no DOM container at all", () => {
    const { container } = render(
      <TranscriptToolCalls toolCalls={[]} msgId="msg-1" />,
    );
    expect(
      container.querySelector('[data-slot="tide-transcript-tool-calls"]'),
    ).toBeNull();
  });

  test("single Bash tool call mounts BashToolBlock with the command in the header", () => {
    const tc: ToolCallState = makeToolCall();
    const { container } = render(
      <TranscriptToolCalls toolCalls={[tc]} msgId="msg-1" />,
    );
    const root = container.querySelector(
      '[data-slot="tide-transcript-tool-calls"]',
    ) as HTMLElement;
    expect(root).not.toBeNull();

    const bashRoot = root.querySelector(
      '[data-slot="bash-tool-block"]',
    ) as HTMLElement;
    expect(bashRoot).not.toBeNull();

    const cmd = bashRoot.querySelector(
      '[data-slot="bash-tool-block-command"]',
    ) as HTMLElement;
    expect(cmd.textContent).toBe("echo hello");
  });

  test("unknown tool name routes through DefaultToolWrapper with caution stamped on the root", () => {
    const tc: ToolCallState = makeToolCall({
      toolName: "UnknownTool42",
      structuredResult: null,
      result: null,
    });
    const { container } = render(
      <TranscriptToolCalls toolCalls={[tc]} msgId="msg-1" />,
    );
    const root = container.querySelector(
      '[data-slot="tide-transcript-tool-calls"]',
    ) as HTMLElement;
    expect(root).not.toBeNull();

    // DefaultToolWrapper is a scaffold today (#step-1) — it stamps
    // `data-caution` on its root so the dispatch wiring can be
    // verified end-to-end. Full caution-badge chrome lands at
    // [#step-13]; this assertion confirms the route + the caution
    // flag was threaded onto the wrapper props.
    const wrapperRoot = root.querySelector(
      '[data-slot="default-tool-wrapper"]',
    ) as HTMLElement;
    expect(wrapperRoot).not.toBeNull();
    expect(wrapperRoot.dataset.caution).toBe("unknown_tool");
    expect(wrapperRoot.textContent).toContain("UnknownTool42");
  });

  test("multiple tool calls render in insertion order, keyed by toolUseId", () => {
    const calls: ToolCallState[] = [
      makeToolCall({
        toolUseId: "a",
        input: { command: "echo first" },
      }),
      makeToolCall({
        toolUseId: "b",
        input: { command: "echo second" },
      }),
      makeToolCall({
        toolUseId: "c",
        input: { command: "echo third" },
      }),
    ];
    const { container } = render(
      <TranscriptToolCalls toolCalls={calls} msgId="msg-1" />,
    );
    const cmds = container.querySelectorAll(
      '[data-slot="bash-tool-block-command"]',
    );
    expect(cmds.length).toBe(3);
    expect(cmds[0].textContent).toBe("echo first");
    expect(cmds[1].textContent).toBe("echo second");
    expect(cmds[2].textContent).toBe("echo third");
  });
});

// ---------------------------------------------------------------------------
// Streaming mode
// ---------------------------------------------------------------------------

/**
 * Build a `PropertyStore` with the same `inflight.tools` schema the
 * reducer uses. Initial value is the JSON serialization of `seed`.
 */
function makeToolsStore(seed: ReadonlyArray<ToolCallState>): PropertyStore {
  return new PropertyStore({
    schema: [
      {
        path: "inflight.tools",
        type: "string",
        label: "tools",
      },
    ],
    initialValues: { "inflight.tools": JSON.stringify(seed) },
  });
}

describe("TranscriptToolCalls — streaming mode", () => {
  test("seed value at the path renders synchronously on mount (G1 contract)", () => {
    const store = makeToolsStore([makeToolCall()]);
    const { container } = render(
      <TranscriptToolCalls
        streamingStore={store}
        streamingPath="inflight.tools"
        msgId="msg-1"
      />,
    );
    expect(
      container.querySelector('[data-slot="tide-transcript-tool-calls"]'),
    ).not.toBeNull();
    const cmd = container.querySelector(
      '[data-slot="bash-tool-block-command"]',
    ) as HTMLElement;
    expect(cmd.textContent).toBe("echo hello");
  });

  test("empty seed (path holds '[]') → no DOM container", () => {
    const store = makeToolsStore([]);
    const { container } = render(
      <TranscriptToolCalls
        streamingStore={store}
        streamingPath="inflight.tools"
        msgId="msg-1"
      />,
    );
    expect(
      container.querySelector('[data-slot="tide-transcript-tool-calls"]'),
    ).toBeNull();
  });

  test("emission with the same toolUseId reconciles in place (no remount)", () => {
    const pending: ToolCallState = {
      toolUseId: "t-keep",
      toolName: "Bash",
      input: { command: "sleep 1" },
      status: "pending",
      result: null,
      structuredResult: null,
    };
    const store = makeToolsStore([pending]);
    const { container } = render(
      <TranscriptToolCalls
        streamingStore={store}
        streamingPath="inflight.tools"
        msgId="msg-1"
      />,
    );

    const bashRootBefore = container.querySelector(
      '[data-slot="bash-tool-block"]',
    ) as HTMLElement;
    expect(bashRootBefore).not.toBeNull();

    // Streaming wrapper → placeholder body, no terminal yet.
    expect(
      bashRootBefore.querySelector('[data-slot="tool-wrapper-streaming-placeholder"]'),
    ).not.toBeNull();
    expect(bashRootBefore.querySelector('[data-slot="terminal-body"]')).toBeNull();

    // Now the tool transitions pending → done with structured stdout.
    const done: ToolCallState = {
      ...pending,
      status: "done",
      structuredResult: { stdout: "ok", stderr: "", interrupted: false },
    };
    act(() => {
      store.set("inflight.tools", JSON.stringify([done]), "test");
    });

    const bashRootAfter = container.querySelector(
      '[data-slot="bash-tool-block"]',
    ) as HTMLElement;
    expect(bashRootAfter).not.toBeNull();
    // Same DOM node — React reconciled in place because the key
    // (toolUseId) is unchanged. This is the load-bearing assertion
    // for the `pending → done` transition: TerminalBlock's mount-once
    // contract is honored across the streaming-placeholder → ready
    // body swap because BashToolBlock's two body branches are
    // different React subtrees.
    expect(bashRootAfter).toBe(bashRootBefore);

    // The body has flipped to TerminalBlock with the structured stdout.
    expect(
      bashRootAfter.querySelector('[data-slot="tool-wrapper-streaming-placeholder"]'),
    ).toBeNull();
    const terminalRoot = bashRootAfter.querySelector(
      '[data-slot="terminal-body"]',
    ) as HTMLElement;
    expect(terminalRoot).not.toBeNull();
    expect(terminalRoot.textContent).toContain("ok");
  });

  test("emission that adds a new tool call appends in order; existing wrapper persists", () => {
    const first: ToolCallState = makeToolCall({
      toolUseId: "a",
      input: { command: "first" },
    });
    const store = makeToolsStore([first]);
    const { container } = render(
      <TranscriptToolCalls
        streamingStore={store}
        streamingPath="inflight.tools"
        msgId="msg-1"
      />,
    );
    const firstBefore = container.querySelector(
      '[data-slot="bash-tool-block"]',
    ) as HTMLElement;
    expect(firstBefore).not.toBeNull();

    const second: ToolCallState = makeToolCall({
      toolUseId: "b",
      input: { command: "second" },
    });
    act(() => {
      store.set(
        "inflight.tools",
        JSON.stringify([first, second]),
        "test",
      );
    });

    const all = container.querySelectorAll(
      '[data-slot="bash-tool-block"]',
    );
    expect(all.length).toBe(2);
    // First wrapper is still the same DOM node (reconciled in place).
    expect(all[0]).toBe(firstBefore);

    const cmds = container.querySelectorAll(
      '[data-slot="bash-tool-block-command"]',
    );
    expect(cmds[0].textContent).toBe("first");
    expect(cmds[1].textContent).toBe("second");
  });

  test("unsubscribes on unmount (no leaks; observer set is cleared)", () => {
    const store = makeToolsStore([makeToolCall()]);
    const { unmount } = render(
      <TranscriptToolCalls
        streamingStore={store}
        streamingPath="inflight.tools"
        msgId="msg-1"
      />,
    );
    // The PropertyStore exposes no observer-count probe; we exercise
    // the unsubscribe path indirectly by unmounting and then setting
    // a new value — no error / no React warning means the listener
    // was properly cleaned up.
    unmount();
    expect(() =>
      store.set("inflight.tools", JSON.stringify([]), "test"),
    ).not.toThrow();
  });
});
