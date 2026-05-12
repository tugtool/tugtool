/**
 * `BlockFindButton` — reusable Find affordance for body kinds.
 *
 * Standardizes the action-row Find trigger (the magnifier icon +
 * "Find" label that opens a body kind's find session) across
 * `FileBlock` and any future body kind that surfaces searchable
 * content (DiffBlock once diff-Find lands, TerminalBlock once
 * terminal-Find lands, a future MarkdownBlock, etc.).
 *
 * Encapsulates:
 *
 *  - Lucide `Search` icon + "Find" label in the size 2xs ghost
 *    typography (uppercase + 0.06em letter-spacing) shared across
 *    the action row.
 *  - Position-stable click. The Find gesture commonly causes a
 *    layout change (opening a find row beneath the chrome
 *    increases the block's height); the wrapper measures the
 *    button's pre-click viewport position and writes the
 *    post-click `scrollTop` to keep it under the cursor.
 *
 * The variable parts are:
 *
 *  - `onClick` — what happens when Find is invoked. Block-kind
 *    specific (open the find row, mount a find input, focus an
 *    existing find session, etc.). The position-stable wrap is
 *    handled inside; the consumer's callback just owns the side
 *    effect.
 *  - `disabled` — block-specific predicate. FileBlock disables
 *    Find when the body is collapsed (the substrate isn't mounted
 *    so there's nothing to search).
 *  - `aria-label` — the per-block phrasing ("Search in file",
 *    "Search in diff", etc.).
 *
 * Laws: [L03] `usePositionStableClick` honors the layout-effect
 *       registration contract internally.
 *
 * @module components/tugways/body-kinds/affordances/block-find-button
 */

import React from "react";
import { Search } from "lucide-react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useOuterScrollport } from "@/components/tugways/internal/outer-scrollport-context";
import { usePositionStableClick } from "@/components/tugways/internal/use-position-stable-click";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BlockFindButtonProps {
  /**
   * Called when the user invokes Find. The affordance has already
   * wrapped the call in `usePositionStableClick` so the button's
   * viewport position holds across any layout change the side
   * effect causes (most commonly: a find row mounting beneath the
   * chrome).
   */
  onClick: () => void;
  /**
   * Disable the button. Typically `true` when the body kind's
   * substrate isn't mounted (e.g., a collapsed FileBlock has no
   * `TugCodeView` to drive a find session).
   */
  disabled?: boolean;
  /**
   * Accessible label. Per-block phrasing ("Search in file",
   * "Search in diff", etc.).
   */
  "aria-label": string;
  /**
   * Optional `data-slot` for per-block test selectors. Falls back
   * to `"block-find"` when omitted; consumers typically pass a
   * block-specific slot (e.g., `"file-search"`).
   */
  "data-slot"?: string;
  /** Optional className for cascade-scoped customization. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BlockFindButton({
  onClick,
  disabled,
  "aria-label": ariaLabel,
  "data-slot": dataSlot = "block-find",
  className,
}: BlockFindButtonProps): React.ReactElement {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  const scrollport = useOuterScrollport();
  const scrollportRef = React.useRef<HTMLElement | null>(null);
  scrollportRef.current = scrollport;
  const { stableClick } = usePositionStableClick({
    targetRef: buttonRef,
    scrollportRef,
  });

  // [L07] — stable handler reading `onClick` through a latest-ref
  // (mirrored via `useLayoutEffect`). Without the mirror, the
  // `stableClick(onClick)` arrow at the JSX site captures a fresh
  // `onClick` per render (which works, but recreates the
  // outer arrow each render); the ref-mirror lets us pin a stable
  // handler that reads the current `onClick` at fire time.
  const onClickRef = React.useRef(onClick);
  React.useLayoutEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  const handleClick = React.useCallback(() => {
    onClickRef.current();
  }, []);

  return (
    <TugPushButton
      ref={buttonRef}
      className={className}
      data-slot={dataSlot}
      icon={<Search />}
      subtype="icon-text"
      emphasis="ghost"
      size="2xs"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={() => stableClick(handleClick)}
    >
      Find
    </TugPushButton>
  );
}
