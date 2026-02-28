/**
 * Base interface for all tugdeck cards.
 *
 * A card subscribes to one or more feed IDs and renders
 * the received data in its container element.
 */

import { FeedIdValue } from "../protocol";

// ---- Card menu types ----

/** A clickable action item in the card dropdown menu. */
export interface CardMenuAction {
  type: "action";
  label: string;
  action: () => void;
}

/** A toggle (checkbox) item in the card dropdown menu. */
export interface CardMenuToggle {
  type: "toggle";
  label: string;
  checked: boolean;
  action: (checked: boolean) => void;
}

/** A select item (radio group / submenu) in the card dropdown menu. */
export interface CardMenuSelect {
  type: "select";
  label: string;
  options: string[];
  value: string;
  action: (value: string) => void;
}

/** A visual separator in the card dropdown menu. */
export interface CardMenuSeparator {
  type: "separator";
}

export type CardMenuItem = CardMenuAction | CardMenuToggle | CardMenuSelect | CardMenuSeparator;

// ---- Card metadata ----

export interface TugCardMeta {
  /** Display title shown in the header bar. */
  title: string;
  /** Lucide icon name (e.g. "MessageSquare", "Terminal", "GitBranch"). */
  icon: string;
  /** Whether the card can be closed via the close button. */
  closable: boolean;
  /** Menu items shown in the header dropdown. */
  menuItems: CardMenuItem[];
}

// ---- Base card interface ----

export interface TugCard {
  /** Feed IDs this card subscribes to */
  readonly feedIds: readonly FeedIdValue[];

  /** Whether this card can be collapsed. Defaults to true if not specified. */
  readonly collapsible?: boolean;

  /** Optional metadata for CardHeader construction. */
  readonly meta?: TugCardMeta;

  /** Mount the card into a container element */
  mount(container: HTMLElement): void;

  /** Handle an incoming frame for a subscribed feed */
  onFrame(feedId: FeedIdValue, payload: Uint8Array): void;

  /** Handle container resize */
  onResize(width: number, height: number): void;

  /** Claim keyboard focus (e.g. focus textarea or terminal). Optional. */
  focus?(): void;

  /** Destroy the card and clean up resources */
  destroy(): void;

  /**
   * Called by DeckManager during render() to give the card a reference to its
   * CardFrame. Also called with null before CardFrame destruction during
   * re-render teardown, preventing meta updates from reaching destroyed DOM.
   * Optional — only ReactCardAdapter implements this.
   */
  setCardFrame?(frame: import("../components/chrome/card-frame").CardFrameHandle | null): void;

  /**
   * Called by DeckManager during render() and handleTabActivate() to inform
   * the card whether it is the currently visible tab. When active is true and
   * a CardFrame reference is set, the adapter pushes its cached meta to the
   * CardFrame header immediately.
   * Optional — only ReactCardAdapter implements this.
   */
  setActiveTab?(active: boolean): void;
}
