/**
 * TugBannerProvider — subscribes to connection disconnect state and renders TugBanner.
 *
 * Always mounted in the React tree (status variant, never conditionally rendered).
 * Bridges the TugConnection disconnect callback to the TugBanner `visible` prop.
 * Renders TugBanner with the caution tone while disconnected, showing reconnect info.
 */

import React, { useState, useEffect } from "react";
import type { TugConnection, DisconnectState } from "../../connection";
import { TugBanner } from "@/components/tugways/tug-banner";

// ---- Props ----

export interface TugBannerProviderProps {
  connection: TugConnection | null;
}

// ---- Component ----

/** Delay before showing the banner, so brief jitters at launch don't flash it. */
const SHOW_DELAY_MS = 2000;

export function TugBannerProvider({ connection }: TugBannerProviderProps) {
  const [disconnectState, setDisconnectState] = useState<DisconnectState | null>(null);

  useEffect(() => {
    if (!connection || typeof connection.onDisconnectState !== "function") return;

    let showTimer: number | null = null;
    let latestDisconnectedState: DisconnectState | null = null;

    const unsubscribe = connection.onDisconnectState((state) => {
      if (state.disconnected) {
        // Stash the latest disconnect state so the timer always applies current info.
        latestDisconnectedState = state;

        // Start a single delay timer on first disconnect. The timer stays active
        // for the entire disconnect period — subsequent callbacks just update
        // latestDisconnectedState above. This prevents stale timers from
        // overwriting a reconnected state.
        if (showTimer === null) {
          showTimer = window.setTimeout(() => {
            showTimer = null;
            if (latestDisconnectedState) {
              setDisconnectState(latestDisconnectedState);
            }
          }, SHOW_DELAY_MS);
        }
      } else {
        // Reconnected — cancel pending show and update immediately.
        latestDisconnectedState = null;
        if (showTimer !== null) {
          window.clearTimeout(showTimer);
          showTimer = null;
        }
        setDisconnectState(state);
      }
    });

    return () => {
      if (showTimer !== null) window.clearTimeout(showTimer);
      unsubscribe();
    };
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
