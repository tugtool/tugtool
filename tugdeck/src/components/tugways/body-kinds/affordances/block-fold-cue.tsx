/**
 * `BlockFoldCue` — reusable fold-cue affordance for body kinds.
 *
 * Standardizes the action-row fold cue (the trailing-edge chevron
 * + count label that toggles a body's collapsed state) across
 * `FileBlock`, `TerminalBlock`, `DiffBlock`, and any future body
 * kind that surfaces an expand/fold gesture. Encapsulates:
 *
 *  - Chevron icon swap (`ChevronsDown` when collapsed → "expand
 *    me"; `ChevronsUp` when expanded → "collapse me"). Same shape
 *    across the rest / hover states; only the direction flips.
 *  - `aria-expanded` reflecting the current state.
 *  - Position-stable click (`usePositionStableClick`). The fold
 *    gesture inherently changes document height, so the wrapper
 *    measures the cluster's pre-click viewport position and writes
 *    the post-click `scrollTop` to keep the user's cursor over the
 *    button across the layout change.
 *  - `tug-disengage-follow-bottom` event dispatch BEFORE the
 *    toggle. A host `TugListView` listening on its scroll
 *    container catches the bubbling event and flips
 *    `isFollowingBottom` to false so the subsequent
 *    `ResizeObserver` flush (triggered by the cell-height change)
 *    bails out of `pinToBottom`. Without this, expanding a body
 *    inside a follow-bottom list scrolls the cue off-screen.
 *
 * The variable parts the consumer provides are minimal:
 *
 *  - `collapsed` — current state.
 *  - `onToggle(next)` — called with the new collapsed value. The
 *    affordance has already dispatched the disengage event and
 *    routed the call through the position-stable wrapper; the
 *    consumer's callback just owns its own state update +
 *    side effects (e.g., first-responder promotion).
 *  - `label` — the formatted count ("8 hunks", "300 lines").
 *  - `ariaLabelCollapse` / `ariaLabelExpand` — verb pairs for
 *    screen readers ("Collapse file" / "Expand file", etc.).
 *
 * Laws: [L03] `usePositionStableClick` honors the layout-effect
 *       registration contract internally; [L06] the chevron icon
 *       is a render-time JSX choice driven by the `collapsed` prop
 *       (data, not appearance — the chevron *direction* is
 *       state-derived structure, not a CSS-only visual).
 *
 * @module components/tugways/body-kinds/affordances/block-fold-cue
 */

import React from "react";
import { ChevronsDown, ChevronsUp } from "lucide-react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useOuterScrollport } from "@/components/tugways/internal/outer-scrollport-context";
import { usePositionStableClick } from "@/components/tugways/internal/use-position-stable-click";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BlockFoldCueProps {
  /** Current collapsed state. */
  collapsed: boolean;
  /**
   * Called with the new collapsed value. The affordance has
   * already:
   *  - Dispatched `tug-disengage-follow-bottom` on its own button
   *    element (bubbles up to any host TugListView).
   *  - Wrapped the call in `usePositionStableClick` so the
   *    cluster's viewport position holds across the height change.
   *
   * The consumer's callback owns block-specific concerns: state
   * mutation (controlled vs uncontrolled), first-responder
   * promotion via the chain manager, host-notification callbacks.
   */
  onToggle: (next: boolean) => void;
  /**
   * Visible label inside the button — typically "N hunks" or "N
   * lines". The consumer formats with locale-aware number rules
   * (`toLocaleString`) and singular/plural words; the affordance
   * just renders the resulting string.
   */
  label: string;
  /** ARIA label when the click would collapse the block (expanded → collapsed). */
  ariaLabelCollapse: string;
  /** ARIA label when the click would expand the block (collapsed → expanded). */
  ariaLabelExpand: string;
  /**
   * Optional `data-slot` for per-block test selectors. Falls back
   * to `"block-fold-cue"` when omitted; consumers typically pass
   * a block-specific slot (e.g., `"diff-fold-cue"`, `"file-fold-cue"`).
   */
  "data-slot"?: string;
  /** Optional className for cascade-scoped customization. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BlockFoldCue({
  collapsed,
  onToggle,
  label,
  ariaLabelCollapse,
  ariaLabelExpand,
  "data-slot": dataSlot = "block-fold-cue",
  className,
}: BlockFoldCueProps): React.ReactElement {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  const scrollport = useOuterScrollport();
  const scrollportRef = React.useRef<HTMLElement | null>(null);
  scrollportRef.current = scrollport;
  const { stableClick } = usePositionStableClick({
    targetRef: buttonRef,
    scrollportRef,
  });

  // [L07] — the click handler is `useCallback([])` (stable across
  // renders) and reads `collapsed` + `onToggle` through latest-refs
  // mirrored via `useLayoutEffect`. This avoids the deps-array
  // pattern's closure-recreation churn AND matches the literal
  // wording of L07 ("Every action handler must access current
  // state through refs or stable singletons, never stale
  // closures"). The consumer's `onToggle` may itself be deps-based
  // (e.g., FileBlock's `handleFoldToggle` recreates when
  // `chainManager` changes); the mirror picks up the latest
  // reference at every commit.
  const collapsedRef = React.useRef(collapsed);
  React.useLayoutEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);
  const onToggleRef = React.useRef(onToggle);
  React.useLayoutEffect(() => {
    onToggleRef.current = onToggle;
  }, [onToggle]);

  const handleClick = React.useCallback(() => {
    // Dispatch BEFORE calling onToggle so any host TugListView
    // flips `isFollowingBottom` to false before React commits the
    // new cell height; the subsequent ResizeObserver flush bails
    // out of `pinToBottom`. Bubbles through the DOM tree so the
    // ancestor scroll container catches it; non-list hosts simply
    // ignore the event. Dispatching on the button itself (rather
    // than the block root) saves the consumer from threading a
    // root ref through — the bubble reaches the same ancestor
    // either way.
    buttonRef.current?.dispatchEvent(
      new CustomEvent("tug-disengage-follow-bottom", { bubbles: true }),
    );
    onToggleRef.current(!collapsedRef.current);
  }, []);

  return (
    <TugPushButton
      ref={buttonRef}
      className={className}
      data-slot={dataSlot}
      icon={collapsed ? <ChevronsDown /> : <ChevronsUp />}
      subtype="icon-text"
      emphasis="ghost"
      size="2xs"
      aria-expanded={!collapsed}
      aria-label={collapsed ? ariaLabelExpand : ariaLabelCollapse}
      onClick={() => stableClick(handleClick)}
    >
      {label}
    </TugPushButton>
  );
}
