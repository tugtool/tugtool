/**
 * `ReadToolBlock` — fixture-replay test against
 * `test-05-tool-use-read.jsonl`.
 *
 * Goes through the full pipeline:
 *
 *   1. Load the v2.1.112 catalog probe (placeholder substitution
 *      handled by `loadGoldenProbe`).
 *   2. Build a real `CodeSessionStore` and dispatch every event in
 *      order through the test feed channel — the reducer transitions
 *      phases, populates `toolCallMap`, captures the structured
 *      result, and finally commits a `TurnEntry`.
 *   3. Render the committed `turn.toolCalls` through the dispatch
 *      (`dispatchToolCallState`) the way the transcript view does in
 *      production, then mount the `(Component, props)` pair.
 *   4. Assert: a `ReadToolBlock` rendered, the file path appears in
 *      the header, the embedded `FileBlock` shows the structured
 *      content with line numbers from `startLine`, and the
 *      "Showing N of M lines" footer reflects the windowed read.
 *
 * This is the load-bearing end-to-end check for [#step-8] — proves
 * the wrapper composes correctly against a real wire fixture, not
 * just hand-built props.
 */

import "../../../../../__tests__/setup-rtl";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import React from "react";

import { CodeSessionStore } from "@/lib/code-session-store";
import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
import type { TugConnection } from "@/connection";
import {
  FIXTURE_IDS,
  loadGoldenProbe,
} from "@/lib/code-session-store/testing/golden-catalog";
import { TestFrameChannel } from "@/lib/code-session-store/testing/mock-feed-store";
import { FeedId } from "@/protocol";

import {
  dispatchToolCallState,
  registerToolWrapper,
} from "../../tide-assistant-renderer-dispatch";
import { ReadToolBlock } from "../read-tool-block";

// Re-register: `tide-assistant-renderer-dispatch.test.ts` resets the
// registry in its own `beforeEach`. Without re-registering here,
// dispatch lookups in this file would resolve `DefaultToolWrapper`
// when this file runs after that test.
beforeAll(() => {
  registerToolWrapper("read", ReadToolBlock);
});

afterEach(() => {
  cleanup();
});

function constructStore(conn: TestFrameChannel): CodeSessionStore {
  return new CodeSessionStore({
    conn: conn as unknown as TugConnection,
    lifecycle: new ConnectionLifecycle(),
    tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
    sessionMode: "new",
  });
}

describe("ReadToolBlock — fixture replay (test-05-tool-use-read)", () => {
  test("v2.1.112 → committed turn renders a ReadToolBlock with FileBlock content", () => {
    const probe = loadGoldenProbe("v2.1.112", "test-05-tool-use-read");
    const conn = new TestFrameChannel();
    const store = constructStore(conn);

    store.send("read a file", []);
    for (const event of probe.events) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, event);
    }

    const transcript = store.getSnapshot().transcript;
    expect(transcript.length).toBe(1);
    const turn = transcript[0];
    expect(turn.toolCalls.length).toBe(1);

    const toolCall = turn.toolCalls[0];
    expect(toolCall.toolName).toBe("Read");
    expect(toolCall.status).toBe("done");

    const { Component, props } = dispatchToolCallState(toolCall, turn.msgId);
    expect(Component).toBe(ReadToolBlock);

    const { container } = render(<Component {...props} />);

    // Wrapper root + tool name visible.
    const root = container.querySelector(
      '[data-slot="read-tool-block"]',
    ) as HTMLElement;
    expect(root).not.toBeNull();
    const header = root.querySelector(
      '[data-slot="tool-wrapper-header"]',
    ) as HTMLElement;
    expect(header.textContent).toContain("Read");

    // The fixture's `tool_use.input.file_path` is substituted to
    // `<cwd>/Mounts/u/src/tugtool/CLAUDE.md` — assert the path
    // surfaces in the header. Substring check rather than literal
    // match keeps the test stable across `loadGoldenProbe`'s `{{cwd}}`
    // resolution.
    const path = root.querySelector(
      '[data-slot="read-tool-block-path"]',
    ) as HTMLElement;
    expect(path).not.toBeNull();
    expect(path.textContent).toContain("CLAUDE.md");

    // FileBlock renders the structured content embedded.
    const fileRoot = root.querySelector(
      '[data-slot="file-body"]',
    ) as HTMLElement;
    expect(fileRoot).not.toBeNull();
    expect(fileRoot.dataset.embedded).toBe("true");

    // The fixture sets `numLines: 3, startLine: 1, totalLines: 55` —
    // the gutter shows three lines starting at 1.
    const gutters = fileRoot.querySelectorAll(
      '[data-slot="file-gutter"]',
    );
    expect(gutters.length).toBe(3);
    expect(gutters[0].textContent).toBe("1");
    expect(gutters[2].textContent).toBe("3");

    // Content is the literal opening of CLAUDE.md from the fixture.
    expect(fileRoot.textContent).toContain(
      "Claude Code Guidelines for Tugtool",
    );

    // Footer: 3 of 55 read.
    const showing = container.querySelector(
      '[data-slot="read-tool-block-showing"]',
    ) as HTMLElement;
    expect(showing).not.toBeNull();
    expect(showing.textContent).toBe("Showing 3 of 55 lines");
  });
});
