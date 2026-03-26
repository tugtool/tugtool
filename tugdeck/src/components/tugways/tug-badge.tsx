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
export interface TugBadgeProps {
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
  /** Additional CSS class names. */
  className?: string;
}

// ---- TugBadge ----

export const TugBadge = React.forwardRef<HTMLSpanElement, TugBadgeProps>(
  function TugBadge({
    emphasis = "tinted",
    role = "action",
    size = "sm",
    children,
    icon,
    className,
  }: TugBadgeProps, ref) {
    const emphasisRoleClass = `tug-badge-${emphasis}-${role}`;
    const sizeClass = `tug-badge-size-${size}`;

    return (
      <span
        ref={ref}
        data-slot="tug-badge"
        className={cn("tug-badge", sizeClass, emphasisRoleClass, className)}
      >
        {icon && <span className="tug-badge-icon">{icon}</span>}
        {children}
      </span>
    );
  }
);
