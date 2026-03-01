/**
 * ReactCardAdapter — config object adapter for React card components.
 *
 * In the unified single-root architecture (Step 7+), ReactCardAdapter is a
 * lightweight config object. DeckCanvas renders card components directly using
 * the config's component, feedIds, and initialMeta. There is no createRoot
 * call, no DOM mounting, and no CustomEvent listening.
 *
 * ReactCardAdapter implements the minimal TugCard interface so DeckManager
 * can track feedIds and route frames via cardsByFeed. Card components receive
 * feed data through CardContextProvider via DeckCanvas state.
 *
 * Spec S01, [D04] Unified single React root — mount/setCardFrame/setActiveTab removed
 */

import type { TugCard, TugCardMeta } from "./card";
import type { TugConnection } from "../connection";
import type { IDragState } from "../drag-state";
import type { FeedIdValue } from "../protocol";
import type React from "react";

export interface ReactCardAdapterConfig {
  /** The React component to mount */
  component: React.ComponentType;
  /** Feed IDs this card subscribes to */
  feedIds: readonly FeedIdValue[];
  /** Initial metadata shown in the CardHeader before the component calls useCardMeta */
  initialMeta: TugCardMeta;
  /** WebSocket connection (optional — passed through context) */
  connection?: TugConnection | null;
  /** Drag state (optional — passed through context) */
  dragState?: IDragState | null;
}

export class ReactCardAdapter implements TugCard {
  readonly feedIds: readonly FeedIdValue[];
  readonly component: React.ComponentType;
  readonly connection: TugConnection | null;
  readonly dragState: IDragState | null;

  private _meta: TugCardMeta;

  constructor(config: ReactCardAdapterConfig) {
    this.feedIds = config.feedIds;
    this._meta = config.initialMeta;
    this.connection = config.connection ?? null;
    this.dragState = config.dragState ?? null;
    this.component = config.component;
  }

  get meta(): TugCardMeta {
    return this._meta;
  }

  /**
   * Set the drag state reference.
   * Called on the concrete type by main.tsx.
   */
  setDragState(dragState: IDragState): void {
    (this as { dragState: IDragState | null }).dragState = dragState;
  }

  // ---- TugCard interface ----
  // In the unified React tree, card content is rendered by DeckCanvas.
  // These lifecycle methods are no-ops since DeckCanvas owns rendering.

  mount(_container: HTMLElement): void {
    // No-op: DeckCanvas renders card content directly.
  }

  onFrame(_feedId: FeedIdValue, _payload: Uint8Array): void {
    // No-op: DeckCanvas state receives frames via DeckCanvasHandle.onFrame().
  }

  onResize(_width: number, _height: number): void {
    // No-op: DeckCanvas CardContent uses ResizeObserver internally.
  }

  focus(): void {
    // No-op: focus management is handled by DeckManager via card container elements.
  }

  destroy(): void {
    // No-op: DeckCanvas unmounts React content when the panel is removed.
  }
}
