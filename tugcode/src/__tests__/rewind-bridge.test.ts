// `rewind_files` control-request bridge ([#step-7-1]).
//
// Covers the three tugcode-unit obligations of the sub-step: the
// `/rewind` anchor capture (`promptUuid` from the live user-echo), the
// control-request send + `control_response` correlation (reusing the
// `initialize` turn-free interception pattern), and the inbound→outbound
// IPC mapping (`rewind_preview` → `rewind_files{dry_run:true}` →
// `rewind_preview_result`; `session_rewind{scope:"code"}` →
// `rewind_files{dry_run:false}` → `rewind_result`). The round-trip
// against real claude is the probe in
// `tugrust/crates/tugcast/tests/common/probes.rs`.

import { describe, test, expect } from "bun:test";
import { ActiveTurn, SessionManager, routeTopLevelEvent } from "../session.ts";
import type { EventMappingContext } from "../session.ts";

// Capture writeLine() output (it routes through Bun.write(Bun.stdout)).
// Mirrors session.test.ts's helper.
async function captureIpcOutput(fn: () => void | Promise<void>): Promise<any[]> {
  const captured: any[] = [];
  const originalWrite = Bun.write;
  const decoder = new TextDecoder();
  (Bun as any).write = (dest: unknown, data: unknown) => {
    let text: string | null = null;
    if (dest === Bun.stdout && typeof data === "string") text = data;
    else if (dest === Bun.stdout && data instanceof Uint8Array)
      text = decoder.decode(data);
    if (text !== null) {
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          try {
            captured.push(JSON.parse(trimmed));
          } catch {
            // ignore non-JSON lines
          }
        }
      }
    }
    return Promise.resolve(
      data instanceof Uint8Array ? data.length : (data as string).length,
    );
  };
  try {
    await fn();
    const { drainPendingWrites } = await import("../ipc.ts");
    await drainPendingWrites();
  } finally {
    (Bun as any).write = originalWrite;
  }
  return captured;
}

// A mock claude subprocess whose stdin records every written line.
function mockProcessWithStdinSpy(): { manager: SessionManager; written: string[] } {
  const manager = new SessionManager(
    "/tmp/tugcode-rewind-" + Date.now() + "-" + Math.floor(performance.now()),
    crypto.randomUUID(),
  );
  const written: string[] = [];
  (manager as any).claudeProcess = {
    stdin: {
      write: (data: unknown) => written.push(String(data)),
      flush: () => {},
    },
  };
  return { manager, written };
}

const CTX: EventMappingContext = { msgId: "", seq: 0, rev: 0 };

describe("rewind anchor capture (promptUuid)", () => {
  test("a live user-submission echo surfaces promptUuid", () => {
    const result = routeTopLevelEvent(
      {
        type: "user",
        uuid: "dcec4c42-prompt-uuid",
        message: { role: "user", content: [{ type: "text", text: "hello" }] },
      },
      CTX,
    );
    expect(result.promptUuid).toBe("dcec4c42-prompt-uuid");
  });

  test("a slash-command echo (string content) surfaces promptUuid", () => {
    const result = routeTopLevelEvent(
      {
        type: "user",
        uuid: "slash-prompt-uuid",
        message: { role: "user", content: "/rewind" },
      },
      CTX,
    );
    expect(result.promptUuid).toBe("slash-prompt-uuid");
  });

  test("a tool_result user event does NOT surface promptUuid", () => {
    const result = routeTopLevelEvent(
      {
        type: "user",
        uuid: "tool-result-uuid",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tu-1", content: "ok" },
          ],
        },
      },
      CTX,
    );
    expect(result.promptUuid).toBeUndefined();
  });

  test("a user echo with no uuid surfaces nothing", () => {
    const result = routeTopLevelEvent(
      {
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      },
      CTX,
    );
    expect(result.promptUuid).toBeUndefined();
  });

  test("dispatch latches promptUuid onto the turn and emits prompt_anchor once", async () => {
    const { manager } = mockProcessWithStdinSpy();
    const turn = new ActiveTurn(0, [{ type: "text", text: "hello" }]);
    (manager as any).activeTurn = turn;

    const echo = JSON.stringify({
      type: "user",
      uuid: "live-anchor-uuid",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
    });

    const out = await captureIpcOutput(() => {
      (manager as any).handleClaudeLine(echo);
      // A second echo (e.g. claude re-emitting) must not double-fire.
      (manager as any).handleClaudeLine(echo);
    });

    const anchors = out.filter((m) => m.type === "prompt_anchor");
    expect(anchors.length).toBe(1);
    expect(anchors[0].promptUuid).toBe("live-anchor-uuid");
    expect(turn.promptUuid).toBe("live-anchor-uuid");
  });
});

describe("rewind_preview → rewind_files{dry_run:true}", () => {
  test("sends the control request and registers a pending preview", () => {
    const { manager, written } = mockProcessWithStdinSpy();
    manager.handleRewindPreview({
      type: "rewind_preview",
      promptUuid: "anchor-1",
    });
    expect(written.length).toBe(1);
    const sent = JSON.parse(written[0].replace(/\n$/, ""));
    expect(sent.type).toBe("control_request");
    expect(sent.request.subtype).toBe("rewind_files");
    expect(sent.request.user_message_id).toBe("anchor-1");
    expect(sent.request.dry_run).toBe(true);
    expect(typeof sent.request_id).toBe("string");
    expect((manager as any).pendingRewindRequests.size).toBe(1);
  });

  test("a matching control_response relays a rewind_preview_result", async () => {
    const { manager, written } = mockProcessWithStdinSpy();
    manager.handleRewindPreview({
      type: "rewind_preview",
      promptUuid: "anchor-2",
    });
    const requestId = JSON.parse(written[0].replace(/\n$/, "")).request_id;

    const controlResponse = JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response: {
          canRewind: true,
          filesChanged: ["/repo/note.txt"],
          insertions: 0,
          deletions: 1,
        },
      },
    });

    const out = await captureIpcOutput(() => {
      (manager as any).handleClaudeLine(controlResponse);
    });

    const results = out.filter((m) => m.type === "rewind_preview_result");
    expect(results.length).toBe(1);
    expect(results[0]).toMatchObject({
      promptUuid: "anchor-2",
      canRewind: true,
      filesChanged: ["/repo/note.txt"],
      insertions: 0,
      deletions: 1,
    });
    // Correlation consumed the pending entry.
    expect((manager as any).pendingRewindRequests.size).toBe(0);
  });

  test("a canRewind:false response relays the gating error", async () => {
    const { manager, written } = mockProcessWithStdinSpy();
    manager.handleRewindPreview({
      type: "rewind_preview",
      promptUuid: "aged-out",
    });
    const requestId = JSON.parse(written[0].replace(/\n$/, "")).request_id;

    const out = await captureIpcOutput(() => {
      (manager as any).handleClaudeLine(
        JSON.stringify({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: requestId,
            response: {
              canRewind: false,
              error: "No file checkpoint found for this message.",
            },
          },
        }),
      );
    });

    const result = out.find((m) => m.type === "rewind_preview_result");
    expect(result.canRewind).toBe(false);
    expect(result.error).toContain("No file checkpoint found");
  });

  test("idle gating: a preview mid-turn is rejected without a control request", async () => {
    const { manager, written } = mockProcessWithStdinSpy();
    // An in-flight turn (not gotResult, not interrupted) ⇒ not idle.
    (manager as any).activeTurn = new ActiveTurn(0, []);

    const out = await captureIpcOutput(() => {
      manager.handleRewindPreview({
        type: "rewind_preview",
        promptUuid: "busy-anchor",
      });
    });

    expect(written.length).toBe(0);
    expect((manager as any).pendingRewindRequests.size).toBe(0);
    const result = out.find((m) => m.type === "rewind_preview_result");
    expect(result.canRewind).toBe(false);
    expect(result.error).toContain("busy");
  });
});

describe("session_rewind code dimension → rewind_files{dry_run:false}", () => {
  test("scope:code sends an apply control request", () => {
    const { manager, written } = mockProcessWithStdinSpy();
    manager.handleSessionRewind({
      type: "session_rewind",
      promptUuid: "anchor-apply",
      scope: "code",
    });
    expect(written.length).toBe(1);
    const sent = JSON.parse(written[0].replace(/\n$/, ""));
    expect(sent.request.subtype).toBe("rewind_files");
    expect(sent.request.user_message_id).toBe("anchor-apply");
    expect(sent.request.dry_run).toBe(false);
  });

  test("scope:both sends the code apply (the conversation leg is [#step-7-2])", () => {
    const { manager, written } = mockProcessWithStdinSpy();
    manager.handleSessionRewind({
      type: "session_rewind",
      promptUuid: "anchor-both",
      scope: "both",
    });
    expect(written.length).toBe(1);
    expect(JSON.parse(written[0].replace(/\n$/, "")).request.dry_run).toBe(false);
  });

  test("a matching control_response relays a rewind_result ack", async () => {
    const { manager, written } = mockProcessWithStdinSpy();
    manager.handleSessionRewind({
      type: "session_rewind",
      promptUuid: "anchor-ack",
      scope: "code",
    });
    const requestId = JSON.parse(written[0].replace(/\n$/, "")).request_id;

    const out = await captureIpcOutput(() => {
      (manager as any).handleClaudeLine(
        JSON.stringify({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: requestId,
            response: { canRewind: true },
          },
        }),
      );
    });

    const ack = out.find((m) => m.type === "rewind_result");
    expect(ack).toMatchObject({
      promptUuid: "anchor-ack",
      scope: "code",
      canRewind: true,
    });
  });

  test("scope:conversation issues no control request (the [#step-7-2] seam)", () => {
    const { manager, written } = mockProcessWithStdinSpy();
    manager.handleSessionRewind({
      type: "session_rewind",
      promptUuid: "anchor-convo",
      scope: "conversation",
    });
    expect(written.length).toBe(0);
    expect((manager as any).pendingRewindRequests.size).toBe(0);
  });

  test("idle gating: an apply mid-turn is rejected without a control request", async () => {
    const { manager, written } = mockProcessWithStdinSpy();
    (manager as any).activeTurn = new ActiveTurn(0, []);

    const out = await captureIpcOutput(() => {
      manager.handleSessionRewind({
        type: "session_rewind",
        promptUuid: "busy-apply",
        scope: "code",
      });
    });

    expect(written.length).toBe(0);
    const ack = out.find((m) => m.type === "rewind_result");
    expect(ack.canRewind).toBe(false);
    expect(ack.error).toContain("busy");
  });
});

describe("control_response correlation isolation", () => {
  test("an uncorrelated control_response is not consumed by the rewind path", async () => {
    const { manager } = mockProcessWithStdinSpy();
    // No pending rewind requests ⇒ tryHandleRewindControlResponse is never
    // reached; the line falls through harmlessly (no rewind IPC emitted).
    const out = await captureIpcOutput(() => {
      (manager as any).handleClaudeLine(
        JSON.stringify({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: "some-other-request",
            response: { canRewind: true },
          },
        }),
      );
    });
    expect(out.filter((m) => m.type === "rewind_preview_result").length).toBe(0);
    expect(out.filter((m) => m.type === "rewind_result").length).toBe(0);
  });
});
