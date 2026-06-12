/**
 * Pure-logic tests for the background-jobs helpers in `select-jobs.ts`.
 *
 * Frame fixtures mirror the tugcode IPC layer (snake_case, `patch`
 * already flattened by `buildTaskUpdatedMessage`), whose shape is
 * pinned against the captured wire reality in
 * `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/`
 * `v2.1.173-jobs-spike/`.
 */

import { describe, test, expect } from "bun:test";

import {
  applyJobFlip,
  clearTerminalJobs,
  composeJobsSummary,
  countJobs,
  insertJob,
  isJobLaunch,
  jobsCellPose,
  jobKindForLaunch,
  jobKindFromTaskType,
  markRunningJobsStopped,
  narrowTaskStartedFrame,
  narrowTaskUpdatedFrame,
  parseBackgroundLaunchResult,
  terminalJobStatusFromWire,
  type JobItem,
} from "../select-jobs";

function job(overrides: Partial<JobItem> & { jobId: string }): JobItem {
  return {
    source: "claude",
    kind: "bash",
    toolUseId: `toolu_${overrides.jobId}`,
    description: "",
    status: "running",
    startedAtMs: 1_000,
    endedAtMs: null,
    ...overrides,
  };
}

// Wire-faithful IPC frames (the tugcode forwarding layer's output).
const BASH_STARTED = {
  type: "task_started",
  session_id: "c78bbf56-1133-49e2-ab57-5b9188249033",
  task_id: "bkn113zww",
  tool_use_id: "toolu_012yovB8JX9CnEX39ngvSEEa",
  description: "Sleep 6 seconds then echo marker",
  task_type: "local_bash",
  ipc_version: 2,
  tug_session_id: "tug-1",
};

const AGENT_STARTED = {
  type: "task_started",
  session_id: "c78bbf56-1133-49e2-ab57-5b9188249033",
  task_id: "ab5660790736ebc09",
  tool_use_id: "toolu_01UfQkA3tVuCDKDrLSVCNULX",
  description: "Background bash echo probe",
  task_type: "local_agent",
  subagent_type: "general-purpose",
  ipc_version: 2,
};

const UPDATED_COMPLETED = {
  type: "task_updated",
  session_id: "c78bbf56-1133-49e2-ab57-5b9188249033",
  task_id: "bkn113zww",
  status: "completed",
  end_time: 1781226041319,
  ipc_version: 2,
};

describe("narrowTaskStartedFrame", () => {
  test("narrows a bash launch frame to camelCase", () => {
    const ev = narrowTaskStartedFrame(BASH_STARTED);
    expect(ev).toEqual({
      type: "task_started",
      taskId: "bkn113zww",
      toolUseId: "toolu_012yovB8JX9CnEX39ngvSEEa",
      description: "Sleep 6 seconds then echo marker",
      taskType: "local_bash",
      tug_session_id: "tug-1",
    });
  });

  test("narrows an agent frame, carrying subagentType", () => {
    const ev = narrowTaskStartedFrame(AGENT_STARTED);
    expect(ev?.taskType).toBe("local_agent");
    expect(ev?.subagentType).toBe("general-purpose");
  });

  test("rejects wrong type and missing required ids", () => {
    expect(narrowTaskStartedFrame({ type: "task_updated" })).toBeUndefined();
    expect(
      narrowTaskStartedFrame({ ...BASH_STARTED, task_id: undefined }),
    ).toBeUndefined();
    expect(
      narrowTaskStartedFrame({ ...BASH_STARTED, tool_use_id: "" }),
    ).toBeUndefined();
  });
});

describe("narrowTaskUpdatedFrame", () => {
  test("narrows a status flip, carrying endTime", () => {
    const ev = narrowTaskUpdatedFrame(UPDATED_COMPLETED);
    expect(ev).toEqual({
      type: "task_updated",
      taskId: "bkn113zww",
      status: "completed",
      endTime: 1781226041319,
    });
  });

  test("accepts the full observed status vocabulary", () => {
    for (const status of ["completed", "failed", "killed"]) {
      const ev = narrowTaskUpdatedFrame({ ...UPDATED_COMPLETED, status });
      expect(ev?.status).toBe(status);
    }
  });

  test("omits endTime when absent and rejects missing required fields", () => {
    const noEnd = narrowTaskUpdatedFrame({
      ...UPDATED_COMPLETED,
      end_time: undefined,
    });
    expect(noEnd).toBeDefined();
    expect("endTime" in noEnd!).toBe(false);
    expect(
      narrowTaskUpdatedFrame({ ...UPDATED_COMPLETED, task_id: "" }),
    ).toBeUndefined();
    expect(
      narrowTaskUpdatedFrame({ ...UPDATED_COMPLETED, status: undefined }),
    ).toBeUndefined();
  });
});

// Captured launch echoes (v2.1.173-jobs-spike), trimmed to the parsed spans.
const BASH_ECHO =
  "Command running in background with ID: bkn113zww. Output is being written" +
  " to: /private/tmp/claude-501/x/tasks/bkn113zww.output. You will be" +
  " notified when it completes.";
const AGENT_ECHO = [
  {
    type: "text",
    text:
      "Async agent launched successfully.\nagentId: ab5660790736ebc09 " +
      "(internal ID - do not mention to user.)\nThe agent is working in " +
      "the background.\noutput_file: /private/tmp/claude-501/x/tasks/" +
      "ab5660790736ebc09.output\nDo NOT Read or tail this file.",
  },
];

describe("parseBackgroundLaunchResult", () => {
  test("parses the bash echo (id + output file)", () => {
    const echo = parseBackgroundLaunchResult(BASH_ECHO);
    expect(echo).toEqual({
      jobId: "bkn113zww",
      kind: "bash",
      outputFile: "/private/tmp/claude-501/x/tasks/bkn113zww.output",
    });
  });

  test("parses the async-agent echo (agentId + output_file)", () => {
    const echo = parseBackgroundLaunchResult(AGENT_ECHO);
    expect(echo).toEqual({
      jobId: "ab5660790736ebc09",
      kind: "agent",
      outputFile: "/private/tmp/claude-501/x/tasks/ab5660790736ebc09.output",
    });
  });

  test("returns undefined for foreground results and non-matching text", () => {
    expect(parseBackgroundLaunchResult("file1\nfile2")).toBeUndefined();
    // A FOREGROUND agent result also mentions agentId but not the
    // async-launch banner — it must not parse as a launch.
    expect(
      parseBackgroundLaunchResult([
        { type: "text", text: "JOBS_P5_FG" },
        { type: "text", text: "agentId: ac57e6163e2ab0290 (use SendMessage)" },
      ]),
    ).toBeUndefined();
    expect(parseBackgroundLaunchResult(null)).toBeUndefined();
    expect(parseBackgroundLaunchResult(42)).toBeUndefined();
  });
});

describe("status + kind mapping", () => {
  test("terminalJobStatusFromWire maps the observed vocabulary and drops unknowns", () => {
    expect(terminalJobStatusFromWire("completed")).toBe("completed");
    expect(terminalJobStatusFromWire("failed")).toBe("failed");
    expect(terminalJobStatusFromWire("killed")).toBe("stopped");
    expect(terminalJobStatusFromWire("stopped")).toBe("stopped");
    expect(terminalJobStatusFromWire("running")).toBeUndefined();
    expect(terminalJobStatusFromWire("paused")).toBeUndefined();
  });

  test("jobKindFromTaskType maps local_bash / local_agent, unknown otherwise", () => {
    expect(jobKindFromTaskType("local_bash")).toBe("bash");
    expect(jobKindFromTaskType("local_agent")).toBe("agent");
    expect(jobKindFromTaskType("remote_thing")).toBe("unknown");
  });
});

describe("ledger updates", () => {
  test("insertJob appends fresh ids in insertion order", () => {
    const a = job({ jobId: "a" });
    const b = job({ jobId: "b" });
    const ledger = insertJob(insertJob([], a), b);
    expect(ledger.map((j) => j.jobId)).toEqual(["a", "b"]);
  });

  test("insertJob enriches an existing row instead of duplicating (either arrival order)", () => {
    // task_started first (no outputFile), echo second (with outputFile).
    const fromFrame = job({ jobId: "a", description: "Sleep then echo" });
    const fromEcho = job({ jobId: "a", outputFile: "/tmp/a.out", description: "" });
    let ledger = insertJob([fromFrame], fromEcho);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].description).toBe("Sleep then echo");
    expect(ledger[0].outputFile).toBe("/tmp/a.out");
    // Identical re-insert returns the same reference.
    expect(insertJob(ledger, fromEcho)).toBe(ledger);
  });

  test("applyJobFlip flips only running rows; first terminal flip wins; unknown ids no-op", () => {
    const ledger = [job({ jobId: "a" })];
    const flipped = applyJobFlip(ledger, "a", "failed", 2_000);
    expect(flipped[0].status).toBe("failed");
    expect(flipped[0].endedAtMs).toBe(2_000);
    // Second flip (e.g. wake trigger after task_updated) is a no-op.
    expect(applyJobFlip(flipped, "a", "completed", 3_000)).toBe(flipped);
    expect(applyJobFlip(ledger, "zzz", "completed", 3_000)).toBe(ledger);
  });

  test("markRunningJobsStopped flips every running row and nothing else", () => {
    const ledger = [
      job({ jobId: "a" }),
      job({ jobId: "b", status: "completed", endedAtMs: 1_500 }),
      job({ jobId: "c" }),
    ];
    const marked = markRunningJobsStopped(ledger, 9_000);
    expect(marked.map((j) => j.status)).toEqual(["stopped", "completed", "stopped"]);
    expect(marked[1].endedAtMs).toBe(1_500);
    // No running rows → same reference.
    expect(markRunningJobsStopped(marked, 9_999)).toBe(marked);
  });

  test("clearTerminalJobs drops finished rows, keeps running, no-ops when nothing to drop", () => {
    const running = job({ jobId: "a" });
    const ledger = [
      running,
      job({ jobId: "b", status: "failed", endedAtMs: 2_000 }),
      job({ jobId: "c", status: "stopped", endedAtMs: 2_500 }),
    ];
    const cleared = clearTerminalJobs(ledger);
    expect(cleared).toEqual([running]);
    expect(clearTerminalJobs(cleared)).toBe(cleared);
  });
});

describe("display derivation", () => {
  test("countJobs buckets statuses and computes finished/total", () => {
    const counts = countJobs([
      job({ jobId: "a" }),
      job({ jobId: "b", status: "completed", endedAtMs: 1 }),
      job({ jobId: "c", status: "failed", endedAtMs: 1 }),
      job({ jobId: "d", status: "stopped", endedAtMs: 1 }),
    ]);
    expect(counts).toEqual({
      total: 4,
      running: 1,
      watching: 0,
      completed: 1,
      failed: 1,
      stopped: 1,
      finished: 3,
    });
  });

  test("jobsCellPose: empty→stopped, running wins, failed→aborted, else completed — no phase input", () => {
    expect(jobsCellPose([])).toBe("stopped");
    expect(jobsCellPose([job({ jobId: "a" })])).toBe("running");
    // A running row outranks a failed one (new work supersedes the
    // danger pose); failure shows once nothing is running.
    expect(
      jobsCellPose([
        job({ jobId: "a" }),
        job({ jobId: "b", status: "failed", endedAtMs: 1 }),
      ]),
    ).toBe("running");
    expect(
      jobsCellPose([
        job({ jobId: "a", status: "completed", endedAtMs: 1 }),
        job({ jobId: "b", status: "failed", endedAtMs: 1 }),
      ]),
    ).toBe("aborted");
    expect(
      jobsCellPose([
        job({ jobId: "a", status: "completed", endedAtMs: 1 }),
        job({ jobId: "b", status: "stopped", endedAtMs: 1 }),
      ]),
    ).toBe("completed");
  });

  test("composeJobsSummary drops zero buckets", () => {
    expect(composeJobsSummary(countJobs([]))).toBe("no jobs");
    expect(
      composeJobsSummary(
        countJobs([
          job({ jobId: "a" }),
          job({ jobId: "b", status: "completed", endedAtMs: 1 }),
          job({ jobId: "c", status: "completed", endedAtMs: 1 }),
          job({ jobId: "d", status: "failed", endedAtMs: 1 }),
        ]),
      ),
    ).toBe("1 running, 2 done, 1 failed");
  });
});

// Captured monitor launch echoes (test-monitor-lifecycle-raw.jsonl).
const MONITOR_ECHO_TIMEOUT =
  "Monitor started (task b45wg0dww, timeout 60000ms). You will be notified" +
  " on each event. Keep working — do not poll or sleep.";
const MONITOR_ECHO_PERSISTENT =
  "Monitor started (task be0zn8grq, persistent — runs until TaskStop or" +
  " session end). You will be notified on each event.";

describe("monitor launch gate and kind", () => {
  test("isJobLaunch admits backgrounded calls and Monitor, rejects the rest", () => {
    expect(isJobLaunch("Bash", { run_in_background: true })).toBe(true);
    expect(isJobLaunch("Agent", { run_in_background: true })).toBe(true);
    expect(isJobLaunch("Monitor", { command: "tail -f x", timeout_ms: 5000 })).toBe(
      true,
    );
    expect(isJobLaunch("Monitor", null)).toBe(true);
    expect(isJobLaunch("Agent", { prompt: "hi" })).toBe(false);
    expect(isJobLaunch("Bash", null)).toBe(false);
  });

  test("jobKindForLaunch: Monitor wins over the local_bash task_type ambiguity", () => {
    // A watcher's frame reports local_bash (its script is a shell
    // command) — the tool name is the only honest discriminant.
    expect(jobKindForLaunch("Monitor", "local_bash")).toBe("monitor");
    expect(jobKindForLaunch("Bash", "local_bash")).toBe("bash");
    expect(jobKindForLaunch("Agent", "local_agent")).toBe("agent");
    expect(jobKindForLaunch("Bash", "weird")).toBe("unknown");
  });
});

describe("monitor launch echo", () => {
  test("parses both captured forms (timeout and persistent), no output file", () => {
    expect(parseBackgroundLaunchResult(MONITOR_ECHO_TIMEOUT)).toEqual({
      jobId: "b45wg0dww",
      kind: "monitor",
    });
    expect(parseBackgroundLaunchResult(MONITOR_ECHO_PERSISTENT)).toEqual({
      jobId: "be0zn8grq",
      kind: "monitor",
    });
  });

  test("bash and agent echoes still parse unchanged", () => {
    expect(parseBackgroundLaunchResult(BASH_ECHO)?.kind).toBe("bash");
    expect(parseBackgroundLaunchResult(AGENT_ECHO)?.kind).toBe("agent");
  });
});

describe("watching bucket", () => {
  test("countJobs separates live watchers; finished/pose semantics unchanged", () => {
    const ledger = [
      job({ jobId: "a" }),
      job({ jobId: "m", kind: "monitor" }),
      job({ jobId: "b", status: "completed", endedAtMs: 1 }),
    ];
    const counts = countJobs(ledger);
    expect(counts.running).toBe(2);
    expect(counts.watching).toBe(1);
    expect(counts.finished).toBe(1);
    expect(jobsCellPose(ledger)).toBe("running");
  });

  test("composeJobsSummary splits watching out of running with zero-drop", () => {
    expect(
      composeJobsSummary(
        countJobs([
          job({ jobId: "a" }),
          job({ jobId: "m", kind: "monitor" }),
          job({ jobId: "b", status: "completed", endedAtMs: 1 }),
        ]),
      ),
    ).toBe("1 running, 1 watching, 1 done");
    // Watchers only — no vestigial "0 running".
    expect(
      composeJobsSummary(countJobs([job({ jobId: "m", kind: "monitor" })])),
    ).toBe("1 watching");
    // A finished watcher counts as done, not watching.
    expect(
      composeJobsSummary(
        countJobs([
          job({ jobId: "m", kind: "monitor", status: "completed", endedAtMs: 1 }),
        ]),
      ),
    ).toBe("1 done");
  });
});
