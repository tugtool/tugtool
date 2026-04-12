/**
 * GallerySplitPane — TugSplitPane demos for the Component Gallery.
 *
 * STEP 9 STATE: the composition from step 8, plus snap-to-close on
 * the bottom panel. Drag the outer sash down past the bottom panel's
 * `minSize` and it collapses to zero; drag back up and it reopens at
 * its min.
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
      <TugSplitPane orientation="horizontal">
        <TugSplitPanel defaultSize="60%" minSize="20%">
          <TugSplitPane orientation="vertical">
            <TugSplitPanel defaultSize="50%" minSize="25%">
              <div style={PANE_CONTENT}>
                <TugLabel size="sm" color="muted">
                  top left
                </TugLabel>
              </div>
            </TugSplitPanel>
            <TugSplitPanel defaultSize="50%" minSize="25%">
              <div style={PANE_CONTENT}>
                <TugLabel size="sm" color="muted">
                  top right
                </TugLabel>
              </div>
            </TugSplitPanel>
          </TugSplitPane>
        </TugSplitPanel>
        <TugSplitPanel defaultSize="40%" minSize="20%" collapsible>
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
