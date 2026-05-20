/**
 * Block affordance library — reusable action-row controls (and
 * their state hooks) for body kinds.
 *
 * Each affordance is a self-contained component that handles the
 * standard contract (position-stable click via the outer
 * scrollport context, the chevron/icon shape, the size 2xs ghost
 * emphasis matching the action-row vocabulary, accessibility
 * attributes). Block kinds compose them and pass the variable
 * parts:
 *
 *  - `BlockActionsCluster` — the inline-flex row that groups a
 *    block's affordances; one shared declaration so the cluster
 *    can't drift between body kinds.
 *  - `BlockCopyButton` — Copy → Copied controlled-confirmation
 *    flash, width-stabilized so the swap doesn't jostle siblings.
 *  - `BlockFoldCue` — chevron + count label, releases the host
 *    scroller's follow-bottom lock via `useScroller().disengage`
 *    before the toggle so a host `TugListView` drops its auto-pin.
 *  - `useBlockFoldState` — the state half of the fold feature:
 *    controlled / uncontrolled resolution, mount-in-saved-state,
 *    [A9] preservation, and the toggle. A body kind pairs it with
 *    `BlockFoldCue` and the expand / collapse axis is complete.
 *
 * Adding a new affordance: create another component (or hook) in
 * this directory, follow the same "encapsulate the contract, expose
 * the variability" shape, and re-export below. The downstream body
 * kinds compose them as needed.
 *
 * @module components/tugways/body-kinds/affordances
 */

export { BlockActionsCluster } from "./block-actions-cluster";
export type { BlockActionsClusterProps } from "./block-actions-cluster";

export { BlockCopyButton, COPIED_FLASH_MS } from "./block-copy-button";
export type { BlockCopyButtonProps } from "./block-copy-button";

export { BlockFoldCue } from "./block-fold-cue";
export type { BlockFoldCueProps } from "./block-fold-cue";

export { useBlockFoldState } from "./use-block-fold-state";
export type {
  BlockFoldState,
  UseBlockFoldStateOptions,
} from "./use-block-fold-state";
