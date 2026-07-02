/**
 * session-subagent-lifecycle.test.ts — async-launch detection and the
 * SessionManager's tailer start/stop bookkeeping.
 *
 * `extractAsyncLaunch` is pinned against the REAL captured launch echo
 * from the `subagent-resume` fixture's `main.jsonl` (remapped from the
 * persisted camelCase `toolUseResult` to the live wire's snake_case
 * `tool_use_result` — the exact key `routeTopLevelEvent` reads live).
 * The manager-level tests drive `handleClaudeLine` with raw event
 * lines and observe the private tailer map — real routing, no mocks.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SessionManager, extractAsyncLaunch } from "../session.ts";
import type { SubagentTailer } from "../subagent-tail.ts";

const FIXTURE_MAIN = join(
  import.meta.dir,
  "fixtures",
  "subagent-resume",
  "main.jsonl",
);

const PARENT_TOOL_USE_ID = "toolu_01Rvup4w9HGpYnJ4XHoeV3cK";
const AGENT_ID = "aa523090963dd46d9";

/**
 * The real async-launch echo, reshaped to the live wire: the JSONL
 * persists the structured result as camelCase `toolUseResult`; the
 * live stream delivers it as snake_case `tool_use_result`.
 */
function liveLaunchEcho(): Record<string, unknown> {
  const lines = readFileSync(FIXTURE_MAIN, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  const echo = lines.find((e) => {
    const tur = e.toolUseResult as Record<string, unknown> | undefined;
    return tur?.isAsync === true;
  });
  if (echo === undefined) throw new Error("fixture lost its launch echo");
  const { toolUseResult, ...rest } = echo;
  return { ...rest, tool_use_result: toolUseResult };
}

/** Reach the manager's private surface the tests need. */
interface ManagerInternals {
  handleClaudeLine(line: string): void;
  subagentTailers: Map<string, SubagentTailer>;
}

function makeManager(): ManagerInternals {
  const manager = new SessionManager(
    `/tmp/tugcode-subagent-lifecycle-${Date.now()}`,
    crypto.randomUUID(),
  );
  return manager as unknown as ManagerInternals;
}

describe("extractAsyncLaunch", () => {
  test("returns the trio for the real live-shaped echo", () => {
    const launch = extractAsyncLaunch(liveLaunchEcho());
    expect(launch).toBeDefined();
    expect(launch!.parentToolUseId).toBe(PARENT_TOOL_USE_ID);
    expect(launch!.agentId).toBe(AGENT_ID);
    expect(launch!.outputFile.endsWith(`${AGENT_ID}.output`)).toBe(true);
  });

  test("returns undefined for a foreground / non-async result", () => {
    const echo = liveLaunchEcho();
    const tur = { ...(echo.tool_use_result as Record<string, unknown>) };
    delete tur.isAsync;
    delete tur.status;
    expect(extractAsyncLaunch({ ...echo, tool_use_result: tur })).toBeUndefined();
  });

  test("returns undefined when the linkage or paths are missing", () => {
    const echo = liveLaunchEcho();
    const tur = echo.tool_use_result as Record<string, unknown>;

    // No outputFile → no tailer target.
    expect(
      extractAsyncLaunch({
        ...echo,
        tool_use_result: { ...tur, outputFile: undefined },
      }),
    ).toBeUndefined();
    // No agentId → no map key.
    expect(
      extractAsyncLaunch({
        ...echo,
        tool_use_result: { ...tur, agentId: "" },
      }),
    ).toBeUndefined();
    // No linked tool_result block → no parent id.
    expect(
      extractAsyncLaunch({
        ...echo,
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      }),
    ).toBeUndefined();
    // Replay-shaped event (camelCase key only) is not the live echo.
    const { tool_use_result, ...replayShaped } = echo;
    expect(
      extractAsyncLaunch({ ...replayShaped, toolUseResult: tool_use_result }),
    ).toBeUndefined();
    // Wrong event type.
    expect(
      extractAsyncLaunch({ ...echo, type: "assistant" }),
    ).toBeUndefined();
  });
});

describe("SessionManager tailer lifecycle", () => {
  test("the launch echo starts one tailer; a duplicate echo does not add another", async () => {
    const manager = makeManager();
    const line = JSON.stringify(liveLaunchEcho());
    manager.handleClaudeLine(line);
    expect(manager.subagentTailers.size).toBe(1);
    const tailer = manager.subagentTailers.get(AGENT_ID);
    expect(tailer).toBeDefined();
    expect(tailer!.parentToolUseId).toBe(PARENT_TOOL_USE_ID);
    expect(tailer!.outputFile.endsWith(`${AGENT_ID}.output`)).toBe(true);

    manager.handleClaudeLine(line);
    expect(manager.subagentTailers.size).toBe(1);
    expect(manager.subagentTailers.get(AGENT_ID)).toBe(tailer!);

    await tailer!.stop(false);
    manager.subagentTailers.clear();
  });

  test("a terminal task_updated stops the tailer with a final flush exactly once", async () => {
    const manager = makeManager();
    manager.handleClaudeLine(JSON.stringify(liveLaunchEcho()));
    const tailer = manager.subagentTailers.get(AGENT_ID)!;

    const stops: boolean[] = [];
    const realStop = tailer.stop.bind(tailer);
    (tailer as unknown as { stop(f: boolean): Promise<void> }).stop = (
      finalFlush: boolean,
    ) => {
      stops.push(finalFlush);
      return realStop(finalFlush);
    };

    const completed = JSON.stringify({
      type: "system",
      subtype: "task_updated",
      task_id: AGENT_ID,
      patch: { status: "completed", end_time: 1751400000000 },
    });
    manager.handleClaudeLine(completed);
    expect(manager.subagentTailers.size).toBe(0);
    expect(stops).toEqual([true]);

    // A redelivered completion finds no tailer — stop not called again.
    manager.handleClaudeLine(completed);
    expect(stops).toEqual([true]);
    await realStop(false);
  });

  test("a non-terminal task_updated leaves the tailer running", async () => {
    const manager = makeManager();
    manager.handleClaudeLine(JSON.stringify(liveLaunchEcho()));
    manager.handleClaudeLine(
      JSON.stringify({
        type: "system",
        subtype: "task_updated",
        task_id: AGENT_ID,
        patch: { status: "running" },
      }),
    );
    expect(manager.subagentTailers.size).toBe(1);
    await manager.subagentTailers.get(AGENT_ID)!.stop(false);
    manager.subagentTailers.clear();
  });

  test("the wake task_notification stops the tailer too", async () => {
    const manager = makeManager();
    manager.handleClaudeLine(JSON.stringify(liveLaunchEcho()));
    manager.handleClaudeLine(
      JSON.stringify({
        type: "system",
        subtype: "task_notification",
        task_id: AGENT_ID,
        tool_use_id: PARENT_TOOL_USE_ID,
        status: "completed",
        summary: "done",
      }),
    );
    expect(manager.subagentTailers.size).toBe(0);
  });
});
