/**
 * TugBadge -- tugways display badge component.
 *
 * A compact, pill-shaped label for surfacing status, role, or category at a
 * glance. Shares the same emphasis x role axis system as TugButton.
 *
 * Emphasis x Role API [D06, Spec S06]:
 *   `emphasis` controls visual weight (filled/outlined/ghost), default: "filled"
 *   `role`     controls color domain (accent/active/agent/data/danger/success/caution), default: "active"
 *   Compound CSS class: tug-badge-{emphasis}-{role}
 *
 * Token strategy (Spec S08, S09):
 *   Tier 1 (8 Table T01 combos): reference --tug-base-control-{emphasis}-{role}-*-rest directly
 *   Tier 2 (success, caution): derive from tone families and fg-on{Role} tokens
 *   Non-T01 combos (7 remaining): derive from tone families per Spec S09
 *
 * [D06] TugBadge API: emphasis + role + size + children
 * Spec S06, S07, S08, S09
 */

import React from "react";
import { cn } from "@/lib/utils";
import "./tug-badge.css";

// ---- Types ----

/** TugBadge emphasis values — controls visual weight (Spec S06) */
export type TugBadgeEmphasis = "filled" | "outlined" | "ghost";

/** TugBadge role values — controls color domain (Spec S06); includes all 7 roles */
export type TugBadgeRole =
  | "accent"
  | "active"
  | "agent"
  | "data"
  | "danger"
  | "success"
  | "caution";

/** TugBadge size names (Spec S07) */
export type TugBadgeSize = "sm" | "md" | "lg";

/**
 * TugBadge props interface (Spec S06).
 */
export interface TugBadgeProps {
  /** Visual weight. Default: "filled". Controls filled/outlined/ghost styling. */
  emphasis?: TugBadgeEmphasis;
  /** Color domain. Default: "active". Controls the hue family. */
  role?: TugBadgeRole;
  /** Badge size. Default: "sm". */
  size?: TugBadgeSize;
  /** Badge label content (required). */
  children: React.ReactNode;
  /** Additional CSS class names. */
  className?: string;
}

// ---- TugBadge ----

/**
 * TugBadge -- tugways badge component.
 *
 * Compact pill-shaped label for status, role, or category. Display-only:
 * no hover or active states. Styling is entirely CSS custom property driven.
 *
 * emphasis: "filled" | "outlined" | "ghost" (default: "filled")
 * role:     "accent" | "active" | "agent" | "data" | "danger" | "success" | "caution" (default: "active")
 * size:     "sm" | "md" | "lg" (default: "sm")
 */
export function TugBadge({
  emphasis = "filled",
  role = "active",
  size = "sm",
  children,
  className,
}: TugBadgeProps) {
  const emphasisRoleClass = `tug-badge-${emphasis}-${role}`;
  const sizeClass = `tug-badge-size-${size}`;

  return (
    <span className={cn("tug-badge", sizeClass, emphasisRoleClass, className)}>
      {children}
    </span>
  );
}
