/**
 * `PermissionModeChip` — the Z4B permission-mode indicator chip.
 *
 * Display-only per [D13]: it shows the session's current permission mode
 * and nothing else. There is no click affordance — the mode changes via
 * `Shift+Tab` (the cycle handler on the dev card's card-content responder)
 * or the `/permissions` slash command, never by clicking the chip.
 *
 * Rendered as a two-line `TugBadge` (`label-top` / `size="sm"` / agent role)
 * per the dev-card / Claude-Code-parity plan's canonical Z4B chip config:
 * an uppercase `MODE` caption over the mode label. Not width-stabilized per
 * Risk R01 — the chip's width tracks the current label and reflows when the
 * mode cycles, by design.
 *
 * Data sources ([L02] — external state enters through `useSyncExternalStore`
 * only):
 *  - live mode from `SessionMetadataStore.permissionMode` (the authority;
 *    updated by the post-mutation `system_metadata` round-trip);
 *  - per-card persisted mode from tugbank `dev.permission-mode.<cardId>`,
 *    read as the pre-population fallback so the chip shows the prior mode
 *    immediately on card relaunch, before the live metadata lands ([D07]).
 *
 * Compositional component — composes `TugBadge` and adds no styling of its
 * own, so it is `.tsx`-only with no `.css` file (per the component-authoring
 * guide). `TugBadge` keeps its own tokens [L20].
 *
 * Laws: [L02] store subscription, [L06] no React state for appearance,
 *       [L19] authoring guide, [L20] composed child keeps own tokens
 * Decisions: [D04] SessionMetadataStore hub, [D07] per-card persistence,
 *            [D13] indicator-only
 *
 * @module components/tugways/cards/permission-mode-chip
 */

import "./permission-mode-chip.css";

import React, { useCallback, useMemo, useSyncExternalStore } from "react";
import { ArrowBigUp } from "lucide-react";

import { TugBadge, type TugBadgeMenuItem } from "@/components/tugways/tug-badge";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
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
   * Sender id the chevron menu stamps on its `set-value` dispatch so the dev
   * card's form responder can route it to `setMode`. Omit to render the chip
   * without the menu (display-only).
   */
  menuSenderId?: string;
}

export function PermissionModeChip({
  cardId,
  sessionMetadataStore,
  menuSenderId,
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

  // Menu items: each mode option dispatches `set-value` carrying the mode
  // string + this chip's sender. It walks up from the prompt entry to the
  // dev card's form responder, whose `setValueString` slot for this sender
  // calls `setMode` [L11]. `set-value` (not `select-value`, which the prompt
  // entry already claims for route selection) so the dispatch is not
  // intercepted before it reaches the form responder. Omitted when no
  // `menuSenderId` — the chip stays display-only.
  const menuItems = useMemo<TugBadgeMenuItem[] | undefined>(() => {
    if (menuSenderId === undefined) return undefined;
    return PERMISSION_MODE_MENU.map((m) => ({
      action: TUG_ACTIONS.SET_VALUE,
      value: m,
      label: formatPermissionMode(m),
    }));
  }, [menuSenderId]);

  return (
    <TugBadge
      layout="label-top"
      label="Mode"
      size="sm"
      role="agent"
      emphasis="tinted"
      data-slot="permission-mode-chip"
      title={mode === null ? undefined : `Permission mode: ${formatPermissionMode(mode)}`}
      menuItems={menuItems}
      menuSenderId={menuSenderId}
      chevron="up"
      menuAriaLabel="Permission mode"
      // Teaching header: shows users they can also cycle the mode with the
      // keyboard. Non-interactive (a menu label, not a selectable item).
      menuHeader={
        menuSenderId === undefined
          ? undefined
          : { label: "Tab to cycle", icon: <ArrowBigUp aria-hidden="true" /> }
      }
    >
      {/* Width-stabilized value: the shown label plus a hidden sizer per menu
          mode reserve the widest label so cycling the mode never reflows the
          chip (this chip only, per [R01]). */}
      <span className="permission-mode-chip-value">
        <span className="permission-mode-chip-value-shown" data-slot="permission-mode-value">
          {formatPermissionMode(mode)}
        </span>
        {PERMISSION_MODE_MENU.map((m) => (
          <span key={m} aria-hidden="true" className="permission-mode-chip-value-sizer">
            {formatPermissionMode(m)}
          </span>
        ))}
      </span>
    </TugBadge>
  );
}
