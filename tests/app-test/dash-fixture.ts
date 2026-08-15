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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

/**
 * A document that parses as a plan, carrying one unstamped Review Record round
 * for `plan stamp` to write into.
 *
 * It has to be a *real* plan, not a stub: `dash step start` is the only writer
 * of the dash's recorded plan path, and it refuses unless the document parses
 * and carries a `#step-1` ledger row.
 */
const FIXTURE_PLAN = `## A Fixture Plan {#fixture-plan}

### Plan Metadata {#plan-metadata}

| Field | Value |
|---|---|
| Owner | app-test |

### Review Record {#review-record}

**Round 1 — 2026-08-14, opus.** Lint: 0 errors, 0 warnings.

### Phase Overview {#phase-overview}

The fixture's context.

### Execution Steps {#execution-steps}

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | The only step | pending | — |

#### Step 1: The only step {#step-1}

**Commit:** \`fixture(scope): do it\`

**References:** [P01] the decision, (#phase-overview)

**Tasks:**
- [ ] Do the thing.

**Tests:**
- [ ] Unit: the thing works.

**Checkpoint:**
- [ ] \`cargo nextest run\`

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** the thing.
`;

/**
 * Give a dash a plan it is driving, reviewed and stamped.
 *
 * The order is load-bearing in both directions. `dash step start` **mutates**
 * the plan — it flips the ledger row to `in progress` — so it must run before
 * the stamp, or the stamp would be invalidated by the very next verb. And
 * ledger status cells sit outside the hashed content, so that mutation does
 * not itself make the plan stale, which is what makes a test's "not stale yet"
 * assertion mean anything.
 */
export function recordStampedPlan(
  projectDir: string,
  name: string,
  worktree: string,
): string {
  const planPath = join(worktree, "plan.md");
  writeFileSync(planPath, FIXTURE_PLAN);
  tugutil(["dash", "step", name, "start", "1", "--plan", "plan.md"], {
    cwd: projectDir,
  });
  tugutil(["plan", "stamp", planPath], { cwd: projectDir });
  return planPath;
}

/** Move the document past its stamp — one appended line is the whole edit. */
export function makePlanStale(planPath: string): void {
  writeFileSync(planPath, `${readFileSync(planPath, "utf8")}\nOne more line.\n`);
}

/** Discard the dash — branch and worktree, dirt included. Best effort: a
 *  cleanup that throws would mask the failure the test was reporting. */
export function releaseDash(projectDir: string, name: string): void {
  tugutil(["dash", "release", name, "--json"], {
    cwd: projectDir,
    required: false,
  });
}
