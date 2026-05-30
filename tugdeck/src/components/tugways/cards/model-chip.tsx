/**
 * `ModelChip` — Z4B display-only model indicator.
 *
 * Shows the session's active model (`system_metadata.model`) as a two-line
 * `TugBadge` (`label-top` / `size="sm"` / `role="agent"`) carrying a `MODEL`
 * caption over the formatted label (`claude-opus-4-8[1m]` → `Opus 4.8 · 1M`).
 *
 * Display-only per [D13] — no click, no menu. The model is changed via the
 * `/model` slash command ([#step-2b]); the synthetic `model_change`
 * confirmation lands in the transcript per [D09], so this chip does no banner
 * work and owns no sheet. It is the model sibling of `DevSessionIdBadge` and
 * the project badge — the same plain `TugBadge` shape.
 *
 * **Never hides on missing data.** When the session has not reported a model
 * (`model === null`), the chip stays mounted and escalates to `caution` with a
 * `?` value and an alert icon — the same "surface the gap, don't swallow it"
 * treatment the Claude Code version chip uses for drift
 * ([dev-route-indicator-badge.tsx]). An absent model is information worth
 * seeing, not a reason to vanish.
 *
 * Data source ([L02] — external state enters React through
 * `useSyncExternalStore` only): the live `model` from
 * `SessionMetadataStore`, updated by each `system_metadata` event. The chip is
 * NOT width-stabilized — it reflows when the model changes, accepted per [R01].
 *
 * Compositional component — composes `TugBadge` and adds no styling, so it is
 * `.tsx`-only per the component-authoring "Compositional Component" rule; the
 * composed `TugBadge` keeps its own tokens [L20].
 *
 * Laws: [L02] store subscription, [L06] appearance via CSS/DOM, [L19] authoring
 * Decisions: [D01] Z4B chrome anchor, [D04] SessionMetadataStore hub,
 *            [D09] model-confirm in transcript, [D13] Z4B indicator-only
 *
 * @module components/tugways/cards/model-chip
 */

import React, { useSyncExternalStore } from "react";
import { TriangleAlert } from "lucide-react";

import { TugBadge } from "@/components/tugways/tug-badge";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import { formatModelLabel } from "@/lib/model-label";

export interface ModelChipProps {
  /** Metadata store supplying the live `model`. */
  sessionMetadataStore: SessionMetadataStore;
}

/**
 * Display-only Z4B chip showing the active model. When no model has been
 * reported yet it stays visible as a `caution` chip with a `?` value, rather
 * than hiding — an unknown model is surfaced, never swallowed.
 */
export function ModelChip({
  sessionMetadataStore,
}: ModelChipProps): React.ReactElement {
  const snapshot = useSyncExternalStore(
    sessionMetadataStore.subscribe,
    sessionMetadataStore.getSnapshot,
  );

  // Resolution order: exact current model (live or ledger-replayed) →
  // the `initialize` default-model label → honest caution `?`.
  const exactModel = snapshot.model;
  const defaultModelLabel =
    snapshot.models.length > 0 ? snapshot.models[0].displayName : null;

  let content: string;
  let role: "agent" | "caution";
  let title: string;
  if (exactModel !== null) {
    content = formatModelLabel(exactModel);
    role = "agent";
    title = exactModel;
  } else if (defaultModelLabel !== null) {
    content = defaultModelLabel;
    role = "agent";
    title = `${defaultModelLabel} — exact model resolves on the first turn`;
  } else {
    content = "?";
    role = "caution";
    title = "Model not reported by the session";
  }

  return (
    <TugBadge
      emphasis="tinted"
      role={role}
      size="sm"
      layout="label-top"
      label="Model"
      icon={role === "caution" ? <TriangleAlert aria-hidden="true" /> : undefined}
      title={title}
      data-slot="model-chip"
    >
      {content}
    </TugBadge>
  );
}
