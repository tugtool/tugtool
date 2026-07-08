/**
 * select-goal.test.ts — pure-logic coverage for the `/goal` state model.
 *
 * Transition semantics are pinned against the goal-lifecycle capture in
 * `tugcode/probes/goal-loop/` (claude 2.1.204): a goal run is one result
 * cycle; the evaluator's feedback arrives as `goal_feedback` frames; a
 * mid-run `/goal clear` can be trailed by residual evaluator rounds.
 */

import { describe, expect, test } from "bun:test";

import {
  commandLineFromSend,
  goalIsActive,
  parseGoalCommand,
  reduceGoalOnFeedback,
  reduceGoalOnSend,
  settleGoalOnCycleCommit,
  type GoalState,
} from "@/lib/code-session-store/select-goal";

const ATOM = "￼";

function activeGoal(overrides: Partial<GoalState> = {}): GoalState {
  return {
    condition: "TURNS.txt has 2 lines",
    status: "active",
    turnsEvaluated: 0,
    latestReason: null,
    setAtMs: 1000,
    cycleTurnKey: "turn-1",
    ...overrides,
  };
}

describe("parseGoalCommand", () => {
  test("a condition is a set", () => {
    expect(parseGoalCommand("/goal all tests pass")).toEqual({
      kind: "set",
      condition: "all tests pass",
    });
  });

  test("bare /goal is a status query", () => {
    expect(parseGoalCommand("/goal")).toEqual({ kind: "status" });
    expect(parseGoalCommand("  /goal  ")).toEqual({ kind: "status" });
  });

  test("every upstream clear alias clears", () => {
    for (const alias of ["clear", "stop", "off", "reset", "none", "cancel", "CLEAR"]) {
      expect(parseGoalCommand(`/goal ${alias}`)).toEqual({ kind: "clear" });
    }
  });

  test("a condition that merely starts with an alias word is a set", () => {
    expect(parseGoalCommand("/goal stop the dev server when tests pass")).toEqual({
      kind: "set",
      condition: "stop the dev server when tests pass",
    });
  });

  test("non-goal lines are null", () => {
    expect(parseGoalCommand("/goals are great")).toBeNull();
    expect(parseGoalCommand("hello /goal x")).toBeNull();
    expect(parseGoalCommand("/loop 5m check")).toBeNull();
  });
});

describe("commandLineFromSend", () => {
  test("a leading command atom renders as /name", () => {
    expect(
      commandLineFromSend(`${ATOM} all tests pass`, [{ type: "command", value: "goal" }], ATOM),
    ).toBe("/goal all tests pass");
  });

  test("image atoms drop; other atoms contribute their value", () => {
    expect(
      commandLineFromSend(
        `${ATOM} check ${ATOM}${ATOM}`,
        [
          { type: "command", value: "goal" },
          { type: "file", value: "src/a.ts" },
          { type: "image", value: "img-1" },
        ],
        ATOM,
      ),
    ).toBe("/goal check src/a.ts");
  });

  test("plain text passes through untouched", () => {
    expect(commandLineFromSend("/goal x", [], ATOM)).toBe("/goal x");
  });
});

describe("reduceGoalOnSend", () => {
  test("a set creates an active goal bound to its cycle", () => {
    const goal = reduceGoalOnSend(null, "/goal all tests pass", 5000, "turn-9");
    expect(goal).toEqual({
      condition: "all tests pass",
      status: "active",
      turnsEvaluated: 0,
      latestReason: null,
      setAtMs: 5000,
      cycleTurnKey: "turn-9",
    });
  });

  test("a new set replaces a prior goal (one per session)", () => {
    const next = reduceGoalOnSend(activeGoal(), "/goal a different thing", 6000, "turn-2");
    expect(next?.condition).toBe("a different thing");
    expect(next?.cycleTurnKey).toBe("turn-2");
  });

  test("clear flips an active goal; no-ops otherwise", () => {
    expect(reduceGoalOnSend(activeGoal(), "/goal clear", 6000, "t")?.status).toBe("cleared");
    const achieved = activeGoal({ status: "achieved" });
    expect(reduceGoalOnSend(achieved, "/goal clear", 6000, "t")).toBe(achieved);
    expect(reduceGoalOnSend(null, "/goal clear", 6000, "t")).toBeNull();
  });

  test("status query and non-goal sends never mutate", () => {
    const goal = activeGoal();
    expect(reduceGoalOnSend(goal, "/goal", 6000, "t")).toBe(goal);
    expect(reduceGoalOnSend(goal, "fix the bug", 6000, "t")).toBe(goal);
  });
});

describe("reduceGoalOnFeedback", () => {
  test("bumps rounds and latest reason on an active goal", () => {
    const next = reduceGoalOnFeedback(activeGoal(), "TURNS.txt has 2 lines", "only 1 line", "turn-1");
    expect(next?.turnsEvaluated).toBe(1);
    expect(next?.latestReason).toBe("only 1 line");
    expect(next?.status).toBe("active");
  });

  test("recovers a possibly-active goal from the frame when none is set", () => {
    const next = reduceGoalOnFeedback(null, "cond from wire", "not yet", "turn-3");
    expect(next).toEqual({
      condition: "cond from wire",
      status: "active",
      turnsEvaluated: 1,
      latestReason: "not yet",
      setAtMs: null,
      cycleTurnKey: "turn-3",
    });
  });

  test("residual feedback after a clear never resurrects", () => {
    const cleared = activeGoal({ status: "cleared" });
    expect(reduceGoalOnFeedback(cleared, "c", "r", "t")).toBe(cleared);
  });
});

describe("settleGoalOnCycleCommit", () => {
  test("a successful commit of the goal's own cycle achieves it", () => {
    const next = settleGoalOnCycleCommit(activeGoal(), "turn-1", true);
    expect(next?.status).toBe("achieved");
  });

  test("an errored/interrupted cycle leaves the goal possibly-active", () => {
    const goal = activeGoal();
    expect(settleGoalOnCycleCommit(goal, "turn-1", false)).toBe(goal);
  });

  test("another cycle's commit never settles the goal", () => {
    const goal = activeGoal();
    expect(settleGoalOnCycleCommit(goal, "turn-other", true)).toBe(goal);
    expect(settleGoalOnCycleCommit(goal, null, true)).toBe(goal);
  });

  test("cleared/achieved goals are inert", () => {
    const cleared = activeGoal({ status: "cleared" });
    expect(settleGoalOnCycleCommit(cleared, "turn-1", true)).toBe(cleared);
  });
});

describe("goalIsActive", () => {
  test("true only for an active goal", () => {
    expect(goalIsActive(null)).toBe(false);
    expect(goalIsActive(activeGoal())).toBe(true);
    expect(goalIsActive(activeGoal({ status: "achieved" }))).toBe(false);
    expect(goalIsActive(activeGoal({ status: "cleared" }))).toBe(false);
  });
});
