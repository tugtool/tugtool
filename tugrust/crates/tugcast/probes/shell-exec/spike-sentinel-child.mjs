#!/usr/bin/env bun
// Spike B — sentinel-driven persistent child shell (pipe mode, no PTY).
//
// Probes [Q01] option (b): a long-lived `$SHELL` child driven by a sentinel
// protocol. The shell is spawned NON-interactively with piped stdio (no TTY),
// so `isatty()` is false — the natural state for a block shell. After each
// command we emit a sentinel line carrying `$?` and `$PWD`; we read stdout
// (stderr merged) until the sentinel, which gives us exact output boundaries,
// the exit code, and the post-command cwd (proving cwd statefulness — the
// [Q01] differentiator vs one-shot exec).
//
// Usage: bun spike-sentinel-child.mjs [shellPath]

import { spawn } from "node:child_process";

const SHELL = process.argv[2] || process.env.SHELL || "/bin/zsh";
const SENTINEL = "__TUG_SENTINEL__";
// Randomless nonce derived from pid so two runs don't collide but the script
// stays deterministic within a run (no Math.random — matches repo constraints).
const NONCE = `n${process.pid}`;

// Hardening env ([Q03]): kill pagers, disable TUI-ish behavior, refuse prompts.
const HARDENED_ENV = {
  ...process.env,
  PAGER: "cat",
  GIT_PAGER: "cat",
  TERM: "dumb",
  GIT_TERMINAL_PROMPT: "0",
  // Make the prompt empty/predictable; we never parse the prompt (sentinel-based).
  PS1: "",
  PROMPT: "",
};

function startShell() {
  // `-i` deliberately omitted: a non-interactive shell. stdin is a pipe.
  const child = spawn(SHELL, [], {
    env: HARDENED_ENV,
    stdio: ["pipe", "pipe", "pipe"],
  });
  // Merge stderr into the same logical stream by tagging; we keep them
  // separate here to REPORT on the separated-vs-merged question ([Q02]).
  return child;
}

function makeExec(child) {
  let stdoutBuf = "";
  let stderrBuf = "";
  const stdoutChunks = [];
  child.stdout.on("data", (d) => {
    stdoutBuf += d.toString();
    stdoutChunks.push({ t: Date.now(), s: d.toString() });
  });
  child.stderr.on("data", (d) => {
    stderrBuf += d.toString();
  });

  // Serialize the shell start-of-life: silence job-control noise, ensure a
  // clean line state. We DON'T merge 2>&1 at the shell level so we can measure
  // both streams; the sentinel rides stdout.
  return function exec(command, { timeoutMs = 5000 } = {}) {
    return new Promise((resolve) => {
      const startAt = Date.now();
      const marker = `${SENTINEL}${NONCE}`;
      // Capture $? from the command, then emit sentinel with code + cwd.
      // The leading newline guarantees the sentinel starts its own line even
      // if the command left the cursor mid-line (no trailing newline).
      const line =
        `${command}\n` +
        `printf '\\n%s\\t%d\\t%s\\n' "${marker}" "$?" "$PWD"\n`;
      const before = stdoutBuf.length;
      child.stdin.write(line);

      const timer = setInterval(() => {
        const tail = stdoutBuf.slice(before);
        const idx = tail.indexOf(marker);
        if (idx !== -1) {
          // Find the end of the sentinel line.
          const eol = tail.indexOf("\n", idx);
          if (eol === -1) return; // sentinel line not fully arrived
          clearInterval(timer);
          clearTimeout(killer);
          const sentinelLine = tail.slice(idx, eol);
          const [, codeStr, cwd] = sentinelLine.split("\t");
          // Output is everything before the sentinel's own leading newline.
          let output = tail.slice(0, idx);
          if (output.endsWith("\n")) output = output.slice(0, -1);
          resolve({
            command,
            output,
            stderrSoFar: stderrBuf,
            exitCode: Number.parseInt(codeStr, 10),
            cwd,
            durationMs: Date.now() - startAt,
            timedOut: false,
          });
        }
      }, 5);

      const killer = setTimeout(() => {
        clearInterval(timer);
        resolve({
          command,
          output: stdoutBuf.slice(before),
          stderrSoFar: stderrBuf,
          exitCode: null,
          cwd: null,
          durationMs: Date.now() - startAt,
          timedOut: true,
        });
      }, timeoutMs);
    });
  };
}

function report(label, r) {
  const out = r.output.replace(/\n/g, "\\n");
  const err = (r.stderrSoFar || "").replace(/\n/g, "\\n");
  console.log(
    `[${label}] exit=${r.exitCode} cwd=${r.cwd} dur=${r.durationMs}ms timedOut=${r.timedOut}`,
  );
  console.log(`    stdout="${out.slice(0, 200)}"`);
  if (err) console.log(`    stderr(all)="${err.slice(-200)}"`);
}

const child = startShell();
const exec = makeExec(child);

// Give the shell a beat to initialize (rc files, etc.).
await new Promise((r) => setTimeout(r, 300));

console.log(`# Spike B — sentinel child · shell=${SHELL} · pipe mode (no TTY)\n`);

// --- Core capability battery ---
report("echo", await exec("echo hello world"));
report("exit-code", await exec("false"));
report("cwd-1", await exec("cd /tmp"));
report("cwd-2 (persists?)", await exec("pwd"));
report("multiline", await exec("printf 'a\\nb\\nc\\n'"));
report("stderr", await exec("echo to-stderr 1>&2; echo to-stdout"));
report("pipe-chain", await exec("echo one two three | tr ' ' '\\n' | sort"));
report("chain-&&", await exec("true && echo yes || echo no"));
report("env-persist-1", await exec("export TUG_PROBE_VAR=hi"));
report("env-persist-2", await exec("echo $TUG_PROBE_VAR"));
report("isatty", await exec("test -t 1 && echo TTY || echo NOTTY"));

// --- Hardening gauntlet ([Q03]) ---
console.log("\n# Hardening gauntlet");
report("git-log(pager?)", await exec("git -C . log --oneline -5 2>&1 | head -5", { timeoutMs: 4000 }));
report("git-pager-var", await exec("git config --get core.pager; echo PAGER=$PAGER GIT_PAGER=$GIT_PAGER"));
// A command that blocks reading stdin. With stdin=our pipe, `cat` with no args
// would hang forever waiting on input — this is the canonical hang case.
report("stdin-block(cat)", await exec("cat", { timeoutMs: 1500 }));
// After a timeout+partial, is the shell still usable? (recovery)
report("recovery-after-hang", await exec("echo still-alive", { timeoutMs: 3000 }));

console.log("\n# done");
child.stdin.end();
child.kill();
process.exit(0);
