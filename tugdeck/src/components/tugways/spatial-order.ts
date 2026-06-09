/**
 * spatial-order — the pure resolver for the spatial arrow-navigation plane ([P22]/[P23]).
 *
 * Tab moves the focus ring linearly (the declared `groupOrder`); arrows move it
 * *spatially*, in an order the layout author declares — named ordered rings + seams
 * (the default), with per-node neighbor overrides as an escape hatch. The resolver is
 * a pure lookup over that declared table: given the ringed node, an arrow direction,
 * and (for a selection-group node) its internal cursor position, it returns the next
 * move. No geometry, no heuristics.
 *
 * Two invariants the model guarantees by construction, not by heuristic:
 *  - **never beeps** — a closed ring always yields a next node; a declared seam always
 *    has a target. Resolution returns `none` only for an *undeclared* arrow — the
 *    dead-arrow case the dev-time reachability check lints for — never as a runtime
 *    dead-end the user feels on a well-authored layout.
 *  - **reversible** — the author declares both edges; a closed ring reverses for free,
 *    and seams reverse when the author writes the return edge (the layout's job).
 *
 * A selection group is ONE ring node (the engine key view; "Tab never lands on an
 * item"). Arrows *along the group's own axis* delegate to the group's appearance-only
 * cursor (`useFocusCursor`, `data-key-cursor`) — the resolver returns `cursor` and the
 * navigator drives `moveCursor`. Only an arrow at the group's edge crosses a *seam* to
 * the next key view. This keeps the language contract intact: the cursor is never a
 * focusable, and the ring never lands on an item.
 *
 * Pure data-in / data-out — no DOM, no manager. The navigator wires this onto the
 * per-card `FocusContext` and supplies the live cursor index for group nodes.
 */

export type SpatialDirection = "up" | "down" | "left" | "right";
export type SpatialAxis = "horizontal" | "vertical";

/** An ordered run of key views along one axis. Closed rings wrap (never-beep). */
export interface SpatialRing {
  readonly axis: SpatialAxis;
  readonly nodes: readonly string[];
  /** Wrap at the edges so the ring always yields a next node. Default `true`. */
  readonly closed?: boolean;
}

/** An explicit boundary crossing — carries the ring from one node to another. */
export interface SpatialSeam {
  readonly from: string;
  readonly direction: SpatialDirection;
  readonly to: string;
}

/** A per-node neighbor override — the escape hatch; wins over rings and seams. */
export interface SpatialOverride {
  readonly from: string;
  readonly direction: SpatialDirection;
  readonly to: string;
}

/**
 * A selection-group node that delegates its internal cursor to the navigator. The
 * group is ONE ring node with a 1D cursor: any arrow moves the cursor (down / right
 * → next, up / left → previous), matching the group's existing both-axes roving.
 * `length` is the number of cursor positions; the resolver uses it for edge
 * detection — an in-bounds move stays in the node as a `cursor` delta, an
 * off-the-end move falls through to a seam (so the boundary crosses to the next key
 * view). The navigator supplies this live from the group's `useFocusCursor` handle.
 */
export interface SpatialGroup {
  readonly node: string;
  readonly length: number;
}

/** The declared spatial order for one bounded scope (a card or a dialog). */
export interface SpatialOrder {
  readonly rings: readonly SpatialRing[];
  readonly seams?: readonly SpatialSeam[];
  readonly overrides?: readonly SpatialOverride[];
  readonly groups?: readonly SpatialGroup[];
}

export type SpatialResolution =
  /** Move the ring to another key view. */
  | { readonly kind: "ring"; readonly target: string }
  /** Delegate to the ringed group's internal cursor (stay in the node). */
  | { readonly kind: "cursor"; readonly delta: 1 | -1 }
  /** Undeclared arrow — the dead-arrow case; the navigator warns and does nothing. */
  | { readonly kind: "none" };

const AXIS_OF: Record<SpatialDirection, SpatialAxis> = {
  left: "horizontal",
  right: "horizontal",
  up: "vertical",
  down: "vertical",
};

const SIGN_OF: Record<SpatialDirection, 1 | -1> = {
  right: 1,
  down: 1,
  left: -1,
  up: -1,
};

const OPPOSITE: Record<SpatialDirection, SpatialDirection> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

/** The reverse of a direction — used to declare and verify return edges. */
export function oppositeDirection(direction: SpatialDirection): SpatialDirection {
  return OPPOSITE[direction];
}

/** Whether a `KeyboardEvent.key` is one of the four arrows the spatial plane reads. */
export function arrowDirection(key: string): SpatialDirection | null {
  switch (key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    default:
      return null;
  }
}

/**
 * Resolve one arrow press against the declared order.
 *
 * `cursorIndex` is the live cursor position for a group node (from `useFocusCursor`);
 * pass `null` for a non-group node. Resolution order (most specific first):
 *  1. per-node override (the escape hatch);
 *  2. group delegation — a non-edge move along the group's axis stays in the node;
 *  3. seam — an explicit boundary crossing;
 *  4. ring — move along a ring on the matching axis, wrapping when closed;
 *  5. none — undeclared (the dead-arrow / reachability-warning case).
 */
export function resolveSpatial(
  order: SpatialOrder,
  node: string,
  direction: SpatialDirection,
  cursorIndex: number | null = null,
): SpatialResolution {
  // 1. Per-node override — explicit author intent wins over everything.
  const override = order.overrides?.find(
    (o) => o.from === node && o.direction === direction,
  );
  if (override) return { kind: "ring", target: override.to };

  // 2. Group delegation — any arrow moves the 1D cursor (down / right → next, up /
  //    left → previous), staying inside the node, UNLESS the cursor sits at the edge
  //    in that direction, in which case it falls through to a seam (crossing the
  //    group boundary to the next key view).
  const group = order.groups?.find((g) => g.node === node);
  if (group && cursorIndex !== null) {
    const next = cursorIndex + SIGN_OF[direction];
    if (next >= 0 && next < group.length) {
      return { kind: "cursor", delta: SIGN_OF[direction] };
    }
    // at the group edge → fall through to seam / ring
  }

  // 3. Seam — an explicit boundary crossing for this (node, direction).
  const seam = order.seams?.find(
    (s) => s.from === node && s.direction === direction,
  );
  if (seam) return { kind: "ring", target: seam.to };

  // 4. Ring — move along a ring whose axis matches the direction and contains the node.
  for (const ring of order.rings) {
    if (ring.axis !== AXIS_OF[direction]) continue;
    const index = ring.nodes.indexOf(node);
    if (index < 0) continue;
    const raw = index + SIGN_OF[direction];
    if (raw >= 0 && raw < ring.nodes.length) {
      return { kind: "ring", target: ring.nodes[raw] };
    }
    // edge of an open ring with no seam/override above → dead arrow; a closed ring wraps
    if ((ring.closed ?? true) && ring.nodes.length > 0) {
      const wrapped = (raw + ring.nodes.length) % ring.nodes.length;
      return { kind: "ring", target: ring.nodes[wrapped] };
    }
    break;
  }

  // 5. Undeclared — the dead-arrow case; the navigator emits a dev-time reachability
  //    warning (never a beep) and leaves the ring where it is.
  return { kind: "none" };
}
