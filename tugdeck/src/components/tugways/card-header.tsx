/**
 * CardHeader -- title bar with control buttons and window-shade collapse.
 *
 * Height is driven by --tug-base-chrome-height (defined in tug-base.css).
 * Icon sizes are CSS-driven via .tugcard-icon and .card-header-btn svg rules.
 *
 * **Authoritative references:**
 * - design-system-concepts.md [D07] Window-shade collapse
 * - Step 3: Card Frame & Title Bar
 *
 * ## Responsibilities
 *
 * - Render the title bar with title text, optional icon, and control buttons
 * - Control buttons: close, collapse (chevron), menu (horizontal ellipsis)
 * - Close button: pointer-capture pattern to suppress browser focus/selection side effects
 * - Collapse toggle: ChevronDown (expanded) / ChevronUp (collapsed)
 * - Double-click on header surface toggles collapse
 * - Drag: calls onDragStart on pointer-down on header surface
 *
 * ## Close button pointer-capture note (Step 7)
 *
 * The close button uses `setPointerCapture` on `pointerdown` to suppress
 * browser focus/selection side effects. When Step 7 wraps this button in
 * `TugConfirmPopover`, the pointer capture may conflict with Radix Popover's
 * focus management. Step 7 must verify that pointer capture is released before
 * the popover opens, or switch the close button to a standard click handler.
 *
 * @module components/tugways/card-header
 */

import React, { useCallback } from "react";
import { icons } from "lucide-react";
import "./tug-card.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Height of the card title bar in pixels. Must match --tug-base-chrome-height.
 * Used for collapsed-height calculation in CardFrame.
 */
export const CARD_TITLE_BAR_HEIGHT = 36;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Props for the CardHeader component.
 *
 * **Authoritative reference:** Step 3 Artifacts, CardHeader props interface.
 */
export interface CardHeaderProps {
  /** Display title for the card header. */
  title: string;
  /** Lucide icon name. Renders the icon via lucide-react lookup when provided. */
  icon?: string;
  /** Whether to show the close button. Default: true. */
  closable?: boolean;
  /** Whether the card is currently collapsed. */
  collapsed: boolean;
  /** Called when the collapse/expand button is clicked or header is double-clicked. */
  onCollapse: () => void;
  /** Called when the close button fires (pointer-up-inside or keyboard Enter/Space). */
  onClose?: () => void;
  /** Called on header pointer-down to initiate card drag. */
  onDragStart?: (event: React.PointerEvent) => void;
}

// ---------------------------------------------------------------------------
// CardHeader
// ---------------------------------------------------------------------------

/**
 * CardHeader -- title bar with collapse, close, and menu controls.
 *
 * Extracted from Tugcard (tugcard.tsx). Tugcard composes this component in
 * its render, passing effectiveMeta fields and callbacks.
 */
export function CardHeader({
  title,
  icon,
  closable = true,
  collapsed,
  onCollapse,
  onClose,
  onDragStart,
}: CardHeaderProps) {
  // ---------------------------------------------------------------------------
  // Header drag handler (forwarded from CardFrame via Tugcard)
  // ---------------------------------------------------------------------------

  const handleHeaderPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Do not initiate drag when clicking a control button.
      const target = event.target as HTMLElement;
      if (target.closest(".card-header-btn")) return;
      onDragStart?.(event);
    },
    [onDragStart],
  );

  // ---------------------------------------------------------------------------
  // Double-click to toggle collapse
  // ---------------------------------------------------------------------------

  const handleHeaderDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      // Ignore double-clicks on control buttons.
      if (target.closest(".card-header-btn")) return;
      onCollapse();
    },
    [onCollapse],
  );

  // ---------------------------------------------------------------------------
  // Close button -- pointer-capture pattern
  //
  // pointerdown: capture the pointer to suppress browser focus/selection side
  // effects (Mac-like close button behavior). stopPropagation prevents
  // bring-to-front; preventDefault prevents focus/selection shift.
  //
  // pointerup: hit-test against the button bounds; fire onClose only on
  // confirmed pointer-up-inside.
  //
  // click: keyboard fallback (Enter/Space).
  //
  // Note for Step 7: pointer capture may conflict with Radix Popover's focus
  // management. See module-level comment above.
  // ---------------------------------------------------------------------------

  const handleClosePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation(); // prevent bring-to-front
      event.preventDefault(); // prevent focus/selection shift
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const handleClosePointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (inside) {
        onClose?.();
      }
    },
    [onClose],
  );

  const handleCloseClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onClose?.();
    },
    [onClose],
  );

  // ---------------------------------------------------------------------------
  // Collapse button
  // ---------------------------------------------------------------------------

  const handleCollapsePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation(); // prevent drag start
    },
    [],
  );

  const handleCollapseClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onCollapse();
    },
    [onCollapse],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Resolve lucide icon component.
  const IconComponent =
    icon && icons[icon as keyof typeof icons]
      ? icons[icon as keyof typeof icons]
      : null;

  // Chevron: ChevronDown when expanded (collapsed=false), ChevronUp when collapsed.
  const ChevronIcon = collapsed
    ? icons["ChevronUp" as keyof typeof icons]
    : icons["ChevronDown" as keyof typeof icons];

  // Menu: horizontal ellipsis.
  const EllipsisIcon = icons["Ellipsis" as keyof typeof icons];

  return (
    <div
      className="tugcard-header"
      onPointerDown={handleHeaderPointerDown}
      onDoubleClick={handleHeaderDoubleClick}
      data-testid="tugcard-header"
    >
      {/* Icon — size controlled by .tugcard-icon CSS */}
      {IconComponent && (
        <span className="tugcard-icon" data-testid="tugcard-icon">
          {React.createElement(IconComponent)}
        </span>
      )}

      {/* Title */}
      <span className="tugcard-title" data-testid="tugcard-title">
        {title}
      </span>

      {/* Control buttons — icon size controlled by .card-header-btn svg CSS */}
      <div className="card-header-controls" data-testid="card-header-controls">
        {/* Menu button (leftmost) */}
        <button
          type="button"
          className="card-header-btn card-header-btn-menu"
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Card menu"
          data-testid="card-header-menu-btn"
        >
          {EllipsisIcon && React.createElement(EllipsisIcon)}
        </button>

        {/* Collapse/expand chevron (middle) */}
        <button
          type="button"
          className="card-header-btn card-header-btn-collapse"
          onPointerDown={handleCollapsePointerDown}
          onClick={handleCollapseClick}
          aria-label={collapsed ? "Expand card" : "Collapse card"}
          aria-expanded={!collapsed}
          data-testid="card-header-collapse-btn"
        >
          {ChevronIcon && React.createElement(ChevronIcon)}
        </button>

        {/* Close button (rightmost) */}
        {closable && (
          <button
            type="button"
            className="card-header-btn card-header-btn-close"
            data-no-activate
            onPointerDown={handleClosePointerDown}
            onPointerUp={handleClosePointerUp}
            onClick={handleCloseClick}
            aria-label="Close card"
            data-testid="tugcard-close-btn"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
