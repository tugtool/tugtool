#!/usr/bin/env node
// Probe: PULSE commentator voice — drives one persistent Haiku session
// (the daemon model: a single conversation narrating every beat) with
// scripted beat digests and judges the replies.
//
// What this pins:
//   - the commentator system prompt (iterated here, then frozen into
//     the daemon as a constant)
//   - the beat digest format (scope-tagged fact groups)
//   - per-beat wall-clock latency against the ~4s stale-drop window
//   - PASS behavior on uneventful beats
//   - two-scope interleaving coherence
//   - the minimal driving surface: init + user sends + result reads,
//     no control traffic expected under plan mode
//
// Usage: bun probe-pulse-voice.mjs [output.jsonl]
//
// The raw stream-json capture lands at output.jsonl; a per-beat
// summary (latency, reply, shape verdicts) prints to stderr.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const outPath = process.argv[2] || "/tmp/pulse-voice-probe/raw.jsonl";
const cwd = "/tmp/pulse-voice-probe-cwd";
mkdirSync(cwd, { recursive: true });
mkdirSync(dirname(outPath), { recursive: true });

// ---------------------------------------------------------------------------
// The candidate system prompt. Iterate HERE; the final text moves into
// the daemon verbatim.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  "You are PULSE, the color commentator on an AI coding assistant at",
  "work. Your audience is the developer who gave the assistant its",
  "instructions; your job is the look behind the scenes — what the",
  "assistant, its tools, its subagents, and its background jobs are",
  "DOING to carry the work out: the approach taking shape, progress,",
  "detours, errors and recoveries, interesting choices.",
  "",
  "You have no tools — never attempt to investigate anything; everything",
  "you know arrives in the digests. Each user message is a beat digest:",
  "factual lines about the assistant's actions, grouped under scope tags",
  "like [a1b2]. A line starting \"context:\" is the developer's standing",
  "request — use it to interpret the work, but NEVER restate, summarize,",
  "or echo it: the developer wrote it and knows what they asked.",
  "Narrate only the execution.",
  "",
  "THE DIGEST IS YOUR ONLY SOURCE OF TRUTH. Every fact states what",
  "actually happened — \"ok\" means it succeeded, \"failed\" means it",
  "failed. Never assert anything the digest does not state: no guessed",
  "outcomes, no invented errors, no speculation about availability or",
  "causes. If you cannot say something true and grounded, say PASS.",
  "",
  "Reply with EXACTLY ONE plain-text line — aim for 60–90 characters,",
  "never exceed 110. Your DEFAULT IS TO SPEAK — every beat deserves a",
  "line unless it genuinely adds nothing your previous lines didn't",
  "already carry. Reply with exactly PASS for those nothing-new beats.",
  "Never invent drama; quiet specificity beats hype.",
  "",
  "When you speak:",
  "- Present tense. Name specifics: files, commands, counts, durations.",
  "- Say what the assistant's actions MEAN — the approach, the pattern",
  "  in a burst of calls, a reversal, a milestone — not a restatement",
  "  of single events. Repeated calls on one file read as a struggle or",
  "  a sweep; a burst of reads before an edit reads as reconnaissance;",
  "  say so.",
  "- Never repeat information any of your previous lines already carried.",
  "- When two scopes appear, weave them or pick the more notable one.",
  "- No filler, no hype, no emoji, no markdown, no surrounding quotes.",
].join("\n");

// ---------------------------------------------------------------------------
// Scripted beats — a believable two-card session. Scope tags use short
// ids the way the daemon's digests will. Beats marked expectPass are
// deliberately uneventful.
// ---------------------------------------------------------------------------

const BEATS = [
  {
    label: "turn start",
    digest:
      "[a1b2]\n- turn start: user asked \"track background jobs in a JOBS status cell on the Z2 row\"",
  },
  {
    label: "read burst",
    digest:
      "[a1b2]\n- tool burst: Read dev-card-telemetry-renderers.tsx, Read reducer.ts, Grep \"task_started\"",
  },
  {
    label: "task list up",
    digest:
      "[a1b2]\n- task list created: 4 tasks (ledger selectors; reducer handlers; JOBS cell; popover)\n- task 1 in progress",
  },
  {
    label: "first edit",
    digest: "[a1b2]\n- Write select-jobs.ts (new file, 210 lines)",
  },
  {
    label: "job launch",
    digest:
      "[a1b2]\n- background job launched: bun test (full sweep) in a background shell",
  },
  {
    label: "routine read",
    expectPass: true,
    digest: "[a1b2]\n- Read reducer.ts (second read this turn)",
  },
  {
    label: "tests green + task done",
    digest:
      "[a1b2]\n- background job finished: bun test completed in 14s, 3546 passing\n- task 1 completed; task 2 in progress",
  },
  {
    label: "routine grep",
    expectPass: true,
    digest: "[a1b2]\n- Grep \"applyJobFlip\" (1 match)",
  },
  {
    label: "type error",
    digest:
      "[a1b2]\n- error: tsc failed — TS2322 in select-jobs.ts:88 (JobKind mismatch)",
  },
  {
    label: "fix lands",
    digest:
      "[a1b2]\n- Edit select-jobs.ts (narrow the kind union)\n- tsc clean",
  },
  {
    label: "turn end",
    digest:
      "[a1b2]\n- turn end: 3 files changed, all 4 tasks complete, 2m 40s active",
  },
  {
    label: "two scopes open",
    digest:
      "[a1b2]\n- turn start: user asked \"polish the jobs popover rows\"\n[c3d4]\n- turn start: user asked \"write a probe for the Monitor tool lifecycle\"",
  },
  {
    label: "parallel work",
    digest:
      "[a1b2]\n- Edit dev-card-telemetry-popovers.tsx (two-line rows)\n[c3d4]\n- background job launched: probe-monitor-lifecycle.mjs (expected ~90s)",
  },
  {
    label: "monitor event",
    digest:
      "[c3d4]\n- monitor event: probe phase M1 complete — both notifications observed",
  },
  {
    label: "mixed progress",
    digest:
      "[a1b2]\n- task list: 2/3 complete\n[c3d4]\n- background job still running (60s elapsed)",
  },
  {
    label: "both land",
    digest:
      "[a1b2]\n- turn end: popover two-line rows landed, 1 file changed\n[c3d4]\n- background job finished: probe wrote 412 capture lines",
  },
  {
    label: "routine css read",
    expectPass: true,
    digest: "[a1b2]\n- Read tug-status-cell.css",
  },
  {
    label: "routine re-read",
    expectPass: true,
    digest: "[c3d4]\n- Read monitor-lifecycle-raw.jsonl (reviewing capture)",
  },
  {
    label: "app-test fail",
    digest:
      "[a1b2]\n- error: just app-test finished — VERDICT: FAIL (focus-cycle test, popover did not restore editor focus)",
  },
  {
    label: "app-test recovers",
    digest:
      "[a1b2]\n- background job finished: just app-test re-run — VERDICT: PASS (re-sign fixed the AX grant)",
  },
];

// ---------------------------------------------------------------------------
// Driver — minimal: init wait, user sends, result reads. Any
// control_request arriving under plan mode is logged loudly (it would
// falsify the minimal-driving assumption).
// ---------------------------------------------------------------------------

// Posture pinned by spike iteration: the first run used `--model haiku
// --permission-mode plan` and got claude-sonnet-4-6 (alias not honored)
// running Bash/Agent tool calls under plan mode's read-only allowance —
// 9–19s beats. The daemon posture is: exact model id, default permission
// mode, every tool disallowed.
// The exact tool vocabulary of claude 2.1.173's init frame — the CLI
// hard-errors on unknown names, so this list must track the release.
const DISALLOWED_TOOLS = [
  "Task", "AskUserQuestion", "Bash", "CronCreate", "CronDelete", "CronList",
  "DesignSync", "Edit", "EnterPlanMode", "EnterWorktree", "ExitPlanMode",
  "ExitWorktree", "Monitor", "NotebookEdit", "PushNotification", "Read",
  "ScheduleWakeup", "Skill", "TaskCreate", "TaskGet", "TaskList",
  "TaskOutput", "TaskStop", "TaskUpdate", "ToolSearch", "WebFetch",
  "WebSearch", "Workflow", "Write",
];

const args = [
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose",
  "--model", "claude-haiku-4-5",
  "--permission-mode", "default",
  // Isolate from user/project settings: the user's global
  // `alwaysThinkingEnabled: true` was measured costing 6–14s of
  // thinking per one-line beat. Auth (OAuth keychain/.claude.json
  // credentials) is NOT a settings source and still applies — the
  // `--bare` flag, by contrast, kills OAuth and is unusable here.
  "--setting-sources", "",
  "--disallowedTools", ...DISALLOWED_TOOLS,
  "--append-system-prompt", SYSTEM_PROMPT,
];

const proc = spawn("claude", args, {
  stdio: ["pipe", "pipe", "inherit"],
  cwd,
  // Belt-and-braces with --setting-sources: no thinking budget at all
  // for the commentator — a one-liner needs none.
  env: { ...process.env, MAX_THINKING_TOKENS: "0" },
});

const lines = [];
const parsed = [];
// Result frames in arrival order. Beat N (0-based) pairs with
// results[N] — sequence pairing, so a beat whose reply arrives after
// its timeout can never satisfy a LATER beat's wait (the first-run
// failure mode that shifted every reply off by one).
const results = [];
let waiters = [];
let controlTraffic = 0;
let toolUses = 0;
const modelsSeen = new Set();

function onEvent(ev) {
  parsed.push(ev);
  if (ev.type === "result") results.push(ev);
  if (ev.type === "control_request") {
    controlTraffic++;
    console.error(`[probe!] UNEXPECTED control_request: ${JSON.stringify(ev).slice(0, 120)}`);
  }
  if (ev.type === "assistant") {
    const msg = ev.message ?? {};
    if (msg.model) modelsSeen.add(msg.model);
    for (const block of msg.content ?? []) {
      if (block.type === "tool_use") {
        toolUses++;
        console.error(`[probe!] UNEXPECTED tool_use: ${block.name}`);
      }
    }
  }
  waiters = waiters.filter((w) => {
    if (w.pred(ev)) {
      clearTimeout(w.timer);
      w.resolve(ev);
      return false;
    }
    return true;
  });
}

let buf = "";
proc.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (line.trim().length === 0) continue;
    lines.push(line);
    try {
      onEvent(JSON.parse(line));
    } catch {
      console.error(`[probe<] (unparsed) ${line.slice(0, 80)}`);
    }
  }
});

function expect(pred, ms, label, fromIdx) {
  for (let i = fromIdx; i < parsed.length; i++) {
    if (pred(parsed[i])) return Promise.resolve(parsed[i]);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.error(`[probe] TIMEOUT waiting for ${label}`);
      waiters = waiters.filter((w) => w.timer !== timer);
      resolve(null);
    }, ms);
    waiters.push({ pred, resolve, timer });
  });
}

function send(text) {
  proc.stdin.write(
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    }) + "\n",
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function finish(code) {
  writeFileSync(outPath, lines.join("\n") + "\n");
  console.error(`[probe] wrote ${lines.length} lines to ${outPath}`);
  try {
    proc.kill("SIGTERM");
  } catch {}
  process.exit(code);
}
process.on("SIGINT", () => finish(130));
process.on("SIGTERM", () => finish(143));

async function main() {
  // With `--setting-sources ""` the CLI emits system/init only after the
  // first input arrives — don't block on it; stdin buffers safely.
  console.error("[probe] driving beats");

  const summary = [];
  const seenLines = [];

  for (let i = 0; i < BEATS.length; i++) {
    const beat = BEATS[i];
    const t0 = Date.now();
    send(`BEAT ${i + 1}\n${beat.digest}`);
    // Sequence pairing: this beat owns results[i], no matter how late
    // earlier replies straggle in.
    const result = await expect(() => results.length > i, 30000, `beat ${i + 1} result`, 0)
      .then((hit) => (hit !== null || results.length > i ? results[i] : null));
    const wallMs = Date.now() - t0;
    const reply = (result?.result ?? "(no result)").trim();
    const isPass = reply === "PASS";
    const tooLong = !isPass && reply.length > 110;
    const multiline = reply.includes("\n");
    const repeat = !isPass && seenLines.includes(reply);
    if (!isPass) seenLines.push(reply);
    summary.push({
      beat: i + 1,
      label: beat.label,
      expectPass: beat.expectPass === true,
      wallMs,
      apiMs: result?.duration_ms ?? null,
      chars: reply.length,
      isPass,
      tooLong,
      multiline,
      repeat,
      reply,
    });
    console.error(
      `[beat ${String(i + 1).padStart(2)}] ${wallMs}ms ${isPass ? "PASS" : `${reply.length}ch`}` +
        `${tooLong ? " TOO-LONG" : ""}${multiline ? " MULTILINE" : ""}${repeat ? " REPEAT" : ""}` +
        `${beat.expectPass ? " (expected PASS)" : ""}\n        ${reply}`,
    );
    await sleep(400);
  }

  const latencies = summary.map((s) => s.wallMs).sort((a, b) => a - b);
  const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))];
  console.error("\n[probe] === SUMMARY ===");
  console.error(`[probe] beats: ${summary.length}`);
  console.error(`[probe] latency ms — min ${latencies[0]} p50 ${pct(50)} p90 ${pct(90)} max ${latencies[latencies.length - 1]}`);
  console.error(`[probe] over-4s beats: ${latencies.filter((l) => l > 4000).length}`);
  console.error(`[probe] PASS on expected-pass beats: ${summary.filter((s) => s.expectPass && s.isPass).length}/${summary.filter((s) => s.expectPass).length}`);
  console.error(`[probe] PASS on eventful beats: ${summary.filter((s) => !s.expectPass && s.isPass).length}`);
  console.error(`[probe] too-long: ${summary.filter((s) => s.tooLong).length}  multiline: ${summary.filter((s) => s.multiline).length}  repeats: ${summary.filter((s) => s.repeat).length}`);
  console.error(`[probe] unexpected control traffic: ${controlTraffic}`);
  console.error(`[probe] unexpected tool uses: ${toolUses}`);
  console.error(`[probe] models seen: ${[...modelsSeen].join(", ") || "(none)"}`);
  console.error("[probe] beats json:");
  console.error(JSON.stringify(summary, null, 1));

  proc.stdin.end();
  await sleep(2000);
  finish(0);
}

main().catch((err) => {
  console.error("[probe] fatal:", err);
  finish(1);
});
