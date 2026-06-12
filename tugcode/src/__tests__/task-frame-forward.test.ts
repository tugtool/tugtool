/**
 * Background-task lifecycle frame forwarding.
 *
 * Pins `buildTaskStartedMessage` / `buildTaskUpdatedMessage` and their
 * in-turn routing against the captured wire reality in
 * `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/`
 * `v2.1.173-jobs-spike/test-jobs-lifecycle-raw.jsonl` — the factories
 * are exercised on the fixture's actual `system/task_started` and
 * `system/task_updated` lines, so a claude-side shape drift surfaces
 * here as a failure rather than as silently dropped frames.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildTaskStartedMessage,
  buildTaskUpdatedMessage,
  routeTopLevelEvent,
  type EventMappingContext,
} from "../session.ts";

const FIXTURE_PATH = join(
  import.meta.dir,
  "../../../tugrust/crates/tugcast/tests/fixtures/stream-json-catalog",
  "v2.1.173-jobs-spike/test-jobs-lifecycle-raw.jsonl",
);

function fixtureEvents(): Array<Record<string, unknown>> {
  return readFileSync(FIXTURE_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const baseCtx: EventMappingContext = { msgId: "m1", seq: 1, rev: 0 };

describe("buildTaskStartedMessage", () => {
  test("forwards every captured task_started line (bash and agent kinds)", () => {
    const started = fixtureEvents().filter(
      (e) => e.type === "system" && e.subtype === "task_started",
    );
    expect(started.length).toBeGreaterThanOrEqual(6);
    const kinds = new Set<string>();
    for (const event of started) {
      const frame = buildTaskStartedMessage(event, "sess-1");
      expect(frame).not.toBeNull();
      expect(frame!.type).toBe("task_started");
      expect(frame!.session_id).toBe("sess-1");
      expect(frame!.task_id.length).toBeGreaterThan(0);
      expect(frame!.tool_use_id.startsWith("toolu_")).toBe(true);
      expect(frame!.task_type.length).toBeGreaterThan(0);
      expect(frame!.ipc_version).toBe(2);
      kinds.add(frame!.task_type);
      if (frame!.task_type === "local_agent") {
        expect(typeof frame!.subagent_type).toBe("string");
      }
    }
    // The capture covers both task kinds.
    expect(kinds.has("local_bash")).toBe(true);
    expect(kinds.has("local_agent")).toBe(true);
  });

  test("rejects non-matching and malformed events", () => {
    expect(buildTaskStartedMessage({ type: "system", subtype: "init" }, "s")).toBeNull();
    expect(
      buildTaskStartedMessage({ type: "result", subtype: "task_started" }, "s"),
    ).toBeNull();
    expect(
      buildTaskStartedMessage(
        { type: "system", subtype: "task_started", tool_use_id: "toolu_x" },
        "s",
      ),
    ).toBeNull();
    expect(
      buildTaskStartedMessage(
        { type: "system", subtype: "task_started", task_id: "t1" },
        "s",
      ),
    ).toBeNull();
  });
});

describe("buildTaskUpdatedMessage", () => {
  test("flattens every captured task_updated patch (completed / failed / killed)", () => {
    const updated = fixtureEvents().filter(
      (e) => e.type === "system" && e.subtype === "task_updated",
    );
    expect(updated.length).toBeGreaterThanOrEqual(5);
    const statuses = new Set<string>();
    for (const event of updated) {
      const frame = buildTaskUpdatedMessage(event, "sess-1");
      expect(frame).not.toBeNull();
      expect(frame!.type).toBe("task_updated");
      expect(frame!.task_id.length).toBeGreaterThan(0);
      expect(typeof frame!.end_time).toBe("number");
      expect(frame!.ipc_version).toBe(2);
      statuses.add(frame!.status);
    }
    // The capture covers the full observed status vocabulary.
    expect(statuses).toEqual(new Set(["completed", "failed", "killed"]));
  });

  test("rejects events missing task_id or patch.status", () => {
    expect(
      buildTaskUpdatedMessage(
        { type: "system", subtype: "task_updated", patch: { status: "completed" } },
        "s",
      ),
    ).toBeNull();
    expect(
      buildTaskUpdatedMessage(
        { type: "system", subtype: "task_updated", task_id: "t1", patch: {} },
        "s",
      ),
    ).toBeNull();
    expect(
      buildTaskUpdatedMessage(
        { type: "system", subtype: "task_updated", task_id: "t1" },
        "s",
      ),
    ).toBeNull();
  });
});

describe("in-turn routing", () => {
  test("routeTopLevelEvent emits task_started / task_updated IPC frames", () => {
    const events = fixtureEvents();
    const started = events.find(
      (e) => e.type === "system" && e.subtype === "task_started",
    )!;
    const updated = events.find(
      (e) => e.type === "system" && e.subtype === "task_updated",
    )!;

    const startedResult = routeTopLevelEvent(started, baseCtx);
    expect(startedResult.messages).toHaveLength(1);
    expect(startedResult.messages[0]!.type).toBe("task_started");

    const updatedResult = routeTopLevelEvent(updated, baseCtx);
    expect(updatedResult.messages).toHaveLength(1);
    expect(updatedResult.messages[0]!.type).toBe("task_updated");
  });

  test("malformed task frames route to zero messages, not a throw", () => {
    const result = routeTopLevelEvent(
      { type: "system", subtype: "task_started", session_id: "s" },
      baseCtx,
    );
    expect(result.messages).toHaveLength(0);
  });
});
