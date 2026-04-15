/**
 * Tests for the golden fixture loader (Step 2).
 *
 * Exercises: field distinctness of session/tug/msg ids on test-01,
 * multi-tool id grouping on test-07 (two logical ids), single-tool
 * grouping on test-05, the missing-fixture readable error, and the
 * empty-fixture guard for the skipped test-35 entry.
 */

import { describe, it, expect } from "bun:test";

import {
  loadGoldenProbe,
  FIXTURE_IDS,
} from "@/lib/code-session-store/testing/golden-catalog";

describe("loadGoldenProbe — v2.1.105/test-01-basic-round-trip", () => {
  const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");

  it("parses the session_init event with distinct session vs tug ids", () => {
    const sessionInit = probe.events.find((e) => e.type === "session_init");
    expect(sessionInit).toBeDefined();
    expect(sessionInit!.session_id).toBe(FIXTURE_IDS.CLAUDE_SESSION_ID);
    expect(sessionInit!.tug_session_id).toBe(FIXTURE_IDS.TUG_SESSION_ID);
    expect(sessionInit!.session_id).not.toBe(sessionInit!.tug_session_id);
  });

  it("assigns the canonical MSG_ID to a single-turn probe", () => {
    const assistantText = probe.events.find(
      (e) => e.type === "assistant_text",
    );
    expect(assistantText).toBeDefined();
    expect(assistantText!.msg_id).toBe(FIXTURE_IDS.MSG_ID);
    expect(probe.idMap.msgIds).toEqual([FIXTURE_IDS.MSG_ID]);
  });

  it("substitutes {{cwd}} with the pinned fixture path", () => {
    const systemMetadata = probe.events.find(
      (e) => e.type === "system_metadata",
    );
    expect(systemMetadata).toBeDefined();
    expect(typeof systemMetadata!.cwd).toBe("string");
    expect((systemMetadata!.cwd as string).startsWith(FIXTURE_IDS.CWD)).toBe(
      true,
    );
  });

  it("substitutes {{f64}} and {{i64}} to numeric literals", () => {
    const costUpdate = probe.events.find((e) => e.type === "cost_update");
    expect(costUpdate).toBeDefined();
    expect(typeof costUpdate!.total_cost_usd).toBe("number");
    expect(costUpdate!.total_cost_usd).toBe(0);
    expect(typeof costUpdate!.duration_ms).toBe("number");
  });

  it("expands {{text:len=N}} to N repeated characters", () => {
    const complete = probe.events.find(
      (e) => e.type === "assistant_text" && e.is_partial === false,
    );
    expect(complete).toBeDefined();
    expect(typeof complete!.text).toBe("string");
    const text = complete!.text as string;
    expect(text.length).toBeGreaterThan(0);
    expect(/^x+$/.test(text)).toBe(true);
  });
});

describe("loadGoldenProbe — v2.1.105/test-05-tool-use-read", () => {
  const probe = loadGoldenProbe("v2.1.105", "test-05-tool-use-read");

  it("resolves a single logical tool call to the canonical TOOL_USE_ID", () => {
    expect(probe.idMap.toolUseIds).toEqual([FIXTURE_IDS.TOOL_USE_ID]);

    const toolEvents = probe.events.filter(
      (e) =>
        e.type === "tool_use" ||
        e.type === "tool_result" ||
        e.type === "tool_use_structured",
    );
    for (const ev of toolEvents) {
      expect(ev.tool_use_id).toBe(FIXTURE_IDS.TOOL_USE_ID);
    }
  });
});

describe("loadGoldenProbe — v2.1.105/test-07-multiple-tool-calls", () => {
  const probe = loadGoldenProbe("v2.1.105", "test-07-multiple-tool-calls");

  it("resolves exactly two distinct logical tool_use_ids", () => {
    expect(probe.idMap.toolUseIds.length).toBe(2);
    expect(probe.idMap.toolUseIds[0]).not.toBe(probe.idMap.toolUseIds[1]);
    expect(probe.idMap.toolUseIds[0]).toBe(FIXTURE_IDS.TOOL_USE_ID_N(1));
    expect(probe.idMap.toolUseIds[1]).toBe(FIXTURE_IDS.TOOL_USE_ID_N(2));
  });

  it("assigns overlapping tool_use_ids per Spec S06 grouping heuristics", () => {
    // Event indices are computed from the fixture layout:
    //   0: session_init
    //   1: system_metadata
    //   2: tool_use input={}   — opens logical call A
    //   3: tool_use input=full — A continuation (LIFO pop)
    //   4: tool_use input={}   — opens logical call B
    //   5: tool_result         — resolves A (FIFO from completeInput)
    //   6: tool_use_structured — binds to last resolved = A
    //   7: tool_use input=full — B continuation
    //   8: tool_result         — resolves B
    //   9: tool_use_structured — binds to B
    const idA = FIXTURE_IDS.TOOL_USE_ID_N(1);
    const idB = FIXTURE_IDS.TOOL_USE_ID_N(2);

    expect(probe.events[2].tool_use_id).toBe(idA);
    expect(probe.events[3].tool_use_id).toBe(idA);
    expect(probe.events[4].tool_use_id).toBe(idB);
    expect(probe.events[5].tool_use_id).toBe(idA);
    expect(probe.events[6].tool_use_id).toBe(idA);
    expect(probe.events[7].tool_use_id).toBe(idB);
    expect(probe.events[8].tool_use_id).toBe(idB);
    expect(probe.events[9].tool_use_id).toBe(idB);
  });

  it("shares tug_session_id across every event in the probe", () => {
    for (const ev of probe.events) {
      if (ev.tug_session_id !== undefined) {
        expect(ev.tug_session_id).toBe(FIXTURE_IDS.TUG_SESSION_ID);
      }
    }
  });
});

describe("loadGoldenProbe — error paths", () => {
  it("throws a readable error with the resolved absolute path on a missing fixture", () => {
    let err: Error | null = null;
    try {
      loadGoldenProbe("v2.1.105", "does-not-exist");
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toContain("fixture");
    expect(err!.message).toContain("does-not-exist.jsonl");
    expect(err!.message).toContain(
      "tugrust/crates/tugcast/tests/fixtures/stream-json-catalog",
    );
  });

  it("throws an 'empty fixture' error for the skipped test-35 probe", () => {
    let err: Error | null = null;
    try {
      loadGoldenProbe("v2.1.105", "test-35-askuserquestion-flow");
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toContain("empty fixture");
  });
});
