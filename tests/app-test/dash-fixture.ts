/**
 * dash-fixture.ts — creating, rounding, and releasing a real dash from an
 * app-test, by the real CLI.
 *
 * Shared because the alternative is four copies, and because the one thing
 * that is genuinely hard here has to be got right in all of them: **the app
 * tests run in parallel and they all drive the same git repository.** Two
 * `tugutil dash create`s in flight at once collide on `index.lock`, and the
 * loser exits non-zero mid-`beforeAll` with a message about another git
 * process. The lock is transient by construction — whoever holds it is a
 * fraction of a second from dropping it — so every git-touching verb here
 * retries through it rather than failing the file that lost a coin toss.
 *
 * Everything else about a dash fixture is deliberately unclever: the dash is
 * real, the round is a real commit, and the release really discards the branch
 * and the worktree.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** How many times a git-touching verb retries through a held `index.lock`. */
const LOCK_RETRIES = 12;
const LOCK_BACKOFF_MS = 250;

/**
 * The built CLI, by absolute path.
 *
 * `~/.local/bin/tugutil` is a symlink whose target is somebody else's build
 * decision, which is not a thing a test should inherit silently.
 *
 * `projectDir`'s **own** `tugrust/target` comes first, then the main
 * checkout's. That order matters on a dash worktree: a worktree builds into
 * its own target dir, so a test exercising a CLI verb this branch adds would
 * otherwise run the main checkout's older binary and fail with `unrecognized
 * subcommand` — a stale build reported as a broken feature. A worktree that
 * has not been built falls back, which is what a test touching no Rust wants.
 */
export function tugutilPath(projectDir: string): string {
  const commonDir = Bun.spawnSync(
    ["git", "-C", projectDir, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    {},
  )
    .stdout.toString()
    .trim();
  const roots = [projectDir, resolve(commonDir, "..")];
  for (const root of roots) {
    for (const profile of ["debug", "release"]) {
      const candidate = join(root, "tugrust/target", profile, "tugutil");
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`dash-fixture: no built tugutil under ${roots.join(" or ")}`);
}

function heldLock(stderr: string): boolean {
  return stderr.includes("index.lock") || stderr.includes("Another git process");
}

/** Block the calling thread — these run in `beforeAll`, which is synchronous. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export interface TugutilRun {
  /** Where to run — the project the dash belongs to. */
  cwd: string;
  /** JSON handed to the command on stdin (`dash commit`'s round metadata). */
  stdin?: string;
  /** Extra environment, merged over the caller's. */
  env?: Record<string, string>;
  /** Whether a non-zero exit throws. Off for best-effort cleanup. */
  required?: boolean;
}

/** Run one `tugutil` verb, retrying through a transient git lock. */
export function tugutil(args: string[], opts: TugutilRun): string {
  const bin = tugutilPath(opts.cwd);
  let last = "";
  for (let attempt = 0; attempt <= LOCK_RETRIES; attempt += 1) {
    const out = Bun.spawnSync([bin, ...args], {
      cwd: opts.cwd,
      stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
      env: { ...process.env, ...(opts.env ?? {}) },
    });
    if (out.exitCode === 0) return out.stdout.toString();
    last = out.stderr.toString();
    if (!heldLock(last)) break;
    sleepSync(LOCK_BACKOFF_MS);
  }
  if (opts.required === false) return "";
  throw new Error(`tugutil ${args.join(" ")} failed: ${last}`);
}

export interface CreatedDash {
  /** The dash's owner key — what `bind_dash_ok` carries and the lane fronts on. */
  id: string;
  /** Absolute worktree path. */
  worktree: string;
}

/** Create a dash, returning its owner key and worktree. */
export function createDash(
  projectDir: string,
  name: string,
  description: string,
): CreatedDash {
  const out = JSON.parse(
    tugutil(["dash", "create", name, "--description", description, "--json"], {
      cwd: projectDir,
    }),
  ) as { data: { id: string; worktree: string } };
  return { id: out.data.id, worktree: out.data.worktree };
}

/** Commit everything dirty in the dash's worktree as one round. */
export function commitRound(
  projectDir: string,
  name: string,
  subject: string,
): void {
  tugutil(["dash", "commit", name, "--message", subject, "--json"], {
    cwd: projectDir,
    stdin: JSON.stringify({ instruction: subject, summary: "app-test fixture round" }),
  });
}

/** Discard the dash — branch and worktree, dirt included. Best effort: a
 *  cleanup that throws would mask the failure the test was reporting. */
export function releaseDash(projectDir: string, name: string): void {
  tugutil(["dash", "release", name, "--json"], {
    cwd: projectDir,
    required: false,
  });
}
