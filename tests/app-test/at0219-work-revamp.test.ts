/**
 * at0219-work-revamp.test.ts — the WORK-cell revamp end-to-end
 * ([AT0219]).
 *
 * Drives a bound session card through the four composed behaviors of the
 * revamp and asserts them against the real app's DOM:
 *
 *  - **Aggregate active count.** The Z2 WORK cell reports ONE number
 *    across every category (incomplete tasks + running jobs + scheduled
 *    rows + active goal), not a single-category fraction. Two pending
 *    tasks read "2"; adding a running job and a remote routine reads "4".
 *  - **No turn-boundary flicker.** With a pre-existing incomplete
 *    checklist, opening a new turn whose first streamed block is NOT a
 *    Task* frame must keep the count at "2" — it must never collapse to
 *    "None" (the former turn-gate flicker).
 *  - **RemoteTrigger coverage.** A `RemoteTrigger` `create` folds into
 *    the jobs ledger as a `"remote"` scheduled row, visible in the
 *    popover's Scheduled group and counted by the cell.
 *  - **Honest vocabulary.** The popover's task group header reads
 *    "Tasks", never "Checklist".
 *
 * The 5-minute completion linger's settle timing is validated by the
 * pure-logic unit tests (`countRecentlyDone` / `nextLingerExpiryMs`
 * with an injected clock); it is not re-driven here.
 *
 * Frame-shape notes: a background `task_started` only inserts a
 * jobs-ledger row while its launching `tool_use`
 * (`run_in_background: true`, `task_type: "local_bash"`) is in the
 * IN-FLIGHT turn's scratch; a `RemoteTrigger` folds from its own
 * `tool_use` + `tool_result` (no task frame).
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;
const FEED_CODE_OUTPUT = 0x40;
const SID = "b7c0d1ea-0000-4000-8000-0000000019aa";

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 900, height: 680 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

const f = (decoded: Record<string, unknown>) => ({
  op: "ingestFrame" as const,
  feedId: FEED_CODE_OUTPUT,
  decoded: { tug_session_id: SID, ...decoded },
});

describe.skipIf(!SHOULD_RUN)("AT0219: WORK revamp", () => {
  test(
    "aggregate count, no-flicker persistence, remote scheduled row, Tasks label",
    async () => {
      const app = await launchTugApp({ testName: "at0219-work-revamp" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          { timeoutMs: 15_000 },
        );
        await app.bindSession("A", { tugSessionId: SID });
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-card-id="A"] [data-slot="session-telemetry-status-row"]') !== null`,
          { timeoutMs: 8000 },
        );

        const WORK_LABEL =
          `[data-card-id="A"] [data-slot="tug-status-cell"][data-priority="work"]` +
          ` .tug-progress-indicator-label-active`;
        const workIs = (value: string) =>
          `((document.querySelector('${WORK_LABEL}')||{}).textContent||"").trim() === ${JSON.stringify(value)}`;

        // ---- Turn 1: two pending tasks, nothing else ------------------
        await app.driveSession("A", { op: "send", text: "plan the work" });
        await app.driveSession("A", f({
          type: "assistant_text", msg_id: "m1", text: "Planning.",
          is_partial: true, rev: 0, seq: 0,
        }));
        await app.driveSession("A", f({
          type: "tool_use", msg_id: "m1", tool_use_id: "tc-1",
          tool_name: "TaskCreate",
          input: { subject: "Wire the aggregate count" }, seq: 1,
        }));
        await app.driveSession("A", f({
          type: "tool_result", tool_use_id: "tc-1",
          output: "Task #1 created successfully: Wire the aggregate count",
        }));
        await app.driveSession("A", f({
          type: "tool_use", msg_id: "m1", tool_use_id: "tc-2",
          tool_name: "TaskCreate",
          input: { subject: "Land the linger" }, seq: 2,
        }));
        await app.driveSession("A", f({
          type: "tool_result", tool_use_id: "tc-2",
          output: "Task #2 created successfully: Land the linger",
        }));
        await app.driveSession("A", f({
          type: "turn_complete", msg_id: "m1", result: "success",
        }));

        // WORK cell = 2 incomplete tasks (aggregate, not a fraction).
        await app.waitForCondition<boolean>(workIs("2"), { timeoutMs: 8000 });

        // ---- Turn 2 opens with NO Task* frame — the checklist must
        // persist. Pre-fix the turn-gate would collapse this to "None";
        // reaching "2" here is the flicker regression guard.
        await app.driveSession("A", { op: "send", text: "keep going" });
        await app.driveSession("A", f({
          type: "assistant_text", msg_id: "m2", text: "Working.",
          is_partial: true, rev: 0, seq: 0,
        }));
        await app.waitForCondition<boolean>(workIs("2"), { timeoutMs: 8000 });

        // ---- A running background job + a RemoteTrigger routine -------
        await app.driveSession("A", f({
          type: "tool_use", msg_id: "m2", tool_use_id: "job-1",
          tool_name: "Bash",
          input: { command: "make release", run_in_background: true }, seq: 2,
        }));
        await app.driveSession("A", f({
          type: "task_started", task_id: "bg1", tool_use_id: "job-1",
          description: "Release build (background)", task_type: "local_bash",
        }));
        await app.driveSession("A", f({
          type: "tool_result", tool_use_id: "job-1", output: "launched",
        }));
        await app.driveSession("A", f({
          type: "tool_use", msg_id: "m2", tool_use_id: "rt-1",
          tool_name: "RemoteTrigger",
          input: { action: "create", body: { schedule: "0 9 * * *", prompt: "Daily digest" } },
          seq: 3,
        }));
        await app.driveSession("A", f({
          type: "tool_result", tool_use_id: "rt-1",
          output: '{"id":"rtn-42","enabled":true}\nNext run tomorrow at 9am',
        }));

        // active = 2 tasks + 1 running job + 1 remote scheduled = 4.
        await app.waitForCondition<boolean>(workIs("4"), { timeoutMs: 8000 });

        // ---- WORK popover: Tasks/Running/Scheduled groups + remote row -
        const cell =
          `[data-card-id="A"] [data-slot="tug-status-cell"][data-priority="work"]`;
        const POPUP = `[data-slot="tug-popup-list"]`;
        await app.click(cell);
        await app.waitForCondition<boolean>(
          `(() => {
            const el = document.querySelector('${POPUP}');
            if (el === null) return false;
            const s = window.getComputedStyle(el.closest('[data-radix-popper-content-wrapper]') || el);
            return Number(s.opacity) === 1;
          })()`,
          { timeoutMs: 5000 },
        );
        const probeRaw = await app.evalJS<string>(`JSON.stringify((() => {
          const popup = document.querySelector('${POPUP}');
          return {
            groups: Array.from(popup.querySelectorAll('.tug-popup-list-group-label')).map(e => (e.textContent||'').trim()),
            kinds: Array.from(popup.querySelectorAll('.session-jobs-popover-kind')).map(e => (e.textContent||'').trim()),
          };
        })())`);
        const probe = JSON.parse(probeRaw);
        expect(probe.groups).toContain("Tasks");
        expect(probe.groups).toContain("Running");
        expect(probe.groups).toContain("Scheduled");
        expect(probe.groups).not.toContain("Checklist");
        expect(probe.kinds).toContain("remote");

        process.stdout.write("VERDICT: PASS\n");
      } catch (err) {
        process.stdout.write("VERDICT: FAIL\n");
        const tail = app.tailLog(120);
        if (tail !== "") process.stderr.write(`\n[at0219] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
