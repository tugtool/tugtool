/**
 * CardContext — React context providing per-card infrastructure to React card components.
 *
 * Shape (Spec S02):
 *   connection  — TugConnection WebSocket instance
 *   feedData    — Map of feedId -> latest payload bytes (updated by DeckCanvas onFrame)
 *   dimensions  — current { width, height } of the card container (updated by ResizeObserver)
 *   dragState   — IDragState reference (optional, for cards that need it)
 *   dispatch    — send a binary frame to the server (Spec S02)
 *   updateMeta  — callback for React components to push TugCardMeta to the CardHeader
 *
 * CardContextProvider wraps a React card component and supplies all context values.
 * The updateMeta callback is a state setter provided by DeckCanvas, replacing the
 * previous "card-meta-update" CustomEvent dispatch mechanism.
 *
 * [D04] Unified single React root — updateMeta is now a state callback, not a CustomEvent
 */

import React, { createContext, useCallback } from "react";
import type { TugConnection } from "../connection";
import type { IDragState } from "../drag-state";
import type { FeedIdValue } from "../protocol";
import type { TugCardMeta } from "./card";

// ---- Context shape ----

export interface CardContextValue {
  /** WebSocket connection instance */
  connection: TugConnection | null;
  /** Latest feed payloads keyed by feedId */
  feedData: Map<FeedIdValue, Uint8Array>;
  /** Current card container dimensions */
  dimensions: { width: number; height: number };
  /** Optional drag state for cards that need coupling */
  dragState: IDragState | null;
  /** Send a binary frame to the server (Spec S02) */
  dispatch: (feedId: FeedIdValue, payload: Uint8Array) => void;
  /** Push updated metadata to the CardHeader via state callback */
  updateMeta: (meta: TugCardMeta) => void;
}

const defaultContextValue: CardContextValue = {
  connection: null,
  feedData: new Map(),
  dimensions: { width: 0, height: 0 },
  dragState: null,
  dispatch: () => {},
  updateMeta: () => {},
};

export const CardContext = createContext<CardContextValue>(defaultContextValue);

// ---- Provider props ----

export interface CardContextProviderProps {
  connection: TugConnection | null;
  feedData: Map<FeedIdValue, Uint8Array>;
  dimensions: { width: number; height: number };
  dragState: IDragState | null;
  /** State callback provided by DeckCanvas to update the panel's card header meta. */
  updateMeta?: (meta: TugCardMeta) => void;
  /** Send a binary frame to the server; delegates to connection.send() when provided */
  dispatch?: (feedId: FeedIdValue, payload: Uint8Array) => void;
  children: React.ReactNode;
}

// ---- Provider component ----

export function CardContextProvider({
  connection,
  feedData,
  dimensions,
  dragState,
  updateMeta: updateMetaProp,
  dispatch: dispatchProp,
  children,
}: CardContextProviderProps) {
  const updateMeta = useCallback(
    (meta: TugCardMeta) => {
      if (updateMetaProp) {
        updateMetaProp(meta);
      }
    },
    [updateMetaProp]
  );

  const dispatch = useCallback(
    (feedId: FeedIdValue, payload: Uint8Array) => {
      if (dispatchProp) {
        dispatchProp(feedId, payload);
      } else if (connection) {
        connection.send(feedId, payload);
      }
    },
    [dispatchProp, connection]
  );

  const value: CardContextValue = {
    connection,
    feedData,
    dimensions,
    dragState,
    dispatch,
    updateMeta,
  };

  return <CardContext.Provider value={value}>{children}</CardContext.Provider>;
}
