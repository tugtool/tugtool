/**
 * Tab PropertyStore registry — maps a card's id to the `PropertyStore`
 * registered by the currently-active tab's content. When a chain dispatch
 * of `setProperty` targets a cardId via `sendToTarget(cardId, ...)`, the
 * card-level responder resolves the PropertyStore through this registry
 * rather than holding it directly — since the PropertyStore is now owned
 * by the tab's `TabContentHost`, not by the card chrome.
 *
 * Only the active tab of each card registers a PropertyStore here. Tab
 * switches flip the registration from the outgoing active tab's host to
 * the incoming one. Cross-card moves are a non-issue at the registry
 * level because the key is the destination `hostCardId`.
 *
 * @module components/chrome/tab-property-store-registry
 */

import type { PropertyStore } from "../tugways/property-store";

const stores = new Map<string, PropertyStore>();

/**
 * Register the currently-active tab's PropertyStore under `hostCardId`.
 * Idempotent: the same store registered twice is a no-op. A different store
 * replaces the previous registration without warning — callers are
 * responsible for registering at most one active tab per card.
 */
export function register(hostCardId: string, store: PropertyStore): void {
  stores.set(hostCardId, store);
}

/** Remove the registration for `hostCardId`. No-op if unregistered. */
export function unregister(hostCardId: string): void {
  stores.delete(hostCardId);
}

/** Return the currently-registered PropertyStore for `hostCardId`, or null. */
export function get(hostCardId: string): PropertyStore | null {
  return stores.get(hostCardId) ?? null;
}

/** Test-only: clear all registrations. */
export function _resetForTests(): void {
  stores.clear();
}
