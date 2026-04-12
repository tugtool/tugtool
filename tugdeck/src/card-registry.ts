/**
 * Card Registry Module
 *
 * Single-call card registration API for the Tugcard system.
 *
 * **Authoritative reference:** design-system-concepts.md [D04] Single-call card
 * registration, Spec S02 CardRegistration interface, Spec S03 Registry API.
 *
 * ## Usage
 *
 * ```typescript
 * import { registerCard, getRegistration, getAllRegistrations } from "./card-registry";
 *
 * registerCard({
 *   componentId: "hello",
 *   contentFactory: () => <HelloCardContent />,
 *   defaultMeta: { title: "Hello", closable: true },
 * });
 * ```
 *
 * @module card-registry
 */

import type React from "react";
import type { FeedIdValue } from "./protocol";
import type { TabItem } from "./layout-tree";

/**
 * Size policy for a card type. Governs default sizing of new cards and
 * resize clamping in CardFrame.
 *
 * - `min`: hard floor for resize (content can report a larger min, but not smaller).
 * - `max`: hard ceiling for resize (omit for unbounded).
 * - `preferred`: size for new cards with no saved state.
 */
export interface CardSizePolicy {
  min: { width: number; height: number };
  max?: { width: number; height: number };
  preferred: { width: number; height: number };
}

/**
 * Default size policy applied when a card registration omits `sizePolicy`.
 */
export const DEFAULT_SIZE_POLICY: CardSizePolicy = {
  min: { width: 250, height: 180 },
  preferred: { width: 400, height: 300 },
};

/**
 * Metadata describing a card's default appearance and behavior.
 *
 * **Authoritative reference:** Spec S01 TugcardMeta.
 */
export interface TugcardMeta {
  title: string;
  icon?: string;
  closable?: boolean;
}

/**
 * A single entry in the card registry.
 *
 * **Authoritative reference:** Spec S02 CardRegistration interface.
 *
 * DeckCanvas constructs Tugcard directly for every card (single-tab and
 * multi-tab alike) and uses `contentFactory` to get card-specific content.
 */
export interface CardRegistration {
  /** Unique identifier for this card type. e.g. "hello", "terminal", "git". */
  componentId: string;
  /**
   * Returns the content component (e.g. `<HelloCardContent />`) without
   * the Tugcard chrome. DeckCanvas constructs Tugcard directly and uses this
   * to get card-specific content.
   */
  contentFactory: (cardId: string) => React.ReactNode;
  /** Default title, icon, and closable for this card type. */
  defaultMeta: TugcardMeta;
  /** Default feed IDs. Defaults to `[]` when omitted. */
  defaultFeedIds?: readonly FeedIdValue[];
  /** Card type family (e.g. "standard", "developer"). Defaults to "standard". */
  family?: string;
  /** Families this card can host in its type picker. Defaults to `["standard"]`. */
  acceptsFamilies?: readonly string[];
  /**
   * Default tabs to create when addCard is called with this registration.
   * Each entry is a template: `componentId`, `title`, and `closable` are copied,
   * but a fresh UUID is assigned as the tab `id`. When omitted, a single tab
   * is created from `defaultMeta`.
   */
  defaultTabs?: readonly TabItem[];
  /** Default card-level title (e.g. "Component Gallery"). Defaults to `""`. */
  defaultTitle?: string;
  /** Size policy for this card type. Falls back to DEFAULT_SIZE_POLICY when omitted. */
  sizePolicy?: CardSizePolicy;
}

/** Module-level registry map. Keyed by componentId. */
const registry = new Map<string, CardRegistration>();

/**
 * Register a card type.
 *
 * Calling with a duplicate `componentId` logs a warning and overwrites the
 * existing registration.
 *
 * **Authoritative reference:** Spec S03 Registry API.
 */
export function registerCard(registration: CardRegistration): void {
  if (registry.has(registration.componentId)) {
    console.warn(
      `[card-registry] Duplicate registration for componentId "${registration.componentId}". Overwriting.`,
    );
  }
  registry.set(registration.componentId, registration);
}

/**
 * Retrieve a registered card by componentId.
 *
 * Returns `undefined` if no card is registered under that id.
 *
 * **Authoritative reference:** Spec S03 Registry API.
 */
export function getRegistration(componentId: string): CardRegistration | undefined {
  return registry.get(componentId);
}

/**
 * Return all registered cards.
 *
 * **Authoritative reference:** Spec S03 Registry API.
 */
export function getAllRegistrations(): Map<string, CardRegistration> {
  return registry;
}

/**
 * Return the size policy for a registered card type.
 *
 * Returns the registration's `sizePolicy` if set, otherwise `DEFAULT_SIZE_POLICY`.
 * Returns `DEFAULT_SIZE_POLICY` when the componentId is not registered.
 */
export function getSizePolicy(componentId: string): CardSizePolicy {
  return registry.get(componentId)?.sizePolicy ?? DEFAULT_SIZE_POLICY;
}

/**
 * Clear the registry.
 *
 * **For test use only.** Provides isolation between test cases.
 */
export function _resetForTest(): void {
  registry.clear();
}
