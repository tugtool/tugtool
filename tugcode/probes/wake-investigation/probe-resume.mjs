#!/usr/bin/env bun
// Resume-mode wake repro: schedule a ScheduleWakeup in a new-mode
// session, kill tugcode before the wake fires, respawn with
// `--session-mode resume`, and verify the wake bracket lands in the
// resumed tugcode's stdout when the harness fires.
//
// What this probe verifies:
//   - Claude's harness scheduler persists scheduled tasks across
//     subprocess restarts (per the docs, unexpired tasks come back
//     with --resume).
//   - tugcode's re-init detector ([D05]) classifies the wake fire
//     correctly in the resumed subprocess.
//   - The wake_started IPC frame reaches the resumed tugcode's
//     stdout — i.e., the bracket opens end-to-end.
//
// Output: capture-resume-{phase1,phase2}-<timestamp>.{stdout,stderr,meta}.

import { spawn } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TUGCODE_BIN =
  "/Users/kocienda/Mounts/u/src/tugtool/tugrust/target/debug/tugcode";
const PROJECT_DIR = "/private/tmp/wake-investigation";
const SESSION_ID = crypto.randomUUID();
const TS = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR =
  "/Users/kocienda/Mounts/u/src/tugtool/tugcode/probes/wake-investigation";

const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;
delete env.CLAUDE_CODE_OAUTH_TOKEN;

const PHASE1_HOLD_SEC = 20; // long enough to register ScheduleWakeup
const PHASE2_HOLD_SEC = 150; // long enough for the wake to fire (60s + jitter to next minute)

console.error(`[probe] session=${SESSION_ID}`);
console.error(`[probe] phase 1: new-mode spawn, schedule wake, hold ${PHASE1_HOLD_SEC}s`);

async function runPhase(phase, args, prompt, holdSec) {
  const base = `capture-resume-${phase}-${TS}`;
  const stdoutLines = [];
  const stderrLines = [];

  console.error(`[probe ${phase}] spawning: tugcode ${args.join(" ")}`);
  const proc = spawn(TUGCODE_BIN, args, {
    cwd: PROJECT_DIR,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stdout.on("data", (c) => {
    const t = new Date().toISOString();
    for (const l of c.toString().split("\n")) if (l) stdoutLines.push(`${t}\t${l}`);
  });
  proc.stderr.on("data", (c) => {
    const t = new Date().toISOString();
    for (const l of c.toString().split("\n")) if (l) stderrLines.push(`${t}\t${l}`);
  });

  let exited = false;
  proc.on("exit", (code, signal) => {
    exited = true;
    console.error(`[probe ${phase}] tugcode exited code=${code} signal=${signal}`);
  });

  // protocol handshake
  await new Promise((r) => setTimeout(r, 1500));
  proc.stdin.write(JSON.stringify({ type: "protocol_init", version: 1 }) + "\n");

  // optional user_message
  if (prompt !== null) {
    await new Promise((r) => setTimeout(r, 500));
    proc.stdin.write(
      JSON.stringify({ type: "user_message", text: prompt, attachments: [] }) + "\n",
    );
    console.error(`[probe ${phase}] sent prompt`);
  }

  // hold
  const start = Date.now();
  const tick = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    console.error(
      `[probe ${phase}] elapsed=${elapsed}s stdout=${stdoutLines.length}`,
    );
  }, 20_000);
  await new Promise((r) => setTimeout(r, holdSec * 1000));
  clearInterval(tick);

  if (!exited) {
    console.error(`[probe ${phase}] killing tugcode`);
    proc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 3000));
    if (!exited) proc.kill("SIGKILL");
  }

  writeFileSync(`${OUT_DIR}/${base}.stdout`, stdoutLines.join("\n") + "\n");
  writeFileSync(`${OUT_DIR}/${base}.stderr`, stderrLines.join("\n") + "\n");
  console.error(`[probe ${phase}] wrote ${base}.{stdout,stderr}`);
  return { base, stdoutLines, stderrLines };
}

// Phase 1: new-mode session, register a ScheduleWakeup, kill before fire.
const phase1 = await runPhase(
  "phase1",
  [
    "--dir",
    PROJECT_DIR,
    "--session-id",
    SESSION_ID,
    "--session-mode",
    "new",
  ],
  "Use ScheduleWakeup with delaySeconds:60 and reason:'PROBE_RESUME'. The wake's prompt should ask you to reply with exactly 'RESUMED_SW fired' and nothing else.",
  PHASE1_HOLD_SEC,
);

// Verify claude persisted the task — the JSONL should exist on disk.
const projectsRoot = join(
  homedir(),
  ".claude",
  "projects",
  "-private-tmp-wake-investigation",
);
const jsonlPath = join(projectsRoot, `${SESSION_ID}.jsonl`);
if (existsSync(jsonlPath)) {
  console.error(`[probe] JSONL persisted at ${jsonlPath}`);
} else {
  console.error(`[probe] WARNING: JSONL NOT found at ${jsonlPath}`);
}

console.error(`[probe] phase 2: respawn with --session-mode resume, hold ${PHASE2_HOLD_SEC}s`);

// Brief pause between phases so claude can fully release the JSONL.
await new Promise((r) => setTimeout(r, 2000));

// Phase 2: resume-mode respawn. Send a nudge user_message ("hi, what's pending?")
// to give claude a first input. Empirically, in stream-json --print mode the
// harness scheduler appears not to tick until at least one turn has run; the
// nudge gives it that opportunity. Once claude responds, it goes idle and the
// harness should fire the unexpired scheduled wake.
const phase2 = await runPhase(
  "phase2",
  [
    "--dir",
    PROJECT_DIR,
    "--session-id",
    SESSION_ID,
    "--session-mode",
    "resume",
    "--resume-session",
    SESSION_ID,
  ],
  "Just resuming. What's pending?",
  PHASE2_HOLD_SEC,
);

// Summarize what we found.
const phase2WakeStartedFrames = phase2.stdoutLines.filter((l) =>
  l.includes('"type":"wake_started"'),
);
const phase2AssistantText = phase2.stdoutLines.filter((l) =>
  l.includes('"type":"assistant_text"'),
);

writeFileSync(
  `${OUT_DIR}/capture-resume-meta-${TS}.json`,
  JSON.stringify(
    {
      sessionId: SESSION_ID,
      phase1: {
        stdoutLines: phase1.stdoutLines.length,
        capture: phase1.base,
      },
      phase2: {
        stdoutLines: phase2.stdoutLines.length,
        wakeStartedCount: phase2WakeStartedFrames.length,
        assistantTextCount: phase2AssistantText.length,
        capture: phase2.base,
      },
      verdict:
        phase2WakeStartedFrames.length > 0
          ? "PASS: wake_started observed on resumed tugcode stdout"
          : "FAIL: no wake_started observed",
    },
    null,
    2,
  ),
);

console.error(
  `[probe] VERDICT: ${phase2WakeStartedFrames.length > 0 ? "PASS" : "FAIL"} ` +
    `(wake_started frames in phase 2: ${phase2WakeStartedFrames.length})`,
);
