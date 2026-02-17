import { describe, test, expect } from "bun:test";
import {
  sendControlRequest,
  sendControlResponse,
  formatPermissionAllow,
  formatPermissionDeny,
  formatQuestionAnswer,
  generateRequestId,
} from "../control.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStdinSpy(): { write: (data: unknown) => void; flush: () => void; written: string[] } {
  const written: string[] = [];
  return {
    written,
    write(data: unknown) {
      written.push(String(data));
    },
    flush() {},
  };
}

// ---------------------------------------------------------------------------
// formatPermissionAllow
// ---------------------------------------------------------------------------

describe("formatPermissionAllow", () => {
  test("produces behavior: allow with updatedInput", () => {
    const result = formatPermissionAllow("req-1", { path: "/foo" });
    expect(result.subtype).toBe("success");
    expect(result.request_id).toBe("req-1");
    const response = result.response as any;
    // CRITICAL: must be "behavior" not "decision" per PN-1
    expect(response.behavior).toBe("allow");
    expect(response.updatedInput).toEqual({ path: "/foo" });
    // Must NOT have "decision" key
    expect("decision" in response).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatPermissionDeny
// ---------------------------------------------------------------------------

describe("formatPermissionDeny", () => {
  test("produces behavior: deny with message", () => {
    const result = formatPermissionDeny("req-2", "Too risky");
    expect(result.subtype).toBe("success");
    expect(result.request_id).toBe("req-2");
    const response = result.response as any;
    // CRITICAL: must be "behavior" not "decision" per PN-1
    expect(response.behavior).toBe("deny");
    expect(response.message).toBe("Too risky");
    // Must NOT have "decision" key
    expect("decision" in response).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatQuestionAnswer
// ---------------------------------------------------------------------------

describe("formatQuestionAnswer", () => {
  test("nests answers under 'answers' key per §5b", () => {
    const originalInput = { questions: [{ question: "What is your favorite color?", multiSelect: false }] };
    const answers = { "What is your favorite color?": "Red" };
    const result = formatQuestionAnswer("req-3", originalInput, answers);
    expect(result.subtype).toBe("success");
    expect(result.request_id).toBe("req-3");
    const response = result.response as any;
    expect(response.behavior).toBe("allow");
    // Per §5b: answers nested under "answers" key, not spread flat.
    expect(response.updatedInput.answers).toBeDefined();
    expect(response.updatedInput.answers["What is your favorite color?"]).toBe("Red");
    // Original questions still present at top level.
    expect(response.updatedInput.questions).toEqual(originalInput.questions);
    // Answers must NOT be spread at the top level.
    expect(response.updatedInput["What is your favorite color?"]).toBeUndefined();
  });

  test("multiSelect uses comma-separated labels with no spaces per PN-5/§5b", () => {
    const originalInput = {
      questions: [{ question: "Pick colors", multiSelect: true }],
    };
    // Per §5b: multiSelect answers are comma-separated labels.
    const answers = { "Pick colors": "Red,Blue" };
    const result = formatQuestionAnswer("req-4", originalInput, answers);
    const response = result.response as any;
    // Verify format: nested under answers key, comma-separated, no spaces.
    expect(response.updatedInput.answers["Pick colors"]).toBe("Red,Blue");
    expect(response.updatedInput.answers["Pick colors"]).not.toContain(", ");
  });
});

// ---------------------------------------------------------------------------
// sendControlRequest
// ---------------------------------------------------------------------------

describe("sendControlRequest", () => {
  test("serializes correctly to stdin", () => {
    const spy = makeStdinSpy();
    sendControlRequest(spy, "ctrl-abc", { subtype: "interrupt" });
    expect(spy.written).toHaveLength(1);
    const parsed = JSON.parse(spy.written[0].replace(/\n$/, ""));
    expect(parsed.type).toBe("control_request");
    expect(parsed.request_id).toBe("ctrl-abc");
    expect(parsed.request).toEqual({ subtype: "interrupt" });
  });
});

// ---------------------------------------------------------------------------
// sendControlResponse
// ---------------------------------------------------------------------------

describe("sendControlResponse", () => {
  test("serializes correctly to stdin", () => {
    const spy = makeStdinSpy();
    const response = { subtype: "success", request_id: "req-5", response: { behavior: "allow", updatedInput: {} } };
    sendControlResponse(spy, response);
    expect(spy.written).toHaveLength(1);
    const parsed = JSON.parse(spy.written[0].replace(/\n$/, ""));
    expect(parsed.type).toBe("control_response");
    expect(parsed.response).toEqual(response);
  });
});

// ---------------------------------------------------------------------------
// generateRequestId
// ---------------------------------------------------------------------------

describe("generateRequestId", () => {
  test("produces IDs with ctrl- prefix", () => {
    const id = generateRequestId();
    expect(id.startsWith("ctrl-")).toBe(true);
  });

  test("produces unique IDs on successive calls", () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    expect(id1).not.toBe(id2);
  });
});
