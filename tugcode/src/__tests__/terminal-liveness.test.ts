// Liveness rule for the in-place rewind guard: a session counts as
// held only when a registry entry's pid is genuinely alive (own test
// process pid in these tests — no mocked OS), survives the procStart
// pid-reuse cross-check, and is not our own claude child (excludePids).

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isSessionHeldByOtherProcess } from "../terminal-liveness.ts";

const SESSION = "11111111-2222-3333-4444-555555555555";

let roots: string[] = [];

function makeRegistry(entries: Array<Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), "tugcode-terminal-liveness-"));
  roots.push(root);
  entries.forEach((entry, i) => {
    writeFileSync(join(root, `${i}.json`), JSON.stringify(entry));
  });
  return root;
}

function ownProcStart(): string {
  const proc = Bun.spawnSync(["ps", "-p", String(process.pid), "-o", "lstart="]);
  return proc.stdout.toString().trim().replace(/\s+/g, " ");
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

describe("isSessionHeldByOtherProcess", () => {
  test("foreign live pid holding the session → held", () => {
    const root = makeRegistry([
      { pid: process.pid, sessionId: SESSION, procStart: ownProcStart() },
    ]);
    expect(isSessionHeldByOtherProcess(SESSION, { registryRoot: root })).toBe(true);
  });

  test("only our own claude child holds it → not held", () => {
    const root = makeRegistry([{ pid: process.pid, sessionId: SESSION }]);
    expect(
      isSessionHeldByOtherProcess(SESSION, {
        registryRoot: root,
        excludePids: [process.pid],
      }),
    ).toBe(false);
  });

  test("dead pid → not held", () => {
    // macOS pids cap below 100000; this entry is a crash leftover.
    const root = makeRegistry([{ pid: 999999, sessionId: SESSION }]);
    expect(isSessionHeldByOtherProcess(SESSION, { registryRoot: root })).toBe(false);
  });

  test("procStart mismatch (pid reuse) → not held", () => {
    const root = makeRegistry([
      { pid: process.pid, sessionId: SESSION, procStart: "Thu Jan 1 00:00:00 1970" },
    ]);
    expect(isSessionHeldByOtherProcess(SESSION, { registryRoot: root })).toBe(false);
  });

  test("absent registry root → not held (fail-open)", () => {
    expect(
      isSessionHeldByOtherProcess(SESSION, {
        registryRoot: "/nonexistent/terminal-liveness-root",
      }),
    ).toBe(false);
  });

  test("different session / malformed entries → not held", () => {
    const root = makeRegistry([
      { pid: process.pid, sessionId: "other-session" },
      { sessionId: SESSION },
      { pid: "not-a-number", sessionId: SESSION },
    ]);
    expect(isSessionHeldByOtherProcess(SESSION, { registryRoot: root })).toBe(false);
  });
});
