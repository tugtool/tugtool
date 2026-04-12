/**
 * GallerySplitPane — TugSplitPane demos for the Component Gallery.
 *
 * STEP 1 STATE (smoke test): renders the raw react-resizable-panels
 * `Group`/`Panel`/`Separator` primitives with plain inline styles. No
 * TugSplitPane wrapper yet (that arrives in step 2), no TugBox content
 * (step 3), no tokens (step 4). The only job of this file right now is
 * to prove the library is installed correctly, renders at all under
 * HMR, fills its container, and supports nesting.
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
 * concrete height. The fill-the-card pattern is to override .cg-content
 * with `{ padding: 0, gap: 0, overflow: hidden, height: "100%" }` so
 * the gallery wrapper stops adding its default padding/gap/scroll and
 * the Group's `height: 100%` resolves against a real pixel height.
 * This pattern is borrowed from gallery-markdown-view.tsx.
 *
 * Focus styling note: the library's Separator is keyboard-focusable
 * (good — we want arrow-key resize in step 12). The browser's default
 * focus outline is distracting in the smoke test, so we set
 * `outline: none` on the separator inline style for now. Proper
 * sash focus-visible styling arrives in step 5 as part of sash states.
 *
 * This file will be rewritten in each subsequent step. Everything here
 * is throwaway.
 */

import React from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

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
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Group
        orientation="vertical"
        style={{
          flex: 1,
          minHeight: 0,
          width: "100%",
        }}
      >
        <Panel
          defaultSize="50%"
          minSize="10%"
          style={{
            padding: 12,
            background: "rgba(100, 150, 255, 0.08)",
            fontFamily: "monospace",
            fontSize: 12,
          }}
        >
          top pane (fills full card width)
        </Panel>
        <Separator
          style={{
            height: 6,
            background: "#666",
            cursor: "ns-resize",
            outline: "none",
          }}
        />
        {/* Bottom panel contains a nested horizontal split to prove
            nesting works. The inner Group is side-by-side; its Separator
            is a vertical bar with ew-resize cursor. */}
        <Panel
          defaultSize="50%"
          minSize="10%"
          style={{
            background: "rgba(255, 180, 100, 0.08)",
          }}
        >
          <Group
            orientation="horizontal"
            style={{
              width: "100%",
              height: "100%",
            }}
          >
            <Panel
              defaultSize="50%"
              minSize="10%"
              style={{
                padding: 12,
                fontFamily: "monospace",
                fontSize: 12,
              }}
            >
              nested left
            </Panel>
            <Separator
              style={{
                width: 6,
                background: "#666",
                cursor: "ew-resize",
                outline: "none",
              }}
            />
            <Panel
              defaultSize="50%"
              minSize="10%"
              style={{
                padding: 12,
                fontFamily: "monospace",
                fontSize: 12,
              }}
            >
              nested right
            </Panel>
          </Group>
        </Panel>
      </Group>
    </div>
  );
}
