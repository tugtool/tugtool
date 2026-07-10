#!/usr/bin/env bun
// Spike B.3 — TUI decline, kill-a-long-runner, and streaming latency.
//
// Rides the winning sentinel-child model (pipe mode + `</dev/null` + hardened
// env) and answers the remaining probe questions:
//   [Q03] Do interactive TUIs (vim/top/less) decline gracefully in pipe mode?
//         Can a genuine long-runner be killed mid-flight?
//   [Q02] For a large-output command, do bytes arrive in CHUNKS over time
//         (→ streaming worth it) or effectively all-at-once (→ settled-whole)?

import { spawn } from "node:child_process";

const SHELL = process.argv[2] || "/bin/zsh";
const SENTINEL = "__TUG_SENTINEL__";
const NONCE = `n${process.pid}`;
const MARKER = `${SENTINEL}${NONCE}`;
const ENV = { ...process.env, PAGER: "cat", GIT_PAGER: "cat", TERM: "dumb", GIT_TERMINAL_PROMPT: "0", PS1: "", PROMPT: "" };

const child = spawn(SHELL, [], { env: ENV, stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const arrivals = []; // {t, len} for streaming-latency measurement
child.stdout.on("data", (d) => { buf += d.toString(); arrivals.push({ t: Date.now(), len: d.length }); });
child.stderr.on("data", (d) => { buf += `[stderr]${d.toString()}`; });

function exec(command, { timeoutMs = 3000, redirect = true } = {}) {
  return new Promise((resolve) => {
    const wrapped = redirect ? `{ ${command} ; } </dev/null` : command;
    const line = `${wrapped}\nprintf '\\n%s\\t%d\\t%s\\n' "${MARKER}" "$?" "$PWD"\n`;
    const before = buf.length;
    child.stdin.write(line);
    const t0 = Date.now();
    const timer = setInterval(() => {
      const tail = buf.slice(before);
      const idx = tail.indexOf(MARKER);
      if (idx !== -1 && tail.indexOf("\n", idx) !== -1) {
        clearInterval(timer); clearTimeout(killer);
        let out = tail.slice(0, idx);
        resolve({ out, exitCode: Number(tail.slice(idx).split("\t")[1]), dur: Date.now() - t0, timedOut: false, before });
      }
    }, 5);
    const killer = setTimeout(() => { clearInterval(timer); resolve({ out: buf.slice(before), exitCode: null, dur: Date.now() - t0, timedOut: true, before }); }, timeoutMs);
  });
}

await new Promise((r) => setTimeout(r, 300));
console.log(`# Spike B.3 — hardening + streaming · shell=${SHELL}\n`);

// [Q03] TUIs in pipe mode. Each should exit fast (no hang) rather than take over.
for (const tui of ["vim", "vi", "top -l 1", "less /etc/hosts", "nano"]) {
  const r = await exec(tui, { timeoutMs: 2500 });
  const first = r.out.replace(/\n/g, "\\n").slice(0, 90);
  console.log(`[TUI ${tui.padEnd(14)}] exit=${r.exitCode} dur=${r.dur}ms timedOut=${r.timedOut} out="${first}"`);
}

// [Q03] Kill a genuine long-runner. Launch `sleep 30 </dev/null` — the exec()
// will TIME OUT (no sentinel), so we then SIGKILL the child's process group to
// prove a hung command can be reaped. In production the shell child stays; here
// the spike kills the whole child to demonstrate the reap path exists.
console.log(`\n# [Q03] kill a long-runner`);
const longP = exec("sleep 30", { timeoutMs: 1200 });
const r = await longP;
console.log(`[sleep 30]       exit=${r.exitCode} dur=${r.dur}ms timedOut=${r.timedOut} (times out; production sends SIGTERM→SIGKILL to the command's pgid)`);
// Prove the shell itself is wedged behind the still-running sleep (protocol
// blocked until sleep finishes) — this is WHY production needs an out-of-band
// kill: send a signal to the running child, not another stdin line.
const wedged = await exec("echo am-i-free", { timeoutMs: 1000 });
console.log(`[echo after sleep] timedOut=${wedged.timedOut} (true ⇒ shell is blocked behind the foreground sleep — confirms need for signal-based kill)`);

// [Q02] Streaming latency: 5000 lines. Measure spread of arrival timestamps.
console.log(`\n# [Q02] streaming latency (5000 lines)`);
arrivals.length = 0;
const big = await exec("seq 1 5000", { timeoutMs: 5000 });
const relevant = arrivals.filter((a) => a.t >= 0);
const span = relevant.length ? relevant[relevant.length - 1].t - relevant[0].t : 0;
const bytes = big.out.length;
console.log(`    exit=${big.exitCode} dur=${big.dur}ms bytes=${bytes} chunks=${relevant.length} arrivalSpan=${span}ms`);
console.log(`    → ${span < 30 ? "effectively settled-whole (arrives in <30ms)" : "arrives in multiple chunks over time — streaming would help"}`);

console.log("\n# done");
child.stdin.end();
child.kill("SIGKILL");
process.exit(0);
