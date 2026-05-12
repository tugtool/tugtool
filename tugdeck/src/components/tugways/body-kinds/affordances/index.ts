/**
 * Block affordance library — reusable action-row buttons for body
 * kinds.
 *
 * Each affordance is a self-contained component that handles the
 * standard contract (position-stable click via the outer
 * scrollport context, the chevron/icon shape, the size 2xs ghost
 * emphasis matching the action-row vocabulary, accessibility
 * attributes). Block kinds compose them and pass the variable
 * parts:
 *
 *  - `BlockCopyButton` — Copy → Copied controlled-confirmation
 *    flash, width-stabilized so the swap doesn't jostle siblings.
 *  - `BlockFoldCue` — chevron + count label, dispatches the
 *    bubbling `tug-disengage-follow-bottom` event before the
 *    toggle so a host `TugListView` releases its auto-pin lock.
 *  - `BlockFindButton` — magnifier + "Find" label, ready to wire
 *    to a block-specific find session.
 *
 * Adding a new affordance: create another component in this
 * directory, follow the same "encapsulate the contract, expose the
 * variability" shape, and re-export below. The downstream body
 * kinds compose them as needed.
 *
 * @module components/tugways/body-kinds/affordances
 */

export { BlockCopyButton, COPIED_FLASH_MS } from "./block-copy-button";
export type { BlockCopyButtonProps } from "./block-copy-button";

export { BlockFoldCue } from "./block-fold-cue";
export type { BlockFoldCueProps } from "./block-fold-cue";

export { BlockFindButton } from "./block-find-button";
export type { BlockFindButtonProps } from "./block-find-button";
