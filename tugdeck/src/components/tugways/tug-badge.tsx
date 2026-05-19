/**
 * TugBadge — compact status/category label.
 *
 * Pill-shaped, display-only badge for surfacing status, role, or category.
 * Shares the emphasis x role axis system with TugButton.
 * Supports four emphases (filled, outlined, ghost, tinted) and seven roles.
 *
 * Laws: [L06] appearance via CSS, [L16] pairings declared, [L19] component authoring guide
 * Decisions: [D02] emphasis x role system
 */

import "./tug-badge.css";

import React from "react";
import { cn } from "@/lib/utils";

// ---- Types ----

/** TugBadge emphasis values — controls visual weight */
export type TugBadgeEmphasis = "filled" | "outlined" | "ghost" | "tinted";

/** TugBadge role values — controls color domain; includes all 7 roles */
export type TugBadgeRole =
  | "accent"
  | "action"
  | "agent"
  | "data"
  | "danger"
  | "success"
  | "caution";

/** TugBadge size names */
export type TugBadgeSize = "sm" | "md" | "lg";

/**
 * TugBadge props interface.
 */
export interface TugBadgeProps extends Omit<React.ComponentPropsWithoutRef<"span">, "role"> {
  /**
   * Visual weight.
   * @selector .tug-badge-{emphasis}-{role}
   * @default "tinted"
   */
  emphasis?: TugBadgeEmphasis;
  /**
   * Color domain.
   * @selector .tug-badge-{emphasis}-{role}
   * @default "action"
   */
  role?: TugBadgeRole;
  /**
   * Badge size.
   * @selector .tug-badge-size-sm | .tug-badge-size-md | .tug-badge-size-lg
   * @default "sm"
   */
  size?: TugBadgeSize;
  /** Badge label content (required). */
  children: React.ReactNode;
  /** Lucide icon node rendered before the label. */
  icon?: React.ReactNode;
  /**
   * Override for the gap between the leading icon and the label
   * text, in CSS pixels. Defaults vary by size (3-4 px); pass an
   * explicit value when a callsite needs a tighter or looser
   * spacing than the size's natural gap. Applied as inline style
   * on the badge root (via `style.gap`); takes effect only when
   * an `icon` is supplied.
   */
  iconGap?: number;
}

// ---- TugBadge ----

export const TugBadge = React.forwardRef<HTMLSpanElement, TugBadgeProps>(
  function TugBadge({
    emphasis = "tinted",
    role = "action",
    size = "sm",
    children,
    icon,
    iconGap,
    className,
    style,
    ...rest
  }: TugBadgeProps, ref) {
    const emphasisRoleClass = `tug-badge-${emphasis}-${role}`;
    const sizeClass = `tug-badge-size-${size}`;
    // `iconGap` overrides the size's natural gap (set by the
    // `.tug-badge-size-{sm,md,lg}` CSS rules). Inline style takes
    // precedence per CSS specificity. Caller's `style` wins last
    // if the consumer wants the final say.
    const mergedStyle: React.CSSProperties | undefined =
      iconGap !== undefined
        ? { gap: `${iconGap}px`, ...style }
        : style;

    return (
      <span
        ref={ref}
        data-slot="tug-badge"
        // `data-emphasis` lets CSS dispatch on the emphasis
        // axis without parsing the role half of the class name.
        // The "ghost" variant uses it to zero out padding +
        // border (see `tug-badge.css`) so a badge with no
        // visible chrome doesn't reserve layout space for box
        // it never paints.
        data-emphasis={emphasis}
        className={cn("tug-badge", sizeClass, emphasisRoleClass, className)}
        style={mergedStyle}
        {...rest}
      >
        {icon && <span className="tug-badge-icon">{icon}</span>}
        {children}
      </span>
    );
  }
);
