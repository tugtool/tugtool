/**
 * tugpulse end-to-end over stdio — spliced wire frames in, monologue
 * lines out. Fully deterministic: the voice is the worker's own
 * words, mirrored.
 */

import { afterAll, describe, expect, test } from "bun:test";

const DAEMON = new URL("../main-pulse.ts", import.meta.url).pathname;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface DaemonHandle {
  proc: ReturnType<typeof Bun.spawn>;
  lines: () => Record<string, unknown>[];
  writeFrame: (frame: Record<string, unknown>) => void;
  stop: () => void;
}

function spawnDaemon(extraArgs: string[] = []): DaemonHandle {
  const proc = Bun.spawn(["bun", DAEMON, ...extraArgs], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env },
  });
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
    writeFrame: (frame) => {
      stdin.write(`${JSON.stringify(frame)}\n`);
      stdin.flush?.();
    },
    stop: () => proc.kill(),
  };
}

function assistantText(scope: string, text: string): Record<string, unknown> {
  return {
    tug_session_id: scope,
    type: "assistant_text",
    msg_id: "m1",
    block_index: 0,
    seq: 1,
    rev: 1,
    text,
    is_partial: true,
    status: "partial",
    ipc_version: 2,
  };
}

function turnComplete(scope: string): Record<string, unknown> {
  return {
    tug_session_id: scope,
    type: "turn_complete",
    msg_id: "m1",
    seq: 9,
    result: "done",
    ipc_version: 2,
  };
}

async function waitFor(pred: () => boolean, ms: number, step = 50): Promise<boolean> {
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

describe("tugpulse stdio (voice)", () => {
  test("the worker's words mirror to the strip; done closes the turn", async () => {
    const daemon = spawnDaemon(["--seed", JSON.stringify(["ignored prior line"])]);
    handles.push(daemon);
    await sleep(300);

    // Streamed narration surfaces via the flush loop, verbatim.
    daemon.writeFrame(assistantText("sess-1", "Mapping the reducer's task "));
    daemon.writeFrame(assistantText("sess-1", "transitions before any edit."));
    expect(await waitFor(() => daemon.lines().length === 1, 4_000)).toBe(true);
    const first = daemon.lines()[0];
    expect(first.type).toBe("pulse");
    expect(first.text).toBe("Mapping the reducer's task transitions before any edit.");
    expect(first.scopes).toEqual(["sess-1"]);
    expect(first.beat).toBe(1);

    // Malformed lines are tolerated.
    const stdin = daemon.proc.stdin as unknown as { write(c: string): void };
    stdin.write("not json at all\n");

    // Turn completion speaks immediately, in its own scope.
    daemon.writeFrame(turnComplete("sess-1"));
    expect(await waitFor(() => daemon.lines().length === 2, 3_000)).toBe(true);
    expect(daemon.lines()[1].text).toBe("Done");
    expect(daemon.lines()[1].scopes).toEqual(["sess-1"]);

    // A second scope's monologue is independent.
    daemon.writeFrame(assistantText("sess-2", "Adapting the probe harness lifecycle hooks."));
    expect(await waitFor(() => daemon.lines().length === 3, 4_000)).toBe(true);
    expect(daemon.lines()[2].scopes).toEqual(["sess-2"]);
    expect(daemon.lines()[2].text).toBe("Adapting the probe harness lifecycle hooks.");

    daemon.stop();
  }, 15_000);
});
