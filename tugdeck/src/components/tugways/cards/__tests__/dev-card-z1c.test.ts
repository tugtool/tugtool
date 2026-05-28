/**
 * Pure-logic tests for the `devZ1CContent` helper ([D19] /
 * `#spec-z1c`).
 *
 * The helper resolves the per-phase indicator content for DevZ1C
 * — returns `{label}` for the five active phases and `null` for
 * the five non-indicator states (`awaiting_approval` because the
 * pending dialog is the affordance; `interruptInFlight === true`
 * because the interrupt is instant from the user's POV and Z1B
 * paints the end-state; `idle` / `replaying` / `errored` because
 * there is no in-flight work to indicate).
 *
 * Visibility is gated structurally by the parent `AssistantTurnCell`
 * (Z1C is mounted only when `!isCommitted` on the assistant row),
 * so there is no visibility helper to pin here.
 */

import { describe, expect, test } from "bun:test";

import { devZ1CContent } from "../dev-card-z1c";
import type { CodeSessionPhase } from "@/lib/code-session-store/types";

describe("devZ1CContent — active phases", () => {
  test("submitting → 'Submitting…'", () => {
    expect(devZ1CContent("submitting", false)).toEqual({
      label: "Submitting…",
    });
  });

  test("awaiting_first_token → 'Thinking…'", () => {
    expect(devZ1CContent("awaiting_first_token", false)).toEqual({
      label: "Thinking…",
    });
  });

  test("streaming → 'Streaming…'", () => {
    expect(devZ1CContent("streaming", false)).toEqual({
      label: "Streaming…",
    });
  });

  test("tool_work → 'Tool work…'", () => {
    expect(devZ1CContent("tool_work", false)).toEqual({
      label: "Tool work…",
    });
  });

  test("waking → 'Waking…'", () => {
    expect(devZ1CContent("waking", false)).toEqual({
      label: "Waking…",
    });
  });
});

describe("devZ1CContent — non-indicator phases (slot collapses)", () => {
  test("awaiting_approval → null (the pending dialog is the affordance)", () => {
    expect(devZ1CContent("awaiting_approval", false)).toBeNull();
  });

  test("idle → null", () => {
    expect(devZ1CContent("idle", false)).toBeNull();
  });

  test("replaying → null", () => {
    expect(devZ1CContent("replaying", false)).toBeNull();
  });

  test("errored → null", () => {
    expect(devZ1CContent("errored", false)).toBeNull();
  });
});

describe("devZ1CContent — interruptInFlight precedence", () => {
  test("interruptInFlight=true overrides every phase to null (interrupt is instant; Z1B paints end-state)", () => {
    const phases: CodeSessionPhase[] = [
      "idle",
      "submitting",
      "awaiting_first_token",
      "streaming",
      "tool_work",
      "awaiting_approval",
      "replaying",
      "waking",
      "errored",
    ];
    for (const phase of phases) {
      expect(devZ1CContent(phase, true)).toBeNull();
    }
  });
});
