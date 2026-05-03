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
 * - [L03] registrations events depend on (SmartScroll, ResizeObserver,
 *   lifecycle delegate) land in `useLayoutEffect` so they're in place
 *   before paint.
 * - [L06] appearance changes via CSS / DOM — spacer heights and scroll
 *   position writes go directly to the DOM, not through React state.
 * - [L11] the list view holds no chain handlers in v1; no scroll-action
 *   vocabulary exists yet for it to register against. Cell renderers
 *   may be controls or responders depending on their content.
 *   `delegate.onSelect` is a control-style action emitted on cell click;
 *   selection state lives with the consumer ([Q06] / [D03]).
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

import { SmartScroll } from "@/lib/smart-scroll";

import { HeightIndex } from "./internal/list-view-height-index";
import { computeWindow } from "./internal/list-view-window";

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

  /**
   * Initial auto-follow-bottom intent. When `true`, the list view
   * pins to the bottom on mount and on every data-source growth /
   * height-index update while the last item is in the rendered
   * window — until the user scrolls up, at which point SmartScroll
   * disengages and the user owns the scroll position. Idle-at-bottom
   * re-engagement is also SmartScroll's job ([D07]).
   *
   * Default `false` — matches `UITableView`'s natural "start at top"
   * behavior. Streaming/transcript consumers (where the user is
   * meant to read the latest content) opt in by passing `true`.
   *
   * @default false
   */
  followBottom?: boolean;
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
 * `scrollToIndex` two-pass correction threshold (CSS pixels). If the
 * measured offset for the target row differs from the estimated
 * offset used in pass 1 by more than this amount, pass 2 issues a
 * corrective `scrollTo`. Below the threshold, sub-pixel rounding
 * noise shouldn't trigger a second scroll write that the user might
 * perceive as a small jump. Sourced from [D03].
 */
const SCROLL_CORRECTION_THRESHOLD_PX = 4;

/**
 * `TugListView` implementation — windowing + cell reuse + delegate
 * lifecycle + SmartScroll-driven scroll-position writes, layered on
 * a sparse height index.
 *
 * The list view subscribes to the data source via
 * `useSyncExternalStore` ([L02]). A `SmartScroll` instance bound to
 * the scroll container owns every programmatic scroll-position
 * write per [D07]; its `onScroll` callback drives the re-window
 * tick. Cell heights flow through a `HeightIndex`: a single
 * `ResizeObserver` instance observes every rendered cell wrapper;
 * observer callbacks update the index, queue a single rAF flush,
 * and force a re-window on flush. Unmeasured indices fall back to
 * `delegate.estimatedHeightForKind`. Cell-lifecycle delegate
 * dispatch (`willDisplay` / `didEndDisplaying` / `onSelect`) sits on
 * top: a per-commit layout effect diffs the rendered index set
 * against the previous commit and notifies the delegate of
 * transitions; the cell wrapper's `onClick` handler fires
 * `onSelect`. Auto-follow-bottom is handled by a post-commit pin
 * effect that calls `SmartScroll.pinToBottom` whenever the data
 * source grew or the last item is in the rendered window AND
 * SmartScroll's `isFollowingBottom` flag is set AND the user is not
 * actively scrolling.
 *
 * What's stable today:
 * - DOM shape per the plan's [#dom-shape]: scroll container,
 *   top spacer, window div with one wrapper per rendered cell, bottom
 *   spacer.
 * - Cell wrapper carries `data-tug-list-cell-index` and
 *   `data-tug-list-cell-kind` for test addressability, observer
 *   index lookup, and (later) reuse-pool routing.
 * - Spacer heights write directly to the DOM via `style.height`
 *   ([L06], mirroring `TugMarkdownView`).
 * - Imperative handle: `scrollToIndex` routes through SmartScroll
 *   ([D07]). Rendered target → `scrollToElement`. Unrendered
 *   target → two-pass precision protocol per [D03]: pass 1 is an
 *   estimated `scrollTo` jump; pass 2 (post-commit correction
 *   effect, threshold 4px) reconciles after the target row mounts
 *   and is measured. Out-of-range indices clamp to first/last; NaN
 *   and empty data sources are no-ops. `getElementForIndex` reads
 *   from a ref map populated by cell wrapper refs.
 * - `ResizeObserver` callbacks coalesce via `requestAnimationFrame`
 *   ([R01] mitigation): rapid sequential resize events from the
 *   browser fold into one rerender per paint frame. [L05] forbids
 *   RAF for state-commit-dependent ops; this RAF is callback-
 *   coalescing, not commit-waiting.
 * - Delegate lifecycle: `willDisplay` fires before
 *   `didEndDisplaying` for transitions in the same commit; both
 *   fire in numeric-ascending order; `onSelect` fires on cell click.
 *   Lifecycle dispatch is purely about visibility transitions inside
 *   a live list view — list-view unmount does not synthesise
 *   `didEndDisplaying`.
 * - Auto-follow-bottom: pinning is gated by
 *   `smartScroll.isFollowingBottom` and `!smartScroll.isUserScrolling`,
 *   read from the live instance per [L07]. User scroll-up disengages
 *   via SmartScroll's own scroll-event handling; idle-at-bottom
 *   re-engagement is also SmartScroll's job.
 */
const TugListViewInner = React.forwardRef<TugListViewHandle, TugListViewProps>(
  function TugListView(
    { dataSource, delegate, cellRenderers, scrollKey, className, followBottom },
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

    // Sparse height index — measured cells override the estimate.
    // Held in a ref so the same instance survives every render; the
    // measurements are not React state ([L06] — appearance derived
    // from data, not React's render cycle).
    const heightIndexRef = React.useRef<HeightIndex>(new HeightIndex());

    // Single `ResizeObserver` per list-view instance — created in
    // `useLayoutEffect` so the constructor runs after the global
    // (potentially test-overridden) `ResizeObserver` is in place. Cell
    // wrapper refs observe / unobserve via this instance.
    const observerRef = React.useRef<ResizeObserver | null>(null);

    // Pending rAF id for height-flush coalescing, or `null` when no
    // flush is queued. The first observer callback in a burst
    // schedules the rAF; subsequent callbacks within the same burst
    // see the queued id and skip the schedule. The rAF clears the id
    // and forces a rerender, which reads the now-updated height
    // index.
    const pendingFlushRef = React.useRef<number | null>(null);

    // The set of indices the list view rendered on the previous
    // commit. Diffed against the current rendered set in a layout
    // effect to compute `entered` (currently-rendered minus
    // previous) and `left` (previous minus currently-rendered),
    // which drive `delegate.willDisplay` / `didEndDisplaying`. Held
    // in a ref because lifecycle bookkeeping is not React state —
    // the list view derives the rendered set from windowing math
    // every render, then notifies the delegate on transitions.
    const prevRenderedIndicesRef = React.useRef<Set<number>>(new Set());

    // The `SmartScroll` instance bound to the scroll container.
    // Owns every programmatic scroll-position write per [D07] and
    // tracks the user's auto-follow-bottom intent through pointer /
    // wheel / keyboard / scroll-event signals. Created in a layout
    // effect on mount, disposed on unmount. Held in a ref because
    // the instance is a long-lived imperative object — not React
    // state — and is read from refs at use time per [L07] so each
    // call sees the live `isFollowingBottom` flag rather than a
    // closed-over snapshot.
    const smartScrollRef = React.useRef<SmartScroll | null>(null);

    // Previous-commit `numberOfItems()` snapshot used to detect
    // data-source growth. Any `itemCount > prev` qualifies as a
    // "grow" and triggers the auto-follow-bottom pin (gated by
    // `smartScroll.isFollowingBottom`). Initial value `0` so the
    // first commit's "grew from 0 to N" classifies as growth — a
    // freshly-mounted following-bottom list view that already has
    // items pins itself to the bottom on first paint.
    const prevItemCountRef = React.useRef<number>(0);

    // Pending two-pass `scrollToIndex` correction state, or `null`
    // when no correction is queued. When `scrollToIndex` is called
    // for an unrendered target ([D03]):
    //   1. Pass 1 — the list view jumps to the estimated offset and
    //      records the index + estimated top here.
    //   2. The target row mounts on the next windowing pass and
    //      `ResizeObserver` measures it.
    //   3. Pass 2 — the post-commit correction effect (below) reads
    //      this ref, recomputes the offset against the now-measured
    //      heights, and corrects `scrollTop` if the difference
    //      exceeds the threshold. Clearing the ref ends the
    //      protocol; subsequent commits do nothing until the next
    //      `scrollToIndex` call.
    const pendingScrollCorrectionRef = React.useRef<{
      index: number;
      estimatedTop: number;
    } | null>(null);

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

    // Force-rerender tick called from SmartScroll's `onScroll`
    // callback (re-window on user scroll), the `ResizeObserver` rAF
    // flush (re-window after height updates), and the post-mount
    // tick (so the second render reads a real `clientHeight`).
    // Triggers a reducer increment which forces React to re-execute
    // the component body and recompute the windowed slice.
    const [, scrollTick] = React.useReducer((x: number) => x + 1, 0);

    // Read scroll geometry from the live DOM at render time. On the
    // first render `scrollContainerRef.current` is null (the ref
    // attaches in the same commit), producing a degenerate window
    // until the post-mount tick. The mount-tick effect below pokes
    // `scrollTick` so the second render sees a real viewport height.
    const scrollEl = scrollContainerRef.current;
    const scrollTop = scrollEl?.scrollTop ?? 0;
    const viewportHeight = scrollEl?.clientHeight ?? 0;

    // Resolve the per-index height closure. Measured heights from
    // the `HeightIndex` win; unmeasured indices fall back to
    // `delegate.estimatedHeightForKind`. The composed accessor flows
    // through to `computeWindow`, the height-index lookup helpers,
    // and the imperative-handle `scrollToIndex` so every height read
    // sees the same fallback chain.
    const itemCount = dataSource.numberOfItems();
    const estimatedHeightForKind = delegate?.estimatedHeightForKind;
    const estimatedHeightForKindOnly = React.useCallback(
      (index: number): number => {
        const kind = dataSource.kindForIndex(index);
        return estimatedHeightForKind?.(kind) ?? DEFAULT_ESTIMATED_HEIGHT;
      },
      [dataSource, estimatedHeightForKind],
    );
    const heightForIndex = React.useCallback(
      (index: number): number => {
        const measured = heightIndexRef.current.get(index);
        if (measured !== undefined) return measured;
        return estimatedHeightForKindOnly(index);
      },
      [estimatedHeightForKindOnly],
    );

    const windowResult = computeWindow({
      itemCount,
      scrollTop,
      viewportHeight,
      overscanCount: OVERSCAN_COUNT,
      estimatedHeightForIndex: heightForIndex,
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

    // Install the `ResizeObserver` once per list-view instance.
    // Created in `useLayoutEffect` ([L03]) so the constructor runs
    // synchronously after commit, and any cell ref callback that
    // fires during the same commit sees `observerRef.current`
    // populated and observes itself.
    React.useLayoutEffect(() => {
      const observer = new ResizeObserver((entries) => {
        const total = dataSource.numberOfItems();
        let anyChanged = false;
        const heightIndex = heightIndexRef.current;
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          const indexAttr = target.getAttribute("data-tug-list-cell-index");
          if (indexAttr === null) continue;
          const index = Number.parseInt(indexAttr, 10);
          if (Number.isNaN(index) || index < 0 || index >= total) {
            // Stale entry — the cell unmounted or the data source
            // shrank below this index between observation and
            // callback. Drop quietly; the height index doesn't carry
            // entries for indices that don't exist.
            continue;
          }
          const newHeight = entry.contentRect.height;
          const currentHeight = heightIndex.get(index);
          // Skip no-op updates — sub-pixel ResizeObserver noise
          // shouldn't force a re-window.
          if (
            currentHeight !== undefined &&
            Math.abs(currentHeight - newHeight) < 0.5
          ) {
            continue;
          }
          heightIndex.set(index, newHeight);
          anyChanged = true;
        }
        if (anyChanged && pendingFlushRef.current === null) {
          pendingFlushRef.current = requestAnimationFrame(() => {
            pendingFlushRef.current = null;
            scrollTick();
          });
        }
      });
      observerRef.current = observer;
      // Observe any cells already in the cellElementMap (mounted
      // before the observer was created on this same commit). React
      // ref callbacks ran during commit, populating the map; this
      // effect runs after them, so we sweep up to ensure observation.
      for (const el of cellElementMapRef.current.values()) {
        observer.observe(el);
      }
      return () => {
        if (pendingFlushRef.current !== null) {
          cancelAnimationFrame(pendingFlushRef.current);
          pendingFlushRef.current = null;
        }
        observer.disconnect();
        observerRef.current = null;
      };
      // dataSource is referenced inside the callback for itemCount
      // bounds — re-running the effect on dataSource identity change
      // installs a fresh observer that sees the new bound. This is
      // rare (dataSource is usually stable for a card's lifetime).
    }, [dataSource]);

    // Instantiate `SmartScroll` against the scroll container ([D07]).
    // SmartScroll owns every programmatic scroll-position write the
    // list view ever issues, attaches the scroll/pointer/wheel/key
    // listeners that drive auto-follow-bottom intent, and exposes
    // `isFollowingBottom` for the growth-pin gates below. Created in
    // `useLayoutEffect` ([L03]) so the listeners are in place before
    // paint; disposed on unmount.
    //
    // The `onScroll` callback drives the same `scrollTick` reducer
    // the previous direct scroll listener did — re-windowing on each
    // scroll event. Step 4's rAF-coalescing rides on the
    // `ResizeObserver` flush; SmartScroll's own internal coalescing
    // (phase machine + scrollend handling) takes care of the
    // gesture-state tracking.
    React.useLayoutEffect(() => {
      const el = scrollContainerRef.current;
      if (el === null) return;
      const smartScroll = new SmartScroll({
        scrollContainer: el,
        followBottom: followBottom ?? false,
        callbacks: {
          onScroll: () => {
            scrollTick();
          },
        },
      });
      smartScrollRef.current = smartScroll;
      return () => {
        smartScroll.dispose();
        smartScrollRef.current = null;
      };
      // `followBottom` is read once on mount — runtime changes to
      // the prop don't tear down + recreate SmartScroll. Consumers
      // that need to flip mid-life can do so via the imperative
      // handle (a follow-on if the need arises) or by remounting.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Apply spacer heights directly to the DOM ([L06]). Mirrors the
    // pattern in `TugMarkdownView`'s `applySpacers`. Runs in
    // `useLayoutEffect` so the geometry is in place before the
    // browser paints the freshly-rendered cells.
    React.useLayoutEffect(() => {
      if (topSpacerRef.current !== null) {
        topSpacerRef.current.style.height = `${windowResult.topSpacerHeight}px`;
      }
      if (bottomSpacerRef.current !== null) {
        bottomSpacerRef.current.style.height = `${windowResult.bottomSpacerHeight}px`;
      }
    }, [windowResult.topSpacerHeight, windowResult.bottomSpacerHeight]);

    // Auto-follow-bottom pin per [D07]. Runs after every commit so
    // both observable content-growth signals are covered:
    //
    //   (a) Data-source ticks that grew `numberOfItems()` — detected
    //       by comparing `itemCount` against `prevItemCountRef`.
    //   (b) Height-index updates that changed total height while the
    //       last item is in the rendered window — detected by
    //       `lastIndex >= itemCount`.
    //
    // [L07] — `isFollowingBottom` and `isUserScrolling` are read
    // from `smartScrollRef.current` at the moment of the call, not
    // captured at effect creation. A stale closure here would yank
    // the user back to bottom even after they scrolled up.
    //
    // The user-scrolling guard separates intent from action: a user
    // mid-gesture (dragging, decelerating) owns the scroll position
    // even if `isFollowingBottom` is still set; SmartScroll will
    // either disengage on scroll-up or re-engage on scroll-down-to-
    // bottom; the next post-gesture commit pins again. This mirrors
    // `TugMarkdownView`'s `doSetRegion` invariant.
    //
    // No deps array — every commit re-checks growth and last-visible
    // state. Steady-state commits hit the early return.
    React.useLayoutEffect(() => {
      const ss = smartScrollRef.current;
      const prevItemCount = prevItemCountRef.current;
      prevItemCountRef.current = itemCount;

      if (ss === null) return;
      if (!ss.isFollowingBottom) return;
      if (ss.isUserScrolling) return;
      if (itemCount <= 0) return;

      const grew = itemCount > prevItemCount;
      const lastVisible = windowResult.lastIndex >= itemCount;
      if (!grew && !lastVisible) return;

      ss.pinToBottom();
    });

    // Two-pass `scrollToIndex` correction per [D03]. Pass 1 lives in
    // the imperative handle (estimated jump); this effect implements
    // pass 2. Runs after every commit; no-ops when no correction is
    // pending. When the target row has been measured (heightIndex
    // entry exists), the corrected offset is recomputed and a
    // single corrective `scrollTo` is issued if it differs from the
    // estimated top by more than the threshold. Sub-threshold drifts
    // skip the corrective write so a stable target produces exactly
    // one `scrollTo` (the pass-1 jump).
    //
    // The pending state is cleared in BOTH the corrected and the
    // sub-threshold branches — if the row has been measured, pass 2
    // is finished regardless of whether a correction was issued.
    // Until measurement arrives, the ref stays set and a later
    // commit completes the protocol.
    React.useLayoutEffect(() => {
      const pending = pendingScrollCorrectionRef.current;
      if (pending === null) return;
      const ss = smartScrollRef.current;
      if (ss === null) return;
      if (!heightIndexRef.current.has(pending.index)) return;

      const correctedTop = heightIndexRef.current.offsetForIndex(
        pending.index,
        estimatedHeightForKindOnly,
      );
      if (Math.abs(correctedTop - pending.estimatedTop) > SCROLL_CORRECTION_THRESHOLD_PX) {
        ss.scrollTo({ top: correctedTop, animated: false });
      }
      pendingScrollCorrectionRef.current = null;
    });

    // Cell-lifecycle delegate dispatch. Runs every commit ([L03] —
    // synchronous after commit, before paint) and diffs the rendered
    // index set against the previous commit's set. Indices that just
    // entered the rendered window fire `delegate.willDisplay`;
    // indices that just left fire `delegate.didEndDisplaying`. Empty
    // diffs (the steady-state case where the window didn't move) cost
    // two empty Set walks and no callback invocations.
    //
    // Order pinning: `willDisplay` fires for every entered index
    // (ascending), THEN `didEndDisplaying` fires for every left index
    // (ascending). This matches UIKit's effective order during a
    // scroll/reuse pass — new cells are dequeued and configured
    // (`willDisplay`) before old cells are signalled gone
    // (`didEndDisplaying`). Documenting it here lets consumers depend
    // on the order; the test "fires willDisplay before didEndDisplaying"
    // pins it.
    //
    // Each entered/left list is built by iterating its source set in
    // numeric-ascending order — both `currentSet` and `prev` are
    // populated by `for (let i = first; i < last; ...)`, so their
    // iteration order is already ascending.
    //
    // The closure captures the current render's `delegate`
    // identity, which is the freshest reference available — a
    // consumer that recreates `delegate` on every render gets fresh
    // closures every commit, with no missed transitions and no
    // re-fires (the diff is empty when the rendered set didn't
    // move). No deps array is correct here: every commit must run
    // the diff so that data-source ticks, scrolls, and viewport
    // changes are all captured.
    //
    // Unmount: the layout-effect's lifecycle does not call
    // `didEndDisplaying` on unmount in v1. Consumers that need
    // teardown signals beyond cell-level scroll-out should attach
    // them to the cell-renderer's own `useEffect` cleanup, which is
    // what UIKit-style imperative-pool reuse would surface
    // identically (cells stay mounted across the pool's lifetime;
    // only the table-view destruction would tear them down). This
    // keeps the lifecycle delegate purely about *visibility
    // transitions inside a live list view*, not list-view teardown.
    React.useLayoutEffect(() => {
      const currentSet = new Set<number>();
      for (let i = windowResult.firstIndex; i < windowResult.lastIndex; i += 1) {
        if (i >= itemCount) break;
        currentSet.add(i);
      }

      const prev = prevRenderedIndicesRef.current;
      const willDisplayCb = delegate?.willDisplay;
      const didEndDisplayingCb = delegate?.didEndDisplaying;

      if (willDisplayCb !== undefined) {
        for (const i of currentSet) {
          if (!prev.has(i)) willDisplayCb(i);
        }
      }
      if (didEndDisplayingCb !== undefined) {
        for (const i of prev) {
          if (!currentSet.has(i)) didEndDisplayingCb(i);
        }
      }

      prevRenderedIndicesRef.current = currentSet;
    });

    // Imperative handle. `scrollToIndex` routes every scroll write
    // through `SmartScroll` per [D07] and implements the [D03]
    // two-pass precision protocol:
    //
    //   - Rendered target → `SmartScroll.scrollToElement(el, options)`.
    //     The DOM rect is exact, no follow-up needed; `block` and
    //     `animated` flow through to the underlying `scrollIntoView`.
    //   - Unrendered target → pass 1: compute the estimated offset
    //     from the height index (measured heights win, estimates
    //     fill gaps) and call `SmartScroll.scrollTo({ top })`. The
    //     re-windowing the scroll triggers mounts the target row;
    //     `ResizeObserver` measures it; pass 2 (the post-commit
    //     correction effect above) reconciles the offset.
    //
    // Out-of-range indices clamp to first/last per [D03]; `NaN` and
    // empty data sources are no-ops with no scroll write.
    React.useImperativeHandle(
      ref,
      () => ({
        scrollToIndex(
          index: number,
          options?: { block?: ScrollLogicalPosition; animated?: boolean },
        ): void {
          if (Number.isNaN(index)) return;
          const total = dataSource.numberOfItems();
          if (total === 0) return;
          const ss = smartScrollRef.current;
          if (ss === null) return;
          const clamped = Math.max(0, Math.min(total - 1, Math.floor(index)));

          const renderedEl = cellElementMapRef.current.get(clamped);
          if (renderedEl !== undefined) {
            // Pass-1-only path: the rect is already exact.
            ss.scrollToElement(renderedEl, {
              animated: options?.animated ?? false,
              block: options?.block ?? "nearest",
            });
            // A pending correction from a prior call is invalidated
            // by an exact-rect scroll — clear it so the post-commit
            // effect doesn't issue a stale corrective write.
            pendingScrollCorrectionRef.current = null;
            return;
          }

          // Pass 1 — estimated jump. Pass 2 fires from the
          // post-commit correction effect above once the target row
          // mounts and is measured.
          const estimatedTop = heightIndexRef.current.offsetForIndex(
            clamped,
            estimatedHeightForKindOnly,
          );
          ss.scrollTo({
            top: estimatedTop,
            animated: options?.animated ?? false,
          });
          pendingScrollCorrectionRef.current = {
            index: clamped,
            estimatedTop,
          };
        },
        getElementForIndex(index: number): HTMLElement | null {
          return cellElementMapRef.current.get(index) ?? null;
        },
      }),
      [dataSource, estimatedHeightForKindOnly],
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
    for (let i = windowResult.firstIndex; i < windowResult.lastIndex; i += 1) {
      if (i >= itemCount) break;
      renderedRange.push({
        index: i,
        id: dataSource.idForIndex(i),
        kind: dataSource.kindForIndex(i),
      });
    }

    // Cell-wrapper ref handler: registers the element in the map and
    // attaches the `ResizeObserver` on mount; unobserves and removes
    // the entry on unmount. Centralized so the two render paths
    // (renderer-present and renderer-missing) share the same
    // semantics.
    const handleCellRef = (
      index: number,
      el: HTMLDivElement | null,
    ): void => {
      if (el !== null) {
        cellElementMapRef.current.set(index, el);
        observerRef.current?.observe(el);
      } else {
        const old = cellElementMapRef.current.get(index);
        if (old !== undefined) {
          observerRef.current?.unobserve(old);
          cellElementMapRef.current.delete(index);
        }
      }
    };

    // Cell-wrapper click handler: fires `delegate.onSelect(index)`.
    // The handler is always attached (not gated on `delegate?.onSelect`
    // existing) so consumers that swap delegates between renders
    // don't see lost clicks during the swap; the inline arrow reads
    // the current render's `delegate` from closure each time and
    // no-ops if `onSelect` is absent.
    //
    // Consumers whose cell renderers contain their own clickable
    // elements (buttons, links) should call `event.stopPropagation()`
    // in their handlers if they don't want the wrapper's click to
    // also fire `onSelect`. This matches UIKit's `selectionStyle =
    // .none` semantics for cells with embedded controls.
    const handleCellClick = (index: number): void => {
      delegate?.onSelect?.(index);
    };

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
                  ref={(el) => handleCellRef(index, el)}
                  onClick={() => handleCellClick(index)}
                />
              );
            }
            return (
              <div
                key={id}
                className="tug-list-view-cell"
                data-tug-list-cell-index={index}
                data-tug-list-cell-kind={kind}
                ref={(el) => handleCellRef(index, el)}
                onClick={() => handleCellClick(index)}
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
