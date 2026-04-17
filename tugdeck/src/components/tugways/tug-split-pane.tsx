/**
 * TugSplitPane — Split-pane layout primitive with draggable sashes.
 *
 * Wraps react-resizable-panels' `Group` / `Panel` / `Separator` primitives
 * with tugways chrome. Divides a region into two or more resizable children
 * stacked along one axis, separated by draggable sashes. Panels declare
 * their own size constraints via TugSplitPanel.
 *
 * Supports both horizontal and vertical orientations via the `orientation`
 * prop. Two-or-more panel children are supported in the same call (Sashes
 * are auto-interleaved). Nesting is supported — a TugSplitPanel may
 * contain another TugSplitPane.
 *
 * ## Orientation inversion
 *
 * react-resizable-panels v4 names `orientation` after the axis along which
 * panels are laid out: `"vertical"` = vertical stack with a horizontal sash
 * between them; `"horizontal"` = horizontal row with a vertical sash. The
 * TugSplitPane API names orientation after the *dividing line* — matching
 * NSSplitView, VS Code, and the user's mental model ("horizontally-split
 * card"). The two conventions are inverses, so TugSplitPane's horizontal
 * becomes the library's `"vertical"` in the call below. The inversion is
 * load-bearing: it's what lets the API read naturally from the user's
 * perspective while the library's flex-direction convention does its
 * thing underneath.
 *
 * ## Host-agnostic contract
 *
 * TugSplitPane has zero knowledge of any particular mount site — not the
 * Component Gallery, not the Tide card, not a settings sheet. Its contract
 * is the standard flexbox one: the parent must have a concrete height (for
 * a horizontal split) or width (for a vertical one, when that ships); the
 * component fills the parent. Any host-specific layout plumbing (padding
 * overrides, scroll containers, grid-cell chrome) lives at the mount site,
 * never inside this component. See roadmap/tug-split-pane.md §13.
 *
 * ## [L11] is deliberately absent
 *
 * TugSplitPane is a layout primitive, not a control. Layout state lives
 * inside the component (the library's internal state and, eventually,
 * localStorage persistence) — there is no external responder to dispatch
 * to. Any size/collapse callbacks the component exposes are state-mirror
 * callbacks (the same category as Radix's `onOpenChange`), explicitly
 * permitted by the component authoring guide. TugSplitPane therefore does
 * not cite [L11] and does not call `useControlDispatch`.
 *
 * Laws: [L02] external state enters React through useSyncExternalStore,
 *       [L06] appearance via CSS, [L15] token-driven states,
 *       [L16] pairings declared, [L19] component authoring guide,
 *       [L20] token sovereignty
 */

import "./tug-split-pane.css";

import React from "react";
import {
  Group,
  type Layout,
  Panel,
  type PanelImperativeHandle,
  type PanelSize,
  Separator,
} from "react-resizable-panels";
import { GripHorizontal, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import { putSplitPaneLayout, readSplitPaneLayout } from "@/settings-api";
import { useTugBoxDisabled } from "./internal/tug-box-context";

// ---- Persistence ----

/**
 * Tugbank domain under which every TugSplitPane with a `storageKey` stores
 * its layout. The domain is shared; per-instance disambiguation happens in
 * the key (the caller's `storageKey`). Mirrors the "one domain per feature"
 * convention in `settings-api.ts`.
 */
const SPLIT_PANE_DOMAIN = "dev.tugtool.tugways.split-pane";

/**
 * Stable `subscribe` callback for `useSyncExternalStore`. Wires into the
 * shared TugbankClient's `onDomainChanged` feed and only fires `notify`
 * when the split-pane domain updates — other domains are filtered out so
 * unrelated tugbank traffic never triggers a split-pane re-render.
 *
 * Module-scoped so its identity is stable across every render of every
 * TugSplitPane instance (`useSyncExternalStore` re-subscribes whenever
 * `subscribe`'s identity changes; a fresh closure per render would thrash).
 */
function subscribeSplitPaneDomain(notify: () => void): () => void {
  const client = getTugbankClient();
  if (!client) return () => {};
  return client.onDomainChanged((domain) => {
    if (domain === SPLIT_PANE_DOMAIN) notify();
  });
}

// ---- Auto-size echo coordination ----

/**
 * React context shared between a `TugSplitPane` and its `TugSplitPanel`
 * children so that persistence (`onLayoutChanged` → `putSplitPaneLayout`)
 * can distinguish genuine user-drag layout changes from the transient
 * layout writes produced by `autoSize` panels.
 *
 * The value is a single ref whose integer count reflects the number of
 * in-flight `panel.resize()` echoes across all auto-size panels in the
 * group. `TugSplitPanel` increments before each resize; its
 * `handleResize` decrements when the library's async `onResize` echo
 * arrives; `TugSplitPane.handleLayoutChanged` skips persistence while
 * the count is positive so auto-size transients never reach storage.
 *
 * Why a ref instead of React state: persistence is checked in a
 * callback (`handleLayoutChanged`), not in a render; state would force
 * re-renders for a value consumed only by event handlers [L06][L07].
 */
const AutoSizeEchoContext = React.createContext<{
  countRef: React.MutableRefObject<number>;
} | null>(null);

// ---- Types ----

/**
 * TugSplitPane orientation. Named after the *dividing line* (matching
 * NSSplitView / VS Code convention), not the axis along which panels
 * are arranged. `horizontal` = horizontal sash, panels stacked
 * top-to-bottom; `vertical` = vertical sash, panels side-by-side.
 *
 * This is the inverse of `react-resizable-panels`' own `orientation`
 * value, which names the axis instead of the divider. The wrapper
 * inverts internally when calling the library — see the
 * "Orientation inversion" section of the module docstring.
 */
export type TugSplitPaneOrientation = "horizontal" | "vertical";

/**
 * Size specification for TugSplitPanel's defaultSize / minSize / maxSize.
 *
 * Accepts either a number or a string:
 * - **number** → pixels (e.g. `200` = 200px). Matches the library's v4
 *   convention (`react-resizable-panels.d.ts:177`).
 * - **string with unit suffix** → `"50%"`, `"200px"`, `"4rem"`, `"1.5em"`,
 *   `"30vh"`, `"20vw"`. Supported units: `%`, `px`, `em`, `rem`, `vh`, `vw`.
 * - **string without unit** → percent. `"50"` is equivalent to `"50%"`.
 *
 * Prefer explicit percentage strings (`"60%"`) for proportional layouts
 * so the intent is clear at the call site.
 */
export type TugSplitSize = number | string;

// ---------------------------------------------------------------------------
// TugSplitPane
// ---------------------------------------------------------------------------

/** TugSplitPane props. */
export interface TugSplitPaneProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "children"> {
  /**
   * Orientation of the dividing line between panels.
   * - `"horizontal"` (default): horizontal sash, panels stacked top-to-bottom.
   * - `"vertical"`: vertical sash, panels arranged side-by-side.
   *
   * Named after the dividing line, matching NSSplitView / VS Code
   * terminology — the inverse of the library's own convention, which
   * names the arrangement axis. The wrapper inverts internally.
   * @selector .tug-split-pane-horizontal | .tug-split-pane-vertical
   * @default "horizontal"
   */
  orientation?: TugSplitPaneOrientation;
  /**
   * Disables drag-to-resize on all sashes in this group. Cascades from an
   * enclosing TugBox via TugBoxContext — a disabled parent TugBox disables
   * every sash inside.
   * @selector [data-disabled="true"]
   * @default false
   */
  disabled?: boolean;
  /**
   * Whether to show the grip pill on each sash. Set to `false` to suppress
   * the decorative pill (the `.tug-split-sash-handle` + its `.tug-split-sash-grip`
   * icon) while keeping the sash line visible and fully draggable. Useful on
   * cards where the grip reads as too prominent for the content.
   *
   * Accessibility: the sash itself keeps its separator role, keyboard
   * affordance, and full hit area — only the visual pill is suppressed.
   * @selector [data-show-handle="false"]
   * @default true
   */
  showHandle?: boolean;
  /**
   * Persist the sash layout across reloads under this key in tugbank
   * (domain: `dev.tugtool.tugways.split-pane`). When set, the layout is
   * read on mount and re-saved on pointer release. Omit to run a
   * non-persistent split pane whose state lives only in the library.
   *
   * ⚠️ When set, every child TugSplitPanel MUST declare a stable `id` —
   * the stored layout is keyed by panel id, and `useId` fallbacks will
   * not round-trip across reloads reliably if the tree restructures.
   *
   * ⚠️ Nested TugSplitPane instances each need their own distinct
   * storageKey. Reusing one key across nested panes would collide in
   * tugbank.
   *
   * Implementation note: the value is read via `useSyncExternalStore`
   * hooked into the TugbankClient's `onDomainChanged` feed — the only
   * law-compliant way to get external state into React state [L02].
   */
  storageKey?: string;
  /** TugSplitPanel children. Each child must be a TugSplitPanel element. */
  children: React.ReactNode;
}

export const TugSplitPane = React.forwardRef<HTMLDivElement, TugSplitPaneProps>(
  function TugSplitPane(
    {
      orientation = "horizontal",
      disabled = false,
      showHandle = true,
      storageKey,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    // Merge with any ancestor TugBox's disabled cascade so a disabled outer
    // TugBox disables every sash in this split pane.
    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    // Persistence via tugbank. L02-compliant: external state enters React
    // exclusively through `useSyncExternalStore`. We never copy the stored
    // layout into `useState` or `useEffect` — the hook is the only bridge.
    //
    // Why this shape:
    //   - `subscribe` is module-scoped (see subscribeSplitPaneDomain) so its
    //     identity is stable across every render; useSyncExternalStore
    //     resubscribes whenever that identity changes and we don't want
    //     thrash.
    //   - `getSnapshot` closes over `storageKey` so it's memoized with that
    //     as the only dep. It reads from the TugbankClient cache directly;
    //     `readSplitPaneLayout` returns the cached entry's `.value`, which
    //     is a stable reference until tugbank broadcasts a fresh DEFAULTS
    //     frame for this domain. Stable-reference semantics are required by
    //     useSyncExternalStore — otherwise identical-value reads would
    //     trigger infinite re-renders.
    //   - The post-write echo (our PUT → server broadcasts → cache → notify
    //     → re-render) is benign: `defaultLayout` is a mount-time prop in
    //     v4, so any re-render with an identical-value layout is a no-op.
    const getSnapshot = React.useCallback((): Layout | null => {
      if (!storageKey) return null;
      const client = getTugbankClient();
      if (!client) return null;
      return readSplitPaneLayout(client, storageKey);
    }, [storageKey]);
    const storedLayout = React.useSyncExternalStore(
      subscribeSplitPaneDomain,
      getSnapshot,
    );

    // Shared counter for auto-size echo suppression. Each child
    // `TugSplitPanel` with `autoSize` increments before calling
    // `panel.resize()` and decrements in its `handleResize` when the
    // library's async echo arrives. `handleLayoutChanged` checks the
    // counter and skips persistence while the count is positive so
    // transient auto-size layouts never reach tugbank.
    const autoSizeEchoCountRef = React.useRef(0);
    const autoSizeEchoContextValue = React.useMemo(
      () => ({ countRef: autoSizeEchoCountRef }),
      [],
    );

    // Write path: `onLayoutChanged` fires after every layout change that
    // isn't an in-flight drag. That includes our imperative auto-size
    // `panel.resize()` calls, so we gate on the shared echo counter —
    // auto-size transients never persist; only genuine user-drag layout
    // changes reach tugbank.
    const handleLayoutChanged = React.useCallback(
      (layout: Layout) => {
        if (!storageKey) return;
        if (autoSizeEchoCountRef.current > 0) return;
        putSplitPaneLayout(storageKey, layout);
      },
      [storageKey],
    );

    // Pick the grip icon that reads visually along the sash direction.
    // A horizontal sash (horizontal dividing line) runs left-to-right,
    // so GripHorizontal's wide row of dots matches. A vertical sash
    // runs top-to-bottom, so GripVertical's vertical column matches.
    const GripIcon = orientation === "vertical" ? GripVertical : GripHorizontal;

    // Invert TugSplitPane's orientation to the library's convention.
    // See "Orientation inversion" in the module docstring.
    const libraryOrientation = orientation === "horizontal" ? "vertical" : "horizontal";

    // Interleave a Separator between each pair of consecutive children.
    // react-resizable-panels requires Separator elements to be *direct* DOM
    // children of Group — we can't wrap them in a fragment or another
    // element, and we can't delegate rendering to a helper component that
    // returns a fragment. Hence the explicit array build.
    const childArray = React.Children.toArray(children);
    const interleaved: React.ReactNode[] = [];
    childArray.forEach((child, i) => {
      if (i > 0) {
        interleaved.push(
          <Separator
            key={`tug-split-sash-${i}`}
            className={cn("tug-split-sash", `tug-split-sash-${orientation}`)}
            data-slot="tug-split-sash"
            disabled={effectiveDisabled}
          >
            {/* Handle pill wraps the grip icon and provides a
                badge-shaped visual affordance centered on the sash
                line. aria-hidden so screen readers skip the
                decoration — the sash's own separator role conveys
                purpose. The pill's background uses the sash color one
                step ahead of the line (rest line + focus pill, focus
                line + hover pill, etc.), so the pill reads as a
                distinct "grabbable node" without needing separate
                handle tokens. GripIcon swaps per orientation. */}
            <span className="tug-split-sash-handle">
              <GripIcon
                className="tug-split-sash-grip"
                aria-hidden="true"
                strokeWidth={2}
              />
            </span>
          </Separator>,
        );
      }
      interleaved.push(child);
    });

    return (
      <AutoSizeEchoContext.Provider value={autoSizeEchoContextValue}>
        <Group
          orientation={libraryOrientation}
          defaultLayout={storedLayout ?? undefined}
          onLayoutChanged={storageKey ? handleLayoutChanged : undefined}
          elementRef={ref as React.Ref<HTMLDivElement | null>}
          className={cn("tug-split-pane", `tug-split-pane-${orientation}`, className)}
          data-slot="tug-split-pane"
          data-disabled={effectiveDisabled || undefined}
          data-show-handle={showHandle ? undefined : "false"}
          {...rest}
        >
          {interleaved}
        </Group>
      </AutoSizeEchoContext.Provider>
    );
  },
);

// ---------------------------------------------------------------------------
// TugSplitPanel
// ---------------------------------------------------------------------------

/** TugSplitPanel props. */
export interface TugSplitPanelProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "children"> {
  /**
   * Initial size. Default: auto-assigned equally across siblings by the
   * library. See {@link TugSplitSize} for accepted value formats.
   */
  defaultSize?: TugSplitSize;
  /**
   * Minimum size. Enforced during drag (the sash stops advancing when a
   * panel would go below `minSize`) and on container resize (the library
   * redistributes space while respecting every panel's min). Default: 0.
   * See {@link TugSplitSize} for accepted value formats.
   */
  minSize?: TugSplitSize;
  /**
   * Maximum size. Enforced during drag and on container resize, mirroring
   * `minSize`. Default: 100% (no upper clamp). See {@link TugSplitSize}
   * for accepted value formats.
   */
  maxSize?: TugSplitSize;
  /**
   * Panel can snap closed when the user drags its neighboring sash past
   * this panel's `minSize`. Default: false.
   *
   * When `true`, crossing `minSize` during drag collapses the panel to
   * `collapsedSize` (default 0). Dragging back out of the collapsed
   * region reopens the panel at its `minSize`. This matches macOS /
   * VS Code split behavior.
   *
   * ℹ️ Note: react-resizable-panels v4 triggers snap-to-close at the
   * `minSize` boundary itself — there is no separately-tunable
   * "threshold px past min" value. A future version of the library
   * (or a patch) could add that knob; for now we take what the library
   * gives us.
   */
  collapsible?: boolean;
  /**
   * Size this panel takes when collapsed. Default: 0. Only meaningful
   * when `collapsible` is true. See {@link TugSplitSize} for accepted
   * value formats.
   */
  collapsedSize?: TugSplitSize;
  /**
   * Fires when the panel's collapsed state toggles. Called with `true`
   * when the panel snaps closed and `false` when it reopens.
   *
   * State-mirror callback (same category as Radix's `onOpenChange`),
   * not a chain-dispatched control action — see the "[L11] is
   * deliberately absent" note in the module docstring.
   */
  onCollapsedChange?: (collapsed: boolean) => void;
  /**
   * Observe a scroll-source element inside the panel and grow the panel
   * toward `maxSize` when the source's content exceeds its current box;
   * snap instantly back to the user-set anchor on the explicit empty
   * signal (`data-empty="true"` on the source). When `true`, the panel
   * installs a `MutationObserver` + `ResizeObserver` and queries for its
   * source via `[data-tug-auto-size-scroll-source]` inside
   * `panelEl.firstElementChild`. If no source is tagged in the subtree,
   * `autoSize` is inert — no observers run, no sizing side-effects.
   *
   * Sizing formula (applied in `recompute()`):
   *   overflow = source.scrollHeight > source.clientHeight
   *   chrome   = wrapperEl.clientHeight - source.offsetHeight
   *   target   = empty    → userSetSize
   *              overflow → max(userSetSize, source.scrollHeight + chrome)
   *              else     → currentPx  (stable; no shrink mid-edit)
   *
   * `userSetSize` is the last user-drag anchor, captured via the
   * library's `onResize` whenever the call didn't originate from this
   * panel's own auto-size path. There is no transition on the panel's
   * size — every change (grow, user drag, snap-back) is applied instantly
   * via the library's imperative `resize()`. Animation would have to
   * couple to the library's internal RO-driven `onResize` sampling, which
   * fights both drag responsiveness and the echo-detection we use to
   * distinguish our own writes from user drags.
   *
   * Currently supports the horizontal-sash orientation only (the natural
   * signal is block-axis scrollHeight). The panel does not query its
   * parent group's orientation — vertical-split auto-sizing would read
   * `scrollWidth` and filter on `blockSize`; add when a caller needs it.
   * @default false
   */
  autoSize?: boolean;
  /** Panel content. */
  children?: React.ReactNode;
}

export const TugSplitPanel = React.forwardRef<HTMLDivElement, TugSplitPanelProps>(
  function TugSplitPanel(
    {
      defaultSize,
      minSize,
      maxSize,
      collapsible,
      collapsedSize,
      onCollapsedChange,
      autoSize = false,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    // Internal handle on the library's Panel imperative API. Used to
    // query `isCollapsed()` from inside `onResize` (for
    // `onCollapsedChange` synthesis — v4 does not expose a collapse-
    // change callback of its own) and to call `resize()` from the
    // auto-size observer path.
    const panelRef = React.useRef<PanelImperativeHandle | null>(null);
    // Ref to the outer `[data-panel]` div the library renders. Composed
    // with any caller-supplied `ref` via `setPanelElement` below. The
    // auto-size observer path installs a ResizeObserver on this element
    // to catch container rewraps.
    const panelElementRef = React.useRef<HTMLDivElement | null>(null);
    // Last observed collapsed state. A ref (not useState) so reading and
    // writing it from the onResize callback never triggers a re-render:
    // appearance changes go through CSS / DOM, not React state [L06].
    const wasCollapsedRef = React.useRef(false);

    // Shared auto-size echo counter from the enclosing `TugSplitPane`.
    // Using the context ref means both this panel's `handleResize`
    // gating and the pane's `handleLayoutChanged` persistence gate read
    // from the same source — every increment/decrement is visible to
    // both. A fallback local ref keeps the component usable outside a
    // `TugSplitPane` (tests, isolated mounts); in that configuration
    // there is no persistence to gate so the duplication is harmless.
    const autoSizeEchoContext = React.useContext(AutoSizeEchoContext);
    const localAutoSizeEchoCountRef = React.useRef(0);
    const autoSizeEchoCountRef =
      autoSizeEchoContext?.countRef ?? localAutoSizeEchoCountRef;

    // --- Auto-size refs [L07] -----------------------------------------
    // `userSetSizeRef`: last anchor size (px) the user dragged to, or
    //     the library's resolved initial size. Updated in `handleResize`
    //     whenever the fire is not the echo of our own `panel.resize()`.
    // `lastWidthRef`: the outer `[data-panel]` div's block-size changes
    //     on every flex-grow write; the width filter drops those.
    //     A real inline-size change (group rewrap) still triggers
    //     recompute.
    const userSetSizeRef = React.useRef<number>(0);
    const lastWidthRef = React.useRef(0);

    // Compose the caller's `ref` with our internal `panelElementRef`.
    // A single callback fans out to both; identity is stable unless the
    // caller passes a new ref each render (rare).
    const setPanelElement = React.useCallback(
      (el: HTMLDivElement | null) => {
        panelElementRef.current = el;
        if (typeof ref === "function") {
          ref(el);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }
      },
      [ref],
    );

    // Stable handler so identity only changes when the user's callback
    // does. Reads `isCollapsed()` from the imperative handle, compares to
    // the last observed value, and fires the change callback on flip.
    // Also seeds the auto-size user-drag anchor: whenever onResize fires
    // from outside our own `panel.resize()` call, we treat it as a user
    // drag (or the library's initial layout resolution) and capture the
    // new anchor in px. Setting `--auto-size-transition-duration` to 0ms
    // here kills any stale shrink-transition so the library's own drag
    // updates never chase an interpolation.
    const handleResize = React.useCallback(
      (size: PanelSize, _id: string | number | undefined, _prev: PanelSize | undefined) => {
        if (autoSize) {
          if (autoSizeEchoCountRef.current > 0) {
            // Echo of our own `panel.resize()`. Consume and skip.
            // We cannot compare against an expected size because
            // `panel.getSize()` reads DOM offsetHeight and React
            // hasn't committed the new flex-grow by the time
            // `panel.resize()` returns; the library's async onResize
            // later fires with the real post-commit size. Instead we
            // count outstanding echoes: one panel.resize() → one RO
            // fire from the library → one consume.
            autoSizeEchoCountRef.current -= 1;
          } else {
            // User drag, or the library's initial layout resolution.
            userSetSizeRef.current = size.inPixels;
          }
        }
        const panel = panelRef.current;
        if (!panel || !onCollapsedChange) return;
        const isCollapsed = panel.isCollapsed();
        if (isCollapsed !== wasCollapsedRef.current) {
          wasCollapsedRef.current = isCollapsed;
          onCollapsedChange(isCollapsed);
        }
      },
      [autoSize, autoSizeEchoCountRef, onCollapsedChange],
    );

    // Auto-size: observe a scroll-source element inside the panel and
    // grow / snap-back the panel imperatively in response to natural-
    // content-height changes. Every change is instant — no CSS
    // transition, no TugAnimator, no RAF. Animation would have to couple
    // to the library's internal RO-driven `onResize` sampling, which
    // fights both drag responsiveness and the echo-detection used to
    // distinguish our own writes from user drags.
    //
    // Contract: the panel looks up its scroll source via
    // `[data-tug-auto-size-scroll-source]` inside its inner content
    // wrapper (`panelEl.firstElementChild`). The match is the element
    // whose `scrollHeight` / `offsetHeight` drive the formula below —
    // typically an overflow:auto editor. If nothing is tagged, `autoSize`
    // is inert (no observers installed, no sizing side-effects).
    //
    // Sizing formula:
    //   overflow = source.scrollHeight > source.clientHeight
    //   chrome   = wrapperEl.clientHeight - source.offsetHeight
    //   target   = empty    → userSetSize   (snap back to anchor)
    //              overflow → max(userSetSize, source.scrollHeight + chrome)
    //              else     → currentPx     (stable; don't shrink mid-edit)
    //
    // Why the `else → currentPx` branch. `scrollHeight` on an
    // `overflow:auto` element clamps to `clientHeight` when content
    // fits, so we cannot directly distinguish "content exactly fills"
    // from "content is smaller than allocation". Shrinking on the fit
    // condition would ping-pong (grow-to-fit, fits → shrink-to-anchor,
    // content overflows new smaller box → grow-to-fit, repeat). Instead
    // we stay put while the user edits, and snap only on the explicit
    // empty signal (`data-empty="true"` — the same attribute the editor
    // engine already writes for its placeholder state).
    //
    // Why echo loops stay out. `panel.resize()` mutates `flex-grow` on
    // the outer `[data-panel]` div; the RO on that same element
    // filters to inline-size changes only, so our own block-size writes
    // do not re-fire. MO observes the inner wrapper's subtree and does
    // not see the outer-div writes either.
    //
    // Laws: [L03] install in useLayoutEffect, [L06] no appearance
    //       state in React (everything goes through imperative DOM /
    //       library calls), [L07] state in refs, [L13] instant writes,
    //       no RAF, no CSS transition, [L22] DOM → DOM, no React state
    //       round-trip, [L23] `panel.resize()` preserves user-visible
    //       state.
    React.useLayoutEffect(() => {
      if (!autoSize) return;
      const panelEl = panelElementRef.current;
      if (!panelEl) return;
      const wrapperEl = panelEl.firstElementChild as HTMLElement | null;
      if (!wrapperEl) return;

      const findSource = (): HTMLElement | null =>
        wrapperEl.querySelector<HTMLElement>(
          "[data-tug-auto-size-scroll-source]",
        );

      const recompute = () => {
        const panel = panelRef.current;
        if (!panel) return;
        const sourceEl = findSource();
        if (!sourceEl) return;

        const overflow = sourceEl.scrollHeight > sourceEl.clientHeight;
        const empty = sourceEl.getAttribute("data-empty") === "true";
        const chrome = wrapperEl.clientHeight - sourceEl.offsetHeight;
        const currentPx = panel.getSize().inPixels;
        const userSet = userSetSizeRef.current;

        let target: number;
        if (empty) {
          target = userSet;
        } else if (overflow) {
          target = Math.max(userSet, sourceEl.scrollHeight + chrome);
        } else {
          target = currentPx;
        }

        if (Math.abs(target - currentPx) < 1) return;

        // Increment BEFORE the resize so the library's async `onResize`
        // echo (and the pane's `onLayoutChanged` persistence hook) find
        // the counter already positive, regardless of microtask
        // ordering. One panel.resize() that actually changes the layout
        // produces one library-RO fire; handleResize decrements.
        // Persistence skips while the counter is positive so the
        // transient auto-size size never reaches tugbank.
        autoSizeEchoCountRef.current += 1;
        panel.resize(target);
      };

      // Subtree mutations: typing, paste, child appends, `data-empty`
      // toggles from the editor engine, `style`/`class` writes that
      // re-resolve layout (e.g., EditorSettingsStore writing
      // --tug-font-size-editor on an ancestor).
      const mo = new MutationObserver(recompute);
      mo.observe(wrapperEl, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["style", "class", "data-empty"],
      });

      // Container rewrap signal: inline-size changes on the outer
      // `[data-panel]` div. We do NOT observe the scroll source because
      // its `overflow-y:auto` toggles a vertical scrollbar whenever
      // content crosses the fit/overflow threshold, which flips the
      // source's inline-size back and forth — exactly the shape that
      // produces "ResizeObserver loop completed with undelivered
      // notifications." The panel's outer div has no overflow and no
      // scrollbar; its inline-size only changes on a real group resize.
      // Block-size changes from our own writes fail the width match and
      // bail out, so there is no echo loop here either.
      const ro = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const inlineSize =
          entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        if (inlineSize === lastWidthRef.current) return;
        lastWidthRef.current = inlineSize;
        recompute();
      });
      ro.observe(panelEl);

      return () => {
        mo.disconnect();
        ro.disconnect();
      };
    }, [autoSize]);

    return (
      <Panel
        defaultSize={defaultSize}
        minSize={minSize}
        maxSize={maxSize}
        collapsible={collapsible}
        collapsedSize={collapsedSize}
        panelRef={panelRef}
        onResize={autoSize || onCollapsedChange ? handleResize : undefined}
        elementRef={setPanelElement}
        className={cn("tug-split-panel", className)}
        data-slot="tug-split-panel"
        {...rest}
      >
        {children}
      </Panel>
    );
  },
);
