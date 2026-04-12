/**
 * GallerySplitPane — TugSplitPane demos for the Component Gallery.
 *
 * STEP 2 STATE: now uses the TugSplitPane / TugSplitPanel wrappers instead
 * of raw react-resizable-panels primitives. Horizontal 2-pane split only —
 * vertical orientation and nesting return in later steps as the wrapper
 * grows to support them. The sash is still a 1px scaffold line (tokens
 * and chrome arrive in steps 4–6).
 *
 * This file is a test harness for iterating on TugSplitPane under HMR.
 * It is **not** a target environment and TugSplitPane knows nothing about
 * it. The `.cg-content` inline-style override below is a gallery-demo
 * concern — it resets the gallery wrapper's default padding/gap/scroll so
 * the split pane can fill the card edge-to-edge. That override is a
 * property of this demo file, not of the component. See
 * roadmap/tug-split-pane.md (Host-agnostic goal, §13).
 *
 * This file continues to evolve in each subsequent step.
 */

import React from "react";
import { TugSplitPane, TugSplitPanel } from "@/components/tugways/tug-split-pane";

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
        <TugSplitPanel
          defaultSize={60}
          minSize={10}
          style={{
            padding: 12,
            background: "rgba(100, 150, 255, 0.08)",
            fontFamily: "monospace",
            fontSize: 12,
          }}
        >
          top pane (60%)
        </TugSplitPanel>
        <TugSplitPanel
          defaultSize={40}
          minSize={10}
          style={{
            padding: 12,
            background: "rgba(255, 180, 100, 0.08)",
            fontFamily: "monospace",
            fontSize: 12,
          }}
        >
          bottom pane (40%)
        </TugSplitPanel>
      </TugSplitPane>
    </div>
  );
}
