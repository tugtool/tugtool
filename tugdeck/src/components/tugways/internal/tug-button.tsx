/**
 * TugButton — internal button infrastructure for tugways.
 *
 * Building block composed by TugPushButton, TugPopupButton, and TugTabBar.
 * App code should use TugPushButton for standalone action buttons.
 *
 * Laws: [L06] appearance via CSS, [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide
 * Decisions: [D02] emphasis x role system
 */

import "./tug-button.css";

import React, { useSyncExternalStore } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import { useResponderChain } from "../responder-chain-provider";

// ---- No-op constants for useSyncExternalStore when chain is inactive ----
// Module-level stable references prevent React from seeing new function
// identities and triggering unnecessary re-subscriptions.

const NOOP_SUBSCRIBE = (_cb: () => void): (() => void) => () => {};
const NOOP_SNAPSHOT = (): number => 0;

// ---- Types ----

/** TugButton emphasis values — controls visual weight [D02] */
export type TugButtonEmphasis = "filled" | "outlined" | "ghost";

/** TugButton role values — controls color domain [D02] */
export type TugButtonRole = "accent" | "action" | "data" | "danger" | "option";

/** TugButton size names */
export type TugButtonSize = "sm" | "md" | "lg";

/**
 * TugButton subtype names.
 * Three subtypes: text (default), icon (square), icon-text (leading icon + label).
 */
export type TugButtonSubtype = "text" | "icon" | "icon-text";

/** TugButton border-radius tokens (proportional, rem-based like Tailwind) */
export type TugButtonRounded = "none" | "sm" | "md" | "lg" | "full";

/**
 * TugButton props interface.
 *
 * Extends ButtonHTMLAttributes so that Radix composition (asChild pattern)
 * can merge arbitrary props (data-state, aria-expanded, onPointerDown, ref,
 * etc.) onto the underlying DOM button element. We omit:
 *   - 'role': TugButton redefines it as TugButtonRole (not the HTML aria role)
 *   - 'onClick': TugButton redefines it to accept an optional MouseEvent (for asChild compatibility)
 *   - 'children': TugButton redefines it as React.ReactNode (same type but explicit)
 */
export interface TugButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'role' | 'onClick' | 'children'> {
  /**
   * Button rendering subtype.
   * @selector .tug-button-icon-sm | .tug-button-icon-md | .tug-button-icon-lg
   * @default "text"
   */
  subtype?: TugButtonSubtype;
  /**
   * Visual weight. Controls filled/outlined/ghost styling. [D02]
   * @selector .tug-button-{emphasis}-{role}
   * @default "outlined"
   */
  emphasis?: TugButtonEmphasis;
  /**
   * Color domain. Controls accent/action/data/danger hue. [D02]
   * @selector .tug-button-{emphasis}-{role}
   * @default "action"
   */
  role?: TugButtonRole;
  /**
   * Size variant.
   * @selector .tug-button-size-sm | .tug-button-size-md | .tug-button-size-lg
   * @default "md"
   */
  size?: TugButtonSize;

  /** Direct-action mode click handler. Mutually exclusive with `action`. */
  onClick?: (e?: React.MouseEvent<HTMLButtonElement>) => void;

  /**
   * Chain-action mode: action name to dispatch via the responder chain.
   * Mutually exclusive with `onClick`.
   * When set, TugButton subscribes to canHandle/validateAction on the chain.
   * If canHandle returns false, the button renders as aria-disabled (never hidden).
   * If validateAction returns false, the button is visually disabled (aria-disabled).
   *
   * [D06] TugButton never hides -- disable instead of hide
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

  /**
   * Disable the button.
   * @selector :disabled
   * @default false
   */
  disabled?: boolean;
  /**
   * Show spinner overlay and disable interaction.
   * @selector .tug-button-loading
   */
  loading?: boolean;
  /** Button label content (required for text and icon-text subtypes) */
  children?: React.ReactNode;

  /** Lucide icon node for "icon" and "icon-text" subtypes */
  icon?: React.ReactNode;

  /**
   * Trailing icon node rendered after the label text in "text" and "icon-text" subtypes.
   * Useful for dropdown triggers that show a ChevronDown indicator.
   */
  trailingIcon?: React.ReactNode;

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
      <span className="tug-petals" style={{ "--tug-petals-size": "14px" } as React.CSSProperties}>
        <span className="petal" /><span className="petal" /><span className="petal" /><span className="petal" />
        <span className="petal" /><span className="petal" /><span className="petal" /><span className="petal" />
      </span>
    </span>
  );
}

// ---- TugButton ----

/**
 * TugButton -- internal tugways button component.
 *
 * Supports three subtypes (text, icon, icon-text), three sizes (sm, md, lg),
 * loading state, direct-action mode (onClick), and chain-action mode (action).
 *
 * TugButton is typographically neutral. For uppercase standalone action buttons,
 * use TugPushButton instead.
 *
 * Styling is controlled by the emphasis x role system [D02]:
 *   emphasis: "filled" | "outlined" | "ghost" (default: "outlined")
 *   role:     "accent" | "action" | "data" | "danger" (default: "action")
 *
 * All colors use var(--tug-*) semantic tokens for zero-re-render theme switching. [L06]
 *
 * Implemented as React.forwardRef so that refs from Radix composition (asChild)
 * reach the underlying DOM button element.
 */
export const TugButton = React.forwardRef<HTMLButtonElement, TugButtonProps>(function TugButton({
  subtype = "text",
  emphasis = "outlined",
  role = "action",
  size = "md",
  onClick,
  action,
  target,
  disabled = false,
  loading = false,
  children,
  icon,
  trailingIcon,
  rounded,
  "aria-label": ariaLabel,
  className,
  asChild = false,
  ...rest
}: TugButtonProps, ref) {
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

  // useSyncExternalStore() called unconditionally on every render. [L02]
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
  const isChainDisabled = chainActive && (!chainCanHandle || !chainValidated);

  // ---- Layout helpers ----

  // Border radius: explicit token wins, otherwise size-proportional default
  const resolvedRadius = ROUNDED_MAP[rounded ?? SIZE_ROUNDED_DEFAULT[size]];

  // ---- Click handler ----

  const handleClick = (e?: React.MouseEvent<HTMLButtonElement>) => {
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

    onClick?.(e);
  };

  // aria-disabled for chain-action disabled state.
  // Use aria-disabled (not HTML disabled) so the button stays in the tab order.
  const ariaDisabled = isChainDisabled ? "true" : undefined;

  // CSS class composition — compound emphasis-role class [D02]
  const emphasisRoleClass = `tug-button-${emphasis}-${role}`;
  const sizeClass = `tug-button-size-${size}`;
  const buttonClassName = cn(
    // Base tug-button class
    "tug-button",
    // Size class
    sizeClass,
    // Emphasis x role compound class for hover/active/transition styles
    emphasisRoleClass,
    // Icon subtype size classes (square aspect ratio)
    subtype === "icon" && size === "sm" && "tug-button-icon-sm",
    subtype === "icon" && size === "md" && "tug-button-icon-md",
    subtype === "icon" && size === "lg" && "tug-button-icon-lg",
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
            {trailingIcon && (
              <span className="tug-button-trailing-icon" aria-hidden="true">
                {trailingIcon}
              </span>
            )}
          </span>
        );

      case "text":
      default:
        return (
          <>
            {children}
            {trailingIcon && (
              <span className="tug-button-trailing-icon" aria-hidden="true">
                {trailingIcon}
              </span>
            )}
          </>
        );
    }
  }

  // Use Radix Slot for asChild polymorphism; plain button otherwise.
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      ref={ref}
      data-slot="tug-button"
      disabled={disabled}
      aria-label={ariaLabel}
      aria-busy={loading ? "true" : undefined}
      aria-disabled={ariaDisabled}
      onClick={handleClick}
      className={buttonClassName}
      style={{ borderRadius: resolvedRadius }}
      {...rest}
    >
      {renderContent()}
    </Comp>
  );
});
