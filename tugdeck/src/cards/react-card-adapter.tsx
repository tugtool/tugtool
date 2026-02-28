/**
 * ReactCardAdapter — adapts a React component to the TugCard interface.
 *
 * Mounts a React root inside the card container, wraps the component in a
 * CardContextProvider, and handles live meta updates by listening for the
 * "card-meta-update" CustomEvent dispatched by useCardMeta().
 *
 * Live meta update flow:
 *   React component calls useCardMeta(meta)
 *   -> useCardMeta dispatches "card-meta-update" on the container element
 *   -> ReactCardAdapter listener: stores new meta in _meta, pushes to CardFrame
 *      if _isActiveTab is true
 *   -> CardFrame.updateMeta(meta) -> CardHeader.updateMeta(meta) -> DOM update
 *
 * setCardFrame / setActiveTab lifecycle (called by DeckManager):
 *   render():          setCardFrame(null) for all cards (clears stale refs)
 *                      setCardFrame(fp) for all tabs in the panel
 *                      setActiveTab(isActive) for all tabs
 *   handleTabActivate: prevCard.setActiveTab(false), newCard.setActiveTab(true)
 *
 * Spec S01, [D08] React adapter
 */

import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TugCard, TugCardMeta } from "./card";
import type { CardFrameHandle } from "../components/chrome/card-frame";
import type { TugConnection } from "../connection";
import type { IDragState } from "../drag-state";
import type { FeedIdValue } from "../protocol";
import { CardContextProvider } from "./card-context";

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

  private _meta: TugCardMeta;
  private _cardFrame: CardFrameHandle | null = null;
  private _isActiveTab = false;
  private _root: Root | null = null;
  private _container: HTMLElement | null = null;
  private _feedData: Map<FeedIdValue, Uint8Array> = new Map();
  private _dimensions: { width: number; height: number } = { width: 0, height: 0 };
  private _dragState: IDragState | null;
  private _connection: TugConnection | null;
  private _component: React.ComponentType;
  private _metaListener: ((e: Event) => void) | null = null;

  constructor(config: ReactCardAdapterConfig) {
    this.feedIds = config.feedIds;
    this._meta = config.initialMeta;
    this._connection = config.connection ?? null;
    this._dragState = config.dragState ?? null;
    this._component = config.component;
  }

  get meta(): TugCardMeta {
    return this._meta;
  }

  /**
   * Store the CardFrame reference for live meta updates.
   * Called by DeckManager for ALL tabs in a panel (not just the active tab).
   * Also called with null before CardFrame destruction to clear stale refs.
   */
  setCardFrame(frame: CardFrameHandle | null): void {
    this._cardFrame = frame;
  }

  /**
   * Mark this adapter as the active tab.
   * When active=true and a CardFrame is set, immediately push cached meta
   * to the CardFrame so the header reflects this adapter's title/icon/menu.
   */
  setActiveTab(active: boolean): void {
    this._isActiveTab = active;
    if (active && this._cardFrame) {
      this._cardFrame.updateMeta(this._meta);
    }
  }

  /**
   * Mount the React component into the container element.
   * Adds the "card-meta-update" event listener and creates the React root.
   */
  mount(container: HTMLElement): void {
    this._container = container;

    // Listen for meta updates dispatched by useCardMeta inside the component
    this._metaListener = (e: Event) => {
      const customEvent = e as CustomEvent<TugCardMeta>;
      const newMeta = customEvent.detail;
      // Full replacement — no merge — ensures menu callbacks reference latest closures
      this._meta = newMeta;
      // Only push to CardFrame if this tab is currently active
      if (this._isActiveTab && this._cardFrame) {
        this._cardFrame.updateMeta(newMeta);
      }
    };
    container.addEventListener("card-meta-update", this._metaListener);

    // Create and render the React root
    this._root = createRoot(container);
    this._render();
  }

  onFrame(feedId: FeedIdValue, payload: Uint8Array): void {
    this._feedData.set(feedId, payload);
    this._render();
  }

  onResize(width: number, height: number): void {
    this._dimensions = { width, height };
    this._render();
  }

  /**
   * Set the drag state reference (called on the concrete type by main.tsx,
   * not part of the TugCard interface).
   */
  setDragState(dragState: IDragState): void {
    this._dragState = dragState;
  }

  focus(): void {
    // Delegate to a ref-based focus method if the component exposes one.
    // For now, focus the container element itself.
    this._container?.focus();
  }

  destroy(): void {
    if (this._container && this._metaListener) {
      this._container.removeEventListener("card-meta-update", this._metaListener);
      this._metaListener = null;
    }
    if (this._root) {
      this._root.unmount();
      this._root = null;
    }
    this._container = null;
    this._cardFrame = null;
  }

  // ---- Private ----

  private _render(): void {
    if (!this._root || !this._container) return;

    const Component = this._component;
    const dispatch = (feedId: FeedIdValue, payload: Uint8Array): void => {
      this._connection?.send(feedId, payload);
    };
    this._root.render(
      <CardContextProvider
        connection={this._connection}
        feedData={this._feedData}
        dimensions={this._dimensions}
        dragState={this._dragState}
        containerEl={this._container}
        dispatch={dispatch}
      >
        <Component />
      </CardContextProvider>
    );
  }
}
