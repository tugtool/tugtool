/**
 * transcript-tier.tsx — the two-tier transcript cell ([P01b]).
 *
 * Every transcript row is always mounted, but its expensive rendering
 * (markdown, syntax highlighting, tool blocks, responder/menu/sheet
 * hooks) is NOT. A row renders a CHEAP `TranscriptPreviewCell` — one
 * block of plain-text preview — until it enters the visible window (plus
 * a prefetch margin), at which point it upgrades to the RICH cell. The
 * heavy cell component is only mounted while rich, so mounting the whole
 * transcript costs N cheap text blocks, not N rich subtrees.
 *
 * Why: a fast wheel or a thumb-drag lands the viewport on rows whose
 * rich content has not painted yet (windowed-unmount) or whose paint the
 * browser has deferred (`content-visibility`). The cheap tier is always
 * painted and paints in well under a frame, so the user sees readable
 * text instead of bare background — never a blank.
 *
 * Mechanism: a single shared `IntersectionObserver` per scrollport (the
 * `.tug-list-view` published via `useOuterScrollport`) drives the
 * rich/cheap decision per cell with a generous `rootMargin` so rows
 * upgrade before they scroll into view. The rich height is measured and
 * held so the cheap fallback reserves it — the swap never collapses the
 * row or shifts siblings.
 *
 * Laws:
 *  - [L06] the rich/cheap signal is local cell state driving WHICH
 *    subtree renders; height reservation is a DOM style write, not
 *    React state.
 *  - [L22] the IntersectionObserver observes the DOM directly.
 *  - [L26] the wrapper element identity is stable across the cheap↔rich
 *    swap (same `<div>`, same observer target), so the observer keeps
 *    tracking and React reconciles the child in place.
 *
 * @module components/tugways/cards/transcript-tier
 */

import "./transcript-tier.css";

import React from "react";

import { useOuterScrollport } from "@/components/tugways/internal/outer-scrollport-context";

/**
 * Prefetch margin (CSS px) above and below the scrollport within which
 * rows upgrade to rich. Generous so a normal scroll always has rich
 * content ready before a row reaches the viewport; the cheap tier only
 * shows when a fast fling momentarily outruns this band.
 */
const RICH_WINDOW_MARGIN = "1500px 0px 1500px 0px";

// ---------------------------------------------------------------------------
// Shared per-scrollport IntersectionObserver
// ---------------------------------------------------------------------------

type IntersectListener = (isIntersecting: boolean) => void;

/**
 * One `IntersectionObserver` shared by every tiered cell under a given
 * scrollport. A per-cell observer would mean thousands of observers on a
 * large transcript; one observer with many targets is the cheap shape.
 */
class SharedRichWindowObserver {
  private readonly listeners = new Map<Element, IntersectListener>();
  private readonly io: IntersectionObserver;

  constructor(root: Element) {
    this.io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          this.listeners.get(entry.target)?.(entry.isIntersecting);
        }
      },
      { root, rootMargin: RICH_WINDOW_MARGIN },
    );
  }

  register(el: Element, listener: IntersectListener): void {
    this.listeners.set(el, listener);
    this.io.observe(el);
  }

  unregister(el: Element): void {
    this.listeners.delete(el);
    this.io.unobserve(el);
  }
}

const OBSERVERS = new WeakMap<Element, SharedRichWindowObserver>();

function sharedObserverFor(root: Element): SharedRichWindowObserver {
  let existing = OBSERVERS.get(root);
  if (existing === undefined) {
    existing = new SharedRichWindowObserver(root);
    OBSERVERS.set(root, existing);
  }
  return existing;
}

/**
 * Returns `true` while `ref`'s element is within the rich window (the
 * scrollport plus {@link RICH_WINDOW_MARGIN}). Starts `false` (cheap) so
 * a freshly-mounted transcript does not mount every rich cell at once;
 * the observer promotes the visible band on its first callback.
 */
function useInRichWindow(
  ref: React.RefObject<HTMLElement | null>,
): boolean {
  const scrollport = useOuterScrollport();
  const [inWindow, setInWindow] = React.useState(false);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || scrollport === null) return;
    const observer = sharedObserverFor(scrollport);
    observer.register(el, setInWindow);
    return () => observer.unregister(el);
  }, [ref, scrollport]);

  return inWindow;
}

// ---------------------------------------------------------------------------
// Cheap preview cell
// ---------------------------------------------------------------------------

export interface TranscriptPreviewCellProps {
  /** Bounded plain-text preview from `previewTextForMessages`. */
  text: string;
  /**
   * Last-known rich height (CSS px) to reserve so the cheap↔rich swap
   * never collapses the row. `undefined` for a row that has not yet
   * been rich — it takes its natural cheap height until first upgrade.
   */
  reservedHeight: number | undefined;
}

/**
 * The cheap tier: one muted text block. No markdown, no highlighting, no
 * interactivity — just readable orientation text that paints instantly.
 */
const TranscriptPreviewCell: React.FC<TranscriptPreviewCellProps> = ({
  text,
  reservedHeight,
}) => (
  <div
    className="dev-transcript-preview"
    data-slot="transcript-preview"
    style={
      reservedHeight !== undefined
        ? { minHeight: `${reservedHeight}px` }
        : undefined
    }
  >
    {text}
  </div>
);

// ---------------------------------------------------------------------------
// Tiered cell wrapper
// ---------------------------------------------------------------------------

export interface TieredCellProps {
  /** Cheap preview text shown until the row enters the rich window. */
  previewText: string;
  /**
   * Force the rich tier regardless of viewport position. Used for the
   * in-flight row, which hosts the live streaming content plus any
   * pending permission / question dialog — it must never downgrade to
   * cheap and tear those down.
   */
  forceRich?: boolean;
  /** Renders the heavy cell. Called only while the row is rich. */
  children: () => React.ReactNode;
}

/**
 * Wraps a transcript row in the rich/cheap tiering. The wrapper `<div>`
 * is the stable IntersectionObserver target and never unmounts across
 * the swap ([L26]); only its child flips between the cheap preview and
 * the heavy cell.
 */
export const TieredCell: React.FC<TieredCellProps> = ({
  previewText,
  forceRich = false,
  children,
}) => {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const observed = useInRichWindow(ref);
  const rich = forceRich || observed;

  // Hold the last measured rich height so a downgrade to cheap reserves
  // it ([L06] — a DOM measurement into a ref, not React state). Updated
  // every commit the row is rich, so it tracks streaming growth.
  const reservedHeightRef = React.useRef<number | undefined>(undefined);
  React.useLayoutEffect(() => {
    if (rich && ref.current !== null) {
      const h = ref.current.offsetHeight;
      if (h > 0) reservedHeightRef.current = h;
    }
  });

  return (
    <div ref={ref} className="dev-transcript-tier" data-tier={rich ? "rich" : "cheap"}>
      {rich ? (
        children()
      ) : (
        <TranscriptPreviewCell
          text={previewText}
          reservedHeight={reservedHeightRef.current}
        />
      )}
    </div>
  );
};
