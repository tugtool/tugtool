/**
 * `PermissionModeChip` — the Z4B permission-mode control chip.
 *
 * A two-line `TugPushButton` (`label-top` / `size="sm"`) carrying an uppercase
 * `MODE` caption over the session's current permission-mode label, prefixed
 * with the `shield-cog-corner` icon. Pushing it opens a `TugSheet` listing the
 * behavior options ([PERMISSION_MODE_MENU]); picking one calls `onSelectMode`.
 * The `Shift+Tab` cycle (handled on the dev card's card-content responder) and
 * the `/permissions` slash command remain the other two ways to change the
 * mode; all three funnel through the dev card's single `setMode`.
 *
 * Data sources ([L02] — external state enters through `useSyncExternalStore`
 * only):
 *  - live mode from `SessionMetadataStore.permissionMode` (the authority;
 *    updated by the post-mutation `system_metadata` round-trip);
 *  - per-card persisted mode from tugbank `dev.permission-mode.<cardId>`,
 *    read as the pre-population fallback so the chip shows the prior mode
 *    immediately on card relaunch, before the live metadata lands ([D07]).
 *
 * Compositional component — composes `TugPushButton` + `TugSheet`; its only
 * own CSS is the value-line width-stabilizer and the sheet's option list.
 * The composed children keep their own tokens [L20].
 *
 * Laws: [L02] store subscription, [L06] no React state for appearance,
 *       [L19] authoring guide, [L20] composed children keep own tokens
 * Decisions: [D04] SessionMetadataStore hub, [D07] per-card persistence
 *
 * @module components/tugways/cards/permission-mode-chip
 */

import "./permission-mode-chip.css";

import React, { useCallback, useSyncExternalStore } from "react";
import { ShieldCogCorner } from "lucide-react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useTugSheet } from "@/components/tugways/tug-sheet";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import {
  PERMISSION_MODE_DOMAIN,
  PERMISSION_MODE_MENU,
  formatPermissionMode,
  parsePersistedPermissionMode,
} from "@/lib/permission-mode";

export interface PermissionModeChipProps {
  /** The card whose binding's permission mode the chip persists / restores. */
  cardId: string;
  /** Metadata store supplying the live `permissionMode`. */
  sessionMetadataStore: SessionMetadataStore;
  /**
   * Called with the chosen mode when the user picks one in the behavior sheet.
   * Wired by the dev card to `usePermissionMode().setMode`, which sends the
   * `permission_mode` frame, optimistically reflects the mode, and persists it
   * per card.
   */
  onSelectMode: (mode: string) => void;
}

export function PermissionModeChip({
  cardId,
  sessionMetadataStore,
  onSelectMode,
}: PermissionModeChipProps): React.ReactElement {
  const liveMode = useSyncExternalStore(
    sessionMetadataStore.subscribe,
    useCallback(
      () => sessionMetadataStore.getSnapshot().permissionMode,
      [sessionMetadataStore],
    ),
  );

  // Per-card persisted mode — the pre-population fallback before the live
  // `system_metadata` round-trips on a fresh card mount ([D07]). [L02].
  const persistedMode = useTugbankValue<string | null>(
    PERMISSION_MODE_DOMAIN,
    cardId,
    parsePersistedPermissionMode,
    null,
  );

  const mode = liveMode ?? persistedMode;

  const { showSheet, renderSheet } = useTugSheet();

  // Push → present the behavior sheet. Picking an option calls `onSelectMode`
  // and dismisses the sheet; Cancel / Escape just dismiss. `mode` is captured
  // at open time so the open sheet marks the then-current mode as selected.
  const openBehaviorSheet = useCallback(() => {
    void showSheet({
      title: "Permission Mode",
      description: "Choose how Claude handles file edits and commands.",
      content: (close) => (
        <PermissionModeSheetBody
          currentMode={mode}
          onPick={(picked) => {
            onSelectMode(picked);
            close(picked);
          }}
        />
      ),
    });
  }, [showSheet, mode, onSelectMode]);

  return (
    <>
      <TugPushButton
        layout="label-top"
        label="Mode"
        size="sm"
        emphasis="outlined"
        role="action"
        icon={<ShieldCogCorner aria-hidden="true" />}
        data-slot="permission-mode-chip"
        aria-label="Permission mode"
        title={
          mode === null
            ? undefined
            : `Permission mode: ${formatPermissionMode(mode)}`
        }
        onClick={openBehaviorSheet}
      >
        {/* Width-stabilized value: the shown label plus a hidden sizer per menu
            mode reserve the widest label so cycling the mode never reflows the
            chip (this chip only, per [R01]). */}
        <span className="permission-mode-chip-value">
          <span
            className="permission-mode-chip-value-shown"
            data-slot="permission-mode-value"
          >
            {formatPermissionMode(mode)}
          </span>
          {PERMISSION_MODE_MENU.map((m) => (
            <span
              key={m}
              aria-hidden="true"
              className="permission-mode-chip-value-sizer"
            >
              {formatPermissionMode(m)}
            </span>
          ))}
        </span>
      </TugPushButton>
      {renderSheet()}
    </>
  );
}

interface PermissionModeSheetBodyProps {
  /** The mode marked as selected when the sheet opened (`null` if unknown). */
  currentMode: string | null;
  /** Invoked with the chosen mode; the chip closes the sheet afterward. */
  onPick: (mode: string) => void;
}

/**
 * The behavior-options list inside the sheet. One full-width option per
 * [PERMISSION_MODE_MENU] mode; the current mode reads as `filled`, the rest as
 * `ghost`. `bypassPermissions` carries the `danger` role so the dangerous mode
 * is visibly distinct whether or not it is the active one. The selection swap
 * is appearance-only (emphasis class), not React state on this list.
 */
function PermissionModeSheetBody({
  currentMode,
  onPick,
}: PermissionModeSheetBodyProps): React.ReactElement {
  return (
    <div className="permission-mode-sheet-options" role="group">
      {PERMISSION_MODE_MENU.map((m) => {
        const selected = m === currentMode;
        const danger = m === "bypassPermissions";
        return (
          <TugPushButton
            key={m}
            size="md"
            emphasis={selected ? "filled" : "ghost"}
            role={danger ? "danger" : "action"}
            data-mode={m}
            data-selected={selected ? "true" : undefined}
            aria-pressed={selected}
            onClick={() => onPick(m)}
          >
            {formatPermissionMode(m)}
          </TugPushButton>
        );
      })}
    </div>
  );
}
