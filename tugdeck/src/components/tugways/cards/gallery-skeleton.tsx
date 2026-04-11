/**
 * gallery-skeleton.tsx -- TugSkeleton gallery card.
 *
 * Demonstrates TugSkeleton and TugSkeletonGroup with various
 * widths, heights, radii, groups, and side-by-side synchronization.
 */

import React from "react";
import { TugSkeleton, TugSkeletonGroup } from "@/components/tugways/tug-skeleton";
import { TugLabel } from "@/components/tugways/tug-label";

// ---------------------------------------------------------------------------
// GallerySkeleton
// ---------------------------------------------------------------------------

export function GallerySkeleton() {
  return (
    <div className="cg-content" data-testid="gallery-skeleton">

      {/* ---- Single skeleton elements ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugSkeleton — Width Variants</TugLabel>
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
        <TugLabel className="cg-section-title">TugSkeleton — Height Variants</TugLabel>
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
        <TugLabel className="cg-section-title">TugSkeleton — Radius Override</TugLabel>
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
        <TugLabel className="cg-section-title">TugSkeletonGroup — Text Block</TugLabel>
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
        <TugLabel className="cg-section-title">TugSkeleton — Multiple Groups Side by Side</TugLabel>
        <p className="cg-description">
          All skeleton elements share the same CSS pulse animation, so
          elements across separate groups breathe in sync.
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
