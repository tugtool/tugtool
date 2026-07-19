/**
 * text-files-section.tsx — the Lens **Text Files** section: a `TugListView`
 * over the open Text cards plus the recently-open files (the recent-documents
 * MRU). One Tab stop in the Lens; arrows rove, Enter/click front an open card
 * (`focus-session-card`) or open a recent path (`open-file`).
 *
 * Laws: [L02] deck + recents enter React through `useSyncExternalStore` (in the
 * data source); [L06] cursor/selection appearance is CSS on engine attributes;
 * [L22] the FocusManager owns the cursor.
 *
 * @module components/lens/sections/text-files-section
 */

import "./text-files-section.css";

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { FileText } from "lucide-react";

import { registerLensSection } from "@/components/lens/lens-section-registry";
import type { LensSectionHost } from "@/components/lens/lens-section-registry";
import { setSectionHasContent } from "@/components/lens/lens-section-content";
import { dispatchAction } from "@/action-dispatch";
import { getDeckStore } from "@/lib/deck-store-registry";
import {
  getReachableRecentDocumentsSnapshot,
  probeRecentDocuments,
  subscribeRecentDocuments,
} from "@/lib/recent-documents";
import { TugListView } from "@/components/tugways/tug-list-view";
import type {
  TugListViewCellProps,
  TugListViewCellRenderer,
  TugListViewDelegate,
  TugListViewHandle,
} from "@/components/tugways/tug-list-view";
import { TugListRow } from "@/components/tugways/tug-list-row";
import {
  basename,
  buildTextFilesRows,
  dirname,
  useLensTextFilesDataSource,
  type LensTextFilesDataSource,
} from "./text-files-data-source";

// The section's remembered selection — the last-touched row id, mapped to a
// cursor seed on the next Cmd-L / Tab ([P10]). Module-level so it outlives a
// collapse toggle; valid while the Lens is a singleton card.
let lastSelectedTextId: string | null = null;

/** Abbreviate a macOS home prefix (`/Users/<name>`) to `~` for display. */
function displayDir(dir: string): string {
  return dir.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");
}

/** Compact absolute datetime for the "Last opened" label — "Jul 18, 3:42 PM". */
function formatLastOpened(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A two-line row on the shared `TugListRow` chrome: filename (title) over its
 *  dimmed directory (subtitle). A recent (not-open) file reads a touch quieter
 *  via `data-recent`. `meta` is the right-aligned trailing label — "Currently
 *  open" for an open card, "Last opened: …" for a recent file — in one slot and
 *  one style. */
function FileRow({
  name,
  dir,
  recent,
  meta,
}: {
  name: string;
  dir: string;
  recent?: boolean;
  meta?: string;
}): React.ReactElement {
  return (
    <TugListRow
      className={recent ? "text-files-row text-files-row-recent" : "text-files-row"}
      data-recent={recent ? "true" : undefined}
      title={name}
      titleSize="sm"
      subtitle={dir.length > 0 ? displayDir(dir) : undefined}
      trailing={
        meta !== undefined ? (
          <span className="text-files-meta">{meta}</span>
        ) : undefined
      }
    />
  );
}

const TextFilesCell: TugListViewCellRenderer<LensTextFilesDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<LensTextFilesDataSource>) => {
  const row = dataSource.rowAt(index);
  switch (row.kind) {
    case "text-open":
      return (
        <FileRow
          name={row.title}
          dir={row.path !== null ? dirname(row.path) : ""}
          meta="Currently open"
        />
      );
    case "text-recent":
      return (
        <FileRow
          name={basename(row.path)}
          dir={dirname(row.path)}
          recent
          meta={
            row.openedAt != null
              ? `Last opened: ${formatLastOpened(row.openedAt)}`
              : undefined
          }
        />
      );
  }
};

const TEXT_FILES_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<LensTextFilesDataSource>
> = {
  "text-open": TextFilesCell,
  "text-recent": TextFilesCell,
};

/** Live collapsed summary: `N open · M recent`. */
function TextFilesCollapsedSummary(): React.ReactElement {
  const deckStore = getDeckStore();
  const deck = useSyncExternalStore(
    deckStore?.subscribe ?? (() => () => {}),
    deckStore !== null ? deckStore.getSnapshot : () => null,
    () => null,
  );
  const recents = useSyncExternalStore(
    subscribeRecentDocuments,
    getReachableRecentDocumentsSnapshot,
    getReachableRecentDocumentsSnapshot,
  );
  const { open, recent } = useMemo(() => {
    const rows = buildTextFilesRows({ deck, recents });
    return {
      open: rows.filter((r) => r.kind === "text-open").length,
      recent: rows.filter((r) => r.kind === "text-recent").length,
    };
  }, [deck, recents]);
  if (open === 0 && recent === 0) return <>No files</>;
  return <>{`${open} open · ${recent} recent`}</>;
}

function TextFilesSectionBody({ host }: { host: LensSectionHost }): React.ReactElement {
  const dataSource = useLensTextFilesDataSource();
  const count = dataSource.numberOfItems();
  const listRef = useRef<TugListViewHandle>(null);

  // Content = any cursorable row (open cards or recents); the "Recent" header
  // is an inert divider and doesn't count. Publish it so the Lens skips this
  // band for the Cmd-L seed / Tab walk when it holds only a header (or nothing).
  let cursorableCount = 0;
  for (let i = 0; i < count; i += 1) {
    if (dataSource.roleForIndex(i) !== "header") cursorableCount += 1;
  }
  const hasContent = cursorableCount > 0;
  useLayoutEffect(() => {
    setSectionHasContent(host.focusGroup, hasContent);
    return () => setSectionHasContent(host.focusGroup, false);
  }, [host.focusGroup, hasContent]);

  // Re-probe the MRU against disk whenever the section (re)appears — a file
  // deleted while the section was collapsed drops off on expand.
  useEffect(() => {
    probeRecentDocuments();
  }, []);

  const initialSelectedIndex = useMemo(() => {
    if (lastSelectedTextId === null) return undefined;
    for (let i = 0; i < dataSource.numberOfItems(); i += 1) {
      if (dataSource.idForIndex(i) === lastSelectedTextId) return i;
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, count]);

  // Opening a recent removes its row and adds a `text-open` row (asynchronously,
  // once the card binds the path). The keyboard cursor must follow the file
  // across that recent→open transition. Remember the path on activate; a
  // layout effect lands the cursor on the resulting open row when it appears.
  const pendingOpenPathRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const path = pendingOpenPathRef.current;
    if (path === null) return;
    for (let i = 0; i < dataSource.numberOfItems(); i += 1) {
      const row = dataSource.rowAt(i);
      if (row.kind === "text-open" && row.path === path) {
        pendingOpenPathRef.current = null;
        lastSelectedTextId = dataSource.idForIndex(i);
        listRef.current?.moveCursorTo(i);
        return;
      }
    }
  });

  const delegate = useMemo<TugListViewDelegate>(() => {
    const activate = (index: number): void => {
      const row = dataSource.rowAt(index);
      if (row === undefined) return;
      lastSelectedTextId = dataSource.idForIndex(index);
      if (row.kind === "text-open") {
        dispatchAction({ action: "focus-session-card", cardId: row.cardId });
      } else if (row.kind === "text-recent") {
        // Arm the cursor to follow this file into its (soon-to-mount) open row.
        pendingOpenPathRef.current = row.path;
        dispatchAction({ action: "open-file", path: row.path });
      }
    };
    return { onSelect: activate, onActivate: activate };
  }, [dataSource]);

  return (
    <div className="text-files-section">
      {count === 0 ? (
        // Empty label instead of the list — an empty `flex: 1` list would grow
        // and open a gap under the band (see the Sessions section).
        <div className="text-files-empty">No open or recent files</div>
      ) : (
        <TugListView<LensTextFilesDataSource>
          ref={listRef}
          dataSource={dataSource}
          delegate={delegate}
          cellRenderers={TEXT_FILES_CELL_RENDERERS}
          scrollKey="lens-text-files"
          inline
          rowLayout="flush"
          focusGroup={hasContent ? host.focusGroup : undefined}
          commitOnEnter="act"
          initialSelectedIndex={initialSelectedIndex}
          className="lens-text-files-list"
        />
      )}
    </div>
  );
}

/** Register the Text Files section. Called once at boot from `main.tsx`. */
export function registerTextFilesSection(): void {
  registerLensSection({
    kind: "text-files",
    title: "Text Files",
    glyph: <FileText size={14} />,
    collapsedSummary: () => <TextFilesCollapsedSummary />,
    body: (host) => <TextFilesSectionBody host={host} />,
  });
}
