/**
 * gallery-bulletin.tsx -- TugBulletin demo tab for the Component Gallery.
 *
 * Shows the bulletin() fire-and-forget API in all modes: default, with
 * description, tone variants, action button, and custom duration.
 *
 * @module components/tugways/cards/gallery-bulletin
 */

import React from "react";
import { bulletin } from "@/components/tugways/tug-bulletin";
import { TugPushButton } from "@/components/tugways/tug-push-button";

const labelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginBottom: "4px",
};

// ---------------------------------------------------------------------------
// GalleryBulletin — public export
// ---------------------------------------------------------------------------

/**
 * GalleryBulletin — TugBulletin demo tab.
 *
 * TugBulletinViewport is mounted in the root render tree (deck-manager.ts),
 * so bulletins fired here appear in the viewport overlay.
 */
export function GalleryBulletin() {
  return (
    <div className="cg-content" data-testid="gallery-bulletin">

      {/* ---- 1. Default bulletin ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Default Bulletin</div>
        <div style={labelStyle}>bulletin() — basic fire-and-forget notification</div>
        <div style={{ display: "flex" }}>
          <TugPushButton
            emphasis="outlined"
            size="sm"
            onClick={() => bulletin("Card saved successfully")}
          >
            Save Card
          </TugPushButton>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 2. With description ---- */}
      <div className="cg-section">
        <div className="cg-section-title">With Description</div>
        <div style={labelStyle}>bulletin(message, &#123; description &#125;) — adds supporting detail below title</div>
        <div style={{ display: "flex" }}>
          <TugPushButton
            emphasis="outlined"
            size="sm"
            onClick={() =>
              bulletin("Export complete", {
                description: "3 cards exported to ~/Desktop",
              })
            }
          >
            Export Cards
          </TugPushButton>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 3. Tone variants ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Tone Variants</div>
        <div style={labelStyle}>bulletin(), bulletin.success(), bulletin.danger(), bulletin.caution() — left-border accent</div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <TugPushButton
            emphasis="outlined"
            size="sm"
            onClick={() => bulletin("File renamed")}
          >
            Default
          </TugPushButton>
          <TugPushButton
            emphasis="outlined"
            size="sm"
            role="action"
            onClick={() => bulletin.success("Sync complete")}
          >
            Success
          </TugPushButton>
          <TugPushButton
            emphasis="outlined"
            size="sm"
            role="danger"
            onClick={() => bulletin.danger("Upload failed")}
          >
            Danger
          </TugPushButton>
          <TugPushButton
            emphasis="outlined"
            size="sm"
            role="danger"
            onClick={() => bulletin.caution("Low disk space")}
          >
            Caution
          </TugPushButton>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 4. With action ---- */}
      <div className="cg-section">
        <div className="cg-section-title">With Action</div>
        <div style={labelStyle}>bulletin(message, &#123; action &#125;) — inline action button for quick follow-up</div>
        <div style={{ display: "flex" }}>
          <TugPushButton
            emphasis="outlined"
            size="sm"
            onClick={() =>
              bulletin("File uploaded", {
                action: { label: "View", onClick: () => {} },
              })
            }
          >
            Upload File
          </TugPushButton>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 5. Custom duration ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Custom Duration</div>
        <div style={labelStyle}>bulletin(message, &#123; duration: 8000 &#125;) — stays visible for 8 seconds</div>
        <div style={{ display: "flex" }}>
          <TugPushButton
            emphasis="outlined"
            size="sm"
            onClick={() =>
              bulletin("Processing large batch…", {
                description: "This may take a moment.",
                duration: 8000,
              })
            }
          >
            Start Batch
          </TugPushButton>
        </div>
      </div>

    </div>
  );
}
