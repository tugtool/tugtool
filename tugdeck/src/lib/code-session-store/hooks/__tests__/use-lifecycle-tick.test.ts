/**
 * Pure-logic tests for `useLifecycleTick`'s phase predicate. The hook
 * itself wraps `useState` + `useEffect` + `setInterval`, which are
 * React's responsibility; we test the predicate that decides when the
 * tick is live vs idle. Higher-level (app-test) coverage exercises the
 * end-to-end UI ticking behavior.
 */

import { describe, it, expect } from "bun:test";

import { isLivePhase } from "@/lib/code-session-store/hooks/use-lifecycle-tick";
import type { CodeSessionPhase } from "@/lib/code-session-store/types";

describe("useLifecycleTick — isLivePhase", () => {
  it("returns false for terminal phases", () => {
    expect(isLivePhase("idle")).toBe(false);
    expect(isLivePhase("errored")).toBe(false);
  });

  it("returns true for every non-terminal phase", () => {
    const live: CodeSessionPhase[] = [
      "submitting",
      "awaiting_first_token",
      "streaming",
      "tool_work",
      "awaiting_approval",
      "replaying",
    ];
    for (const p of live) {
      expect(isLivePhase(p)).toBe(true);
    }
  });
});
