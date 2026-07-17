/**
 * `VisibilityChip` — the Z4B VISIBILITY toggle for the `$` shell and `?` btw
 * routes.
 *
 * A two-line toggle button (`label-top` / `size="sm"`) carrying a `VISIBILITY`
 * caption over the current mode — `Context` (on) or `Private` (off). It families
 * with the neighbor Mode / Model / Effort chips (same layout, size, tinted
 * rest) but, unlike them, it is a persistent on/off toggle rather than a picker
 * opener: it is the first client of {@link TugToggleButton}.
 *
 * `Private` is the default and the historical behaviour — a shell exchange or a
 * side question stays invisible to Claude ([P08]/[P05]). Flipped to `Context`,
 * each newly-settled interaction on that route auto-stages onto the
 * pending-context queue (in the store layer) to ride the next `❯` submission.
 *
 * Route-aware: the chip reads {@link useRoute} to decide which route's
 * visibility it controls (`$` → shell, `?` → btw), so one instance serves both
 * routes the manifest mounts it on. State + toggle go through the per-card
 * {@link PendingContextStore} via `useSyncExternalStore` ([L02]); appearance
 * (the on-state fill) rides `data-state`, never React style ([L06]).
 *
 * Laws: [L02] store subscription, [L06] appearance via CSS/DOM, [L19] authoring.
 *
 * @module components/tugways/cards/visibility-chip
 */

import React, { useSyncExternalStore } from "react";

import { TugToggleButton } from "@/components/tugways/tug-toggle-button";
import { TugStableOverlay } from "@/components/tugways/internal/tug-stable-overlay";
import { useRoute } from "@/lib/route-lifecycle";
import type { ContextSource, PendingContextStore } from "@/lib/pending-context-store";

const ROUTE_SHELL = "$";

export interface VisibilityChipProps {
  /** Per-card staged-context queue — holds the per-route VISIBILITY state. */
  pendingContextStore: PendingContextStore;
  /** Author the chip into a focus group ([P02]) — forwarded to the toggle. */
  focusGroup?: string;
  /** Order within {@link focusGroup}. */
  focusOrder?: number;
}

export function VisibilityChip({
  pendingContextStore,
  focusGroup,
  focusOrder,
}: VisibilityChipProps): React.ReactElement {
  const snapshot = useSyncExternalStore(
    pendingContextStore.subscribe,
    pendingContextStore.getSnapshot,
  );
  const route = useRoute();
  const source: ContextSource = route === ROUTE_SHELL ? "shell" : "btw";
  const isContext = source === "shell" ? snapshot.shellContext : snapshot.btwContext;
  const content = isContext ? "Context" : "Private";
  const title = isContext
    ? "Visibility: Context — interactions on this route are shared into Claude's context"
    : "Visibility: Private — interactions on this route stay private";

  return (
    <TugToggleButton
      layout="label-top"
      label="Visibility"
      size="sm"
      emphasis="tinted"
      role="action"
      data-slot="visibility-chip"
      aria-label="Visibility"
      title={title}
      pressed={isContext}
      onPressedChange={(next) => pendingContextStore.setContext(source, next)}
      focusGroup={focusGroup}
      focusOrder={focusOrder}
    >
      <TugStableOverlay
        active={<span data-slot="visibility-value">{content}</span>}
        alternates={["Context", "Private"]}
      />
    </TugToggleButton>
  );
}
