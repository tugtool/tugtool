/**
 * join-verb-plan — the pure branch logic for the native `/join` local slash
 * verb ([P05]).
 *
 * `/join` mirrors `/commit` in the dash lane: bare, it opens the shade's
 * dash lane (and with exactly one dash also runs the preview — the common
 * case the bare form optimizes for); `/join <name>` runs the preview and,
 * when it comes back clean with a join draft on file, lands the squash.
 * An empty dash (nothing past base, no dirt) routes to the release
 * affordance instead of the refusal text ([P14]). Gating and dispatch live
 * in the session card — this module only decides the branch.
 *
 * @module lib/join-verb-plan
 */

/** The dash facts the planner reads, projected from the snapshot entry. */
export interface JoinDashRef {
  /** Short dash name (`display_name`). */
  name: string;
  /** Branch ref (`owner_id`, e.g. `tugdash/snippets`). */
  ownerId: string;
  rounds: number;
  dirty: boolean;
}

/** What a `/join` invocation should do. */
export type JoinVerbPlan =
  /** Bare with zero or several dashes: open the shade's dash lane. */
  | { kind: "open-lane" }
  /** Run the preview; land automatically when clean + draft ready (`autoLand`). */
  | { kind: "preview"; dash: JoinDashRef; autoLand: boolean }
  /** The named dash has nothing to join — front its release affordance ([P14]). */
  | { kind: "release-handoff"; dash: JoinDashRef }
  /** No dash by that name. */
  | { kind: "unknown"; name: string };

/** True when releasing is the only sensible act: no rounds, no dirt. A dirty
 *  empty dash still joins (the join auto-commits worktree dirt first). */
function isEmpty(dash: JoinDashRef): boolean {
  return dash.rounds === 0 && !dash.dirty;
}

/** Decide the branch for a `/join` invocation ([P05]). Pure. */
export function planJoinVerb(
  args: string,
  dashes: readonly JoinDashRef[],
): JoinVerbPlan {
  const name = args.trim();
  if (name.length === 0) {
    if (dashes.length !== 1) return { kind: "open-lane" };
    const dash = dashes[0];
    if (isEmpty(dash)) return { kind: "release-handoff", dash };
    return { kind: "preview", dash, autoLand: false };
  }
  const dash =
    dashes.find((d) => d.name === name) ??
    dashes.find((d) => d.ownerId === name || d.ownerId === `tugdash/${name}`);
  if (dash === undefined) return { kind: "unknown", name };
  if (isEmpty(dash)) return { kind: "release-handoff", dash };
  return { kind: "preview", dash, autoLand: true };
}
