/**
 * GalleryTitleBar -- interactive demo of CardTitleBar controls.
 *
 * Shows a CardTitleBar in isolation (outside a real Tugcard frame) with interactive
 * controls for toggling the collapsed state and selecting the icon.
 *
 * [D07] Window-shade collapse
 * Step 3: Card Frame & Title Bar
 *
 * @module components/tugways/cards/gallery-title-bar
 */

import React, { useId, useState } from "react";
import { CardTitleBar } from "@/components/tugways/tug-card";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import { useResponderForm } from "@/components/tugways/use-responder-form";

// ---------------------------------------------------------------------------
// GalleryTitleBar
// ---------------------------------------------------------------------------

/**
 * GalleryTitleBar -- interactive demo of CardTitleBar controls.
 *
 * Shows a CardTitleBar in isolation (outside a real Tugcard frame) with interactive
 * controls for toggling the collapsed state and selecting the icon.
 *
 * [D07] Window-shade collapse
 * Step 3: Card Frame & Title Bar
 */
export function GalleryTitleBar() {
  const [collapsed, setCollapsed] = useState(false);
  const [iconName, setIconName] = useState<string>("Layout");
  const [closable, setClosable] = useState(true);
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  const handleCollapse = () => {
    setCollapsed((c) => !c);
    setLastEvent(collapsed ? "expanded" : "collapsed");
  };

  const handleClose = () => {
    setLastEvent("close clicked");
  };

  // L11 migration via useResponderForm — the icon picker dispatches
  // setValue with a string payload; its binding writes iconName state.
  const iconPopupId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    setValueString: {
      [iconPopupId]: setIconName,
    },
  });

  return (
    <ResponderScope>
    <div
      className="cg-content"
      data-testid="gallery-title-bar"
      ref={responderRef as (el: HTMLDivElement | null) => void}
    >
      <div className="cg-section">
        <div className="cg-section-title">Title Bar Demo (Step 3)</div>
        <p className="cg-description">
          CardTitleBar in isolation: collapse/expand toggle (chevron), menu (horizontal
          ellipsis), and close buttons.
        </p>
      </div>

      <div className="cg-divider" />

      {/* ---- Interactive Controls ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Preview Controls</div>
        <div className="cg-controls">
          <div className="cg-control-group">
            <label className="cg-control-label">
              Icon
            </label>
            <TugPopupButton
              label={iconName || "None"}
              size="sm"
              senderId={iconPopupId}
              items={[
                { action: "setValue", value: "", label: "None" },
                { action: "setValue", value: "Layout", label: "Layout" },
                { action: "setValue", value: "Settings", label: "Settings" },
                { action: "setValue", value: "Terminal", label: "Terminal" },
                { action: "setValue", value: "Code", label: "Code" },
              ]}
            />
          </div>

          <div className="cg-control-group">
            <input
              id="cg-title-closable-check"
              type="checkbox"
              className="cg-control-checkbox"
              checked={closable}
              onChange={(e) => setClosable(e.target.checked)}
            />
            <label className="cg-control-label" htmlFor="cg-title-closable-check">
              Closable
            </label>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Live CardTitleBar Demo ---- */}
      <div className="cg-section">
        <div className="cg-section-title">CardTitleBar — Live Demo</div>
        <div
          style={{
            border: "1px solid var(--tugx-card-border)",
            borderRadius: "var(--tug-radius-md)",
            overflow: "hidden",
            background: "var(--tugx-card-title-bar-bg-inactive)",
          }}
          data-testid="gallery-card-title-bar-demo"
        >
          <CardTitleBar
            title="Demo Card"
            icon={iconName || undefined}
            closable={closable}
            collapsed={collapsed}
            onCollapse={handleCollapse}
            onClose={handleClose}
          />
          {!collapsed && (
            <div
              style={{
                padding: "12px",
                background: "var(--tug7-surface-global-primary-normal-default-rest)",
                fontSize: "12px",
                color: "var(--tug7-element-global-text-normal-muted-rest)",
                minHeight: "48px",
              }}
            >
              Card content area (visible when expanded)
            </div>
          )}
        </div>

        {lastEvent !== null && (
          <div className="cg-demo-status" data-testid="gallery-title-bar-event-status">
            Last event: <code>{lastEvent}</code>
          </div>
        )}

        <div style={{ marginTop: "8px" }}>
          <TugPushButton
            size="sm"
            onClick={handleCollapse}
          >
            {collapsed ? "Expand" : "Collapse"}
          </TugPushButton>
        </div>
      </div>

    </div>
    </ResponderScope>
  );
}
