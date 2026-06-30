/**
 * Pins {@link selectLiveActivity}'s priority ladder and phrasing — the
 * derivation behind the foot-of-transcript live line. The muteness case
 * (foreground idle, background jobs running) is the load-bearing one.
 */

import { describe, test, expect } from "bun:test";

import {
  selectLiveActivity,
  type LiveActivity,
} from "../select-live-activity";
import type { JobItem } from "../select-jobs";
import type { CodeSessionSnapshot } from "../types";

function job(overrides: Partial<JobItem> & { jobId: string }): JobItem {
  return {
    source: "claude",
    kind: "agent",
    toolUseId: `toolu_${overrides.jobId}`,
    description: "",
    status: "running",
    startedAtMs: 1_000,
    endedAtMs: null,
    ...overrides,
  };
}

// Minimal snapshot — only the fields selectLiveActivity reads; the rest
// is irrelevant to the derivation and omitted via the cast.
function snap(overrides: Partial<CodeSessionSnapshot>): CodeSessionSnapshot {
  return {
    phase: "idle",
    interruptInFlight: false,
    activeTurn: null,
    apiRetry: null,
    jobs: [],
    ...overrides,
  } as CodeSessionSnapshot;
}

function pendingToolTurn(toolName: string): CodeSessionSnapshot["activeTurn"] {
  return {
    turnKey: "t1",
    submitAt: 0,
    origin: "user",
    suppressed: false,
    messages: [
      {
        messageKey: "mk1",
        createdAt: 0,
        kind: "tool_use",
        toolUseId: "toolu_x",
        toolName,
        input: {},
        status: "pending",
        result: null,
        structuredResult: null,
        toolWallMs: null,
      },
    ],
  } as CodeSessionSnapshot["activeTurn"];
}

describe("selectLiveActivity priority ladder", () => {
  test("idle with no jobs → inactive Idle", () => {
    const a = selectLiveActivity(snap({}));
    expect(a).toEqual({ active: false, kind: "idle", label: "Idle" });
  });

  test("retry outranks everything, even an active tool + bg jobs", () => {
    const a = selectLiveActivity(
      snap({
        phase: "waking",
        activeTurn: pendingToolTurn("Bash"),
        jobs: [job({ jobId: "a" })],
        apiRetry: {
          attempt: 3,
          maxRetries: 10,
          deadline: 0,
          error: "x",
          errorStatus: 529,
        },
      }),
    );
    expect(a.kind).toBe("retrying");
    expect(a.label).toBe("Retrying (attempt 3)");
    expect(a.detail).toBe("+1 bg");
  });

  test("interrupt outranks waking / tool", () => {
    const a = selectLiveActivity(
      snap({ interruptInFlight: true, activeTurn: pendingToolTurn("Bash") }),
    );
    expect(a.kind).toBe("interrupting");
  });

  test("waking outranks a foreground tool", () => {
    const a = selectLiveActivity(
      snap({ phase: "waking", activeTurn: pendingToolTurn("Bash") }),
    );
    expect(a.kind).toBe("waking");
    expect(a.label).toBe("Resuming…");
  });

  test("foreground pending tool → Running <tool>", () => {
    const a = selectLiveActivity(snap({ activeTurn: pendingToolTurn("Grep") }));
    expect(a.kind).toBe("tool");
    expect(a.label).toBe("Running Grep");
  });

  test("active turn with no pending tool → Thinking", () => {
    const turn = {
      ...pendingToolTurn("Bash")!,
      messages: [],
    } as CodeSessionSnapshot["activeTurn"];
    const a = selectLiveActivity(snap({ activeTurn: turn }));
    expect(a.kind).toBe("thinking");
  });

  test("a foreground line annotates concurrent background count", () => {
    const a = selectLiveActivity(
      snap({
        activeTurn: pendingToolTurn("Edit"),
        jobs: [job({ jobId: "a" }), job({ jobId: "b" })],
      }),
    );
    expect(a.kind).toBe("tool");
    expect(a.detail).toBe("+2 bg");
  });
});

describe("the muteness case — foreground idle, background live", () => {
  test("one running agent with a progress tool → '<kind>: <tool>'", () => {
    const a: LiveActivity = selectLiveActivity(
      snap({
        jobs: [
          job({
            jobId: "a",
            kind: "agent",
            progress: { lastToolName: "Read" },
          }),
        ],
      }),
    );
    expect(a.active).toBe(true);
    expect(a.kind).toBe("background");
    expect(a.label).toBe("agent: Read");
  });

  test("several running jobs → 'N jobs · <newest>'", () => {
    const a = selectLiveActivity(
      snap({
        jobs: [
          job({ jobId: "old", startedAtMs: 1_000, progress: { lastToolName: "Glob" } }),
          job({ jobId: "new", startedAtMs: 5_000, progress: { lastToolName: "Bash" } }),
        ],
      }),
    );
    expect(a.label).toBe("2 jobs · agent: Bash");
  });

  test("a running job with no progress tick yet falls back to its description", () => {
    const a = selectLiveActivity(
      snap({ jobs: [job({ jobId: "a", kind: "bash", description: "build the app" })] }),
    );
    expect(a.label).toBe("bash: build the app");
  });

  test("terminal jobs do not count as background activity", () => {
    const a = selectLiveActivity(
      snap({ jobs: [job({ jobId: "a", status: "completed", endedAtMs: 9_000 })] }),
    );
    expect(a.kind).toBe("idle");
    expect(a.active).toBe(false);
  });
});
