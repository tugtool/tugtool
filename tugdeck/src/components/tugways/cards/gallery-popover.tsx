/**
 * gallery-popover.tsx -- TugPopover demo tab for the Component Gallery.
 *
 * Shows TugPopover in all modes: basic, positioning (4 sides), with arrow,
 * form content, close button, and controlled open state.
 *
 * @module components/tugways/cards/gallery-popover
 */

import React from "react";
import {
  TugPopover,
  TugPopoverTrigger,
  TugPopoverContent,
  TugPopoverClose,
  useTugPopoverClose,
  type TugPopoverHandle,
} from "@/components/tugways/tug-popover";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugInput } from "@/components/tugways/tug-input";
import { TugSwitch } from "@/components/tugways/tug-switch";
import { TugLabel } from "@/components/tugways/tug-label";

// Shared text style for paragraph content inside popovers
const paraStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  margin: 0,
  lineHeight: "1.5",
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginBottom: "4px",
};

// ---------------------------------------------------------------------------
// SaveSettingsButton — form-content popover's "Save Changes" button.
//
// Lives in its own component so we can call useTugPopoverClose() here
// without running the hook in every popover example. Clicking the
// button would normally persist the form state; for the gallery demo
// it just closes the popover via the chain. Demonstrates the pattern
// for "part of" vs "dismisses" controls inside a bare TugPopover:
// inputs / switches are handled by the focus-inside-popover filter;
// explicit dismiss buttons reach for useTugPopoverClose.
// ---------------------------------------------------------------------------

function SaveSettingsButton() {
  const closePopover = useTugPopoverClose();
  return <TugPushButton onClick={closePopover}>Save Changes</TugPushButton>;
}

// ---------------------------------------------------------------------------
// GalleryPopover
// ---------------------------------------------------------------------------

export function GalleryPopover() {
  const imperativeRef = React.useRef<TugPopoverHandle>(null);

  return (
    <div className="cg-content" data-testid="gallery-popover">

      {/* ---- 1. Basic ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Basic</TugLabel>
        <div style={labelStyle}>Default side (bottom) — click button to open popover</div>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
        <TugPopover>
          <TugPopoverTrigger>
            <TugPushButton>Open Popover</TugPushButton>
          </TugPopoverTrigger>
          <TugPopoverContent>
            <div style={{ padding: "0.75rem" }}>
              <p style={paraStyle}>
                This is a basic popover. It appears below the trigger by default and
                closes when you click outside or press Escape.
              </p>
            </div>
          </TugPopoverContent>
        </TugPopover>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 2. Positioning ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Positioning</TugLabel>
        <div style={labelStyle}>Four sides — each button opens a popover on that side</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <TugPopover>
            <TugPopoverTrigger>
              <TugPushButton>Top</TugPushButton>
            </TugPopoverTrigger>
            <TugPopoverContent side="top">
              <div style={{ padding: "0.75rem" }}>
                <p style={paraStyle}>Positioned on top.</p>
              </div>
            </TugPopoverContent>
          </TugPopover>

          <TugPopover>
            <TugPopoverTrigger>
              <TugPushButton>Bottom</TugPushButton>
            </TugPopoverTrigger>
            <TugPopoverContent side="bottom">
              <div style={{ padding: "0.75rem" }}>
                <p style={paraStyle}>Positioned on bottom.</p>
              </div>
            </TugPopoverContent>
          </TugPopover>

          <TugPopover>
            <TugPopoverTrigger>
              <TugPushButton>Left</TugPushButton>
            </TugPopoverTrigger>
            <TugPopoverContent side="left">
              <div style={{ padding: "0.75rem" }}>
                <p style={paraStyle}>Positioned on left.</p>
              </div>
            </TugPopoverContent>
          </TugPopover>

          <TugPopover>
            <TugPopoverTrigger>
              <TugPushButton>Right</TugPushButton>
            </TugPopoverTrigger>
            <TugPopoverContent side="right">
              <div style={{ padding: "0.75rem" }}>
                <p style={paraStyle}>Positioned on right.</p>
              </div>
            </TugPopoverContent>
          </TugPopover>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 3. With Arrow ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">With Arrow</TugLabel>
        <div style={labelStyle}>arrow={"{true}"} — visual connection between popover and trigger</div>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
        <TugPopover>
          <TugPopoverTrigger>
            <TugPushButton>Open With Arrow</TugPushButton>
          </TugPopoverTrigger>
          <TugPopoverContent arrow>
            <div style={{ padding: "0.75rem" }}>
              <p style={paraStyle}>
                This popover displays an arrow pointing back to its trigger element.
              </p>
            </div>
          </TugPopoverContent>
        </TugPopover>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 4. Form Content ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Form Content</TugLabel>
        <div style={labelStyle}>Popover containing interactive form fields</div>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
        <TugPopover>
          <TugPopoverTrigger>
            <TugPushButton>Edit Settings</TugPushButton>
          </TugPopoverTrigger>
          <TugPopoverContent>
            <div
              style={{
                padding: "1rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                width: "280px",
              }}
            >
              <div>
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--tug7-element-field-text-normal-label-rest)",
                    display: "block",
                    marginBottom: "4px",
                  }}
                >
                  Display Name
                </span>
                <TugInput placeholder="Enter name..." style={{ width: "100%" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={paraStyle}>Enable notifications</span>
                <TugSwitch aria-label="Enable notifications" />
              </div>
              <SaveSettingsButton />
            </div>
          </TugPopoverContent>
        </TugPopover>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 5. With Close Button ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">With Close Button</TugLabel>
        <div style={labelStyle}>TugPopoverClose wraps a TugPushButton to dismiss the popover</div>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
        <TugPopover>
          <TugPopoverTrigger>
            <TugPushButton>Open Info</TugPushButton>
          </TugPopoverTrigger>
          <TugPopoverContent>
            <div
              style={{
                padding: "0.75rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                width: "240px",
              }}
            >
              <p style={paraStyle}>
                This popover has an explicit close button at the bottom. Use TugPopoverClose
                to wrap any element that should dismiss the popover.
              </p>
              <TugPopoverClose asChild>
                <TugPushButton size="sm">Done</TugPushButton>
              </TugPopoverClose>
            </div>
          </TugPopoverContent>
        </TugPopover>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 6. Imperative ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Imperative</TugLabel>
        <div style={labelStyle}>TugPopoverHandle.open() / .close() driven from an external button</div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <TugPopover ref={imperativeRef}>
            <TugPopoverTrigger>
              <TugPushButton>Anchor</TugPushButton>
            </TugPopoverTrigger>
            <TugPopoverContent>
              <div style={{ padding: "0.75rem" }}>
                <p style={paraStyle}>
                  This popover is driven via TugPopoverHandle — an external button
                  calls ref.current.open() to open it. Dismissal still flows through
                  the responder chain (cancelDialog).
                </p>
              </div>
            </TugPopoverContent>
          </TugPopover>
          <TugPushButton onClick={() => imperativeRef.current?.open()}>
            Open via handle
          </TugPushButton>
        </div>
      </div>

    </div>
  );
}
