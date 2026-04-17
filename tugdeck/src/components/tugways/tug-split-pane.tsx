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
 * ## Persistence model
 *
 * Persistence is keyed off explicit user interaction with a sash, not off
 * the library's layout-change notifications. A document-level pointerdown
 * listener (capture phase) sets a "user drag active" ref when the target
 * is a sash whose parent Group element is this pane's own root; the
 * matching pointerup reads the current layout via the library's
 * `GroupImperativeHandle.getLayout()` and writes it to tugbank under
 * `storageKey`. The library's `onLayoutChanged` callback is intentionally
 * NOT used for persistence: it also fires for imperative `panel.resize()`
 * calls (e.g., the autoSize path in TugSplitPanel), and mixing the two
 * sources makes transient auto-size values contaminate user-anchored
 * storage. Sourcing from pointerup keeps the two paths cleanly separated.
 *
 * ## Auto-size coordination via `UserDragContext`
 *
 * A React context ref exposes the "user drag active" flag to descendant
 * TugSplitPanel instances. Panels with `autoSize` consult this ref in
 * their `onResize` handler: only fires that land inside a true
 * user-drag window update the panel's userSet anchor; all other fires
 * (the library's initial layout resolution, auto-size-resize echoes,
 * window-size rewraps) are either seeded once or ignored. This is
 * pointer-event-based rather than counter-based so there is no window
 * in which a missed decrement could leak and permanently mask user
 * drags.
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
 *       [L06] appearance via CSS, [L07] event handlers read refs,
 *       [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide, [L20] token sovereignty,
 *       [L22] DOM observations drive DOM writes directly.
 */

import "./tug-split-pane.css";

import React from "react";
import {
  Group,
  type GroupImperativeHandle,
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

// ---- User-drag coordination ----

/**
 * React context exposing a shared `userDragActiveRef` from `TugSplitPane`
 * to descendant `TugSplitPanel` instances. The flag is `true` from the
 * pointerdown that begins a sash drag through the matching pointerup;
 * it is `false` during the library's own layout resolutions (initial
 * mount, window rewrap) and during autoSize-induced `panel.resize()`
 * echoes.
 *
 * TugSplitPanel's autoSize path uses this to decide when an `onResize`
 * fire should update its user-anchor percentage: only true-during-drag
 * fires update the anchor. The first non-drag fire seeds the initial
 * anchor from the library's resolved default; subsequent non-drag fires
 * (auto-size echoes, window resizes that preserve percentage) leave it
 * alone.
 *
 * Why a ref instead of React state: the flag is consumed by event
 * handlers (`onResize`, pointerup), not by renders; state would force
 * re-renders for a value no render reads [L06][L07].
 */
const UserDragContext = React.createContext<{
  activeRef: React.MutableRefObject<boolean>;
  /**
   * Bumped by `TugSplitPane` whenever it applies a layout imperatively
   * (via `groupRef.setLayout()`) in response to a post-mount storedLayout
   * arrival. `TugSplitPanel.handleResize` compares this against its own
   * `lastSeenEpochRef` and re-seeds the user-anchor when they differ —
   * this is how tugbank-delivered layouts update the anchor even when
   * the cache miss forced the library to start from `defaultSize`.
   */
  reseedEpochRef: React.MutableRefObject<number>;
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

    // Group's DOM element and imperative handle. The element ref is
    // composed with any caller-supplied `ref` via `setGroupElement`;
    // `groupRef` is only used internally here (to read the layout at
    // pointerup) so it doesn't need composition.
    const groupElRef = React.useRef<HTMLDivElement | null>(null);
    const groupRef = React.useRef<GroupImperativeHandle | null>(null);
    const setGroupElement = React.useCallback(
      (el: HTMLDivElement | null) => {
        groupElRef.current = el;
        if (typeof ref === "function") {
          ref(el);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }
      },
      [ref],
    );

    // `userDragActiveRef` is the single source of truth for "is the user
    // currently dragging a sash in THIS group?" — flipped from the
    // document-level pointer listeners below and read by descendant
    // TugSplitPanel instances through `UserDragContext`.
    const userDragActiveRef = React.useRef(false);
    // `reseedEpochRef` bumps whenever we apply a post-mount stored
    // layout imperatively; descendant TugSplitPanels use this to
    // re-seed their user-anchor from the new layout.
    const reseedEpochRef = React.useRef(0);
    const userDragContextValue = React.useMemo(
      () => ({ activeRef: userDragActiveRef, reseedEpochRef }),
      [],
    );

    // Apply storedLayout imperatively ONCE, to cover the mount race:
    // the library's `defaultLayout` prop is a mount-time input only,
    // and tugbank's cache may still be loading via WebSocket when the
    // component mounts. If the cache was cold at mount, `storedLayout`
    // starts null and the library falls back to `defaultSize`; when the
    // cache fills, we call `groupRef.setLayout()` to snap to the real
    // stored value and bump the reseed epoch so descendant auto-size
    // panels update their anchor.
    //
    // Guarded to fire at most once per mount AND never while the user
    // is in the middle of a sash drag. Applying a stored layout mid-
    // drag would jump the pane out from under the user — typically
    // perceived as the sash "going in the opposite direction" — because
    // the restored layout can be very different from the live drag
    // position. If a drag is in progress when we try to apply, we leave
    // the flag unset so the next storedLayout transition (after drag
    // release) gets another chance; by that point, the user's own PUT
    // will have round-tripped through the cache and `setLayout(current)`
    // becomes a no-op.
    const initialApplyDoneRef = React.useRef(false);
    React.useEffect(() => {
      if (initialApplyDoneRef.current) return;
      if (!storedLayout) return;
      if (userDragActiveRef.current) return;
      const group = groupRef.current;
      if (!group) return;
      initialApplyDoneRef.current = true;
      reseedEpochRef.current += 1;
      group.setLayout(storedLayout);
    }, [storedLayout]);

    // Pointer-event-based drag tracking. We listen at document/capture
    // so pointerup is never missed when the cursor strays off the group
    // mid-drag, and so we see the events before the library's own
    // handlers (also registered at capture). Drag-start is only
    // attributed to this group if the sash's direct parent element is
    // our root — nested TugSplitPane instances inside a panel have
    // their own Group div, so their sashes aren't our direct children.
    //
    // Persistence lives here (not in `onLayoutChanged`): on pointerup,
    // if this group owned the drag and `storageKey` is set, read the
    // current layout via the group's imperative handle and PUT it to
    // tugbank. This keeps auto-size transients (which mutate the layout
    // via the library's imperative API but never pass through a
    // pointerup) completely out of the persistence path.
    React.useEffect(() => {
      const onPointerDown = (e: PointerEvent) => {
        // Do NOT check e.defaultPrevented — the library's own capture-
        // phase pointerdown handler calls `preventDefault()` whenever
        // the click lands on a sash (to suppress native text selection
        // during the drag), which would otherwise neuter this listener
        // entirely and `userDragActiveRef` would never flip to true.
        if (e.pointerType === "mouse" && e.button > 0) return;
        const groupEl = groupElRef.current;
        if (!groupEl) return;
        const target = e.target as Element | null;
        const sash = target?.closest?.(".tug-split-sash") ?? null;
        if (sash && sash.parentElement === groupEl) {
          userDragActiveRef.current = true;
        }
      };
      const onPointerEnd = () => {
        if (!userDragActiveRef.current) return;
        userDragActiveRef.current = false;
        if (storageKey && groupRef.current) {
          const layout = groupRef.current.getLayout();
          putSplitPaneLayout(storageKey, layout);
        }
      };
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("pointerup", onPointerEnd, true);
      document.addEventListener("pointercancel", onPointerEnd, true);
      return () => {
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("pointerup", onPointerEnd, true);
        document.removeEventListener("pointercancel", onPointerEnd, true);
      };
    }, [storageKey]);

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
      <UserDragContext.Provider value={userDragContextValue}>
        <Group
          orientation={libraryOrientation}
          defaultLayout={storedLayout ?? undefined}
          elementRef={setGroupElement}
          groupRef={groupRef}
          className={cn("tug-split-pane", `tug-split-pane-${orientation}`, className)}
          data-slot="tug-split-pane"
          data-disabled={effectiveDisabled || undefined}
          data-show-handle={showHandle ? undefined : "false"}
          {...rest}
        >
          {interleaved}
        </Group>
      </UserDragContext.Provider>
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
   * ## Scroll-source contract
   *
   * Any descendant element marked with `data-tug-auto-size-scroll-source`
   * is treated as the authoritative natural-content-height signal. The
   * tagged element MUST use `overflow-y: auto` (or equivalent) so its
   * `scrollHeight` reports content intrinsic height when overflowing and
   * its `clientHeight` reports the allocated box. `TugPromptInput`'s
   * maximized editor opts into this by default. The `data-empty="true"`
   * attribute on the same element acts as the explicit snap-back signal
   * — when present, the panel snaps to the user-anchor regardless of
   * scrollHeight state.
   *
   * ## Sizing formula (applied in `recompute()`)
   *
   *   overflow = source.scrollHeight > source.clientHeight
   *   chrome   = wrapperEl.clientHeight - source.offsetHeight
   *   target   = empty    → userAnchor
   *              overflow → max(userAnchor, source.scrollHeight + chrome)
   *              else     → currentPx   (stable; no shrink mid-edit)
   *
   * The user anchor is stored as a percentage of the group and
   * maintained by `handleResize` with a seed-on-first-fire policy:
   * the initial library-resolved layout seeds the anchor; after that,
   * only `onResize` fires that land inside a user-drag window (tracked
   * via document-level pointer listeners in the parent `TugSplitPane`)
   * update the anchor. AutoSize-induced resize echoes and window
   * rewraps leave the anchor alone.
   *
   * ## No animation
   *
   * Every size change (grow, user drag, snap-back) is applied instantly
   * via the library's imperative `resize()`. A CSS transition on
   * `flex-grow` would fight the library's internal RO-driven `onResize`
   * sampling (which measures `offsetHeight` on every frame while the
   * transition interpolates) and make drag feel laggy; a programmatic
   * animation (TugAnimator) would have the same coupling problem.
   *
   * Currently supports the horizontal-sash orientation only (the
   * natural signal is block-axis scrollHeight). The panel does not
   * query its parent group's orientation — vertical-split auto-sizing
   * would read `scrollWidth` and filter on `blockSize`; add when a
   * caller needs it.
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

    // Shared state from the enclosing `TugSplitPane` via `UserDragContext`.
    // Fallback local refs keep the component usable outside a
    // `TugSplitPane` (tests, isolated mounts); in that configuration
    // no drag can originate so the flag stays false, and no epoch
    // bumps happen so the panel behaves like a fresh-mount-only
    // seeded panel.
    const userDragContext = React.useContext(UserDragContext);
    const localUserDragActiveRef = React.useRef(false);
    const localReseedEpochRef = React.useRef(0);
    const userDragActiveRef =
      userDragContext?.activeRef ?? localUserDragActiveRef;
    const reseedEpochRef =
      userDragContext?.reseedEpochRef ?? localReseedEpochRef;

    // --- Auto-size refs [L07] -----------------------------------------
    // `userSetPctRef`: user's anchored size as a percentage (0..100) of
    //     the group. Stored as a percentage so window rewraps do not
    //     invalidate it — the library itself already uses percentage
    //     as the stable layout unit. Converted to pixels on demand
    //     inside `recompute` using the current group offsetHeight.
    // `userSetSeededRef`: one-shot gate for the very first `onResize`
    //     fire at mount so we can seed `userSetPctRef` from the
    //     library's resolved initial layout.
    // `lastSeenReseedEpochRef`: last epoch this panel consumed.
    //     Diverges from the shared `reseedEpochRef` when the enclosing
    //     `TugSplitPane` applies a post-mount stored layout; the next
    //     `onResize` fire re-seeds the anchor from the new layout.
    // `lastWidthRef`: the outer `[data-panel]` div's block-size
    //     changes on every flex-grow write; the width filter drops
    //     those. A real inline-size change (group rewrap) still
    //     triggers recompute.
    const userSetPctRef = React.useRef<number>(0);
    const userSetSeededRef = React.useRef(false);
    const lastSeenReseedEpochRef = React.useRef(0);
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
    // does. Reads `isCollapsed()` from the imperative handle, compares
    // to the last observed value, and fires the change callback on
    // flip. Also drives the auto-size anchor:
    //
    //  - First fire (seed): capture `asPercentage` as the initial
    //    anchor. This is the library's resolved default (or whatever
    //    layout it loaded from `defaultLayout`).
    //  - Reseed (epoch diverged): TugSplitPane applied a post-mount
    //    stored layout imperatively; capture the new percentage.
    //  - Subsequent fires while the user is dragging a sash in this
    //    group: update the anchor.
    //  - All other fires (auto-size echoes from our own panel.resize()
    //    calls, window rewraps that preserve percentage): leave the
    //    anchor alone.
    //
    // Using the live `userDragActiveRef` flag as the gate avoids the
    // counter/expected-size schemes that break on library coalescing
    // or React scheduler reorderings.
    const handleResize = React.useCallback(
      (size: PanelSize, _id: string | number | undefined, _prev: PanelSize | undefined) => {
        if (autoSize) {
          const epoch = reseedEpochRef.current;
          const epochChanged = epoch !== lastSeenReseedEpochRef.current;
          if (!userSetSeededRef.current || epochChanged) {
            userSetPctRef.current = size.asPercentage;
            userSetSeededRef.current = true;
            lastSeenReseedEpochRef.current = epoch;
          } else if (userDragActiveRef.current) {
            userSetPctRef.current = size.asPercentage;
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
      [autoSize, userDragActiveRef, reseedEpochRef, onCollapsedChange],
    );

    // Auto-size: observe a scroll-source element inside the panel and
    // grow / snap-back the panel imperatively in response to natural-
    // content-height changes. See the `autoSize` prop JSDoc for the
    // full contract (scroll-source attribute, sizing formula,
    // no-animation rationale).
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
        if (!userSetSeededRef.current) return; // anchor not seeded yet
        const sourceEl = findSource();
        if (!sourceEl) return;

        // All measurements read from the DOM in the same pass so they
        // are consistent with each other. Crucially, the user-anchor in
        // pixels is derived from the *group element's* offsetHeight —
        // not from `panel.getSize().asPercentage`. The library updates
        // its store synchronously inside `panel.resize()` but React
        // hasn't committed the new flex-grow to the DOM yet; mixing
        // store-derived percentage with DOM-derived pixels produces
        // bogus targets mid-commit (pane jumps). `groupEl.offsetHeight`
        // stays stable across our resize calls because panel resizes
        // redistribute space inside the group without changing the
        // group's own dimensions.
        const overflow = sourceEl.scrollHeight > sourceEl.clientHeight;
        const empty = sourceEl.getAttribute("data-empty") === "true";
        const chrome = wrapperEl.clientHeight - sourceEl.offsetHeight;
        const currentPx = panelEl.offsetHeight;
        const groupEl = panelEl.parentElement;
        const groupSize = groupEl ? groupEl.offsetHeight : 0;
        const userSetPx =
          groupSize > 0 ? (userSetPctRef.current / 100) * groupSize : 0;

        let target: number;
        if (empty) {
          target = userSetPx;
        } else if (overflow) {
          target = Math.max(userSetPx, sourceEl.scrollHeight + chrome);
        } else {
          target = currentPx;
        }

        if (Math.abs(target - currentPx) < 1) return;

        // No echo-counter handshake needed: `handleResize` gates anchor
        // updates on `userDragActiveRef`, which is false during this
        // call (we're reacting to a content mutation, not a sash drag).
        // The library's async onResize fire from this resize will land
        // with the flag still false and be ignored by the anchor logic.
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
