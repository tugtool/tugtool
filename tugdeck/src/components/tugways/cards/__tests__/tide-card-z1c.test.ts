/**
 * Pure-logic tests for the TideZ1C indicator helpers ([D19] /
 * `#spec-z1c`).
 *
 * `tideZ1CContent(phase, interruptInFlight)` pins the phase →
 * indicator map: each of the seven entries in [D19]'s table, plus
 * the three phases with no defined indicator (`idle`, `replaying`,
 * `errored` → `null`), plus the interrupt-overrides-phase
 * precedence.
 *
 * Visibility is gated structurally by the parent `CodeRowCell`
 * (Z1C is mounted iff `!isCommitted` on the assistant row), so
 * there is no visibility helper to pin here.
 */

import { describe, expect, test } from "bun:test";

import { tideZ1CContent } from "../tide-card-z1c";
import type { CodeSessionPhase } from "@/lib/code-session-store/types";

describe("tideZ1CContent — phase → indicator", () => {
  test("submitting → default 'Submitting…'", () => {
    expect(tideZ1CContent("submitting", false)).toEqual({
      tone: "default",
      label: "Submitting…",
    });
  });

  test("awaiting_first_token → default 'Thinking…'", () => {
    expect(tideZ1CContent("awaiting_first_token", false)).toEqual({
      tone: "default",
      label: "Thinking…",
    });
  });

  test("streaming → default 'Streaming…'", () => {
    expect(tideZ1CContent("streaming", false)).toEqual({
      tone: "default",
      label: "Streaming…",
    });
  });

  test("tool_work → default 'Tool work…'", () => {
    expect(tideZ1CContent("tool_work", false)).toEqual({
      tone: "default",
      label: "Tool work…",
    });
  });

  test("awaiting_approval → caution 'Awaiting approval'", () => {
    expect(tideZ1CContent("awaiting_approval", false)).toEqual({
      tone: "caution",
      label: "Awaiting approval",
    });
  });

  test("waking → default 'Waking…'", () => {
    expect(tideZ1CContent("waking", false)).toEqual({
      tone: "default",
      label: "Waking…",
    });
  });

  test("idle / replaying / errored → null (no indicator)", () => {
    expect(tideZ1CContent("idle", false)).toBeNull();
    expect(tideZ1CContent("replaying", false)).toBeNull();
    expect(tideZ1CContent("errored", false)).toBeNull();
  });
});

describe("tideZ1CContent — interruptInFlight precedence", () => {
  test("interruptInFlight=true overrides every phase with caution 'Interrupting…'", () => {
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
      expect(tideZ1CContent(phase, true)).toEqual({
        tone: "caution",
        label: "Interrupting…",
      });
    }
  });
});

describe("tideZ1CVisible — `data-visible` derivation", () => {
  test("activeTurn !== null → visible", () => {
    expect(tideZ1CVisible({})).toBe(true);
    expect(tideZ1CVisible({ turnKey: "t-1" })).toBe(true);
  });

  test("activeTurn === null → hidden", () => {
    expect(tideZ1CVisible(null)).toBe(false);
  });
});
