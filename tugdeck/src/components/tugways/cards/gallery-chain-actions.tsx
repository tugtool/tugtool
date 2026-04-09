/**
 * GalleryChainActions -- chain-action button demos.
 *
 * Demonstrates chain-action TugButton mode: buttons whose visibility and
 * enablement depend on the responder chain. Also includes an ActionEvent
 * dispatch demo showing explicit-target dispatch via dispatchTo.
 *
 * **Authoritative reference:** [D01] gallery-chain-actions componentId.
 *
 * @module components/tugways/cards/gallery-chain-actions
 */

import React, { useState } from "react";
import { useRequiredResponderChain } from "@/components/tugways/responder-chain-provider";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent, GalleryAction } from "@/components/tugways/responder-chain";
import { TugButton } from "@/components/tugways/internal/tug-button";
import { TugPushButton } from "@/components/tugways/tug-push-button";

// ---------------------------------------------------------------------------
// ActionEventDemo
// ---------------------------------------------------------------------------

/**
 * ActionEventDemo -- demonstrates explicit-target dispatch via dispatchTo.
 *
 * Registers a local responder node with id "action-event-demo" that handles
 * the "demoAction" action. A TugButton in direct-action mode (onClick) calls
 * manager.dispatchTo("action-event-demo", { action: "demoAction", phase: "discrete" })
 * to deliver the event directly to the local responder, bypassing the chain walk.
 *
 * The handler receives the full ActionEvent and stores a display string showing
 * its fields (action, phase). A status line below the button shows the last
 * received event, or "No event received" initially.
 *
 * Rules of Tugways compliance:
 * - [D41] useResponder internally uses useLayoutEffect for registration
 * - [D40] Local display state uses useState -- local component state, not
 *   external store state, so useSyncExternalStore does not apply
 * - [D01] ActionEvent is the sole dispatch currency
 * - [D03] dispatchTo throws on unregistered target (ensured by layout-effect
 *   registration before any click can fire)
 *
 * Note on stale closures: the demoAction handler closes over the useState
 * setter. This is safe because React guarantees setter identity stability
 * across re-renders -- the setter never changes.
 *
 * **Authoritative reference:** [D01] ActionEvent dispatch, [D03] dispatchTo.
 */
function ActionEventDemo() {
  const manager = useRequiredResponderChain();
  const [lastEventText, setLastEventText] = useState<string | null>(null);

  // Register a local responder that handles "demoAction".
  // useResponder uses useLayoutEffect internally ([D41]), so the node is
  // registered before any click event can fire.
  // The setter is stable across re-renders, so the closure is never stale.
  //
  // The `<GalleryAction>` type parameter opts into the demo-only
  // vocabulary — "demoAction" is not in the production `TugAction`
  // union, and passing GalleryAction as the Extra type widens the
  // action map's key set to include it.
  useResponder<GalleryAction>({
    id: "action-event-demo",
    actions: {
      demoAction: (event: ActionEvent<GalleryAction>) => {
        setLastEventText(`action: "${event.action}", phase: "${event.phase}"`);
      },
    },
  });

  const handleDispatch = () => {
    manager.dispatchTo<GalleryAction>("action-event-demo", {
      action: "demoAction",
      phase: "discrete",
    });
  };

  return (
    <div className="cg-section" data-testid="action-event-demo">
      <div className="cg-section-title">ActionEvent Dispatch</div>
      <p className="cg-description">
        Click the button to dispatch directly to a local responder node via{" "}
        <code>dispatchTo</code>. The handler receives the full{" "}
        <code>ActionEvent</code> and displays its fields below.
      </p>
      <div className="cg-variant-row">
        <TugPushButton
          size="md"
          onClick={handleDispatch}
        >
          Dispatch demoAction
        </TugPushButton>
      </div>
      <div className="cg-demo-status" data-testid="action-event-demo-status">
        {lastEventText !== null ? lastEventText : "No event received"}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryChainActions
// ---------------------------------------------------------------------------

/**
 * GalleryChainActions -- chain-action button demos.
 *
 * Demonstrates chain-action TugButton mode: buttons whose visibility and
 * enablement depend on the responder chain. Also includes an ActionEvent
 * dispatch demo showing explicit-target dispatch via dispatchTo.
 *
 * **Authoritative reference:** [D01] gallery-chain-actions componentId.
 */
export function GalleryChainActions() {
  return (
    <div className="cg-content" data-testid="gallery-chain-actions">
      <div className="cg-section">
        <div className="cg-section-title">Chain-Action Buttons</div>
        <div className="cg-variant-row">
          <TugButton action="cycleCard">
            Cycle Card
          </TugButton>
          <TugButton action="showComponentGallery">
            Show Gallery
          </TugButton>
        </div>
      </div>

      <div className="cg-divider" />

      <ActionEventDemo />
    </div>
  );
}
