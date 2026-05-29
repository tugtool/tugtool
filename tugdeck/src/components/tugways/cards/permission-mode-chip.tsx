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

import React, { useCallback, useSyncExternalStore } from "react";

import { TugBadge } from "@/components/tugways/tug-badge";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import {
  PERMISSION_MODE_DOMAIN,
  formatPermissionMode,
  parsePersistedPermissionMode,
} from "@/lib/permission-mode";

export interface PermissionModeChipProps {
  /** The card whose binding's permission mode the chip persists / restores. */
  cardId: string;
  /** Metadata store supplying the live `permissionMode`. */
  sessionMetadataStore: SessionMetadataStore;
}

export function PermissionModeChip({
  cardId,
  sessionMetadataStore,
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

  return (
    <TugBadge
      layout="label-top"
      label="Mode"
      size="sm"
      role="agent"
      emphasis="tinted"
      data-slot="permission-mode-chip"
      title={mode === null ? undefined : `Permission mode: ${formatPermissionMode(mode)}`}
    >
      {formatPermissionMode(mode)}
    </TugBadge>
  );
}
