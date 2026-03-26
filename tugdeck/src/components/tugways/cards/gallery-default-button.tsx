/**
 * GalleryDefaultButton -- default button registration + Enter-key demo.
 *
 * Renders a primary "Confirm" button and a secondary "Cancel" button. The
 * Confirm button is registered as the default button via useLayoutEffect on
 * mount and cleared on unmount. Pressing Enter when neither button is focused
 * activates Confirm via the stage-2 bubble-pipeline shortcut.
 *
 * Rules of Tugways compliance:
 * - [D41] useLayoutEffect for registrations that events depend on
 * - [D40] Local UI state (last action) uses useState -- this is local component
 *   state, not external store state, so useSyncExternalStore does not apply
 *
 * **Authoritative reference:** [D01] gallery-default-button componentId.
 *
 * @module components/tugways/cards/gallery-default-button
 */

import React, { useState, useRef, useLayoutEffect } from "react";
import { useRequiredResponderChain } from "@/components/tugways/responder-chain-provider";
import { TugPushButton } from "@/components/tugways/tug-push-button";

// ---------------------------------------------------------------------------
// GalleryDefaultButton
// ---------------------------------------------------------------------------

/**
 * GalleryDefaultButton -- default button registration + Enter-key demo.
 *
 * Renders a primary "Confirm" button and a secondary "Cancel" button. The
 * Confirm button is registered as the default button via useLayoutEffect on
 * mount and cleared on unmount. Pressing Enter when neither button is focused
 * activates Confirm via the stage-2 bubble-pipeline shortcut.
 *
 * Rules of Tugways compliance:
 * - [D41] useLayoutEffect for registrations that events depend on
 * - [D40] Local UI state (last action) uses useState -- this is local component
 *   state, not external store state, so useSyncExternalStore does not apply
 *
 * **Authoritative reference:** [D01] gallery-default-button componentId.
 */
export function GalleryDefaultButton() {
  const manager = useRequiredResponderChain();
  const confirmContainerRef = useRef<HTMLSpanElement | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  useLayoutEffect(() => {
    // Find the underlying <button> DOM element inside the TugButton wrapper span.
    // TugButton does not support ref forwarding, so we locate the button via the
    // container span. This is safe: the span holds exactly one button child.
    const btn = confirmContainerRef.current?.querySelector("button") ?? null;
    if (!btn) return;
    manager.setDefaultButton(btn);
    return () => {
      manager.clearDefaultButton(btn);
    };
  }, [manager]);

  return (
    <div className="cg-content" data-testid="gallery-default-button">
      <div className="cg-section">
        <div className="cg-section-title">Default Button</div>
        <p className="cg-description">
          Click outside the buttons, then press Enter to activate the default button.
        </p>
        <div className="cg-variant-row">
          <TugPushButton
            size="md"
            onClick={() => setLastAction("Cancel clicked")}
          >
            Cancel
          </TugPushButton>
          <span ref={confirmContainerRef}>
            <TugPushButton
              emphasis="filled"
              role="accent"
              size="md"
              onClick={() => setLastAction("Confirm clicked")}
            >
              Confirm
            </TugPushButton>
          </span>
        </div>
        {lastAction !== null && (
          <div className="cg-demo-status" data-testid="gallery-default-button-status">
            {lastAction}
          </div>
        )}
      </div>
    </div>
  );
}
