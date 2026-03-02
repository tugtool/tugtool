/**
 * TugButton -- tugways public API for buttons.
 *
 * Wraps shadcn's Button as a private implementation detail.
 * App code imports TugButton; never imports from components/ui/button directly.
 *
 * Phase 2: Direct-action mode only (onClick). Chain-action mode deferred to Phase 3.
 *
 * [D01] TugButton wraps shadcn Button as a private implementation detail
 * [D02] Direct-action only in Phase 2
 * [D04] TugButton CSS uses semantic tokens exclusively
 * [D05] All four subtypes implemented in Phase 2
 * Spec S01, S02, S03, Table T01, T02, T03
 */

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import "./tug-button.css";

// ---- Types ----

/** Three-state button state values */
export type TugButtonState = "on" | "off" | "mixed";

/** TugButton variant names (Spec S01) */
export type TugButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

/** TugButton size names (Spec S01) */
export type TugButtonSize = "sm" | "md" | "lg";

/** TugButton subtype names (Spec S01, Table T01) */
export type TugButtonSubtype = "push" | "icon" | "icon-text" | "three-state";

/** TugButton border-radius tokens (proportional, rem-based like Tailwind) */
export type TugButtonRounded = "none" | "sm" | "md" | "lg" | "full";

/**
 * TugButton props interface -- Phase 2 (Spec S01).
 *
 * Note: the `action` prop for chain-action mode is omitted per [D02].
 * Phase 3 will extend TugButtonProps to add `action`.
 */
export interface TugButtonProps {
  /** Button rendering subtype. Default: "push" */
  subtype?: TugButtonSubtype;
  /** Color/style variant. Default: "secondary" */
  variant?: TugButtonVariant;
  /** Size variant. Default: "md" */
  size?: TugButtonSize;

  /** Direct-action mode click handler */
  onClick?: () => void;

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
}

// ---- Variant mapping (TugButton -> shadcn) ----

type ShadcnVariant = "default" | "secondary" | "ghost" | "destructive";

const VARIANT_MAP: Record<TugButtonVariant, ShadcnVariant> = {
  primary: "default",
  secondary: "secondary",
  ghost: "ghost",
  destructive: "destructive",
};

// ---- Size mapping (TugButton -> shadcn) ----

type ShadcnSize = "sm" | "default" | "lg" | "icon";

const SIZE_MAP: Record<TugButtonSize, ShadcnSize> = {
  sm: "sm",
  md: "default",
  lg: "lg",
};

// ---- Border-radius tokens (rem-based, Tailwind-proportional) ----

const ROUNDED_MAP: Record<TugButtonRounded, string> = {
  none: "0",
  sm: "0.25rem",   // 4px — Tailwind rounded
  md: "0.375rem",  // 6px — Tailwind rounded-md
  lg: "0.5rem",    // 8px — Tailwind rounded-lg
  full: "9999px",  // pill
};

/** Size-proportional default: each button size maps to a radius token */
const SIZE_ROUNDED_DEFAULT: Record<TugButtonSize, TugButtonRounded> = {
  sm: "sm",
  md: "md",
  lg: "lg",
};

// ---- Spinner component ----

function Spinner() {
  return (
    <span className="tug-button-spinner-overlay" aria-hidden="true">
      <span className="tug-button-spinner" />
    </span>
  );
}

// ---- TugButton ----

/**
 * TugButton -- tugways button component.
 *
 * Supports four subtypes (push, icon, icon-text, three-state), four variants
 * (primary, secondary, ghost, destructive), three sizes (sm, md, lg),
 * loading state, and direct-action mode.
 *
 * All colors use var(--td-*) semantic tokens for zero-re-render theme switching.
 */
export function TugButton({
  subtype = "push",
  variant = "secondary",
  size = "md",
  onClick,
  disabled = false,
  loading = false,
  children,
  icon,
  state = "off",
  onStateChange,
  rounded,
  "aria-label": ariaLabel,
  className,
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

  // Border radius: explicit token wins, otherwise size-proportional default
  const resolvedRadius = ROUNDED_MAP[rounded ?? SIZE_ROUNDED_DEFAULT[size]];

  // Shadcn variant and size
  const shadcnVariant = VARIANT_MAP[variant];
  const shadcnSize = SIZE_MAP[size];

  // Icon subtype: use shadcn's "icon" size for square aspect ratio override
  const resolvedShadcnSize: ShadcnSize =
    subtype === "icon" ? "icon" : shadcnSize;

  // Click handler
  const handleClick = () => {
    if (disabled || loading) return;

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

  // CSS class composition
  const variantClass = `tug-button-${variant}`;
  const buttonClassName = cn(
    // Variant class for hover/active/transition styles
    variantClass,
    // Border for non-ghost variants
    variant !== "ghost" && "tug-button-bordered",
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

  return (
    <Button
      variant={shadcnVariant}
      size={resolvedShadcnSize}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-busy={loading ? "true" : undefined}
      onClick={handleClick}
      className={buttonClassName}
      style={{ borderRadius: resolvedRadius }}
    >
      {renderContent()}
    </Button>
  );
}
