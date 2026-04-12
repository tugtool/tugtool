/**
 * GallerySplitPane — TugSplitPane demos for the Component Gallery.
 *
 * STEP 3 STATE: each TugSplitPanel hosts plain placeholder content (no
 * TugBox wrapper, no visual chrome). This reflects the actual Tide
 * target: panels are invisible slots, and the content components that
 * eventually mount in them (tug-markdown-view on top, tug-prompt-entry
 * on bottom) will identify themselves by what they are. Wrapping them
 * in a TugBox would add ugly rounded-corner legend chrome that nobody
 * actually wants in a split-pane layout.
 *
 * This file is a test harness for iterating on TugSplitPane under HMR.
 * It is **not** a target environment. The `.cg-content` inline-style
 * override below resets the gallery wrapper's default padding/gap/scroll
 * so the split pane can fill the card edge-to-edge — a gallery-demo
 * concern, not a component concern. TugSplitPane itself knows nothing
 * about .cg-content. See roadmap/tug-split-pane.md (Host-agnostic goal,
 * §13).
 *
 * This file continues to evolve in each subsequent step.
 */

import React from "react";
import { TugSplitPane, TugSplitPanel } from "@/components/tugways/tug-split-pane";
import { TugLabel } from "@/components/tugways/tug-label";

// Placeholder pane content — a padded div with a muted label. No border,
// no fill, no chrome. The panel is an invisible slot; this content sits
// directly on the card background as the eventual markdown view / prompt
// entry will.
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
      <TugSplitPane>
        <TugSplitPanel defaultSize={60} minSize={10}>
          <div style={PANE_CONTENT}>
            <TugLabel size="sm" color="muted">
              markdown view (T1)
            </TugLabel>
          </div>
        </TugSplitPanel>
        <TugSplitPanel defaultSize={40} minSize={10}>
          <div style={PANE_CONTENT}>
            <TugLabel size="sm" color="muted">
              prompt entry (T3.4)
            </TugLabel>
          </div>
        </TugSplitPanel>
      </TugSplitPane>
    </div>
  );
}
