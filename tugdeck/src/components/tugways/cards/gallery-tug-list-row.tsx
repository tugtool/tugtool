/**
 * gallery-tug-list-row.tsx — TugListRow demo tab for the Component
 * Gallery.
 *
 * Seven sections, each isolating one knob of the primitive:
 *
 *   1. Variants — `flush` vs `pill`, title-only rows side by side.
 *   2. Title + subtitle — the two-line content column.
 *   3. Leading + trailing accessories — an icon on the leading edge,
 *      a badge / chevron on the trailing edge.
 *   4. Trailing reveal — `trailingReveal="hover"`: the accessory stays
 *      hidden until the row is hovered or holds focus.
 *   5. States — rest / selected / disabled.
 *   6. Selection is consumer-owned — `TugListRow` is presentational
 *      and takes no `onClick`; the demo's own wrapper owns the click
 *      and feeds `selected` back in. This is the contract a
 *      `TugListView` cell renderer fulfills.
 *   7. Children escape hatch — `children` overrides `title` /
 *      `subtitle` for non-standard content.
 *
 * @module components/tugways/cards/gallery-tug-list-row
 */

import React from "react";
import { ChevronRight, Folder, GitBranch, Trash2 } from "lucide-react";

import { TugBadge } from "@/components/tugways/tug-badge";
import { TugIconButton } from "@/components/tugways/tug-icon-button";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugListRow } from "@/components/tugways/tug-list-row";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Local demo styles
// ---------------------------------------------------------------------------

const captionStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginBottom: "8px",
};

const resultStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginTop: "8px",
};

/** Column of pill rows — the inter-row gap is the caller's, not the row's. */
const pillStackStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  width: "100%",
  maxWidth: "32.5rem",
};

/**
 * Framed panel for `flush` rows. A `flush` row is transparent and
 * draws no divider of its own — in production a `TugListView` with
 * `rowLayout="flush"` draws the 1px dividers between rows. The demo
 * panel just supplies the frame so the edge-to-edge rows read as a
 * group.
 */
const flushPanelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  maxWidth: "32.5rem",
  border: "1px solid var(--tug7-element-global-border-normal-muted-rest)",
  borderRadius: "var(--tug-radius-md)",
  overflow: "hidden",
};

const labelColumnStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.375rem",
};

const variantsRowStyle: React.CSSProperties = {
  display: "flex",
  gap: "1.5rem",
  flexWrap: "wrap",
};

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const RECENTS: ReadonlyArray<string> = [
  "/u/src/tugtool",
  "/tmp/test-project",
  "/u/src/tugtool/tugdeck",
];

// ---------------------------------------------------------------------------
// GalleryTugListRow
// ---------------------------------------------------------------------------

export function GalleryTugListRow(): React.ReactElement {
  // Section 6 — consumer-owned selection. The wrapper owns the click;
  // `TugListRow` only renders `selected`.
  const [selectedRecent, setSelectedRecent] = React.useState<string>(
    RECENTS[0],
  );

  // Section 4 — a result line so the hover-revealed icon button is
  // demonstrably live, not just decorative.
  const [revealResult, setRevealResult] = React.useState<string>("—");

  return (
    <div className="cg-content" data-testid="gallery-tug-list-row">
      {/* ---- 1. Variants ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Variants</TugLabel>
        <div style={captionStyle}>
          <code>flush</code> is edge-to-edge and transparent (dividers
          come from the enclosing <code>TugListView</code>);{" "}
          <code>pill</code> is a discrete bordered, rounded row.
        </div>
        <div style={variantsRowStyle}>
          <div style={labelColumnStyle}>
            <TugLabel className="cg-section-title">flush</TugLabel>
            <div style={flushPanelStyle}>
              <TugListRow variant="flush" title="Rest row" />
              <TugListRow variant="flush" title="Selected row" selected />
              <TugListRow variant="flush" title="Another row" />
            </div>
          </div>
          <div style={labelColumnStyle}>
            <TugLabel className="cg-section-title">pill</TugLabel>
            <div style={pillStackStyle}>
              <TugListRow variant="pill" title="Rest row" />
              <TugListRow variant="pill" title="Selected row" selected />
              <TugListRow variant="pill" title="Another row" />
            </div>
          </div>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 2. Title + subtitle ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Title + subtitle</TugLabel>
        <div style={captionStyle}>
          The two-line content column — a <code>title</code> over a
          muted <code>subtitle</code>.
        </div>
        <div style={pillStackStyle}>
          <TugListRow
            variant="pill"
            title="Add retry logic to the API client"
            subtitle="Last opened 2 hours ago"
          />
          <TugListRow
            variant="pill"
            title="Repair the capture pipeline"
            subtitle="Last opened yesterday"
          />
        </div>
      </div>

      <TugSeparator />

      {/* ---- 3. Leading + trailing accessories ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Leading + trailing accessories
        </TugLabel>
        <div style={captionStyle}>
          <code>leading</code> and <code>trailing</code> take arbitrary
          nodes — a glyph, a badge, a chevron, a control.
        </div>
        <div style={pillStackStyle}>
          <TugListRow
            variant="pill"
            leading={<Folder size={16} aria-hidden="true" />}
            title="/u/src/tugtool"
            trailing={<ChevronRight size={16} aria-hidden="true" />}
          />
          <TugListRow
            variant="pill"
            leading={<GitBranch size={16} aria-hidden="true" />}
            title="feature/list-row"
            subtitle="3 commits ahead"
            trailing={
              <TugBadge emphasis="tinted" role="action">
                live
              </TugBadge>
            }
          />
        </div>
      </div>

      <TugSeparator />

      {/* ---- 4. Trailing reveal ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Trailing reveal — hover
        </TugLabel>
        <div style={captionStyle}>
          <code>trailingReveal="hover"</code> keeps the trailing
          accessory hidden until the row is hovered or holds focus —
          the closed row reads clean. Hover a row to surface its
          delete button.
        </div>
        <div style={pillStackStyle}>
          {RECENTS.map((path) => (
            <TugListRow
              key={path}
              variant="pill"
              title={path}
              trailingReveal="hover"
              trailing={
                <TugIconButton
                  icon={<Trash2 size={14} aria-hidden="true" />}
                  aria-label={`Forget ${path}`}
                  title={`Forget ${path}`}
                  tone="danger"
                  onClick={() => setRevealResult(`Forget ${path}`)}
                />
              }
            />
          ))}
        </div>
        <div style={resultStyle}>
          Last action: <strong>{revealResult}</strong>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 5. States ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">States</TugLabel>
        <div style={captionStyle}>
          <code>selected</code> and <code>disabled</code> are inputs the
          consumer feeds — the row reflects them, it does not own them.
        </div>
        <div style={pillStackStyle}>
          <TugListRow variant="pill" title="Rest" subtitle="The resting row" />
          <TugListRow
            variant="pill"
            title="Selected"
            subtitle="Fed selected={true}"
            selected
          />
          <TugListRow
            variant="pill"
            title="Disabled"
            subtitle="Fed disabled={true}"
            disabled
          />
        </div>
      </div>

      <TugSeparator />

      {/* ---- 6. Consumer-owned selection ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Selection is consumer-owned
        </TugLabel>
        <div style={captionStyle}>
          <code>TugListRow</code> is presentational — it takes no{" "}
          <code>onClick</code>. The wrapper below owns the click and
          feeds <code>selected</code> back in. This is the contract a{" "}
          <code>TugListView</code> cell renderer fulfills.
        </div>
        <div style={pillStackStyle}>
          {RECENTS.map((path) => (
            <div
              key={path}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedRecent(path)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedRecent(path);
                }
              }}
              style={{ cursor: "pointer" }}
            >
              <TugListRow
                variant="pill"
                title={path}
                selected={path === selectedRecent}
              />
            </div>
          ))}
        </div>
        <div style={resultStyle}>
          Selected: <strong>{selectedRecent}</strong>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 7. Children escape hatch ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Children escape hatch</TugLabel>
        <div style={captionStyle}>
          When <code>children</code> is provided it owns the content
          column outright and <code>title</code> / <code>subtitle</code>{" "}
          are ignored — for rows whose content is not a plain
          title / subtitle stack.
        </div>
        <div style={pillStackStyle}>
          <TugListRow variant="pill">
            <span style={{ fontFamily: "var(--tug-font-family-mono)" }}>
              /u/src/tugtool/tugdeck/src
            </span>
          </TugListRow>
        </div>
      </div>
    </div>
  );
}
