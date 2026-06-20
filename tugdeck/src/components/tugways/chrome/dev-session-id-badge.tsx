/**
 * `DevSessionIdBadge` — Z4B chip showing the truncated `tugSessionId`
 * of the card's current binding.
 *
 * Purpose: surface "which session am I bound to right now?" inline so
 * regressions in session-restore (e.g. an unintended `mode=new` after
 * Maker > Reload) are visible at a glance — pre-reload and
 * post-reload ids should match if the binding survived. Renders in all
 * builds; collapses to `null` only when the card has no binding.
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
import { sessionNameStore } from "@/lib/session-name-store";
import { sessionChipDisplay } from "@/lib/session-name";

export interface DevSessionIdBadgeProps {
  /** The card whose binding's session id to display. */
  cardId: string;
  /** Dim + disable the chip (e.g. on the Shell route, where the Code
   *  session id is inapplicable). Forwarded to {@link TugBadge}. */
  disabled?: boolean;
}

export function DevSessionIdBadge({
  cardId,
  disabled,
}: DevSessionIdBadgeProps): React.ReactElement | null {
  const tugSessionId = React.useSyncExternalStore(
    cardSessionBindingStore.subscribe,
    React.useCallback(
      () => cardSessionBindingStore.getBinding(cardId)?.tugSessionId ?? null,
      [cardId],
    ),
  );
  // The user-assigned name ([#step-13d]), or null when unnamed.
  const name = React.useSyncExternalStore(
    sessionNameStore.subscribe,
    React.useCallback(
      () => (tugSessionId === null ? null : sessionNameStore.getName(tugSessionId)),
      [tugSessionId],
    ),
  );

  if (tugSessionId === null) return null;

  // Named → the name (≤16 chars, ellipsized) with name + id in the tooltip;
  // unnamed → the truncated id, full id in the tooltip.
  const { value, tooltip } = sessionChipDisplay(name, tugSessionId);

  // Copy "Session" + the short id (the chip face), not the full UUID. When the
  // session was renamed, copy the full un-ellipsized name instead. `value` is
  // already the short id when unnamed, so it doubles as the copy text there.
  const copyValue = name?.trim() ? name.trim() : value;

  return (
    <TugBadge
      emphasis="tinted"
      role="action"
      size="sm"
      layout="label-top"
      label="Session"
      title={tooltip}
      copyText={`Session: ${copyValue}`}
      disabled={disabled}
    >
      {value}
    </TugBadge>
  );
}
