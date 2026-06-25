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
 * **Interactive ([D13]).** Like the neighbor Project / Mode / Model /
 * Effort chips, this is a `TugPushButton`, not a display badge: clicking
 * it opens the session's on-disk JSONL directory in Finder — the
 * `~/.claude/projects/<encode(cwd)>/` folder where Claude Code writes
 * `<tugSessionId>.jsonl`. The folder is derived from the session's
 * resolved `cwd` (`system_metadata.cwd`, the same source the `/memory`
 * auto-memory destination encodes), falling back to the binding's
 * `projectDir` before the live metadata lands. Right-click still copies
 * the chip face, matching the sibling control chips.
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

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useCopyableButton } from "@/components/tugways/use-copyable-text";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import { sessionNameStore } from "@/lib/session-name-store";
import { sessionChipDisplay } from "@/lib/session-name";
import { encodeProjectDir } from "@/lib/memory-destinations";
import { openPathInOS } from "@/lib/os-open";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";

export interface DevSessionIdBadgeProps {
  /** The card whose binding's session id to display. */
  cardId: string;
  /**
   * Metadata store supplying the session's resolved `cwd` — the directory
   * whose encoding names the on-disk JSONL folder the chip opens. Omitted
   * in gallery / fixture mounts, where the chip falls back to the binding's
   * `projectDir`.
   */
  sessionMetadataStore?: SessionMetadataStore;
  /** Dim + disable the chip (e.g. on the Shell route, where the Code
   *  session id is inapplicable). Forwarded to {@link TugPushButton}. */
  disabled?: boolean;
}

export function DevSessionIdBadge({
  cardId,
  sessionMetadataStore,
  disabled,
}: DevSessionIdBadgeProps): React.ReactElement | null {
  const binding = React.useSyncExternalStore(
    cardSessionBindingStore.subscribe,
    React.useCallback(
      () => cardSessionBindingStore.getBinding(cardId),
      [cardId],
    ),
  );
  const tugSessionId = binding?.tugSessionId ?? null;
  // The user-assigned name ([#step-13d]), or null when unnamed.
  const name = React.useSyncExternalStore(
    sessionNameStore.subscribe,
    React.useCallback(
      () => (tugSessionId === null ? null : sessionNameStore.getName(tugSessionId)),
      [tugSessionId],
    ),
  );
  // Claude Code's resolved cwd — the directory whose encoding names the
  // JSONL folder. Falls back to the binding's `projectDir` before the live
  // metadata lands. The subscription is unconditional ([L02]); a missing
  // store yields `null`.
  const cwd = React.useSyncExternalStore(
    React.useCallback(
      (listener) =>
        sessionMetadataStore !== undefined
          ? sessionMetadataStore.subscribe(listener)
          : () => {},
      [sessionMetadataStore],
    ),
    React.useCallback(
      () => sessionMetadataStore?.getSnapshot().cwd ?? null,
      [sessionMetadataStore],
    ),
  );

  // Named → the name (≤16 chars, ellipsized) with name + id in the tooltip;
  // unnamed → the truncated id, full id in the tooltip. Computed before the
  // early return so the copy hook below runs unconditionally ([L02] hooks).
  const display =
    tugSessionId === null ? null : sessionChipDisplay(name, tugSessionId);
  const value = display?.value ?? "";

  // Copy "Session" + the short id (the chip face), not the full UUID. When the
  // session was renamed, copy the full un-ellipsized name instead. `value` is
  // already the short id when unnamed, so it doubles as the copy text there.
  const copyValue = name?.trim() ? name.trim() : value;
  const copy = useCopyableButton(`Session: ${copyValue}`);

  if (tugSessionId === null || display === null) return null;

  // The directory Claude Code writes this session's JSONL into. Prefer the
  // resolved cwd; fall back to the binding's project dir before metadata
  // lands. The host reveals the deepest existing ancestor if the exact
  // encoded folder is missing, so a click is never dead.
  const dirSource = cwd ?? binding?.projectDir ?? null;
  const jsonlDir =
    dirSource !== null
      ? `~/.claude/projects/${encodeProjectDir(dirSource)}`
      : null;

  return (
    <>
      <TugPushButton
        ref={copy.ref as React.Ref<HTMLButtonElement>}
        onContextMenu={copy.onContextMenu}
        emphasis="tinted"
        role="action"
        size="sm"
        layout="label-top"
        label="Session"
        data-slot="dev-session-id-badge"
        aria-label="Open session files in Finder"
        title={
          jsonlDir !== null
            ? `Open session files in Finder: ${jsonlDir}`
            : display.tooltip
        }
        disabled={disabled || jsonlDir === null}
        onClick={
          jsonlDir !== null
            ? () => openPathInOS(jsonlDir, "folder")
            : undefined
        }
      >
        {value}
      </TugPushButton>
      {copy.contextMenu}
    </>
  );
}
