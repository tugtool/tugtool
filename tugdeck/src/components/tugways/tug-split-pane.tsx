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
 * Laws: [L06] appearance via CSS, [L15] token-driven states,
 *       [L16] pairings declared, [L19] component authoring guide,
 *       [L20] token sovereignty
 */

import "./tug-split-pane.css";

import React from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { GripHorizontal, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTugBoxDisabled } from "./internal/tug-box-context";

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
 * Accepts either a plain number (interpreted by the library as percent
 * out of 100) or a string with a unit suffix (`"50%"`, `"200px"`). The
 * library supports `px`, `%`, `em`, `rem`, `vh`, `vw`.
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
  /** TugSplitPanel children. Each child must be a TugSplitPanel element. */
  children: React.ReactNode;
}

export const TugSplitPane = React.forwardRef<HTMLDivElement, TugSplitPaneProps>(
  function TugSplitPane(
    { orientation = "horizontal", disabled = false, className, children, ...rest },
    ref,
  ) {
    // Merge with any ancestor TugBox's disabled cascade so a disabled outer
    // TugBox disables every sash in this split pane.
    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

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
      <Group
        orientation={libraryOrientation}
        elementRef={ref as React.Ref<HTMLDivElement | null>}
        className={cn("tug-split-pane", `tug-split-pane-${orientation}`, className)}
        data-slot="tug-split-pane"
        data-disabled={effectiveDisabled || undefined}
        {...rest}
      >
        {interleaved}
      </Group>
    );
  },
);

// ---------------------------------------------------------------------------
// TugSplitPanel
// ---------------------------------------------------------------------------

/** TugSplitPanel props. */
export interface TugSplitPanelProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "children"> {
  /** Initial size. Default: auto-assigned equally across siblings. */
  defaultSize?: TugSplitSize;
  /** Minimum size. Enforced during drag and on container resize. */
  minSize?: TugSplitSize;
  /** Maximum size. Optional. */
  maxSize?: TugSplitSize;
  /** Panel content. */
  children?: React.ReactNode;
}

export const TugSplitPanel = React.forwardRef<HTMLDivElement, TugSplitPanelProps>(
  function TugSplitPanel(
    { defaultSize, minSize, maxSize, className, children, ...rest },
    ref,
  ) {
    return (
      <Panel
        defaultSize={defaultSize}
        minSize={minSize}
        maxSize={maxSize}
        elementRef={ref as React.Ref<HTMLDivElement | null>}
        className={cn("tug-split-panel", className)}
        data-slot="tug-split-panel"
        {...rest}
      >
        {children}
      </Panel>
    );
  },
);
