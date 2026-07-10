/**
 * tug-pinned-panel.tsx — a persistent, card-scoped floating panel.
 *
 * `TugPinnedPanel` is a third floating surface alongside the popover and the
 * modal (sheet/alert) families documented in {@link file://./internal/floating-surface-notes.ts}.
 * Its dismiss model is neither "chain-reactive" (popover) nor "modal"
 * (sheet/alert) — it is **pinned**: it stays open until the user explicitly
 * closes it with the header `×`. Nothing else dismisses it — not a click
 * outside, not Escape, not deactivating the card.
 *
 * ## Why it is NOT a popover (no portal)
 *
 * A `TugPopover` portals its content to the deck-level canvas overlay, which is
 * exactly why it must force-close when its owning card deactivates (portaled
 * content would otherwise float over a *different* card). `TugPinnedPanel`
 * instead renders **in place** — it is a plain `position: absolute` child of a
 * caller-provided positioned container inside the card. That makes it
 * card-scoped for free: it hides with its card when the card becomes a
 * background tab (`display: none`) and reappears intact on refront, and it is
 * never at risk of bleeding over a neighbouring pane. Rendering in-DOM also
 * lets us own positioning outright, which the drag gesture below needs.
 *
 * ## Positioning contract
 *
 * The panel owns the **horizontal** axis (`left`, set imperatively and
 * dragged); the caller owns the **vertical** axis and the width via
 * `className` (e.g. `bottom: calc(100% + …)` to sit just above the container).
 * The caller MUST render the panel inside a positioned ancestor (that ancestor
 * becomes the drag's horizontal bounds — its `clientWidth` is the travel).
 *
 * ## Drag
 *
 * Horizontal-only. The live gesture writes `style.left` directly to the DOM —
 * never React state — per [L06]; only the committed fraction round-trips
 * through tugbank on drag-end (see {@link ./tug-pinned-panel-pref}). The
 * bottom pointer rides with the panel, so after a drag it still meets the
 * container's top edge (a full-width status strip, in the `/btw` case).
 *
 * @module components/tugways/tug-pinned-panel
 */

import React from "react";
import { X } from "lucide-react";

import { TugButton } from "@/components/tugways/internal/tug-button";
import { cn } from "@/lib/utils";
import {
  clampOffsetFraction,
  usePinnedPanelOffset,
  writePinnedPanelOffset,
} from "./tug-pinned-panel-pref";

import "./tug-pinned-panel.css";

/** Inset (px) kept between the panel and either edge of its drag container. */
const DRAG_INSET = 8;

/** Default horizontal fraction when no position has been saved: right-aligned. */
const DEFAULT_FRACTION = 1;

export interface TugPinnedPanelProps {
  /** Whether the panel is shown. When false, nothing renders. */
  open: boolean;
  /** Invoked when the user clicks the header `×`. */
  onClose: () => void;
  /** Header content (title / glyph). The `×` close button is added by the panel. */
  header: React.ReactNode;
  /** Panel body. */
  children: React.ReactNode;
  /** Caller styling — owns the panel's width and vertical placement. */
  className?: string;
  /**
   * Tugbank key under which the horizontal drag position persists across
   * reloads. Omit for an ephemeral panel (position resets to the default each
   * time it opens).
   */
  persistKey?: string;
  /** Accessible label / tooltip for the close button. */
  closeLabel?: string;
  /** Accessible label for the panel region. */
  "aria-label"?: string;
}

/**
 * Apply a horizontal offset fraction to the panel by writing `style.left`
 * directly. Travel is the container's inner width minus the panel width and
 * both insets; a container narrower than the panel pins to the left inset.
 */
function applyOffsetFraction(panel: HTMLDivElement, fraction: number): void {
  const container = panel.offsetParent as HTMLElement | null;
  const containerWidth = container?.clientWidth ?? panel.parentElement?.clientWidth ?? 0;
  const travel = Math.max(0, containerWidth - panel.offsetWidth - DRAG_INSET * 2);
  const left = DRAG_INSET + clampOffsetFraction(fraction) * travel;
  panel.style.left = `${left}px`;
  panel.style.right = "auto";
}

/**
 * A pinned, horizontally-draggable floating panel. See the module docstring
 * for the dismiss model and positioning contract.
 */
export function TugPinnedPanel({
  open,
  onClose,
  header,
  children,
  className,
  persistKey,
  closeLabel = "Close",
  "aria-label": ariaLabel,
}: TugPinnedPanelProps): React.ReactElement | null {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const draggingRef = React.useRef(false);
  const dragStartXRef = React.useRef(0);
  const dragStartLeftRef = React.useRef(0);
  const travelRef = React.useRef(0);

  const persistedOffset = usePinnedPanelOffset(persistKey);
  const fraction = persistedOffset ?? DEFAULT_FRACTION;

  // Initial placement + reclamp on container resize. The live drag writes
  // `style.left` directly and must not be clobbered mid-gesture, so the effect
  // no-ops while a drag is in flight. Preserved inline `left` survives a
  // card-tab hide/refront (the node is never unmounted), so this only really
  // fires on open and on pane resize.
  React.useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const apply = () => {
      if (!draggingRef.current) applyOffsetFraction(panel, fraction);
    };
    apply();

    const container = panel.offsetParent as HTMLElement | null;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(apply);
    observer.observe(container);
    return () => observer.disconnect();
  }, [open, fraction]);

  function onHeaderPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    // A pointerdown on the close button must not begin a drag.
    if ((event.target as HTMLElement).closest("[data-pinned-panel-close]")) return;
    const panel = panelRef.current;
    if (!panel) return;

    event.preventDefault();
    const container = panel.offsetParent as HTMLElement | null;
    const containerWidth = container?.clientWidth ?? 0;
    travelRef.current = Math.max(0, containerWidth - panel.offsetWidth - DRAG_INSET * 2);
    dragStartXRef.current = event.clientX;
    const currentLeft = Number.parseFloat(panel.style.left);
    dragStartLeftRef.current = Number.isFinite(currentLeft) ? currentLeft : DRAG_INSET;
    draggingRef.current = true;
    panel.dataset.dragging = "true";
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onHeaderPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (!draggingRef.current) return;
    const panel = panelRef.current;
    if (!panel) return;
    const delta = event.clientX - dragStartXRef.current;
    const left = Math.max(
      DRAG_INSET,
      Math.min(DRAG_INSET + travelRef.current, dragStartLeftRef.current + delta),
    );
    // Live gesture is DOM-only ([L06]).
    panel.style.left = `${left}px`;
  }

  function onHeaderPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const panel = panelRef.current;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!panel) return;
    delete panel.dataset.dragging;
    if (persistKey) {
      const left = Number.parseFloat(panel.style.left);
      const travel = travelRef.current;
      const committed = travel > 0 && Number.isFinite(left)
        ? (left - DRAG_INSET) / travel
        : DEFAULT_FRACTION;
      writePinnedPanelOffset(persistKey, committed);
    }
  }

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className={cn("tug-pinned-panel", className)}
      data-slot="tug-pinned-panel"
      // The panel is chrome; clicking it (drag, close, inner affordances) must
      // not pull first-responder focus off the card's editor.
      data-tug-focus="refuse"
      role="region"
      aria-label={ariaLabel}
    >
      <div
        className="tug-pinned-panel-header"
        data-slot="tug-pinned-panel-header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
        <div className="tug-pinned-panel-header-content">{header}</div>
        {/* Identical treatment to the pane title-bar close ([use-Tug-components]):
            the shared ghost/icon TugButton, not a hand-rolled button. */}
        <TugButton
          subtype="icon"
          emphasis="ghost"
          role="action"
          size="sm"
          icon={<X />}
          data-pinned-panel-close=""
          data-tug-focus="refuse"
          tabIndex={-1}
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
        />
      </div>

      <div className="tug-pinned-panel-body" data-slot="tug-pinned-panel-body">
        {children}
      </div>

      <span className="tug-pinned-panel-pointer" aria-hidden />
    </div>
  );
}
