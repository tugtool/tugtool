/**
 * `TideSessionIdBadge` — dev-only Z4B chip showing the truncated
 * `tugSessionId` of the card's current binding.
 *
 * Purpose: surface "which session am I bound to right now?" inline so
 * regressions in session-restore (e.g. an unintended `mode=new` after
 * Developer > Reload) are visible at a glance — pre-reload and
 * post-reload ids should match if the binding survived. Outside dev
 * the badge tree-shakes out via `isDevEnv()`; production builds pay
 * no rendering cost.
 *
 * Reads the binding through `cardSessionBindingStore` per [L02] —
 * external state enters React via `useSyncExternalStore`. The
 * subscription is unconditional (mount-identity stable across the
 * binding's live → cleared → restored cycle), but the rendered output
 * collapses to `null` when no binding is present.
 *
 * @module components/tugways/chrome/dev-session-id-badge
 */

import React from "react";

import { TugBadge } from "@/components/tugways/tug-badge";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import { isDevEnv } from "@/lib/dev-env";

export interface TideSessionIdBadgeProps {
  /** The card whose binding's session id to display. */
  cardId: string;
}

/** First N chars of the session id — long enough to disambiguate
 *  across cards, short enough to fit in the indicator strip. */
const TRUNCATE_LENGTH = 8;

export function TideSessionIdBadge({
  cardId,
}: TideSessionIdBadgeProps): React.ReactElement | null {
  const tugSessionId = React.useSyncExternalStore(
    cardSessionBindingStore.subscribe,
    React.useCallback(
      () => cardSessionBindingStore.getBinding(cardId)?.tugSessionId ?? null,
      [cardId],
    ),
  );

  if (!isDevEnv()) return null;
  if (tugSessionId === null) return null;

  return (
    <TugBadge
      emphasis="tinted"
      role="inherit"
      size="sm"
      title={tugSessionId}
    >
      Session: {tugSessionId.slice(0, TRUNCATE_LENGTH)}
    </TugBadge>
  );
}
