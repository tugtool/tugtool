#!/usr/bin/env bun
// Spike B.4 — [Q02] streaming latency in a CLEAN shell (isolated from the
// kill-test's wedged sleep). Measures whether a large-output command's bytes
// arrive all-at-once (→ settled-whole is fine for v1) or dribble in chunks
// over meaningful wall-clock time (→ streaming rendering earns its keep).
// Also times a slow-drip producer to confirm chunked arrival IS observable
// when the producer is genuinely slow (a `cargo build` analog).

import { spawn } from "node:child_process";

const SHELL = process.argv[2] || "/bin/zsh";
const MARKER = `__TUG_SENTINEL__n${process.pid}`;
const ENV = { ...process.env, PAGER: "cat", GIT_PAGER: "cat", TERM: "dumb", GIT_TERMINAL_PROMPT: "0", PS1: "", PROMPT: "" };

function run(command, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(SHELL, [], { env: ENV, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    const arrivals = [];
    child.stdout.on("data", (d) => { buf += d.toString(); arrivals.push(Date.now()); });
    child.stderr.on("data", () => {});
    setTimeout(() => {
      const line = `{ ${command} ; } </dev/null\nprintf '\\n%s\\t%d\\n' "${MARKER}" "$?"\n`;
      const t0 = Date.now();
      child.stdin.write(line);
      const timer = setInterval(() => {
        if (buf.includes(MARKER)) {
          clearInterval(timer); clearTimeout(killer);
          const relevant = arrivals.filter((t) => t >= t0);
          const span = relevant.length > 1 ? relevant[relevant.length - 1] - relevant[0] : 0;
          const bytes = buf.slice(0, buf.indexOf(MARKER)).length;
          child.kill("SIGKILL");
          resolve({ dur: Date.now() - t0, bytes, chunks: relevant.length, span });
        }
      }, 2);
      const killer = setTimeout(() => { clearInterval(timer); child.kill("SIGKILL"); resolve({ dur: Date.now() - t0, bytes: buf.length, chunks: arrivals.length, span: -1 }); }, timeoutMs);
    }, 300);
  });
}

console.log(`# Spike B.4 — streaming latency (clean) · shell=${SHELL}\n`);

const fast = await run("seq 1 5000", 5000);
console.log(`[seq 1 5000]              dur=${fast.dur}ms bytes=${fast.bytes} chunks=${fast.chunks} arrivalSpan=${fast.span}ms`);
console.log(`    → ${fast.span < 50 ? "settled-whole: all bytes within " + fast.span + "ms" : "chunked over " + fast.span + "ms"}`);

const big = await run("seq 1 100000", 8000);
console.log(`[seq 1 100000]           dur=${big.dur}ms bytes=${big.bytes} chunks=${big.chunks} arrivalSpan=${big.span}ms`);

// A slow producer: one line every ~50ms for ~2s — the `cargo build` analog
// where output genuinely trickles. This is where streaming rendering matters.
const drip = await run("for i in $(seq 1 20); do echo line-$i; sleep 0.05; done", 5000);
console.log(`[slow drip 20×50ms]      dur=${drip.dur}ms bytes=${drip.bytes} chunks=${drip.chunks} arrivalSpan=${drip.span}ms`);
console.log(`    → ${drip.chunks > 3 ? "chunked arrival IS observable (" + drip.chunks + " chunks over " + drip.span + "ms) — a slow producer would show partial output if streamed" : "arrived in few chunks"}`);

console.log("\n# done");
process.exit(0);
