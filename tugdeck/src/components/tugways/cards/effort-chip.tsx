/**
 * `EffortChip` — the Z4B reasoning-effort control chip ([#step-4]).
 *
 * A two-line `TugPushButton` (`label-top` / `size="sm"` / `role="agent"`)
 * carrying an `EFFORT` caption over the session's current effort level
 * (`high` → `High`, unset → `Default`), sized + tinted to family with the
 * neighbor `sm` `agent` chips. Pressing it opens the shared effort picker —
 * the same opener a future `/effort` slash command would route to. The chip
 * owns no sheet: clicking it calls `onOpenPicker`, the card-hosted opener from
 * {@link useEffortPicker}.
 *
 * **Always present, like its neighbor chips.** The Z4B cluster is a stable
 * row (Claude Code / Project / Session / Mode / Model / Effort) — chips do not
 * appear and disappear as data arrives. So the effort chip always renders;
 * when there is no level to show — the active model doesn't support effort,
 * support is unknown (resumed session, no capabilities), or no override is set
 * — it displays the `-` placeholder rather than hiding. Reasoning effort is
 * per-model (opus supports five levels, sonnet four, haiku none), so when the
 * model has no supported levels the press is an inert no-op (the picker has
 * nothing to offer); otherwise it opens the picker.
 *
 * Data source ([L02] — external state enters React through
 * `useSyncExternalStore` only): `SessionMetadataStore` (the live `effort`, the
 * active `model`, and the capability `models[]` whose per-model support bounds
 * the picker + decides whether a level is shown). The chip is width-stabilized
 * ([R01], opt-in like the model / permission chips): switching among levels
 * (and the `-` placeholder) never reflows it.
 *
 * Compositional component — composes `TugPushButton` and the shared
 * `TugStableOverlay` (the value-line width-stabilizer); it owns no CSS of its
 * own. The composed children keep their own tokens [L20].
 *
 * Laws: [L02] store subscription, [L06] appearance via CSS/DOM, [L19] authoring
 * Decisions: [D01] Z4B chrome anchor, [D04] SessionMetadataStore hub,
 *            [D07] per-card persistence (level restore), [D13] interactive chip
 *
 * @module components/tugways/cards/effort-chip
 */

import React, { useSyncExternalStore } from "react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugStableOverlay } from "@/components/tugways/internal/tug-stable-overlay";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import {
  DEFAULT_EFFORT_LEVEL,
  formatEffortLabel,
  resolveEffortSupport,
} from "@/lib/effort";

export interface EffortChipProps {
  /** Metadata store supplying the live `effort` + the capability `models[]`. */
  sessionMetadataStore: SessionMetadataStore;
  /**
   * Open the shared effort picker sheet. Wired by the dev card to the single
   * opener from {@link useEffortPicker} — the same opener a future `/effort`
   * slash command would route to, so the chip and the command present one
   * sheet.
   */
  onOpenPicker: () => void;
  /** Dim + disable the chip (e.g. on the Shell route, where reasoning effort
   *  is inapplicable). Forwarded to the composed {@link TugPushButton}. */
  disabled?: boolean;
}

/**
 * Z4B chip showing the active model's reasoning-effort level and opening the
 * shared picker on press. Always present; shows `-` when there is no level to
 * display (unsupported model, unknown support, or no override set).
 */
export function EffortChip({
  sessionMetadataStore,
  onOpenPicker,
  disabled,
}: EffortChipProps): React.ReactElement {
  const snapshot = useSyncExternalStore(
    sessionMetadataStore.subscribe,
    sessionMetadataStore.getSnapshot,
  );

  const support = resolveEffortSupport(snapshot.models, snapshot.model);
  // When the model supports effort the chip always shows a level: the explicit
  // override if set, else the session's effective default ([DEFAULT_EFFORT_LEVEL]
  // — claude runs a fresh session at `high`). Only an unsupported model has no
  // level, shown as the `-` placeholder (formatEffortLabel(null)).
  const effectiveEffort = support.supported
    ? (snapshot.effort ?? DEFAULT_EFFORT_LEVEL)
    : null;
  const content = formatEffortLabel(effectiveEffort);
  // Width-stabilize against the `-` placeholder plus every supported level
  // label so switching among them never reflows the chip ([R01]).
  const sizerLabels = [
    formatEffortLabel(null),
    ...support.levels.map((level) => formatEffortLabel(level)),
  ];

  const title = !support.supported
    ? "Reasoning effort: not supported by this model"
    : snapshot.effort === null
      ? `Reasoning effort: ${content} (default)`
      : `Reasoning effort: ${content}`;

  return (
    <TugPushButton
      layout="label-top"
      label="Effort"
      size="sm"
      emphasis="tinted"
      role="agent"
      data-slot="effort-chip"
      aria-label="Reasoning effort"
      title={title}
      disabled={disabled}
      onClick={onOpenPicker}
    >
      <TugStableOverlay
        data-slot="effort-value"
        active={content}
        alternates={sizerLabels}
      />
    </TugPushButton>
  );
}
