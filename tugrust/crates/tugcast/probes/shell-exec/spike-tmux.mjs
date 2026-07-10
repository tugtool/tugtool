#!/usr/bin/env bun
// Spike A — tmux-backed shell session.
//
// Probes [Q01] option (a): a bundled-tmux session driven by `send-keys` with
// output read via `capture-pane`. The draw is [Q04] survival: a tmux session
// outlives the driving process (and a tugcast restart). The cost this spike
// measures: `capture-pane` returns the ENTIRE visible pane — prompt text, the
// echoed command, AND output — so exact per-command output boundaries require
// an in-pane sentinel AND stripping the echoed input. A pane is also a fixed
// grid (a TTY), so it re-wraps long lines and pages tall output — the opposite
// of the block model unless carefully tamed.
//
// Uses an isolated tmux server (`-L`) so it never touches a live session.

import { spawnSync } from "node:child_process";

const TMUX = process.env.TUG_TMUX || "tmux";
const LABEL = `tug-probe-${process.pid}`;
const SESSION = "probe";
const SENTINEL = "__TUG_SENTINEL__";
const NONCE = `n${process.pid}`;
const MARKER = `${SENTINEL}${NONCE}`;

function tmux(args, { input } = {}) {
  return spawnSync(TMUX, ["-L", LABEL, ...args], { encoding: "utf8", input });
}

function capture() {
  // -p print to stdout; -J join wrapped lines; -e keep escape sequences off.
  return tmux(["capture-pane", "-t", SESSION, "-p", "-J"]).stdout || "";
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function sendAndWait(command, { timeoutMs = 4000 } = {}) {
  // Emit an in-pane sentinel after the command so we can find the boundary.
  const composed = `${command}; printf '\\n%s\\t%d\\t%s\\n' "${MARKER}" "$?" "$PWD"`;
  tmux(["send-keys", "-t", SESSION, composed, "Enter"]);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const pane = capture();
    // The sentinel appears TWICE in the pane: once in the echoed command line,
    // once in the actual output. We want the LAST occurrence (the output one).
    const lastIdx = pane.lastIndexOf(`${MARKER}\t`);
    if (lastIdx !== -1 && pane.indexOf("\n", lastIdx) !== -1) {
      const line = pane.slice(lastIdx, pane.indexOf("\n", lastIdx));
      const [, code, cwd] = line.split("\t");
      return { pane, exitCode: Number(code), cwd, dur: Date.now() - t0, timedOut: false };
    }
    await sleep(15);
  }
  return { pane: capture(), exitCode: null, cwd: null, dur: Date.now() - t0, timedOut: true };
}

// Reset the pane between commands so capture-pane returns just this command's
// echo + output (else prior output accumulates and boundary-finding is worse).
function clearPane() { tmux(["send-keys", "-t", SESSION, "clear", "Enter"]); }

const ENV_PREFIX =
  "PAGER=cat GIT_PAGER=cat TERM=dumb GIT_TERMINAL_PROMPT=0 PS1='$ ' ";

console.log(`# Spike A — tmux · ${TMUX} · server -L ${LABEL}\n`);

// Start a detached session; -x/-y set the pane grid (a TTY — note the fixed size).
const start = tmux([
  "new-session", "-d", "-s", SESSION, "-x", "200", "-y", "50",
  "/bin/zsh",
]);
if (start.status !== 0) {
  console.log(`tmux new-session failed: ${start.stderr}`);
  process.exit(1);
}
await sleep(400);
// Harden the interactive shell's environment.
tmux(["send-keys", "-t", SESSION, `export ${ENV_PREFIX.trim().replace(/ /g, " ")}`, "Enter"]);
await sleep(200);
clearPane();
await sleep(200);

function show(label, r) {
  // Extract just the region between the echoed command and the sentinel — the
  // "output". This is the parsing tax the sentinel + echo-stripping imposes.
  const paneLines = r.pane.split("\n");
  const sentIdx = paneLines.findIndex((l) => l.includes(`${MARKER}\t`) && !l.includes("printf"));
  const preview = r.pane.replace(/\n/g, "\\n").slice(-160);
  console.log(`[${label}] exit=${r.exitCode} cwd=${r.cwd} dur=${r.dur}ms timedOut=${r.timedOut}`);
  console.log(`    pane(tail)="${preview}"`);
}

show("echo", await sendAndWait("echo hello world")); clearPane(); await sleep(100);
show("exit-code", await sendAndWait("false")); clearPane(); await sleep(100);
show("cd", await sendAndWait("cd /tmp")); clearPane(); await sleep(100);
show("pwd(persists?)", await sendAndWait("pwd")); clearPane(); await sleep(100);

// [Q04] SURVIVAL: does the session outlive THIS driver process? Simulate a
// tugcast restart by checking the session still exists and is usable after we
// "detach" (we never attached; the session is server-side). We also verify a
// brand-new tmux client (fresh spawnSync) can capture it.
const lsBefore = tmux(["list-sessions"]).stdout || "";
console.log(`\n# [Q04] session survival`);
console.log(`    list-sessions: ${lsBefore.trim()}`);
// A fresh client process re-reads state (server-side session persists):
const reattach = await sendAndWait("echo survived-restart");
show("post-'restart' exec", reattach);

// Long / tall output: does the pane page or truncate? Print 120 lines into a
// 50-row pane and see whether capture-pane returns all 120 or only the last 50.
clearPane(); await sleep(100);
const tall = await sendAndWait("seq 1 120", { timeoutMs: 3000 });
const capturedLines = (tall.pane.match(/^\d+$/gm) || []).length;
console.log(`\n# tall output (120 lines into 50-row pane)`);
console.log(`    numeric lines visible in capture-pane: ${capturedLines} (of 120 printed)`);

// Cleanup: kill the isolated server.
tmux(["kill-server"]);
console.log("\n# done (killed -L server)");
process.exit(0);
