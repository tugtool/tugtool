#!/usr/bin/env bun
// Spike B.2 — does per-command `</dev/null` stdin redirection fix the
// protocol-desync-on-stdin-read flaw found in spike-sentinel-child.mjs?
//
// The flaw: with a raw child shell, the command-delivery channel IS the
// shell's stdin. A command that reads stdin (`cat`, `ssh` password, `sudo`)
// consumes the bytes we meant for the shell — swallowing the sentinel emitter
// and desyncing the protocol. Here we wrap each command so its OWN stdin is
// /dev/null while the shell keeps reading our channel, and separately probe
// whether a command that grabs the controlling TTY directly still escapes.

import { spawn } from "node:child_process";

const SHELL = process.argv[2] || "/bin/zsh";
const SENTINEL = "__TUG_SENTINEL__";
const NONCE = `n${process.pid}`;
const ENV = { ...process.env, PAGER: "cat", GIT_PAGER: "cat", TERM: "dumb", GIT_TERMINAL_PROMPT: "0", PS1: "", PROMPT: "" };

const child = spawn(SHELL, [], { env: ENV, stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
child.stdout.on("data", (d) => (buf += d.toString()));
child.stderr.on("data", () => {});

function exec(command, { redirectStdin = true, timeoutMs = 2000 } = {}) {
  return new Promise((resolve) => {
    const marker = `${SENTINEL}${NONCE}`;
    // Wrap the command in a group whose stdin is /dev/null, leaving the shell's
    // own stdin (our channel) untouched.
    const wrapped = redirectStdin ? `{ ${command} ; } </dev/null` : command;
    const line = `${wrapped}\nprintf '\\n%s\\t%d\\t%s\\n' "${marker}" "$?" "$PWD"\n`;
    const before = buf.length;
    child.stdin.write(line);
    const t0 = Date.now();
    const timer = setInterval(() => {
      const tail = buf.slice(before);
      const idx = tail.indexOf(marker);
      if (idx !== -1 && tail.indexOf("\n", idx) !== -1) {
        clearInterval(timer);
        clearTimeout(killer);
        let output = tail.slice(0, idx);
        if (output.endsWith("\n")) output = output.slice(0, -1);
        resolve({ output, exitCode: Number(tail.slice(idx).split("\t")[1]), dur: Date.now() - t0, timedOut: false });
      }
    }, 5);
    const killer = setTimeout(() => {
      clearInterval(timer);
      resolve({ output: buf.slice(before), exitCode: null, dur: Date.now() - t0, timedOut: true });
    }, timeoutMs);
  });
}

await new Promise((r) => setTimeout(r, 300));
console.log(`# Spike B.2 — stdin redirect · shell=${SHELL}\n`);

const r1 = await exec("cat");           // was the hang/desync case
console.log(`[cat </dev/null]      exit=${r1.exitCode} dur=${r1.dur}ms timedOut=${r1.timedOut} out="${r1.output.replace(/\n/g, "\\n").slice(0, 80)}"`);
const r2 = await exec("echo still-alive"); // recovery — protocol still synced?
console.log(`[recovery]            exit=${r2.exitCode} dur=${r2.dur}ms out="${r2.output.replace(/\n/g, "\\n")}"`);
// A command that opens /dev/tty directly bypasses stdin redirection. No TTY is
// attached to this pipe-mode child, so the open should FAIL fast rather than hang.
const r3 = await exec("head -1 </dev/tty");
console.log(`[read /dev/tty]       exit=${r3.exitCode} dur=${r3.dur}ms timedOut=${r3.timedOut} out="${r3.output.replace(/\n/g, "\\n").slice(0, 80)}"`);
const r4 = await exec("echo after-tty");
console.log(`[recovery-2]          exit=${r4.exitCode} dur=${r4.dur}ms out="${r4.output.replace(/\n/g, "\\n")}"`);
// Read stdin WITHOUT redirect, to confirm the flaw still exists un-mitigated.
const r5 = await exec("cat", { redirectStdin: false, timeoutMs: 1200 });
console.log(`[cat NO-redirect]     exit=${r5.exitCode} dur=${r5.dur}ms timedOut=${r5.timedOut} (desyncs protocol if it eats the sentinel)`);

console.log("\n# done");
child.stdin.end();
child.kill();
process.exit(0);
