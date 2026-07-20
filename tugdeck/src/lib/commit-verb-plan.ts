/**
 * commit-verb-plan — the pure Table T01 branch logic for the native
 * `/commit` local slash verb ([P04]).
 *
 * `/commit` is double-duty: with no ready draft, beat 1 opens the Changes
 * shade and generates a draft; with one, beat 2 lands it. `/commit <message>`
 * is the explicit-message fast path (the argument wins over the draft);
 * `/commit now` collapses the two beats into one. Gating ([P08]) and
 * dispatch live in the session card — this module only decides which beat a
 * given invocation is.
 *
 * @module lib/commit-verb-plan
 */

/** What a `/commit` invocation should do (Table T01). */
export type CommitVerbPlan =
  /** Beat 1: open the shade and generate a draft into it. */
  | { kind: "draft" }
  /** Beat 2: apply the gates and land with this message. */
  | { kind: "land"; message: string }
  /** `/commit now` with no ready draft: generate, then land in one beat. */
  | { kind: "generate-then-land" };

/**
 * Decide the beat for a `/commit` invocation (Table T01).
 *
 * `args` is the trimmed remainder after the command name; `readyDraftMessage`
 * is the ready draft's message when one exists (overlay phase `ready`, or a
 * persisted non-empty `entry.draft.message`), else null. Pure.
 */
export function planCommitVerb(
  args: string,
  readyDraftMessage: string | null,
): CommitVerbPlan {
  const trimmed = args.trim();
  if (trimmed === "now") {
    return readyDraftMessage !== null
      ? { kind: "land", message: readyDraftMessage }
      : { kind: "generate-then-land" };
  }
  if (trimmed.length > 0) {
    // The explicit-message fast path — the argument wins over the draft.
    return { kind: "land", message: trimmed };
  }
  return readyDraftMessage !== null
    ? { kind: "land", message: readyDraftMessage }
    : { kind: "draft" };
}
