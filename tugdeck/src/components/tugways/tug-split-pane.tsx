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
 * becomes the library's `"vertical"` in the call below.
 *
 * ## Host-agnostic contract
 *
 * TugSplitPane has zero knowledge of any particular mount site. Its
 * contract is the standard flexbox one: the parent must have a concrete
 * height (for a horizontal split) or width (for a vertical one); the
 * component fills the parent. Any host-specific layout plumbing lives at
 * the mount site, never inside this component.
 *
 * ## Persistence model
 *
 * When `storageKey` is set, the Group's `onLayoutChanged` callback writes
 * the layout to tugbank under the key. A single sync flag (shared via
 * `TugSplitPaneWriteContext`) distinguishes consumer-driven imperative
 * writes (via `TugSplitPanelHandle.requestSize`) from user drags: the
 * flag is set around `panel.resize()` calls and checked in
 * `onLayoutChanged`. The library fires `onLayoutChanged` synchronously
 * from its store subscription, so the flag's window reliably covers the
 * persistence decision.
 *
 * The stored layout is wired into the library's `defaultLayout` prop via
 * `useSyncExternalStore` + tugbank's `onDomainChanged` feed. This is the
 * only path into React state [L02]. `main.tsx` awaits `tugbankClient.ready()`
 * before mounting React, so the cache is guaranteed warm at mount and
 * `defaultLayout` alone is sufficient to restore.
 *
 * ## Content-driven sizing is a consumer concern
 *
 * This primitive does not observe content to grow/shrink panels. Consumers
 * that want content-driven sizing wire up their own observers and call
 * `panelRef.current.requestSize(px)`. The `useContentDrivenPanelSize`
 * hook (sibling file) covers the common scroll-source case.
 *
 * Laws: [L02] external state enters React through useSyncExternalStore,
 *       [L06] appearance via CSS, [L07] event handlers read refs,
 *       [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide, [L20] token sovereignty.
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

const SPLIT_PANE_DOMAIN = "dev.tugtool.tugways.split-pane";

function subscribeSplitPaneDomain(notify: () => void): () => void {
  const client = getTugbankClient();
  if (!client) return () => {};
  return client.onDomainChanged((domain) => {
    if (domain === SPLIT_PANE_DOMAIN) notify();
  });
}

// ---- Write coordination ----

/**
 * Context exposing the two-path coordination primitives from
 * `TugSplitPane` to its descendant `TugSplitPanel` instances.
 *
 * The split-pane has TWO distinct concepts that must never be
 * conflated:
 *
 * 1. **User size** — the percentage the user set by dragging. Persisted
 *    in tugbank. Written only by the user-drag path
 *    (`onLayoutChanged` with sync flag clear). Read via
 *    `getUserSize(panelId)`.
 *
 * 2. **Transient size** — whatever the library is currently displaying.
 *    Written by content-driven auto-resize via
 *    `TugSplitPanelHandle.setTransientSize`. Never persisted. Never
 *    modifies the user size.
 *
 * The sync flag gates the two paths so they never cross:
 * - `setTransientSize` and `restoreUserSize` call `panel.resize()` with
 *   the flag set → the user-drag path bails out, so no userSize update
 *   and no tugbank write happens.
 * - User drag (library pointer handling) fires `onLayoutChanged` with
 *   the flag clear → userSize is updated and tugbank is written.
 *
 * No listener machinery, no echo detection. The flag is set only inside
 * the synchronous window of a `panel.resize()` call; the library's
 * synchronous `onLayoutChanged` dispatch happens inside that window.
 */
interface TugSplitPaneWriteContextValue {
  syncFlagRef: React.MutableRefObject<boolean>;
  /**
   * The user's persisted size for a given panel, as a percentage
   * (0..100). Returns 0 when the panel has no stored user size (e.g.
   * the pane has no `storageKey`, or the id is unknown).
   */
  getUserSize(panelId: string | number): number;
}
const TugSplitPaneWriteContext =
  React.createContext<TugSplitPaneWriteContextValue | null>(null);

// Stable fallback for `getUserSize` when a TugSplitPanel is mounted
// outside a TugSplitPane (tests, isolated harnesses). Module-scoped so
// its identity never changes — keeps `useImperativeHandle` stable
// across renders in the standalone case.
const FALLBACK_GET_USER_SIZE = (): number => 0;

// ---- Types ----

/**
 * TugSplitPane orientation. Named after the *dividing line* (matching
 * NSSplitView / VS Code convention), not the axis along which panels
 * are arranged. `horizontal` = horizontal sash, panels stacked
 * top-to-bottom; `vertical` = vertical sash, panels side-by-side.
 *
 * This is the inverse of `react-resizable-panels`' own `orientation`
 * value, which names the axis instead of the divider. The wrapper
 * inverts internally when calling the library.
 */
export type TugSplitPaneOrientation = "horizontal" | "vertical";

/**
 * Size specification for TugSplitPanel's defaultSize / minSize / maxSize.
 *
 * Accepts either a number or a string:
 * - **number** → pixels (e.g. `200` = 200px). Matches the library's v4
 *   convention.
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
   * @selector .tug-split-pane-horizontal | .tug-split-pane-vertical
   * @default "horizontal"
   */
  orientation?: TugSplitPaneOrientation;
  /**
   * Disables drag-to-resize on all sashes in this group. Cascades from an
   * enclosing TugBox via TugBoxContext.
   * @selector [data-disabled="true"]
   * @default false
   */
  disabled?: boolean;
  /**
   * Whether to show the grip pill on each sash. Set to `false` to suppress
   * the decorative pill while keeping the sash line visible and fully
   * draggable.
   * @selector [data-show-handle="false"]
   * @default true
   */
  showHandle?: boolean;
  /**
   * Persist the sash layout across reloads under this key in tugbank
   * (domain: `dev.tugtool.tugways.split-pane`). When set, the layout is
   * read on mount via `defaultLayout` and re-saved on layout changes
   * that originate from user drags (not consumer imperative writes).
   *
   * ⚠️ When set, every child TugSplitPanel MUST declare a stable `id` —
   * the stored layout is keyed by panel id.
   *
   * ⚠️ Nested TugSplitPane instances each need their own distinct
   * storageKey. Reusing one key across nested panes would collide.
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
    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    // [L02] External state enters React exclusively through
    // `useSyncExternalStore`. `main.tsx` awaits `tugbankClient.ready()`
    // before mount, so the cache is warm and the first snapshot already
    // reflects the stored layout.
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

    // Sync flag shared with descendant panels via context. Descendants
    // set it `true` around `panel.resize()` calls from
    // `setTransientSize` / `restoreUserSize`; our `onLayoutChanged`
    // handler checks it to decide which path to take.
    const syncFlagRef = React.useRef(false);

    // --- User-size map (the persisted, authoritative dimension) ---
    //
    // Seeded from `storedLayout` at mount and on any external update
    // (tugbank broadcast). Updated synchronously from
    // `handleLayoutChanged` at the end of a user drag. This is the
    // value that `TugSplitPanelHandle.restoreUserSize` snaps back to.
    const userSizeMapRef = React.useRef<Layout>({});
    React.useLayoutEffect(() => {
      if (storedLayout) {
        userSizeMapRef.current = { ...storedLayout };
      }
    }, [storedLayout]);

    const getUserSize = React.useCallback(
      (panelId: string | number): number => {
        return userSizeMapRef.current[String(panelId)] ?? 0;
      },
      [],
    );

    const contextValue = React.useMemo<TugSplitPaneWriteContextValue>(
      () => ({ syncFlagRef, getUserSize }),
      [getUserSize],
    );

    // --- Path A: user drag ---
    //
    // The library fires `onLayoutChanged` at pointerup for drags. When
    // the sync flag is clear, we're on the user-drag path: update
    // userSize and persist. When the flag is set, we're inside a
    // transient write from `setTransientSize` or `restoreUserSize` —
    // bail out so neither userSize nor tugbank gets clobbered.
    //
    // This is the ONLY place that writes userSize or tugbank. By
    // construction, it cannot run for auto-resize writes.
    const handleLayoutChanged = React.useCallback(
      (layout: Layout) => {
        if (syncFlagRef.current) return;
        userSizeMapRef.current = { ...layout };
        if (storageKey) putSplitPaneLayout(storageKey, layout);
      },
      [storageKey],
    );

    const GripIcon = orientation === "vertical" ? GripVertical : GripHorizontal;
    const libraryOrientation = orientation === "horizontal" ? "vertical" : "horizontal";

    // Interleave a Separator between each pair of consecutive children.
    // react-resizable-panels requires Separator elements to be direct DOM
    // children of Group — we can't wrap them in a fragment or helper
    // component.
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
      <TugSplitPaneWriteContext.Provider value={contextValue}>
        <Group
          orientation={libraryOrientation}
          defaultLayout={storedLayout ?? undefined}
          elementRef={ref}
          onLayoutChanged={handleLayoutChanged}
          className={cn("tug-split-pane", `tug-split-pane-${orientation}`, className)}
          data-slot="tug-split-pane"
          data-disabled={effectiveDisabled || undefined}
          data-show-handle={showHandle ? undefined : "false"}
          {...rest}
        >
          {interleaved}
        </Group>
      </TugSplitPaneWriteContext.Provider>
    );
  },
);

// ---------------------------------------------------------------------------
// TugSplitPanel
// ---------------------------------------------------------------------------

/**
 * Imperative handle exposed by `TugSplitPanel` via `forwardRef`.
 *
 * All sizes are expressed as a percentage of the parent group (0..100).
 * This matches the library's internal representation, the on-wire
 * format stored in tugbank, and the `Layout` type emitted by the
 * library's `onLayoutChanged` callback. No pixel conversions happen at
 * this API — consumers that observe content in pixels (e.g.
 * `scrollHeight`) must translate to percentages themselves at the
 * boundary.
 *
 * The handle distinguishes TWO separate concerns:
 *
 * - `setTransientSize(pct)` — write a transient display size. Used for
 *   content-driven auto-resize. Never persisted. Never modifies the
 *   user's saved dimension.
 * - `restoreUserSize()` — snap back to the user's saved dimension (as
 *   last set by a drag, read from `TugSplitPane`'s userSize map).
 *
 * User drags take a separate path entirely (via
 * `TugSplitPane`'s `onLayoutChanged`) and never go through this handle.
 *
 * See `useContentDrivenPanelSize` (sibling file) for the common
 * scroll-source case.
 */
export interface TugSplitPanelHandle {
  /**
   * Current library-displayed size as a percentage (0..100). Reads
   * the library's store synchronously.
   */
  getSize(): number;
  /**
   * Write a transient display size (0..100, percentage). Used for
   * content-driven auto-resize.
   *
   * NEVER persisted. NEVER modifies the user's saved dimension. The
   * write is gated by a sync flag so the surrounding `TugSplitPane`'s
   * user-drag path bails out — there is no code path from this method
   * to `putSplitPaneLayout` or to userSize-map updates. Returns the
   * clamped percentage the library actually applied.
   */
  setTransientSize(pct: number): number;
  /**
   * Snap the panel back to the user's saved dimension — the value the
   * user last set by dragging (or the library's resolved default, if
   * they've never dragged). Reads from `TugSplitPane`'s userSize map.
   *
   * NEVER persisted. NEVER modifies the user's saved dimension. The
   * write is gated by the same sync flag as `setTransientSize` so no
   * cross-talk with the user-drag path is possible. Returns the
   * percentage actually applied (0 if no user size is available).
   */
  restoreUserSize(): number;
}

/** TugSplitPanel props. */
export interface TugSplitPanelProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "children"> {
  /**
   * Initial size. Default: auto-assigned equally across siblings by the
   * library. See {@link TugSplitSize} for accepted value formats.
   */
  defaultSize?: TugSplitSize;
  /**
   * Minimum size. Enforced during drag and on container resize.
   * Default: 0. See {@link TugSplitSize} for accepted value formats.
   */
  minSize?: TugSplitSize;
  /**
   * Maximum size. Enforced during drag and on container resize.
   * Default: 100%. See {@link TugSplitSize} for accepted value formats.
   */
  maxSize?: TugSplitSize;
  /**
   * Panel can snap closed when the user drags its neighboring sash past
   * this panel's `minSize`. Default: false.
   */
  collapsible?: boolean;
  /**
   * Size this panel takes when collapsed. Default: 0. Only meaningful
   * when `collapsible` is true.
   */
  collapsedSize?: TugSplitSize;
  /**
   * Fires when the panel's collapsed state toggles. State-mirror callback.
   */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Panel content. */
  children?: React.ReactNode;
}

export const TugSplitPanel = React.forwardRef<TugSplitPanelHandle, TugSplitPanelProps>(
  function TugSplitPanel(
    {
      id,
      defaultSize,
      minSize,
      maxSize,
      collapsible,
      collapsedSize,
      onCollapsedChange,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    const panelRef = React.useRef<PanelImperativeHandle | null>(null);
    const panelElementRef = React.useRef<HTMLDivElement | null>(null);
    const wasCollapsedRef = React.useRef(false);

    // Stable id. Explicit `id` wins (required for `storageKey`
    // round-trip); falls back to `useId` otherwise. The same value is
    // passed to the library `Panel` and used as the key into
    // `TugSplitPane`'s userSize map.
    const fallbackId = React.useId();
    const resolvedId = id ?? fallbackId;

    // Shared primitives from the enclosing `TugSplitPane`. Fallback to
    // a local no-op context when this panel is mounted standalone
    // (tests, isolated harnesses) — no persistence happens outside a
    // TugSplitPane so the flag and user-size lookups are moot, but the
    // imperative API still works.
    const writeContext = React.useContext(TugSplitPaneWriteContext);
    const localSyncFlagRef = React.useRef(false);
    const syncFlagRef = writeContext?.syncFlagRef ?? localSyncFlagRef;
    const getUserSize = writeContext?.getUserSize ?? FALLBACK_GET_USER_SIZE;

    // onResize drives the (synthesized) collapse-change callback.
    const handleResize = React.useCallback(
      (_size: PanelSize, _id: string | number | undefined, _prev: PanelSize | undefined) => {
        const panel = panelRef.current;
        if (!panel || !onCollapsedChange) return;
        const isCollapsed = panel.isCollapsed();
        if (isCollapsed !== wasCollapsedRef.current) {
          wasCollapsedRef.current = isCollapsed;
          onCollapsedChange(isCollapsed);
        }
      },
      [onCollapsedChange],
    );

    // Helper: apply a percentage with the sync flag set so the
    // user-drag path in `TugSplitPane` bails out. Shared by
    // `setTransientSize` and `restoreUserSize` — they have different
    // callers and intents, but the underlying mechanism (gated library
    // write) is identical.
    const writeGated = React.useCallback((pct: number): number => {
      const panel = panelRef.current;
      if (!panel) return 0;
      syncFlagRef.current = true;
      try {
        panel.resize(`${pct}%`);
      } finally {
        syncFlagRef.current = false;
      }
      return panel.getSize().asPercentage;
    }, [syncFlagRef]);

    React.useImperativeHandle(
      ref,
      (): TugSplitPanelHandle => ({
        getSize() {
          return panelRef.current?.getSize().asPercentage ?? 0;
        },
        setTransientSize(pct) {
          return writeGated(pct);
        },
        restoreUserSize() {
          const userPct = getUserSize(resolvedId);
          if (userPct <= 0) return panelRef.current?.getSize().asPercentage ?? 0;
          return writeGated(userPct);
        },
      }),
      [writeGated, getUserSize, resolvedId],
    );

    return (
      <Panel
        id={resolvedId}
        defaultSize={defaultSize}
        minSize={minSize}
        maxSize={maxSize}
        collapsible={collapsible}
        collapsedSize={collapsedSize}
        panelRef={panelRef}
        onResize={onCollapsedChange ? handleResize : undefined}
        elementRef={panelElementRef}
        className={cn("tug-split-panel", className)}
        data-slot="tug-split-panel"
        {...rest}
      >
        {children}
      </Panel>
    );
  },
);
