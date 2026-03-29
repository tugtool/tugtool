/**
 * TugBannerProvider — subscribes to connection disconnect state and renders TugBanner.
 *
 * Always mounted in the React tree (status variant, never conditionally rendered).
 * Bridges the TugConnection disconnect callback to the TugBanner `visible` prop.
 * Renders TugBanner with the caution tone while disconnected, showing reconnect info.
 *
 * Replaces DisconnectBanner for the new tugways-based rendering. DisconnectBanner
 * can be removed after TugBannerProvider is wired into deck-manager.ts.
 */

import React, { useState, useEffect } from "react";
import type { TugConnection, DisconnectState } from "../../connection";
import { TugBanner } from "@/components/tugways/tug-banner";

// ---- Props ----

export interface TugBannerProviderProps {
  connection: TugConnection | null;
}

// ---- Component ----

export function TugBannerProvider({ connection }: TugBannerProviderProps) {
  const [disconnectState, setDisconnectState] = useState<DisconnectState | null>(null);

  useEffect(() => {
    if (!connection || typeof connection.onDisconnectState !== "function") return;

    const unsubscribe = connection.onDisconnectState((state) => {
      setDisconnectState(state);
    });

    return unsubscribe;
  }, [connection]);

  const isVisible = Boolean(disconnectState?.disconnected);

  // Build message text
  let message = "Disconnected";
  if (disconnectState?.reconnecting) {
    message = "Reconnecting...";
  } else if (disconnectState?.disconnected) {
    if (disconnectState.reason) {
      message = `Disconnected (${disconnectState.reason})`;
    }
    if (disconnectState.countdown > 0) {
      message += ` — reconnecting in ${disconnectState.countdown}s...`;
    }
  }

  return (
    <TugBanner
      visible={isVisible}
      variant="status"
      tone="caution"
      message={message}
      icon="wifi-off"
    />
  );
}
