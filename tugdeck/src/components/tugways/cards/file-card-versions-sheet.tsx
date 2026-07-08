/**
 * FileCardVersionsSheet — sheet content listing a file's revision-store
 * versions with per-row Restore.
 *
 * Versions come from the macOS document revision store via the host's
 * NSFileVersion bridge (`lib/version-bridge.ts`) — the same store
 * TextEdit's Versions browses. Apple's browser UI is NSDocument-private,
 * so Tug renders a plain dated list. Restoring replaces the file on
 * disk; the caller's `onRestored` then re-reads and reverts the buffer
 * in place (a restore is an external change by contract).
 *
 * States are data (fetched list / in-flight flags) rendered through
 * React; no store machinery needed — the sheet is short-lived and
 * card-modal.
 *
 * Laws: [L06] (loading/disabled state as data through render), [L19]
 * (component file + docstring; composes sheet chrome from the host
 * `useTugSheet`, so no CSS pair needed beyond layout in file-card.css),
 * [L20] (composes TugPushButton / TugLabel, which keep their tokens).
 *
 * @module components/tugways/cards/file-card-versions-sheet
 */

import React, { useEffect, useState } from "react";

import {
  listFileVersions,
  restoreFileVersion,
  type FileVersionEntry,
} from "@/lib/version-bridge";
import { TugLabel } from "../tug-label";
import { TugPushButton } from "../tug-push-button";

export interface FileCardVersionsSheetProps {
  /** Absolute path whose versions are listed. */
  path: string;
  /** Close the hosting sheet. */
  close: () => void;
  /** Called after a successful restore (before close). */
  onRestored: () => void;
}

function formatDate(ms: number): string {
  if (ms <= 0) return "Unknown date";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function FileCardVersionsSheet({
  path,
  close,
  onRestored,
}: FileCardVersionsSheetProps): React.ReactElement {
  const [entries, setEntries] = useState<FileVersionEntry[] | null | "loading">(
    "loading",
  );
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void listFileVersions(path).then((result) => {
      if (alive) setEntries(result);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  if (entries === "loading") {
    return (
      <div className="file-card-versions">
        <TugLabel>Loading versions…</TugLabel>
      </div>
    );
  }

  if (entries === null || entries.length === 0) {
    return (
      <div className="file-card-versions">
        <TugLabel>
          {entries === null
            ? "Versions aren't available for this file."
            : "No earlier versions of this file yet."}
        </TugLabel>
        <div className="file-card-versions-footer">
          <TugPushButton onClick={close}>Done</TugPushButton>
        </div>
      </div>
    );
  }

  return (
    <div className="file-card-versions">
      <div className="file-card-versions-list" data-testid="file-card-versions-list">
        {entries.map((entry) => (
          <div className="file-card-versions-row" key={entry.versionId}>
            <TugLabel className="file-card-versions-date">
              {formatDate(entry.modificationDate)}
            </TugLabel>
            <TugPushButton
              disabled={restoring !== null}
              onClick={() => {
                setRestoring(entry.versionId);
                void restoreFileVersion(path, entry.versionId).then((ok) => {
                  setRestoring(null);
                  if (ok) {
                    onRestored();
                    close();
                  }
                });
              }}
            >
              {restoring === entry.versionId ? "Restoring…" : "Restore"}
            </TugPushButton>
          </div>
        ))}
      </div>
      <div className="file-card-versions-footer">
        <TugPushButton onClick={close}>Done</TugPushButton>
      </div>
    </div>
  );
}
