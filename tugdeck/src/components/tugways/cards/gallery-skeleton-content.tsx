/**
 * gallery-skeleton-content.tsx -- TugSkeleton shimmer demo tab.
 *
 * Demonstrates TugSkeleton and TugSkeletonGroup with various configurations.
 * The shimmer animation is in the CSS lane (Rule 13 — continuous, infinite,
 * background-attachment: fixed for cross-element synchronization). [D04]
 *
 * Because background-attachment: fixed uses viewport-relative coordinates,
 * all .tug-skeleton elements on screen share the same shimmer phase —
 * the highlight sweeps across all of them simultaneously regardless of DOM
 * nesting or scroll position.
 *
 * Rules of Tugways compliance:
 *   - Shimmer uses CSS @keyframes (CSS lane, Rule 13 — continuous, infinite)
 *   - No TugAnimator usage here — TugSkeleton needs no completion handler
 *   - No React state drives appearance changes [D08, D09]
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-skeleton-content
 */

import React from "react";
import { TugSkeleton, TugSkeletonGroup } from "@/components/tugways/tug-skeleton";

// ---------------------------------------------------------------------------
// GallerySkeletonContent
// ---------------------------------------------------------------------------

/**
 * GallerySkeletonContent -- TugSkeleton shimmer demo wrapped for gallery card tab.
 *
 * Sections:
 *   1. Single skeleton at various widths and heights
 *   2. TugSkeletonGroup mimicking a text-block loading state
 *   3. Multiple groups side-by-side to demonstrate background-attachment: fixed
 *      synchronization — the highlight sweeps in phase across all groups
 *
 * **Authoritative reference:** [D04] TugSkeleton standalone, Spec S01.
 */
export function GallerySkeletonContent() {
  return (
    <div className="cg-content" data-testid="gallery-skeleton-content">

      {/* ---- Single skeleton elements ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Single Skeleton — Width Variants</div>
        <p className="cg-description">
          Each element uses <code>background-attachment: fixed</code>, so all shimmer
          highlights are synchronized to the same viewport position.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxWidth: "400px" }}>
          <TugSkeleton width="100%" height={14} />
          <TugSkeleton width="80%"  height={14} />
          <TugSkeleton width="60%"  height={14} />
          <TugSkeleton width="40%"  height={14} />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Height variants ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Single Skeleton — Height Variants</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxWidth: "400px" }}>
          <TugSkeleton width="100%" height={10} />
          <TugSkeleton width="100%" height={16} />
          <TugSkeleton width="100%" height={32} />
          <TugSkeleton width="100%" height={64} />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Radius override ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Single Skeleton — Radius Override</div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <TugSkeleton width="60px"  height={60} />
          <TugSkeleton width="60px"  height={60} radius="50%" />
          <TugSkeleton width="120px" height={60} radius="8px" />
          <TugSkeleton width="120px" height={30} radius="15px" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- TugSkeletonGroup: text block ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugSkeletonGroup — Text Block</div>
        <p className="cg-description">
          <code>TugSkeletonGroup</code> wraps skeletons in a flex column with configurable gap.
          This group mimics a paragraph of loading text.
        </p>
        <div style={{ maxWidth: "360px" }}>
          <TugSkeletonGroup gap={8}>
            <TugSkeleton width="100%" height={14} />
            <TugSkeleton width="95%"  height={14} />
            <TugSkeleton width="100%" height={14} />
            <TugSkeleton width="88%"  height={14} />
            <TugSkeleton width="72%"  height={14} />
          </TugSkeletonGroup>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Multiple groups: synchronized shimmer ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Synchronized Shimmer — Multiple Groups</div>
        <p className="cg-description">
          All shimmer elements share the same highlight phase because{" "}
          <code>background-attachment: fixed</code> uses viewport-relative coordinates.
          Notice that the highlight sweeps across both columns simultaneously.
        </p>
        <div style={{ display: "flex", gap: "24px" }}>
          {/* Column 1: card-like skeleton */}
          <div style={{ flex: 1 }}>
            <TugSkeletonGroup gap={10}>
              <TugSkeleton width="100%" height={120} radius="6px" />
              <TugSkeleton width="70%"  height={16} />
              <TugSkeleton width="50%"  height={12} />
            </TugSkeletonGroup>
          </div>
          {/* Column 2: list-like skeleton */}
          <div style={{ flex: 1 }}>
            <TugSkeletonGroup gap={12}>
              <TugSkeleton width="100%" height={32} />
              <TugSkeleton width="100%" height={32} />
              <TugSkeleton width="100%" height={32} />
              <TugSkeleton width="80%"  height={32} />
            </TugSkeletonGroup>
          </div>
        </div>
      </div>

    </div>
  );
}
