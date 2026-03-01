/**
 * DisconnectBanner — React component that shows when the WebSocket connection is lost.
 *
 * Subscribes to TugConnection's disconnect state via onDisconnectState().
 * Renders the banner with a countdown to the next reconnect attempt.
 * Hidden when the connection is established.
 *
 * Replaces the DOM-based banner in connection.ts (removed in step-9).
 *
 * Step 9: Event Bridge Cleanup
 */

import React, { useState, useEffect } from "react";
import type { TugConnection, DisconnectState } from "../../connection";

// ---- Props ----

export interface DisconnectBannerProps {
  connection: TugConnection | null;
}

// ---- Component ----

export function DisconnectBanner({ connection }: DisconnectBannerProps) {
  const [disconnectState, setDisconnectState] = useState<DisconnectState | null>(null);

  useEffect(() => {
    if (!connection || typeof connection.onDisconnectState !== "function") return;

    const unsubscribe = connection.onDisconnectState((state) => {
      setDisconnectState(state);
    });

    return unsubscribe;
  }, [connection]);

  // Not disconnected: render nothing
  if (!disconnectState || !disconnectState.disconnected) {
    return null;
  }

  // Build banner text
  let text: string;
  if (disconnectState.reconnecting) {
    text = "Reconnecting...";
  } else {
    text = "Disconnected";
    if (disconnectState.reason) {
      text += ` (${disconnectState.reason})`;
    }
    if (disconnectState.countdown > 0) {
      text += ` -- reconnecting in ${disconnectState.countdown}s...`;
    }
  }

  return (
    <div
      className="disconnect-banner"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        backgroundColor: "var(--td-warning, #f59e0b)",
        color: "var(--td-surface, #1a1a1a)",
        textAlign: "center",
        padding: "6px 12px",
        fontSize: "13px",
        fontWeight: 500,
      }}
    >
      {text}
    </div>
  );
}
