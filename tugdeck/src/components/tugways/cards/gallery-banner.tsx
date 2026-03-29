/**
 * gallery-banner.tsx -- TugBanner demo tab for the Component Gallery.
 *
 * Shows TugBanner in all modes: status variant with three tones (danger, caution,
 * default), status variant with icon, and error variant with sample stack trace.
 *
 * All demos use the `contained` prop to prevent the banner from blocking the app
 * or setting `inert` on the real deck canvas. Each demo renders inside a
 * mini-viewport wrapper div.
 *
 * @module components/tugways/cards/gallery-banner
 */

import React from "react";
import { TugBanner } from "@/components/tugways/tug-banner";
import { TugPushButton } from "@/components/tugways/tug-push-button";

const labelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginBottom: "4px",
};

/** Mini-viewport container for contained banner demos. */
const miniViewport: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  height: "64px",
  border: "1px solid var(--tug7-element-global-border-normal-default-rest)",
  borderRadius: "6px",
  background: "var(--tug7-surface-global-primary-normal-content-rest)",
};

/** Mini-viewport for the error variant (taller to show content). */
const miniViewportError: React.CSSProperties = {
  ...miniViewport,
  height: "200px",
};

/** Placeholder content inside the mini-viewport so there's something to dim. */
function MiniContent() {
  return (
    <div
      style={{
        padding: "12px 16px",
        fontSize: "0.8rem",
        color: "var(--tug7-element-global-text-normal-muted-rest)",
        userSelect: "none",
      }}
    >
      App content behind banner
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryBanner
// ---------------------------------------------------------------------------

export function GalleryBanner() {
  const [dangerVisible, setDangerVisible] = React.useState(false);
  const [cautionVisible, setCautionVisible] = React.useState(false);
  const [defaultVisible, setDefaultVisible] = React.useState(false);
  const [iconVisible, setIconVisible] = React.useState(false);
  const [errorVisible, setErrorVisible] = React.useState(false);

  const sampleStack = `Error: Something went critically wrong
    at ComponentTree.render (bundle.js:1234)
    at ErrorBoundary.render (bundle.js:5678)
    at ReactDOM.render (bundle.js:9012)`;

  return (
    <div className="cg-content" data-testid="gallery-banner">

      {/* ---- 1. Status variant — danger tone (default) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Status — Danger Tone</div>
        <div style={labelStyle}>Default tone. Slide-in/out animation. App content below is dimmed by scrim (contained demo).</div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <TugPushButton
            size="sm"
            emphasis="outlined"
            onClick={() => setDangerVisible((v) => !v)}
          >
            {dangerVisible ? "Hide Banner" : "Show Banner"}
          </TugPushButton>
        </div>
        <div style={miniViewport} data-slot="deck-canvas">
          <MiniContent />
          <TugBanner
            contained
            visible={dangerVisible}
            variant="status"
            tone="danger"
            message="Connection lost — attempting to reconnect..."
          />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 2. Status variant — caution tone ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Status — Caution Tone</div>
        <div style={labelStyle}>tone="caution" — yellow palette.</div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <TugPushButton
            size="sm"
            emphasis="outlined"
            onClick={() => setCautionVisible((v) => !v)}
          >
            {cautionVisible ? "Hide Banner" : "Show Banner"}
          </TugPushButton>
        </div>
        <div style={miniViewport}>
          <MiniContent />
          <TugBanner
            contained
            visible={cautionVisible}
            variant="status"
            tone="caution"
            message="Maintenance mode — reconnecting in 30s..."
          />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 3. Status variant — default tone ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Status — Default Tone</div>
        <div style={labelStyle}>tone="default" — neutral palette.</div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <TugPushButton
            size="sm"
            emphasis="outlined"
            onClick={() => setDefaultVisible((v) => !v)}
          >
            {defaultVisible ? "Hide Banner" : "Show Banner"}
          </TugPushButton>
        </div>
        <div style={miniViewport}>
          <MiniContent />
          <TugBanner
            contained
            visible={defaultVisible}
            variant="status"
            tone="default"
            message="Syncing workspace..."
          />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 4. Status variant with icon ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Status with Icon</div>
        <div style={labelStyle}>icon="wifi-off" — Lucide icon rendered inline.</div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <TugPushButton
            size="sm"
            emphasis="outlined"
            onClick={() => setIconVisible((v) => !v)}
          >
            {iconVisible ? "Hide Banner" : "Show Banner"}
          </TugPushButton>
        </div>
        <div style={miniViewport}>
          <MiniContent />
          <TugBanner
            contained
            visible={iconVisible}
            variant="status"
            tone="danger"
            message="No connection — check your network"
            icon="wifi-off"
          />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 5. Error variant ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Error Variant</div>
        <div style={labelStyle}>variant="error" — full-panel with stack trace and reload button. Conditionally rendered (no exit animation).</div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <TugPushButton
            size="sm"
            emphasis="outlined"
            role="danger"
            onClick={() => setErrorVisible((v) => !v)}
          >
            {errorVisible ? "Hide Error Panel" : "Show Error Panel"}
          </TugPushButton>
        </div>
        {errorVisible && (
          <div style={miniViewportError}>
            <TugBanner
              contained
              visible={true}
              variant="error"
              tone="danger"
              message="Render Error: Something went critically wrong"
            >
              <pre style={{ margin: "0 0 12px", whiteSpace: "pre-wrap" }}>
                {sampleStack}
              </pre>
              <TugPushButton
                size="sm"
                emphasis="outlined"
                role="danger"
                onClick={() => setErrorVisible(false)}
              >
                Dismiss (demo only)
              </TugPushButton>
            </TugBanner>
          </div>
        )}
      </div>

    </div>
  );
}
