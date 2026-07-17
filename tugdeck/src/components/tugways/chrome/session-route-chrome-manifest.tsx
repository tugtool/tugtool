/**
 * `SessionRouteChromeManifest` — the per-route Z4B indicator cluster ([P03],
 * Table T01). Replaces the old `SessionRouteShellGate` disable-scatter: chips
 * absent from a route now **unmount** (show/hide), rather than render disabled.
 *
 * Table T01 — route → visible chips (the identity badge always leads):
 *
 *   ❯ code    : identity(Claude Code) · Session · Project · Mode · Model · Effort
 *   $ shell   : identity(Shell)       · Session · Project · Cwd · Visibility
 *   ? btw     : identity(Claude Code) · Session · Project · Visibility
 *   ⌕ find    : Session · Project · Find-cluster (Case/Word/Grep + count)
 *   ± changes : Session · Project · Cwd  (a commit, not a Claude turn)
 *   ↺ history : identity(Claude Code) · Session · Project · Mode · Model · Effort
 *
 * The occupant of the Z4B centred-floating slot is a layout decision, not a
 * contract ([D97]) — swapping it on an explicit route gesture is the slot
 * working as designed. Two invariants hold across a flip:
 *
 *  - **[L26] identity badge leads every session route.** On code / shell / btw
 *    it is the first child at the same position, so React reconciles it as the
 *    same mount; the badge's own `isShell` branch swaps its face (btw shares the
 *    code face per T01). Find is the deliberate exception — it is about the
 *    transcript, not the Claude session, so it drops the identity badge and
 *    leads with the Project chip instead.
 *  - **[L26] a chip that survives a flip keeps its mount.** Stable keys let
 *    React match `Session` / `Project` across routes; chips a route drops
 *    unmount, and the focus cycle skips them for free (an absent stop is not
 *    in the Tab walk).
 *
 * Reads the active route through `useRoute` ([L02]); it is mounted inside the
 * prompt entry's indicator slot where the `RouteLifecycle` provider is in
 * scope. Pure layout selection — every chip is built by the caller (session card)
 * with its own stores and focus orders and threaded in as a slot, so the
 * store wiring stays put.
 */

import { Fragment } from "react";
import type React from "react";

import { useRoute } from "@/lib/route-lifecycle";
import {
  ROUTE_BTW,
  ROUTE_CHANGES,
  ROUTE_FIND,
  ROUTE_HISTORY,
  ROUTE_SHELL,
} from "@/lib/route-constants";

/** The Z4B chip slots the manifest can place, keyed by identity. */
export type RouteChipKey =
  | "identity"
  | "session"
  | "project"
  | "cwd"
  | "mode"
  | "model"
  | "effort"
  | "visibility"
  | "find";

/**
 * Table T01 as pure data: the ordered chip keys a route shows, left-to-right.
 * The identity badge always leads. Exported so the mapping is unit-tested
 * without mounting. An unknown/null route falls back to the code set.
 */
export function routeChipKeys(route: string | null): RouteChipKey[] {
  if (route === ROUTE_SHELL) return ["identity", "session", "project", "cwd", "visibility"];
  if (route === ROUTE_BTW) return ["identity", "session", "project", "visibility"];
  // Find replaces the model chrome with its own search controls — the
  // transcript, not the Claude session, is what Find operates on, so the
  // identity badge drops out here. The Session and Project chips stay: they
  // name which session's transcript is being searched.
  if (route === ROUTE_FIND) return ["session", "project", "find"];
  // Changes commits the workspace — it is not a Claude turn, so it drops
  // the identity badge (like Find) and names the session + project (+ its
  // working directory) the commit lands in.
  if (route === ROUTE_CHANGES) return ["session", "project", "cwd"];
  // History sends an on-record Claude turn (`/tugplug:history`), so it
  // carries the full Claude chrome exactly like the code route.
  if (route === ROUTE_HISTORY)
    return ["identity", "session", "project", "mode", "model", "effort"];
  return ["identity", "session", "project", "mode", "model", "effort"];
}

export interface SessionRouteChromeManifestProps {
  /** Always-present identity badge — never unmounts across a route flip. */
  identityBadge: React.ReactNode;
  /** Claude-session chip — shown on every route. */
  session: React.ReactNode;
  /** Project chip — shown on every route. */
  project: React.ReactNode;
  /** Working-directory chip — shell route only. */
  cwd: React.ReactNode;
  /** Permission-mode chip — code route only. */
  mode: React.ReactNode;
  /** Model chip — code route only. */
  model: React.ReactNode;
  /** Reasoning-effort chip — code route only. */
  effort: React.ReactNode;
  /** VISIBILITY toggle (Context / Private) — shell + btw routes only. */
  visibility: React.ReactNode;
  /** Find cluster (Case/Word/Grep + count) — find route only. */
  find: React.ReactNode;
}

export function SessionRouteChromeManifest({
  identityBadge,
  session,
  project,
  cwd,
  mode,
  model,
  effort,
  visibility,
  find,
}: SessionRouteChromeManifestProps): React.ReactElement {
  const route = useRoute();
  const slots: Record<RouteChipKey, React.ReactNode> = {
    identity: identityBadge,
    session,
    project,
    cwd,
    mode,
    model,
    effort,
    visibility,
    find,
  };
  // Stable keys preserve mount identity for a chip that survives a route flip
  // (Session and Project on every route); chips a route drops unmount, and the
  // focus cycle skips them for free.
  return (
    <>
      {routeChipKeys(route).map((key) => (
        <Fragment key={key}>{slots[key]}</Fragment>
      ))}
    </>
  );
}
