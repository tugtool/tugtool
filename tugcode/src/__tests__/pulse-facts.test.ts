/**
 * PulseFactProducer — phrasing + observation gating, pure logic over a
 * captured write sink. Frame shapes for the job events mirror the
 * v2.1.173-jobs-spike capture (task_started carries description;
 * task_updated is patch-based).
 */

import { afterEach, describe, expect, setSystemTime, test } from "bun:test";

import {
  TOOL_DURATION_MS,
  PulseFactProducer,
  clip,
  ordinal,
  phraseTurnContext,
  phraseTurnEnd,
  toolHint,
  type PulseFactFrame,
} from "../pulse-facts.ts";

function harness(enabled = true): {
  producer: PulseFactProducer;
  facts: PulseFactFrame[];
} {
  const facts: PulseFactFrame[] = [];
  const producer = new PulseFactProducer({
    scope: "sess-1",
    write: (f) => facts.push(f),
    enabled,
  });
  return { producer, facts };
}

afterEach(() => {
  setSystemTime(); // restore real clock
});

describe("phrasing helpers", () => {
  test("clip collapses whitespace and bounds length", () => {
    expect(clip("a  b\n\nc", 20)).toBe("a b c");
    const clipped = clip("x".repeat(100), 20);
    expect(clipped.length).toBe(20);
    expect(clipped.endsWith("…")).toBe(true);
  });

  test("ordinal covers the English suffix table", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(22)).toBe("22nd");
  });

  test("turn context is marked, quoted, and bounded", () => {
    const line = phraseTurnContext("refactor the focus engine ".repeat(10));
    expect(line.startsWith("context: the developer's request this turn — \"")).toBe(true);
    expect(line.length).toBeLessThan(150);
  });

  test("toolHint picks file basename, command, pattern, or description", () => {
    expect(toolHint("Edit", { file_path: "/a/b/reducer.ts" })).toBe(" on reducer.ts");
    expect(toolHint("Bash", { command: "bun test --watch" })).toBe(": bun test --watch");
    expect(toolHint("Grep", { pattern: "isJobLaunch" })).toBe(' for "isJobLaunch"');
    expect(toolHint("Agent", { description: "explore the codebase" })).toBe(
      ": explore the codebase",
    );
    expect(toolHint("Skill", {})).toBe("");
  });

  test("turn end lists edited files with an overflow count", () => {
    expect(phraseTurnEnd("success", 1, [])).toBe("turn end: 1 tool call — success");
    expect(phraseTurnEnd("success", 7, ["a.ts", "b.ts"])).toBe(
      "turn end: 7 tool calls, edited a.ts, b.ts — success",
    );
    expect(phraseTurnEnd("success", 9, ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"])).toBe(
      "turn end: 9 tool calls, edited a.ts, b.ts, c.ts +2 more — success",
    );
  });
});

describe("PulseFactProducer", () => {
  test("turn start emits the request as context; empty preview stays silent", () => {
    const { producer, facts } = harness();
    producer.onTurnStart("build the widget");
    producer.onTurnStart("   ");
    expect(facts.length).toBe(1);
    expect(facts[0].kind).toBe("note");
    expect(facts[0].scope).toBe("sess-1");
    expect(facts[0].fact).toBe(
      'context: the developer\'s request this turn — "build the widget"',
    );
  });

  test("tool facts fire at the RESULT with the true outcome; repeats earn ordinals", () => {
    setSystemTime(new Date(1_000_000));
    const { producer, facts } = harness();
    producer.observeOutbound({ type: "tool_use", tool_name: "Read", tool_use_id: "t1", input: { file_path: "/x/a.ts" } });
    // No fact until the result lands — calls without outcomes are
    // exactly what made the commentator fabricate.
    expect(facts.length).toBe(0);
    producer.observeOutbound({ type: "tool_result", tool_use_id: "t1" });
    producer.observeOutbound({ type: "tool_use", tool_name: "Edit", tool_use_id: "t2", input: { file_path: "/x/a.ts" } });
    producer.observeOutbound({ type: "tool_result", tool_use_id: "t2" });
    producer.observeOutbound({ type: "tool_use", tool_name: "Edit", tool_use_id: "t3", input: { file_path: "/x/a.ts" } });
    producer.observeOutbound({ type: "tool_result", tool_use_id: "t3", is_error: true });
    expect(facts.map((f) => [f.kind, f.fact])).toEqual([
      ["tool", "Read on a.ts — ok"],
      ["tool", "Edit on a.ts — ok"],
      ["error", "Edit on a.ts — failed (2nd time this turn)"],
    ]);
    producer.onTurnStart("next turn");
    producer.observeOutbound({ type: "tool_use", tool_name: "Edit", tool_use_id: "t4", input: { file_path: "/x/a.ts" } });
    producer.observeOutbound({ type: "tool_result", tool_use_id: "t4" });
    expect(facts.at(-1)!.fact).toBe("Edit on a.ts — ok");
  });

  test("notable durations surface in the outcome fact; fast ones stay terse", () => {
    setSystemTime(new Date(1_000_000));
    const { producer, facts } = harness();
    producer.observeOutbound({ type: "tool_use", tool_name: "Bash", tool_use_id: "slow", input: { command: "cargo build" } });
    producer.observeOutbound({ type: "tool_use", tool_name: "Read", tool_use_id: "fast", input: { file_path: "/x/a.ts" } });
    setSystemTime(new Date(1_000_000 + TOOL_DURATION_MS - 1));
    producer.observeOutbound({ type: "tool_result", tool_use_id: "fast" });
    setSystemTime(new Date(1_000_000 + 12_000));
    producer.observeOutbound({ type: "tool_result", tool_use_id: "slow" });
    expect(facts.map((f) => f.fact)).toEqual([
      "Read on a.ts — ok",
      "Bash: cargo build — ok (12s)",
    ]);
  });

  test("TaskCreate and TaskUpdate phrase as task facts, not tool calls", () => {
    const { producer, facts } = harness();
    producer.observeOutbound({ type: "tool_use", tool_name: "TaskCreate", tool_use_id: "t1", input: { subject: "Wire the JOBS cell" } });
    producer.observeOutbound({ type: "tool_use", tool_name: "TaskUpdate", tool_use_id: "t2", input: { taskId: "1", status: "completed" } });
    expect(facts.map((f) => [f.kind, f.fact])).toEqual([
      ["task", 'task added: "Wire the JOBS cell"'],
      ["task", "task marked completed"],
    ]);
  });

  test("job launch + terminal flip recall the description", () => {
    const { producer, facts } = harness();
    producer.observeOutbound({
      type: "task_started",
      task_id: "bkn113zww",
      tool_use_id: "toolu_1",
      description: "bun test full sweep",
    });
    producer.observeOutbound({
      type: "task_updated",
      task_id: "bkn113zww",
      patch: { status: "completed", end_time: 1 },
    });
    expect(facts.map((f) => f.fact)).toEqual([
      "background job launched: bun test full sweep",
      "background job completed: bun test full sweep",
    ]);
    expect(facts.every((f) => f.kind === "job")).toBe(true);
  });

  test("api_retry throttles to attempt 1 then every 5th", () => {
    const { producer, facts } = harness();
    for (let attempt = 1; attempt <= 7; attempt++) {
      producer.observeOutbound({ type: "api_retry", attempt, max_retries: 10, error: "overloaded" });
    }
    const retries = facts.filter((f) => f.kind === "error");
    expect(retries.map((f) => f.fact)).toEqual([
      "API retry 1/10: overloaded",
      "API retry 6/10: overloaded",
    ]);
  });

  test("turn_complete phrases tool count + ok-edited files and resets", () => {
    const { producer, facts } = harness();
    producer.observeOutbound({ type: "tool_use", tool_name: "Read", tool_use_id: "t1", input: { file_path: "/x/a.ts" } });
    producer.observeOutbound({ type: "tool_result", tool_use_id: "t1" });
    producer.observeOutbound({ type: "tool_use", tool_name: "Edit", tool_use_id: "t2", input: { file_path: "/x/b.ts" } });
    producer.observeOutbound({ type: "tool_result", tool_use_id: "t2" });
    producer.observeOutbound({ type: "tool_use", tool_name: "Write", tool_use_id: "t3", input: { file_path: "/x/c.css" } });
    // A FAILED write is not an edited file — the turn-end fact lists
    // only what actually landed.
    producer.observeOutbound({ type: "tool_result", tool_use_id: "t3", is_error: true });
    producer.observeOutbound({ type: "turn_complete", result: "success" });
    expect(facts.at(-1)!.fact).toBe(
      "turn end: 3 tool calls, edited b.ts — success",
    );
    producer.observeOutbound({ type: "turn_complete", result: "success" });
    expect(facts.at(-1)!.fact).toBe("turn end: 0 tool calls — success");
  });

  test("the replay bracket mutes everything between its markers", () => {
    const { producer, facts } = harness();
    producer.observeOutbound({ type: "replay_started" });
    producer.observeOutbound({ type: "task_started", task_id: "x", description: "replayed job" });
    producer.observeOutbound({ type: "turn_complete", result: "success" });
    expect(facts.length).toBe(0);
    producer.observeOutbound({ type: "replay_complete" });
    producer.observeOutbound({ type: "task_started", task_id: "y", description: "live job" });
    expect(facts.length).toBe(1);
    expect(facts[0].fact).toContain("live job");
  });

  test("disabled producer is a no-op; own frames are never re-observed", () => {
    const { producer, facts } = harness(false);
    producer.onTurnStart("anything");
    producer.observeOutbound({ type: "task_started", task_id: "x", description: "job" });
    expect(facts.length).toBe(0);
    const live = harness();
    live.producer.observeOutbound({
      type: "pulse_fact",
      source: "claude-code",
      scope: "s",
      kind: "note",
      fact: "self",
      at: 1,
    });
    expect(live.facts.length).toBe(0);
  });
});
