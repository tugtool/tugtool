/**
 * tugpulse end-to-end over stdio with a fake claude child — asserts
 * the wiring (facts in → shaped pulse lines out) without model
 * nondeterminism. The fake child PASSes priming messages and any
 * digest mentioning "routine"; everything else echoes the BEAT header.
 *
 * Timings are tightened via the daemon's env overrides so the whole
 * suite runs in a few seconds of wall clock.
 */

import { afterAll, describe, expect, test } from "bun:test";

const DAEMON = new URL("../main-pulse.ts", import.meta.url).pathname;
const FAKE_CLAUDE = new URL("./fake-claude.mjs", import.meta.url).pathname;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface DaemonHandle {
  proc: ReturnType<typeof Bun.spawn>;
  lines: () => Record<string, unknown>[];
  writeFact: (fact: Record<string, unknown>) => void;
  stop: () => void;
}

function spawnDaemon(extraArgs: string[] = []): DaemonHandle {
  const proc = Bun.spawn(
    ["bun", DAEMON, "--claude-path", FAKE_CLAUDE, ...extraArgs],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
      env: {
        ...process.env,
        TUGPULSE_COALESCE_MS: "100",
        TUGPULSE_MIN_INTERVAL_MS: "250",
        TUGPULSE_STALE_MS: "2000",
      },
    },
  );
  const collected: Record<string, unknown>[] = [];
  void (async () => {
    const decoder = new TextDecoder();
    let buf = "";
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim().length > 0) {
          collected.push(JSON.parse(line) as Record<string, unknown>);
        }
      }
    }
  })();
  const stdin = proc.stdin as unknown as {
    write(chunk: string): void;
    flush?: () => void;
  };
  return {
    proc,
    lines: () => collected,
    writeFact: (fact) => {
      stdin.write(`${JSON.stringify(fact)}\n`);
      stdin.flush?.();
    },
    stop: () => proc.kill(),
  };
}

function fact(text: string, scope = "scope-1"): Record<string, unknown> {
  return {
    type: "pulse_fact",
    source: "test",
    scope,
    kind: "note",
    fact: text,
    at: Date.now(),
  };
}

async function waitFor(
  pred: () => boolean,
  ms: number,
  step = 50,
): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await sleep(step);
  }
  return pred();
}

const handles: DaemonHandle[] = [];
afterAll(() => {
  for (const h of handles) h.stop();
});

describe("tugpulse stdio", () => {
  test("facts in → shaped pulse lines out; PASS and bursts behave", async () => {
    const daemon = spawnDaemon();
    handles.push(daemon);

    // Give the daemon time to spawn + prime the fake child (the
    // priming PASS consumes result slot 0 — sequence pairing under test).
    await sleep(600);

    // An eventful fact → exactly one pulse line echoing beat 1's digest.
    daemon.writeFact(fact("turn start: build the thing"));
    expect(await waitFor(() => daemon.lines().length === 1, 3_000)).toBe(true);
    const first = daemon.lines()[0];
    expect(first.type).toBe("pulse");
    expect(first.text).toBe("echo:BEAT 1");
    expect(first.scopes).toEqual(["scope-1"]);
    expect(first.beat).toBe(1);
    expect(typeof first.at).toBe("number");

    // A routine fact → the fake child PASSes → nothing is emitted.
    daemon.writeFact(fact("routine read of reducer.ts"));
    await sleep(900);
    expect(daemon.lines().length).toBe(1);

    // A two-scope burst coalesces into ONE beat covering both scopes.
    daemon.writeFact(fact("tests went green", "scope-1"));
    daemon.writeFact(fact("probe finished", "scope-2"));
    expect(await waitFor(() => daemon.lines().length === 2, 3_000)).toBe(true);
    const burst = daemon.lines()[1];
    expect(burst.scopes).toEqual(["scope-1", "scope-2"]);
    // Beat counter counts EMITTED beats — the PASS beat did not consume one.
    expect(burst.beat).toBe(2);

    // Malformed stdin lines are ignored without killing the daemon.
    const stdin = daemon.proc.stdin as unknown as { write(c: string): void };
    stdin.write("not json at all\n");
    daemon.writeFact(fact("another development", "scope-1"));
    expect(await waitFor(() => daemon.lines().length === 3, 3_000)).toBe(true);

    daemon.stop();
  }, 15_000);

  test("--seed primes without emitting and replies stay paired", async () => {
    const daemon = spawnDaemon(["--seed", JSON.stringify(["prior line one"])]);
    handles.push(daemon);
    await sleep(600);

    // Nothing emitted from priming…
    expect(daemon.lines().length).toBe(0);
    // …and the first real beat still pairs with its own reply.
    daemon.writeFact(fact("first real development"));
    expect(await waitFor(() => daemon.lines().length === 1, 3_000)).toBe(true);
    expect(daemon.lines()[0].text).toBe("echo:BEAT 1");

    daemon.stop();
  }, 15_000);
});
