/**
 * GallerySplitPane — TugSplitPane demos for the Component Gallery.
 *
 * STEP 10 STATE: the step-9 composition with tugbank persistence.
 * Both the outer and the nested inner split panes declare a
 * `storageKey`; every TugSplitPanel declares a stable `id`. The
 * layout (including the bottom panel's collapsed state, which is
 * just a flex-grow of 0 in the Layout map) survives reloads.
 *
 * This file is a test harness for iterating on TugSplitPane under HMR.
 * It is **not** a target environment. The `.cg-content` inline-style
 * override below is a gallery-demo concern — TugSplitPane itself
 * knows nothing about it. See roadmap/tug-split-pane.md
 * (Host-agnostic goal, §13).
 *
 * This file continues to evolve in each subsequent step.
 */

import React from "react";
import { TugSplitPane, TugSplitPanel } from "@/components/tugways/tug-split-pane";
import { TugLabel } from "@/components/tugways/tug-label";

// Placeholder pane content — a padded div with a muted label. No border,
// no fill, no chrome. The panel is an invisible slot.
const PANE_CONTENT: React.CSSProperties = {
  padding: 16,
  height: "100%",
  boxSizing: "border-box",
};

// ---- GallerySplitPane ----

export function GallerySplitPane() {
  return (
    <div
      className="cg-content"
      data-testid="gallery-split-pane"
      style={{
        padding: 0,
        gap: 0,
        overflow: "hidden",
        height: "100%",
      }}
    >
      <TugSplitPane orientation="horizontal" storageKey="gallery.outer">
        <TugSplitPanel id="outer-top" defaultSize="60%" minSize="20%">
          <TugSplitPane orientation="vertical" storageKey="gallery.inner">
            <TugSplitPanel id="inner-left" defaultSize="50%" minSize="25%">
              <div style={PANE_CONTENT}>
                <TugLabel size="sm" color="muted">
                  top left
                </TugLabel>
              </div>
            </TugSplitPanel>
            <TugSplitPanel id="inner-right" defaultSize="50%" minSize="25%">
              <div style={PANE_CONTENT}>
                <TugLabel size="sm" color="muted">
                  top right
                </TugLabel>
              </div>
            </TugSplitPanel>
          </TugSplitPane>
        </TugSplitPanel>
        <TugSplitPanel id="outer-bottom" defaultSize="40%" minSize="20%" collapsible>
          <div style={PANE_CONTENT}>
            <TugLabel size="sm" color="muted">
              bottom
            </TugLabel>
          </div>
        </TugSplitPanel>
      </TugSplitPane>
    </div>
  );
}
