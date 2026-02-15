/**
 * Deck manager for card layout and frame dispatch
 *
 * Phase 1: single card fills the entire viewport.
 */

import { FeedIdValue } from "./protocol";
import { TugCard } from "./cards/card";
import { TugConnection } from "./connection";

/**
 * Manages card layout and frame dispatch.
 *
 * Registers cards, dispatches incoming frames to subscribed cards,
 * and propagates resize events.
 */
export class DeckManager {
  private cards: TugCard[] = [];
  private container: HTMLElement;
  private connection: TugConnection;

  constructor(container: HTMLElement, connection: TugConnection) {
    this.container = container;
    this.connection = connection;

    // Listen for window resize
    window.addEventListener("resize", () => this.handleResize());
  }

  /**
   * Register a card with the deck
   *
   * Registers connection callbacks for the card's feed IDs
   * and mounts the card in the container.
   */
  addCard(card: TugCard): void {
    this.cards.push(card);

    // Register connection callbacks for this card's feed IDs
    for (const feedId of card.feedIds) {
      this.connection.onFrame(feedId, (payload: Uint8Array) => {
        card.onFrame(feedId, payload);
      });
    }

    // Mount the card (Phase 1: card fills entire container)
    card.mount(this.container);
  }

  /**
   * Handle window resize by propagating to all cards
   */
  private handleResize(): void {
    const { clientWidth, clientHeight } = this.container;
    for (const card of this.cards) {
      card.onResize(clientWidth, clientHeight);
    }
  }

  /**
   * Destroy all cards and clean up
   */
  destroy(): void {
    for (const card of this.cards) {
      card.destroy();
    }
    this.cards = [];
  }
}
