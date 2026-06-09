/**
 * TugListView — windowed list primitive modeled on UIKit's `UITableView`.
 *
 * A framework-level primitive for any surface in tugdeck that renders a
 * list of items: the Dev multi-turn transcript (the first consumer), the
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
 *   `tugplan-dev-picker-redesign.md` [D02] for the rationale and the
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
 *   cell renderer) and `tugplan-dev-picker-redesign.md` [D01] /
 *   [Spec S06] for the rationale.
 */

import "./tug-list-view.css";

import React from "react";

import { SmartScroll } from "@/lib/smart-scroll";

import { HeightIndex } from "./internal/list-view-height-index";
import { computePageNavigation } from "./internal/list-view-page-navigation";
import { computeWindow } from "./internal/list-view-window";
import { OuterScrollportProvider } from "./internal/outer-scrollport-context";
import { ScrollerProvider, type Scroller } from "./internal/scroller-context";
import { useSavedRegionScroll } from "./use-component-state-preservation";
import { TugListRowLayoutProvider, type TugListRowVariant } from "./tug-list-row";
import {
  resolveRowSeparator,
  type TugListViewRowSeparator,
} from "./internal/list-view-separator";
import { useFocusable, useFocusManager } from "./use-focusable";
import { FocusModeContext } from "./focus-manager";
import type { FocusPolicy, KeyViewBehavior } from "./focus-manager";
import { KEY_CURSOR_ATTRIBUTE } from "./use-focus-cursor";

// Re-export the `rowSeparator` prop types so consumers import them
// alongside `TugListView` rather than reaching into the internal path.
export type {
  TugListViewRowSeparator,
  TugListViewRowSeparatorConfig,
  TugListViewSeparatorThickness,
} from "./internal/list-view-separator";

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
   * assistant row in `DevTranscriptDataSource` for the canonical
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
 * consumer with a typed adapter (e.g. `DevTranscriptDataSource`)
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
  /**
   * `true` when this row is the `selectionRequired`-owned selected
   * row. The list view computes it from its owned selected index and
   * passes it alongside the wrapper's `data-selected` attribute, so a
   * cell renderer can forward selection into a presentational child
   * (e.g. `TugListRow`'s `selected` prop) without re-deriving it.
   *
   * Always `false` when `selectionRequired` is off — the list view
   * holds no selection then and the consumer owns it (typically
   * through its own context, read inside the cell renderer).
   */
  selected: boolean;
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
   * this for a "jump to latest" gesture — e.g. a dev-card submitting
   * a new prompt while the transcript is scrolled up. Delegates to
   * `SmartScroll.scrollToBottom`, which excludes the `inert` tail
   * spacer so the scroll lands at the bottom of *content*, not the
   * spacer. No-op before the scroll instance exists.
   *
   * Also arms the post-commit pin so the bottom is re-asserted once
   * React commits any pending state changes that grow `scrollHeight`
   * after this synchronous call (the canonical case: a user submit
   * dispatches into a store inside the same event handler, then calls
   * this method; `scrollHeight` is the pre-commit value at the
   * moment of the clamp, so without the post-commit re-pin the new
   * row can land below the viewport). The post-commit pin reads the
   * live `scrollHeight` after commit and slams to the new bottom,
   * making the "jump to latest" reliable regardless of dispatch
   * order between this method and the store growth.
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
   * `"dev-card-transcript"` vs `"dev-card-history"`).
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
   * <div className="dev-card-transcript">
   *   <TugListView ... className="dev-card-transcript-list" />
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
   * Observe auto-follow-bottom intent. Invoked once on mount with the
   * initial state, then on every SmartScroll follow-bottom transition
   * — user scroll-up disengages; idle / gesture-end / explicit jump
   * re-engage. `following === false` means the user has scrolled away
   * from the live edge — the signal a "jump to latest" affordance keys
   * its visibility on.
   *
   * [L06] consumers drive appearance from this callback through DOM
   * attributes, never React state — follow-bottom intent must not
   * round-trip through render.
   */
  onFollowBottomChange?: (following: boolean) => void;

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
   * lists (gallery feeds, large logs). Dev's transcript opts in
   * with `inline` because turn counts are small and visual stability
   * matters more than DOM weight. The choice is per-instance, not
   * per-itemCount: a consumer that knows its data is bounded picks
   * `inline`; a consumer that may grow unboundedly stays windowed.
   *
   * @default false
   */
  inline?: boolean;

  /**
   * Whether cells are interactive. `true` (default) is the picker shape —
   * `cell`-role rows are focusable (`tabIndex={0}`) and show the row hover
   * affordance. Set `false` for a **read-only listing** (e.g. `/skills`,
   * `/agents`): every row becomes inert — not in the tab order
   * (`tabIndex={-1}`) and no hover highlight — so the surface doesn't imply a
   * click that does nothing. Publishes `data-interactive="false"` on the root
   * for the CSS that suppresses the hover fill. `delegate.onSelect` is
   * independent of this flag (a read-only list simply omits the delegate).
   * @default true
   */
  interactive?: boolean;

  /**
   * Row presentation for descendant `TugListRow`s. One prop that
   * picks a coherent row treatment and publishes it two ways:
   *
   *  - **CSS** — writes `data-row-layout` on the scroll container so
   *    `tug-list-view.css` can scope the inter-row gap and the
   *    divider. `"flush"` collapses the row gap to zero and draws a
   *    1px hairline below every cell but the last — the edge-to-edge
   *    iOS-`UITableView.plain` treatment. `"pill"` sets a small
   *    inter-row gap and draws no dividers, since each `TugListRow`
   *    paints its own border.
   *  - **Context** — publishes the variant through
   *    `TugListRowLayoutContext`, so a `TugListRow` rendered by a
   *    cell renderer inherits it without every cell repeating
   *    `variant`.
   *
   * Omitted ⇒ no `data-row-layout` attribute and no context: the list
   * keeps its default comfortable row gap with no dividers, and a
   * descendant `TugListRow` falls back to its own `variant` prop.
   * Omitting the prop is therefore byte-identical to the
   * pre-`rowLayout` behavior — every existing consumer is unaffected.
   *
   * @selector [data-row-layout="flush"] | [data-row-layout="pill"]
   */
  rowLayout?: TugListRowVariant;

  /**
   * Row-divider control. Lifts the hardcoded `flush` hairline into a
   * tunable prop:
   *
   *  - omitted ⇒ today's behavior exactly — the `flush` layout draws a
   *    hairline below each cell but the last; other layouts draw none.
   *  - `{ thickness?, color? }` ⇒ draw a divider below each cell but
   *    the last (in any layout) at the named thickness (`"hairline"` =
   *    1px, `"thin"` = 1.5px, `"medium"` = 2px) and optional color
   *    override. Publishes `data-row-separator="on"`.
   *  - `"none"` ⇒ no divider, even under `rowLayout="flush"`. Publishes
   *    `data-row-separator="none"`.
   *
   * The resolved thickness / color are written to the
   * `--tugx-list-view-divider-*` tokens on the scroll container ([L06]).
   *
   * @selector [data-row-separator="on"] | [data-row-separator="none"]
   */
  rowSeparator?: TugListViewRowSeparator;

  /**
   * Draw an accent-colored border around the selected row(s). Published
   * to descendant `TugListRow`s through `TugListRowLayoutContext`, so a
   * cell renderer's row picks it up without repeating it. A row may
   * still override with its own `selectedAccent` prop. Default `false`.
   *
   * `flush` rows paint an inset `box-shadow` (no box-model change, so
   * moving the selection never reflows the list); `pill` rows swap their
   * border color.
   *
   * @default false
   * @selector .tug-list-row[data-selected="true"][data-selected-accent="true"]
   */
  selectedAccent?: boolean;

  /**
   * Opt into PageUp / PageDown keyboard navigation by *entry*, where
   * each cell is one entry. When `true`, the list view installs a
   * keyboard handler so PageUp / PageDown — and the macOS
   * Opt+ArrowUp / Opt+ArrowDown aliases — step the scroller exactly
   * one entry at a time:
   *
   *  - PageDown advances to the next entry and pins its top flush to
   *    the top of the viewport — even when that entry is already
   *    partly or fully on screen (an *entry* pager, not an
   *    *entry-in-view* pager). On the last entry it jumps to the live
   *    bottom and re-engages follow-bottom.
   *  - PageUp steps back one entry, pinning its top flush to the top.
   *    From mid-entry the first PageUp snaps the current entry's top
   *    up.
   *
   * The Dev transcript opts in so the user can step through every
   * row — both halves of each turn (the prompt and the response) are
   * separate cells, so navigation visits all of them. Omitted /
   * `false` ⇒ no handler is installed and PageUp / PageDown fall
   * through to the browser default. The selection math is pure and
   * lives in `internal/list-view-page-navigation.ts`.
   *
   * @default false
   */
  pageByEntry?: boolean;

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

  // ---- Focus participation — the listbox model ([P01]/[P03]) ----
  //
  // When authored into a `focusGroup`, the list is ONE item-container stop in the
  // engine Tab walk (like TugAccordion / TugRadioGroup): Tab lands the ring on
  // the scroll container, Up/Down/Home/End/Page move a **movement cursor**
  // (`data-key-cursor`) over the cell rows — scrolling each into view — Space
  // **selects** the cursor row (`data-selected`), and Enter **descends** into a
  // row whose content has navigable focusables (a non-trapped scope; Escape
  // ascends) or else **activates** it (`delegate.onSelect`). The ring stays on
  // the list and never moves onto a row; the cursor is appearance-only, projected
  // straight to the DOM ([L06]/[L22]). When omitted, the list is a plain scroll
  // container with native per-row focus stops (today's un-authored behavior).

  /**
   * Focus group this list is authored into ([P02]). When set, the list registers
   * the scroll container as a single item-container stop and engages the cursor /
   * Space-select / Enter-descend model above. Supplied by the surface that owns
   * the Tab order. Mutually exclusive with {@link keyboardSubordinate} (which
   * wins — a subordinate list never self-registers).
   */
  focusGroup?: string;
  /** Order within {@link focusGroup}. Defaults to 0 (registration order breaks ties). */
  focusOrder?: number;
  /**
   * Walk policy when registered: `accept` (default) is an ordinary Tab stop;
   * `skip` is reachable only in accessibility mode.
   */
  focusPolicy?: FocusPolicy;
  /**
   * Make the list **subordinate** to an external focus owner (a filter input that
   * owns the key view + ring). The list contributes ZERO Tab stops — the scroll
   * container and every cell wrapper are `tabIndex=-1` and the container registers
   * no engine focusable — while selection still lives on the row
   * (`selectionRequired` / `data-selected`). The picker shape. Wins over
   * {@link focusGroup} if both are set.
   * @default false
   */
  keyboardSubordinate?: boolean;

  /**
   * Single-select keyboard model — the picker shape ([P01]/[P12]). When set
   * (and the list is authored into a {@link focusGroup}), the list is a
   * single-selected-row container: the **arrow / Home / End / Page** keys move
   * the cursor *and* commit selection on the landed row (selection follows the
   * cursor — no separate Space step), and the container does **not** consume
   * `Enter` — it declares the engine's single-select flag so Return falls through
   * to the surface's default action ([P12], the `persistentDefaultRing` button).
   * On gaining the key view the list seeds the cursor + selection onto
   * {@link initialSelectedIndex} (the currently-active row) when given, else the
   * first selectable row, so there is always exactly one selected row and the
   * arrows start from the right place.
   *
   * Omitted leaves the default multi-select / descend cursor model
   * (arrows move a distinct cursor, Space selects, Enter acts/descends).
   *
   * @default false
   */
  singleSelect?: boolean;

  /**
   * The row the {@link singleSelect} cursor + selection seed onto when the list
   * first gains the key view — the currently-active choice. Ignored unless
   * `singleSelect` is set; a value that is not a selectable (`"cell"`-role) row
   * falls back to the first selectable row. Used by confirm-style pickers that
   * own their selection outside the list (so the cursor opens on the active row
   * rather than the top).
   */
  initialSelectedIndex?: number;

  /**
   * Commit the seeded row's selection when the {@link singleSelect} list first
   * gains the key view — for a surface whose list IS the opening default and
   * needs its default action enabled on open (a pick-first picker: the rewind
   * turn list auto-selects its first turn so Rewind enables and its ring lights).
   * Ignored unless `singleSelect` is set.
   *
   * Default `false` — the gain-seed only *lands the cursor*; selection then
   * follows explicit arrow movement. Leave it off when merely cycling the key
   * view onto the list must not commit a row (a recents list that would
   * otherwise overwrite a typed path the instant it gains focus).
   *
   * @default false
   */
  seedSelection?: boolean;
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
 * True when `target` is an editable element — `<input>`,
 * `<textarea>`, `<select>`, or any `contenteditable` host. The
 * `cellsPerEntry` keyboard handler skips these so PageUp / PageDown
 * typed into a cell's own editable descendant stays caret movement
 * rather than transcript navigation. Mirrors SmartScroll's own
 * editable-target guard.
 */
function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT"
    || target.tagName === "TEXTAREA"
    || target.tagName === "SELECT"
    || target.isContentEditable
  );
}

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
 * effect plus the per-cell / container `ResizeObserver` callbacks,
 * all of which route through `SmartScroll.maybePinToBottom` — the
 * single owner of the `isFollowingBottom && !isUserScrolling` gate.
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
      interactive = true,
      rowLayout,
      rowSeparator,
      selectedAccent = false,
      pageByEntry,
      selectionRequired = false,
      onSelectionChange,
      onFollowBottomChange,
      focusGroup,
      focusOrder = 0,
      focusPolicy,
      keyboardSubordinate = false,
      singleSelect = false,
      initialSelectedIndex,
      seedSelection = false,
    },
    ref,
  ) {
    // The listbox model engages only when the surface authored a `focusGroup`
    // and the list is not subordinate to an external focus owner ([P01]/[P03]).
    // A subordinate list (picker filter input owns focus) never self-registers.
    const focusEngineActive = focusGroup !== undefined && !keyboardSubordinate;
    const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
    const topSpacerRef = React.useRef<HTMLDivElement | null>(null);
    const bottomSpacerRef = React.useRef<HTMLDivElement | null>(null);

    // Scrollport state for descendants — `OuterScrollportContext` publishes
    // this element so body-kind affordances can compensate `scrollTop` when
    // their click triggers a layout change in or around the chrome header.
    // Tracking the same node in React state (alongside the ref) lets the
    // context re-publish the moment the scroll container mounts. The
    // composed ref callback below updates both atomically. Same shape as
    // `ToolBlockChrome` uses for its actions target — and for the same
    // reason: descendants need a non-null value on their first render-
    // after-mount, not "a ref that fires later." See
    // `internal/outer-scrollport-context.tsx` for the consumer hook.
    const [scrollportEl, setScrollportEl] =
      React.useState<HTMLDivElement | null>(null);
    // The engine's `focusableRef` from `useFocusable` (declared below, since it
    // depends on the cursor/behavior helpers). Held in a ref so the container
    // ref callback — created earlier in render order — can call the latest one
    // without re-creating itself. The `useFocusable` ref is itself stable, so
    // this indirection never churns the attachment.
    const engineFocusableRef = React.useRef<
      ((el: Element | null) => void) | null
    >(null);
    const setScrollContainerRef = React.useCallback(
      (el: HTMLDivElement | null) => {
        scrollContainerRef.current = el;
        setScrollportEl(el);
        // Stamp the engine focusable onto the scroll container when the list is
        // authored into a focus group ([P01]). A no-op (no `data-tug-focusable`)
        // for un-authored / subordinate lists, since `useFocusable` only stamps
        // when `register` is true.
        engineFocusableRef.current?.(el);
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
    // below). Cells with a known saved height render with
    // `style.minHeight = ${savedHeight}px`, so async sub-content
    // (markdown, image embeds, code highlighting) fills its
    // destined slot without shifting siblings — the anchor cell
    // stays at the saved viewport position from the very first
    // paint.
    //
    // The lock is RELEASED per-cell once that cell's measured
    // height reaches or exceeds the saved value. The ResizeObserver
    // callback clears `hydratedCellHeightsRef.current[index]` (set
    // to 0) when `newHeight >= saved - 0.5`, and the next render
    // reads the cleared entry → no more `min-height` on that cell's
    // wrapper. This makes user-action shrinks honored: a hydrated
    // Bash / diff cell that mounts expanded at its saved height
    // (lock releases on first measurement) can subsequently
    // collapse, and the wrapper shrinks with its content — no ghost
    // space below.
    //
    // A permanent lock (held for the whole mount) would leave ghost
    // space in the shrink case. The release is safe because the
    // "siblings shifting" concern the lock guards against only
    // applies to the async-content-fill-in window; once a cell has
    // been measured at its saved size, sub-content is settled and
    // releasing the lock costs nothing — the user-action collapse
    // case is then unblocked.
    //
    // Held in a ref so cell-render reads are appearance-only
    // ([L06]) — no React state for the lock map.
    const hydratedCellHeightsRef = React.useRef<readonly number[] | null>(
      null,
    );

    // Single `ResizeObserver` per list-view instance — created in
    // `useLayoutEffect` so the constructor runs after the global
    // (potentially test-overridden) `ResizeObserver` is in place. Cell
    // wrapper refs observe / unobserve via this instance.
    const observerRef = React.useRef<ResizeObserver | null>(null);

    // Previous `dataSource` seen by the ResizeObserver-install effect,
    // used to distinguish a genuine data-source swap (clear the height
    // index) from a mere effect re-run / mount (keep it — it may carry
    // hydrated geometry). `null` until the first run.
    const prevDataSourceForClearRef =
      React.useRef<TugListViewDataSource | null>(null);

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

    // Latest `onFollowBottomChange` — read from the SmartScroll
    // callback (installed once on mount) so a consumer that passes a
    // fresh callback each render is still observed. [L07]
    const onFollowBottomChangeRef = React.useRef(onFollowBottomChange);
    onFollowBottomChangeRef.current = onFollowBottomChange;

    // Follow-bottom façade published to descendants via
    // `ScrollerProvider`. Its methods delegate to the live
    // `SmartScroll` instance and no-op while it is `null` (pre-mount /
    // post-dispose). `useRef` keeps the first object, so the façade
    // identity is stable for the component's lifetime — the context
    // value never churns, and a body-kind affordance reading
    // `useScroller()` does not re-render on a scroll event. The
    // object literal is re-evaluated each render and discarded by
    // `useRef`, matching the `heightIndexRef` pattern above. [L02] [L07]
    const scrollerFacadeRef = React.useRef<Scroller>({
      engage: (source) => smartScrollRef.current?.engage(source),
      disengage: (source) => smartScrollRef.current?.disengage(source),
    });

    // Mount-in-saved-state for the outer scroller.
    //
    // Read the bag synchronously at render time via
    // `useSavedRegionScroll`. The hydration effect below runs on the
    // FIRST commit; the SmartScroll-install effect (later in the same
    // commit) reads the same `savedRegionScroll` to install the
    // restore target, and the restore-target heartbeat effect (later
    // still) applies it before paint — so the first paint reflects
    // the exact saved anchor / heightIndex, with no `scrollTop=0`
    // flash and no estimated-then-refined hop.
    //
    // This effect's job is the geometry hydration: saved cell heights
    // (`meta.cellHeights`) populate the live `HeightIndex` so
    // `offsetForIndex(anchorIndex)` returns the exact saved offset on
    // commit 1 instead of an estimate, and the `min-height` lock ref
    // so cell wrappers render at their saved heights (locking sibling
    // layout against async content settle). The saved anchor
    // (`meta.anchor`) is consumed by the SmartScroll-install effect,
    // which installs it as a `SmartScroll` restore target.
    //
    // Saved values from prior session also hydrate `prevItemCountRef`
    // (declared below) implicitly — `cellHeights.length` counts as a
    // previous-item-count snapshot for the auto-follow-bottom
    // growth-detection heuristic, but that's incidental.
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
    // `selectionRequired` seeds the first selectable row and never goes null;
    // a `focusGroup` listbox starts unselected and commits on Space/Enter, so
    // its `data-selected` tracks the raw owned index. Both surface through the
    // same `data-selected` / `selected` cell-prop path below.
    const effectiveSelectedIndex = selectionRequired
      ? resolveSelectionIndex(selectedIndex, dataSource)
      : focusEngineActive
        ? selectedIndex
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
    // Re-runs when `dataSource` identity changes (rare). On a genuine
    // SWAP the height index is cleared first — the old source's
    // per-index measurements are invalid for the new source (a cell
    // at index 5 in the new source would otherwise inherit the old
    // index-5 measurement until `ResizeObserver` reported the real
    // height).
    //
    // The clear is gated on an ACTUAL dataSource change, NOT on every
    // effect run. On the initial mount the height index was just
    // populated by the hydration effect above from the saved bag's
    // `meta.cellHeights`; clearing it there would discard the
    // geometry the cold-boot restore needs to land accurately on the
    // first paint. Gating on `prev !== dataSource` (rather than a
    // run-counter) is also correct under React StrictMode's
    // mount/unmount/mount double-invoke — the second invoke sees an
    // unchanged dataSource and skips the clear.
    React.useLayoutEffect(() => {
      if (
        prevDataSourceForClearRef.current !== null &&
        prevDataSourceForClearRef.current !== dataSource
      ) {
        heightIndexRef.current.clear();
      }
      prevDataSourceForClearRef.current = dataSource;
      const observer = new ResizeObserver((entries) => {
        const total = dataSource.numberOfItems();
        let anyChanged = false;
        const heightIndex = heightIndexRef.current;
        // Mutable view of the hydration-lock array — the ref's
        // `readonly number[]` type is a contract about EXTERNAL
        // mutation (the consumer that reads `?.[index]` shouldn't
        // mutate). We OWN the underlying array and may release
        // entries in place as cells reach their saved heights.
        const hydratedHeights =
          hydratedCellHeightsRef.current === null
            ? null
            : (hydratedCellHeightsRef.current as number[]);
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

          // Hydration-lock release. When a cell's measurement
          // reaches or exceeds its saved-at-hydration height, drop
          // the `min-height` lock on that cell so
          // subsequent shrinks (user collapses an expanded Bash /
          // diff hunk, etc.) are honored — the wrapper follows
          // the content down instead of holding ghost space.
          //
          // Runs BEFORE the sub-pixel no-op gate below so a
          // measurement that exactly matches the heightIndex (and
          // therefore would be skipped) still releases the lock —
          // and sets `anyChanged = true` so the rAF flush re-
          // renders to drop the now-stale `min-height` style.
          if (hydratedHeights !== null) {
            const saved = hydratedHeights[index] ?? 0;
            if (saved > 0 && newHeight >= saved - 0.5) {
              hydratedHeights[index] = 0;
              anyChanged = true;
            }
          }

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
        if (anyChanged) {
          // **Synchronous bottom-pin.** The `ResizeObserver` callback
          // fires after layout but BEFORE the browser's next paint
          // (it is part of the same animation frame's "deliver
          // resize-observer notifications" step). Pinning here lands
          // in the SAME paint that shows the new cell heights, so the
          // user never sees the bottom region drift upward as
          // `scrollHeight` grows.
          //
          // Without this write, the rAF deferral below scheduled
          // the pin one or two frames later — long enough for the
          // browser to paint with the stale `scrollTop` (cells at
          // new heights, scrollbar at old position → bottom region
          // visibly slides out of view), then paint again with the
          // pin applied (scrollbar snaps back). That drift-and-snap
          // was the "flashing" of the bottom region.
          //
          // `maybePinToBottom` owns the follow-bottom + not-user-
          // scrolling gate and is idempotent, so a call that passes
          // the gate but finds scrollTop already at the bottom is a
          // cheap no-op.
          smartScrollRef.current?.maybePinToBottom();

          // Still schedule the rAF flush so the list-view re-windows
          // against the updated height index. The post-commit pin
          // re-asserts the bottom on commit; the synchronous write
          // above already eliminated the visible drift — the
          // post-commit pin is the canonical pin write (and a no-op
          // on the steady-state case where the sync write already
          // landed scrollTop at the bottom).
          if (pendingFlushRef.current === null) {
            pendingFlushRef.current = requestAnimationFrame(() => {
              pendingFlushRef.current = null;
              // A measured cell height changed → request a pin so
              // the post-commit pin effect re-asserts the bottom on
              // the next commit. Without this, the signal-gated pin
              // effect would bail out (no request) and a streaming
              // cell that grew its content would leave the user
              // above the bottom.
              pinRequestedRef.current = true;
              scrollTick();
            });
          }
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
          onFollowBottomChanged: (_ss, following) => {
            onFollowBottomChangeRef.current?.(following);
          },
        },
      });
      smartScrollRef.current = smartScroll;
      // Surface the initial follow-bottom intent: `onFollowBottomChanged`
      // fires only on transitions, so a consumer's observer would
      // otherwise miss the mount-time state.
      onFollowBottomChangeRef.current?.(smartScroll.isFollowingBottom);

      // Cold-boot scroll restore is owned by `SmartScroll` (its
      // `setRestoreTarget` / `applyRestoreTarget` API). The list
      // view's only jobs are: (1) install the saved anchor as a
      // restore target — here for the mount-time seed and in the
      // `tug-region-scroll-set` listener for CardHost's retry
      // dispatches; (2) forward a layout heartbeat via the
      // `applyRestoreTarget` effect below. SmartScroll holds the
      // restore state and the supersede rules (engage / user
      // gesture clear it) — the list view holds none.
      //
      // `makeAnchorResolver` builds the resolver for a saved
      // `{index, offset}` anchor. It reads the LIVE `heightIndex`
      // each call, so as virtualized cells settle their measured
      // heights the resolved `scrollTop` tracks the anchor cell's
      // true position [L07] / [L23]. It returns `null` while the
      // anchor cell is outside the data source (content not yet
      // populated) — `applyRestoreTarget` waits for a later commit.
      const makeAnchorResolver =
        (anchorIndex: number, anchorOffset: number): (() => number | null) =>
        () => {
          const total = dataSource.numberOfItems();
          if (anchorIndex < 0 || anchorIndex >= total) return null;
          const cellTop = heightIndexRef.current.offsetForIndex(
            anchorIndex,
            estimatedHeightForKindOnly,
          );
          return Math.max(0, cellTop + anchorOffset);
        };

      // Parse a `meta.anchor` payload to an `{index, offset}` pair,
      // or `null` when absent / malformed.
      const parseAnchor = (
        meta: unknown,
      ): { index: number; offset: number } | null => {
        if (meta === null || typeof meta !== "object" || !("anchor" in meta)) {
          return null;
        }
        const a = (meta as { anchor: unknown }).anchor;
        if (
          a === null ||
          typeof a !== "object" ||
          !("index" in a) ||
          !("offset" in a)
        ) {
          return null;
        }
        const ax = a as { index: unknown; offset: unknown };
        if (typeof ax.index !== "number" || typeof ax.offset !== "number") {
          return null;
        }
        return { index: ax.index, offset: ax.offset };
      };

      // `meta.atBottom` — true when the list was following the bottom
      // at save time. Such a list restores by re-engaging follow-bottom
      // and pinning (exact: `scrollHeight - clientHeight`), NOT by an
      // `{index, offset}` anchor. The anchor path disengages
      // follow-bottom on restore, which leaves the jump-to-bottom
      // affordance showing over a list that is in fact at the bottom,
      // and resolves a near-bottom offset that can land short of the
      // true bottom against not-yet-measured cell heights. Absent on
      // pre-`atBottom` bags → falls back to the anchor path.
      const parseAtBottom = (meta: unknown): boolean =>
        meta !== null &&
        typeof meta === "object" &&
        (meta as { atBottom?: unknown }).atBottom === true;

      // Mount-time seed. The geometry hydration effect ran earlier
      // this commit, so `heightIndex` is already populated; the
      // restore-target heartbeat effect (below) applies the target
      // before paint, so the first paint reflects the saved anchor.
      //
      // A list saved at the bottom installs no anchor target: an
      // anchor resolver disengages follow-bottom (leaving the
      // jump-to-bottom affordance showing over a list that is at the
      // bottom) and resolves a near-bottom offset that can land short
      // of the true bottom. Such a list is constructed following the
      // bottom, so the mount pin lands it exactly; `onRegionScrollSet`
      // re-pins on the cold-boot restore beat.
      const seedAnchor = parseAtBottom(savedRegionScroll?.meta)
        ? null
        : parseAnchor(savedRegionScroll?.meta);
      if (seedAnchor !== null) {
        smartScroll.setRestoreTarget(
          makeAnchorResolver(seedAnchor.index, seedAnchor.offset),
        );
      }

      // Listen for `tug-region-scroll-set` — dispatched by CardHost's
      // `applyRegionScrolls` during cold-boot region-scroll restore
      // (Developer > Reload, cross-pane mount, HMR reload), AND
      // re-dispatched by CardHost's `MutationObserver`-driven retry
      // loop on every cardRoot subtree mutation until `el.scrollTop`
      // is within tolerance of `pos.y`.
      //
      //  - **Anchor case** (`meta.anchor` present): install the
      //    anchor as a `SmartScroll` restore target. SmartScroll
      //    re-applies it on every `applyRestoreTarget` heartbeat
      //    (the effect below) until the user gestures or
      //    follow-bottom engages — robust to cell-height drift as
      //    sub-content settles. CardHost's retry loop terminates on
      //    its own settle gate (`Math.abs(scrollTop - pos.y) <=
      //    tolerance`) once the resolved offset converges.
      //  - **Raw case** (no `meta.anchor`): write `pos.y` directly.
      //    Mirrors `tug-markdown-view`'s listener.
      //  - **At-bottom case** (`meta.atBottom`): re-engage follow-bottom
      //    and pin — exact (`scrollHeight - clientHeight`), and it
      //    keeps follow-bottom engaged so the jump-to-bottom affordance
      //    stays hidden. Wins over the anchor / raw cases, and must run
      //    before `disengageFollowBottom`.
      //
      // `preventDefault()` signals the dispatcher that we owned the
      // apply — `applyRegionScrolls` skips its fallback direct
      // `scrollTop` assignment. `disengageFollowBottom` defends the
      // raw-pixel branch against an intervening post-commit pin; the
      // anchor branch's `setRestoreTarget` disengages on its own.
      const onRegionScrollSet = (event: Event): void => {
        const ce = event as CustomEvent<{
          top?: number;
          left?: number;
          meta?: unknown;
        }>;
        event.preventDefault();

        if (parseAtBottom(ce.detail.meta)) {
          // `scrollToBottom` re-engages follow-bottom and pins.
          smartScroll.scrollToBottom(false);
          return;
        }

        smartScroll.disengageFollowBottom("region-scroll-restore");

        if (typeof ce.detail.left === "number") {
          el.scrollLeft = ce.detail.left;
        }

        const anchor = parseAnchor(ce.detail.meta);
        if (anchor !== null) {
          smartScroll.setRestoreTarget(
            makeAnchorResolver(anchor.index, anchor.offset),
          );
          return;
        }

        // Raw-pixel fallback.
        if (typeof ce.detail.top === "number") {
          smartScroll.scrollTo({ top: ce.detail.top, animated: false });
        }
      };
      el.addEventListener("tug-region-scroll-set", onRegionScrollSet);

      return () => {
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
        // **Synchronous bottom-pin.** Container resize changes the
        // absolute bottom position; pin synchronously so the bottom
        // region doesn't visibly drift mid-resize. Per-cell observers
        // fire AFTER this for cells whose intrinsic height changed
        // (text re-wrap, etc.), and the per-cell sync pin there snaps
        // to the updated bottom as each cell settles — together the
        // two paths keep the bottom region glued across the full
        // resize cascade. `maybePinToBottom` owns the gate.
        smartScrollRef.current?.maybePinToBottom();
        // Still request the async pin + re-window so the rendered
        // window catches any cells that newly fit / no longer fit
        // at the new container width. The post-commit pin write
        // is a no-op when the sync pin already landed scrollTop
        // at the bottom (pinToBottom is idempotent).
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
    // The follow-bottom gate itself lives in `SmartScroll.maybePin
    // ToBottom` ([L07] reads `isFollowingBottom` live); this effect
    // owns only the `pinRequestedRef` lifecycle.
    //
    // Ref-clearing semantics: HOLD the request (don't clear) on
    // `no-ss` (rare; the SmartScroll-install effect runs before this
    // one in registration order — the request survives to a commit
    // where SmartScroll exists) and on `user-scrolling` (the pin must
    // re-fire once the gesture ends). CONSUME the request on every
    // other path: once SmartScroll exists and the user is idle, this
    // commit is the request's terminal outcome — `maybePinToBottom`
    // either pins or correctly drops the request when follow-bottom
    // is disengaged.
    React.useLayoutEffect(() => {
      if (!pinRequestedRef.current) return;
      const ss = smartScrollRef.current;
      if (ss === null) return;
      if (ss.isUserScrolling) return;
      pinRequestedRef.current = false;
      if (itemCount <= 0) return;
      ss.maybePinToBottom();
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
      const meta: {
        anchor: { index: number; offset: number };
        cellHeights?: number[];
        scrollHeight?: number;
        atBottom?: boolean;
      } = {
        anchor: { index: anchorIndex, offset: anchorOffset },
      };
      if (cellHeights.length > 0) meta.cellHeights = cellHeights;
      // Validation field — total content height at save time. Not
      // consumed at restore today; documented in the schema so
      // future cross-version layout checks have a hook.
      meta.scrollHeight = el.scrollHeight;
      // `atBottom` — true when the list is following the bottom. The
      // restore path keys off this to re-engage follow-bottom and pin
      // (exact, jump-to-bottom affordance hidden) instead of resolving
      // the near-bottom anchor. Omitted when false to keep the bag
      // clean; a non-follow-bottom list never sets it.
      const ss = smartScrollRef.current;
      if (ss !== null && ss.isFollowingBottom) meta.atBottom = true;
      el.setAttribute("data-tug-scroll-state", JSON.stringify(meta));
    });

    // Restore-target heartbeat. `SmartScroll` owns the cold-boot
    // scroll-restore policy (the resolver, the supersede rules);
    // this effect only forwards the per-commit layout signal it
    // needs. `applyRestoreTarget` re-resolves the installed target
    // and writes `scrollTop` when it has drifted — so as virtualized
    // cells settle their heights across commits (markdown loads,
    // file-viewer substrates measure, terminal lines re-render) the
    // restore tracks the anchor cell's true position. It is a cheap
    // null-check no-op once no target is installed (the steady state
    // after the first user gesture / follow-bottom engage).
    //
    // [L03] `useLayoutEffect` — the write lands before paint, so the
    // first paint after a heightIndex update reflects the restored
    // `scrollTop`.
    // [L06] the write is a direct DOM `scrollTop` set inside
    // `SmartScroll`; no React state crossed.
    // [L23] preserves the user-visible saved viewport position
    // across the indefinite content-settle window.
    React.useLayoutEffect(() => {
      smartScrollRef.current?.applyRestoreTarget();
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
          // Belt-and-suspenders: the synchronous clamp above lands at
          // the pre-commit `scrollHeight - clientHeight`. If the
          // caller dispatched a state change in the same event that
          // grows the list (e.g. user-submit adds an in-flight row
          // before calling this), the new row is in the data source
          // but not yet in the DOM at the moment of the clamp.
          // Arming `pinRequestedRef` guarantees the post-commit pin
          // effect re-asserts the bottom against the post-commit
          // `scrollHeight`, so the new content lands fully in the
          // viewport on the same paint as it appears. `pinToBottom`
          // is idempotent — a no-op when scrollTop is already at the
          // bottom — so the steady-state cost is zero.
          pinRequestedRef.current = true;
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

    // -----------------------------------------------------------------------
    // Focus engine — the listbox model ([P01]/[P03])
    //
    // When authored into a `focusGroup`, the list is ONE item-container stop:
    // the scroll container registers as the engine focusable (the ring lands on
    // it, never on a row), a movement cursor (`data-key-cursor`) traverses the
    // cell rows under Up/Down/Home/End/Page — scrolling each into view — Space
    // **selects** the cursor row, and Enter **descends** into a row whose content
    // holds navigable focusables (a non-trapped scope; Escape ascends) or else
    // **activates** it. The cursor is appearance-only, projected straight to the
    // DOM with no re-render ([L06]/[L22]); the committed selection is the
    // existing `selectedIndex` / `data-selected` path. Inert (no registration,
    // no cursor) for un-authored / subordinate lists.
    // -----------------------------------------------------------------------
    const manager = useFocusManager();
    const focusableId = React.useId();
    const focusEngineActiveRef = React.useRef(focusEngineActive);
    focusEngineActiveRef.current = focusEngineActive;
    // Live `selectedIndex` for the key-view-gain seed (read at subscription
    // fire time, not closure-capture time) [L07].
    const selectedIndexRef = React.useRef<number | null>(null);
    selectedIndexRef.current = selectedIndex;
    // Live single-select props for the gain-seed / movement closures ([L07]).
    const singleSelectRef = React.useRef(singleSelect);
    singleSelectRef.current = singleSelect;
    const initialSelectedIndexRef = React.useRef(initialSelectedIndex);
    initialSelectedIndexRef.current = initialSelectedIndex;
    const seedSelectionRef = React.useRef(seedSelection);
    seedSelectionRef.current = seedSelection;

    // The movement cursor's data index (`-1` = unlanded). A ref, not React
    // state — moving it must not re-render ([L06]).
    const cursorIndexRef = React.useRef<number>(-1);

    // Cursorable-row helpers — the cursor lands only on `"cell"`-role rows
    // (headers / footers are inert dividers, skipped during movement).
    const roleOfRow = React.useCallback(
      (i: number): TugListViewCellRole =>
        dataSourceRef.current.roleForIndex?.(i) ?? DEFAULT_CELL_ROLE,
      [],
    );
    const isCursorableRow = React.useCallback(
      (i: number): boolean => {
        const total = dataSourceRef.current.numberOfItems();
        return i >= 0 && i < total && roleOfRow(i) === "cell";
      },
      [roleOfRow],
    );
    const firstCursorableRow = React.useCallback((): number => {
      const total = dataSourceRef.current.numberOfItems();
      for (let i = 0; i < total; i += 1) if (isCursorableRow(i)) return i;
      return -1;
    }, [isCursorableRow]);
    const lastCursorableRow = React.useCallback((): number => {
      const total = dataSourceRef.current.numberOfItems();
      for (let i = total - 1; i >= 0; i -= 1) if (isCursorableRow(i)) return i;
      return -1;
    }, [isCursorableRow]);
    // Step from `from` toward `dir` to the next cursorable row; clamp (no wrap).
    const stepCursorableRow = React.useCallback(
      (from: number, dir: 1 | -1): number => {
        const total = dataSourceRef.current.numberOfItems();
        let i = from + dir;
        while (i >= 0 && i < total) {
          if (isCursorableRow(i)) return i;
          i += dir;
        }
        return isCursorableRow(from) ? from : -1;
      },
      [isCursorableRow],
    );
    // Resolve `target` to the nearest cursorable row, preferring `dir` then the
    // opposite — the snap a Page step lands on.
    const cursorableNear = React.useCallback(
      (target: number, dir: 1 | -1): number => {
        const total = dataSourceRef.current.numberOfItems();
        if (total === 0) return -1;
        const clamped = Math.max(0, Math.min(total - 1, target));
        if (isCursorableRow(clamped)) return clamped;
        const forward = stepCursorableRow(clamped, dir);
        if (forward >= 0) return forward;
        return stepCursorableRow(clamped, dir === 1 ? -1 : 1);
      },
      [isCursorableRow, stepCursorableRow],
    );

    // Project / clear `data-key-cursor` directly onto the rendered cell wrappers
    // ([L06]/[L22]) — mirrors `useFocusCursor`'s projection, but index-keyed off
    // `cellElementMapRef` so it composes with windowing (a cursor row scrolled
    // into view mounts, then the per-commit re-projection effect below stamps it).
    const projectCursor = React.useCallback((): void => {
      const target = cursorIndexRef.current;
      for (const [i, el] of cellElementMapRef.current) {
        if (i === target) el.setAttribute(KEY_CURSOR_ATTRIBUTE, "");
        else el.removeAttribute(KEY_CURSOR_ATTRIBUTE);
      }
    }, []);
    const clearCursorVisual = React.useCallback((): void => {
      for (const el of cellElementMapRef.current.values()) {
        el.removeAttribute(KEY_CURSOR_ATTRIBUTE);
      }
    }, []);

    // Bring row `index` into view, reusing the imperative handle's
    // rendered-vs-estimated two-pass logic ([D03]). `nearest` for cursor moves
    // so an already-visible row doesn't jump to the viewport top.
    const scrollIndexIntoView = React.useCallback(
      (index: number, block: ScrollLogicalPosition): void => {
        const total = dataSourceRef.current.numberOfItems();
        if (total === 0) return;
        const ss = smartScrollRef.current;
        if (ss === null) return;
        const clamped = Math.max(0, Math.min(total - 1, Math.floor(index)));
        const renderedEl = cellElementMapRef.current.get(clamped);
        if (renderedEl !== undefined) {
          ss.scrollToElement(renderedEl, { animated: false, block });
          pendingScrollCorrectionRef.current = null;
          return;
        }
        const estimatedTop = heightIndexRef.current.offsetForIndex(
          clamped,
          estimatedHeightForKindOnly,
        );
        ss.scrollTo({ top: estimatedTop, animated: false });
        pendingScrollCorrectionRef.current = { index: clamped, estimatedTop };
      },
      [estimatedHeightForKindOnly],
    );

    // Move the cursor to `index`, project it, and optionally scroll it in.
    const moveCursorTo = React.useCallback(
      (index: number, scroll: boolean): void => {
        if (index < 0) return;
        cursorIndexRef.current = index;
        projectCursor();
        if (scroll) scrollIndexIntoView(index, "nearest");
      },
      [projectCursor, scrollIndexIntoView],
    );

    // The engine focusable id carried by the cursor row's first inner focusable,
    // or `null` when the row holds none — Enter descends only when present.
    const rowFirstFocusableId = React.useCallback((i: number): string | null => {
      const el = cellElementMapRef.current.get(i);
      const inner = el?.querySelector("[data-tug-focusable]") ?? null;
      return inner?.getAttribute("data-tug-focusable") ?? null;
    }, []);
    const rowScopeId = React.useCallback(
      (i: number): string => `${focusableId}-row-${i}`,
      [focusableId],
    );

    // Space / Enter-act: commit selection on the cursor row (`data-selected`)
    // and fire `delegate.onSelect`. Enter-descend: push the row's non-trapped
    // scope and land the key view on its first inner focusable.
    const selectCursorRow = React.useCallback((): void => {
      const i = cursorIndexRef.current;
      if (!isCursorableRow(i)) return;
      setSelectedIndex(i);
      delegateRef.current?.onSelect?.(i);
      scrollIndexIntoView(i, "nearest");
    }, [isCursorableRow, scrollIndexIntoView]);
    const descendCursorRow = React.useCallback((): void => {
      if (manager === null) return;
      const i = cursorIndexRef.current;
      const innerId = rowFirstFocusableId(i);
      if (innerId === null) {
        selectCursorRow();
        return;
      }
      manager.pushFocusMode(rowScopeId(i), { trapped: false });
      manager.setKeyView(innerId, true);
      manager.focusKeyView();
    }, [manager, rowFirstFocusableId, rowScopeId, selectCursorRow]);

    // The thin declaration the engine's act dispatch reads at Space/Enter/Escape
    // ([P01]) — `currentItemDescendable` is evaluated live against the cursor row.
    const behavior = React.useCallback(
      (): KeyViewBehavior => ({
        container: "item",
        commit: singleSelect ? "live" : "deferred",
        // A single-select list keeps select-on-arrow (the cursor IS the selection —
        // a 7.5 picker idiom, intentionally excluded from the [P24] reversion):
        // `commit: "live"` moves the selection with the cursor, and a single-select
        // list never descends, so Enter resolves to passthrough and reaches the
        // surface default. A multi/descendable list moves a cursor only; Enter
        // descends a navigable row, else bubbles to the scope default ([P24]).
        currentItemDescendable:
          !singleSelect && rowFirstFocusableId(cursorIndexRef.current) !== null,
        onSelect: selectCursorRow,
        onAct: selectCursorRow,
        onDescend: descendCursorRow,
      }),
      [singleSelect, rowFirstFocusableId, selectCursorRow, descendCursorRow],
    );

    // Register the scroll container as the single item-container stop. The
    // returned ref is stamped onto the container by `setScrollContainerRef`
    // (above) via `engineFocusableRef`. `register: false` for un-authored /
    // subordinate lists leaves the container a plain native stop.
    const { focusableRef: engineFocusable } = useFocusable({
      id: focusableId,
      group: focusGroup ?? "",
      order: focusOrder,
      policy: focusPolicy,
      register: focusEngineActive,
      behavior,
    });
    engineFocusableRef.current = engineFocusable;

    // Land / clear the cursor as the container gains or loses the keyboard key
    // view. On gain, seed the cursor on the selected row (else the first
    // cursorable row) only when unlanded — so a descend → ascend round-trip
    // preserves the cursor position. On loss, drop the visual but keep the index.
    const wasKbdRef = React.useRef(false);
    React.useLayoutEffect(() => {
      if (manager === null || !focusEngineActive) return;
      const onChange = (): void => {
        const el = scrollContainerRef.current;
        if (el === null) return;
        const kbd = el.hasAttribute("data-key-view-kbd");
        if (kbd && !wasKbdRef.current) {
          if (cursorIndexRef.current < 0) {
            // Seed the cursor on the active row. Single-select prefers the
            // surface-supplied active row (`initialSelectedIndex`); both models
            // fall back to the list-owned selection, then the first cursorable
            // row. The seed is cursor-only by default — selection follows
            // explicit arrow movement, so merely cycling the key view onto a
            // list never commits a row (a recents list must not clobber a typed
            // path on focus). A surface whose list IS the opening default
            // (`seedSelection`) commits the seeded row so it opens with exactly
            // one selected row (a pick-first picker that enables its default
            // action on open).
            const preferred =
              singleSelectRef.current && isCursorableRow(initialSelectedIndexRef.current ?? -1)
                ? (initialSelectedIndexRef.current as number)
                : (selectedIndexRef.current ?? -1);
            const seed = isCursorableRow(preferred) ? preferred : firstCursorableRow();
            if (seed >= 0) {
              moveCursorTo(seed, true);
              if (singleSelectRef.current && seedSelectionRef.current) {
                selectCursorRow();
              }
            }
          } else {
            projectCursor();
          }
        } else if (!kbd && wasKbdRef.current) {
          clearCursorVisual();
        }
        wasKbdRef.current = kbd;
      };
      const unsubscribe = manager.subscribe(onChange);
      onChange();
      return unsubscribe;
    }, [
      manager,
      focusEngineActive,
      isCursorableRow,
      firstCursorableRow,
      moveCursorTo,
      projectCursor,
      clearCursorVisual,
      selectCursorRow,
    ]);

    // Re-project the cursor every commit while the container holds the key view,
    // so a row that mounts as the cursor scrolls into view picks up
    // `data-key-cursor` on the next paint. Cheap null/attribute check otherwise.
    React.useLayoutEffect(() => {
      if (!focusEngineActive) return;
      const el = scrollContainerRef.current;
      if (
        el !== null &&
        el.hasAttribute("data-key-view-kbd") &&
        cursorIndexRef.current >= 0
      ) {
        projectCursor();
      }
    });

    // Movement keys (capture phase, so this runs ahead of SmartScroll's own
    // bubble keydown and the `pageByEntry` handler — `stopImmediatePropagation`
    // claims a handled key). Arrows / Home / End move one row; Page moves a
    // viewport of rows and snaps to the nearest cursorable row. Space / Enter /
    // Escape are NOT handled here — the engine's act dispatch owns them.
    React.useLayoutEffect(() => {
      if (!focusEngineActive) return;
      const scrollEl = scrollContainerRef.current;
      if (scrollEl === null) return;
      const handler = (e: KeyboardEvent): void => {
        if (e.defaultPrevented || e.metaKey || e.ctrlKey) return;
        if (isEditableEventTarget(e.target)) return;
        // Move the cursor only while the container itself holds the keyboard key
        // view. After Enter descends onto an inner focusable the container is no
        // longer the key view — arrows then belong to the descended component,
        // not the list cursor.
        if (!scrollEl.hasAttribute("data-key-view-kbd")) return;
        const total = dataSourceRef.current.numberOfItems();
        if (total === 0) return;
        const cur = cursorIndexRef.current;
        // Tree-style descend ([P02] disclosure model): Right enters a row whose
        // content has navigable focusables, mirroring Enter. Not in single-select
        // (those rows are picks, never descended). Ascend is Escape. Other rows
        // ignore Right (no horizontal movement in a vertical list).
        if (
          e.key === "ArrowRight" &&
          !singleSelectRef.current &&
          rowFirstFocusableId(cur) !== null
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
          descendCursorRow();
          return;
        }
        const pageStep = (): number =>
          Math.max(
            1,
            Math.floor(
              (scrollEl.clientHeight || 0) /
                Math.max(1, heightForIndex(Math.max(0, cur))),
            ) - 1,
          );
        let next = -1;
        switch (e.key) {
          case "ArrowDown":
            next = cur < 0 ? firstCursorableRow() : stepCursorableRow(cur, 1);
            break;
          case "ArrowUp":
            next = cur < 0 ? lastCursorableRow() : stepCursorableRow(cur, -1);
            break;
          case "Home":
            next = firstCursorableRow();
            break;
          case "End":
            next = lastCursorableRow();
            break;
          case "PageDown":
            next = cursorableNear((cur < 0 ? firstCursorableRow() : cur) + pageStep(), 1);
            break;
          case "PageUp":
            next = cursorableNear((cur < 0 ? lastCursorableRow() : cur) - pageStep(), -1);
            break;
          default:
            return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        if (next >= 0 && next !== cur) {
          moveCursorTo(next, true);
          // Single-select: selection follows the cursor — commit the landed row
          // so there is no separate Space step ([P12] picker shape).
          if (singleSelectRef.current) selectCursorRow();
        } else if (next >= 0) scrollIndexIntoView(next, "nearest");
      };
      scrollEl.addEventListener("keydown", handler, true);
      return () => scrollEl.removeEventListener("keydown", handler, true);
    }, [
      focusEngineActive,
      heightForIndex,
      firstCursorableRow,
      lastCursorableRow,
      stepCursorableRow,
      cursorableNear,
      moveCursorTo,
      scrollIndexIntoView,
      selectCursorRow,
      rowFirstFocusableId,
      descendCursorRow,
    ]);

    // PageUp / PageDown by entry ([L02] DOM event listener installed
    // in a `useLayoutEffect` per [L03]; no React state crosses the
    // scroll write). Opt-in via `pageByEntry` — omitted means the
    // keys fall through to the browser default. Installed once;
    // re-runs only when the opt-in flips.
    //
    // Capture phase. SmartScroll's own keydown listener
    // (`smart-scroll.ts`) is registered bubble-phase on this same
    // container; a capture-phase listener runs first regardless of
    // registration order, so when this handler claims a key,
    // `stopImmediatePropagation` reaches that bubble listener and
    // keeps SmartScroll from also entering its dragging phase /
    // disengaging follow-bottom for a key this handler has already
    // resolved. The scroll write itself still routes through
    // SmartScroll so the [D07] follow-bottom intent stays coherent:
    // PageUp disengages, PageDown onto the last cell re-engages.
    React.useLayoutEffect(() => {
      // The listbox cursor handler ([P01]) owns Page keys when the list is
      // authored into a focus group — don't also install the scroll-only pager.
      if (pageByEntry !== true || focusEngineActive) return;
      const scrollEl = scrollContainerRef.current;
      if (scrollEl === null) return;

      const handleNavKey = (e: KeyboardEvent): void => {
        if (e.defaultPrevented) return;
        // macOS aliases Opt+Arrow onto PageUp / PageDown. Exclude
        // Cmd / Ctrl from the arrow alias so it can't collide with
        // SmartScroll's Cmd+ArrowDown "jump to bottom".
        const altArrow = e.altKey && !e.metaKey && !e.ctrlKey;
        const isUp = e.key === "PageUp" || (altArrow && e.key === "ArrowUp");
        const isDown =
          e.key === "PageDown" || (altArrow && e.key === "ArrowDown");
        if (!isUp && !isDown) return;
        // A keydown inside an editable descendant is caret movement.
        if (isEditableEventTarget(e.target)) return;

        const ss = smartScrollRef.current;
        if (ss === null) return;

        // Geometry from real DOM rects, not the height index: the
        // index sums cell heights and so cannot see the window's
        // `row-gap` or the breathing-room pseudo-elements, which would
        // drift the target by one gap per entry. `inline` mode renders
        // every cell, so the element map is complete; bail to the
        // browser default if it somehow is not.
        const itemCount = dataSourceRef.current.numberOfItems();
        const cellEls: HTMLElement[] = [];
        for (let i = 0; i < itemCount; i += 1) {
          const el = cellElementMapRef.current.get(i);
          if (el === undefined) return;
          cellEls.push(el);
        }
        const viewTop = scrollEl.getBoundingClientRect().top;
        const cellTops = cellEls.map(
          (el) => el.getBoundingClientRect().top - viewTop,
        );

        const result = computePageNavigation({
          direction: isUp ? "up" : "down",
          cellTops,
        });
        if (result.kind === "none") return;

        // This handler owns the key — suppress the browser's
        // viewport-height page scroll and SmartScroll's keydown
        // handler (see the capture-phase note above).
        e.preventDefault();
        e.stopImmediatePropagation();

        if (result.kind === "bottom") {
          // PageDown already on the last entry — jump to the live
          // bottom and re-engage follow-bottom ([D07], composes with
          // Sub-step I).
          ss.scrollToBottom(false);
          return;
        }
        // Step one entry. PageUp moves away from the live edge, so
        // break follow-bottom; PageDown to a non-last entry leaves it
        // alone (it is already disengaged whenever the scroller is not
        // at the bottom). `scrollToElement` runs the browser's exact
        // `scrollIntoView`, pinning the target entry's top flush to
        // the viewport top.
        if (isUp) ss.disengage("page-up-key");
        ss.scrollToElement(cellEls[result.index], {
          animated: false,
          block: "start",
        });
      };

      scrollEl.addEventListener("keydown", handleNavKey, true);
      return () => {
        scrollEl.removeEventListener("keydown", handleNavKey, true);
      };
    }, [pageByEntry, focusEngineActive]);

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
        // headers/footers (e.g. a "Trash all" footer); that
        // listener fires before this wrapper-level handler runs.
        const role =
          dataSourceRef.current.roleForIndex?.(index) ?? DEFAULT_CELL_ROLE;
        if (role !== "cell") return;
        delegateRef.current?.onSelect?.(index);
        // `selectionRequired` mode — the list view owns the selected
        // index; a cell activation moves it. `delegate.onSelect` above
        // still fires, so consumers that want both keep both. A
        // `focusGroup` listbox commits selection on pointer activation
        // too, and parks the movement cursor on the clicked row.
        if (selectionRequiredRef.current || focusEngineActiveRef.current) {
          setSelectedIndex(index);
        }
        if (focusEngineActiveRef.current) moveCursorTo(index, false);
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

    // Row-layout context payload published to descendant `TugListRow`s.
    // Memoized on its fields so the object identity is stable across
    // scroll-tick re-renders — the context value churning would re-render
    // every row needlessly.
    const rowLayoutValue = React.useMemo(
      () => ({ variant: rowLayout ?? null, selectedAccent }),
      [rowLayout, selectedAccent],
    );

    // Resolve `rowSeparator` into the divider's CSS custom-property
    // values + the `data-row-separator` mode. Omitting the prop leaves
    // both unset, so the flush divider renders exactly as before ([L06]).
    const resolvedSeparator = resolveRowSeparator(rowSeparator);
    const rowSeparatorMode =
      rowSeparator === undefined
        ? undefined
        : resolvedSeparator === null
          ? "none"
          : "on";
    const separatorStyle: React.CSSProperties | undefined =
      resolvedSeparator !== null && rowSeparator !== undefined
        ? ({
            "--tugx-list-view-divider-thickness": resolvedSeparator.thickness,
            ...(resolvedSeparator.color !== null
              ? { "--tugx-list-view-divider-color": resolvedSeparator.color }
              : {}),
          } as React.CSSProperties)
        : undefined;

    // Rows are native per-row Tab stops only for an un-authored, non-subordinate
    // list (today's default). A `focusGroup` listbox is one container stop with a
    // movement cursor; a subordinate list contributes no stops.
    const rowsAreNativeStops = !focusEngineActive && !keyboardSubordinate;

    return (
      <div
        ref={setScrollContainerRef}
        data-slot="tug-list-view"
        data-tug-scroll-key={scrollKey ?? "tug-list-view"}
        data-row-layout={rowLayout}
        data-row-separator={rowSeparatorMode}
        data-interactive={interactive ? undefined : "false"}
        className={
          className === undefined ? "tug-list-view" : `tug-list-view ${className}`
        }
        style={separatorStyle}
        role="list"
        // A subordinate list adds no Tab stop of its own (the filter input owns
        // focus); every other list is a native / engine focus stop at `0`.
        tabIndex={keyboardSubordinate ? -1 : 0}
      >
        <div
          ref={topSpacerRef}
          className="tug-list-view-spacer tug-list-view-spacer--top"
          aria-hidden="true"
        />
        <OuterScrollportProvider scrollport={scrollportEl}>
        <ScrollerProvider scroller={scrollerFacadeRef.current}>
        <TugListRowLayoutProvider value={rowLayoutValue}>
        <div className="tug-list-view-window">
          {renderedRange.map(({ index, id, kind, role }) => {
            // Role-aware wrapper attributes:
            //  - `tabIndex` is `0` for cells (focusable, in tab order)
            //    and `-1` for headers/footers (not focusable). See
            //    "Row roles" in the top-of-file docstring.
            //  - Rows are individual native Tab stops ONLY for an
            //    un-authored, non-subordinate list. A `focusGroup` listbox
            //    is one stop with a movement cursor; a subordinate list adds
            //    no stops — both make rows `-1`, with the active row shown by
            //    the cursor / selection, not Tab focus.
            //  - `data-list-cell-role` is set only for non-default
            //    roles, keeping the existing default-cell DOM shape
            //    byte-identical for backwards-compatible CSS
            //    selectors that don't yet know about roles.
            const wrapperTabIndex =
              rowsAreNativeStops && interactive && role === "cell" ? 0 : -1;
            const wrapperRoleAttr = role === "cell" ? undefined : role;
            // `selectionRequired` mode — the owned selected row.
            // Surfaced two ways from the one source: `data-selected`
            // on the wrapper (the CSS-cascade hook,
            // `.tug-list-view-cell[data-selected="true"]`) and the
            // `selected` cell prop (the render-logic hook a cell
            // renderer forwards into a presentational child). The
            // wrapper attribute is absent entirely when the feature
            // is off, keeping the default-cell DOM shape unchanged.
            const cellSelected = effectiveSelectedIndex === index;
            const wrapperSelectedAttr = cellSelected ? "true" : undefined;
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
                {focusEngineActive ? (
                  // The row's content joins the row's own focus mode, so its
                  // inner focusables become the walk once Enter descends ([P02]).
                  <FocusModeContext.Provider value={`${focusableId}-row-${index}`}>
                    <Renderer
                      index={index}
                      id={id}
                      kind={kind}
                      dataSource={dataSource}
                      selected={cellSelected}
                    />
                  </FocusModeContext.Provider>
                ) : (
                  <Renderer
                    index={index}
                    id={id}
                    kind={kind}
                    dataSource={dataSource}
                    selected={cellSelected}
                  />
                )}
              </div>
            );
          })}
        </div>
        </TugListRowLayoutProvider>
        </ScrollerProvider>
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
