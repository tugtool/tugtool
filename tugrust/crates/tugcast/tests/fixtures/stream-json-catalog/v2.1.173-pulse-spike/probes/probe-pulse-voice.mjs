#!/usr/bin/env node
// Probe: PULSE commentator voice — drives one persistent Haiku session
// (the daemon model: a single conversation narrating every beat) with
// scripted beat digests and judges the replies.
//
// What this pins (v6, the watch-the-wire rework):
//   - the commentator system prompt (iterated here, then frozen into
//     the daemon as a constant)
//   - the v6 beat digest format: SINGLE scope per beat (per-scope
//     beat queues), real event excerpts, an `assistant says:` line
//     carrying the assistant's own interstitial narration
//   - per-thread separation: interleaved beats from two sessions stay
//     coherent, and the never-repeat rule applies within one session's
//     thread — the trap beat checks a line isn't suppressed because a
//     DIFFERENT session got a similar one
//   - per-beat wall-clock latency against the ~4s stale-drop window
//   - PASS behavior on thin-but-triggered beats
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
  "work. Your one-line comments appear beneath a live transcript the",
  "developer is already watching. THE BAR: a line must say something",
  "the transcript does not — the read BETWEEN events, never a",
  "restatement of them. Restating what happened is worthless here, no",
  "matter how well phrased.",
  "",
  "Color comes only from relations between events:",
  "- pattern reads: repeated edits to one file read as a struggle;",
  "  many reads before an edit read as reconnaissance; edits blocked",
  "  before reads read as haste",
  "- arc and inflection: the first failure of a turn, the first green",
  "  after red, a reversal, work redone or abandoned",
  "- intent vs action: the \"assistant says\" line against what is",
  "  actually happening",
  "- the stumble and the recovery — its shape, not its error text",
  "- genuinely notable magnitudes (sizes, counts, durations)",
  "",
  "Each user message is a beat digest about EXACTLY ONE session, named",
  "by its header tag (like [a1b2]); different tags are unrelated",
  "sessions — separate threads, separate memories. A line starting",
  "\"assistant says:\" is the worker's own words — interpret, never",
  "quote. Dash lines are events: \"running\" is in flight now,",
  "\"ok\"/\"failed\" are true outcomes, quoted excerpts are real",
  "output. \"running now:\" lists work in flight; \"turn so far:\" is",
  "the turn's arc. THE DIGEST AND YOUR OWN PRIOR LINES ARE YOUR ONLY",
  "SOURCES OF TRUTH — no guessed outcomes, no invented errors, no",
  "speculation, no predictions.",
  "",
  "DEFAULT TO SILENCE. Reply exactly PASS unless the beat — with its",
  "arc and your memory of that session's thread — yields a genuine",
  "read. Expect to PASS most beats. A turn's first failure and a hard",
  "reversal deserve a line; routine progress never does. The recovery",
  "after a failure you noted closes the arc — say how it resolved.",
  "",
  "When you speak: ONE plain line, at most sixteen words, never more",
  "than 110 characters. Ground the read in stated facts — name the",
  "files, counts, outcomes it rests on. Present tense. Never the words",
  "\"assistant\", \"user\", \"developer\", \"AI\", and never a model",
  "name (Haiku, Sonnet, Opus, Claude, GPT). Never name a session or",
  "its tag. No filler, no hype, no emoji, no markdown, no quotes",
  "around your line.",
  "",
  "EXAMPLES — digest, then the line (or PASS):",
  "",
  "- Edit on todo-list-block.tsx — ok (4th time this turn)",
  "- Edit on todo-list-block.tsx — failed: \"String to replace not found\"",
  "- Read on todo-list-block.tsx — ok",
  "- Edit on todo-list-block.tsx — ok (5th time this turn)",
  "REPLY: todo-list-block going stitch by stitch — five edits, one missed anchor, recovered.",
  "",
  "- Edit on tug-pane-banner.tsx — failed: \"File has not been read yet\"",
  "- Edit on tide-card-transcript.tsx — failed: \"File has not been read yet\"",
  "turn so far: 14 tool calls; 2 failed",
  "REPLY: Two edits blocked for writing before reading — pace outrunning process.",
  "",
  "assistant says: \"Rerunning the probe after the prompt rewrite.\"",
  "- Bash: bun probe-pulse-voice.mjs — ok (94s)",
  "(when your own earlier line for that session noted failures)",
  "REPLY: The prompt rewrite lands — the rerun comes back clean.",
  "",
  "- Bash: tokei — ok (6s)",
  "assistant says: \"294k lines across 1,790 files, TypeScript ahead of Rust.\"",
  "REPLY: 294k lines sized up in six seconds.",
  "",
  "- Read on reducer.ts — ok",
  "- Read on dev-card-telemetry-renderers.tsx — ok",
  "- Grep for \"task_started\" — running",
  "REPLY: PASS",
  "",
  "- turn complete: \"Hello! What can I help with today?\"",
  "REPLY: PASS",
  "",
  "- Bash: cargo nextest run — still running (14s so far)",
  "turn so far: 6 tool calls; files touched: select-jobs.ts",
  "REPLY: PASS",
].join("\n");

// ---------------------------------------------------------------------------
// Scripted beats — the v6 digest format: SINGLE scope per beat (the
// daemon keeps one beat queue per session), real event excerpts, and
// an optional `assistant says:` line harvested from assistant_text.
// Beats marked expectPass are thin-but-triggered (one routine ok
// event); the trap beat checks per-thread repeat isolation.
// ---------------------------------------------------------------------------

const BEATS = [
  {
    label: "greeting turn completes (strict bar: silence)",
    expectPass: true,
    digest: [
      "[a1b2]",
      "assistant says: \"Hello! I see you're working on the tugdash branch. What can I help with?\"",
      "- turn complete: \"Hello! I see you're working on the tugdash branch.\"",
    ].join("\n"),
  },
  {
    label: "recon burst with work in flight",
    digest: [
      "[a1b2]",
      "assistant says: \"I'll map how the reducer handles task transitions before touching anything.\"",
      "- Read on reducer.ts — ok",
      "- Read on dev-card-telemetry-renderers.tsx — ok",
      "- Grep for \"task_started\" — running",
    ].join("\n"),
  },
  {
    label: "first write + task",
    digest: [
      "[a1b2]",
      "assistant says: \"The ledger selectors are the cleanest seam for this — writing those first.\"",
      "- Write on select-jobs.ts — ok",
      "- task added: \"Wire JOBS cell selectors\"",
    ].join("\n"),
  },
  {
    label: "long build still running (routine progress: silence)",
    expectPass: true,
    digest: [
      "[a1b2]",
      "- Bash: cargo nextest run — still running (14s so far)",
      "running now:",
      "- Bash: cargo nextest run (14s so far)",
      "turn so far: 6 tool calls; files touched: select-jobs.ts",
    ].join("\n"),
  },
  {
    label: "routine re-read",
    expectPass: true,
    digest: [
      "[a1b2]",
      "- Read on reducer.ts — ok (2nd time this turn)",
    ].join("\n"),
  },
  {
    label: "tests green + task done",
    digest: [
      "[a1b2]",
      "- background job completed: bun test — 3546 passing (14s)",
      "- task marked completed",
    ].join("\n"),
  },
  {
    label: "second session opens",
    digest: [
      "[c3d4]",
      "assistant says: \"Starting from the monitor spike's harness and adapting its lifecycle hooks.\"",
      "- Read on probe-monitor-lifecycle.mjs — ok",
      "- Write on probe-task-wake.mjs — ok",
    ].join("\n"),
  },
  {
    label: "type error with real excerpt",
    digest: [
      "[a1b2]",
      "- Bash: bunx tsc --noEmit — failed: \"select-jobs.ts(88,5): error TS2322: Type 'string' is not assignable to type 'JobKind'\"",
    ].join("\n"),
  },
  {
    label: "probe run lands",
    digest: [
      "[c3d4]",
      "assistant says: \"Both wake notifications arrived in order — capturing the raw stream now.\"",
      "- Bash: bun probe-task-wake.mjs — ok (92s)",
    ].join("\n"),
  },
  {
    label: "fix + clean check with arc",
    digest: [
      "[a1b2]",
      "assistant says: \"Narrowed the union; the kind check holds now.\"",
      "- Edit on select-jobs.ts — ok",
      "- Bash: bunx tsc --noEmit — ok",
      "turn so far: 9 tool calls; files touched: select-jobs.ts; 1 failed",
    ].join("\n"),
  },
  {
    label: "first turn completes",
    digest: [
      "[a1b2]",
      "- turn complete: \"Jobs cell selectors landed with tests green\"",
    ].join("\n"),
  },
  {
    label: "TRAP: similar event, other thread",
    // a1b2 already got a tests-green line (beat 5). c3d4 running its
    // own tests green must STILL get a line — per-thread isolation.
    digest: [
      "[c3d4]",
      "- Bash: bun test probe-fixtures — ok — 412 passing (8s)",
    ].join("\n"),
  },
  {
    label: "second session turn completes",
    digest: [
      "[c3d4]",
      "- turn complete: \"Probe captured the full task wake lifecycle\"",
    ].join("\n"),
  },
  {
    label: "routine css read",
    expectPass: true,
    digest: [
      "[a1b2]",
      "- Read on tug-status-cell.css — ok",
    ].join("\n"),
  },
  {
    label: "app-test fails with verdict excerpt",
    digest: [
      "[a1b2]",
      "assistant says: \"The popover steals focus on close — checking the responder chain.\"",
      "- Bash: just app-test focus-cycle — failed: \"VERDICT: FAIL — popover did not restore editor focus\"",
    ].join("\n"),
  },
  {
    label: "app-test recovers",
    digest: [
      "[a1b2]",
      "- Edit on responder-chain.ts — ok",
      "- Bash: just app-test focus-cycle — ok (41s)",
    ].join("\n"),
  },
  {
    label: "api retry",
    digest: [
      "[c3d4]",
      "- the assistant's connection to its AI model is retrying (attempt 1/10): \"529 overloaded_error\"",
    ].join("\n"),
  },
  {
    label: "hardening edit",
    digest: [
      "[c3d4]",
      "assistant says: \"Hardening the probe against the slow-spawn case the capture showed.\"",
      "- Edit on probe-task-wake.mjs — ok",
      "- Bash: bun probe-task-wake.mjs — ok (95s)",
    ].join("\n"),
  },
  {
    label: "long sweep with repeats",
    digest: [
      "[a1b2]",
      "- Edit on tide-pulse-strip.css — ok",
      "- Edit on tide-pulse-strip.css — ok (2nd time this turn)",
      "- Edit on tide-pulse-strip.css — ok (3rd time this turn)",
      "- Bash: bun test pulse — ok — 41 passing",
    ].join("\n"),
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
