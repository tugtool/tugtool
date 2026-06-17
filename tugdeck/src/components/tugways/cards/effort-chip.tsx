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
import { useCopyableButton } from "@/components/tugways/use-copyable-text";
import { TugStableOverlay } from "@/components/tugways/internal/tug-stable-overlay";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import { formatEffortLabel, resolveEffortDisplay } from "@/lib/effort";

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
  /** Author the chip into a focus group ([P02]) — forwarded to the composed
   *  {@link TugPushButton}. The dev card passes its cycle group so the chip
   *  becomes a keyboard-focus-cycling stop; omitted elsewhere. */
  focusGroup?: string;
  /** Order within {@link focusGroup}. */
  focusOrder?: number;
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
  focusGroup,
  focusOrder,
}: EffortChipProps): React.ReactElement {
  const snapshot = useSyncExternalStore(
    sessionMetadataStore.subscribe,
    sessionMetadataStore.getSnapshot,
  );

  // EFFORT is not in the JSONL — it only exists from the live
  // `session_capabilities` handshake (or a restored per-card choice). The chip
  // shows the explicit override if set, the confirmed default when a live
  // handshake is present, and the `-` placeholder when the model is
  // unsupported OR when there is no live effort source at all (pure offline
  // replay) — an honest unknown, never an assumed default.
  const display = resolveEffortDisplay(
    snapshot.models,
    snapshot.model,
    snapshot.effort,
  );
  const effectiveEffort = display.level;
  const content = formatEffortLabel(effectiveEffort);
  // Width-stabilize against the `-` placeholder plus every supported level
  // label so switching among them never reflows the chip ([R01]).
  const sizerLabels = [
    formatEffortLabel(null),
    ...display.levels.map((level) => formatEffortLabel(level)),
  ];

  const title = !display.supported
    ? "Reasoning effort: not supported by this model"
    : effectiveEffort === null
      ? "Reasoning effort: unknown until the session reconnects"
      : snapshot.effort === null
        ? `Reasoning effort: ${content} (default)`
        : `Reasoning effort: ${content}`;

  const copy = useCopyableButton(`Effort: ${content}`);

  return (
    <>
    <TugPushButton
      ref={copy.ref as React.Ref<HTMLButtonElement>}
      onContextMenu={copy.onContextMenu}
      layout="label-top"
      label="Effort"
      size="sm"
      emphasis="tinted"
      role="agent"
      data-slot="effort-chip"
      aria-label="Reasoning effort"
      title={title}
      disabled={disabled}
      focusGroup={focusGroup}
      focusOrder={focusOrder}
      onClick={onOpenPicker}
    >
      <TugStableOverlay
        data-slot="effort-value"
        active={content}
        alternates={sizerLabels}
      />
    </TugPushButton>
    {copy.contextMenu}
    </>
  );
}
