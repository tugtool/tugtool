/**
 * GallerySplitPane — TugSplitPane demos for the Component Gallery.
 *
 * STEP 1 STATE (smoke test): renders the raw react-resizable-panels
 * `Group`/`Panel`/`Separator` primitives with plain inline styles. No
 * TugSplitPane wrapper yet (that arrives in step 2), no TugBox content
 * (step 3), no tokens (step 4). The only job of this file right now is
 * to prove the library is installed correctly and renders at all under
 * HMR.
 *
 * Important orientation note for step 2:
 * react-resizable-panels v4 uses `orientation="vertical"` to mean
 * "panels stacked top-to-bottom" (i.e. a horizontal dividing line
 * between them), and `orientation="horizontal"` to mean "panels
 * arranged side-by-side" (a vertical dividing line). This is the
 * OPPOSITE of the tug-split-pane roadmap doc convention, which names
 * orientation after the dividing line (matching NSSplitView / VS Code).
 * The TugSplitPane wrapper in step 2 must invert before passing
 * `orientation` through to the library.
 *
 * Layout note: react-resizable-panels requires its Group to have a
 * concrete height to size its children. Gallery card content areas
 * don't universally propagate height, so this smoke test uses a fixed
 * 400px-tall outer box. The step-2 wrapper will address this more
 * carefully (probably by requiring the consumer to constrain the
 * parent, and documenting it in the prop JSDoc).
 *
 * This file will be rewritten in each subsequent step. Everything here
 * is throwaway.
 */

import React from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

// ---- GallerySplitPane ----

export function GallerySplitPane() {
  return (
    <div className="cg-content" data-testid="gallery-split-pane">
      <div style={{ padding: 16 }}>
        <div style={{ height: 400 }}>
          <Group
            orientation="vertical"
            style={{
              width: "100%",
              height: "100%",
              border: "1px dashed #888",
              borderRadius: 4,
            }}
          >
            <Panel
              defaultSize="60%"
              minSize="10%"
              style={{
                padding: 12,
                background: "rgba(100, 150, 255, 0.08)",
                fontFamily: "monospace",
                fontSize: 12,
              }}
            >
              top pane (60%)
            </Panel>
            <Separator
              style={{
                height: 6,
                background: "#666",
                cursor: "ns-resize",
              }}
            />
            <Panel
              defaultSize="40%"
              minSize="10%"
              style={{
                padding: 12,
                background: "rgba(255, 180, 100, 0.08)",
                fontFamily: "monospace",
                fontSize: 12,
              }}
            >
              bottom pane (40%)
            </Panel>
          </Group>
        </div>
      </div>
    </div>
  );
}
