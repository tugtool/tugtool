/**
 * `BlockActionsCluster` — the shared affordance-row wrapper for body
 * kinds.
 *
 * A body kind groups its resting affordances (`BlockCopyButton`,
 * `BlockFoldCue`, sort / view toggles) into one inline-flex row that
 * sits at the trailing edge of the block's header — or portals into a
 * host `ToolWrapperChrome`'s actions slot when the block is composed
 * `embedded`. This component is the single source of truth for that
 * row's markup and styling (`block-actions-cluster.css`), so the
 * cluster can't drift between body kinds.
 *
 * The consumer provides only the variable part:
 *
 *  - `data-slot` — the per-block test / scoping hook
 *    (`"diff-actions"`, `"terminal-actions"`, …). Required: every
 *    body kind already owns a distinct slot name for its affordance
 *    row, and downstream tests query on it.
 *  - `className` — optional cascade-scoped customization, forwarded
 *    onto the cluster `<span>`. No body kind needs it today; it
 *    exists so a future block-specific tweak has a hook without
 *    re-introducing a bespoke wrapper.
 *
 * Laws:
 *  - [L19] component-authoring — `.tsx` + `.css` pair, exported props
 *    interface, this docstring.
 *  - [L20] component-token sovereignty — layout-only; the cluster
 *    paints nothing and reads no `--tugx-{kind}-*` tokens, so it
 *    composes inside any body kind's header without reaching into
 *    that kind's slot family.
 *
 * @module components/tugways/body-kinds/affordances/block-actions-cluster
 */

import "./block-actions-cluster.css";

import React from "react";

import { cn } from "@/lib/utils";

export interface BlockActionsClusterProps {
  /**
   * The affordances to group — typically a `<BlockCopyButton />`
   * plus an optional `<BlockFoldCue />` / sort / view toggle.
   */
  children: React.ReactNode;
  /**
   * Per-block `data-slot` for test selectors and CSS scoping
   * (`"diff-actions"`, `"terminal-actions"`, `"json-actions"`, …).
   * Every body kind already owns a distinct slot name for its
   * affordance row, so this is required rather than defaulted.
   */
  "data-slot": string;
  /**
   * Optional className for cascade-scoped customization. Forwarded
   * onto the cluster `<span>`. Unused by every body kind today.
   */
  className?: string;
}

export function BlockActionsCluster({
  children,
  "data-slot": dataSlot,
  className,
}: BlockActionsClusterProps): React.ReactElement {
  return (
    <span
      className={cn("tugx-block-actions-cluster", className)}
      data-slot={dataSlot}
    >
      {children}
    </span>
  );
}
