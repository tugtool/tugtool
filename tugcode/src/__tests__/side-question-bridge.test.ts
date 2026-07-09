// `/btw` side_question control-request bridge (S01).
//
// Covers the tugcode-unit obligations: `handleSideQuestion` forwards a
// `side_question` control-request (reusing the client's request_id), a
// matching `control_response` is correlated turn-free into exactly one
// `side_question_answer` frame, the settled payload is read from the
// doubly-nested `response.response.{response,synthetic}` (confirmed by the
// probe in `../probes/btw/FINDINGS.md`), and — the defining property of
// `/btw` — a response arriving MID-TURN still correlates without perturbing
// turn routing (Risk R01). The live round-trip against real claude is the
// probe.

import { describe, test, expect } from "bun:test";
import { ActiveTurn, SessionManager } from "../session.ts";

// Capture writeLine() output (routes through Bun.write(Bun.stdout)). Mirrors
// rewind-bridge.test.ts's helper.
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
    "/tmp/tugcode-btw-" + Date.now() + "-" + Math.floor(performance.now()),
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

// The exact control_response shape claude emits (probe capture): the settled
// answer is doubly nested under response.response.
function sideQuestionControlResponse(
  requestId: string,
  answer: string | null,
  synthetic?: boolean,
): string {
  const inner: Record<string, unknown> = { response: answer };
  if (synthetic !== undefined) inner.synthetic = synthetic;
  return JSON.stringify({
    type: "control_response",
    response: { subtype: "success", request_id: requestId, response: inner },
  });
}

describe("handleSideQuestion → side_question control-request", () => {
  test("forwards the control-request reusing the client request_id and registers a pending entry", () => {
    const { manager, written } = mockProcessWithStdinSpy();
    manager.handleSideQuestion({
      type: "side_question",
      request_id: "btw-7",
      question: "what was that config file?",
    });
    expect(written.length).toBe(1);
    const sent = JSON.parse(written[0].replace(/\n$/, ""));
    expect(sent.type).toBe("control_request");
    expect(sent.request_id).toBe("btw-7"); // client id reused verbatim
    expect(sent.request.subtype).toBe("side_question");
    expect(sent.request.question).toBe("what was that config file?");
    expect((manager as any).pendingSideQuestions.size).toBe(1);
  });

  test("no claude process → emits a null-answer frame without sending", async () => {
    const manager = new SessionManager(
      "/tmp/tugcode-btw-noproc-" + Date.now(),
      crypto.randomUUID(),
    );
    const out = await captureIpcOutput(() => {
      manager.handleSideQuestion({
        type: "side_question",
        request_id: "btw-noproc",
        question: "anything?",
      });
    });
    const frame = out.find((m) => m.type === "side_question_answer");
    expect(frame).toMatchObject({ request_id: "btw-noproc", answer: null, synthetic: false });
  });
});

describe("control_response correlation → side_question_answer", () => {
  test("a matching response yields exactly one settled frame and consumes the pending entry", async () => {
    const { manager, written } = mockProcessWithStdinSpy();
    manager.handleSideQuestion({
      type: "side_question",
      request_id: "btw-1",
      question: "the magic word?",
    });
    const requestId = JSON.parse(written[0].replace(/\n$/, "")).request_id;

    const out = await captureIpcOutput(() => {
      (manager as any).handleClaudeLine(
        sideQuestionControlResponse(requestId, "XYLOPHONE-42", false),
      );
    });

    const frames = out.filter((m) => m.type === "side_question_answer");
    expect(frames.length).toBe(1);
    expect(frames[0]).toMatchObject({
      request_id: "btw-1",
      answer: "XYLOPHONE-42",
      synthetic: false,
      tug_session_id: (manager as any).sessionId,
    });
    expect((manager as any).pendingSideQuestions.size).toBe(0);
  });

  test("a missing synthetic field defaults to false", async () => {
    const { manager, written } = mockProcessWithStdinSpy();
    manager.handleSideQuestion({ type: "side_question", request_id: "btw-2", question: "q" });
    const requestId = JSON.parse(written[0].replace(/\n$/, "")).request_id;
    const out = await captureIpcOutput(() => {
      (manager as any).handleClaudeLine(sideQuestionControlResponse(requestId, "answer"));
    });
    expect(out.find((m) => m.type === "side_question_answer").synthetic).toBe(false);
  });

  test("a null inner response relays answer:null", async () => {
    const { manager, written } = mockProcessWithStdinSpy();
    manager.handleSideQuestion({ type: "side_question", request_id: "btw-3", question: "q" });
    const requestId = JSON.parse(written[0].replace(/\n$/, "")).request_id;
    const out = await captureIpcOutput(() => {
      (manager as any).handleClaudeLine(sideQuestionControlResponse(requestId, null));
    });
    expect(out.find((m) => m.type === "side_question_answer").answer).toBeNull();
  });

  test("an uncorrelated control_response is not consumed as a side question", async () => {
    const { manager } = mockProcessWithStdinSpy();
    // No pending side questions ⇒ the catch's size-guard short-circuits and
    // the line falls through with no side_question_answer emitted.
    const out = await captureIpcOutput(() => {
      (manager as any).handleClaudeLine(
        sideQuestionControlResponse("some-other-request", "nope"),
      );
    });
    expect(out.filter((m) => m.type === "side_question_answer").length).toBe(0);
  });
});

describe("mid-turn correlation (Risk R01)", () => {
  test("a response arriving while a turn is open still correlates and does not perturb the turn", async () => {
    const { manager, written } = mockProcessWithStdinSpy();
    // Open a turn — as if the side question was asked mid-stream.
    const turn = new ActiveTurn(0, [{ type: "text", text: "streaming…" }]);
    (manager as any).activeTurn = turn;

    manager.handleSideQuestion({
      type: "side_question",
      request_id: "btw-mid",
      question: "mid-turn ask",
    });
    const requestId = JSON.parse(written[0].replace(/\n$/, "")).request_id;

    const out = await captureIpcOutput(() => {
      (manager as any).handleClaudeLine(
        sideQuestionControlResponse(requestId, "answer-mid-turn", false),
      );
    });

    // The side answer was emitted...
    const answers = out.filter((m) => m.type === "side_question_answer");
    expect(answers.length).toBe(1);
    expect(answers[0].answer).toBe("answer-mid-turn");
    // ...and turn routing was NOT perturbed: the open turn is untouched (the
    // response was consumed pre-routing, never reaching dispatchEventToTurn),
    // and no turn-content frame leaked out.
    expect((manager as any).activeTurn).toBe(turn);
    expect(out.filter((m) => m.type === "assistant_text").length).toBe(0);
    expect(out.filter((m) => m.type === "turn_complete").length).toBe(0);
  });
});
