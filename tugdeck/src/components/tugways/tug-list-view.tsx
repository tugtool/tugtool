/**
 * TugListView — windowed list primitive modeled on UIKit's `UITableView`.
 *
 * A framework-level primitive for any surface in tugdeck that renders a
 * list of items: the Tide multi-turn transcript (the first consumer), the
 * session picker (deferred migration), an eventual history panel, a
 * permission/audit log, and so on. The shape borrows directly from
 * UIKit's table-view decomposition — a *data source* enumerates items
 * and their kinds; a *delegate* opinionates on heights, lifecycle, and
 * selection; an imperative handle exposes scroll-into-view; cell
 * renderers are registered per kind so the same data source can mix
 * heterogeneous row shapes through one call site.
 *
 * **Step 2 boundary — types only.** This commit ships the public API
 * surface as TypeScript types plus a no-op stub component. The full
 * implementation (windowing, height index, cell reuse, lifecycle,
 * SmartScroll integration) lands in subsequent steps. Consumers can
 * write data sources and cell renderers against the contract today.
 *
 * Laws:
 * - [L02] external state enters React via `useSyncExternalStore` — the
 *   list view subscribes to the data source through that contract.
 * - [L03] registrations events depend on (SmartScroll, ResizeObserver)
 *   land in `useLayoutEffect`.
 * - [L06] appearance changes via CSS / DOM — spacer heights and scroll
 *   position writes go directly to the DOM, not through React state.
 * - [L11] the list view holds no chain handlers in v1; no scroll-action
 *   vocabulary exists yet for it to register against. Cell renderers
 *   may be controls or responders depending on their content.
 * - [L19] component authoring guide — file pair, module docstring,
 *   exported props interface, `data-slot="tug-list-view"`.
 * - [L20] component-token sovereignty — `--tugx-list-view-*` only;
 *   consumers customize via cascade-scoped overrides.
 * - [L22] store observers may write DOM directly. Streaming-bound cells
 *   observe their stream sources from inside their renderers; the
 *   list view does not push deltas through its own subscribe path.
 * - [L23] scroll position survives DOM-down transitions via the
 *   consumer-supplied `scrollKey` written to `data-tug-scroll-key`.
 * Decisions:
 * - [D01] UITableView lineage; [D02] single-section flat list in v1;
 *   [D03] imperative handle with `scrollToIndex` + `getElementForIndex`;
 *   [D04] cell reuse is a conceptual API — v1 implementation is React
 *   item-keyed mount/unmount; [D07] SmartScroll owns scroll-position
 *   writes; [D08] no chain-driven scroll commands in v1.
 */

import "./tug-list-view.css";

import React from "react";

import {
  computeWindow,
  offsetForIndex,
} from "./internal/list-view-window";

// ---------------------------------------------------------------------------
// Data source — what consumers implement
// ---------------------------------------------------------------------------

/**
 * The contract a `TugListView` consumer fulfills to enumerate items and
 * notify the list view of changes. Modeled on `UITableViewDataSource`
 * with two adaptations for the web: index-keyed rather than
 * `IndexPath`-keyed (single-section v1, [D02]), and a `getVersion`
 * shape for `useSyncExternalStore` consumption ([L02]).
 *
 * @see [TugListViewDelegate] for optional behavioral hooks.
 */
export interface TugListViewDataSource {
  /**
   * Total item count. The list view re-windows whenever this value
   * changes (a tick from `subscribe` is the trigger).
   */
  numberOfItems(): number;

  /**
   * Stable identity for the item at `index`. Used as the React key for
   * the cell wrapper.
   *
   * **Contract — item-stable, not slot-stable.** When the data source
   * mutates (insert, remove, reorder), the same logical item retains
   * the same id at its new index. React's reconciler uses this to match
   * cells across data-source updates so a cell at position 5 that
   * becomes position 7 (because two items were inserted before it)
   * keeps its component instance and its DOM. Returning slot-positional
   * ids (`"row-0"`, `"row-1"`) defeats reconciliation and is incorrect.
   */
  idForIndex(index: number): string;

  /**
   * Cell-renderer kind for the item at `index`. Drives renderer
   * dispatch (and, in a future imperative-pool implementation, reuse-
   * pool routing). The same item may change kind across updates (e.g.
   * `"code-streaming"` → `"code-committed"` on `turn_complete`); React
   * reconciler sees this as a prop change if the id is stable, or as a
   * remount if the id also changes.
   */
  kindForIndex(index: number): string;

  /**
   * Subscribe to data-source changes. Listener fires on every change
   * that should re-window. Returns an unsubscribe callback.
   */
  subscribe(listener: () => void): () => void;

  /**
   * Stable version token. The list view's `useSyncExternalStore` uses
   * this to detect updates.
   *
   * **Contract — `Object.is` equality.** React's `useSyncExternalStore`
   * compares snapshots with `Object.is`. Returning `===`-identical
   * values means "no update"; any change in identity means "re-render."
   * Acceptable shapes:
   *  - a monotonically incrementing version number,
   *  - an object reference that the data source replaces on each change
   *    (e.g. the underlying store's snapshot reference),
   *  - a string token whose identity is stable.
   *
   * NOT acceptable: a string concatenation re-built on each call —
   * `Object.is` is reference-based, so two equal-content strings minted
   * fresh per call compare unequal and force re-renders every tick.
   */
  getVersion(): unknown;
}

// ---------------------------------------------------------------------------
// Delegate — what consumers optionally implement
// ---------------------------------------------------------------------------

/**
 * Optional behavioral hooks a consumer may implement on top of the data
 * source. All members are optional; omitted methods fall back to
 * sensible defaults built into the list view. Modeled on
 * `UITableViewDelegate`.
 */
export interface TugListViewDelegate {
  /**
   * Estimated height (in CSS pixels) for unmeasured cells of this
   * kind. Used by the height index to compute spacer geometry before a
   * cell has been measured by `ResizeObserver`. Default: 60.
   */
  estimatedHeightForKind?(kind: string): number;

  /**
   * Fires when a cell becomes part of the rendered window. Useful for
   * attaching cell-scoped resources (a streaming subscription, a fetch,
   * a focus seed) on first display.
   */
  willDisplay?(index: number): void;

  /**
   * Fires when a cell leaves the rendered window. Useful for tearing
   * down the resources `willDisplay` attached.
   */
  didEndDisplaying?(index: number): void;

  /**
   * Fires when the user activates a cell (click). Selection ownership
   * lives with the consumer; the list view stores no selected-index
   * state of its own.
   */
  onSelect?(index: number): void;
}

// ---------------------------------------------------------------------------
// Cell renderer — what consumers register per kind
// ---------------------------------------------------------------------------

/**
 * Props passed to a cell renderer. The `dataSource` is the active data
 * source (typed by `DS` if the consumer narrows); renderers query it
 * for the content they need rather than receiving it as a prop. This
 * mirrors UIKit's `cellForRowAtIndexPath` shape, where the cell is
 * given the index path and queries the data source for the row.
 *
 * The generic `DS` defaults to the base `TugListViewDataSource`. A
 * consumer with a typed adapter (e.g. `TideTranscriptDataSource`)
 * narrows `DS` so its cell renderers can call adapter-specific methods
 * such as `rowAt(index)` without casting.
 */
export interface TugListViewCellProps<
  DS extends TugListViewDataSource = TugListViewDataSource,
> {
  index: number;
  id: string;
  kind: string;
  /** The active data source. Cell renderers query it for content. */
  dataSource: DS;
}

/**
 * The component shape a consumer registers under a kind in
 * `TugListViewProps.cellRenderers`. A `React.ComponentType` (rather
 * than a render function) so cell internals can use hooks naturally —
 * a streaming cell can call `useLayoutEffect` to attach a store
 * observer per [L22].
 */
export type TugListViewCellRenderer<
  DS extends TugListViewDataSource = TugListViewDataSource,
> = React.ComponentType<TugListViewCellProps<DS>>;

// ---------------------------------------------------------------------------
// Imperative handle — exposed via forwardRef
// ---------------------------------------------------------------------------

/**
 * Imperative API the list view exposes to its parent via `forwardRef`.
 * v1 surface is deliberately small ([D03]): scroll-into-view and
 * direct DOM access for the rendered window. Animations, batched
 * inserts/removes, and selection-state mutators are deferred follow-
 * ons.
 */
export interface TugListViewHandle {
  /**
   * Scroll the row at `index` into view.
   *
   * Implementation contract (lands in Step 6, gated by [D03]):
   * - If the row is already mounted, delegates to
   *   `SmartScroll.scrollToElement`.
   * - If not, computes the target offset from the height index and
   *   uses `SmartScroll.scrollTo({ top: estimatedOffset })` to jump
   *   first; the row mounts on the next windowing pass; on the next
   *   `ResizeObserver` flush, the offset is recomputed against the
   *   measured height and corrected if it has drifted by more than a
   *   small threshold (~4px).
   *
   * Out-of-range indices clamp to first / last rather than throwing,
   * matching `UITableView`'s tolerance for stale index paths during
   * update transitions. `NaN` is a no-op.
   */
  scrollToIndex(
    index: number,
    options?: {
      block?: ScrollLogicalPosition;
      animated?: boolean;
    },
  ): void;

  /**
   * The DOM element for the rendered row at `index`, or `null` if the
   * row is not currently in the rendered window. Consumers that need
   * to address an unrendered row should call `scrollToIndex` first to
   * bring it into view.
   */
  getElementForIndex(index: number): HTMLElement | null;
}

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

/**
 * Props for the `TugListView` component. Generic over the data-source
 * type so consumers with typed adapters get matched cell-renderer
 * props without manual casts.
 */
export interface TugListViewProps<
  DS extends TugListViewDataSource = TugListViewDataSource,
> {
  /** The data source that drives the list. */
  dataSource: DS;

  /** Optional behavioral hooks. */
  delegate?: TugListViewDelegate;

  /**
   * Map of kind → cell renderer component. The list view dispatches
   * each rendered index through `cellRenderers[dataSource.kindForIndex(index)]`.
   * A kind returned by `kindForIndex` that has no entry here is a
   * runtime error in v1 — the cell renders nothing and a console
   * warning fires.
   */
  cellRenderers: Record<string, TugListViewCellRenderer<DS>>;

  /**
   * Scroll-region key for the [A9] state-preservation protocol
   * ([L23]). Written to `data-tug-scroll-key` on the scroll container
   * so cold-boot / cross-pane move restores scroll position into
   * `bag.regionScroll[scrollKey]`.
   *
   * Must be unique within the enclosing card subtree; cards mounting
   * two `TugListView` instances pass distinct keys (e.g.
   * `"tide-card-transcript"` vs `"tide-card-history"`).
   *
   * @default "tug-list-view"
   */
  scrollKey?: string;

  /**
   * Forwarded class name for cascade-scoped customization. Consumers
   * tune list-view tokens for their instance via a wrapping selector,
   * not by reaching into the primitive's CSS ([L20]).
   *
   * @example
   * <div className="tide-card-transcript">
   *   <TugListView ... className="tide-card-transcript-list" />
   * </div>
   */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// The inner type a generic `forwardRef` collapses into — exported so
// consumers that want a typed ref can write
// `useRef<TugListViewHandle>()` without re-declaring the component
// shape.
type TugListViewComponent = <DS extends TugListViewDataSource>(
  props: TugListViewProps<DS> & { ref?: React.Ref<TugListViewHandle> },
) => React.ReactElement | null;

/**
 * Default per-kind estimated height used when the consumer's delegate
 * omits `estimatedHeightForKind`. Matches the JSDoc on
 * `TugListViewDelegate.estimatedHeightForKind`.
 */
const DEFAULT_ESTIMATED_HEIGHT = 60;

/**
 * Number of cells rendered above and below the visible viewport.
 * Trades DOM weight for scroll smoothness — three cells of overscan
 * is enough to absorb a frame of fast scrolling at typical row
 * heights without keeping a giant subtree in memory.
 *
 * Step 4 may surface this as a delegate option; for v1 it's a
 * primitive-internal constant.
 */
const OVERSCAN_COUNT = 3;

/**
 * Step 3 implementation — fixed-height single-kind windowing.
 *
 * The list view subscribes to the data source via
 * `useSyncExternalStore` ([L02]). Scroll-position changes drive
 * rerenders through a tick reducer (Step 4 will swap to RAF
 * coalescing once `ResizeObserver` lands). Heights come from
 * `delegate.estimatedHeightForKind` — measured heights via
 * `ResizeObserver` arrive in Step 4. SmartScroll integration arrives
 * in Step 6.
 *
 * What's stable today:
 * - DOM shape per the plan's [#dom-shape]: scroll container,
 *   top spacer, window div with one wrapper per rendered cell, bottom
 *   spacer.
 * - Cell wrapper carries `data-tug-list-cell-index` and
 *   `data-tug-list-cell-kind` for test addressability and (later)
 *   reuse-pool routing.
 * - Spacer heights write directly to the DOM via `style.height`
 *   ([L06], mirroring `TugMarkdownView`).
 * - Imperative handle: `scrollToIndex` writes `scrollTop` directly;
 *   out-of-range indices clamp to first/last; NaN is a no-op.
 *   `getElementForIndex` reads from a ref map populated by cell
 *   wrapper refs.
 */
const TugListViewInner = React.forwardRef<TugListViewHandle, TugListViewProps>(
  function TugListView(
    { dataSource, delegate, cellRenderers, scrollKey, className },
    ref,
  ) {
    const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
    const topSpacerRef = React.useRef<HTMLDivElement | null>(null);
    const bottomSpacerRef = React.useRef<HTMLDivElement | null>(null);

    // Map<index, HTMLElement> populated by cell-wrapper ref callbacks.
    // Used by `getElementForIndex` for direct DOM addressing without a
    // querySelector roundtrip. Cleaned up by the ref callback when a
    // cell unmounts.
    const cellElementMapRef = React.useRef<Map<number, HTMLDivElement>>(
      new Map(),
    );

    // Subscribe to the data source. The returned `version` token is a
    // by-product — we don't use it directly. The hook's job is to
    // re-run this component whenever the data source ticks per its
    // `getVersion` contract ([L02], [#public-api]).
    //
    // Wrap each call so consumers can write `subscribe` / `getVersion`
    // as regular methods (with `this` bindings) rather than arrow
    // class-fields. `useSyncExternalStore` passes the callables around
    // detached from any instance, which would break regular methods
    // without these wrappers.
    const subscribeWrapper = React.useCallback(
      (listener: () => void) => dataSource.subscribe(listener),
      [dataSource],
    );
    const versionWrapper = React.useCallback(
      () => dataSource.getVersion(),
      [dataSource],
    );
    React.useSyncExternalStore(subscribeWrapper, versionWrapper, versionWrapper);

    // Force-rerender tick used by the scroll listener so windowing
    // recomputes when the user scrolls. Step 4 swaps the listener for
    // an rAF-coalesced one; for Step 3 the every-event cadence is
    // tolerable because windowing is the only React-driven work.
    const [, scrollTick] = React.useReducer((x: number) => x + 1, 0);

    // Read scroll geometry from the live DOM at render time. On the
    // first render `scrollContainerRef.current` is null (the ref
    // attaches in the same commit), producing a degenerate window
    // until the post-mount tick. The mount-tick effect below pokes
    // `scrollTick` so the second render sees a real viewport height.
    const scrollEl = scrollContainerRef.current;
    const scrollTop = scrollEl?.scrollTop ?? 0;
    const viewportHeight = scrollEl?.clientHeight ?? 0;

    // Resolve the per-index height closure. Step 3 uses the kind-keyed
    // estimate verbatim; Step 4 will compose it with the height-index
    // measured-height accessor.
    const itemCount = dataSource.numberOfItems();
    const estimatedHeightForKind = delegate?.estimatedHeightForKind;
    const estimatedHeightForIndex = React.useCallback(
      (index: number): number => {
        const kind = dataSource.kindForIndex(index);
        return estimatedHeightForKind?.(kind) ?? DEFAULT_ESTIMATED_HEIGHT;
      },
      [dataSource, estimatedHeightForKind],
    );

    const window = computeWindow({
      itemCount,
      scrollTop,
      viewportHeight,
      overscanCount: OVERSCAN_COUNT,
      estimatedHeightForIndex,
    });

    // Mount-tick: after the first commit attaches the scroll-container
    // ref, force a rerender so the window math reads a real
    // `clientHeight`. Without this, `viewportHeight` stays 0 until
    // some other event (scroll, data source tick) triggers a render.
    React.useLayoutEffect(() => {
      // Trigger one rerender after first mount. Subsequent mounts of
      // a stable component instance don't re-run this effect, so it
      // doesn't loop.
      scrollTick();
    }, []);

    // Install the scroll listener. Triggers a re-window on every
    // scroll event ([L03] — `useLayoutEffect` so the listener is in
    // place before the next paint). Step 4 may layer rAF coalescing
    // on top.
    React.useLayoutEffect(() => {
      const el = scrollContainerRef.current;
      if (el === null) return;
      const onScroll = () => scrollTick();
      el.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        el.removeEventListener("scroll", onScroll);
      };
    }, []);

    // Apply spacer heights directly to the DOM ([L06]). Mirrors the
    // pattern in `TugMarkdownView`'s `applySpacers`. Runs in
    // `useLayoutEffect` so the geometry is in place before the
    // browser paints the freshly-rendered cells.
    React.useLayoutEffect(() => {
      if (topSpacerRef.current !== null) {
        topSpacerRef.current.style.height = `${window.topSpacerHeight}px`;
      }
      if (bottomSpacerRef.current !== null) {
        bottomSpacerRef.current.style.height = `${window.bottomSpacerHeight}px`;
      }
    }, [window.topSpacerHeight, window.bottomSpacerHeight]);

    // Imperative handle. `scrollToIndex` writes `scrollTop` directly
    // for Step 3 (SmartScroll integration arrives in Step 6).
    React.useImperativeHandle(
      ref,
      () => ({
        scrollToIndex(index: number): void {
          if (Number.isNaN(index)) return;
          const total = dataSource.numberOfItems();
          if (total === 0) return;
          const clamped = Math.max(0, Math.min(total - 1, Math.floor(index)));
          const targetTop = offsetForIndex(
            clamped,
            total,
            estimatedHeightForIndex,
          );
          if (scrollContainerRef.current !== null) {
            scrollContainerRef.current.scrollTop = targetTop;
          }
        },
        getElementForIndex(index: number): HTMLElement | null {
          return cellElementMapRef.current.get(index) ?? null;
        },
      }),
      [dataSource, estimatedHeightForIndex],
    );

    // Render the windowed slice. Cells are keyed by
    // `dataSource.idForIndex(i)` per the [D04] item-stable contract so
    // React reconciler matches identity across data-source updates.
    const renderedRange: Array<{
      index: number;
      id: string;
      kind: string;
    }> = [];
    // Defensive against a data-source shrink mid-render: if itemCount
    // dropped below the previously-computed window, skip indices that
    // are out of range now.
    for (let i = window.firstIndex; i < window.lastIndex; i += 1) {
      if (i >= itemCount) break;
      renderedRange.push({
        index: i,
        id: dataSource.idForIndex(i),
        kind: dataSource.kindForIndex(i),
      });
    }

    return (
      <div
        ref={scrollContainerRef}
        data-slot="tug-list-view"
        data-tug-scroll-key={scrollKey ?? "tug-list-view"}
        className={
          className === undefined ? "tug-list-view" : `tug-list-view ${className}`
        }
        tabIndex={0}
      >
        <div
          ref={topSpacerRef}
          className="tug-list-view-spacer tug-list-view-spacer--top"
          aria-hidden="true"
        />
        <div className="tug-list-view-window">
          {renderedRange.map(({ index, id, kind }) => {
            const Renderer = cellRenderers[kind];
            if (Renderer === undefined) {
              // Unknown kind — no renderer registered. Render an
              // empty placeholder so the windowing math still
              // accounts for the slot, and warn in dev.
              if (process.env.NODE_ENV !== "production") {
                console.warn(
                  `[TugListView] no cell renderer registered for kind "${kind}" at index ${index}`,
                );
              }
              return (
                <div
                  key={id}
                  className="tug-list-view-cell"
                  data-tug-list-cell-index={index}
                  data-tug-list-cell-kind={kind}
                  ref={(el) => {
                    if (el !== null) cellElementMapRef.current.set(index, el);
                    else cellElementMapRef.current.delete(index);
                  }}
                />
              );
            }
            return (
              <div
                key={id}
                className="tug-list-view-cell"
                data-tug-list-cell-index={index}
                data-tug-list-cell-kind={kind}
                ref={(el) => {
                  if (el !== null) cellElementMapRef.current.set(index, el);
                  else cellElementMapRef.current.delete(index);
                }}
              >
                <Renderer
                  index={index}
                  id={id}
                  kind={kind}
                  dataSource={dataSource}
                />
              </div>
            );
          })}
        </div>
        <div
          ref={bottomSpacerRef}
          className="tug-list-view-spacer tug-list-view-spacer--bottom"
          aria-hidden="true"
        />
      </div>
    );
  },
);

// `forwardRef` collapses generics; cast back to the generic shape so
// consumers see typed cell-renderer props when they narrow the data-
// source generic. The runtime value is the same `forwardRef` object.
export const TugListView = TugListViewInner as unknown as TugListViewComponent;
