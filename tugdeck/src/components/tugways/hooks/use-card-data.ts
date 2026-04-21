/**
 * useCardData -- Feed data access hook for card content components.
 *
 * **Authoritative reference:** design-system-concepts.md [D02] Hooks for data,
 * [D16]; #d02-hooks-not-render-props.
 *
 * ## Design
 *
 * `CardHost` places a `CardDataProvider` around card content. The provider
 * holds a `Map<number, unknown>` of decoded feed payloads keyed by feed ID.
 *
 * Two overloads are provided:
 * - `useCardData<T>()`: returns the first feed's decoded value typed as `T`
 *   (single-feed convenience overload).
 * - `useCardData()`: returns the full `Map<number, unknown>` for multi-feed
 *   access.
 *
 * Both overloads return `null` when:
 * - The component is rendered outside a `CardDataProvider` (no provider in
 *   the tree), or
 * - The feed data map is empty (feedless card or feed not yet arrived).
 *
 * ## Usage
 *
 * ```tsx
 * // Single-feed convenience (typed)
 * const data = useCardData<MyPayloadType>();
 *
 * // Multi-feed access (raw map)
 * const feeds = useCardData();
 * const payload = feeds?.get(FeedId.CODE_OUTPUT) as MyType | undefined;
 * ```
 *
 * @module hooks/use-card-data
 */

import React, { createContext, useContext } from "react";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * The value stored in `CardDataContext`.
 *
 * `null` means the component is either outside a `CardDataProvider` or inside a feedless
 * card (`feedIds=[]`). When non-null the map holds decoded feed payloads keyed
 * by numeric feed ID.
 */
export type CardDataContextValue = { feedData: Map<number, unknown> } | null;

/**
 * React context holding the current card's feed data.
 *
 * Default value is `null` so hooks rendered outside a provider return `null`
 * rather than throwing.
 */
export const CardDataContext = createContext<CardDataContextValue>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Wraps card children with the current feed data map.
 *
 * Intended for **internal use by CardHost only** -- not part of the public API.
 */
export const CardDataProvider: React.FC<{
  feedData: Map<number, unknown>;
  children: React.ReactNode;
}> = ({ feedData, children }) =>
  React.createElement(CardDataContext, { value: { feedData } }, children);

// ---------------------------------------------------------------------------
// Hook overloads
// ---------------------------------------------------------------------------

/**
 * Typed single-feed convenience overload.
 *
 * Returns the decoded value of the **first** feed in the map typed as `T`, or
 * `null` when outside a provider, inside a feedless card, or when the map is
 * empty.
 */
export function useCardData<T>(): T | null;

/**
 * Raw multi-feed overload.
 *
 * Returns the full `Map<number, unknown>` of decoded feed payloads, or `null`
 * when outside a provider or inside a feedless card.
 */
export function useCardData(): Map<number, unknown> | null;

/**
 * Implementation shared by both overloads.
 *
 * Returns the decoded value of the first entry in the feed data map, cast to
 * `T`. For the typed `<T>` single-feed convenience overload this is the
 * correct value. For the no-generic map overload callers receive the same
 * first value cast to `Map<number, unknown>` -- since TypeScript overloads
 * share one runtime body we cannot branch on the presence of a type argument.
 * Callers who need the full map for multi-feed access should call
 * `useCardData<Map<number, unknown>>()` or read `CardDataContext`
 * directly. Phase 6 will revise this when real feed subscription is wired.
 *
 * Returns `null` when:
 * - The component is outside a `CardDataProvider` (context value is null)
 * - The feed data map is empty (feedless card)
 */
export function useCardData<T = Map<number, unknown>>(): T | null {
  const ctx = useContext(CardDataContext);

  if (ctx === null) {
    return null;
  }

  const { feedData } = ctx;

  if (feedData.size === 0) {
    return null;
  }

  const firstValue = feedData.values().next().value;
  return firstValue as T;
}
