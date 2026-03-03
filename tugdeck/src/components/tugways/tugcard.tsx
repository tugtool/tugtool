/**
 * Tugcard -- composition component for card chrome and responder integration.
 *
 * **Authoritative references:**
 * - design-system-concepts.md Concept 6, [D01] Tugcard composition,
 *   [D03] CardFrame/Tugcard separation, [D05] Dynamic min-size,
 *   [D07] Tugcard responder node
 * - Spec S01 TugcardProps, Spec S07 Tugcard internal layout
 *
 * ## Visual Stack (Spec S07)
 *
 * ```
 * CardFrame (absolute positioning, drag handles, resize handles)
 *   └─ Tugcard (flex column)
 *        ├─ CardHeader (28px, title + icon + close button)
 *        ├─ Accessory slot (0px when null)
 *        └─ Content area (flex-grow, overflow auto)
 *             └─ children (card-specific content)
 * ```
 *
 * ## Responsibilities
 *
 * - Render header chrome (title, optional icon, close button)
 * - Register as a responder node with `close`, `minimize`, `toggleMenu`, `find`
 * - Wrap children in `<ResponderScope>` for child responder registration
 * - Wrap children in `<TugcardDataProvider>` (feed subscription wired in Phase 6)
 * - Compute total min-size and report via `onMinSizeChange`
 * - Gate child mounting by feed arrival (feedless cards mount immediately)
 * - Call `onDragStart` from the header on pointer-down
 *
 * @module components/tugways/tugcard
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FeedIdValue } from "../../protocol";
import { useResponder } from "./use-responder";
import { TugcardDataProvider } from "./hooks/use-tugcard-data";
import { useSelectionBoundary } from "./hooks/use-selection-boundary";
import "./tugcard.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Card metadata controlling default appearance and behavior.
 *
 * **Authoritative reference:** Spec S01 TugcardMeta.
 */
export interface TugcardMeta {
  title: string;
  /** Lucide icon name (reserved for Phase 5+; rendered as text placeholder for now). */
  icon?: string;
  /** Whether the card can be closed. Default: true. */
  closable?: boolean;
}

/**
 * Props for the Tugcard composition component.
 *
 * **Authoritative reference:** Spec S01 TugcardProps.
 */
export interface TugcardProps {
  /** Unique card instance ID. Passed to the responder chain. */
  cardId: string;
  /** Title, optional icon, and closable flag. */
  meta: TugcardMeta;
  /** Feed IDs to subscribe to. Empty array = feedless card (children mount immediately). */
  feedIds: readonly FeedIdValue[];
  /** Custom decode function per feed. Default: JSON parse. Wired in Phase 6. */
  decode?: (feedId: FeedIdValue, bytes: Uint8Array) => unknown;
  /**
   * Minimum content area size.
   * Total min-size = 28 (header) + accessory height + minContentSize.
   * Default: `{ width: 100, height: 60 }`.
   */
  minContentSize?: { width: number; height: number };
  /** Top accessory slot. Collapses to 0 when null or undefined. */
  accessory?: React.ReactNode | null;
  /** Called by Tugcard when its computed min-size changes. Forwarded from CardFrame. */
  onMinSizeChange?: (size: { width: number; height: number }) => void;
  /** Called by Tugcard header on pointer-down to initiate drag. Forwarded from CardFrame. */
  onDragStart?: (event: React.PointerEvent) => void;
  /** Called when the close action fires. Forwarded from CardFrame via registry factory. */
  onClose?: () => void;
  /** Card-specific content components. */
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEADER_HEIGHT_PX = 28;
const DEFAULT_MIN_CONTENT: { width: number; height: number } = { width: 100, height: 60 };

// ---------------------------------------------------------------------------
// Tugcard
// ---------------------------------------------------------------------------

/**
 * Tugcard composition component.
 *
 * Card authors compose card-specific content as children:
 * ```tsx
 * <Tugcard cardId="abc" meta={{ title: "Hello" }} feedIds={[]}>
 *   <HelloContent />
 * </Tugcard>
 * ```
 */
export function Tugcard({
  cardId,
  meta,
  feedIds,
  minContentSize = DEFAULT_MIN_CONTENT,
  accessory = null,
  onMinSizeChange,
  onDragStart,
  onClose,
  children,
}: TugcardProps) {
  // ---------------------------------------------------------------------------
  // Content area ref (Phase 5a: selection boundary + selectAll action)
  // ---------------------------------------------------------------------------

  // Ref to the content area div. Used by:
  //   - useSelectionBoundary: registers this element with SelectionGuard so
  //     selection is contained within card boundaries ([D02], [D03])
  //   - selectAll action: calls selectAllChildren on this element ([D06])
  const contentRef = useRef<HTMLDivElement>(null);

  // Register the content area as a selection boundary with SelectionGuard.
  // Unregisters automatically on unmount via the hook's cleanup. ([D02], Spec S02)
  useSelectionBoundary(cardId, contentRef);

  // ---------------------------------------------------------------------------
  // Responder registration (D07)
  // ---------------------------------------------------------------------------

  // Stable action callbacks — defined at top level to follow Rules of Hooks.
  const handleClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  // selectAll: scope Cmd+A to this card's content area. ([D06], Spec S01)
  // contentRef is a stable React ref object — reading .current inside the
  // callback always gives the current element without needing it in deps.
  const handleSelectAll = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    window.getSelection()?.selectAllChildren(el);
  }, []);

  const { ResponderScope } = useResponder({
    id: cardId,
    actions: {
      close: handleClose,
      selectAll: handleSelectAll,
      // Phase 5 stubs: minimize, toggleMenu, find are no-ops until later phases
      minimize: () => {},
      toggleMenu: () => {},
      find: () => {},
    },
  });

  // ---------------------------------------------------------------------------
  // Accessory height measurement (D05)
  // ---------------------------------------------------------------------------

  // Ref to the accessory container div for layout measurement.
  const accessoryRef = useRef<HTMLDivElement>(null);

  // Track accessory height as state so min-size reports update when it changes.
  const [accessoryHeight, setAccessoryHeight] = useState(0);

  // Measure accessory height after layout and whenever accessory content changes.
  // ResizeObserver watches for dynamic changes. In tests ResizeObserver is a no-op stub,
  // so the initial measurement from useLayoutEffect is the only measurement.
  useLayoutEffect(() => {
    const el = accessoryRef.current;
    if (!el) {
      setAccessoryHeight(0);
      return;
    }

    // Initial measurement from the layout tree.
    setAccessoryHeight(el.getBoundingClientRect().height);

    // Watch for subsequent size changes (accessory content appearing/disappearing).
    const ro = new ResizeObserver(() => {
      setAccessoryHeight(el.getBoundingClientRect().height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [accessory]); // Re-run when accessory prop changes.

  // ---------------------------------------------------------------------------
  // Min-size reporting (D05)
  // ---------------------------------------------------------------------------

  // Compute total min-size from header + accessory + content minimums.
  const totalMinWidth = minContentSize.width;
  const totalMinHeight = HEADER_HEIGHT_PX + accessoryHeight + minContentSize.height;

  // Report min-size to CardFrame whenever computed values change.
  useEffect(() => {
    onMinSizeChange?.({ width: totalMinWidth, height: totalMinHeight });
  }, [onMinSizeChange, totalMinWidth, totalMinHeight]);

  // ---------------------------------------------------------------------------
  // Feed state (Phase 6 stub)
  // ---------------------------------------------------------------------------

  // In Phase 5 all cards are effectively feedless at the data layer.
  // For cards with feedIds declared, show "Loading..." until Phase 6 wires subscriptions.
  // For feedless cards (feedIds.length === 0), mount children immediately.
  const feedsReady = feedIds.length === 0;

  // Empty feed data map for TugcardDataProvider (populated in Phase 6).
  const emptyFeedData = useRef(new Map<number, unknown>());

  // ---------------------------------------------------------------------------
  // Header drag handler
  // ---------------------------------------------------------------------------

  const handleHeaderPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      onDragStart?.(event);
    },
    [onDragStart],
  );

  // ---------------------------------------------------------------------------
  // Close button
  // ---------------------------------------------------------------------------

  const handleCloseClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      // Stop propagation so the close click does not trigger drag via the header.
      event.stopPropagation();
      onClose?.();
    },
    [onClose],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const closable = meta.closable !== false; // default true

  return (
    <div className="tugcard" data-card-id={cardId}>
      {/* CardHeader: 28px, title + icon + close button */}
      <div
        className="tugcard-header"
        onPointerDown={handleHeaderPointerDown}
        data-testid="tugcard-header"
      >
        <span className="tugcard-title" data-testid="tugcard-title">
          {meta.title}
        </span>
        {closable && (
          <button
            type="button"
            className="tugcard-close-btn"
            onClick={handleCloseClick}
            aria-label="Close card"
            data-testid="tugcard-close-btn"
          >
            ×
          </button>
        )}
      </div>

      {/* Accessory slot: collapses to 0 when null */}
      <div
        ref={accessoryRef}
        className="tugcard-accessory"
        data-testid="tugcard-accessory"
        style={accessory == null ? { height: 0, overflow: "hidden" } : undefined}
      >
        {accessory}
      </div>

      {/* Content area: flex-grow, overflow auto */}
      <div ref={contentRef} className="tugcard-content" data-testid="tugcard-content">
        <TugcardDataProvider feedData={emptyFeedData.current}>
          <ResponderScope>
            {feedsReady ? children : (
              <div className="tugcard-loading" data-testid="tugcard-loading">
                Loading...
              </div>
            )}
          </ResponderScope>
        </TugcardDataProvider>
      </div>
    </div>
  );
}
