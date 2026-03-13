/**
 * TugButton -- tugways public API for buttons.
 *
 * Wraps a plain <button> element with Radix Slot for asChild polymorphism.
 * App code imports TugButton; never imports from components/ui/button.
 *
 * Phase 2: Direct-action mode (onClick) and all four subtypes.
 * Phase 3: Chain-action mode added via `action` prop.
 *   - When `action` is set, TugButton subscribes to the responder chain via
 *     useSyncExternalStore. canHandle/validateAction determine visibility and
 *     enabled state. Click dispatches through the chain instead of calling onClick.
 *   - When `action` is undefined or no ResponderChainProvider is in the tree,
 *     TugButton falls through to direct-action mode (existing onClick behavior).
 *
 * Emphasis x Role API [D02, D03, D04, Spec S01, Spec S02]:
 *   `emphasis` controls visual weight (filled/outlined/ghost), default: "outlined"
 *   `role` controls color domain (accent/active/agent/data/danger), default: "active"
 *   Compound CSS class: tug-button-{emphasis}-{role}
 *
 * [D01] TugButton wraps Radix Slot for asChild polymorphism (no shadcn)
 * [D05] Two-level action validation drives chain-action enabled state
 * [D06] Chain-action TugButton uses useSyncExternalStore for validation
 * [D04] TugButton CSS uses semantic tokens exclusively
 * Spec S01, S02, S03, S04, Table T01, T02, T03
 */

import React, { useState, useSyncExternalStore } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import { useResponderChain } from "./responder-chain-provider";
import "./tug-button.css";

// ---- No-op constants for useSyncExternalStore when chain is inactive ----
// Module-level stable references prevent React from seeing new function
// identities and triggering unnecessary re-subscriptions.

const NOOP_SUBSCRIBE = (_cb: () => void): (() => void) => () => {};
const NOOP_SNAPSHOT = (): number => 0;

// ---- Types ----

/** Three-state button state values */
export type TugButtonState = "on" | "off" | "mixed";

/** TugButton emphasis values — controls visual weight (Spec S01) [D02] */
export type TugButtonEmphasis = "filled" | "outlined" | "ghost";

/** TugButton role values — controls color domain (Spec S01) [D02] */
export type TugButtonRole = "accent" | "active" | "agent" | "data" | "danger";

/** TugButton size names (Spec S01) */
export type TugButtonSize = "sm" | "md" | "lg";

/** TugButton subtype names (Spec S01, Table T01) */
export type TugButtonSubtype = "push" | "icon" | "icon-text" | "three-state";

/** TugButton border-radius tokens (proportional, rem-based like Tailwind) */
export type TugButtonRounded = "none" | "sm" | "md" | "lg" | "full";

/**
 * TugButton props interface -- Phase 3 (Spec S01, S04).
 */
export interface TugButtonProps {
  /** Button rendering subtype. Default: "push" */
  subtype?: TugButtonSubtype;
  /** Visual weight. Default: "outlined". Controls filled/outlined/ghost styling. [D02, Spec S01] */
  emphasis?: TugButtonEmphasis;
  /** Color domain. Default: "active". Controls accent/active/agent/data/danger hue. [D02, Spec S01] */
  role?: TugButtonRole;
  /** Size variant. Default: "md" */
  size?: TugButtonSize;

  /** Direct-action mode click handler. Mutually exclusive with `action`. */
  onClick?: () => void;

  /**
   * Chain-action mode: action name to dispatch via the responder chain.
   * Mutually exclusive with `onClick`.
   * When set, TugButton subscribes to canHandle/validateAction on the chain.
   * If canHandle returns false, the button renders as aria-disabled (never hidden).
   * If validateAction returns false, the button is visually disabled (aria-disabled).
   *
   * [D06] TugButton never hides -- disable instead of hide
   * Spec S08 (#s08-never-hide)
   */
  action?: string;

  /**
   * Explicit-target dispatch: ID of the responder node that should receive
   * the action directly (bypassing the chain walk). Requires `action` to be set.
   *
   * When set and chainActive:
   * - Enabled check uses `manager.nodeCanHandle(target, action)` instead of
   *   `manager.canHandle(action)`. The button's enabled state reflects the
   *   target node's capability, not the chain's.
   * - Click calls `manager.dispatchTo(target, event)` instead of
   *   `manager.dispatch(event)`.
   *
   * [D03] dispatchTo throws on unregistered target
   * [D04] TugButton target prop requires action prop
   * [D07] nodeCanHandle for per-node capability query
   */
  target?: string;

  /** Disable the button */
  disabled?: boolean;
  /** Show spinner overlay and disable interaction */
  loading?: boolean;
  /** Button label content (required for push, icon-text, three-state subtypes) */
  children?: React.ReactNode;

  /** Lucide icon node for "icon" and "icon-text" subtypes */
  icon?: React.ReactNode;

  /** Current state for "three-state" subtype. Default: "off" */
  state?: TugButtonState;
  /** Callback when three-state button is clicked (cycles: off → on → mixed → off) */
  onStateChange?: (state: TugButtonState) => void;

  /** Accessibility label (required for "icon" subtype without visible text) */
  "aria-label"?: string;

  /** Border radius token. Default is size-proportional (sm→"sm", md→"md", lg→"lg"). */
  rounded?: TugButtonRounded;

  /** Additional CSS class names */
  className?: string;

  /**
   * Render as a different element or component (Radix asChild polymorphism).
   * When true, the single child element becomes the button's DOM root.
   */
  asChild?: boolean;
}

// ---- Border-radius tokens (rem-based, Tailwind-proportional) ----

const ROUNDED_MAP: Record<TugButtonRounded, string> = {
  none: "0",
  sm: "0.25rem",   // 4px — Tailwind rounded
  md: "0.375rem",  // 6px — Tailwind rounded-md
  lg: "0.5rem",    // 8px — Tailwind rounded-lg
  full: "9999px",  // pill
};

/** Size-proportional default: all sizes default to pill shape */
const SIZE_ROUNDED_DEFAULT: Record<TugButtonSize, TugButtonRounded> = {
  sm: "lg",
  md: "lg",
  lg: "lg",
};

// ---- Spinner component ----

function Spinner() {
  return (
    <span className="tug-button-spinner-overlay" aria-hidden="true">
      <span className="tug-petals" style={{ "--tug-petals-size": "18px" } as React.CSSProperties}>
        <span className="petal" /><span className="petal" /><span className="petal" /><span className="petal" />
        <span className="petal" /><span className="petal" /><span className="petal" /><span className="petal" />
      </span>
    </span>
  );
}

// ---- TugButton ----

/**
 * TugButton -- tugways button component.
 *
 * Supports four subtypes (push, icon, icon-text, three-state), three sizes (sm, md, lg),
 * loading state, direct-action mode (onClick), and chain-action mode (action).
 *
 * Styling is controlled by the emphasis x role system [D02, D03, D04]:
 *   emphasis: "filled" | "outlined" | "ghost" (default: "outlined")
 *   role:     "accent" | "active" | "agent" | "data" | "danger" (default: "active")
 *
 * All colors use var(--tug-base-*) semantic tokens for zero-re-render theme switching.
 */
export function TugButton({
  subtype = "push",
  emphasis = "outlined",
  role = "active",
  size = "md",
  onClick,
  action,
  target,
  disabled = false,
  loading = false,
  children,
  icon,
  state = "off",
  onStateChange,
  rounded,
  "aria-label": ariaLabel,
  className,
  asChild = false,
}: TugButtonProps) {
  // Three-state subtype internal state management
  const [internalState, setInternalState] = useState<TugButtonState>(state);

  // Sync internalState when state prop changes
  React.useEffect(() => {
    setInternalState(state);
  }, [state]);

  // Dev-mode warning for icon subtype without aria-label
  React.useEffect(() => {
    if (
      subtype === "icon" &&
      !ariaLabel &&
      !children &&
      process.env.NODE_ENV !== "production"
    ) {
      console.warn(
        "TugButton [icon subtype]: Missing aria-label. Icon-only buttons require an aria-label for accessibility."
      );
    }
  }, [subtype, ariaLabel, children]);

  // Dev-mode warning when both action and onClick are set (mutually exclusive)
  React.useEffect(() => {
    if (action !== undefined && onClick !== undefined && process.env.NODE_ENV !== "production") {
      console.warn(
        "TugButton: `action` and `onClick` are mutually exclusive. " +
        "When `action` is set, the chain dispatches on click; `onClick` is ignored."
      );
    }
  }, [action, onClick]);

  // Dev-mode warning when target is set without action
  React.useEffect(() => {
    if (target !== undefined && action === undefined && process.env.NODE_ENV !== "production") {
      console.warn(
        "TugButton: `target` is set without `action`. " +
        "`target` requires `action` to be set for dispatch to work."
      );
    }
  }, [target, action]);

  // ---- Chain-action mode: unconditional hook calls (React rules of hooks) ----

  // useResponderChain() returns the manager or null (safe outside provider).
  const manager = useResponderChain();

  // useSyncExternalStore() called unconditionally on every render.
  // When the chain is inactive (no manager, or no action prop), use the
  // module-level NOOP constants so React sees stable function references
  // and never triggers unnecessary re-subscriptions.
  const chainActive = manager !== null && action !== undefined;
  const subscribe = chainActive ? manager.subscribe.bind(manager) : NOOP_SUBSCRIBE;
  const getSnapshot = chainActive ? manager.getValidationVersion.bind(manager) : NOOP_SNAPSHOT;
  useSyncExternalStore(subscribe, getSnapshot);

  // ---- Chain-action validation (computed from hook results) ----

  // When chain-action is active, query the manager for capability and state.
  // These are derived from the useSyncExternalStore snapshot version above,
  // so they update whenever the validation version increments.
  //
  // When target is set, use nodeCanHandle(target, action) for the enabled check
  // so the button reflects the target node's capability, not the full chain's.
  // validateAction is only consulted in chain-walk mode (no target), where the
  // chain walk determines both capability and enabled state.
  // [D07] nodeCanHandle for per-node capability query
  const chainCanHandle = chainActive
    ? (target !== undefined ? manager.nodeCanHandle(target, action) : manager.canHandle(action))
    : false;
  // In target mode the enabled state is fully determined by nodeCanHandle alone;
  // validateAction is a chain-walk concept and is not consulted for targeted dispatch.
  const chainValidated = chainActive && target === undefined
    ? manager.validateAction(action)
    : chainCanHandle;

  // isChainDisabled: chain is active and either canHandle is false OR validateAction is false.
  // When true, the button renders as aria-disabled (never hidden -- [D06] never-hide).
  // This merges the old "no responder can handle" case (was: return null) with the
  // "handled but disabled" case into a single disabled state. Spec S08 (#s08-never-hide).
  const isChainDisabled = chainActive && (!chainCanHandle || !chainValidated);

  // ---- Layout helpers ----

  // Border radius: explicit token wins, otherwise size-proportional default
  const resolvedRadius = ROUNDED_MAP[rounded ?? SIZE_ROUNDED_DEFAULT[size]];

  // ---- Click handler ----

  const handleClick = () => {
    if (disabled || loading) return;

    // Chain-action disabled guard: aria-disabled buttons still receive click
    // events (unlike HTML disabled). Return early without dispatching.
    if (isChainDisabled) return;

    if (chainActive && chainCanHandle) {
      // Chain-action mode: dispatch through the responder chain with ActionEvent.
      // [D01] ActionEvent is the sole dispatch currency
      if (target !== undefined) {
        // Explicit-target mode: dispatch directly to the named node.
        // [D03] dispatchTo throws on unregistered target
        const handled = manager.dispatchTo(target, { action, phase: "discrete" });
        if (!handled && process.env.NODE_ENV !== "production") {
          console.warn(
            `TugButton: dispatchTo("${target}", "${action}") returned false -- target does not handle this action`
          );
        }
      } else {
        manager.dispatch({ action, phase: "discrete" });
      }
      return;
    }

    if (subtype === "three-state") {
      // Cycle: off → on → mixed → off
      const nextMap: Record<TugButtonState, TugButtonState> = {
        off: "on",
        on: "mixed",
        mixed: "off",
      };
      const newState = nextMap[internalState];
      setInternalState(newState);
      onStateChange?.(newState);
    } else {
      onClick?.();
    }
  };

  // aria-pressed for three-state subtype (Spec S03)
  const ariaPressed: boolean | "mixed" | undefined =
    subtype === "three-state"
      ? internalState === "mixed"
        ? "mixed"
        : internalState === "on"
      : undefined;

  // aria-disabled for chain-action disabled state.
  // Use aria-disabled (not HTML disabled) so the button stays in the tab order.
  const ariaDisabled = isChainDisabled ? "true" : undefined;

  // CSS class composition — compound emphasis-role class [D03, Spec S02]
  const emphasisRoleClass = `tug-button-${emphasis}-${role}`;
  const sizeClass = `tug-button-size-${size}`;
  const buttonClassName = cn(
    // Base tug-button class
    "tug-button",
    // Size class
    sizeClass,
    // Emphasis x role compound class for hover/active/transition styles [D03]
    emphasisRoleClass,
    // Icon subtype size classes (square aspect ratio per Table T03)
    subtype === "icon" && size === "sm" && "tug-button-icon-sm",
    subtype === "icon" && size === "md" && "tug-button-icon-md",
    subtype === "icon" && size === "lg" && "tug-button-icon-lg",
    // Three-state subtype classes
    subtype === "three-state" && "tug-button-three-state",
    subtype === "three-state" && `tug-button-state-${internalState}`,
    // Loading state
    loading && "tug-button-loading",
    className
  );

  // Content rendering per subtype
  function renderContent() {
    if (loading) {
      return (
        <>
          <span className="tug-button-loading-content" aria-hidden="true">
            {renderSubtypeContent()}
          </span>
          <Spinner />
        </>
      );
    }
    return renderSubtypeContent();
  }

  function renderSubtypeContent() {
    switch (subtype) {
      case "icon":
        return icon ?? null;

      case "icon-text":
        return (
          <span className="tug-button-icon-text">
            {icon}
            {children}
          </span>
        );

      case "three-state":
        return (
          <>
            {children}
            <span className="tug-button-state-indicator" aria-hidden="true" />
          </>
        );

      case "push":
      default:
        return children;
    }
  }

  // Use Radix Slot for asChild polymorphism; plain button otherwise.
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-busy={loading ? "true" : undefined}
      aria-disabled={ariaDisabled}
      onClick={handleClick}
      className={buttonClassName}
      style={{ borderRadius: resolvedRadius }}
    >
      {renderContent()}
    </Comp>
  );
}
