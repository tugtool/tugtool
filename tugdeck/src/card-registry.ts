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
 *   factory: (cardId, injected) => (
 *     <Tugcard cardId={cardId} meta={{ title: "Hello" }} feedIds={[]} {...injected}>
 *       <HelloCard />
 *     </Tugcard>
 *   ),
 *   defaultMeta: { title: "Hello", closable: true },
 * });
 * ```
 *
 * @module card-registry
 */

import type React from "react";
import type { FeedIdValue } from "./protocol";

/**
 * Props injected by CardFrame into the content rendered by renderContent.
 *
 * Defined here to avoid a circular dependency before CardFrame is implemented.
 * Once card-frame.tsx is created, this type should be imported from there.
 *
 * **Authoritative reference:** Spec S04 CardFrameInjectedProps.
 */
export interface CardFrameInjectedProps {
  /** Header calls this on pointer-down to initiate drag. */
  onDragStart: (event: React.PointerEvent) => void;
  /** Tugcard calls this to report its minimum display size to CardFrame. */
  onMinSizeChange: (size: { width: number; height: number }) => void;
}

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
 * The factory receives `CardFrameInjectedProps` so it can forward `onDragStart`
 * and `onMinSizeChange` to the Tugcard it creates. DeckCanvas calls
 * `registration.factory(card.id, injectedProps)` inside the `renderContent`
 * function it passes to CardFrame.
 *
 * The factory return type includes `onClose` so DeckCanvas can inject it via
 * `React.cloneElement` without a TypeScript type error.
 */
export interface CardRegistration {
  /** Unique identifier for this card type. e.g. "hello", "terminal", "git". */
  componentId: string;
  /**
   * Creates a Tugcard React element with the given card instance ID and injected
   * callbacks. The return type is typed to include `onClose` so DeckCanvas can
   * inject it via `React.cloneElement(element, { onClose: ... })`.
   */
  factory: (
    cardId: string,
    injected: CardFrameInjectedProps,
  ) => React.ReactElement<{ onClose?: () => void }>;
  /** Default title, icon, and closable for this card type. */
  defaultMeta: TugcardMeta;
  /**
   * Returns just the content component (e.g. `<HelloCardContent />`) without
   * the Tugcard chrome. Used by the multi-tab rendering path in DeckCanvas so
   * a single Tugcard element can swap content on tab switch without nesting.
   *
   * **Authoritative reference:** Spec S05, [D08] contentFactory.
   */
  contentFactory?: (cardId: string) => React.ReactNode;
  /**
   * Feed IDs for the multi-tab rendering path. Defaults to `[]` when omitted.
   * DeckCanvas reads `registration.defaultFeedIds ?? []` when constructing a
   * multi-tab Tugcard directly. Forward-compatible hook for Phase 6 feed-aware
   * card types.
   */
  defaultFeedIds?: readonly FeedIdValue[];
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
 * Clear the registry.
 *
 * **For test use only.** Provides isolation between test cases.
 */
export function _resetForTest(): void {
  registry.clear();
}
