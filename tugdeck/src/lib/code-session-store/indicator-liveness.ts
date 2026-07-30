/**
 * indicator-liveness.ts — the one vocabulary every {@link
 * TugProgressIndicator} call site derives its `state` from.
 *
 * **The rule: motion means the machine is doing something right now.**
 * The indicator's `running` state is the only one that breathes, and a
 * breathing glyph is a claim about the present tense. Everything else is
 * a pose:
 *
 *  - `running`   — work is executing this instant. Breathes.
 *  - `paused`    — blocked on a human act, and cannot proceed until one
 *                  arrives. Still, full-size, and substantial on the
 *                  presence ladder (0.7): it reads as *waiting on you*
 *                  rather than as idle, which is the whole reason the
 *                  state exists.
 *  - `stopped`   — not executing. Covers "never started", "deferred to a
 *                  clock", and "no longer relevant" alike. Recedes.
 *  - `completed` — finished, successfully.
 *  - `aborted`   — finished, badly.
 *
 * The distinction this module exists to hold is between *executing* and
 * *pending*, which are not the same thing and were conflated at four
 * independent call sites before this module existed. A question waiting
 * on the user, a cron scheduled for tomorrow, and a goal set an hour ago
 * are all pending; none of them is executing; none of them may breathe.
 * They differ from each other, though, and the difference is what they
 * are waiting on — a human (`paused`) or nothing at all (`stopped`).
 *
 * Deriving `state` anywhere but here is how that conflation happened the
 * first time. New indicator surfaces add a function to this module rather
 * than an inline ternary at the call site, and `indicator-liveness.test.ts`
 * holds every derivation to the rule above.
 *
 * @module lib/code-session-store/indicator-liveness
 */

import type { TugProgressIndicatorState } from "@/components/tugways/tug-progress-indicator";

import type { GoalState } from "./select-goal";
import type { JobStatus } from "./select-jobs";
import type { TaskStatus } from "./select-task-list";

/**
 * The states that breathe. Exported so the guard test can assert the rule
 * from the outside rather than restating it.
 */
export const LIVE_INDICATOR_STATES: ReadonlySet<TugProgressIndicatorState> =
  new Set<TugProgressIndicatorState>(["running"]);

/**
 * A task row's state — the task's own status, gated on the session
 * actually working.
 *
 * `in_progress` is a claim the assistant wrote into its checklist, not an
 * observation of the runtime: a session that stops mid-turn leaves the row
 * saying `in_progress` forever. The `idle` gate is what keeps the glyph
 * honest — the checklist still reads "in progress", the dot does not
 * claim it is happening.
 */
export function taskRowState(
  status: TaskStatus,
  idle: boolean,
): TugProgressIndicatorState {
  if (status === "completed") return "completed";
  if (status === "in_progress") return idle ? "stopped" : "running";
  return "stopped";
}

/**
 * A job row's state.
 *
 * `scheduled` is `stopped`, not `running`: a wakeup promised for tomorrow
 * is not work in flight, and a glyph that breathes all night on its behalf
 * is describing something that is not happening. The row label's countdown
 * already carries the "later, not now" reading, and carries it better than
 * motion can — it says *when*.
 */
export function jobRowState(status: JobStatus): TugProgressIndicatorState {
  switch (status) {
    case "running":
      return "running";
    case "scheduled":
      return "stopped";
    case "completed":
      return "completed";
    case "failed":
      return "aborted";
    case "stopped":
      return "stopped";
  }
}

/**
 * The goal row's state.
 *
 * A goal is not work — it is a standing condition on the session, set once
 * and evaluated at the end of turns that happen for their own reasons.
 * `active` therefore means "still set", never "executing", so it rests at
 * `stopped`; the evaluator's rounds are visible in the row's own text.
 */
export function goalRowState(goal: GoalState): TugProgressIndicatorState {
  if (goal.status === "achieved") return "completed";
  return "stopped";
}
