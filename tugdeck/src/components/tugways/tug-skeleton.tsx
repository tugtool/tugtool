/**
 * TugSkeleton — shimmer loading placeholder.
 *
 * Renders animated placeholder elements using CSS @keyframes for
 * cross-element synchronized shimmer. Decorative only (aria-hidden).
 *
 * Laws: [L06] appearance via CSS, [L19] component authoring guide
 * Decisions: [D04] standalone skeleton with CSS shimmer, [D05] skeleton tokens per theme
 */

import "./tug-skeleton.css";

import React from "react";
import { cn } from "@/lib/utils";

// ---- Types ----

/** Props for a single TugSkeleton shimmer placeholder. */
export interface TugSkeletonProps extends React.ComponentPropsWithoutRef<"div"> {
  /**
   * Width of the skeleton element. CSS value string (e.g., "60%", "100px").
   * @default "100%"
   */
  width?: string;
  /**
   * Height in pixels.
   * @default 14
   */
  height?: number;
  /** Border radius override. Default: uses --tug-radius-sm token via CSS class */
  radius?: string;
}

/** Props for TugSkeletonGroup, which wraps multiple TugSkeleton elements. */
export interface TugSkeletonGroupProps
  extends React.ComponentPropsWithoutRef<"div"> {
  /**
   * Gap between skeleton elements in pixels.
   * @default 8
   */
  gap?: number;
  /** Child TugSkeleton elements */
  children: React.ReactNode;
}

// ---- TugSkeleton ----

export const TugSkeleton = React.forwardRef<HTMLDivElement, TugSkeletonProps>(
  function TugSkeleton(
    { width = "100%", height = 14, radius, className, ...rest },
    ref,
  ) {
    const style: React.CSSProperties = {
      width,
      height: `${height}px`,
    };
    if (radius !== undefined) {
      style.borderRadius = radius;
    }

    return (
      <div
        ref={ref}
        data-slot="tug-skeleton"
        className={cn("tug-skeleton", className)}
        style={style}
        aria-hidden="true"
        {...rest}
      />
    );
  },
);

// ---- TugSkeletonGroup ----

export const TugSkeletonGroup = React.forwardRef<
  HTMLDivElement,
  TugSkeletonGroupProps
>(function TugSkeletonGroup({ gap = 8, children, className, ...rest }, ref) {
  return (
    <div
      ref={ref}
      data-slot="tug-skeleton-group"
      className={cn("tug-skeleton-group", className)}
      style={{ gap: `${gap}px` }}
      {...rest}
    >
      {children}
    </div>
  );
});
