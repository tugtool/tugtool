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

/** Mini-viewport container for contained status banner demos. */
const miniViewport: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  height: "80px",
  border: "1px solid var(--tug7-element-global-border-normal-default-rest)",
  borderRadius: "6px",
  background: "var(--tug7-surface-global-primary-normal-content-rest)",
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

  const timerRefs = React.useRef<ReturnType<typeof setTimeout>[]>([]);

  React.useEffect(() => {
    const timers = timerRefs.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  function showFor3s(setter: React.Dispatch<React.SetStateAction<boolean>>) {
    setter(true);
    const t = setTimeout(() => setter(false), 3000);
    timerRefs.current.push(t);
  }

  const sampleStack = `Error: Something went critically wrong
    at ComponentTree.render (bundle.js:1234)
    at ErrorBoundary.render (bundle.js:5678)
    at ReactDOM.render (bundle.js:9012)
    at Object.create (bundle.js:3456)
    at Module.evaluate (bundle.js:7890)`;

  return (
    <div className="cg-content" data-testid="gallery-banner">

      {/* ---- 1. Status variant — danger tone (default) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Status — Danger Tone</div>
        <div style={labelStyle}>Solid-fill strip. Bold text. Full-opacity — impossible to miss.</div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <TugPushButton
            size="sm"
            emphasis="outlined"
            onClick={() => setDangerVisible((v) => !v)}
          >
            {dangerVisible ? "Hide Banner" : "Show Banner"}
          </TugPushButton>
          <TugPushButton
            size="sm"
            emphasis="outlined"
            onClick={() => showFor3s(setDangerVisible)}
          >
            Show for 3s
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
        <div style={labelStyle}>tone="caution" — solid yellow palette.</div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <TugPushButton
            size="sm"
            emphasis="outlined"
            onClick={() => setCautionVisible((v) => !v)}
          >
            {cautionVisible ? "Hide Banner" : "Show Banner"}
          </TugPushButton>
          <TugPushButton
            size="sm"
            emphasis="outlined"
            onClick={() => showFor3s(setCautionVisible)}
          >
            Show for 3s
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
        <div style={labelStyle}>tone="default" — neutral overlay palette.</div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <TugPushButton
            size="sm"
            emphasis="outlined"
            onClick={() => setDefaultVisible((v) => !v)}
          >
            {defaultVisible ? "Hide Banner" : "Show Banner"}
          </TugPushButton>
          <TugPushButton
            size="sm"
            emphasis="outlined"
            onClick={() => showFor3s(setDefaultVisible)}
          >
            Show for 3s
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
        <div style={labelStyle}>icon="wifi-off" — Lucide icon rendered inline in strip.</div>
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
        <div style={labelStyle}>
          variant="error" — two parts: bold strip at top (same urgency as status), centered detail panel
          below with stack trace + reload. Detail panel is scrollable and non-alarming.
        </div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <TugPushButton
            size="sm"
            emphasis="outlined"
            role="danger"
            onClick={() => setErrorVisible((v) => !v)}
          >
            {errorVisible ? "Hide Error" : "Show Error"}
          </TugPushButton>
        </div>
        {errorVisible && (
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
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <TugPushButton
                size="sm"
                emphasis="outlined"
                role="danger"
                onClick={() => setErrorVisible(false)}
              >
                Dismiss (demo only)
              </TugPushButton>
            </div>
          </TugBanner>
        )}
      </div>

    </div>
  );
}
