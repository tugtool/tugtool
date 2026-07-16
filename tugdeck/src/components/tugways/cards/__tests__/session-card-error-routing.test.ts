import { describe, expect, it } from "bun:test";

import {
  classifyCardError,
  type RoutableCardError,
} from "../session-card-error-routing";

describe("classifyCardError", () => {
  it("returns null for no error", () => {
    expect(classifyCardError(null)).toBe(null);
  });

  it("routes a logged-out auth gate to auth_gate", () => {
    const err: RoutableCardError = {
      cause: "session_state_errored",
      message: "auth_required",
    };
    expect(classifyCardError(err)).toBe("auth_gate");
  });

  it("routes a missing-CLI auth gate to auth_gate", () => {
    const err: RoutableCardError = {
      cause: "session_state_errored",
      message: "claude_missing",
    };
    expect(classifyCardError(err)).toBe("auth_gate");
  });

  it("routes resume_failed to resume_failed", () => {
    expect(
      classifyCardError({ cause: "resume_failed", message: "gone" }),
    ).toBe("resume_failed");
  });

  it("leaves a genuine session error unrouted (in-card banner)", () => {
    expect(
      classifyCardError({
        cause: "session_state_errored",
        message: "crash_budget_exhausted",
      }),
    ).toBe(null);
  });

  it("leaves transport_closed unrouted", () => {
    expect(
      classifyCardError({ cause: "transport_closed", message: "" }),
    ).toBe(null);
  });
});
