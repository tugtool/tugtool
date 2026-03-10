/**
 * TugSkeleton -- tugways skeleton loading placeholder component.
 *
 * Renders shimmer placeholders using CSS @keyframes td-shimmer +
 * background-attachment: fixed for cross-element synchronization.
 * The shimmer is in the CSS lane (Rule 13 — continuous, infinite,
 * no completion handler needed). [D04]
 *
 * Crossfade wiring (skeleton-to-content transition) is deferred to
 * Phase 8c per user direction. [D04]
 *
 * **Authoritative references:**
 * - [D04] TugSkeleton standalone with CSS shimmer
 * - [D05] Standalone skeleton tokens per theme
 * - Spec S01: TugSkeletonProps, TugSkeletonGroupProps
 */

import React from "react";
import "./tug-skeleton.css";

// ---- Types (Spec S01) ----

/**
 * Props for a single TugSkeleton shimmer placeholder.
 *
 * **Authoritative reference:** Spec S01 TugSkeletonProps.
 */
export interface TugSkeletonProps {
  /** Width of the skeleton element. CSS value string (e.g., "60%", "100px"). Default: "100%" */
  width?: string;
  /** Height in pixels. Default: 14 */
  height?: number;
  /** Border radius override. Default: uses --tug-base-radius-sm token via CSS class */
  radius?: string;
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for TugSkeletonGroup, which wraps multiple TugSkeleton elements.
 *
 * **Authoritative reference:** Spec S01 TugSkeletonGroupProps.
 */
export interface TugSkeletonGroupProps {
  /** Gap between skeleton elements in pixels. Default: 8 */
  gap?: number;
  /** Child TugSkeleton elements */
  children: React.ReactNode;
  /** Additional CSS class names */
  className?: string;
}

// ---- TugSkeleton ----

/**
 * TugSkeleton -- single shimmer placeholder element.
 *
 * Renders a div with the `tug-skeleton` CSS class, which applies the
 * td-shimmer animation and background-attachment: fixed. Width and height
 * are applied as inline styles. Border radius defaults to the
 * --tug-base-radius-sm token via CSS; pass `radius` to override.
 */
export function TugSkeleton({
  width = "100%",
  height = 14,
  radius,
  className,
}: TugSkeletonProps) {
  const style: React.CSSProperties = {
    width,
    height: `${height}px`,
  };
  if (radius !== undefined) {
    style.borderRadius = radius;
  }

  const classes = ["tug-skeleton", className].filter(Boolean).join(" ");

  return <div className={classes} style={style} aria-hidden="true" />;
}

// ---- TugSkeletonGroup ----

/**
 * TugSkeletonGroup -- flex column wrapper for multiple TugSkeleton elements.
 *
 * Applies consistent gap between skeleton elements. Because
 * background-attachment: fixed is set on each .tug-skeleton, the shimmer
 * highlight sweeps synchronously across all children in the viewport. [D04]
 */
export function TugSkeletonGroup({
  gap = 8,
  children,
  className,
}: TugSkeletonGroupProps) {
  const classes = ["tug-skeleton-group", className].filter(Boolean).join(" ");

  return (
    <div className={classes} style={{ gap: `${gap}px` }}>
      {children}
    </div>
  );
}
