/**
 * test-cleanup.ts — the end-of-run hook that actually fires.
 *
 * `process.on("exit")` does NOT run under `bun test`. The harness had
 * three such registrations (harness sockets, temp tugbank DBs) and none
 * of them had ever executed, which is the mechanism behind the leaked
 * sockets and DBs the 2026-08-02 audit found sitting in `$TMPDIR`.
 *
 * What the test runner does call is `afterAll` registered from a
 * preload file (`preload.ts`, wired in `bunfig.toml`). So cleanup work
 * registers here and the preload flushes it once the run is over.
 *
 * Register a task for anything the harness acquires that would outlive
 * the process — and still release it eagerly where you can. This is the
 * backstop, not the plan.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tasks = new Set<() => void>();

/**
 * Run `fn` when the test run ends. Returns a disposer so a caller that
 * releases its resource eagerly can drop the pending task.
 */
export function onTestRunEnd(fn: () => void): () => void {
  tasks.add(fn);
  return () => tasks.delete(fn);
}

/**
 * Flush every registered task. Called once by the preload's `afterAll`.
 * A task that throws must not strand the ones behind it.
 */
/**
 * A scratch directory that removes itself when the run ends.
 *
 * Prefer this over a bare `mkdtempSync(join(tmpdir(), …))`: those left
 * ~128 directories behind, because the `rmSync` is easy to forget and
 * impossible to reach when a test throws. Returns the created path.
 *
 * `prefix` should name the test (`"at0275-"`). The directory is created
 * under the registered `tug-scratch-` prefix so the machine-wide
 * janitor recognizes anything that does escape (a SIGKILLed runner) as
 * debris — see `tugcore::janitor::TMP_PREFIXES`.
 */
export function testTmpDir(prefix = ""): string {
  const dir = mkdtempSync(join(tmpdir(), `tug-scratch-${prefix}`));
  onTestRunEnd(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function runTestRunEndTasks(): void {
  for (const fn of tasks) {
    try {
      fn();
    } catch {
      /* best-effort cleanup */
    }
  }
  tasks.clear();
}
