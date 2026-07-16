/**
 * `SessionCwdChip` — the shell route's Z4B working-directory chip ([P10], Table
 * T01). Where the `Project` chip names where the card is *anchored*, `Cwd`
 * names where the shell is *standing*. The pair makes a stateful `cd` legible.
 *
 * A two-line `TugPushButton` (`layout="label-top"`) matching the Project
 * chip's grammar: caption `Cwd` over the truncated path face, left-click opens
 * the directory in the OS file browser, right-click copies the full path.
 *
 * In this phase the shell backend does not exist yet, so `cwd` is the card's
 * project directory (the [P10] fallback face). Phase 3 binds it live to
 * `ShellSessionStore.cwd`, at which point the same chip tracks each `cd`.
 */

import type React from "react";

import { openPathInOS } from "@/lib/os-open";

import { TugPushButton } from "../tug-push-button";
import { useCopyableButton } from "../use-copyable-text";
import { formatPathChipText } from "./path-chip-format";

export function SessionCwdChip({
  cwd,
  focusGroup,
  focusOrder,
}: {
  /** Absolute working directory. Null while unresolved (chip renders nothing). */
  cwd: string | null;
  focusGroup?: string;
  focusOrder?: number;
}): React.ReactElement | null {
  // Right-click copies the FULL path, not the ellipsized face.
  const copy = useCopyableButton(`Cwd: ${cwd ?? ""}`);
  if (cwd === null) return null;
  return (
    <>
      <TugPushButton
        ref={copy.ref as React.Ref<HTMLButtonElement>}
        onContextMenu={copy.onContextMenu}
        size="sm"
        emphasis="tinted"
        role="action"
        layout="label-top"
        label="Cwd"
        data-slot="cwd-chip"
        focusGroup={focusGroup}
        focusOrder={focusOrder}
        aria-label="Open working directory in Finder"
        title={`Open in Finder: ${cwd}`}
        onClick={() => openPathInOS(cwd, "folder")}
      >
        {formatPathChipText(cwd)}
      </TugPushButton>
      {copy.contextMenu}
    </>
  );
}
