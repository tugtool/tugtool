/**
 * `ModelChip` — Z4B model control chip.
 *
 * A two-line `TugPushButton` (`label-top` / `size="sm"` / `role="agent"`)
 * carrying a `MODEL` caption over the formatted active model
 * (`claude-opus-4-8[1m]` → `Opus 4.8 · 1M`), sized + tinted to family with
 * the neighbor `sm` `agent` chips. Pressing it opens the shared model picker
 * sheet — the same sheet the `/model` slash command opens ([#step-2b]). The
 * chip owns no sheet: clicking it calls `onOpenPicker`, the card-hosted
 * opener from {@link useModelPicker}.
 *
 * **Interactive per [D13] (second exception).** [D13] keeps Z4B chips
 * indicator-only with one exception — the permission-mode chip. The model
 * chip is the second: model is a high-frequency control that earns a press,
 * and routing it through the chip (plus `/model`) mirrors the permission
 * chip's chip-+-command pattern rather than standing up a bespoke surface.
 *
 * **Never hides on missing data.** When the session has not reported a model
 * (`model === null`) and no `initialize` default is known, the chip stays
 * mounted and escalates to `caution` with a `?` value and an alert icon — the
 * same "surface the gap, don't swallow it" treatment the Claude Code version
 * chip uses for drift ([dev-route-indicator-badge.tsx]). An absent model is
 * information worth seeing, not a reason to vanish; the press still opens the
 * picker so the user can set one.
 *
 * Resolution order (matches the picker's active-row resolution): live
 * `model` (live OR ledger-replayed `system_metadata.model`) → the
 * `initialize` default-model label (`models[0].displayName`) → honest `?`
 * caution. Data source ([L02] — external state enters React through
 * `useSyncExternalStore` only): `SessionMetadataStore`. The chip is
 * width-stabilized ([R01], opt-in like the permission-mode chip): switching
 * among model labels never reflows it, and a wider unexpected value still
 * fits.
 *
 * Compositional component — composes `TugPushButton` and the shared
 * `TugStableOverlay` (the value-line width-stabilizer); it owns no CSS of its
 * own. The composed children keep their own tokens [L20].
 *
 * Laws: [L02] store subscription, [L06] appearance via CSS/DOM, [L19] authoring
 * Decisions: [D01] Z4B chrome anchor, [D04] SessionMetadataStore hub,
 *            [D13] Z4B model is the second interactive chip
 *
 * @module components/tugways/cards/model-chip
 */

import React, { useSyncExternalStore } from "react";
import { TriangleAlert } from "lucide-react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugStableOverlay } from "@/components/tugways/internal/tug-stable-overlay";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import { formatModelLabel } from "@/lib/model-label";
import { KNOWN_MODELS, selectorToModelId } from "@/lib/model-picker-data";

/**
 * Resolved-model labels the chip width-stabilizes against — one per known
 * model family (`Opus 4.8 · 1M`, `Sonnet 4.6`, `Haiku 4.5`). Reserving the
 * widest means switching models never reflows the chip ([R01]).
 */
const MODEL_CHIP_SIZER_LABELS = KNOWN_MODELS.map((m) =>
  formatModelLabel(selectorToModelId(m.value)),
);

export interface ModelChipProps {
  /** Metadata store supplying the live `model` + the `initialize` model list. */
  sessionMetadataStore: SessionMetadataStore;
  /**
   * Open the shared model picker sheet. Wired by the dev card to the single
   * opener from {@link useModelPicker} — the same opener the `/model` slash
   * command routes to, so the chip and the command present one sheet.
   */
  onOpenPicker: () => void;
  /** Dim + disable the chip (e.g. on the Shell route, where model selection
   *  is inapplicable). Forwarded to the composed {@link TugPushButton}. */
  disabled?: boolean;
  /** Author the chip into a focus group ([P02]) — forwarded to the composed
   *  {@link TugPushButton}. The dev card passes its cycle group so the chip
   *  becomes a keyboard-focus-cycling stop; omitted elsewhere. */
  focusGroup?: string;
  /** Order within {@link focusGroup}. */
  focusOrder?: number;
}

/**
 * Z4B chip showing the active model and opening the shared picker on press.
 * When no model has been reported yet it stays visible as a `caution` chip
 * with a `?` value, rather than hiding — an unknown model is surfaced, never
 * swallowed.
 */
export function ModelChip({
  sessionMetadataStore,
  onOpenPicker,
  disabled,
  focusGroup,
  focusOrder,
}: ModelChipProps): React.ReactElement {
  const snapshot = useSyncExternalStore(
    sessionMetadataStore.subscribe,
    sessionMetadataStore.getSnapshot,
  );

  // Resolution order: exact current model (live or ledger-replayed) →
  // the `initialize` default-model label → honest caution `?`.
  const exactModel = snapshot.model;
  // The default model's display name is `Default (recommended)` — too long for
  // the chip's reserved width, so the chip drops the trailing parenthetical
  // (`Default`). The picker sheet keeps the full label (it has the room).
  const defaultModelLabel =
    snapshot.models.length > 0
      ? snapshot.models[0].displayName.replace(/\s*\([^)]*\)\s*$/, "")
      : null;

  let content: string;
  let unknown = false;
  let title: string;
  if (exactModel !== null) {
    content = formatModelLabel(exactModel);
    title = exactModel;
  } else if (defaultModelLabel !== null) {
    content = defaultModelLabel;
    title = `${defaultModelLabel} — exact model resolves on the first turn`;
  } else {
    content = "?";
    unknown = true;
    title = "Model not reported by the session";
  }

  // `TugPushButton` has no `caution` role (unlike `TugBadge`), so an unknown
  // model is surfaced via the alert icon + a `data-unknown` hook rather than a
  // role escalation — still "show the gap, don't swallow it", never hides.
  return (
    <TugPushButton
      layout="label-top"
      label="Model"
      size="sm"
      emphasis="tinted"
      role="agent"
      icon={unknown ? <TriangleAlert aria-hidden="true" /> : undefined}
      data-slot="model-chip"
      data-unknown={unknown ? "" : undefined}
      aria-label="Model"
      title={title}
      disabled={disabled}
      focusGroup={focusGroup}
      focusOrder={focusOrder}
      onClick={onOpenPicker}
    >
      {/* Width-stabilized value: the shown label plus a hidden sizer per known
          model label reserve the widest so switching never reflows the chip
          ([R01]). A live value wider than any sizer still fits — the active
          face is a real layout item. */}
      <TugStableOverlay
        data-slot="model-value"
        active={content}
        alternates={MODEL_CHIP_SIZER_LABELS}
      />
    </TugPushButton>
  );
}
