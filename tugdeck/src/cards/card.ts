/**
 * Base interface for all tugdeck cards.
 *
 * A card subscribes to one or more feed IDs and renders
 * the received data in its container element.
 */

import { FeedIdValue } from "../protocol";

export interface TugCard {
  /** Feed IDs this card subscribes to */
  readonly feedIds: readonly FeedIdValue[];

  /** Whether this card can be collapsed. Defaults to true if not specified. */
  readonly collapsible?: boolean;

  /** Mount the card into a container element */
  mount(container: HTMLElement): void;

  /** Handle an incoming frame for a subscribed feed */
  onFrame(feedId: FeedIdValue, payload: Uint8Array): void;

  /** Handle container resize */
  onResize(width: number, height: number): void;

  /** Destroy the card and clean up resources */
  destroy(): void;
}
