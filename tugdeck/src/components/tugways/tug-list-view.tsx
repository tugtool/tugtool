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
 *   selection state lives with the consumer ([Q06] / [D03]) — except
 *   in opt-in `selectionRequired` mode, where the list view owns a
 *   never-null selected index (local-data zone [L24]; React state is
 *   sanctioned for "selected item in a list") and mirrors it to the
 *   consumer through the `onSelectionChange` state-mirror callback.
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
 *
 * Row roles:
 * - The data source may classify each item as a `"cell"` (the
 *   default), a `"header"`, or a `"footer"` via the optional
 *   `TugListViewDataSource.roleForIndex` method. Cells with a non-
 *   default role render with `data-list-cell-role` set on the wrapper,
 *   are NOT focusable (`tabIndex={-1}`), and do NOT fire
 *   `delegate.onSelect` on click or Space/Enter — they are inert
 *   section dividers. Visibility lifecycle (`willDisplay` /
 *   `didEndDisplaying`) and ResizeObserver measurement still apply,
 *   so headers and footers participate in windowing math identically
 *   to ordinary cells. Cell renderers may attach their own click
 *   handlers if a header/footer needs an action; the primitive's
 *   gating is purely about wrapper-level selection dispatch. See
 *   `tugplan-tide-picker-redesign.md` [D02] for the rationale and the
 *   relationship to a future `numberOfSections` migration.
 *
 * Filtering:
 * - `TugListView` itself does NOT host a search field or own a
 *   filter predicate. UIKit's `UITableView` doesn't either —
 *   `UISearchController` projects a filtered data source the table
 *   consumes. The same split applies here: a host component owns the
 *   search input (a `TugInput` or any other text surface) and
 *   composes a `FilteredTugListViewDataSource` via
 *   `useFilteredDataSource` (in `./use-filtered-data-source.ts`). The
 *   wrapper's filtered enumeration is fed to `<TugListView
 *   dataSource={...} />` in place of the base — the primitive doesn't
 *   know it's filtered, and the consumer doesn't have to teach it.
 *   See `gallery-list-view-filter` for the canonical pattern (host-
 *   owned `TugInput` + `useFilteredDataSource` + `baseIndexFor`-aware
 *   cell renderer) and `tugplan-tide-picker-redesign.md` [D01] /
 *   [Spec S06] for the rationale.
 */

import "./tug-list-view.css";

import React from "react";

import { SmartScroll } from "@/lib/smart-scroll";

import { HeightIndex } from "./internal/list-view-height-index";
import { computeWindow } from "./internal/list-view-window";
import { OuterScrollportProvider } from "./internal/outer-scrollport-context";
import { useSavedRegionScroll } from "./use-component-state-preservation";

// ---------------------------------------------------------------------------
// Row roles — structural classification of an item in the list
// ---------------------------------------------------------------------------

/**
 * Structural role of a row.
 *
 * - `"cell"` (default) — an interactive list item. Focusable
 *   (`tabIndex={0}`); click and Space/Enter dispatch
 *   `delegate.onSelect(index)`.
 * - `"header"` / `"footer"` — an inert section divider. The cell
 *   wrapper renders `data-list-cell-role="header"` (or `"footer"`),
 *   `tabIndex={-1}`, and ignores wrapper-level click / Space / Enter
 *   for the purposes of `delegate.onSelect`. Cell renderers may still
 *   attach their own `onClick` handlers if a header/footer needs to
 *   trigger an action — the primitive's gating is wrapper-level only.
 *
 * Headers and footers participate in windowing, ResizeObserver
 * measurement, and visibility lifecycle (`willDisplay` /
 * `didEndDisplaying`) identically to ordinary cells. The role only
 * affects focusability and the `onSelect` dispatch contract.
 */
export type TugListViewCellRole = "cell" | "header" | "footer";

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
   * dispatch via `cellRenderers[kind]` (and, in a future
   * imperative-pool implementation, reuse-pool routing).
   *
   * **Kind changes are a remount in disguise** ([L26]). When
   * `kindForIndex` returns a different value across renders for the
   * same `id`, the list view picks a different lambda from the
   * `cellRenderers` map. Even if both lambdas wrap the same inner
   * component, React sees two distinct component types for the same
   * React key and unmounts the wrapper subtree — collapsing scroll
   * geometry, tearing down effects, breaking streaming subscriptions.
   * If a data source has one logical row whose appearance evolves
   * over time, prefer a single kind whose renderer branches on the
   * row payload rather than two kinds with two renderers. (See the
   * assistant row in `TideTranscriptDataSource` for the canonical
   * example.)
   */
  kindForIndex(index: number): string;

  /**
   * Structural role of the item at `index`. See `TugListViewCellRole`
   * for the role contract. Optional — when omitted, every index is
   * treated as `"cell"`, preserving the v1 single-role flat-list
   * shape. Implementing this method is purely additive: existing
   * consumers and tests are unaffected.
   *
   * Role may change across data-source updates (e.g. a header that
   * collapses into a regular cell when its section is empty). The
   * list view re-reads `roleForIndex` on every render, so a tick that
   * promotes a cell to a header or vice versa updates the wrapper's
   * focusability and `onSelect`-gating on the next commit.
   *
   * Click and keydown handlers also re-read `roleForIndex` at call
   * time (via the live data source reference), so a role transition
   * between render and click is reflected — a cell that has just
   * become a header will not fire `onSelect` even if the click
   * handler closure was created when the role was `"cell"`.
   */
  roleForIndex?(index: number): TugListViewCellRole;

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
   * Fires when the user activates a cell (click / Space / Enter).
   * Selection ownership lives with the consumer by default — the list
   * view stores no selected-index state. The exception is opt-in
   * `selectionRequired` mode (see `TugListViewProps`), where the list
   * view owns a never-null selected index and mirrors it out through
   * `onSelectionChange`; `onSelect` still fires alongside on every
   * activation.
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

  /**
   * Scroll to the bottom of real content and engage follow-bottom, so
   * subsequent content growth stays pinned. The deliberate inverse of
   * a user scroll-up (which disengages follow-bottom): consumers call
   * this for a "jump to latest" gesture — e.g. a tide-card submitting
   * a new prompt while the transcript is scrolled up. Delegates to
   * `SmartScroll.scrollToBottom`, which excludes the `inert` tail
   * spacer so the scroll lands at the bottom of *content*, not the
   * spacer. No-op before the scroll instance exists.
   */
  scrollToBottom(options?: { animated?: boolean }): void;
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

  /**
   * Skip windowing — render every cell in document order with no
   * spacers, no overscan, no `computeWindow` math. Use for lists
   * where rendering every cell is acceptable (transcripts, settings
   * groups, small fixed inventories) and the windowing-induced layout
   * instability is not.
   *
   * Why this exists: windowed rendering relies on
   * `estimatedHeightForKind` for cells outside the rendered range,
   * then corrects to the true measured height the first time each
   * cell enters the window (`ResizeObserver` populates `heightIndex`
   * on observation). Each first-time-measured event shifts
   * `scrollHeight` by `(measured − estimate)` pixels. The cumulative
   * effect — visible as a "bounce" on relaunch and as scroll-position
   * jitter when wheeling near the bottom of a freshly-loaded
   * transcript — disappears entirely when every cell is rendered
   * from mount, because `heightIndex` is fully populated before the
   * user can interact and never reverts to estimates.
   *
   * Default `false` — windowing is the right choice for unbounded
   * lists (gallery feeds, large logs). Tide's transcript opts in
   * with `inline` because turn counts are small and visual stability
   * matters more than DOM weight. The choice is per-instance, not
   * per-itemCount: a consumer that knows its data is bounded picks
   * `inline`; a consumer that may grow unboundedly stays windowed.
   *
   * @default false
   */
  inline?: boolean;

  /**
   * Opt the list view into UITableView-style mandatory selection:
   * the list **always** has exactly one selected row. On mount (and
   * whenever the data source changes) the list seeds selection to the
   * first selectable row — the first index whose `roleForIndex` is
   * `"cell"`, headers/footers skipped — and it never lets selection
   * fall back to "nothing." A click / Space / Enter on a cell moves
   * the selection; if the currently-selected row leaves the data
   * source (or its role changes), selection re-seeds to the first
   * selectable row rather than clearing.
   *
   * Selection is then list-view-owned state (local-data zone [L24]),
   * surfaced to the consumer through `onSelectionChange`. The
   * selected row's wrapper carries `data-selected="true"` for
   * cascade-scoped styling.
   *
   * Default `false` — the list view owns no selection and behaves
   * exactly as before: `delegate.onSelect` is a fire-and-forget
   * control action and the consumer holds whatever selection model
   * it wants.
   *
   * @default false
   * @selector .tug-list-view-cell[data-selected="true"]
   */
  selectionRequired?: boolean;

  /**
   * State-mirror callback for `selectionRequired` mode — fires with
   * the owned selected index whenever it changes (the initial seed,
   * a click, or a re-seed after the prior row left the data source).
   * Modeled on Radix's `onOpenChange`: it reports list-view-owned
   * state outward, it is not a user-interaction callback (those route
   * through the chain / `delegate.onSelect`). No-op when
   * `selectionRequired` is `false`.
   */
  onSelectionChange?: (index: number) => void;
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
 * Role assigned to a cell when the data source omits `roleForIndex`
 * or returns `undefined` for an index. Single source of truth for the
 * "cell" default so the inline reads in render, click, and keydown
 * paths agree on the fallback identity.
 */
const DEFAULT_CELL_ROLE: TugListViewCellRole = "cell";

/**
 * Resolve the effective selected index for `selectionRequired` mode.
 *
 * Keeps `current` when it still points at a selectable row (in range
 * and `roleForIndex === "cell"`); otherwise falls to the first
 * selectable row. Returns `null` only when the data source has no
 * selectable rows at all — the transient empty-list state. Pure: no
 * DOM, no side effects, just a read of the data source.
 */
function resolveSelectionIndex(
  current: number | null,
  dataSource: TugListViewDataSource,
): number | null {
  const count = dataSource.numberOfItems();
  const isSelectable = (i: number): boolean =>
    i >= 0 &&
    i < count &&
    (dataSource.roleForIndex?.(i) ?? DEFAULT_CELL_ROLE) === "cell";
  if (current !== null && isSelectable(current)) return current;
  for (let i = 0; i < count; i += 1) {
    if (isSelectable(i)) return i;
  }
  return null;
}

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
 *   index lookup, and (later) reuse-pool routing. Wrappers for cells
 *   whose `roleForIndex` is `"header"` or `"footer"` additionally
 *   carry `data-list-cell-role` set to that value, render with
 *   `tabIndex={-1}`, and short-circuit the wrapper-level `onSelect`
 *   dispatch on click and Space/Enter keydown — see the top-of-file
 *   "Row roles" docstring for the full contract.
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
    {
      dataSource,
      delegate,
      cellRenderers,
      scrollKey,
      className,
      followBottom,
      inline,
      selectionRequired = false,
      onSelectionChange,
    },
    ref,
  ) {
    const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
    const topSpacerRef = React.useRef<HTMLDivElement | null>(null);
    const bottomSpacerRef = React.useRef<HTMLDivElement | null>(null);

    // Scrollport state for descendants — `OuterScrollportContext` publishes
    // this element so body-kind affordances can compensate `scrollTop` when
    // their click triggers a layout change in or around the chrome header.
    // Tracking the same node in React state (alongside the ref) lets the
    // context re-publish the moment the scroll container mounts. The
    // composed ref callback below updates both atomically. Same shape as
    // `ToolWrapperChrome` uses for its actions target — and for the same
    // reason: descendants need a non-null value on their first render-
    // after-mount, not "a ref that fires later." See
    // `internal/outer-scrollport-context.tsx` for the consumer hook.
    const [scrollportEl, setScrollportEl] =
      React.useState<HTMLDivElement | null>(null);
    const setScrollContainerRef = React.useCallback(
      (el: HTMLDivElement | null) => {
        scrollContainerRef.current = el;
        setScrollportEl(el);
      },
      [],
    );

    // Map<index, HTMLElement> populated by cell-wrapper ref callbacks.
    // Used by `getElementForIndex` for direct DOM addressing without a
    // querySelector roundtrip. Cleaned up by the ref callback when a
    // cell unmounts.
    const cellElementMapRef = React.useRef<Map<number, HTMLDivElement>>(
      new Map(),
    );

    // `selectionRequired` mode — list-view-owned selected index
    // (local-data zone [L24]; React state is sanctioned for "selected
    // item in a list"). `null` only transiently, before the first
    // selectable row exists; the reconcile effect below drives it to a
    // concrete index and never lets it fall back to `null` while a
    // selectable row is present. Dead weight when `selectionRequired`
    // is `false` — the resolve + effect short-circuit on the flag.
    const [selectedIndex, setSelectedIndex] = React.useState<number | null>(
      null,
    );
    // Live refs so the per-index cached click / keydown closures read
    // current values at fire time [L07].
    const selectionRequiredRef = React.useRef(selectionRequired);
    selectionRequiredRef.current = selectionRequired;
    const onSelectionChangeRef = React.useRef(onSelectionChange);
    onSelectionChangeRef.current = onSelectionChange;
    // Last index handed to `onSelectionChange` — dedupes the mirror
    // callback so it fires once per genuine selection change, not on
    // every re-render that happens to keep the same selection.
    const lastReportedSelectionRef = React.useRef<number | null>(null);

    // Sparse height index — measured cells override the estimate.
    // Held in a ref so the same instance survives every render; the
    // measurements are not React state ([L06] — appearance derived
    // from data, not React's render cycle).
    const heightIndexRef = React.useRef<HeightIndex>(new HeightIndex());

    // Mount-in-saved-state: per-cell `min-height` lock sourced from
    // the saved `meta.cellHeights` (set by the hydration effect
    // below). Cells with a known saved height
    // render with `style.minHeight = ${savedHeight}px`, so async
    // sub-content (markdown, image embeds, code highlighting) fills
    // its destined slot without shifting siblings — the anchor cell
    // stays at the saved viewport position from the very first
    // paint.
    //
    // The lock is permanent within the mount: if a cell's real
    // content ends up SHORTER than the saved height, `min-height`
    // keeps the cell at its saved size (acceptable trade-off —
    // ghost space in the rare shrink case vs. siblings shifting
    // every time). If the cell's real content is TALLER, it grows
    // naturally past `min-height`; `ResizeObserver` reports the
    // taller measurement and the apply effect refines `scrollTop`
    // sub-pixelwise. Held in a ref so cell-render reads are
    // appearance-only ([L06]) — no React state for the lock map.
    const hydratedCellHeightsRef = React.useRef<readonly number[] | null>(
      null,
    );

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

    // Pending anchor-based scroll restore. Set by the listener
    // when CardHost dispatches `tug-region-scroll-set` carrying a
    // `meta.anchor` payload; cleared when the user themselves
    // scrolls (SmartScroll's phase tracking surfaces this as
    // `isUserScrolling = true`).
    //
    // The companion apply effect below runs every commit while the
    // ref is set, re-deriving the target `scrollTop` from the live
    // `heightIndex` and writing it via SmartScroll. As cells settle
    // their heights across subsequent commits, the target moves and
    // the write tracks it — the anchor cell stays at the user's
    // saved viewport position [L23] regardless of how long
    // sub-content takes to render. When the target stops moving
    // (heights stable), the write is a no-op (`scrollTop` already
    // matches desired); apply is idempotent.
    //
    // The clear-on-user-scroll handoff is the only stop signal.
    // No magic-number commit count, no scrollHeight-stability
    // heuristic — the user's gesture is the unambiguous "I own
    // this scroll position now" signal SmartScroll already tracks
    // via its phase machine.
    const restoreAnchorRef = React.useRef<
      { anchorIndex: number; anchorOffset: number } | null
    >(null);

    // Mount-in-saved-state for the outer scroller.
    //
    // Read the bag synchronously at render time via
    // `useSavedRegionScroll`. The hydration effect below runs on the
    // FIRST commit, BEFORE the companion apply effect that consumes
    // `restoreAnchorRef`, so the first paint reflects the exact
    // saved anchor / heightIndex — no `scrollTop=0` flash, no
    // estimated-then-refined hop.
    //
    // Saved cell heights (`meta.cellHeights`) hydrate the live
    // `HeightIndex` so `offsetForIndex(anchorIndex)` returns the
    // exact saved offset on commit 1 instead of an estimate. The
    // companion apply effect computes the right `scrollTop` from
    // commit 1 onward.
    //
    // Saved anchor (`meta.anchor`) seeds `restoreAnchorRef.current`
    // synchronously here — without the seed, the apply effect would
    // no-op on commit 1 because `restoreAnchorRef` was still null;
    // it would only act after CardHost's parent-effect dispatched
    // `tug-region-scroll-set` (one commit later → the user-visible
    // hop).
    //
    // Saved values from prior session also hydrate
    // `prevItemCountRef` (declared below) implicitly — `cellHeights.length`
    // counts as a previous-item-count snapshot for the auto-follow-
    // bottom growth-detection heuristic, but that's incidental; the
    // happy path is just the anchor + heightIndex hydration.
    //
    // [L02] saved state enters React via `useSyncExternalStore` (the
    // `useSavedRegionScroll` hook). [L03] hydration runs in
    // `useLayoutEffect` so first paint reflects the hydrated state.
    // [L23] this is the L23 strengthening — first paint reproduces
    // the layout that made the saved scroll position user-visible.
    // See `tuglaws/state-preservation.md` → "Saving geometry for
    // first-paint accuracy."
    const savedRegionScroll = useSavedRegionScroll(scrollKey);
    React.useLayoutEffect(() => {
      if (savedRegionScroll === undefined) return;
      const meta = savedRegionScroll.meta;
      if (meta === null || typeof meta !== "object") return;

      // Hydrate cell-height geometry into both the live `HeightIndex`
      // (so anchor-resolve math is exact) and the `min-height` lock
      // ref (so cell wrappers render at their saved heights, locking
      // sibling layout against async content settle).
      const cellHeights = (meta as { cellHeights?: unknown }).cellHeights;
      if (Array.isArray(cellHeights)) {
        // Narrow to a number[] for the hook & ref. Non-number entries
        // (shouldn't happen with a well-formed bag) drop to 0 so the
        // lock check below treats them as "no saved height."
        const sanitized: number[] = cellHeights.map((v) =>
          typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0,
        );
        heightIndexRef.current.hydrate(sanitized);
        hydratedCellHeightsRef.current = sanitized;
      }

      // Stash anchor for the apply effect to consume on this commit.
      const anchor = (meta as { anchor?: unknown }).anchor;
      if (
        anchor !== null &&
        typeof anchor === "object" &&
        "index" in anchor &&
        "offset" in anchor
      ) {
        const a = anchor as { index: unknown; offset: unknown };
        if (typeof a.index === "number" && typeof a.offset === "number") {
          restoreAnchorRef.current = {
            anchorIndex: a.index,
            anchorOffset: a.offset,
          };
        }
      }
      // Mount-time only — runs once. Subsequent saves write into
      // `data-tug-scroll-state`; subsequent restores would mount a
      // fresh component instance and re-hydrate.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Previous-commit `numberOfItems()` snapshot used to detect
    // data-source growth. Any `itemCount > prev` qualifies as a
    // "grow" and triggers the auto-follow-bottom pin (gated by
    // `smartScroll.isFollowingBottom`). Initial value `0` so the
    // first commit's "grew from 0 to N" classifies as growth — a
    // freshly-mounted following-bottom list view that already has
    // items pins itself to the bottom on first paint.
    const prevItemCountRef = React.useRef<number>(0);

    // Set to `true` by signals that legitimately request an auto-pin
    // (mount with `followBottom`, item-count growth, cell ResizeObserver
    // flush, container ResizeObserver). The post-commit pin effect
    // bails out unless this ref is set, then clears it. This breaks
    // the previous "post-commit pin runs every commit" feedback loop
    // where `pinToBottom`'s own scroll event would re-trigger the pin
    // via `onScroll → scrollTick → re-render → pin`. Pin is a DOM
    // appearance update ([L06]) and its true triggers are layout /
    // growth signals; coupling it to React's commit cycle is the
    // L22-spirit violation that produced the relaunch bounce.
    const pinRequestedRef = React.useRef<boolean>(false);

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

    // `selectionRequired` — resolve the effective selected index from
    // the owned state + the live data source, then reconcile. The
    // resolve runs every render (the `useSyncExternalStore` above
    // re-runs the body on every data-source tick), so a row leaving
    // the data source or changing role is caught here. `null` when the
    // feature is off or no selectable row exists.
    const effectiveSelectedIndex = selectionRequired
      ? resolveSelectionIndex(selectedIndex, dataSource)
      : null;
    // Reconcile owned state to the resolved value and mirror genuine
    // changes out through `onSelectionChange`. `useLayoutEffect` keeps
    // the seed in the same paint as mount so the first frame already
    // shows a selected row. Converges in at most one extra render:
    // once `selectedIndex === effectiveSelectedIndex`, the `setState`
    // branch is skipped.
    React.useLayoutEffect(() => {
      if (!selectionRequired) return;
      if (effectiveSelectedIndex !== selectedIndex) {
        setSelectedIndex(effectiveSelectedIndex);
      }
      if (
        effectiveSelectedIndex !== null &&
        effectiveSelectedIndex !== lastReportedSelectionRef.current
      ) {
        lastReportedSelectionRef.current = effectiveSelectedIndex;
        onSelectionChangeRef.current?.(effectiveSelectedIndex);
      }
    }, [selectionRequired, effectiveSelectedIndex, selectedIndex]);

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

    // Windowing decision: when the consumer opts into `inline`,
    // render every cell — no spacers, no overscan math. This collapses
    // the class of "first-time-measured cell shifts scrollHeight"
    // bugs because every cell is observed from mount, so `heightIndex`
    // is fully populated before the user can scroll and never reverts
    // to estimates. Otherwise the windowed path runs as before.
    const windowResult = inline === true
      ? ({
          firstIndex: 0,
          lastIndex: itemCount,
          topSpacerHeight: 0,
          bottomSpacerHeight: 0,
          // `totalHeight` is only consumed by `scrollToIndex`'s
          // estimated-jump path, which is itself a no-op when every
          // cell is rendered (the imperative handle's
          // `scrollToElement` branch fires instead). Reporting 0 here
          // is harmless.
          totalHeight: 0,
        })
      : computeWindow({
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
    //
    // Also seeds the initial pin request when `followBottom === true`
    // so a freshly-mounted list view with items already in the data
    // source pins to the bottom on first paint without waiting for a
    // ResizeObserver fire (which is critical for tests, where
    // `ResizeObserver` is a no-op stub, and useful in production where
    // it tightens the cold-mount paint to a single committed pin).
    React.useLayoutEffect(() => {
      if (followBottom === true) {
        pinRequestedRef.current = true;
      }
      scrollTick();
      // `followBottom` is read once at mount; runtime changes are not
      // tracked (matches the SmartScroll-install effect's pattern).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Install the `ResizeObserver` once per list-view instance.
    // Created in `useLayoutEffect` ([L03]) so the constructor runs
    // synchronously after commit, and any cell ref callback that
    // fires during the same commit sees `observerRef.current`
    // populated and observes itself.
    //
    // Re-runs when `dataSource` identity changes (rare). On swap, the
    // height index is cleared first — measurements from the old data
    // source's cells are not valid for the new data source's cells
    // at the same indices. Without the clear, a cell at index 5 in
    // the new data source would inherit the old data source's index-
    // 5 measurement until `ResizeObserver` reported the real height.
    React.useLayoutEffect(() => {
      heightIndexRef.current.clear();
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
            // A measured cell height changed → request a pin so the
            // post-commit pin effect re-asserts the bottom on the
            // next commit. Without this, the signal-gated pin effect
            // would bail out (no request) and a streaming cell that
            // grew its content would leave the user above the bottom.
            pinRequestedRef.current = true;
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

      // Listen for `tug-disengage-follow-bottom` — a bubbling
      // `CustomEvent` fired by descendants whose own click handler
      // grows a cell's content (e.g. `FileBlock` toggling its
      // collapsed state). Without this, the ResizeObserver flush
      // that follows the cell growth requests a `pinToBottom`, and
      // the click target scrolls off-screen — violating the
      // "interacting with a control does not move that control out
      // of view" rule. Disengaging follow-bottom flips
      // `isFollowingBottom` to false; the post-commit pin effect
      // then bails out (`tug-list-view.tsx`'s `if
      // (!ss.isFollowingBottom)` gate).
      const onDisengage = (): void => {
        smartScroll.disengageFollowBottom();
      };
      el.addEventListener("tug-disengage-follow-bottom", onDisengage);

      // Listen for `tug-region-scroll-set` — dispatched by CardHost's
      // `applyRegionScrolls` during cold-boot region-scroll restore
      // (Developer > Reload, cross-pane mount, HMR reload), AND
      // re-dispatched by CardHost's `MutationObserver`-driven retry
      // loop on every cardRoot subtree mutation until `el.scrollTop`
      // is within tolerance of `pos.y`.
      //
      // The compute-and-apply happens inline on each dispatch. No
      // stash, no separate apply effect — CardHost owns the settle
      // mechanism. The shape works for both raw and anchor cases:
      //
      //  - **Anchor case** (`meta.anchor` present): derive
      //    `desired = heightIndex.offsetForIndex(anchorIndex) +
      //    anchorOffset` from the live heightIndex. As cells settle
      //    across subsequent commits, the heightIndex grows; the
      //    next MutationObserver-driven dispatch re-derives a
      //    refined `desired`. The settle gate is CardHost's
      //    `Math.abs(el.scrollTop - pos.y) <= tolerance` check —
      //    when our computed `desired` converges to `pos.y` (and it
      //    will, because the same content renders to the same
      //    cumulative offset), the loop terminates. Identical to
      //    what the raw-pixel path uses.
      //
      //  - **Raw case** (no `meta`): write `pos.y` directly.
      //    Mirrors `tug-markdown-view`'s listener.
      //
      // `preventDefault()` signals the dispatcher that we owned the
      // apply — `applyRegionScrolls` skips its fallback direct
      // `scrollTop` assignment.
      //
      // `disengageFollowBottom` on every dispatch defends against
      // an intervening post-commit pin re-engaging the bottom-pin
      // between dispatches. SmartScroll's `scrollTo` sets a one-
      // shot suppress flag that keeps the deferred scroll event's
      // idle-phase re-engagement from undoing the disengage.
      //
      // [L07] reads heightIndex live each dispatch — no stale closure.
      // [L23] the framework's settle gate is the canonical mechanism;
      //       this listener participates rather than inventing its own.
      // Listen for `tug-region-scroll-set` — CardHost's dispatch on
      // cold-boot restore (and on every MutationObserver-driven
      // retry). Two cases:
      //
      //  - **Anchor case** (`meta.anchor` present): stash the
      //    anchor in `restoreAnchorRef`. The companion apply
      //    effect runs every commit until cleared (by user
      //    scroll), re-deriving the target `scrollTop` from the
      //    live `heightIndex` and writing it via SmartScroll.
      //    Robust to cell-height drift — heights settle over many
      //    commits as sub-content arrives; the apply tracks the
      //    target through every commit.
      //
      //  - **Raw case** (no `meta`): write `pos.y` directly.
      //    Mirrors `tug-markdown-view`'s listener.
      //
      // `preventDefault()` signals the dispatcher we owned the
      // apply — CardHost skips its fallback direct `scrollTop`
      // write. `disengageFollowBottom` defends against an
      // intervening post-commit pin between dispatches.
      const onRegionScrollSet = (event: Event): void => {
        const ce = event as CustomEvent<{
          top?: number;
          left?: number;
          meta?: unknown;
        }>;
        event.preventDefault();
        smartScroll.disengageFollowBottom();

        if (typeof ce.detail.left === "number") {
          el.scrollLeft = ce.detail.left;
        }

        // Resolve anchor metadata if present and well-shaped.
        const meta = ce.detail.meta;
        if (meta !== null && typeof meta === "object" && "anchor" in meta) {
          const a = (meta as { anchor: unknown }).anchor;
          if (
            a !== null &&
            typeof a === "object" &&
            "index" in a &&
            "offset" in a
          ) {
            const ax = a as { index: unknown; offset: unknown };
            if (typeof ax.index === "number" && typeof ax.offset === "number") {
              restoreAnchorRef.current = {
                anchorIndex: ax.index,
                anchorOffset: ax.offset,
              };
              return;
            }
          }
        }

        // Raw-pixel fallback.
        if (typeof ce.detail.top === "number") {
          smartScroll.scrollTo({ top: ce.detail.top, animated: false });
        }
      };
      el.addEventListener("tug-region-scroll-set", onRegionScrollSet);

      return () => {
        el.removeEventListener("tug-disengage-follow-bottom", onDisengage);
        el.removeEventListener("tug-region-scroll-set", onRegionScrollSet);
        smartScroll.dispose();
        smartScrollRef.current = null;
      };
      // `followBottom` is read once on mount — runtime changes to
      // the prop don't tear down + recreate SmartScroll. Consumers
      // that need to flip mid-life can do so via the imperative
      // handle (a follow-on if the need arises) or by remounting.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ResizeObserver on the scroll container itself. Without this,
    // `viewportHeight` (read inline from `clientHeight` at render
    // time) only updates when something else triggers a re-render —
    // a card resize that grows the container leaves a too-tall
    // bottom spacer and an under-populated rendered window because
    // nothing notices the new viewport. Mirrors the
    // `TugMarkdownView` pattern that observes its own scroll
    // container.
    //
    // ResizeObserver coalesces multiple layout shifts in a frame
    // into one delivery, so calling `scrollTick` per fire is enough
    // — no extra rAF coalescing needed.
    React.useLayoutEffect(() => {
      const el = scrollContainerRef.current;
      if (el === null) return;
      const observer = new ResizeObserver(() => {
        // Container resized → if we were following the bottom, the
        // new viewport changes the absolute bottom position. Request
        // a pin so the post-commit pin effect re-asserts.
        pinRequestedRef.current = true;
        scrollTick();
      });
      observer.observe(el);
      return () => {
        observer.disconnect();
      };
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

    // Prime the height-index Fenwick cache so the post-commit
    // correction effect and the imperative handle's `scrollToIndex`
    // read in O(log n) rather than walking linearly. Re-runs when
    // either input changes — `itemCount` after a data-source grow,
    // or `estimatedHeightForKindOnly` identity after a delegate /
    // dataSource swap. ResizeObserver-driven `set()` calls patch the
    // cache incrementally per the height index's contract.
    React.useLayoutEffect(() => {
      heightIndexRef.current.prepare(itemCount, estimatedHeightForKindOnly);
    }, [itemCount, estimatedHeightForKindOnly]);

    // Detect data-source growth and request a pin. Runs only when
    // `itemCount` actually changes — the deps array is the contract.
    // First run on mount sees `prev=0, current=initial`; if items are
    // already present, that classifies as growth and a pin is
    // requested even before any ResizeObserver fires.
    React.useLayoutEffect(() => {
      if (itemCount > prevItemCountRef.current) {
        pinRequestedRef.current = true;
      }
      prevItemCountRef.current = itemCount;
    }, [itemCount]);

    // Auto-follow-bottom pin per [D07]. Signal-driven: bails out
    // unless `pinRequestedRef` was set by an upstream signal (mount,
    // item-count growth, cell ResizeObserver flush, container
    // ResizeObserver). Commits not driven by such a signal — including
    // the scroll-event-induced commit triggered by `pinToBottom`'s own
    // `scrollTop` write — hit the no-request bail at the top, breaking
    // the previous post-commit-on-every-render feedback loop.
    //
    // [L22] alignment: `pinToBottom` is a DOM-appearance update whose
    // legitimate triggers are layout / growth signals, not React's
    // commit cycle. Coupling it to every commit (the previous no-deps
    // `useLayoutEffect`) is the spirit-violation that produced the
    // relaunch bounce — pin's own scroll event re-fed the commit
    // cycle, sustaining a tight pin → scroll → re-render → pin loop.
    //
    // [L07] — `isFollowingBottom` / `isUserScrolling` are read from
    // `smartScrollRef.current` at the moment of the call so each pin
    // sees the live SmartScroll state.
    //
    // Ref-clearing semantics: clear on cancel-conditions (`!following`,
    // `empty`) so a stale request doesn't fire later. Hold the request
    // (don't clear) on `user-scrolling` so the pin re-fires once the
    // gesture ends. Hold on `no-ss` (rare; the SmartScroll-install
    // effect runs before this one in registration order) so the
    // request survives to a commit where SmartScroll exists.
    React.useLayoutEffect(() => {
      if (!pinRequestedRef.current) return;
      const ss = smartScrollRef.current;
      if (ss === null) return;
      if (!ss.isFollowingBottom) {
        pinRequestedRef.current = false;
        return;
      }
      if (ss.isUserScrolling) return;
      if (itemCount <= 0) {
        pinRequestedRef.current = false;
        return;
      }
      pinRequestedRef.current = false;
      ss.pinToBottom();
    });

    // Anchor-state writer. Runs every commit; reads the live
    // `scrollTop`, derives the topmost visible cell via
    // `heightIndex.indexForOffset`, and serializes the resulting
    // `{anchor: {index, offset}}` payload onto `data-tug-scroll-state`.
    // CardHost's `captureRegionScrolls` reads the attribute at every
    // capture moment ([A9] save) so the bag's `regionScroll[key].meta`
    // carries a live anchor that survives reload.
    //
    // Anchor invariant: the attribute reflects the position the user
    // is looking at *right now*. Scroll events trigger a React commit
    // via the scroll-tick state setter, which fires this effect, which
    // refreshes the attribute. Cell measurement growth that shifts the
    // heightIndex also triggers a commit (the index-prepare and post-
    // commit effects re-render the rendered range) — the attribute
    // refresh keeps pace.
    //
    // No write when the list is empty: `indexForOffset(0, 0, ...)`
    // returns 0 trivially, and the meta would be `{anchor:{0,0}}`
    // which is semantically "top of an empty list" — harmless, but
    // we skip the attribute write to keep empty-card DOM clean.
    //
    // [L06] DOM-attribute write, never React state. [L07] reads
    // from the live `scrollContainerRef.current` and `heightIndexRef`.
    React.useLayoutEffect(() => {
      const el = scrollContainerRef.current;
      if (el === null) return;
      const total = dataSource.numberOfItems();
      if (total <= 0) {
        el.removeAttribute("data-tug-scroll-state");
        return;
      }
      const scrollTop = el.scrollTop;
      const anchorIndex = heightIndexRef.current.indexForOffset(
        scrollTop,
        total,
        estimatedHeightForKindOnly,
      );
      const anchorTop = heightIndexRef.current.offsetForIndex(
        anchorIndex,
        estimatedHeightForKindOnly,
      );
      const anchorOffset = Math.max(0, scrollTop - anchorTop);
      // Also serialize the live `heightIndex` snapshot into
      // `meta.cellHeights`. At restore the framework hydrates this
      // back into the live index BEFORE first paint, so the
      // anchor-resolve math reads exact heights instead of
      // estimates. Empty array (no measurements yet) is omitted to
      // keep the on-disk bag clean — the restore path treats
      // absent `cellHeights` as "fall back to estimates." Capture
      // is O(n) over measured cells —
      // free at human-scale list sizes. See `state-preservation.md`
      // → "Saving geometry for first-paint accuracy."
      const cellHeights = heightIndexRef.current.snapshot();
      const meta: { anchor: { index: number; offset: number }; cellHeights?: number[]; scrollHeight?: number } = {
        anchor: { index: anchorIndex, offset: anchorOffset },
      };
      if (cellHeights.length > 0) meta.cellHeights = cellHeights;
      // Validation field — total content height at save time. Not
      // consumed at restore today; documented in the schema so
      // future cross-version layout checks have a hook.
      meta.scrollHeight = el.scrollHeight;
      el.setAttribute("data-tug-scroll-state", JSON.stringify(meta));
    });

    // Anchor-apply effect. Runs every commit while
    // `restoreAnchorRef` is set; recomputes the target `scrollTop`
    // from the live `heightIndex` and writes it via SmartScroll.
    // As cells settle their heights across many commits (markdown
    // loads, file viewer substrates measure, terminal lines re-
    // render), `heightIndex.offsetForIndex(anchorIndex)` converges
    // and the write becomes a no-op (`scrollTop` already equals
    // `desired`).
    //
    // Stop signal: the user themselves scrolling. SmartScroll's
    // phase machine surfaces this as `isUserScrolling = true`
    // (tracking / dragging / settling / decelerating). When that
    // flips true, the user owns the position; we clear pending
    // and stop fighting them.
    //
    // No magic-number commit count, no scrollHeight-stability
    // heuristic — the apply is idempotent at rest (writes only
    // when target moves) and the user's gesture is the
    // unambiguous handoff signal SmartScroll already tracks.
    //
    // [L03] `useLayoutEffect` — write before paint, so the first
    // paint after a heightIndex update reflects the corrected
    // `scrollTop`.
    // [L06] direct DOM write through SmartScroll.scrollTo; no
    // React state crossed.
    // [L07] reads `restoreAnchorRef.current`, `dataSource`,
    // `heightIndexRef.current`, and `smartScroll` live each
    // commit.
    // [L23] preserves user-visible state (anchor cell at saved
    // viewport position) across the indefinite content-settle
    // window; user gesture is the only mechanism that supersedes.
    React.useLayoutEffect(() => {
      const restore = restoreAnchorRef.current;
      if (restore === null) return;
      const el = scrollContainerRef.current;
      const ss = smartScrollRef.current;
      if (el === null || ss === null) return;
      // User-scroll handoff: their gesture wins.
      if (ss.isUserScrolling) {
        restoreAnchorRef.current = null;
        return;
      }
      const total = dataSource.numberOfItems();
      if (restore.anchorIndex < 0 || restore.anchorIndex >= total) {
        // Anchor cell not yet in the data source — wait for items.
        return;
      }
      const cellTop = heightIndexRef.current.offsetForIndex(
        restore.anchorIndex,
        estimatedHeightForKindOnly,
      );
      const desired = Math.max(0, cellTop + restore.anchorOffset);
      if (Math.abs(el.scrollTop - desired) > 0.5) {
        ss.scrollTo({ top: desired, animated: false });
      }
      ss.disengageFollowBottom();
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
            // Default `block: "start"` aligns the row to the top of
            // the viewport — matches `UITableView.scrollToRow(at:at
            // ScrollPosition: .top)` and is the more useful default
            // for "scroll this specific row into focus" use cases
            // than `"nearest"` (which leaves an already-partially-
            // visible row where it is). Consumers that want minimum
            // disturbance pass `block: "nearest"` explicitly.
            ss.scrollToElement(renderedEl, {
              animated: options?.animated ?? false,
              block: options?.block ?? "start",
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
        scrollToBottom(options?: { animated?: boolean }): void {
          smartScrollRef.current?.scrollToBottom(options?.animated ?? false);
        },
      }),
      [dataSource, estimatedHeightForKindOnly],
    );

    // Render the windowed slice. Cells are keyed by
    // `dataSource.idForIndex(i)` per the [D04] item-stable contract so
    // React reconciler matches identity across data-source updates.
    //
    // Each entry also carries the cell's role (see "Row roles" in the
    // top-of-file docstring): captured here at render time so the JSX
    // below sets `tabIndex` and `data-list-cell-role` consistently for
    // both the registered-renderer branch and the unknown-kind
    // placeholder branch.
    const renderedRange: Array<{
      index: number;
      id: string;
      kind: string;
      role: TugListViewCellRole;
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
        role: dataSource.roleForIndex?.(i) ?? DEFAULT_CELL_ROLE,
      });
    }

    // Per-index ref + click callback registry. React's ref protocol
    // fires the OLD callback with `null` and the NEW callback with
    // the element whenever the callback identity changes between
    // renders, even if the element is the same DOM node. Inline
    // arrow functions (`ref={(el) => ...}`) create fresh identities
    // every render and force an unobserve+observe churn cycle on
    // every cell. Caching one stable callback per index keeps
    // identity stable across re-renders so a steady-state window
    // produces zero observer churn.
    //
    // The Map grows with the largest index ever rendered; entries
    // for indices that scroll out are kept (and reused on scroll-
    // back) since the closure cost is small and memoization is the
    // simpler path. A future data-source-shrink-aware pruner can be
    // added if list cardinality ever crosses a threshold where the
    // bookkeeping matters.
    //
    // The click handler reads `delegate?.onSelect` from a ref so
    // consumers swapping delegates between renders don't see lost
    // clicks during the swap, and so the cached closure stays
    // identity-stable while still routing to the current delegate.
    const delegateRef = React.useRef(delegate);
    delegateRef.current = delegate;

    // The click and keydown handlers also read `dataSource.roleForIndex`
    // from a ref so a role transition between render and click is
    // reflected — e.g. a cell that ticks to `"header"` between mount
    // and the user's click does NOT fire `onSelect`, even though the
    // cached click-callback was minted when the role was still
    // `"cell"`. Reading from the live ref also keeps the cached
    // callback identity-stable across data-source identity swaps,
    // mirroring the `delegateRef` pattern above.
    const dataSourceRef = React.useRef(dataSource);
    dataSourceRef.current = dataSource;

    interface CellCallbacks {
      readonly ref: (el: HTMLDivElement | null) => void;
      readonly click: () => void;
      readonly keyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
    }
    const cellCallbacksRef = React.useRef<Map<number, CellCallbacks>>(
      new Map(),
    );

    function getCellCallbacks(index: number): CellCallbacks {
      const registry = cellCallbacksRef.current;
      const cached = registry.get(index);
      if (cached !== undefined) return cached;
      const refCb = (el: HTMLDivElement | null): void => {
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
      const clickCb = (): void => {
        // Role-aware gate. Header / footer rows are inert section
        // dividers — clicking them must NOT promote them to first-
        // responder-style selection. The cell renderer may still
        // attach its own `onClick` for action-bearing
        // headers/footers (e.g. a "Forget all" footer); that
        // listener fires before this wrapper-level handler runs.
        const role =
          dataSourceRef.current.roleForIndex?.(index) ?? DEFAULT_CELL_ROLE;
        if (role !== "cell") return;
        delegateRef.current?.onSelect?.(index);
        // `selectionRequired` mode — the list view owns the selected
        // index; a cell activation moves it. `delegate.onSelect` above
        // still fires, so consumers that want both keep both.
        if (selectionRequiredRef.current) setSelectedIndex(index);
      };
      // Keyboard activation per [Q06] — cell wrappers are
      // `tabIndex={0}` and `role="listitem"` (see render below), so
      // a focused cell receives keydowns directly. Enter and Space
      // fire `delegate.onSelect(index)` and stop propagation so
      // SmartScroll's keydown handler does not also see Space (which
      // it interprets as a scroll key).
      //
      // The `event.target === event.currentTarget` guard prevents
      // double-fire when a cell renderer holds a focusable child.
      // A button inside a cell, focused, then activated by Space:
      // the browser fires a synthetic click on the button which
      // bubbles up to the wrapper's `onClick` (which already routes
      // to `onSelect`). Without the guard, the keydown ALSO fires
      // before the synthetic click, and the consumer sees two
      // selections per activation.
      //
      // The role gate runs BEFORE `preventDefault`/`stopPropagation`:
      // a header/footer with a programmatically-focused descendant
      // that received Enter should not have its event suppressed by
      // the list view; the descendant's own handler (if any) gets
      // the unmodified event.
      const keyDownCb = (e: React.KeyboardEvent<HTMLDivElement>): void => {
        if (e.target !== e.currentTarget) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        const role =
          dataSourceRef.current.roleForIndex?.(index) ?? DEFAULT_CELL_ROLE;
        if (role !== "cell") return;
        e.preventDefault();
        e.stopPropagation();
        delegateRef.current?.onSelect?.(index);
        if (selectionRequiredRef.current) setSelectedIndex(index);
      };
      const callbacks: CellCallbacks = {
        ref: refCb,
        click: clickCb,
        keyDown: keyDownCb,
      };
      registry.set(index, callbacks);
      return callbacks;
    }

    return (
      <div
        ref={setScrollContainerRef}
        data-slot="tug-list-view"
        data-tug-scroll-key={scrollKey ?? "tug-list-view"}
        className={
          className === undefined ? "tug-list-view" : `tug-list-view ${className}`
        }
        role="list"
        tabIndex={0}
      >
        <div
          ref={topSpacerRef}
          className="tug-list-view-spacer tug-list-view-spacer--top"
          aria-hidden="true"
        />
        <OuterScrollportProvider scrollport={scrollportEl}>
        <div className="tug-list-view-window">
          {renderedRange.map(({ index, id, kind, role }) => {
            // Role-aware wrapper attributes:
            //  - `tabIndex` is `0` for cells (focusable, in tab order)
            //    and `-1` for headers/footers (not focusable). See
            //    "Row roles" in the top-of-file docstring.
            //  - `data-list-cell-role` is set only for non-default
            //    roles, keeping the existing default-cell DOM shape
            //    byte-identical for backwards-compatible CSS
            //    selectors that don't yet know about roles.
            const wrapperTabIndex = role === "cell" ? 0 : -1;
            const wrapperRoleAttr = role === "cell" ? undefined : role;
            // `selectionRequired` mode — mark the owned selected row so
            // consumers can style it via
            // `.tug-list-view-cell[data-selected="true"]`. Absent
            // entirely when the feature is off (`effectiveSelectedIndex`
            // is `null`), keeping the default-cell DOM shape unchanged.
            const wrapperSelectedAttr =
              effectiveSelectedIndex === index ? "true" : undefined;
            // `min-height` lock: when the bag carried
            // `meta.cellHeights[index]`, render the cell wrapper
            // at the saved height so async sub-content fills its
            // destined slot without shifting the anchor cell.
            // No saved height → no inline style (existing
            // behavior). [L06] appearance via inline style, never
            // React state.
            const savedCellHeight =
              hydratedCellHeightsRef.current?.[index] ?? 0;
            const cellWrapperStyle =
              savedCellHeight > 0
                ? ({ minHeight: `${savedCellHeight}px` } as React.CSSProperties)
                : undefined;
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
                  data-list-cell-role={wrapperRoleAttr}
                  data-selected={wrapperSelectedAttr}
                  role="listitem"
                  tabIndex={wrapperTabIndex}
                  ref={getCellCallbacks(index).ref}
                  onClick={getCellCallbacks(index).click}
                  onKeyDown={getCellCallbacks(index).keyDown}
                  style={cellWrapperStyle}
                />
              );
            }
            return (
              <div
                key={id}
                className="tug-list-view-cell"
                data-tug-list-cell-index={index}
                data-tug-list-cell-kind={kind}
                data-list-cell-role={wrapperRoleAttr}
                data-selected={wrapperSelectedAttr}
                role="listitem"
                tabIndex={wrapperTabIndex}
                ref={getCellCallbacks(index).ref}
                onClick={getCellCallbacks(index).click}
                onKeyDown={getCellCallbacks(index).keyDown}
                style={cellWrapperStyle}
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
        </OuterScrollportProvider>
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
