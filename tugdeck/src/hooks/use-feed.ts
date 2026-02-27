/**
 * useFeed — React hook that subscribes to a specific feed ID from CardContext.
 *
 * Returns the latest payload bytes for the given feedId, or null if no frame
 * has arrived yet. Components using this hook must be rendered inside a
 * CardContextProvider.
 */

import { useContext } from "react";
import type { FeedIdValue } from "../protocol";
import { CardContext } from "../cards/card-context";

export function useFeed(feedId: FeedIdValue): Uint8Array | null {
  const ctx = useContext(CardContext);
  return ctx.feedData.get(feedId) ?? null;
}
